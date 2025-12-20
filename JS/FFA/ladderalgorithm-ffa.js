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
import { db, auth } from '../firebase-config.js';
import firebaseIdle from '../firebase-idle-wrapper.js';

// ============================================
// FFA POINTS CONFIGURATION - EDIT THESE VALUES
// ============================================
// Points awarded per placement position
export const FFA_PLACEMENT_POINTS = {
    1: 100,   // 1st place
    2: 75,    // 2nd place
    3: 55,    // 3rd place
    4: 40,    // 4th place
    5: 30,    // 5th place
    6: 20,    // 6th place
    7: 15,    // 7th place
    8: 10,    // 8th place
    DEFAULT: 5 // 9th place and beyond
};

// ELO K-Factor adjustments based on placement
export const FFA_K_FACTORS = {
    BASE: 32,           // Base K-factor
    WINNER_BONUS: 1.5,  // Multiplier for 1st place
    TOP3_BONUS: 1.2,    // Multiplier for top 3
    BOTTOM_HALF: 0.8    // Multiplier for bottom half finishers
};

// ============================================
// ELO CALCULATION FOR FFA
// ============================================

/**
 * Calculate ELO changes for all participants in an FFA match
 * Uses a multi-ELO system where each player's rating is adjusted based on
 * their performance against all other players in the match
 * 
 * @param {Array} participants - Array of participant objects with username, placement, kills, deaths
 * @param {Map} playerRatings - Map of username to current ELO rating
 * @returns {Map} Map of username to new ELO rating
 */
export function calculateFFAElo(participants, playerRatings) {
    const newRatings = new Map();
    const numPlayers = participants.length;
    
    if (numPlayers < 2) {
        // Not enough players for ELO calculation
        participants.forEach(p => {
            newRatings.set(p.username, playerRatings.get(p.username) || 1000);
        });
        return newRatings;
    }

    participants.forEach(player => {
        const playerRating = playerRatings.get(player.username) || 1000;
        const playerPlacement = player.placement;
        let totalExpected = 0;
        let totalActual = 0;

        // Compare against each other player
        participants.forEach(opponent => {
            if (opponent.username === player.username) return;
            
            const opponentRating = playerRatings.get(opponent.username) || 1000;
            const opponentPlacement = opponent.placement;
            
            // Expected score based on ELO formula
            const expected = 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
            totalExpected += expected;
            
            // Actual score: 1 if player beat opponent, 0 if lost, 0.5 if tied
            if (playerPlacement < opponentPlacement) {
                totalActual += 1;
            } else if (playerPlacement === opponentPlacement) {
                totalActual += 0.5;
            }
            // else totalActual += 0 (player lost to opponent)
        });

        // Normalize by number of comparisons
        const comparisons = numPlayers - 1;
        const normalizedExpected = totalExpected / comparisons;
        const normalizedActual = totalActual / comparisons;

        // Determine K-factor based on placement
        let kFactor = FFA_K_FACTORS.BASE;
        if (playerPlacement === 1) {
            kFactor *= FFA_K_FACTORS.WINNER_BONUS;
        } else if (playerPlacement <= 3) {
            kFactor *= FFA_K_FACTORS.TOP3_BONUS;
        } else if (playerPlacement > Math.ceil(numPlayers / 2)) {
            kFactor *= FFA_K_FACTORS.BOTTOM_HALF;
        }

        // Calculate new rating
        const ratingChange = kFactor * (normalizedActual - normalizedExpected);
        const newRating = Math.round(playerRating + ratingChange);
        
        // Ensure minimum rating of 100
        newRatings.set(player.username, Math.max(100, newRating));
    });

    return newRatings;
}

/**
 * Get points earned based on placement
 * @param {number} placement - Player's placement (1st, 2nd, etc.)
 * @returns {number} Points earned
 */
export function getPointsForPlacement(placement) {
    return FFA_PLACEMENT_POINTS[placement] || FFA_PLACEMENT_POINTS.DEFAULT;
}

// ============================================
// FFA MATCH REPORTING
// ============================================

/**
 * Submit an FFA match report
 * Winner reports the match, and it is sent to all participants for confirmation
 * Only 1 participant needs to confirm for the match to be approved
 * 
 * @param {Object} matchData - Match data including participants array
 * @returns {string} Report ID
 */
export async function submitFFAReport(matchData) {

    try {
        const currentUser = auth.currentUser;
        if (!currentUser) {
            throw new Error('You must be logged in to submit a report');
        }

        // Validate the reporter is the winner (1st place)
        const reporter = matchData.participants.find(p => p.placement === 1);
        if (!reporter) {
            throw new Error('Match must have a 1st place finisher');
        }

        // Get reporter's player document
        const reporterQuery = query(
            collection(db, 'playersFFA'),
            where('username', '==', reporter.username)
        );
        const reporterDocs = await getDocs(reporterQuery);
        
        if (reporterDocs.empty) {
            throw new Error('Reporter must be registered in the FFA ladder');
        }

        const reporterDoc = reporterDocs.docs[0];
        if (reporterDoc.id !== currentUser.uid) {
            throw new Error('Only the winner (1st place) can submit the match report');
        }

        // Validate all participants exist in the FFA ladder
        const participantUsernames = matchData.participants.map(p => p.username);
        const playersSnapshot = await getDocs(collection(db, 'playersFFA'));
        const registeredPlayers = new Set();
        const playerIdMap = new Map();
        
        playersSnapshot.forEach(doc => {
            const data = doc.data();
            if (data.username) {
                registeredPlayers.add(data.username);
                playerIdMap.set(data.username, doc.id);
            }
        });

        const unregisteredPlayers = participantUsernames.filter(u => !registeredPlayers.has(u));
        if (unregisteredPlayers.length > 0) {
            throw new Error(`The following players are not registered in FFA: ${unregisteredPlayers.join(', ')}`);
        }

        // Create the pending match report
        const now = new Date(); // Use regular Date for array items
        const reportData = {
            type: 'FFA',
            reporterUsername: reporter.username,
            reporterId: currentUser.uid,
            gameVersion: matchData.gameVersion || 'D1', // ✅ ADD: Store game version
            participants: matchData.participants.map(p => ({
                username: p.username,
                odl_Id: playerIdMap.get(p.username),
                placement: p.placement,
                kills: parseInt(p.kills) || 0,
                deaths: parseInt(p.deaths) || 0,
                confirmed: p.username === reporter.username, // Reporter auto-confirms
                confirmedAt: p.username === reporter.username ? now : null // Use Date object instead of serverTimestamp()
            })),
            totalPlayers: matchData.participants.length,
            mapPlayed: matchData.mapPlayed || 'Unknown',
            matchNotes: matchData.matchNotes || '',
            demoLink: matchData.demoLink || '',
            reportedAt: serverTimestamp(), // This is fine - it's at document root
            status: 'pending',
            confirmationsNeeded: 1, // Only 1 confirmation needed
            confirmationCount: 1    // Reporter counts as first confirmation
        };


        // Add to pending matches collection
        const pendingRef = collection(db, 'pendingMatchesFFA');
        const docRef = await addDoc(pendingRef, reportData);

        console.log('FFA match report submitted:', docRef.id);

        // Send notifications to all other participants
        await notifyFFAParticipants(docRef.id, reportData);

        return docRef.id;
    } catch (error) {
        console.error('Error submitting FFA report:', error);
        throw error;
    }
}

/**
 * Notify all FFA participants about a pending match
 */
async function notifyFFAParticipants(reportId, reportData) {
    try {
        const batch = writeBatch(db);
        
        for (const participant of reportData.participants) {
            // Skip the reporter (they already know)
            if (participant.username === reportData.reporterUsername) continue;
            
            const notificationRef = doc(collection(db, 'notifications'));
            batch.set(notificationRef, {
                type: 'ffa_match_confirmation',
                recipientId: participant.odl_Id,
                recipientUsername: participant.username,
                reportId: reportId,
                reporterUsername: reportData.reporterUsername,
                placement: participant.placement,
                totalPlayers: reportData.totalPlayers,
                mapPlayed: reportData.mapPlayed,
                createdAt: serverTimestamp(),
                read: false
            });
        }
        
        await batch.commit();
        console.log('FFA notifications sent to participants');
    } catch (error) {
        console.error('Error sending FFA notifications:', error);
    }
}

/**
 * Confirm an FFA match report
 * Only 1 participant needs to confirm for the match to be approved
 * 
 * @param {string} reportId - The pending match report ID
 * @param {Object} confirmationData - Optional corrections to the confirmer's data
 */
export async function confirmFFAReport(reportId, confirmationData = {}) {
    const user = auth.currentUser;
    if (!user) {
        throw new Error('Must be logged in to confirm match');
    }

    try {
        const reportRef = doc(db, 'pendingMatchesFFA', reportId);
        const reportSnap = await getDoc(reportRef);
        
        if (!reportSnap.exists()) {
            throw new Error('Match report not found');
        }
        
        const reportData = reportSnap.data();
        
        // ✅ FIX: Use 'players' instead of 'participants' to match the data structure
        const players = reportData.players || reportData.participants || [];
        
        if (players.length === 0) {
            throw new Error('No players found in match data');
        }
        
        // Get confirmer's FFA username
        const userFFADoc = await getDoc(doc(db, 'playersFFA', user.uid));
        if (!userFFADoc.exists()) {
            throw new Error('You must be registered in FFA to confirm matches');
        }
        const confirmerUsername = userFFADoc.data().username;
        
        // Check if user is a participant
        const participantIndex = players.findIndex(p => 
            p.username === confirmerUsername || p.odl_Id === user.uid
        );
        
        if (participantIndex === -1) {
            throw new Error('You are not a participant in this match');
        }
        
        // Check if user is the reporter (can't confirm own submission)
        const reporterId = reportData.submittedByUID || reportData.reporterId;
        if (reporterId === user.uid) {
            throw new Error('You cannot confirm your own match report');
        }
        
        // Check if already confirmed
        const confirmedBy = reportData.confirmedBy || [];
        if (confirmedBy.includes(user.uid) || confirmedBy.includes(confirmerUsername)) {
            throw new Error('You have already confirmed this match');
        }
        
        // Add confirmation
        const updatedConfirmedBy = [...confirmedBy, user.uid];
        
        await updateDoc(reportRef, {
            confirmedBy: updatedConfirmedBy,
            lastConfirmedAt: serverTimestamp(),
            lastConfirmedBy: confirmerUsername
        });
        
        // FFA only needs 1 confirmation to be approved
        // Move to approved collection
        await approveFFAReport(reportId, {
            ...reportData,
            players: players, // Ensure players array is passed
            confirmedBy: updatedConfirmedBy
        });
        
        console.log('FFA match confirmed and approved');
        return { success: true, message: 'Match confirmed and approved!' };
        
    } catch (error) {
        console.error('Error confirming FFA report:', error);
        throw error;
    }
}


/**
 * Approve and process an FFA match report
 * Updates ELO ratings and awards points to all participants
 */
export async function approveFFAReport(reportId, reportData) {
    try {
        // ✅ FIX: Handle both 'players' and 'participants' field names
        const players = reportData.players || reportData.participants || [];
        
        if (players.length === 0) {
            throw new Error('No players found in match data');
        }
        
        // Normalize the data to use 'participants' for processing
        const normalizedData = {
            ...reportData,
            participants: players
        };
        
        // Process the match (calculate ELO, award points)
        const processedMatch = await processApprovedFFAMatch(normalizedData);
        
        // Move to approved collection
        const approvedRef = doc(db, 'approvedMatchesFFA', reportId);
        await setDoc(approvedRef, {
            ...processedMatch,
            approvedAt: serverTimestamp(),
            status: 'approved'
        });
        
        // Delete from pending collection
        const pendingRef = doc(db, 'pendingMatchesFFA', reportId);
        await deleteDoc(pendingRef);
        
        console.log('FFA match approved successfully');
        return { success: true };
        
    } catch (error) {
        console.error('Error approving FFA report:', error);
        throw error;
    }
}

/**
 * Reject an FFA match report
 */
export async function rejectFFAReport(reportId, reason = '') {
    try {
        const currentUser = auth.currentUser;
        if (!currentUser) {
            throw new Error('You must be logged in to reject a match');
        }

        const reportRef = doc(db, 'pendingMatchesFFA', reportId);
        const reportSnapshot = await getDoc(reportRef);

        if (!reportSnapshot.exists()) {
            throw new Error('Match report not found');
        }

        const reportData = reportSnapshot.data();

        // Check if user is a participant
        const isParticipant = reportData.participants.some(p => p.odl_Id === currentUser.uid);
        
        if (!isParticipant) {
            // Check if admin
            const { isAdmin } = await import('../admin-check.js');
            const adminStatus = await isAdmin();
            if (!adminStatus) {
                throw new Error('You must be a participant or admin to reject this match');
            }
        }

        // Move to rejected matches
        const rejectedData = {
            ...reportData,
            status: 'rejected',
            rejectedAt: serverTimestamp(),
            rejectedBy: currentUser.uid,
            rejectionReason: reason
        };

        const rejectedRef = doc(db, 'rejectedMatchesFFA', reportId);
        await setDoc(rejectedRef, rejectedData);

        // Delete from pending
        await deleteDoc(reportRef);

        console.log('FFA match rejected:', reportId);
        return true;
    } catch (error) {
        console.error('Error rejecting FFA report:', error);
        throw error;
    }
}

/**
 * Update FFA ladder positions based on current ELO ratings
 */
export async function updateFFALadderPositions() {
    try {
        const playersSnapshot = await getDocs(collection(db, 'playersFFA'));
        const players = [];

        playersSnapshot.forEach(doc => {
            players.push({
                id: doc.id,
                ...doc.data()
            });
        });

        // Sort by ELO descending
        players.sort((a, b) => (b.eloRating || 1000) - (a.eloRating || 1000));

        // Update positions
        const batch = writeBatch(db);
        
        players.forEach((player, index) => {
            const newPosition = index + 1;
            if (player.position !== newPosition) {
                const playerRef = doc(db, 'playersFFA', player.id);
                batch.update(playerRef, { position: newPosition });
            }
        });

        await batch.commit();
        console.log('FFA ladder positions updated');
    } catch (error) {
        console.error('Error updating FFA positions:', error);
    }
}

/**
 * Process and finalize an approved FFA match
 * Awards ELO changes and POINTS to all participants
 * 
 * @param {Object} matchData - The approved match data
 * @returns {Object} Updated match data with ELO and points changes
 */
export async function processApprovedFFAMatch(matchData) {
    const participants = matchData.participants || [];
    
    if (participants.length < 2) {
        throw new Error('FFA match requires at least 2 participants');
    }
    
    // Get current ELO ratings for all participants
    const playerRatings = new Map();
    const playerDocs = new Map();
    
    for (const participant of participants) {
        try {
            const userQuery = query(
                collection(db, 'userProfiles'),
                where('username', '==', participant.username)
            );
            const userSnapshot = await getDocs(userQuery);
            
            if (!userSnapshot.empty) {
                const userDoc = userSnapshot.docs[0];
                const userData = userDoc.data();
                playerRatings.set(participant.username, userData.eloFFA || 1200);
                playerDocs.set(participant.username, {
                    ref: userDoc.ref,
                    data: userData
                });
            } else {
                playerRatings.set(participant.username, 1200);
            }
        } catch (error) {
            console.error(`Error fetching user ${participant.username}:`, error);
            playerRatings.set(participant.username, 1200);
        }
    }
    
    // Calculate new ELO ratings
    const newRatings = calculateFFAElo(participants, playerRatings);
    
    // Update participants with ELO changes and points
    const updatedParticipants = participants.map(p => {
        const oldElo = playerRatings.get(p.username) || 1200;
        const newElo = newRatings.get(p.username) || oldElo;
        const eloChange = newElo - oldElo;
        const pointsEarned = getFFAPointsForPlacement(p.placement);
        
        return {
            ...p,
            oldElo: oldElo,
            newElo: newElo,
            eloChange: eloChange,
            pointsEarned: pointsEarned
        };
    });
    
    // Update each player's profile with new ELO and points
    for (const participant of updatedParticipants) {
        const playerDoc = playerDocs.get(participant.username);
        
        if (playerDoc) {
            const currentPoints = playerDoc.data.points || 0;
            const currentFfaWins = playerDoc.data.ffaWins || 0;
            const currentFfaMatches = playerDoc.data.ffaMatches || 0;
            
            const updateData = {
                eloFFA: participant.newElo,
                points: currentPoints + participant.pointsEarned, // ✅ ADD POINTS
                ffaMatches: currentFfaMatches + 1
            };
            
            // Track 1st place wins
            if (participant.placement === 1) {
                updateData.ffaWins = currentFfaWins + 1;
            }
            
            try {
                await updateDoc(playerDoc.ref, updateData);
                console.log(`Updated ${participant.username}: +${participant.pointsEarned} points, ELO: ${participant.oldElo} → ${participant.newElo}`);
            } catch (error) {
                console.error(`Error updating ${participant.username}:`, error);
            }
        }
    }
    
    // Return updated match data
    return {
        ...matchData,
        participants: updatedParticipants,
        processed: true,
        processedAt: serverTimestamp()
    };
}

/**
 * Get FFA points for placement
 * These are the same RDL points used across all ladders
 */
export function getFFAPointsForPlacement(placement) {
    const points = FFA_PLACEMENT_POINTS[placement];
    return points !== undefined ? points : FFA_PLACEMENT_POINTS.DEFAULT;
}

/**
 * Handle FFA form submission
 */
async function handleFFASubmit(event) {
    event.preventDefault();
    
    const errorEl = document.getElementById('ffa-report-error');
    const submitBtn = event.target.querySelector('button[type="submit"]');
    
    try {
        // Validate player selections
        if (!validateFFAPlayerSelections()) {
            throw new Error('Please ensure each player is selected only once');
        }
        
        // ✅ VERIFY: Game version is being captured correctly
        const gameVersion = document.querySelector('input[name="ffa-game-version"]:checked')?.value || 'D1';
        console.log('Selected game version:', gameVersion); // Debug log
        
        const mapPlayed = document.getElementById('ffa-map-played')?.value.trim();
        const matchNotes = document.getElementById('ffa-match-notes')?.value.trim() || '';
        const demoLink = document.getElementById('ffa-demo-link')?.value.trim() || '';
        
        if (!mapPlayed) {
            throw new Error('Please enter the map played');
        }
        
        // Gather participants
        const participantRows = document.querySelectorAll('.ffa-participant-row');
        const participants = [];
        
        participantRows.forEach(row => {
            const placement = parseInt(row.dataset.placement);
            const username = row.querySelector('.ffa-player-select')?.value;
            const kills = parseInt(row.querySelector('.ffa-kills')?.value) || 0;
            const deaths = parseInt(row.querySelector('.ffa-deaths')?.value) || 0;
            
            if (username) {
                participants.push({ placement, username, kills, deaths });
            }
        });
        
        if (participants.length < 3) {
            throw new Error('FFA matches require at least 3 participants');
        }
        
        // Verify winner
        const winner = participants.find(p => p.placement === 1);
        if (!winner) {
            throw new Error('1st place winner must be selected');
        }
        
        // Verify current user is winner
        const user = auth.currentUser;
        const currentUserDoc = await getDoc(doc(db, 'playersFFA', user.uid));
        if (!currentUserDoc.exists()) {
            throw new Error('You must be registered in the FFA ladder');
        }
        
        const currentUsername = currentUserDoc.data().username;
        if (winner.username !== currentUsername) {
            throw new Error('Only the winner (1st place) can submit the match report');
        }
        
        // Show loading
        const originalText = submitBtn.textContent;
        submitBtn.textContent = 'Submitting...';
        submitBtn.disabled = true;
        
        // ✅ VERIFY: gameVersion is included in matchData
        const matchData = { 
            participants, 
            mapPlayed, 
            matchNotes, 
            demoLink, 
            gameVersion // ✅ ENSURE this is being passed
        };
        console.log('Submitting match data:', matchData); // Debug log
        
        // Submit report
        const reportId = await submitFFAReport(matchData);
        
        // Success
        if (errorEl) {
            errorEl.textContent = 'FFA match reported successfully! Awaiting confirmation.';
            errorEl.style.color = 'green';
        }
        
        // Reset form
        event.target.reset();
        document.getElementById('ffa-participants-container').innerHTML = '';
        document.getElementById('ffa-participant-count').value = '';
        
        // Restore button
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
        
        alert(`FFA match submitted!\n\nReport ID: ${reportId}\n\nMatch will be approved once 1 other participant confirms.`);
        
        updatePendingMatchNotification();
        
    } catch (error) {
        console.error('Error submitting FFA report:', error);
        if (errorEl) {
            errorEl.textContent = error.message;
            errorEl.style.color = 'red';
        }
        if (submitBtn) {
            submitBtn.textContent = 'Report Game';
            submitBtn.disabled = false;
        }
    }
}