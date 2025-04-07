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
    serverTimestamp,
    addDoc
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

        // Default updates (only ELO and timestamp)
        let winnerUpdates = {
            eloRating: newWinnerRating,
            lastMatchDate: serverTimestamp()
        };

        let loserUpdates = {
            eloRating: newLoserRating,
            lastMatchDate: serverTimestamp()
        };

        // Handle position updating based on ladder rules
        if (winnerPosition > loserPosition) {
            // Winner was ranked lower than loser, so winner moves up
            console.log('Position swap needed - winner was lower ranked');
            
            // Winner takes loser's position
            winnerUpdates.position = loserPosition;
            
            // Loser moves down one spot
            loserUpdates.position = loserPosition + 1;
            
            // Move everyone else between the old positions down one spot
            const playersToUpdate = query(
                collection(db, 'players'),
                where('position', '>', loserPosition),
                where('position', '<', winnerPosition)
            );
            
            const playersSnapshot = await getDocs(playersToUpdate);
            for (const playerDoc of playersSnapshot.docs) {
                if (playerDoc.id !== winnerId && playerDoc.id !== loserId) {
                    // Use batch update instead of individual updateDoc
                    batch.update(doc(db, 'players', playerDoc.id), {
                        position: playerDoc.data().position + 1
                    });
                }
            }
        } else {
            // Winner was already ranked higher than loser, positions stay the same
            console.log('Winner already ranked higher - keeping positions');
            winnerUpdates.position = winnerPosition;playerDoc.id), {
            loserUpdates.position = loserPosition;.position + 1
        }           });
                }
        // Add updates to batch
        batch.update(winnerRef, winnerUpdates);
        batch.update(loserRef, loserUpdates);er than loser, positions stay the same
            console.log('Winner already ranked higher - keeping positions');
        // Record ELO history first= winnerPosition;
        await Promise.all([sition = loserPosition;
            recordEloChange({
                playerId: winnerId,
                previousElo: winnerData.eloRating || 1200,
                newElo: newWinnerRating,dates);
                opponentId: loserId,Updates);
                matchResult: 'win',
                previousPosition: winnerPosition,
                newPosition: winnerUpdates.position,
                isPromotion: winnerUpdates.position < winnerPosition,
                matchId: matchId,d,
                timestamp: serverTimestamp()ating || 1200,
            }), newElo: newWinnerRating,
            recordEloChange({oserId,
                playerId: loserId,,
                previousElo: loserData.eloRating || 1200,
                newElo: newLoserRating,tes.position,
                opponentId: winnerId,dates.position < winnerPosition,
                matchResult: 'loss',
                previousPosition: loserPosition,
                newPosition: loserUpdates.position,
                isDemotion: loserUpdates.position > loserPosition,
                matchId: matchId,,
                timestamp: serverTimestamp()ting || 1200,
            })  newElo: newLoserRating,
        ]);     opponentId: winnerId,
                matchResult: 'loss',
        // Record promotions/demotions to promotionHistory
        if (winnerUpdates.position < winnerPosition) {
            await addDoc(collection(db, 'promotionHistory'), {ion,
                username: winnerData.username,
                userId: winnerId,Timestamp()
                previousElo: winnerData.eloRating,
                newElo: newWinnerRating,
                previousPosition: winnerPosition,
                newPosition: winnerUpdates.position,istory
                timestamp: serverTimestamp(),sition) {
                type: 'promotion',n(db, 'promotionHistory'), {
                promotedBy: 'System',username,
                matchId: matchId,
            }); previousElo: winnerData.eloRating,
        }       newElo: newWinnerRating,
                previousPosition: winnerPosition,
        if (loserUpdates.position > loserPosition) {
            await addDoc(collection(db, 'promotionHistory'), {
                username: loserData.username,
                userId: loserId,tem',
                previousElo: loserData.eloRating,
                newElo: newLoserRating,
                previousPosition: loserPosition,
                newPosition: loserUpdates.position,
                timestamp: serverTimestamp(),tion) {
                type: 'demotion',on(db, 'promotionHistory'), {
                promotedBy: 'System',sername,
                matchId: matchId
            }); previousElo: loserData.eloRating,
        }       newElo: newLoserRating,
                previousPosition: loserPosition,
        // Commit batch after history is recordedn,
        await batch.commit();rverTimestamp(),
                type: 'demotion',
        // Dispatch custom event
        document.dispatchEvent(new CustomEvent('elo-updated'));hId: matchId
            });
        console.log('ELO ratings and positions updated successfully');
        return true;
tch after history is recorded
    } catch (error) {   await batch.commit();
        console.error('Error in updateEloRatings:', error);
        throw error;        console.log('ELO ratings and positions updated successfully');
    }
}

export async function approveReport(reportId, winnerScore, winnerSuicides, winnerComment) {console.error('Error in updateEloRatings:', error);
    try {
        console.log('Starting approveReport function with:', { reportId, winnerScore, winnerSuicides, winnerComment });
        
        const currentUser = auth.currentUser;
        if (!currentUser) {ync function approveReport(reportId, winnerScore, winnerSuicides, winnerComment) {
            console.log('No user logged in');
            throw new Error('You must be logged in to approve matches');        console.log('Starting approveReport function with:', { reportId, winnerScore, winnerSuicides, winnerComment });
        }
        console.log('Current user:', currentUser.email);

        // Get user's player document
        const userDoc = await getDoc(doc(db, 'players', currentUser.uid));            throw new Error('You must be logged in to approve matches');
        const currentUsername = userDoc.exists() ? userDoc.data().username : null;
        console.log('Current username:', currentUsername);

        // Get the pending match        // Get user's player document
        const pendingMatchRef = doc(db, 'pendingMatches', reportId);c(db, 'players', currentUser.uid));
        const reportSnapshot = await getDoc(pendingMatchRef);().username : null;
me);
        if (!reportSnapshot.exists()) {
            console.log('Report not found with ID:', reportId);        // Get the pending match
            throw new Error('Match report not found');atches', reportId);
        }ingMatchRef);

        const reportData = reportSnapshot.data();{
        console.log('Report data:', reportData);d);
        
        // Check if user is the winner
        if (currentUsername !== reportData.winnerUsername) {
            throw new Error('Only the winner can approve matches');ta();
        } reportData);

        // Add winner details to report datar
        const updatedReportData = {winnerUsername) {
            ...reportData,ner can approve matches');
            winnerScore: winnerScore,
            winnerSuicides: winnerSuicides,
            winnerComment: winnerComment,data
            approved: true,
            approvedAt: serverTimestamp(),
            approvedBy: currentUsername,
            createdAt: reportData.createdAt || serverTimestamp(),  winnerSuicides: winnerSuicides,
            winnerUsername: reportData.winnerUsername,            winnerComment: winnerComment,
            loserUsername: reportData.loserUsername
        };

        // Move match to approved collection first            createdAt: reportData.createdAt || serverTimestamp(),
        await setDoc(doc(db, 'approvedMatches', reportId), updatedReportData);
        await deleteDoc(pendingMatchRef);            loserUsername: reportData.loserUsername

        console.log('Match moved to approved collection');

        // Get player IDs
        const [winnerDocs, loserDocs] = await Promise.all([it deleteDoc(pendingMatchRef);
            getDocs(query(collection(db, 'players'), where('username', '==', reportData.winnerUsername))),
            getDocs(query(collection(db, 'players'), where('username', '==', reportData.loserUsername)))ction');
        ]);
/ Get player IDs
        if (winnerDocs.empty || loserDocs.empty) {        const [winnerDocs, loserDocs] = await Promise.all([
            throw new Error('Could not find player documents');rs'), where('username', '==', reportData.winnerUsername))),
        }yers'), where('username', '==', reportData.loserUsername)))
        ]);
        const winnerId = winnerDocs.docs[0].id;
        const loserId = loserDocs.docs[0].id;
            throw new Error('Could not find player documents');
        // Update ELO ratings
        await updateEloRatings(winnerId, loserId, reportId);
        const winnerId = winnerDocs.docs[0].id;
        console.log('Match successfully approved and ELO updated'); = loserDocs.docs[0].id;
        return true;
O ratings
    } catch (error) {   await updateEloRatings(winnerId, loserId, reportId);
        console.error('Error in approveReport:', error);
        throw error;        console.log('Match successfully approved and ELO updated');
    }
}

async function updatePlayerElo(userId, oldElo, newElo) {'Error in approveReport:', error);
    // Update player's ELO in database
    await setDoc(doc(db, 'players', userId), {
        ...playerData,}
        eloRating: newElo
    });
   // Update player's ELO in database
    // Check for promotion    await setDoc(doc(db, 'players', userId), {
    await PromotionHandler.checkPromotion(userId, newElo, oldElo);
}

async function updatePlayerStats(playerId, matchData, isWinner) {
    const statsRef = doc(db, 'playerStats', playerId); promotion
    const statsDoc = await getDoc(statsRef);nHandler.checkPromotion(userId, newElo, oldElo);
    let stats = statsDoc.exists() ? statsDoc.data() : {
        wins: 0,
        losses: 0,atePlayerStats(playerId, matchData, isWinner) {
        totalKills: 0,nst statsRef = doc(db, 'playerStats', playerId);
        totalDeaths: 0,    const statsDoc = await getDoc(statsRef);
        winRate: 0tsDoc.exists() ? statsDoc.data() : {
    };

    if (isWinner) {
        stats.wins++;lDeaths: 0,
        stats.totalKills += parseInt(matchData.winnerScore || 0);
        stats.totalDeaths += parseInt(matchData.loserScore || 0);
    } else {
        stats.losses++;f (isWinner) {
        stats.totalKills += parseInt(matchData.loserScore || 0);        stats.wins++;
        stats.totalDeaths += parseInt(matchData.winnerScore || 0);+= parseInt(matchData.winnerScore || 0);
    }oserScore || 0);

    // Calculate win rate
    const totalGames = stats.wins + stats.losses;        stats.totalKills += parseInt(matchData.loserScore || 0);
    stats.winRate = totalGames > 0 ? ((stats.wins / totalGames) * 100).toFixed(1) : 0;nerScore || 0);
    stats.lastUpdated = new Date().toISOString();   }









});    loadPlayers();    // Refresh the ladder displaydocument.addEventListener('elo-updated', () => {// ladder.js}    await setDoc(statsRef, stats, { merge: true });
    // Calculate win rate
    const totalGames = stats.wins + stats.losses;
    stats.winRate = totalGames > 0 ? ((stats.wins / totalGames) * 100).toFixed(1) : 0;
    stats.lastUpdated = new Date().toISOString();

    await setDoc(statsRef, stats, { merge: true });
}