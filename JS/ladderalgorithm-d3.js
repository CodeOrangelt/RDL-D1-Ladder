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
    deleteDoc,
    writeBatch
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db, auth } from './firebase-config.js';
import { recordEloChangeD3 } from './elo-history-d3.js';
import { checkAndAwardTopRankRibbon } from './ribbons.js';

// EXACT SAME ELO calculation as D1/D2
export function calculateEloD3(winnerRating, loserRating, kFactor = 32) {
    const expectedScoreWinner = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
    const expectedScoreLoser = 1 / (1 + Math.pow(10, (winnerRating - loserRating) / 400));

    const newWinnerRating = winnerRating + kFactor * (1 - expectedScoreWinner);
    const newLoserRating = loserRating + kFactor * (0 - expectedScoreLoser);

    return {
        newWinnerRating: Math.round(newWinnerRating),
        newLoserRating: Math.round(newLoserRating)
    };
}

// EXACT SAME ELO update function as D1/D2
export async function updateEloRatingsD3(winnerId, loserId, matchId) {
    try {
        // Get batch instance
        const batch = writeBatch(db);

        // Get player references - using playersD3 collection
        const winnerRef = doc(db, 'playersD3', winnerId);
        const loserRef = doc(db, 'playersD3', loserId);

        // Get current player data
        const [winnerDoc, loserDoc] = await Promise.all([
            getDoc(winnerRef),
            getDoc(loserRef)
        ]);

        if (!winnerDoc.exists() || !loserDoc.exists()) {
            throw new Error('One or both D3 players not found');
        }

        const winnerData = winnerDoc.data();
        const loserData = loserDoc.data();

        // Store original positions
        const winnerPosition = winnerData.position || Number.MAX_SAFE_INTEGER;
        const loserPosition = loserData.position || Number.MAX_SAFE_INTEGER;

        // Store original ELO
        const winnerOldElo = winnerData.eloRating || 200;
        const loserOldElo = loserData.eloRating || 200;
        
        // Calculate match counts at time of match (BEFORE this match)
        const winnerMatchCount = (winnerData.wins || 0) + (winnerData.losses || 0);
        const loserMatchCount = (loserData.wins || 0) + (loserData.losses || 0);
        
        // Calculate win rates at time of match (BEFORE this match)
        const winnerWinRate = winnerMatchCount > 0 ? ((winnerData.wins || 0) / winnerMatchCount * 100) : 0;
        const loserWinRate = loserMatchCount > 0 ? ((loserData.wins || 0) / loserMatchCount * 100) : 0;

        // Calculate new ELO ratings - SAME AS D1/D2
        const { newWinnerRating, newLoserRating } = calculateEloD3(
            winnerOldElo,
            loserOldElo
        );

        // Handle position updating based on ladder rules - SAME AS D1/D2
        let newWinnerPosition = winnerPosition;
        let newLoserPosition = loserPosition;

        if (winnerPosition > loserPosition) {
            // Winner was ranked lower than loser, so winner moves up
            console.log('D3 Position swap needed - winner was lower ranked');

            // Winner takes loser's position
            newWinnerPosition = loserPosition;

            // Loser moves down one spot
            newLoserPosition = loserPosition + 1;

            // Move everyone else between the old positions down one spot
            const playersToUpdate = query(
                collection(db, 'playersD3'),
                where('position', '>', loserPosition),
                where('position', '<', winnerPosition)
            );

            const playersSnapshot = await getDocs(playersToUpdate);
            for (const playerDoc of playersSnapshot.docs) {
                if (playerDoc.id !== winnerId && playerDoc.id !== loserId) {
                    batch.update(doc(db, 'playersD3', playerDoc.id), {
                        position: playerDoc.data().position + 1
                    });
                }
            }
        } else {
            // Winner was already ranked higher than loser, positions stay the same
            console.log('D3 Winner already ranked higher - keeping positions');
        }

        // Update the documents with the limited field set - SAME AS D1/D2
        batch.update(winnerRef, {
            eloRating: newWinnerRating,
            lastMatchDate: serverTimestamp(),
            position: newWinnerPosition,
            lastMatchId: matchId
        });

        batch.update(loserRef, {
            eloRating: newLoserRating,
            lastMatchDate: serverTimestamp(),
            position: newLoserPosition,
            lastMatchId: matchId
        });

        // Commit the batch
        await batch.commit();

        console.log('D3 ELO ratings updated successfully');

        // Create shared timestamp for both ELO history entries
        const matchTimestamp = serverTimestamp();

        // Create ELO history entries using D3-specific function - SAME PATTERN AS D1/D2
        await Promise.all([
            recordEloChangeD3({
                playerId: winnerId,
                previousElo: winnerOldElo,
                newElo: newWinnerRating,
                opponentId: loserId,
                matchResult: 'win',
                previousPosition: winnerPosition,
                newPosition: newWinnerPosition,
                isPromotion: newWinnerPosition < winnerPosition,
                matchId: matchId,
                timestamp: matchTimestamp,  // ✅ SHARED timestamp
                matchCount: winnerMatchCount,  // ✅ Pass actual match count
                winRate: winnerWinRate  // ✅ Pass actual win rate
            }),
            recordEloChangeD3({
                playerId: loserId,
                previousElo: loserOldElo,
                newElo: newLoserRating,
                opponentId: winnerId,
                matchResult: 'loss',
                previousPosition: loserPosition,
                newPosition: newLoserPosition,
                isDemotion: newLoserPosition > loserPosition,
                matchId: matchId,
                timestamp: matchTimestamp,  // ✅ SHARED timestamp
                matchCount: loserMatchCount,  // ✅ Pass actual match count
                winRate: loserWinRate  // ✅ Pass actual win rate
            })
        ]);

        return true;

    } catch (error) {
        console.error('Error in updateEloRatingsD3:', error);
        throw error;
    }
}

// EXACT SAME match approval function as D1/D2
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

        // Get the pending match - using pendingMatchesD3 collection
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

        // Move match to approved collection first - using approvedMatchesD3 collection
        await setDoc(doc(db, 'approvedMatchesD3', reportId), updatedReportData);
        await deleteDoc(pendingMatchRef);

        console.log('D3 Match moved to approved collection');

        // Get player IDs - using D3-specific player collection
        const [winnerDocs, loserDocs] = await Promise.all([
            getDocs(query(collection(db, 'playersD3'), where('username', '==', reportData.winnerUsername))),
            getDocs(query(collection(db, 'playersD3'), where('username', '==', reportData.loserUsername)))
        ]);

        if (winnerDocs.empty || loserDocs.empty) {
            throw new Error('Could not find D3 player documents');
        }

        const winnerId = winnerDocs.docs[0].id;
        const loserId = loserDocs.docs[0].id;
        
        // Get player data BEFORE updating ELO for match stats
        const winnerData = winnerDocs.docs[0].data();
        const loserData = loserDocs.docs[0].data();
        
        // Store pre-match ELO values
        const winnerOldElo = winnerData.eloRating || 200;
        const loserOldElo = loserData.eloRating || 200;
        
        // Calculate match counts and win rates at time of match (BEFORE this match)
        const winnerMatchCount = (winnerData.wins || 0) + (winnerData.losses || 0);
        const loserMatchCount = (loserData.wins || 0) + (loserData.losses || 0);
        const winnerWinRate = winnerMatchCount > 0 ? ((winnerData.wins || 0) / winnerMatchCount * 100) : 0;
        const loserWinRate = loserMatchCount > 0 ? ((loserData.wins || 0) / loserMatchCount * 100) : 0;

        // Update ELO ratings using D3-specific function
        await updateEloRatingsD3(winnerId, loserId, reportId);
        
        // Get new ELO after updating
        const [updatedWinnerDoc, updatedLoserDoc] = await Promise.all([
            getDoc(doc(db, 'playersD3', winnerId)),
            getDoc(doc(db, 'playersD3', loserId))
        ]);
        const winnerNewElo = updatedWinnerDoc.data().eloRating;
        const loserNewElo = updatedLoserDoc.data().eloRating;
        
        // Update the approved match document with ELO data and match stats
        await setDoc(doc(db, 'approvedMatchesD3', reportId), {
            ...updatedReportData,
            winnerOldElo: winnerOldElo,
            loserOldElo: loserOldElo,
            losersOldElo: loserOldElo,
            winnerNewElo: winnerNewElo,
            loserNewElo: loserNewElo,
            winnerEloChange: winnerNewElo - winnerOldElo,
            loserEloChange: loserNewElo - loserOldElo,
            // Store match stats for Emerald rank detection
            winnerMatchCount: winnerMatchCount,
            loserMatchCount: loserMatchCount,
            winnerWinRate: winnerWinRate,
            loserWinRate: loserWinRate
        });

        // Check and award Top Rank ribbon to the winner if they reached #1 in their rank
        try {
            await checkAndAwardTopRankRibbon(reportData.winnerUsername, 'D3');
            console.log(`Checked Top Rank ribbon for D3 winner: ${reportData.winnerUsername}`);
        } catch (ribbonError) {
            console.warn('Top Rank ribbon check failed, but match approval continues:', ribbonError);
        }

        console.log('D3 Match successfully approved and ELO updated');
        return true;

    } catch (error) {
        console.error('Error in approveReportD3:', error);
        throw error;
    }
}//