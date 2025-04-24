import { 
    addDoc, 
    updateDoc, 
    serverTimestamp, 
    collection, 
    doc, 
    getDoc, 
    getDocs, 
    query,
    where,
    setDoc,
    deleteDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db, auth } from './firebase-config.js';

// Export the approveReport function for D3
export async function approveReportD3(reportId, winnerScore, winnerSuicides, winnerComment) {
    try {
        console.log('Starting approveReportD3 function with:', { reportId, winnerScore, winnerSuicides, winnerComment });
        
        const currentUser = auth.currentUser;
        if (!currentUser) {
            console.log('No user logged in');
            throw new Error('You must be logged in to approve D3 matches');
        }
        console.log('Current user:', currentUser.email);

        // Get user's player document
        const userDoc = await getDoc(doc(db, 'playersD3', currentUser.uid));
        const currentUsername = userDoc.exists() ? userDoc.data().username : null;
        console.log('Current username:', currentUsername);

        // Get the pending match
        const pendingMatchRef = doc(db, 'pendingMatchesD3', reportId);
        const reportSnapshot = await getDoc(pendingMatchRef);

        if (!reportSnapshot.exists()) {
            console.log('D3 Report not found with ID:', reportId);
            throw new Error('D3 match report not found');
        }

        const reportData = reportSnapshot.data();
        console.log('D3 Report data:', reportData);
        
        // Check if user is the winner
        if (currentUsername !== reportData.winnerUsername) {
            throw new Error('Only the winner can approve D3 matches');
        }

        // Add winner details to report data
        const updatedReportData = {
            ...reportData,
            winnerScore: winnerScore,
            winnerSuicides: winnerSuicides,
            winnerComment: winnerComment,
            approved: true,
            approvedAt: serverTimestamp(),
            approvedBy: currentUsername,
            createdAt: reportData.createdAt || serverTimestamp(),
            winnerUsername: reportData.winnerUsername,
            loserUsername: reportData.loserUsername
        };

        // Move match to approved collection first
        await setDoc(doc(db, 'approvedMatchesD3', reportId), updatedReportData);
        await deleteDoc(pendingMatchRef);

        console.log('D3 Match moved to approved collection');

        // Get player IDs
        const [winnerDocs, loserDocs] = await Promise.all([
            getDocs(query(collection(db, 'playersD3'), where('username', '==', reportData.winnerUsername))),
            getDocs(query(collection(db, 'playersD3'), where('username', '==', reportData.loserUsername)))
        ]);

        if (winnerDocs.empty || loserDocs.empty) {
            throw new Error('Could not find D3 player documents');
        }

        const winnerId = winnerDocs.docs[0].id;
        const loserId = loserDocs.docs[0].id;

        // Update ELO ratings
        await updateEloRatingsD3(winnerId, loserId, reportId);

        console.log('D3 Match successfully approved and ELO updated');
        return true;

    } catch (error) {
        console.error('Error in approveReportD3:', error);
        throw error;
    }
}

// Helper function to update ELO ratings specific to D3
async function updateEloRatingsD3(winnerId, loserId, matchId) {
    try {
        const [winnerDoc, loserDoc, matchDoc] = await Promise.all([
            getDoc(doc(db, 'playersD3', winnerId)),
            getDoc(doc(db, 'playersD3', loserId)),
            getDoc(doc(db, 'approvedMatchesD3', matchId))
        ]);
        
        if (!winnerDoc.exists() || !loserDoc.exists() || !matchDoc.exists()) {
            throw new Error('One or more documents not found');
        }
        
        const winnerData = winnerDoc.data();
        const loserData = loserDoc.data();
        const matchData = matchDoc.data();
        
        const winnerCurrentElo = parseFloat(winnerData.eloRating) || 1200;
        const loserCurrentElo = parseFloat(loserData.eloRating) || 1200;
        
        const winnerScore = parseInt(matchData.winnerScore) || 20;
        const loserScore = parseInt(matchData.loserScore) || 0;
        
        // Calculate new ELO ratings
        const [winnerNewElo, loserNewElo] = calculateEloChange(
            winnerCurrentElo, loserCurrentElo, winnerScore, loserScore
        );
        
        // Update players with new ELO ratings
        await Promise.all([
            updateDoc(doc(db, 'playersD3', winnerId), {
                eloRating: winnerNewElo,
                wins: (winnerData.wins || 0) + 1,
                lastEloChange: winnerNewElo - winnerCurrentElo,
                lastMatch: serverTimestamp()
            }),
            updateDoc(doc(db, 'playersD3', loserId), {
                eloRating: loserNewElo,
                losses: (loserData.losses || 0) + 1,
                lastEloChange: loserNewElo - loserCurrentElo,
                lastMatch: serverTimestamp()
            })
        ]);
        
        // Record ELO history for both players
        await Promise.all([
            addDoc(collection(db, 'eloHistoryD3'), {
                player: winnerData.username,
                previousElo: winnerCurrentElo,
                newElo: winnerNewElo,
                change: winnerNewElo - winnerCurrentElo,
                timestamp: serverTimestamp(),
                type: 'match_win',
                opponent: loserData.username,
                gameMode: 'D3'
            }),
            addDoc(collection(db, 'eloHistoryD3'), {
                player: loserData.username,
                previousElo: loserCurrentElo,
                newElo: loserNewElo,
                change: loserNewElo - loserCurrentElo,
                timestamp: serverTimestamp(),
                type: 'match_loss',
                opponent: winnerData.username,
                gameMode: 'D3'
            })
        ]);
        
        // Update match with ELO data
        await updateDoc(doc(db, 'approvedMatchesD3', matchId), {
            winnerPreviousElo: winnerCurrentElo,
            loserPreviousElo: loserCurrentElo,
            winnerNewElo: winnerNewElo,
            loserNewElo: loserNewElo,
            winnerEloChange: winnerNewElo - winnerCurrentElo,
            loserEloChange: loserNewElo - loserCurrentElo
        });
        
        // Check for promotion/demotion thresholds
        await checkRankChanges(winnerData, winnerCurrentElo, winnerNewElo, 'D3');
        await checkRankChanges(loserData, loserCurrentElo, loserNewElo, 'D3');
        
        // Lastly, update player positions if needed
        await import('./ladderd3.js').then(module => {
            if (typeof module.updatePlayerPositions === 'function') {
                return module.updatePlayerPositions(winnerData.username, loserData.username);
            } else {
                console.error("updatePlayerPositions function not found in ladderd3.js");
            }
        }).catch(error => {
            console.error("Error importing ladderd3.js:", error);
        });
        
    } catch (error) {
        console.error('Error updating ELO ratings:', error);
        throw error;
    }
}

// ELO calculation function for D3 ladder
function calculateEloChange(winnerElo, loserElo, winnerScore, loserScore) {
    const K = 32; // K-factor
    
    // Calculate expected scores
    const expectedWinner = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
    const expectedLoser = 1 - expectedWinner;
    
    // Apply score differential bonus (optional)
    let scoreFactor = 1;
    if (winnerScore > 0 && loserScore > 0) {
        const ratio = winnerScore / Math.max(loserScore, 1);
        if (ratio >= 2) scoreFactor = 1.25; // 25% bonus for dominating win
    }
    
    // Calculate ELO changes
    const winnerChange = Math.round(K * (1 - expectedWinner) * scoreFactor);
    const loserChange = -Math.round(K * (0 - expectedLoser) * scoreFactor);
    
    const newWinnerElo = Math.round(winnerElo + winnerChange);
    const newLoserElo = Math.max(1000, Math.round(loserElo + loserChange)); // Floor of 1000
    
    return [newWinnerElo, newLoserElo];
}

// Check for rank changes (promotion/demotion)
async function checkRankChanges(playerData, oldElo, newElo, gameMode) {
    // Define tier thresholds
    const tiers = [
        { name: 'Bronze', threshold: 1400 },
        { name: 'Silver', threshold: 1600 },
        { name: 'Gold', threshold: 1800 },
        { name: 'Emerald', threshold: 2000 }
    ];
    
    // Determine old and new tiers
    const oldTier = tiers.filter(tier => oldElo >= tier.threshold).pop() || { name: 'Unranked', threshold: 0 };
    const newTier = tiers.filter(tier => newElo >= tier.threshold).pop() || { name: 'Unranked', threshold: 0 };
    
    // If tier changed, record the event
    if (oldTier.name !== newTier.name) {
        const isPromotion = newTier.threshold > oldTier.threshold;
        
        await addDoc(collection(db, 'eloHistoryD3'), {
            player: playerData.username,
            previousElo: oldElo,
            newElo: newElo,
            rankAchieved: newTier.name,
            timestamp: serverTimestamp(),
            type: isPromotion ? 'promotion' : 'demotion',
            gameMode: gameMode
        });
        
        console.log(`Player ${playerData.username} ${isPromotion ? 'promoted' : 'demoted'} to ${newTier.name}`);
    }
}