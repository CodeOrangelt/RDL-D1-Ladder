import { 
    collection,
    doc, 
    getDoc, 
    getDocs,
    updateDoc, 
    setDoc, 
    deleteDoc,
    writeBatch,
    query,
    where,
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db, auth } from './firebase-config.js';
import { recordEloChange } from './elo-history.js';
import { PromotionHandler } from './promotion-handler.js';
import { isAdmin } from './admin-check.js';

// ladderalgorithm.js
export function calculateElo(winnerRating, loserRating, kFactor = 32) {
    const expectedScoreWinner = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
    const expectedScoreLoser = 1 / (1 + Math.pow(10, (winnerRating - loserRating) / 400));

    const newWinnerRating = winnerRating + kFactor * (1 - expectedScoreWinner);
    const newLoserRating = loserRating + kFactor * (0 - expectedScoreLoser);

    return {
        newWinnerRating: Math.round(newWinnerRating),
        newLoserRating: Math.round(newLoserRating)
    };
}

export function assignDefaultEloRating(playerId, playerData) {
    const defaultEloRating = 1200; // Default ELO rating
    if (!playerData.eloRating) {
        db.collection('players').doc(playerId).update({ eloRating: defaultEloRating })
            .then(() => {
                console.log(`Assigned default ELO rating to player ${playerData.username}`);
            })
            .catch(error => {
                console.error('Error assigning default ELO rating:', error);
            });
    }
}

export async function updateEloRatings(winnerId, loserId, matchId) {
    try {
        console.log('Starting ELO update for winner:', winnerId, 'and loser:', loserId);
        
        // Get the current ratings and positions of both players
        const winnerRef = doc(db, 'players', winnerId);
        const loserRef = doc(db, 'players', loserId);
        
        const [winnerDoc, loserDoc] = await Promise.all([
            getDoc(winnerRef),
            getDoc(loserRef)
        ]);

        if (!winnerDoc.exists() || !loserDoc.exists()) {
            throw new Error('One or both players not found in the database.');
        }

        const winnerData = winnerDoc.data();
        const loserData = loserDoc.data();
        
        // Store original positions
        const winnerPosition = winnerData.position || Number.MAX_SAFE_INTEGER;
        const loserPosition = loserData.position || Number.MAX_SAFE_INTEGER;
        
        // Calculate new ELO ratings
        const { newWinnerRating, newLoserRating } = calculateElo(
            winnerData.eloRating || 1200,
            loserData.eloRating || 1200
        );

        // Create batch for atomic updates
        const batch = writeBatch(db);

        let winnerUpdates = {
            eloRating: newWinnerRating,
            lastMatchDate: serverTimestamp(),
            position: 1 // Winner always takes #1 if they beat #1
        };

        let loserUpdates = {
            eloRating: newLoserRating,
            lastMatchDate: serverTimestamp(),
            position: loserPosition + 1 // Loser moves down one spot
        };

        // Handle position swapping
        if (winnerPosition > loserPosition) {
            console.log('Position swap needed - winner was lower ranked');
            
            if (loserPosition === 1) {
                // If winner beat #1, they become #1
                winnerUpdates.position = 1;
                loserUpdates.position = 2;
            } else {
                // Otherwise, winner takes loser's spot
                winnerUpdates.position = loserPosition; // Winner takes loser's spot
                loserUpdates.position = loserPosition === 1 ? 2 : loserPosition + 1; // Protect position 1

                // Move everyone else down one position
                const playersToUpdate = query(
                    collection(db, 'players'),
                    where('position', '>', loserPosition),
                    where('position', '<=', winnerPosition)
                );
                
                const playersSnapshot = await getDocs(playersToUpdate);
                playersSnapshot.forEach(playerDoc => {
                    if (playerDoc.id !== winnerId && playerDoc.id !== loserId) {
                        batch.update(doc(db, 'players', playerDoc.id), {
                            eloRating: playerDoc.data().eloRating, // Keep existing ELO
                            lastMatchDate: serverTimestamp(),
                            position: playerDoc.data().position + 1
                        });
                    }
                });
            }
        }

        // Add updates to batch
        batch.update(winnerRef, winnerUpdates);
        batch.update(loserRef, loserUpdates);

        // Record ELO history first
        await Promise.all([
            recordEloChange({
                playerId: winnerId,
                previousElo: winnerData.eloRating || 1200,
                newElo: newWinnerRating,
                opponentId: loserId,
                matchResult: 'win',
                previousPosition: winnerPosition,
                newPosition: winnerUpdates.position || winnerPosition,
                isPromotion: winnerUpdates.position < winnerPosition,
                matchId: matchId,  // Add matchId
                timestamp: serverTimestamp()
            }),
            recordEloChange({
                playerId: loserId,
                previousElo: loserData.eloRating || 1200,
                newElo: newLoserRating,
                opponentId: winnerId,
                matchResult: 'loss',
                previousPosition: loserPosition,
                newPosition: loserUpdates.position || loserPosition,
                isDemotion: loserUpdates.position > loserPosition,
                matchId: matchId,  // Add matchId
                timestamp: serverTimestamp()
            })
        ]);

        // Commit batch after history is recorded
        await batch.commit();

        console.log('ELO ratings and positions updated successfully');
        return true;

    } catch (error) {
        console.error('Error in updateEloRatings:', error);
        throw error;
    }
}

// Update the approveReport function to handle different collections
export async function approveReport(
    reportId, 
    winnerScore, 
    winnerSuicides = "0", 
    winnerComment = "", 
    pendingCollection = 'pendingMatches',
    approvedCollection = 'approvedMatches',
    gameMode = 'D1'
) {
    console.log(`Approving report ${reportId} for game mode ${gameMode}`);
    console.log(`Using collections: pending=${pendingCollection}, approved=${approvedCollection}`);

    try {
        // Get the report data
        const reportRef = doc(db, pendingCollection, reportId);
        const reportDoc = await getDoc(reportRef);
        
        if (!reportDoc.exists()) {
            throw new Error(`Report ${reportId} not found in collection ${pendingCollection}`);
        }
        
        const reportData = reportDoc.data();
        
        // Validate necessary fields exist
        if (!reportData.winnerUsername || !reportData.loserUsername) {
            throw new Error('Report is missing winner or loser username');
        }
        
        // Determine which players collection to use
        const playersCollection = gameMode === 'D1' ? 'players' : 'playersD2';
        
        // Get winner and loser data
        let winnerRef, loserRef, winnerDoc, loserDoc;
        
        // Try to get players by ID first (new format)
        if (reportData.winnerId && reportData.loserId) {
            winnerRef = doc(db, playersCollection, reportData.winnerId);
            loserRef = doc(db, playersCollection, reportData.loserId);
            
            winnerDoc = await getDoc(winnerRef);
            loserDoc = await getDoc(loserRef);
            
            // If either doesn't exist by ID, fall back to username
            if (!winnerDoc.exists() || !loserDoc.exists()) {
                console.log('Player not found by ID, trying username lookup');
                
                // Try to find by username
                const winnerQuery = query(collection(db, playersCollection), where("username", "==", reportData.winnerUsername));
                const loserQuery = query(collection(db, playersCollection), where("username", "==", reportData.loserUsername));
                
                const winnerSnapshot = await getDocs(winnerQuery);
                const loserSnapshot = await getDocs(loserQuery);
                
                if (winnerSnapshot.empty || loserSnapshot.empty) {
                    throw new Error('Could not find winner or loser in the players collection');
                }
                
                winnerRef = doc(db, playersCollection, winnerSnapshot.docs[0].id);
                loserRef = doc(db, playersCollection, loserSnapshot.docs[0].id);
                
                winnerDoc = winnerSnapshot.docs[0];
                loserDoc = loserSnapshot.docs[0];
            }
        } else {
            // No IDs provided, try usernames
            const winnerQuery = query(collection(db, playersCollection), where("username", "==", reportData.winnerUsername));
            const loserQuery = query(collection(db, playersCollection), where("username", "==", reportData.loserUsername));
            
            const winnerSnapshot = await getDocs(winnerQuery);
            const loserSnapshot = await getDocs(loserQuery);
            
            if (winnerSnapshot.empty || loserSnapshot.empty) {
                throw new Error('Could not find winner or loser in the players collection');
            }
            
            winnerRef = doc(db, playersCollection, winnerSnapshot.docs[0].id);
            loserRef = doc(db, playersCollection, winnerSnapshot.docs[0].id);
            
            winnerDoc = winnerSnapshot.docs[0];
            loserDoc = winnerSnapshot.docs[0];
        }
        
        // Store the current ELO ratings before updating
        const winnerOldElo = winnerDoc.data().eloRating || 1200;
        const loserOldElo = loserDoc.data().eloRating || 1200;

        // Rest of your existing approval logic...
        // (Continue with the existing function implementation)
        
        // Create an approved match with the combined data
        const approvedMatchData = {
            ...reportData,
            winnerScore,
            winnerSuicides,
            winnerComment,
            approved: true,
            approvedAt: serverTimestamp(),
            approvedBy: auth.currentUser ? auth.currentUser.email : 'unknown',
            winnerOldElo: winnerOldElo, // Add these two lines
            loserOldElo: loserOldElo
        };
        
        // Add to approved collection
        await setDoc(doc(db, approvedCollection, reportId), approvedMatchData);
        
        // Delete from pending collection
        await deleteDoc(reportRef);
        
        console.log(`Report ${reportId} approved successfully`);
        return true;
    } catch (error) {
        console.error('Error approving report:', error);
        throw error;
    }
}

async function updatePlayerElo(userId, oldElo, newElo) {
    // Update player's ELO in database
    await setDoc(doc(db, 'players', userId), {
        ...playerData,
        eloRating: newElo
    });

    // Check for promotion
    await PromotionHandler.checkPromotion(userId, newElo, oldElo);
}

async function updatePlayerStats(playerId, matchData, isWinner) {
    const statsRef = doc(db, 'playerStats', playerId);
    const statsDoc = await getDoc(statsRef);
    let stats = statsDoc.exists() ? statsDoc.data() : {
        wins: 0,
        losses: 0,
        totalKills: 0,
        totalDeaths: 0,
        winRate: 0
    };

    if (isWinner) {
        stats.wins++;
        stats.totalKills += parseInt(matchData.winnerScore || 0);
        stats.totalDeaths += parseInt(matchData.loserScore || 0);
    } else {
        stats.losses++;
        stats.totalKills += parseInt(matchData.loserScore || 0);
        stats.totalDeaths += parseInt(matchData.winnerScore || 0);
    }

    // Calculate win rate
    const totalGames = stats.wins + stats.losses;
    stats.winRate = totalGames > 0 ? ((stats.wins / totalGames) * 100).toFixed(1) : 0;
    stats.lastUpdated = new Date().toISOString();

    await setDoc(statsRef, stats, { merge: true });
}