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
import { promotionManager, checkAndRecordPromotion } from './promotions.js';
import { isAdmin } from './admin-check.js';
import { RANKS, getRankStyle } from './ranks.js';

// ladderalgorithm.js
export function calculateElo(winnerRating, loserRating, kFactor = 32) {
    // Normalize starting ratings if they're using old system
    winnerRating = winnerRating > 1000 ? 200 : winnerRating;
    loserRating = loserRating > 1000 ? 200 : loserRating;

    const expectedScoreWinner = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
    const expectedScoreLoser = 1 / (1 + Math.pow(10, (winnerRating - loserRating) / 400));

    const newWinnerRating = winnerRating + kFactor * (1 - expectedScoreWinner);
    const newLoserRating = loserRating + kFactor * (0 - expectedScoreLoser);

    return {
        newWinnerRating: Math.round(Math.min(newWinnerRating)), // Cap at 1000
        newLoserRating: Math.round(Math.max(newLoserRating, 0)) // Floor at 0
    };//
}

export function assignDefaultEloRating(playerId, playerData) {
    const defaultEloRating = 200; // Changed from 1200 to match new Bronze threshold
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
        // Get batch instance
        const batch = writeBatch(db);

        // Get player references
        const winnerRef = doc(db, 'players', winnerId);
        const loserRef = doc(db, 'players', loserId);

        // Get current player data
        const [winnerDoc, loserDoc] = await Promise.all([
            getDoc(winnerRef),
            getDoc(loserRef)
        ]);

        if (!winnerDoc.exists() || !loserDoc.exists()) {
            throw new Error('One or both players not found');
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

        // Handle position updating based on ladder rules
        let newWinnerPosition = winnerPosition;
        let newLoserPosition = loserPosition;

        if (winnerPosition > loserPosition) {
            // Winner was ranked lower than loser, so winner moves up
            console.log('Position swap needed - winner was lower ranked');

            // Winner takes loser's position
            newWinnerPosition = loserPosition;

            // Loser moves down one spot
            newLoserPosition = loserPosition + 1;

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
        }

        // Use ONLY the fields specifically allowed in the security rules
        const winnerUpdate = {
            eloRating: newWinnerRating,
            lastMatchDate: serverTimestamp(),
            position: newWinnerPosition,
            lastMatchId: matchId
        };

        const loserUpdate = {
            eloRating: newLoserRating,
            lastMatchDate: serverTimestamp(),
            position: newLoserPosition,
            lastMatchId: matchId
        };

        // Update the documents with the limited field set
        batch.update(winnerRef, winnerUpdate);
        batch.update(loserRef, loserUpdate);

        // Commit the batch
        await batch.commit();

        console.log('ELO ratings updated successfully');

        // Create ELO history entries
        await Promise.all([
            recordEloChange({
                playerId: winnerId,
                previousElo: winnerData.eloRating || 1200,
                newElo: newWinnerRating,
                opponentId: loserId,
                matchResult: 'win',
                previousPosition: winnerPosition,
                newPosition: newWinnerPosition,
                isPromotion: newWinnerPosition < winnerPosition,
                matchId: matchId,
                timestamp: serverTimestamp()
            }),
            recordEloChange({
                playerId: loserId,
                previousElo: loserData.eloRating || 1200,
                newElo: newLoserRating,
                opponentId: winnerId,
                matchResult: 'loss',
                previousPosition: loserPosition,
                newPosition: newLoserPosition,
                isDemotion: newLoserPosition > loserPosition,
                matchId: matchId,
                timestamp: serverTimestamp()
            })
        ]);

        // Record promotions/demotions to promotionHistory
        await promotionManager.checkAndRecordPromotion(winnerId, newWinnerRating, winnerData.eloRating, {
            source: 'match',
            matchId: matchId
        });

        await promotionManager.checkAndRecordPromotion(loserId, newLoserRating, loserData.eloRating, {
            source: 'match',
            matchId: matchId
        });

        console.log('ELO ratings and positions updated successfully');
        return true;

    } catch (error) {
        console.error('Error in updateEloRatings:', error);
        throw error;
    }
}

const POINTS_CHART = {
    '': 10, // Standard match
    'Standard': 10,
    'Fusion Match': 25,
    '≥6 Missiles': 10,
    'Weapon Imbalance': 30,
    'Blind Match': 75,
    'Rematch': 20,
    'Disorientation': 50,
    'Ratting': 35,
    'Altered Powerups': 35,
    'Mega Match': 40,
    'Dogfight': 50,
    'Gauss and Mercs': 25,
    'Misc': 30
};

export async function approveReport(reportId, winnerScore, winnerSuicides, winnerComment, winnerDemoLink) {
    try {
        const reportRef = doc(db, 'pendingMatches', reportId);
        const reportSnapshot = await getDoc(reportRef);

        if (!reportSnapshot.exists()) {
            throw new Error('Report not found');
        }

        const reportData = reportSnapshot.data();

        // Create updated report data
        const updatedReportData = {
            ...reportData,
            winnerScore: winnerScore,
            winnerSuicides: winnerSuicides, 
            winnerComment: winnerComment,
            winnerDemoLink: winnerDemoLink,
            approved: true,
            approvedAt: serverTimestamp(),
            approvedBy: auth.currentUser.uid
        };

        // Move match to approved collection first
        await setDoc(doc(db, 'approvedMatches', reportId), updatedReportData);
        await deleteDoc(reportRef);

        console.log('Match moved to approved collection');

        // Get player IDs
        const [winnerDocs, loserDocs] = await Promise.all([
            getDocs(query(collection(db, 'players'), where('username', '==', reportData.winnerUsername))),
            getDocs(query(collection(db, 'players'), where('username', '==', reportData.loserUsername)))
        ]);

        if (winnerDocs.empty || loserDocs.empty) {
            throw new Error('Could not find player documents');
        }

        const winnerId = winnerDocs.docs[0].id;
        const loserId = loserDocs.docs[0].id;
        // Update ELO ratings
        await updateEloRatings(winnerId, loserId, reportId);

        try {
            const subgameType = reportData.subgameType || 'Standard';
            const pointsToAward = POINTS_CHART[subgameType] || 10;
            
            // Get user profiles
            const winnerProfileRef = doc(db, 'userProfiles', winnerId);
            const loserProfileRef = doc(db, 'userProfiles', loserId);
            const [winnerProfile, loserProfile] = await Promise.all([
                getDoc(winnerProfileRef),
                getDoc(loserProfileRef)
            ]);
            
            // If profiles exist, update points
            if (winnerProfile.exists() && loserProfile.exists()) {
                const winnerData = winnerProfile.data();
                const loserData = loserProfile.data();
                
                const winnerCurrentPoints = winnerData.points || 0;
                const loserCurrentPoints = loserData.points || 0;
                
                const winnerNewPoints = winnerCurrentPoints + pointsToAward;
                const loserNewPoints = loserCurrentPoints + pointsToAward;
                
                // Update points for both players
                await Promise.all([
                    updateDoc(winnerProfileRef, {
                        points: winnerNewPoints,
                        lastPointsModified: serverTimestamp()
                    }),
                    updateDoc(loserProfileRef, {
                        points: loserNewPoints,
                        lastPointsModified: serverTimestamp()
                    })
                ]);
                
                // Log points history for both players
                await Promise.all([
                    addDoc(collection(db, 'pointsHistory'), {
                        userId: winnerId,
                        userEmail: winnerData.email || 'unknown',
                        displayName: winnerData.displayName || winnerData.username || 'Unknown User',
                        action: 'add',
                        amount: pointsToAward,
                        previousPoints: winnerCurrentPoints,
                        newPoints: winnerNewPoints,
                        reason: `Match points: ${subgameType} match (Winner)`,
                        adminEmail: 'system-match-award',
                        timestamp: serverTimestamp()
                    }),
                    addDoc(collection(db, 'pointsHistory'), {
                        userId: loserId,
                        userEmail: loserData.email || 'unknown',
                        displayName: loserData.displayName || loserData.username || 'Unknown User',
                        action: 'add',
                        amount: pointsToAward,
                        previousPoints: loserCurrentPoints,
                        newPoints: loserNewPoints,
                        reason: `Match points: ${subgameType} match (Participant)`,
                        adminEmail: 'system-match-award',
                        timestamp: serverTimestamp()
                    })
                ]);
                
                console.log(`Awarded ${pointsToAward} points to both players for ${subgameType} match`);
            } else {
                console.warn('Could not award points - one or both user profiles not found');
            }
        } catch (pointsError) {
            console.warn('Points award failed, but match approval continues:', pointsError);
        }

        console.log('Match successfully approved and ELO updated');
        return true;

    } catch (error) {
        console.error("Error approving report:", error);
        throw error;
    }
}

async function updatePlayerElo(userId, oldElo, newElo) {
    const playerRef = doc(db, 'players', userId);
    const playerDoc = await getDoc(playerRef);
    const playerData = playerDoc.data();

    // Get player stats for rank calculation
    const statsRef = doc(db, 'playerStats', userId);
    const statsDoc = await getDoc(statsRef);
    const stats = statsDoc.data() || { totalMatches: 0, winRate: 0 };

    // Get new rank using updated system
    const newRank = getRankStyle(newElo, stats.totalMatches, stats.winRate);

    await updateDoc(playerRef, {
        eloRating: newElo,
        rank: newRank.name,
        rankColor: newRank.color
    });

    // Check for promotion
    await checkAndRecordPromotion(userId, newElo, oldElo, {
        matchCount: stats.totalMatches,
        winRate: stats.winRate
    });
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