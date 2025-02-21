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

export async function updateEloRatings(winner, loser, matchId) {
    try {
        // Calculate new ELO ratings
        const { newWinnerRating, newLoserRating } = calculateElo(
            winner.eloRating, 
            loser.eloRating
        );

        // Create the update objects first
        const winnerUpdates = {
            eloRating: newWinnerRating,
            lastMatchDate: serverTimestamp(),
            position: winner.position
        };

        const loserUpdates = {
            eloRating: newLoserRating,
            lastMatchDate: serverTimestamp(),
            position: loser.position
        };

        // Create batch updates
        const batch = writeBatch(db);

        // Update winner document
        batch.update(doc(db, 'players', winner.id), winnerUpdates);

        // Update loser document
        batch.update(doc(db, 'players', loser.id), loserUpdates);

        // Add ELO history entries
        const winnerHistoryRef = doc(collection(db, 'eloHistory'));
        const loserHistoryRef = doc(collection(db, 'eloHistory'));

        batch.set(winnerHistoryRef, {
            type: 'match',
            player: winner.username,
            opponent: loser.username,
            previousElo: winner.eloRating,
            newElo: newWinnerRating,
            change: newWinnerRating - winner.eloRating,
            matchResult: 'win',
            previousPosition: winner.position,
            newPosition: winnerUpdates.position,
            timestamp: serverTimestamp(),
            matchId: matchId
        });

        batch.set(loserHistoryRef, {
            type: 'match',
            player: loser.username,
            opponent: winner.username,
            previousElo: loser.eloRating,
            newElo: newLoserRating,
            change: newLoserRating - loser.eloRating,
            matchResult: 'loss',
            previousPosition: loser.position,
            newPosition: loserUpdates.position,
            timestamp: serverTimestamp(),
            matchId: matchId
        });

        // Commit the batch
        await batch.commit();

    } catch (error) {
        console.error("Error in updateEloRatings:", error);
        throw error;
    }
}

export async function approveReport(reportId, winnerScore, winnerSuicides, winnerComment) {
    try {
        console.log('Starting approveReport function with:', { reportId, winnerScore, winnerSuicides, winnerComment });
        
        const currentUser = auth.currentUser;
        if (!currentUser) {
            console.log('No user logged in');
            throw new Error('You must be logged in to approve matches');
        }
        console.log('Current user:', currentUser.email);

        // Get user's player document to verify permissions
        const userDoc = await getDoc(doc(db, 'players', currentUser.uid));
        const currentUsername = userDoc.exists() ? userDoc.data().username : null;
        console.log('Current username:', currentUsername);

        // Get the pending match
        const pendingMatchRef = doc(db, 'pendingMatches', reportId);
        const reportSnapshot = await getDoc(pendingMatchRef);

        if (!reportSnapshot.exists()) {
            console.log('Report not found with ID:', reportId);
            throw new Error('Match report not found');
        }

        const reportData = reportSnapshot.data();
        console.log('Report data:', reportData);
        
        // Check if user is participant or admin
        const isParticipant = currentUsername === reportData.winnerUsername || 
                             currentUsername === reportData.loserUsername;
        const userIsAdmin = await isAdmin(currentUser.email);

        if (!isParticipant && !userIsAdmin) {
            throw new Error('Only match participants or admins can approve matches');
        }

        // Add winner details to report data
        const updatedReportData = {
            ...reportData,
            winnerScore: winnerScore,
            winnerSuicides: winnerSuicides,
            winnerComment: winnerComment,
            approved: true,
            approvedAt: serverTimestamp(),
            approvedBy: currentUsername
        };

        // Move match to approved collection first
        await setDoc(doc(db, 'approvedMatches', reportId), updatedReportData);
        await deleteDoc(pendingMatchRef);

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

        console.log('Match successfully approved and ELO updated');
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