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

// In ladderalgorithm.js
export async function updateEloRatings(winner, loser, matchId) {
    try {
        // Check if user is logged in and is match participant
        const currentUser = auth.currentUser;
        if (!currentUser) {
            throw new Error('Must be logged in to update ELO ratings');
        }

        // Check if user is match participant
        const isWinner = currentUser.email === winner.email;
        const isLoser = currentUser.email === loser.email;
        
        if (!isWinner && !isLoser) {
            throw new Error('Must be a match participant to update ELO ratings');
        }

        // Calculate new ratings with fallback to default 1200
        const { newWinnerRating, newLoserRating } = calculateElo(
            winner.eloRating || 1200, 
            loser.eloRating || 1200
        );

        // Validate ELO changes
        const winnerChange = newWinnerRating - (winner.eloRating || 1200);
        const loserChange = newLoserRating - (loser.eloRating || 1200);
        if (Math.abs(winnerChange) > 32 || Math.abs(loserChange) > 32) {
            throw new Error('ELO rating change exceeds maximum allowed value of 32');
        }

        // Add match to pending matches
        const pendingMatchRef = doc(collection(db, 'pendingMatches'));
        await setDoc(pendingMatchRef, {
            winnerUsername: winner.username,
            winnerEmail: winner.email,
            loserUsername: loser.username,
            loserEmail: loser.email,
            reportedBy: currentUser.email,
            createdAt: serverTimestamp(),
            mapPlayed: matchId, // Assuming matchId is the map name
            loserScore: 0, // Will be updated by loser
            loserComment: '' // Will be updated by loser
        });

        return true;
    } catch (error) {
        console.error("Error in updateEloRatings:", error);
        throw error;
    }
}

export async function approveReport(reportId, winnerScore, winnerSuicides, winnerComment) {
    try {
        const currentUser = auth.currentUser;
        if (!currentUser) {
            throw new Error('You must be logged in to approve matches');
        }

        // Verify admin status
        const adminStatus = await isAdmin(currentUser.email);
        if (!adminStatus) {
            throw new Error('Admin privileges required to approve matches');
        }

        const pendingMatchRef = doc(db, 'pendingMatches', reportId);
        const reportSnapshot = await getDoc(pendingMatchRef);

        if (!reportSnapshot.exists()) {
            throw new Error('Match report not found');
        }

        const reportData = reportSnapshot.data();
        
        // Get players with complete error handling
        const [winnerQuery, loserQuery] = await Promise.all([
            getDocs(query(collection(db, 'players'), where('username', '==', reportData.winnerUsername))),
            getDocs(query(collection(db, 'players'), where('username', '==', reportData.loserUsername)))
        ]);

        if (winnerQuery.empty || loserQuery.empty) {
            throw new Error('Could not find player documents');
        }

        const winner = {
            id: winnerQuery.docs[0].id,
            ...winnerQuery.docs[0].data()
        };

        const loser = {
            id: loserQuery.docs[0].id,
            ...loserQuery.docs[0].data()
        };

        // Update ELO ratings first
        await updateEloRatings(winner, loser, reportId);

        // Create approved match with all required fields
        await setDoc(doc(db, 'approvedMatches', reportId), {
            ...reportData,
            winnerScore,
            winnerComment,
            winnerSuicides,
            approved: true,
            approvedAt: serverTimestamp(),
            approvedBy: currentUser.email
        });

        // Delete pending match after successful approval
        await deleteDoc(pendingMatchRef);
        
        return true;
    } catch (error) {
        console.error('Error in approveReport:', error);
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

function isValidEloUpdate(currentData, newData) {
  return typeof newData.eloRating === 'number' &&
         typeof currentData.eloRating === 'number' &&
         (newData.eloRating - currentData.eloRating) <= 32 &&
         (newData.eloRating - currentData.eloRating) >= -32;
}