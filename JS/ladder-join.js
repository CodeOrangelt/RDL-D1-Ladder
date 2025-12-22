// Language: JavaScript
// filepath: /c:/Descent Nexus Repo/RDL-D1-Ladder/JS/ladder-join.js

import {
    doc,
    getDoc,
    getDocs,
    setDoc,
    query,
    collection,
    orderBy,
    limit,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth, db } from './firebase-config.js';

// Track currently selected ladder
let currentLadder = 'D1';

document.addEventListener('DOMContentLoaded', () => {
    // Listen for radio button changes instead of button clicks
    const d1Radio = document.getElementById('d1-switch');
    const d2Radio = document.getElementById('d2-switch');
    
    console.log("Ladder join: D1 radio found:", !!d1Radio);
    console.log("Ladder join: D2 radio found:", !!d2Radio);
    
    // Setup radio change handlers
    function setupRadioListeners() {
        document.querySelectorAll('input[name="ladder"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.checked) {
                    currentLadder = e.target.value;
                    console.log(`Ladder changed to: ${currentLadder}`);
                    checkUserLadderStatus();
                }
            });
        });
    }
    
    // Call the setup function
    setupRadioListeners();
    
    // Setup join button click handler
    const joinButton = document.getElementById('join-ladder-button');
    if (joinButton) {
        joinButton.addEventListener('click', handleJoinLadder);
    }
    
    // Listen for auth state changes
    onAuthStateChanged(auth, (user) => {
        if (user) {
            checkUserLadderStatus();
        } else {
            const joinPrompt = document.getElementById('ladder-join-prompt');
            if (joinPrompt) {
                joinPrompt.style.display = 'none';
            }
        }
    });
});

// Update the getCollectionName function to ensure proper Duos support
function getCollectionName(ladderType) {
    switch(ladderType?.toUpperCase()) {
        case 'D1':
            return 'players';
        case 'D2':
            return 'playersD2';
        case 'D3':
            return 'playersD3';
        case 'DUOS':
        case 'DUO':
            return 'playersDuos';
        case 'FFA':
            return 'playersFFA';
        default:
            console.warn(`Unknown ladder type: ${ladderType}, defaulting to D1`);
            return 'players';
    }
}

// Update the checkUserLadderStatus function with additional security checks
async function checkUserLadderStatus() {
    console.log("Checking user status for ladder:", currentLadder);

    const user = auth.currentUser;
    const joinPrompt = document.getElementById('ladder-join-prompt');
    const joinLadderType = document.getElementById('join-ladder-type');
    const tinyJoinButton = document.getElementById('tiny-join-button');
    
    if (!user || !user.uid || !joinPrompt || !joinLadderType || !tinyJoinButton) {
        // If no user or UI elements missing, hide the join prompt and tiny join button
        if (joinPrompt) joinPrompt.style.display = 'none';
        if (tinyJoinButton) tinyJoinButton.style.display = 'none';
        return;
    }
    
    try {
        // Verify authentication is valid
        try {
            await user.getIdToken(false); // Check token without forcing refresh
        } catch (authError) {
            console.error("Authentication verification failed:", authError);
            joinPrompt.style.display = 'none';
            tinyJoinButton.style.display = 'none';
            return;
        }
        
        // Get the collection name based on the current ladder - UPDATED TO USE HELPER FUNCTION
        const collectionName = getCollectionName(currentLadder);
        
        // Check if user exists in this ladder collection
        const userDocRef = doc(db, collectionName, user.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (userDoc.exists()) {
            // User is already on this ladder, hide both the join prompt and tiny join button
            joinPrompt.style.display = 'none';
            tinyJoinButton.style.display = 'none';
        } else {
            // User is not on this ladder: show the tiny join button and prepare the join prompt.
            joinPrompt.style.display = 'none'; // Hide full prompt by default.
            tinyJoinButton.style.display = 'block';
            joinLadderType.textContent = currentLadder;
            
            // Toggle the join prompt when the tiny join button is clicked.
            tinyJoinButton.onclick = () => {
                if (joinPrompt.style.display === 'block') {
                    joinPrompt.style.display = 'none';
                } else {
                    joinPrompt.style.display = 'block';
                }
            };

            // Clear any previous inputs and status messages
            const usernameInput = document.getElementById('join-username-input');
            const joinStatus = document.getElementById('ladder-join-status');
            if (usernameInput) usernameInput.value = '';
            if (joinStatus) {
                joinStatus.textContent = '';
                joinStatus.className = 'ladder-join-status';
            }
        }
    } catch (error) {
        console.error('Error checking ladder status:', error);
        joinPrompt.style.display = 'none'; // Hide on error as a safety measure
        tinyJoinButton.style.display = 'none';
    }
}

// Update the handleJoinLadder function to support DUOS
async function handleJoinLadder() {
    const user = auth.currentUser;
    const joinButton = document.getElementById('join-ladder-button');
    const joinStatus = document.getElementById('ladder-join-status');
    const usernameInput = document.getElementById('join-username-input');
    
    // First, make sure the user is authenticated
    if (!user || !user.uid) {
        joinStatus.textContent = 'You must be signed in to join a ladder.';
        joinStatus.className = 'ladder-join-status error';
        return;
    }
    
    // Verify authentication state again
    try {
        // This will throw an error if the user's auth token is invalid or expired
        await user.getIdToken(true);
    } catch (authError) {
        console.error("Authentication error:", authError);
        joinStatus.textContent = 'Authentication failed. Please sign in again.';
        joinStatus.className = 'ladder-join-status error';
        return;
    }
    
    if (!usernameInput || !usernameInput.value.trim()) {
        joinStatus.textContent = 'Please enter your username to confirm.';
        joinStatus.className = 'ladder-join-status error';
        return;
    }
    
    try {
        // Disable the button and show loading state
        joinButton.disabled = true;
        joinStatus.textContent = `Verifying username...`;
        joinStatus.className = 'ladder-join-status loading';
        
        // First, find the user's actual username across collections
        let actualUsername = '';
        let userData = null;
        const collections = ['players', 'playersD2', 'playersD3', 'playersDuos', 'playersFFA', 'nonParticipants'];
        
        for (const collection of collections) {
            try {
                const docRef = doc(db, collection, user.uid);
                const docSnap = await getDoc(docRef);
                
                if (docSnap.exists()) {
                    userData = docSnap.data();
                    if (userData.username) {
                        actualUsername = userData.username;
                        break;
                    }
                }
            } catch (error) {
                console.error(`Error checking ${collection}:`, error);
            }
        }
        
        // If we couldn't find a username, use email as fallback
        if (!actualUsername && user.email) {
            actualUsername = user.email.split('@')[0];
        }
        
        // If we still don't have a username, reject the attempt
        if (!actualUsername) {
            joinStatus.textContent = 'Could not verify your account. Please contact an administrator.';
            joinStatus.className = 'ladder-join-status error';
            joinButton.disabled = false;
            return;
        }
        
        // Verify the entered username matches the actual username
        const enteredUsername = usernameInput.value.trim();
        
        if (actualUsername && enteredUsername.toLowerCase() !== actualUsername.toLowerCase()) {
            joinStatus.textContent = `Username doesn't match. Please enter "${actualUsername}" to confirm.`;
            joinStatus.className = 'ladder-join-status error';
            joinButton.disabled = false;
            return;
        }
        
        // Username verified, now continue with the join process
        joinStatus.textContent = `Joining ${currentLadder} ladder...`;
        
        // Get the collection name based on the current ladder - UPDATED TO INCLUDE DUOS
        const collectionName = getCollectionName(currentLadder);
        
        // Check if user already exists in this ladder collection
        const userDocRef = doc(db, collectionName, user.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (userDoc.exists()) {
            joinStatus.textContent = `You are already part of the ${currentLadder} ladder.`;
            joinStatus.className = 'ladder-join-status error';
            joinButton.disabled = false;
            return;
        }
        
        // Verify the user's authentication again before adding them to the ladder
        try {
            await user.getIdToken(true); // Force token refresh to verify auth state
        } catch (authError) {
            joinStatus.textContent = 'Authentication failed. Please sign in again.';
            joinStatus.className = 'ladder-join-status error';
            joinButton.disabled = false;
            return;
        }
        
        // Use the verified username
        const username = actualUsername;
        
        // Get the next available position number for the ladder
        const playersRef = collection(db, collectionName);
        const playersQuery = query(playersRef, orderBy("position", "desc"), limit(1));
        const playersSnapshot = await getDocs(playersQuery);
        
        let nextPosition = 1;
        if (!playersSnapshot.empty) {
            const highestPositionDoc = playersSnapshot.docs[0].data();
            nextPosition = (highestPositionDoc.position || 0) + 1;
        }
        
        // Check if this player previously existed in this ladder (unhiatus case)
        let previousElo = null;
        
        // FFA is COMPLETELY SEPARATE from other ladders
        // - Players joining FFA from D1/D2/D3/DUOS/nonParticipants start at 1200
        // - Players RETURNING to FFA from hiatus keep their previous FFA ELO
        if (currentLadder === 'FFA') {
            // Check if the user previously existed in the FFA collection specifically
            // (userData might be from a different collection like D1, D2, etc.)
            try {
                const ffaDocRef = doc(db, 'playersFFA', user.uid);
                const ffaDocSnap = await getDoc(ffaDocRef);
                if (ffaDocSnap.exists()) {
                    const ffaData = ffaDocSnap.data();
                    if (ffaData.eloRating && ffaData.eloRating > 0) {
                        previousElo = ffaData.eloRating;
                        console.log(`FFA hiatus return detected - restoring ELO: ${previousElo}`);
                    }
                }
            } catch (error) {
                console.error('Error checking FFA history:', error);
            }
            // If no previous FFA ELO found, previousElo remains null (will use 1200)
        } else if (userData) {
            // For non-FFA ladders, check for returning players from userData
            if (userData.eloRating) {
                previousElo = userData.eloRating;
            }
        }
        
        // Determine starting ELO based on ladder type
        // FFA: 1200 for new players
        // Other ladders: 200 for new players
        let startingElo;
        if (currentLadder === 'FFA') {
            startingElo = 1200; // FFA starts at 1200
        } else {
            startingElo = 200; // D1, D2, D3, DUOS start at 200
        }
        
        // Final ELO calculation
        // Use previousElo if returning from hiatus, otherwise use startingElo
        let finalElo = (previousElo && previousElo > 0) ? previousElo : startingElo;
    
        // Create a proper playerData variable first
        const playerData = {
            username: username,
            email: user.email,
            eloRating: finalElo,
            position: nextPosition,
            createdAt: serverTimestamp(),
            isAdmin: false,
            matches: 0,
            wins: 0,
            losses: 0,
            gameMode: currentLadder,
            // Enhanced team-related fields for DUOS
            ...(currentLadder === 'DUOS' && {
                hasTeam: false,
                teamId: null,
                teamName: null,
                teammate: null,
                teamColor: null,
                lookingForTeam: true,
                tierValue: 1000
            })
        };

        // Now playerData is defined and can be used
        await setDoc(userDocRef, playerData);
        
        // Show success message with Duos-specific guidance
        if (currentLadder === 'DUOS') {
            joinStatus.textContent = `Successfully joined the Duos ladder! You can now form teams with other players. The page will refresh...`;
        } else {
            joinStatus.textContent = `Successfully joined the ${currentLadder} ladder! The page will refresh...`;
        }
        joinStatus.className = 'ladder-join-status success';
        
        // Refresh the page after a delay to show the updated ladder
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (error) {
        console.error('Error joining ladder:', error);
        joinStatus.textContent = `Error joining ladder: ${error.message}`;
        joinStatus.className = 'ladder-join-status error';
        joinButton.disabled = false;
    }
}