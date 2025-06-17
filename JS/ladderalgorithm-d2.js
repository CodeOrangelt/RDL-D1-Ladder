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
import firebaseIdle from './firebase-idle-wrapper.js';

// Same ELO calculation formula as D1
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

// D2-specific ELO update function
export async function updateEloRatingsD2(winnerId, loserId, matchId) {
    try {
        // Get batch instance
        const batch = writeBatch(db);
        
        // Get player references - note the collection is playersD2
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
        const { newWinnerRating, newLoserRating } = calculateEloD2(
            winnerData.eloRating || 1200,
            loserData.eloRating || 1200
        );

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
            // Winner was already ranked higher than loser, positions stay the same
            console.log('D2 Winner already ranked higher - keeping positions');
        }

        // Add the same streak logic to D2 algorithm (around line 120)

        // Handle #1 position streak tracking
        if (newWinnerPosition === 1) {
            // New champion - start their streak
            batch.update(winnerRef, {
                firstPlaceDate: serverTimestamp(),
                streakDays: 1
            });
            
            console.log(`D2: ${winnerData.username} is now #1 - starting streak tracking`);
        } else {
            // Winner didn't reach #1, clear any existing streak data
            batch.update(winnerRef, {
                firstPlaceDate: null,
                streakDays: 0
            });
        }

        // If loser was displaced from #1, reset their streak
        if (loserPosition === 1 && newLoserPosition > 1) {
            batch.update(loserRef, {
                firstPlaceDate: null,
                streakDays: 0
            });
            
            console.log(`D2: ${loserData.username} lost #1 position - streak reset`);
        }

        // Update the documents with the limited field set
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
        
        console.log('D2 ELO ratings updated successfully');
        
        // Create ELO history entries using D2-specific function
        await Promise.all([
            recordEloChangeD2({
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
            recordEloChangeD2({
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

        // Record promotions/demotions with D2 source
        await promotionManager.checkAndRecordPromotion(winnerId, newWinnerRating, winnerData.eloRating, {
            source: 'match-d2',
            matchId: matchId
        });

        await promotionManager.checkAndRecordPromotion(loserId, newLoserRating, loserData.eloRating, {
            source: 'match-d2',
            matchId: matchId
        });

        return true;
    } catch (error) {
        console.error('Error in updateEloRatingsD2:', error);
        throw error;
    }
}

// D2-specific match approval function
export async function approveReportD2(reportId, winnerScore, winnerSuicides, winnerComment) {
    try {
        console.log('Starting approveReportD2 function with:', { reportId, winnerScore, winnerSuicides, winnerComment });
        
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

        // Get the pending match - using pendingMatchesD2 collection
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

        // Move match to approved collection first - using approvedMatchesD2 collection
        await setDoc(doc(db, 'approvedMatchesD2', reportId), updatedReportData);
        await deleteDoc(pendingMatchRef);

        console.log('D2 Match moved to approved collection');

        // Get player IDs - using D2-specific player collection
        const [winnerDocs, loserDocs] = await Promise.all([
            getDocs(query(collection(db, 'playersD2'), where('username', '==', reportData.winnerUsername))),
            getDocs(query(collection(db, 'playersD2'), where('username', '==', reportData.loserUsername)))
        ]);

        if (winnerDocs.empty || loserDocs.empty) {
            throw new Error('Could not find D2 player documents');
        }

        const winnerId = winnerDocs.docs[0].id;
        const loserId = loserDocs.docs[0].id;

        // Update ELO ratings using D2-specific function
        await updateEloRatingsD2(winnerId, loserId, reportId);

        console.log('D2 Match successfully approved and ELO updated');
        return true;

    } catch (error) {
        console.error('Error in approveReportD2:', error);
        throw error;
    }
}