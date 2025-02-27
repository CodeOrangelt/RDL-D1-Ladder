import { approveReport } from './ladderalgorithm.js';
import { 
    collection, getDocs, query, where, 
    orderBy, serverTimestamp, doc, setDoc, getDoc, addDoc 
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

async function checkForOutstandingReports(username, elements) {
    console.log("Checking reports for email:", currentUserEmail);
    
    try {
        const pendingMatchesRef = collection(db, 'pendingMatches');
        const q = query(
            pendingMatchesRef,
            where('winnerEmail', '==', currentUserEmail),
            where('approved', '==', false)
        );
        
        const snapshot = await getDocs(q);
        console.log("Query results:", snapshot.size, "matches found");
        
        snapshot.forEach(doc => {
            const data = doc.data();
            console.log("Report data:", data);
            // Add the document ID to the data
            data.id = doc.id;
            autoFillReportForm(data);
        });
    } catch (error) {
        console.error('Error checking outstanding reports:', error);
    }
}

function autoFillReportForm(reportData) {
    console.log("Report Data in autoFillReportForm:", reportData);
    if (reportData) {
        // Calculate winner score based on loser score
        const loserScore = parseInt(reportData.loserScore);
        const winnerScore = loserScore < 18 ? 20 : loserScore + 2;

        // Fetch the winner's username
        const winnerQuery = query(
            collection(db, 'players'),
            where('email', '==', reportData.winnerEmail)
        );
        
        getDocs(winnerQuery)
            .then(winnerQuerySnapshot => {
                if (!winnerQuerySnapshot.empty) {
                    const winnerDoc = winnerQuerySnapshot.docs[0];
                    const winnerUsername = winnerDoc.data().username;

                    // Fetch the loser's username
                    const loserQuery = query(
                        collection(db, 'players'),
                        where('username', '==', reportData.loserUsername)
                    );
                    
                    return getDocs(loserQuery).then(loserQuerySnapshot => {
                        if (!loserQuerySnapshot.empty) {
                            const loserDoc = loserQuerySnapshot.docs[0];
                            const loserUsername = loserDoc.data().username;

                            // Populate the lightbox
                            document.getElementById('lightbox-winner').textContent = winnerUsername;
                            document.getElementById('lightbox-loser').textContent = loserUsername;
                            document.getElementById('lightbox-loser-score').textContent = reportData.loserScore;
                            document.getElementById('lightbox-suicides').textContent = reportData.suicides;
                            document.getElementById('lightbox-map').textContent = reportData.mapPlayed;
                            document.getElementById('lightbox-comment').textContent = reportData.loserComment;

                            // Set and disable winner score input
                            const winnerScoreInput = document.getElementById('winner-score');
                            winnerScoreInput.value = winnerScore;
                            winnerScoreInput.readOnly = true; // Make it read-only
                            winnerScoreInput.style.backgroundColor = 'rgba(255, 255, 255, 0.05)'; // Visual indication it's readonly

                            // Show the lightbox
                            showLightbox();

                            // Add event listener to the Approve button
                            const approveButton = document.getElementById('approve-button');
                            const approveReportHandler = async function() {
                                try {
                                    const winnerScore = document.getElementById('winner-score').value;
                                    const winnerSuicides = document.getElementById('winner-suicides').value;
                                    const winnerComment = document.getElementById('winner-comment').value;

                                    await approveReport(reportData.id, winnerScore, winnerSuicides, winnerComment);
                                    document.getElementById('report-lightbox').style.display = 'none';
                                    alert('Match approved successfully');
                                    location.reload(); // Refresh to update the UI
                                } catch (error) {
                                    console.error('Error approving report:', error);
                                    alert('Error approving match: ' + error.message);
                                }
                            };
                            approveButton.addEventListener('click', approveReportHandler);

                            // Add event listener to the Cancel button
                            document.getElementById('cancel-button').addEventListener('click', hideLightbox);
                        } else {
                            console.error('No loser found with username:', reportData.loserUsername);
                            alert('Error: No loser found with that username.');
                        }
                    });
                } else {
                    console.error('No winner found with email:', reportData.winnerEmail);
                    alert('Error: No winner found with that email.');
                }
            })
            .catch(error => {
                console.error('Error fetching player data:', error);
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