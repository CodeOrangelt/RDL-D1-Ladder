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
        const { newWinnerRating, newLoserRating } = calculateElo(
            winner.eloRating || 1200, 
            loser.eloRating || 1200
        );

        // Create batch updates
        const batch = writeBatch(db);

        // Update winner document with EXACTLY the required fields from security rules
        const winnerUpdate = {
            eloRating: newWinnerRating,
            lastMatchDate: serverTimestamp(),
            position: winner.position || 1
        };

        // Update loser document with EXACTLY the required fields from security rules
        const loserUpdate = {
            eloRating: newLoserRating,
            lastMatchDate: serverTimestamp(),
            position: loser.position || 2
        };

        // Apply updates
        batch.update(doc(db, 'players', winner.id), winnerUpdate);
        batch.update(doc(db, 'players', loser.id), loserUpdate);

        // Add ELO history entry with all required fields
        const winnerHistoryRef = doc(collection(db, 'eloHistory'));
        batch.set(winnerHistoryRef, {
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

        // Commit all changes
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

        // Get player documents with their full data
        const [winnerDocs, loserDocs] = await Promise.all([
            getDocs(query(collection(db, 'players'), where('username', '==', reportData.winnerUsername))),
            getDocs(query(collection(db, 'players'), where('username', '==', reportData.loserUsername)))
        ]);

        if (winnerDocs.empty || loserDocs.empty) {
            throw new Error('Could not find player documents');
        }

        const winner = {
            id: winnerDocs.docs[0].id,
            ...winnerDocs.docs[0].data()
        };

        const loser = {
            id: loserDocs.docs[0].id,
            ...loserDocs.docs[0].data()
        };

        // Move match to approved collection
        const updatedReportData = {
            ...reportData,
            winnerScore: winnerScore,
            winnerSuicides: winnerSuicides,
            winnerComment: winnerComment,
            approved: true,
            approvedAt: serverTimestamp(),
            approvedBy: currentUsername
        };

        // Use batch write for consistency
        const batch = writeBatch(db);
        
        // Add to approved matches
        batch.set(doc(db, 'approvedMatches', reportId), updatedReportData);
        
        // Remove from pending matches
        batch.delete(pendingMatchRef);
        
        // Commit these changes first
        await batch.commit();

        // Update ELO ratings with full player objects
        await updateEloRatings(winner, loser, reportId);

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