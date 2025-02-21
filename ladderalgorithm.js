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
        // Calculate new ratings with fallback to default 1200
        const { newWinnerRating, newLoserRating } = calculateElo(
            winner.eloRating || 1200, 
            loser.eloRating || 1200
        );

        // First update ELO history since it has less restrictive rules
        const historyBatch = writeBatch(db);
        const winnerHistoryRef = doc(collection(db, 'eloHistory'));
        const loserHistoryRef = doc(collection(db, 'eloHistory'));

        // Add winner history entry
        historyBatch.set(winnerHistoryRef, {
            type: 'match',
            player: winner.username,
            opponent: loser.username,
            previousElo: winner.eloRating || 1200,
            newElo: newWinnerRating,
            change: newWinnerRating - (winner.eloRating || 1200),
            matchResult: 'win',
            previousPosition: winner.position || 1,
            newPosition: winner.position || 1,
            timestamp: serverTimestamp()
        });

        // Add loser history entry
        historyBatch.set(loserHistoryRef, {
            type: 'match',
            player: loser.username,
            opponent: winner.username,
            previousElo: loser.eloRating || 1200,
            newElo: newLoserRating,
            change: newLoserRating - (loser.eloRating || 1200),
            matchResult: 'loss',
            previousPosition: loser.position || 2,
            newPosition: loser.position || 2,
            timestamp: serverTimestamp()
        });

        // Commit history updates first
        await historyBatch.commit();

        // Then update player documents with EXACTLY the fields required by security rules
        const playerBatch = writeBatch(db);

        // Winner update
        playerBatch.update(doc(db, 'players', winner.id), {
            eloRating: newWinnerRating,
            lastMatchDate: serverTimestamp(),
            position: winner.position || 1
        });

        // Loser update
        playerBatch.update(doc(db, 'players', loser.id), {
            eloRating: newLoserRating,
            lastMatchDate: serverTimestamp(),
            position: loser.position || 2
        });

        // Commit player updates
        await playerBatch.commit();

        return true;
    } catch (error) {
        console.error("Error in updateEloRatings:", error);
        throw error;
    }
}

export async function approveReport(reportId, winnerScore, winnerSuicides, winnerComment) {
    try {
        console.log('Starting approveReport with ID:', reportId);
        
        const currentUser = auth.currentUser;
        if (!currentUser) {
            throw new Error('You must be logged in to approve matches');
        }

        // Get the pending match first
        const pendingMatchRef = doc(db, 'pendingMatches', reportId);
        const reportSnapshot = await getDoc(pendingMatchRef);

        if (!reportSnapshot.exists()) {
            console.error('Report not found:', reportId);
            throw new Error('Match report not found');
        }

        const reportData = reportSnapshot.data();
        
        // Get player documents
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

        // First update ELO ratings
        await updateEloRatings(winner, loser, reportId);

        // Then move the match to approved collection
        const batch = writeBatch(db);
        
        batch.set(doc(db, 'approvedMatches', reportId), {
            ...reportData,
            winnerScore,
            winnerComment,
            winnerSuicides,
            approved: true,
            approvedAt: serverTimestamp(),
            approvedBy: currentUser.email
        });
        
        batch.delete(pendingMatchRef);
        
        await batch.commit();
        
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