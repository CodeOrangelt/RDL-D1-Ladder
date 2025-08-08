import { approveReport } from './ladderalgorithm.js';
import { approveReportD2 } from './ladderalgorithm-d2.js';
import { approveReportD3 } from './ladderalgorithm-d3.js';
import { checkPendingMatches, updatePendingMatchNotification, updateNotificationDot } from './checkPendingMatches.js';
import { 
    collection, getDocs, query, where, 
    orderBy, serverTimestamp, doc, setDoc, getDoc, addDoc, updateDoc, deleteDoc 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth, db } from './firebase-config.js';

// Move currentUserEmail to module scope
let currentUserEmail = null;
let confirmationNotification = null; // Also adding this to fix potential undefined error
let outstandingReportData = null; // And this one
let currentGameMode = 'D1'; // Add global variable to track current game mode

// Outstanding matches state variables
let outstandingMatches = [];

document.addEventListener('DOMContentLoaded', async () => {
    const elements = {
        authWarning: document.getElementById('auth-warning'),
        reportForm: document.getElementById('report-form'),
        winnerUsername: document.getElementById('winner-username'),
        loserUsername: document.getElementById('loser-username'),
        loserScore: document.getElementById('loser-score'),
        suicides: document.getElementById('suicides'),
        mapPlayed: document.getElementById('map-played'),
        loserComment: document.getElementById('loser-comment'),
        reportError: document.getElementById('report-error'),
        reportLightbox: document.getElementById('report-lightbox')
    };

    // Log which elements were not found
    Object.entries(elements).forEach(([key, value]) => {
        if (!value) {
            console.warn(`Element '${key}' not found in the DOM`);
        }
    });

    // Game mode toggle buttons
    const d1Button = document.getElementById('d1-mode');
    const d2Button = document.getElementById('d2-mode');
    const d3Button = document.getElementById('d3-mode');

    // Setup toggle button event listeners
    d1Button.addEventListener('click', () => {
        setGameMode('D1');
        d1Button.classList.add('active');
        d2Button.classList.remove('active');
        d3Button.classList.remove('active');
    });

    d2Button.addEventListener('click', () => {
        setGameMode('D2');
        d2Button.classList.add('active');
        d1Button.classList.remove('active');
        d3Button.classList.remove('active');
    });

    d3Button.addEventListener('click', () => {
        setGameMode('D3');
        d3Button.classList.add('active');
        d1Button.classList.remove('active');
        d2Button.classList.remove('active');
    });

    // Function to change the game mode and reload opponents
    function setGameMode(mode) {
        currentGameMode = mode;
        console.log(`Game mode set to: ${currentGameMode}`);
        
        // If user is logged in, check if they belong in this ladder and reload opponents
        if (auth.currentUser) {
            checkUserInLadderAndLoadOpponents(auth.currentUser.uid);
        }
    }

    setupAuthStateListener(elements);
    setupReportForm(elements);
    
    // ADD THIS CODE: Immediately check ladder status if user is already logged in
    if (auth.currentUser) {
        console.log("User already logged in, checking D1 ladder status");
        // D1 is the default mode, so just check that ladder
        checkUserInLadderAndLoadOpponents(auth.currentUser.uid);
    } else {
        console.log("No user logged in yet, waiting for auth state change");
    }
});

function setupAuthStateListener(elements) {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            handleUserSignedIn(user, elements);
        } else {
            handleUserSignedOut(elements);
        }
    });
}

async function handleUserSignedIn(user, elements) {
    if (!elements) {
        console.error('Elements object is null or undefined');
        return;
    }
    
    // Set email first before any other operations
    currentUserEmail = user.email || null;
    const userUid = user.uid;

    try {
        // Check if user is a non-participant by UID
        const nonParticipantRef = doc(db, 'nonParticipants', userUid);
        try {
            const nonParticipantDoc = await getDoc(nonParticipantRef);
            
            console.log("Non-participant check:", {
                exists: nonParticipantDoc.exists(),
                data: nonParticipantDoc.exists() ? nonParticipantDoc.data() : null
            });
            
            // Only consider as non-participant if document exists AND has the isNonParticipant flag set
            if (nonParticipantDoc.exists() && nonParticipantDoc.data().isNonParticipant === true) {
                // If user is a non-participant, show warning and hide form
                if (elements.authWarning) {
                    elements.authWarning.style.display = 'block';
                    elements.authWarning.textContent = 'Non-participants cannot report games.';
                }
                
                if (elements.reportForm) {
                    elements.reportForm.style.display = 'none';
                }
                return; // Exit early
            }
        } catch (error) {
            console.warn('Error checking non-participant status:', error);
            // Continue execution - don't block on this error
        }
        
        // Check if user exists in any of the player collections
        const collections = ['players', 'playersD2', 'playersD3', 'playersDuos', 'playersCTF'];
        let userFound = false;
        let username = '';
        
        for (const collectionName of collections) {
            try {
                const playerRef = doc(db, collectionName, userUid);
                const playerDoc = await getDoc(playerRef);
                
                if (playerDoc.exists()) {
                    userFound = true;
                    username = playerDoc.data().username;
                    console.log(`User found in collection ${collectionName} with username: ${username}`);
                    
                    // If user is found in D1 or D2 collection, set that as the current mode
                    if (collectionName === 'players' && currentGameMode !== 'D1') {
                        // User exists in D1 collection but current mode is not D1
                        currentGameMode = 'D1';
                        const d1Button = document.getElementById('d1-mode');
                        const d2Button = document.getElementById('d2-mode');
                        const d3Button = document.getElementById('d3-mode');
                        d1Button.classList.add('active');
                        d2Button.classList.remove('active');
                        d3Button.classList.remove('active');
                    } else if (collectionName === 'playersD2' && currentGameMode !== 'D2') {
                        // User exists in D2 collection but current mode is not D2
                        currentGameMode = 'D2';
                        const d1Button = document.getElementById('d1-mode');
                        const d2Button = document.getElementById('d2-mode');
                        const d3Button = document.getElementById('d3-mode');
                        d2Button.classList.add('active');
                        d1Button.classList.remove('active');
                        d3Button.classList.remove('active');
                    }
                    break;
                }
            } catch (error) {
                console.warn(`Error checking ${collectionName} collection:`, error);
                // Continue to next collection
            }
        }
        
        if (!userFound) {
            // If user is not in any player collection, show warning and hide form
            if (elements.authWarning) {
                elements.authWarning.style.display = 'block';
            }
            
            if (elements.reportForm) {
                elements.reportForm.style.display = 'none';
            }
            return; // Exit early
        }
        
        // Check if user is in the current ladder and load opponents
        const isInCurrentLadder = await checkUserInLadderAndLoadOpponents(userUid);
        
        if (!isInCurrentLadder) {
            console.warn(`User is not in the ${currentGameMode} ladder. Checking other ladders.`);
            
            // Try to find a ladder where the user exists
            for (const collection of ['players', 'playersD2', 'playersD3']) {
                if (collection === (
                    currentGameMode === 'D1' ? 'players' : 
                    currentGameMode === 'D2' ? 'playersD2' : 'playersD3'
                )) {
                    continue; // Skip the current mode's collection as we already checked
                }
                
                const playerRef = doc(db, collection, userUid);
                try {
                    const playerDoc = await getDoc(playerRef);
                    if (playerDoc.exists()) {
                        // Update game mode to the one where user exists
                        const newMode = collection === 'players' ? 'D1' : collection === 'playersD2' ? 'D2' : 'D3';
                        console.log(`User found in ${collection}, switching to ${newMode} mode`);
                        
                        // Update UI to reflect the new mode
                        const d1Button = document.getElementById('d1-mode');
                        const d2Button = document.getElementById('d2-mode');
                        const d3Button = document.getElementById('d3-mode');
                        
                        if (newMode === 'D1') {
                            d1Button.classList.add('active');
                            d2Button.classList.remove('active');
                            d3Button.classList.remove('active');
                        } else if (newMode === 'D2') {
                            d2Button.classList.add('active');
                            d1Button.classList.remove('active');
                            d3Button.classList.remove('active');
                        } else {
                            d3Button.classList.add('active');
                            d1Button.classList.remove('active');
                            d2Button.classList.remove('active');
                        }
                        
                        // Set the mode and check again
                        currentGameMode = newMode;
                        await checkUserInLadderAndLoadOpponents(userUid);
                        break;
                    }
                } catch (error) {
                    console.warn(`Error checking ${collection}:`, error);
                }
            }
        }
    } catch (error) {
        console.error('Error during sign-in handling:', error);
    }
}

function handleUserSignedOut(elements) {
    elements.authWarning.style.display = 'block';
    elements.reportForm.style.display = 'none';
    currentUserEmail = null; // Clear the email when user signs out
}

async function updateUserDisplay(userEmail, elements) {
    const playersRef = collection(db, 'players');
    const q = query(playersRef, where('email', '==', userEmail));
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
        const username = querySnapshot.docs[0].data().username;
        elements.loserUsername.textContent = username;
    }
}

async function populateWinnerDropdown(winnerSelect) {
    try {
        const playersRef = collection(db, 'players');
        const querySnapshot = await getDocs(playersRef);
        
        // Clear existing options
        winnerSelect.innerHTML = '<option value="">Select Winner</option>';
        
        if (!querySnapshot.empty) {
            querySnapshot.forEach(doc => {
                const player = doc.data();
                // Only add other players (not the current user)
                if (player.email !== currentUserEmail) {
                    const option = document.createElement('option');
                    option.value = player.email;
                    option.textContent = player.username;
                    winnerSelect.appendChild(option);
                }
            });
        }
    } catch (error) {
        console.error('Error populating winner dropdown:', error);
        throw error;
    }
}

function setupReportForm(elements) {
    if (!elements.reportForm) return;

    elements.reportForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
            await submitReport(elements);
            elements.reportForm.reset();
            alert('Game reported successfully.');
        } catch (error) {
            console.error('Error submitting report:', error);
            elements.reportError.textContent = 'Error reporting game. Please try again.';
        }
    });
}

// --- Inside your submitReport function ---
async function submitReport(elements) {
    // Use the appropriate collection based on current game mode
    const pendingMatchesCollection = 
        currentGameMode === 'D1' ? 'pendingMatches' : 
        currentGameMode === 'D2' ? 'pendingMatchesD2' : 'pendingMatchesD3';
    const pendingMatchesRef = collection(db, pendingMatchesCollection);
    const newMatchRef = doc(pendingMatchesRef);
    
    try {
        // Get current user (loser)
        const user = auth.currentUser;
        if (!user) throw new Error("User not authenticated");
        const userUid = user.uid;
        const playersCollection = 
            currentGameMode === 'D1' ? 'players' : 
            currentGameMode === 'D2' ? 'playersD2' : 'playersD3';
        
        // Get current user's document
        const loserDoc = await getDoc(doc(db, playersCollection, userUid));
        if (!loserDoc.exists()) throw new Error("Your player profile not found");

        // Get subgame type element
        const subgameTypeElement = document.getElementById('subgame-type');
        
        // Get winner username from select element
        const winnerUsername = elements.winnerUsername.value;
        if (!winnerUsername) throw new Error("Please select an opponent");
        
        // Find the winner by username
        const winnerQuery = query(collection(db, playersCollection), where("username", "==", winnerUsername));
        const winnerSnapshot = await getDocs(winnerQuery);
        if (winnerSnapshot.empty) throw new Error("Selected opponent not found");
        
        const winnerData = winnerSnapshot.docs[0].data();
        const winnerId = winnerSnapshot.docs[0].id;
        
        // Build reportData including old Elo ratings and loser suicides (renamed field)
        const reportData = {
            matchId: newMatchRef.id,
            loserUsername: loserDoc.data().username,
            loserId: userUid,
            winnerUsername: winnerData.username,
            winnerId: winnerId,
            loserScore: elements.loserScore.value,
            loserSuicides: elements.suicides.value, // renamed field
            mapPlayed: elements.mapPlayed.value,
            loserComment: elements.loserComment.value,
            subgameType: subgameTypeElement ? subgameTypeElement.value : "",            
            gameMode: currentGameMode,
            approved: false,
            createdAt: serverTimestamp(),
            // Capture old ELO ratings if available
            winnerOldElo: winnerData.eloRating || null,
            losersOldElo: loserDoc.data().eloRating || null
        };
        
        await setDoc(newMatchRef, reportData);
        console.log(`Match reported in ${pendingMatchesCollection} with ID: ${newMatchRef.id}`);
        
        // Success feedback
        elements.reportError.textContent = "Game reported successfully!";
        elements.reportError.style.color = "green";
        
        // Update notification indicator
        updatePendingMatchNotification();
        
    } catch (error) {
        console.error('Error submitting report:', error);
        elements.reportError.textContent = `Error: ${error.message}`;
        elements.reportError.style.color = "red";
        throw error;
    }
}

// Replace the existing checkForOutstandingReports function with this updated version
async function checkForOutstandingReports(username, elements, collectionName = null) {
    console.log(`Checking reports for user: ${username} in ${collectionName || 'default collection'}`);
    
    // Use the passed collection name or determine based on current game mode
    const pendingCollection = collectionName || (
        currentGameMode === 'D1' ? 'pendingMatches' : 
        currentGameMode === 'D2' ? 'pendingMatchesD2' : 'pendingMatchesD3'
    );
    console.log(`Using collection: ${pendingCollection}`);
    
    try {
        // First try to find by winnerId if we're using the new structure
        const user = auth.currentUser;
        if (!user) {
            console.log("No authenticated user found");
            return;
        }
        
        const userId = user.uid;
        
        // Query pending matches where the current user is the winner
        const pendingMatchesRef = collection(db, pendingCollection);
        
        // Try first with winnerId fiyeld (new format)
        const q1 = query(
            pendingMatchesRef,
            where('winnerId', '==', userId),
            where('approved', '==', false)
        );
        
        let snapshot = await getDocs(q1);
        console.log(`Query by winnerId results: ${snapshot.size} matches found`);
        
        // If no matches found, try with winnerEmail (old format)
        if (snapshot.empty && user.email) {
            console.log("No matches found by winnerId, trying winnerEmail");
            const q2 = query(
                pendingMatchesRef,
                where('winnerEmail', '==', user.email),
                where('approved', '==', false)
            );
            snapshot = await getDocs(q2);
            console.log(`Query by winnerEmail results: ${snapshot.size} matches found`);
        }
        
        // If still no matches, try with winnerUsername (alternative format)
        if (snapshot.empty) {
            console.log("No matches found by email either, trying winnerUsername");
            
            // First get the username from the appropriate players collection
            const playersCollection = currentGameMode === 'D1' ? 'players' : 'playersD2';
            const userDoc = await getDoc(doc(db, playersCollection, userId));
            
            if (userDoc.exists() && userDoc.data().username) {
                const username = userDoc.data().username;
                const q3 = query(
                    pendingMatchesRef,
                    where('winnerUsername', '==', username),
                    where('approved', '==', false)
                );
                snapshot = await getDocs(q3);
                console.log(`Query by winnerUsername results: ${snapshot.size} matches found`);
            }
        }
        
        // If we found any pending matches, show the first one
        if (!snapshot.empty) {
            const reportData = snapshot.docs[0].data();
            console.log("Found pending match:", reportData);
            
            // Add the document ID to the data
            reportData.id = snapshot.docs[0].id;
            autoFillReportForm(reportData);

            // Update the notification dot as well
            updateNotificationDot(true);
            
            return true;
        } else {
            console.log("No pending matches found for this user");
            updateNotificationDot(false);
            return false;
        }
    } catch (error) {
        console.error('Error checking outstanding reports:', error);
    }
}

// --- Updated autoFillReportForm function ---
function autoFillReportForm(reportData) {
    console.log("Report Data in autoFillReportForm:", reportData);
    if (reportData) {
        // Calculate winner score based on loser score
        const loserScore = parseInt(reportData.loserScore || "0");
        // For example, if loser score is less than 18, the winner gets 20; otherwise, winner score is loser score + 2.
        const winnerScore = loserScore < 18 ? 20 : loserScore + 2;
        
        // Determine game mode and corresponding players collection
        const gameMode = reportData.gameMode || currentGameMode;
        const playersCollection = 
            gameMode === 'D1' ? 'players' : 
            gameMode === 'D2' ? 'playersD2' : 'playersD3';
        
        console.log(`Using players collection: ${playersCollection} for game mode: ${gameMode}`);
        
        // Retrieve winner's data either by winnerId or by username
        let winnerPromise;
        if (reportData.winnerId) {
            winnerPromise = getDoc(doc(db, playersCollection, reportData.winnerId))
                .then(docSnap => docSnap.exists() ? { id: docSnap.id, data: docSnap.data() } : null);
        } else {
            winnerPromise = getDocs(query(collection(db, playersCollection), where("username", "==", reportData.winnerUsername)))
                .then(snapshot => !snapshot.empty ? { id: snapshot.docs[0].id, data: snapshot.docs[0].data() } : null);
        }
        
        // Retrieve loser's data either by loserId or by username
        let loserPromise;
        if (reportData.loserId) {
            loserPromise = getDoc(doc(db, playersCollection, reportData.loserId))
                .then(docSnap => docSnap.exists() ? { id: docSnap.id, data: docSnap.data() } : null);
        } else {
            loserPromise = getDocs(query(collection(db, playersCollection), where("username", "==", reportData.loserUsername)))
                .then(snapshot => !snapshot.empty ? { id: snapshot.docs[0].id, data: snapshot.docs[0].data() } : null);
        }
        
        Promise.all([winnerPromise, loserPromise])
            .then(([winnerResult, loserResult]) => {
                if (!winnerResult) {
                    console.error('No winner found for this match');
                    alert('Error: Winner data not found.');
                    return;
                }
                if (!loserResult) {
                    console.error('No loser found for this match');
                    alert('Error: Loser data not found.');
                    return;
                }
                
                // Use the old Elo values if available, falling back on the current Elo if not
                const winnerEloToUse = reportData.winnerOldElo != null ? reportData.winnerOldElo : winnerResult.data.eloRating;
                const loserEloToUse = reportData.losersOldElo != null ? reportData.losersOldElo : loserResult.data.eloRating;
                
                const winnerUsername = winnerResult.data.username;
                const loserUsername = loserResult.data.username;
                
                console.log(`Winner: ${winnerUsername} (ELO: ${winnerEloToUse}), Loser: ${loserUsername} (ELO: ${loserEloToUse})`);
                
                // Populate the lightbox fields
                const lightbox = document.getElementById('report-lightbox');
                if (!lightbox) {
                    console.error('Lightbox element not found');
                    return;
                }
                document.getElementById('lightbox-winner').textContent = winnerUsername;
                document.getElementById('lightbox-loser').textContent = loserUsername;
                document.getElementById('lightbox-loser-score').textContent = reportData.loserScore || "0";
                // Use loserSuicides (instead of generic suicides) for display
                document.getElementById('lightbox-suicides').textContent = reportData.loserSuicides || "0";
                document.getElementById('lightbox-map').textContent = reportData.mapPlayed || "Not specified";
                document.getElementById('lightbox-comment').textContent = reportData.loserComment || "No comment";
                document.getElementById('lightbox-subgame').textContent = reportData.subgameType || "Standard Match";
                
                // Set and disable the winner score input field
                const winnerScoreInput = document.getElementById('winner-score');
                if (winnerScoreInput) {
                    winnerScoreInput.value = winnerScore;
                    winnerScoreInput.readOnly = true;
                    winnerScoreInput.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
                }
                
                // Show the lightbox
                showLightbox();
                
                // Update the lightbox buttons container to include a reject button
                const buttonsContainer = document.querySelector('.lightbox-buttons');
                if (buttonsContainer) {
                    console.log("Found buttons container:", buttonsContainer);
                    
                    // Remove any existing reject button to avoid duplicates
                    const existingRejectButton = document.getElementById('reject-button');
                    if (existingRejectButton) {
                        existingRejectButton.remove();
                    }
                    
                    // Create new reject button with prominent styling
                    const rejectButton = document.createElement('button');
                    rejectButton.id = 'reject-button';
                    rejectButton.className = 'button danger-button';
                    rejectButton.textContent = 'Reject Match';
                    rejectButton.style.backgroundColor = '#d32f2f';
                    rejectButton.style.color = 'white';
                    rejectButton.style.marginRight = '10px';
                    rejectButton.style.padding = '8px 16px';
                    rejectButton.style.border = 'none';
                    rejectButton.style.borderRadius = '4px';
                    rejectButton.style.cursor = 'pointer';
                    rejectButton.style.fontWeight = 'bold';
                    
                    // Insert at the start of the buttons container instead of trying to use insertBefore
                    buttonsContainer.prepend(rejectButton);
                    
                    console.log("Reject button added:", rejectButton);
                }
                
                // Setup all button event listeners
                const approveButton = document.getElementById('approve-button');
                const rejectButton = document.getElementById('reject-button');
                const cancelButton = document.getElementById('cancel-button');
                
                // Replace approve button event listener
                if (approveButton) {
                    const newApproveButton = approveButton.cloneNode(true);
                    approveButton.parentNode.replaceChild(newApproveButton, approveButton);
                    newApproveButton.addEventListener('click', async function() {
                        try {
                            const winnerScore = document.getElementById('winner-score').value;
                            const winnerSuicides = document.getElementById('winner-suicides').value || "0";
                            const winnerComment = document.getElementById('winner-comment').value || "";
                            
                            // Log the current user for debugging
                            console.log("Current user info:", {
                                uid: auth.currentUser?.uid,
                                email: auth.currentUser?.email,
                                isAdmin: auth.currentUser?.email === 'admin@ladder.com' || auth.currentUser?.email === 'brian2af@outlook.com'
                            });
                            
                            const gameMode = reportData.gameMode || currentGameMode;

                            // Call the appropriate function based on game mode
                            if (gameMode === 'D3') {
                                await approveReportD3(reportData.id, winnerScore, winnerSuicides, winnerComment);
                            } else if (gameMode === 'D2') {
                                await approveReportD2(reportData.id, winnerScore, winnerSuicides, winnerComment);
                            } else {
                                await approveReport(reportData.id, winnerScore, winnerSuicides, winnerComment);
                            }
                            
                            document.getElementById('report-lightbox').style.display = 'none';
                            alert('Match approved successfully');
                            
                            // Update notification indicator
                            updatePendingMatchNotification();
                            
                            location.reload();
                            
                            // After approval, update positions if necessary (using old Elo data is preserved in the report)
                            const playersCollection = gameMode === 'D1' ? 'players' : 'playersD2';
                            const winnerRef = doc(db, playersCollection, winnerResult.id);
                            const loserRef  = doc(db, playersCollection, loserResult.id);
                            
                            const [winnerSnap, loserSnap] = await Promise.all([getDoc(winnerRef), getDoc(loserRef)]);
                            if (winnerSnap.exists() && loserSnap.exists()) {
                                const winnerDataUpdated = winnerSnap.data();
                                const loserDataUpdated = loserSnap.data();
                                if (winnerDataUpdated.position > loserDataUpdated.position) {
                                    await updateDoc(winnerRef, { position: loserDataUpdated.position });
                                    console.log(`Winner ${winnerDataUpdated.username} moved to position ${loserDataUpdated.position}`);
                                } else {
                                    console.log("No position change needed; winner is already above the loser.");
                                }
                            }
                        } catch (error) {
                            console.error('Error approving report:', error);
                            alert('Error approving match: ' + error.message);
                        }
                    });
                }
                
                // Add event listener for reject button
                if (rejectButton) {
                    const newRejectButton = rejectButton.cloneNode(true);
                    rejectButton.parentNode.replaceChild(newRejectButton, rejectButton);
                    newRejectButton.addEventListener('click', async function() {
                        try {
                            // Prompt for rejection reason
                            const rejectionReason = prompt("Please provide a reason for rejecting this match report:", "");
                            
                            if (rejectionReason === null) {
                                // User canceled the prompt
                                return;
                            }
                            
                            // Call the reject function
                            await rejectReport(reportData.id, rejectionReason);
                            
                            hideLightbox();
                            alert('Match report rejected successfully');
                            
                            // Update notification indicator
                            updatePendingMatchNotification();
                            
                            location.reload();
                        } catch (error) {
                            console.error('Error rejecting report:', error);
                            alert('Error rejecting match: ' + error.message);
                        }
                    });
                }
                
                // Replace cancel button event listener
                if (cancelButton) {
                    const newCancelButton = cancelButton.cloneNode(true);
                    cancelButton.parentNode.replaceChild(newCancelButton, cancelButton);
                    newCancelButton.addEventListener('click', hideLightbox);
                }
            })
            .catch(error => {
                console.error('Error processing player data:', error);
                alert('Error fetching player data. Please try again.');
            });
    }
}

// Show lightbox
function showLightbox() {
    console.log('Showing lightbox');
    const lightbox = document.getElementById('report-lightbox');
    if (!lightbox) {
        console.error('Lightbox element not found');
        return;
    }
    lightbox.classList.add('show');
}

// Hide lightbox
function hideLightbox() {
    const lightbox = document.getElementById('report-lightbox');
    lightbox.classList.remove('show');
}

// Function to reject a pending match report
async function rejectReport(reportId, rejectionReason) {
    try {
        // Determine which collections to use based on game mode
        const pendingCollection = 
            currentGameMode === 'D1' ? 'pendingMatches' : 
            currentGameMode === 'D2' ? 'pendingMatchesD2' : 'pendingMatchesD3';
        const rejectedCollection = 
            currentGameMode === 'D1' ? 'RejectedD1' : 
            currentGameMode === 'D2' ? 'RejectedD2' : 'RejectedD3';
        
        console.log(`Rejecting match ${reportId} from ${pendingCollection} to ${rejectedCollection}`);
        
        // Get the current user
        const user = auth.currentUser;
        if (!user) throw new Error("You must be logged in to reject a match");
        
        // Get the match data
        const matchRef = doc(db, pendingCollection, reportId);
        const matchSnap = await getDoc(matchRef);
        
        if (!matchSnap.exists()) {
            throw new Error("Match report not found");
        }
        
        const matchData = matchSnap.data();
        
        // Verify the current user is the intended approver (winner)
        const isAuthorized = 
            (matchData.winnerId && matchData.winnerId === user.uid) ||
            (matchData.winnerEmail && matchData.winnerEmail === user.email) || 
            (matchData.winnerUsername && matchData.winnerUsername === await getUsernameFromId(user.uid));
            
        if (!isAuthorized) {
            throw new Error("Only the winner of the match can reject it");
        }
        
        // Add rejection data
        const rejectionData = {
            ...matchData,
            rejectedAt: serverTimestamp(),
            rejectedBy: user.uid,
            rejectionReason: rejectionReason || "No reason provided",
            originalDocumentId: reportId
        };
        
        // Write to rejected collection first
        const newRejectedRef = doc(collection(db, rejectedCollection));
        await setDoc(newRejectedRef, rejectionData);
        
        // Then delete from pending collection
        await deleteDoc(matchRef);
        
        console.log(`Match ${reportId} rejected successfully`);
        
        // Update notification status
        updatePendingMatchNotification();
        
        return true;
    } catch (error) {
        console.error("Error rejecting match:", error);
        throw error;
    }
}

// Helper function to get username from user ID
async function getUsernameFromId(userId) {
    // Try D1 collection first
    const d1PlayerDoc = await getDoc(doc(db, 'players', userId));
    if (d1PlayerDoc.exists()) {
        return d1PlayerDoc.data().username;
    }
    
    // Try D2 collection next
    const d2PlayerDoc = await getDoc(doc(db, 'playersD2', userId));
    if (d2PlayerDoc.exists()) {
        return d2PlayerDoc.data().username;
    }
    
    return null;
}

// Function to load the opponents list based on game mode
async function loadOpponentsList(userUid) {
    try {
        const reportError = document.getElementById('report-error');
        const loserUsername = document.getElementById('loser-username');
        const winnerUsername = document.getElementById('winner-username');
        
        if (!reportError || !loserUsername || !winnerUsername) {
            console.error('Required elements not found for loadOpponentsList');
            return;
        }
        
        // Get current user's document from the appropriate collection
        const playersCollection = 
            currentGameMode === 'D1' ? 'players' : 
            currentGameMode === 'D2' ? 'playersD2' : 'playersD3';
        
        console.log(`Loading opponents from collection: ${playersCollection}`);
        
        // Get current user's document from the appropriate collection
        const currentUserDoc = await getDoc(doc(db, playersCollection, userUid));
        
        if (!currentUserDoc.exists()) {
            reportError.textContent = `You are not registered in the ${currentGameMode} ladder.`;
            reportError.style.color = 'red';
            loserUsername.textContent = 'Not registered in this ladder';
            winnerUsername.disabled = true;
            return;
        }
        
        // User exists in this ladder
        const currentUserData = currentUserDoc.data();
        const currentUserName = currentUserData.username;
        loserUsername.textContent = `You (${currentUserName})`;
        reportError.textContent = '';
        winnerUsername.disabled = false;

        // Get all players from this ladder
        const playersRef = collection(db, playersCollection);
        const playersSnapshot = await getDocs(playersRef);

        if (playersSnapshot.empty) {
            console.log('No opponents available');
            return;
        }

        // Clear the select
        winnerUsername.innerHTML = '<option value="">Select Opponent</option>';

        // Add all players except current user
        playersSnapshot.forEach(doc => {
            const playerData = doc.data();
            // Skip current user
            if (doc.id !== userUid) {
                const option = document.createElement('option');
                option.value = playerData.username; // Store username as the value
                option.textContent = playerData.username;
                option.dataset.uid = doc.id; // Store the UID as a data attribute
                winnerUsername.appendChild(option);
            }
        });
    } catch (error) {
        console.error('Error loading opponents list:', error);
        document.getElementById('report-error').textContent = 'Error loading opponents. Please try again later.';
        document.getElementById('report-error').style.color = 'red';
    }
}

// Function to check if user is in the selected ladder and load opponents
async function checkUserInLadderAndLoadOpponents(userUid) {
    try {
        const reportError = document.getElementById('report-error');
        const loserUsername = document.getElementById('loser-username');
        const winnerUsername = document.getElementById('winner-username');
        const reportForm = document.getElementById('report-form');
        const authWarning = document.getElementById('auth-warning');
        
        // Show "checking" message
        reportError.textContent = `Checking if you are registered in ${currentGameMode} ladder...`;
        reportError.style.color = 'white';
        
        // Get current user's document from the appropriate collection
        const playersCollection = 
            currentGameMode === 'D1' ? 'players' : 
            currentGameMode === 'D2' ? 'playersD2' : 'playersD3';
            
        console.log(`Checking if user exists in collection: ${playersCollection}`);
        
        // Get current user's document
        const currentUserDoc = await getDoc(doc(db, playersCollection, userUid));
        
        if (!currentUserDoc.exists()) {
            // User is not in this ladder
            reportError.textContent = `You are not registered in the ${currentGameMode} ladder.`;
            reportError.style.color = 'red';
            loserUsername.textContent = 'Not registered in this ladder';
            winnerUsername.disabled = true;
            winnerUsername.innerHTML = '<option value="">Select Opponent</option>';
            
            // Show warning about not being in the ladder
            authWarning.style.display = 'block';
            authWarning.textContent = `You are not registered in the ${currentGameMode} ladder.`;
            return false;
        }
        
        // User exists in this ladder - clear error and warning
        reportError.textContent = '';
        authWarning.style.display = 'none';
        
        // User exists in this ladder
        const currentUserData = currentUserDoc.data();
        const currentUserName = currentUserData.username;
        loserUsername.textContent = `You (${currentUserName})`;
        winnerUsername.disabled = false;
        
        // Make sure form is visible
        reportForm.style.display = 'block';
        
        // Load the opponents list
        await loadOpponentsList(userUid);
        
        // Check for outstanding reports in this game mode
        const pendingMatchesCollection = 
            currentGameMode === 'D1' ? 'pendingMatches' : 
            currentGameMode === 'D2' ? 'pendingMatchesD2' : 'pendingMatchesD3';
            
        await checkForOutstandingReports(currentUserData.email, null, pendingMatchesCollection);
        
        return true;
    } catch (error) {
        console.error('Error checking if user is in ladder:', error);
        document.getElementById('report-error').textContent = 'Error checking ladder membership. Please try again later.';
        document.getElementById('report-error').style.color = 'red';
        return false;
    }
}

// Add these functions and variables to your existing reports.js file

// Function to fetch outstanding matches
export async function fetchOutstandingMatches() {
    const user = auth.currentUser;
    if (!user) return [];
    
    try {
        const matches = [];
        
        // Determine which collection to use based on game mode
        const pendingCollection = 
            currentGameMode === 'D1' ? 'pendingMatches' : 
            currentGameMode === 'D2' ? 'pendingMatchesD2' : 'pendingMatchesD3';
        
        const pendingMatchesRef = collection(db, pendingCollection);
        
        // Define our queries - focus on both reports the user initiated and reports against the user
        const userQueries = [
            // Reports initiated by user (as loser)
            query(pendingMatchesRef, where('loserId', '==', user.uid), where('approved', '==', false)),
            query(pendingMatchesRef, where('loserEmail', '==', user.email), where('approved', '==', false)),
            
            // Reports where user is winner (needs to approve)
            query(pendingMatchesRef, where('winnerId', '==', user.uid), where('approved', '==', false)),
            query(pendingMatchesRef, where('winnerEmail', '==', user.email), where('approved', '==', false))
        ];
        
        // Get username for additional query
        const userCollection = 
            currentGameMode === 'D1' ? 'players' : 
            currentGameMode === 'D2' ? 'playersD2' : 'playersD3';
        
        const userDoc = await getDocs(query(collection(db, userCollection), where('email', '==', user.email)));
        let username = null;
        
        if (!userDoc.empty) {
            username = userDoc.docs[0].data().username;
            // Add query by username
            if (username) {
                userQueries.push(
                    query(pendingMatchesRef, where('loserUsername', '==', username), where('approved', '==', false)),
                    query(pendingMatchesRef, where('winnerUsername', '==', username), where('approved', '==', false))
                );
            }
        }
        
        // Execute all queries
        for (const q of userQueries) {
            const snapshot = await getDocs(q);
            if (!snapshot.empty) {
                snapshot.forEach(doc => {
                    // Add document if not already in the array
                    if (!matches.some(match => match.id === doc.id)) {
                        matches.push({
                            id: doc.id,
                            ...doc.data()
                        });
                    }
                });
            }
        }
        
        // Sort by creation date
        matches.sort((a, b) => {
            const dateA = a.createdAt?.toDate() || new Date(0);
            const dateB = b.createdAt?.toDate() || new Date(0);
            return dateB - dateA; // Most recent first
        });
        
        outstandingMatches = matches;
        return matches;
        
    } catch (error) {
        console.error('Error fetching outstanding matches:', error);
        return [];
    }
}

// Function to render the matches in the modal
export function renderOutstandingMatches() {
    const matchesList = document.getElementById('outstanding-matches-list');
    
    if (outstandingMatches.length === 0) {
        matchesList.innerHTML = '<p>No outstanding matches found in the current game mode.</p>';
        return;
    }
    
    let html = '';
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    
    outstandingMatches.forEach(match => {
        const date = match.createdAt?.toDate() 
            ? match.createdAt.toDate().toLocaleDateString() 
            : 'Unknown date';
        
        // Check if current user is the initiator of this report
        const isInitiator = 
            (match.loserEmail === currentUser.email) || 
            (match.loserId === currentUser.uid);
        
        html += `
        <div class="match-item" data-id="${match.id}">
            <h3>${match.winnerUsername || 'Winner'} vs ${match.loserUsername || 'Loser'}</h3>
            <div class="match-details">
                <span class="match-detail-item">Map: ${match.mapPlayed || 'Unknown'}</span>
                <span class="match-detail-item">Date: ${date}</span>
                <span class="match-detail-item">Score: ? - ${match.loserScore || '0'}</span>
            </div>
            <div class="match-actions">
                <button class="btn view-detail-btn" data-id="${match.id}">View Details</button>
                ${isInitiator ? `
                <button class="btn edit-report-btn" data-id="${match.id}">Edit Report</button>
                <button class="btn danger-button rescind-report-btn" data-id="${match.id}">Rescind Report</button>
                ` : ''}
            </div>
        </div>
        `;
    });
    
    matchesList.innerHTML = html;
    
    // Add event listeners to the buttons
    document.querySelectorAll('.view-detail-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const matchId = this.getAttribute('data-id');
            const match = outstandingMatches.find(m => m.id === matchId);
            
            // Hide the modal
            document.getElementById('outstanding-modal').classList.remove('show');
            
            // Show match details
            showMatchLightbox(match);
        });
    });
    
    // Add edit button listeners
    document.querySelectorAll('.edit-report-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const matchId = this.getAttribute('data-id');
            const match = outstandingMatches.find(m => m.id === matchId);
            
            // Hide the modal
            document.getElementById('outstanding-modal').classList.remove('show');
            
            // Populate form with match data for editing
            editReport(match);
        });
    });
    
    // Add rescind button listeners
    document.querySelectorAll('.rescind-report-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const matchId = this.getAttribute('data-id');
            const match = outstandingMatches.find(m => m.id === matchId);
            
            // Confirm before rescinding
            if (confirm(`Are you sure you want to rescind this match report against ${match.winnerUsername || 'opponent'}?`)) {
                rescindReport(match);
            }
        });
    });
}

// Function to rescind (delete) a report
export async function rescindReport(match) {
    try {
        // Determine which collection to use based on game mode
        const pendingCollection = 
            currentGameMode === 'D1' ? 'pendingMatches' : 
            currentGameMode === 'D2' ? 'pendingMatchesD2' : 'pendingMatchesD3';
        
        // Reference to the document
        const reportRef = doc(db, pendingCollection, match.id);
        
        // Delete the document
        await deleteDoc(reportRef);
        
        // Show success message
        alert('Report has been successfully rescinded.');
        
        // Refresh the matches list
        await fetchOutstandingMatches();
        renderOutstandingMatches();
        
    } catch (error) {
        console.error('Error rescinding report:', error);
        alert('Failed to rescind report. Please try again.');
    }
}

// Function to edit a report - update to properly handle cancellation
export function editReport(match) {
    // Get the report form elements
    const reportForm = document.getElementById('report-form');
    const loserScore = document.getElementById('loser-score');
    const suicides = document.getElementById('suicides');
    const mapPlayed = document.getElementById('map-played');
    const loserComment = document.getElementById('loser-comment');
    
    // Make sure form is visible
    reportForm.style.display = 'block';
    document.getElementById('auth-warning').style.display = 'none';
    
    // Populate form with match data
    if (match.loserScore) loserScore.value = match.loserScore;
    if (match.loserSuicides) suicides.value = match.loserSuicides;
    if (match.mapPlayed) mapPlayed.value = match.mapPlayed;
    if (match.loserComment) loserComment.value = match.loserComment;
    
    // Set the appropriate opponent in the dropdown if available
    const winnerDropdown = document.getElementById('winner-username');
    if (winnerDropdown && match.winnerUsername) {
        // Find and select the correct option
        Array.from(winnerDropdown.options).forEach(option => {
            if (option.text === match.winnerUsername) {
                option.selected = true;
            }
        });
    }

    const subgameType = document.getElementById('subgame-type');
    if (subgameType && match.subgameType) {
        subgameType.value = match.subgameType;
    }
    
    
    // Store the match ID in a data attribute for use when submitting
    reportForm.setAttribute('data-edit-id', match.id);
    
    // Change the submit button text to indicate editing
    const submitBtn = reportForm.querySelector('button[type="submit"]');
    submitBtn.textContent = 'Update Report';
    
    // Add a cancel button if it doesn't exist
    if (!document.getElementById('cancel-edit-btn')) {
        const cancelBtn = document.createElement('button');
        cancelBtn.id = 'cancel-edit-btn';
        cancelBtn.className = 'btn';
        cancelBtn.style.backgroundColor = '#6a1b9a';
        cancelBtn.style.marginRight = '10px';
        cancelBtn.textContent = 'Cancel Edit';
        cancelBtn.type = 'button';
        
        // Insert before the submit button
        submitBtn.parentNode.insertBefore(cancelBtn, submitBtn);
        
        // Add event listener to the cancel button
        cancelBtn.addEventListener('click', function(e) {
            e.preventDefault();  // Ensure it doesn't submit the form
            
            // Reset the form
            reportForm.reset();
            
            // Remove the edit ID
            reportForm.removeAttribute('data-edit-id');
            
            // Change button text back
            submitBtn.textContent = 'Report Game';
            
            // Remove the cancel button
            this.remove();
            
            // Re-initialize the form as needed
            initReportForm();
        });
    }
    
    // Scroll to the form
    reportForm.scrollIntoView({ behavior: 'smooth' });
}

// Helper function to re-initialize the form after cancellation
function initReportForm() {
    // Add any necessary initialization code here
    // This would be specific to your application's needs
    console.log('Report form reset');
}

// Function to show match details in a lightbox
export function showMatchLightbox(match) {
    // Get the lightbox elements
    const lightbox = document.getElementById('report-lightbox');
    
    // Set the game mode in the lightbox
    document.getElementById('lightbox-game-mode').textContent = currentGameMode;
    
    // Fill in match details
    document.getElementById('lightbox-winner').textContent = match.winnerUsername || 'Unknown';
    document.getElementById('lightbox-loser').textContent = match.loserUsername || 'Unknown';
    document.getElementById('lightbox-loser-score').textContent = match.loserScore || '0';
    document.getElementById('lightbox-suicides').textContent = match.loserSuicides || '0';
    document.getElementById('lightbox-map').textContent = match.mapPlayed || 'Unknown';
    document.getElementById('lightbox-comment').textContent = match.loserComment || 'No comment';
    document.getElementById('lightbox-subgame').textContent = match.subgameType || "Standard Match";
    
    // Make lightbox visible
    lightbox.classList.add('show');
}

// Function to set the current game mode
export function setCurrentGameMode(mode) {
    currentGameMode = mode;
}

// Initialize outstanding matches functionality
export function initOutstandingMatches() {
    document.addEventListener('DOMContentLoaded', () => {
        // Elements
        const viewOutstandingBtn = document.getElementById('view-outstanding-btn');
        const viewOutstandingContainer = document.getElementById('view-outstanding-container');
        const outstandingModal = document.getElementById('outstanding-modal');
        const closeOutstandingBtn = document.getElementById('close-outstanding-btn');
        const regularCancelButton = document.getElementById('cancel-button');
        const d1Button = document.getElementById('d1-mode');
        const d2Button = document.getElementById('d2-mode');
        const d3Button = document.getElementById('d3-mode');

        // Update game mode when buttons are clicked
        if (d1Button) d1Button.addEventListener('click', () => { setCurrentGameMode('D1'); });
        if (d2Button) d2Button.addEventListener('click', () => { setCurrentGameMode('D2'); });
        if (d3Button) d3Button.addEventListener('click', () => { setCurrentGameMode('D3'); });

        // Listen for auth state changes to show/hide the button
        auth.onAuthStateChanged(user => {
            if (user) {
                viewOutstandingContainer.style.display = 'block';
            } else {
                viewOutstandingContainer.style.display = 'none';
            }
        });

        // Button click handler
        if (viewOutstandingBtn) {
            viewOutstandingBtn.addEventListener('click', async () => {
                outstandingModal.classList.add('show');
                document.getElementById('outstanding-matches-list').innerHTML = 
                    '<div class="loading">Loading your matches...</div>';
                
                await fetchOutstandingMatches();
                renderOutstandingMatches();
            });
        }
        
        // Close outstanding modal button
        if (closeOutstandingBtn) {
            closeOutstandingBtn.addEventListener('click', () => {
                outstandingModal.classList.remove('show');
            });
        }
        
        // Close main lightbox cancel button
        if (regularCancelButton) {
            regularCancelButton.addEventListener('click', () => {
                document.getElementById('report-lightbox').classList.remove('show');
            });
        }
        
        // Close modal when clicking outside
        if (outstandingModal) {
            outstandingModal.addEventListener('click', (e) => {
                if (e.target === outstandingModal) {
                    outstandingModal.classList.remove('show');
                }
            });
        }
        
        // Close report lightbox when clicking outside
        const reportLightbox = document.getElementById('report-lightbox');
        if (reportLightbox) {
            reportLightbox.addEventListener('click', (e) => {
                if (e.target === reportLightbox) {
                    reportLightbox.classList.remove('show');
                }
            });
        }
        
        // Add the form submission handler for editing reports
        const reportForm = document.getElementById('report-form');
        if (reportForm) {
            // Store the original form submission handler
            const originalSubmitHandler = reportForm.onsubmit;
            
            // Replace with our handler that checks for edits
            reportForm.onsubmit = async function(e) {
                e.preventDefault();
                
                // Check if this is an edit
                const editId = this.getAttribute('data-edit-id');
                
                if (editId) {
                    // This is an edit
                    try {
                        // Get form values
                        const loserScore = document.getElementById('loser-score').value;
                        const suicides = document.getElementById('suicides').value;
                        const mapPlayed = document.getElementById('map-played').value;
                        const loserComment = document.getElementById('loser-comment').value;
                        
                        // Determine which collection to use based on game mode
                        const pendingCollection = 
                            currentGameMode === 'D1' ? 'pendingMatches' : 
                            currentGameMode === 'D2' ? 'pendingMatchesD2' : 'pendingMatchesD3';
                        
                        // Reference to the document
                        const reportRef = doc(db, pendingCollection, editId);
                        
                        // Update the document
                        await updateDoc(reportRef, {
                            loserScore: Number(loserScore),
                            loserSuicides: Number(suicides),
                            mapPlayed: mapPlayed,
                            loserComment: loserComment,
                            subgameType: document.getElementById('subgame-type').value,
                            updatedAt: new Date()
                        });
                        
                        // Show success message
                        alert('Report has been successfully updated.');
                        
                        // Reset the form
                        this.reset();
                        
                        // Remove the edit ID
                        this.removeAttribute('data-edit-id');
                        
                        // Change button text back
                        const submitBtn = this.querySelector('button[type="submit"]');
                        submitBtn.textContent = 'Report Game';
                        
                        // Remove the cancel button if it exists
                        const cancelBtn = document.getElementById('cancel-edit-btn');
                        if (cancelBtn) cancelBtn.remove();
                        
                    } catch (error) {
                        console.error('Error updating report:', error);
                        document.getElementById('report-error').textContent = 'Failed to update report. Please try again.';
                    }
                } else {
                    // Not an edit, use original handler if available
                    if (typeof originalSubmitHandler === 'function') {
                        // Call the original handler in the correct context
                        originalSubmitHandler.call(this, e);
                    }
                }
            };
        }
    });
}

// Make functions available globally for the button handler
if (typeof window !== 'undefined') {
    window.showMatchLightbox = showMatchLightbox;
    window.editReport = editReport;
    window.rescindReport = rescindReport;
    window.fetchOutstandingMatches = fetchOutstandingMatches;
    window.renderOutstandingMatches = renderOutstandingMatches;
}

// Call the initialization function
initOutstandingMatches();