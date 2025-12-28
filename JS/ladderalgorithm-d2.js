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
import { recordEloChangeD2 } from './elo-history-d2.js';
import { promotionManager } from './promotions.js';
import { checkAndAwardTopRankRibbon } from './ribbons.js';

// ===================================
// ELO CALCULATION - Same formula as D1
// ===================================
export function calculateEloD2(winnerRating, loserRating, kFactor = 32) {
    const expectedScoreWinner = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
    const expectedScoreLoser = 1 / (1 + Math.pow(10, (winnerRating - loserRating) / 400));

    const newWinnerRating = winnerRating + kFactor * (1 - expectedScoreWinner);
    const newLoserRating = loserRating + kFactor * (0 - expectedScoreLoser);

    return {
        newWinnerRating: Math.round(newWinnerRating),
        newLoserRating: Math.round(newLoserRating)
    };
}

// ===================================
// ELO UPDATE FUNCTION
// ===================================
export async function updateEloRatingsD2(winnerId, loserId, matchId) {
    try {
        const batch = writeBatch(db);

        // Get player references
        const winnerRef = doc(db, 'playersD2', winnerId);
        const loserRef = doc(db, 'playersD2', loserId);

        // Get current player data
        const [winnerDoc, loserDoc] = await Promise.all([
            getDoc(winnerRef),
            getDoc(loserRef)
        ]);

        if (!winnerDoc.exists() || !loserDoc.exists()) {
            throw new Error('One or both D2 players not found');
        }

        const winnerData = winnerDoc.data();
        const loserData = loserDoc.data();

        // Store original positions
        const winnerPosition = winnerData.position || Number.MAX_SAFE_INTEGER;
        const loserPosition = loserData.position || Number.MAX_SAFE_INTEGER;

        // Calculate new ELO ratings
        const winnerOldElo = winnerData.eloRating || 200;
        const loserOldElo = loserData.eloRating || 200;
        
        // Calculate match counts at time of match (BEFORE this match)
        const winnerMatchCount = (winnerData.wins || 0) + (winnerData.losses || 0);
        const loserMatchCount = (loserData.wins || 0) + (loserData.losses || 0);
        
        // Calculate win rates at time of match (BEFORE this match)
        const winnerWinRate = winnerMatchCount > 0 ? ((winnerData.wins || 0) / winnerMatchCount * 100) : 0;
        const loserWinRate = loserMatchCount > 0 ? ((loserData.wins || 0) / loserMatchCount * 100) : 0;
        
        const { newWinnerRating, newLoserRating } = calculateEloD2(winnerOldElo, loserOldElo);

        // Handle position updating based on ladder rules
        let newWinnerPosition = winnerPosition;
        let newLoserPosition = loserPosition;

        if (winnerPosition > loserPosition) {
            // Winner was ranked lower than loser, so winner moves up
            console.log('D2 Position swap needed - winner was lower ranked');

            // Winner takes loser's position
            newWinnerPosition = loserPosition;

            // Loser moves down one spot
            newLoserPosition = loserPosition + 1;

            // Move everyone else between the old positions down one spot
            const playersToUpdate = query(
                collection(db, 'playersD2'),
                where('position', '>', loserPosition),
                where('position', '<', winnerPosition)
            );

            const playersSnapshot = await getDocs(playersToUpdate);
            for (const playerDoc of playersSnapshot.docs) {
                if (playerDoc.id !== winnerId && playerDoc.id !== loserId) {
                    batch.update(doc(db, 'playersD2', playerDoc.id), {
                        position: playerDoc.data().position + 1
                    });
                }
            }
        } else {
            console.log('D2 Winner already ranked higher - keeping positions');
        }

        // Update winner document
        batch.update(winnerRef, {
            eloRating: newWinnerRating,
            lastMatchDate: serverTimestamp(),
            position: newWinnerPosition,
            lastMatchId: matchId
        });

        // Update loser document
        batch.update(loserRef, {
            eloRating: newLoserRating,
            lastMatchDate: serverTimestamp(),
            position: newLoserPosition,
            lastMatchId: matchId
        });

        // Commit the batch
        await batch.commit();

        console.log('D2 ELO ratings updated successfully');

        // Create shared timestamp for both ELO history entries
        const matchTimestamp = serverTimestamp();

        // Create ELO history entries with shared timestamp
        await Promise.all([
            recordEloChangeD2({
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
            recordEloChangeD2({
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

        // Record promotions/demotions
        await promotionManager.checkAndRecordPromotion(winnerId, newWinnerRating, winnerOldElo, {
            source: 'match-d2',
            matchId: matchId
        });

        await promotionManager.checkAndRecordPromotion(loserId, newLoserRating, loserOldElo, {
            source: 'match-d2',
            matchId: matchId
        });

        return true;
    } catch (error) {
        console.error('Error in updateEloRatingsD2:', error);
        throw error;
    }
}

function getDisplayElo(elo, timestamp) {
    const cutoffDate = new Date('2025-12-02T00:00:00');
    let matchDate = null;
    
    if (timestamp) {
        if (timestamp.toDate) {
            matchDate = timestamp.toDate();
        } else if (timestamp.seconds) {
            matchDate = new Date(timestamp.seconds * 1000);
        } else if (timestamp instanceof Date) {
            matchDate = timestamp;
        }
    }
    
    // If match is before cutoff date, subtract 600 for display
    if (matchDate && matchDate < cutoffDate) {
        return Math.max(0, (Number(elo) || 0) - 600);
    }
    
    return Number(elo) || 0;
}

// ===================================
// MATCH APPROVAL FUNCTION
// ===================================
export async function approveReportD2(reportId, winnerScore, winnerSuicides, winnerComment) {
    try {
        console.log('Starting approveReportD2 function with:', { reportId, winnerScore, winnerSuicides, winnerComment });

        // Verify user is logged in
        const currentUser = auth.currentUser;
        if (!currentUser) {
            console.log('No user logged in');
            throw new Error('You must be logged in to approve D2 matches');
        }
        console.log('Current user:', currentUser.email);

        // Get user's player document
        const userDoc = await getDoc(doc(db, 'playersD2', currentUser.uid));
        const currentUsername = userDoc.exists() ? userDoc.data().username : null;
        console.log('Current username:', currentUsername);

        // Get the pending match
        const pendingMatchRef = doc(db, 'pendingMatchesD2', reportId);
        const reportSnapshot = await getDoc(pendingMatchRef);

        if (!reportSnapshot.exists()) {
            console.log('D2 Report not found with ID:', reportId);
            throw new Error('D2 match report not found');
        }

        const reportData = reportSnapshot.data();
        console.log('D2 Report data:', reportData);

        // Check if user is the winner
        if (currentUsername !== reportData.winnerUsername) {
            throw new Error('Only the winner can approve D2 matches');
        }

        // Get player documents BEFORE updating ELO
        const [winnerDocs, loserDocs] = await Promise.all([
            getDocs(query(collection(db, 'playersD2'), where('username', '==', reportData.winnerUsername))),
            getDocs(query(collection(db, 'playersD2'), where('username', '==', reportData.loserUsername)))
        ]);

        if (winnerDocs.empty || loserDocs.empty) {
            throw new Error('Could not find D2 player documents');
        }

        const winnerId = winnerDocs.docs[0].id;
        const loserId = loserDocs.docs[0].id;
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

        // Calculate new ELO values
        const { newWinnerRating, newLoserRating } = calculateEloD2(winnerOldElo, loserOldElo);

        // Build the approved match document with ALL ELO values
        const approvedMatchData = {
            ...reportData,
            winnerScore: winnerScore,
            winnerSuicides: winnerSuicides,
            winnerComment: winnerComment,
            approved: true,
            approvedAt: serverTimestamp(),
            approvedBy: currentUsername,
            createdAt: reportData.createdAt || serverTimestamp(),
            winnerUsername: reportData.winnerUsername,
            loserUsername: reportData.loserUsername,
            winnerId: winnerId,
            loserId: loserId,
            // Store ELO values - matching D1/D3 field names
            winnerOldElo: winnerOldElo,
            loserOldElo: loserOldElo,
            losersOldElo: loserOldElo,  // Legacy field name for compatibility
            winnerNewElo: newWinnerRating,
            loserNewElo: newLoserRating,
            winnerEloChange: newWinnerRating - winnerOldElo,
            loserEloChange: newLoserRating - loserOldElo,
            // Store match stats for Emerald rank detection
            winnerMatchCount: winnerMatchCount,
            loserMatchCount: loserMatchCount,
            winnerWinRate: winnerWinRate,
            loserWinRate: loserWinRate
        };

        // Move match to approved collection
        await setDoc(doc(db, 'approvedMatchesD2', reportId), approvedMatchData);
        await deleteDoc(pendingMatchRef);

        console.log('D2 Match moved to approved collection');

        // Update ELO ratings
        await updateEloRatingsD2(winnerId, loserId, reportId);

        // Check and award Top Rank ribbon to the winner if they reached #1 in their rank
        try {
            await checkAndAwardTopRankRibbon(reportData.winnerUsername, 'D2');
            console.log(`Checked Top Rank ribbon for D2 winner: ${reportData.winnerUsername}`);
        } catch (ribbonError) {
            console.warn('Top Rank ribbon check failed, but match approval continues:', ribbonError);
        }

        console.log('D2 Match successfully approved and ELO updated');
        return true;

    } catch (error) {
        console.error('Error in approveReportD2:', error);
        throw error;
    }
}