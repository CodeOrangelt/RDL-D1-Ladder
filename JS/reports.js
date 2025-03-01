import { approveReport } from './ladderalgorithm.js';
import { 
    collection, getDocs, query, where, 
    orderBy, serverTimestamp, doc, setDoc, getDoc, addDoc, updateDoc 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth, db } from './firebase-config.js';

// Move currentUserEmail to module scope
let currentUserEmail = null;
let confirmationNotification = null; // Also adding this to fix potential undefined error
let outstandingReportData = null; // And this one
let currentGameMode = 'D1'; // Add global variable to track current game mode

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

    // Setup toggle button event listeners
    d1Button.addEventListener('click', () => {
        setGameMode('D1');
        d1Button.classList.add('active');
        d2Button.classList.remove('active');
    });

    d2Button.addEventListener('click', () => {
        setGameMode('D2');
        d2Button.classList.add('active');
        d1Button.classList.remove('active');
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
            
            if (nonParticipantDoc.exists()) {
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
                        d1Button.classList.add('active');
                        d2Button.classList.remove('active');
                    } else if (collectionName === 'playersD2' && currentGameMode !== 'D2') {
                        // User exists in D2 collection but current mode is not D2
                        currentGameMode = 'D2';
                        const d1Button = document.getElementById('d1-mode');
                        const d2Button = document.getElementById('d2-mode');
                        d2Button.classList.add('active');
                        d1Button.classList.remove('active');
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
                elements.authWarning.textContent = 'You are not registered in any ladder.';
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
            for (const collection of ['players', 'playersD2']) {
                if (collection === (currentGameMode === 'D1' ? 'players' : 'playersD2')) {
                    continue; // Skip the current mode's collection as we already checked
                }
                
                const playerRef = doc(db, collection, userUid);
                try {
                    const playerDoc = await getDoc(playerRef);
                    if (playerDoc.exists()) {
                        // Update game mode to the one where user exists
                        const newMode = collection === 'players' ? 'D1' : 'D2';
                        console.log(`User found in ${collection}, switching to ${newMode} mode`);
                        
                        // Update UI to reflect the new mode
                        const d1Button = document.getElementById('d1-mode');
                        const d2Button = document.getElementById('d2-mode');
                        
                        if (newMode === 'D1') {
                            d1Button.classList.add('active');
                            d2Button.classList.remove('active');
                        } else {
                            d2Button.classList.add('active');
                            d1Button.classList.remove('active');
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

async function submitReport(elements) {
    // Use the correct collection based on game mode
    const pendingMatchesCollection = currentGameMode === 'D1' ? 'pendingMatches' : 'pendingMatchesD2';
    const pendingMatchesRef = collection(db, pendingMatchesCollection);
    const newMatchRef = doc(pendingMatchesRef);
    
    try {
        // Get current user's info
        const user = auth.currentUser;
        if (!user) throw new Error("User not authenticated");
        
        const userUid = user.uid;
        const playersCollection = currentGameMode === 'D1' ? 'players' : 'playersD2';
        
        // Get current user (loser) document
        const loserDoc = await getDoc(doc(db, playersCollection, userUid));
        if (!loserDoc.exists()) throw new Error("Your player profile not found");
        
        // Get winner username from select
        const winnerUsername = elements.winnerUsername.value;
        if (!winnerUsername) throw new Error("Please select an opponent");
        
        // Find winner by username
        const winnerQuery = query(collection(db, playersCollection), where("username", "==", winnerUsername));
        const winnerSnapshot = await getDocs(winnerQuery);
        
        if (winnerSnapshot.empty) throw new Error("Selected opponent not found");
        
        const winnerData = winnerSnapshot.docs[0].data();
        const winnerId = winnerSnapshot.docs[0].id;
        
        const reportData = {
            matchId: newMatchRef.id,
            loserUsername: loserDoc.data().username,
            loserId: userUid,
            winnerUsername: winnerData.username,
            winnerId: winnerId,
            loserScore: elements.loserScore.value,
            suicides: elements.suicides.value,
            mapPlayed: elements.mapPlayed.value,
            loserComment: elements.loserComment.value,
            gameMode: currentGameMode,
            approved: false,
            createdAt: serverTimestamp()
        };
        
        await setDoc(newMatchRef, reportData);
        console.log(`Match reported in ${pendingMatchesCollection} with ID: ${newMatchRef.id}`);
        
        // Success feedback
        elements.reportError.textContent = "Game reported successfully!";
        elements.reportError.style.color = "green";
        
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
    const pendingCollection = collectionName || (currentGameMode === 'D1' ? 'pendingMatches' : 'pendingMatchesD2');
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
        } else {
            console.log("No pending matches found for this user");
        }
    } catch (error) {
        console.error('Error checking outstanding reports:', error);
    }
}

// Update the autoFillReportForm function to handle both D1 and D2 ladders
function autoFillReportForm(reportData) {
    console.log("Report Data in autoFillReportForm:", reportData);
    if (reportData) {
        // Calculate winner score based on loser score
        const loserScore = parseInt(reportData.loserScore || "0");
        const winnerScore = loserScore < 18 ? 20 : loserScore + 2;
        
        // Determine which collection to use based on the report data or current game mode
        const gameMode = reportData.gameMode || currentGameMode;
        const playersCollection = gameMode === 'D1' ? 'players' : 'playersD2';
        
        console.log(`Using players collection: ${playersCollection} for game mode: ${gameMode}`);

        // Get the winner's data using winnerId or username
        let winnerPromise;
        
        if (reportData.winnerId) {
            // Get winner by ID
            winnerPromise = getDoc(doc(db, playersCollection, reportData.winnerId))
                .then(docSnap => docSnap.exists() ? {
                    id: docSnap.id,
                    data: docSnap.data()
                } : null);
        } else {
            // Try to get winner by username
            winnerPromise = getDocs(query(
                collection(db, playersCollection), 
                where("username", "==", reportData.winnerUsername)
            )).then(snapshot => !snapshot.empty ? {
                id: snapshot.docs[0].id,
                data: snapshot.docs[0].data()
            } : null);
        }
        
        // Get the loser's data using loserId or username
        let loserPromise;
        
        if (reportData.loserId) {
            // Get loser by ID
            loserPromise = getDoc(doc(db, playersCollection, reportData.loserId))
                .then(docSnap => docSnap.exists() ? {
                    id: docSnap.id,
                    data: docSnap.data()
                } : null);
        } else {
            // Try to get loser by username
            loserPromise = getDocs(query(
                collection(db, playersCollection), 
                where("username", "==", reportData.loserUsername)
            )).then(snapshot => !snapshot.empty ? {
                id: snapshot.docs[0].id,
                data: snapshot.docs[0].data()
            } : null);
        }
        
        // Process both promises
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
                
                const winnerUsername = winnerResult.data.username;
                const loserUsername = loserResult.data.username;
                
                console.log(`Winner: ${winnerUsername}, Loser: ${loserUsername}`);

                // Populate the lightbox
                const lightbox = document.getElementById('report-lightbox');
                if (!lightbox) {
                    console.error('Lightbox element not found');
                    return;
                }
                
                const lightboxWinner = document.getElementById('lightbox-winner');
                const lightboxLoser = document.getElementById('lightbox-loser');
                const lightboxLoserScore = document.getElementById('lightbox-loser-score');
                const lightboxSuicides = document.getElementById('lightbox-suicides');
                const lightboxMap = document.getElementById('lightbox-map');
                const lightboxComment = document.getElementById('lightbox-comment');
                
                if (!lightboxWinner || !lightboxLoser || !lightboxLoserScore || 
                    !lightboxSuicides || !lightboxMap || !lightboxComment) {
                    console.error('Some lightbox elements not found');
                    return;
                }
                
                lightboxWinner.textContent = winnerUsername;
                lightboxLoser.textContent = loserUsername;
                lightboxLoserScore.textContent = reportData.loserScore || "0";
                lightboxSuicides.textContent = reportData.suicides || "0";
                lightboxMap.textContent = reportData.mapPlayed || "Not specified";
                lightboxComment.textContent = reportData.loserComment || "No comment";

                // Set and disable winner score input
                const winnerScoreInput = document.getElementById('winner-score');
                if (winnerScoreInput) {
                    winnerScoreInput.value = winnerScore;
                    winnerScoreInput.readOnly = true; // Make it read-only
                    winnerScoreInput.style.backgroundColor = 'rgba(255, 255, 255, 0.05)'; // Visual indication it's readonly
                }

                // Show the lightbox
                showLightbox();

                // Add event listener to the Approve button
                const approveButton = document.getElementById('approve-button');
                if (approveButton) {
                    // Remove any existing event listeners to prevent duplicates
                    const newApproveButton = approveButton.cloneNode(true);
                    approveButton.parentNode.replaceChild(newApproveButton, approveButton);
                    
                    newApproveButton.addEventListener('click', async function() {
                        try {
                            const winnerScore = document.getElementById('winner-score').value;
                            const winnerSuicides = document.getElementById('winner-suicides').value || "0";
                            const winnerComment = document.getElementById('winner-comment').value || "";
                            
                            // Determine which collection to use for approval
                            const pendingCollection = gameMode === 'D1' ? 'pendingMatches' : 'pendingMatchesD2';
                            const approvedCollection = gameMode === 'D1' ? 'approvedMatches' : 'approvedMatchesD2';
                            
                            await approveReport(reportData.id, winnerScore, winnerSuicides, winnerComment, 
                                                pendingCollection, approvedCollection, gameMode);
                            
                            document.getElementById('report-lightbox').style.display = 'none';
                            alert('Match approved successfully');
                            location.reload(); // Refresh to update the UI

                            // After approving the match and updating ELO ratings…
                            const playersCollection = gameMode === 'D1' ? 'players' : 'playersD2';
                            const winnerRef = doc(db, playersCollection, winnerId); // Assume winnerId is available
                            const loserRef  = doc(db, playersCollection, loserId);  // Assume loserId is available

                            const [winnerSnap, loserSnap] = await Promise.all([getDoc(winnerRef), getDoc(loserRef)]);
                            if (winnerSnap.exists() && loserSnap.exists()) {
                                const winnerData = winnerSnap.data();
                                const loserData = loserSnap.data();
                                // If winner is ranked lower (position number higher) than loser, update position
                                if (winnerData.position > loserData.position) {
                                    await updateDoc(winnerRef, { position: loserData.position });
                                    console.log(`Winner ${winnerData.username} moved to position ${loserData.position}`);
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

                // Add event listener to the Cancel button
                const cancelButton = document.getElementById('cancel-button');
                if (cancelButton) {
                    // Remove any existing event listeners
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
        const playersCollection = currentGameMode === 'D1' ? 'players' : 'playersD2';
        console.log(`Loading opponents from collection: ${playersCollection}`);
        
        // Get current user's document
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

// New function to check if user is in the selected ladder and load opponents if so
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
        const playersCollection = currentGameMode === 'D1' ? 'players' : 'playersD2';
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
        const pendingMatchesCollection = currentGameMode === 'D1' ? 'pendingMatches' : 'pendingMatchesD2';
        await checkForOutstandingReports(currentUserData.email, null, pendingMatchesCollection);
        
        return true;
    } catch (error) {
        console.error('Error checking if user is in ladder:', error);
        document.getElementById('report-error').textContent = 'Error checking ladder membership. Please try again later.';
        document.getElementById('report-error').style.color = 'red';
        return false;
    }
}