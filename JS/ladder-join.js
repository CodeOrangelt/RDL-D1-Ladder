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
    // Initialize references to elements
    const d1Toggle = document.getElementById('d1-toggle');
    const d2Toggle = document.getElementById('d2-toggle');
    const joinPrompt = document.getElementById('ladder-join-prompt');
    const joinButton = document.getElementById('join-ladder-button');
    const joinStatus = document.getElementById('ladder-join-status');
    
    // Setup click handlers for the toggle buttons to update current ladder
    if (d1Toggle && d2Toggle) {
        d1Toggle.addEventListener('click', () => {
            currentLadder = 'D1';
            checkUserLadderStatus();
        });
        
        d2Toggle.addEventListener('click', () => {
            currentLadder = 'D2';
            checkUserLadderStatus();
        });
    }
    
    // Setup join button click handler
    if (joinButton) {
        joinButton.addEventListener('click', handleJoinLadder);
    }
    
    // Listen for auth state changes
    onAuthStateChanged(auth, (user) => {
        if (user) {
            checkUserLadderStatus();
        } else {
            if (joinPrompt) {
                joinPrompt.style.display = 'none';
            }
        }
    });
});

// Update the checkUserLadderStatus function with additional security checks
async function checkUserLadderStatus() {
    const user = auth.currentUser;
    const joinPrompt = document.getElementById('ladder-join-prompt');
    const joinLadderType = document.getElementById('join-ladder-type');
    
    if (!user || !user.uid || !joinPrompt || !joinLadderType) {
        // If no user or invalid user, hide the join prompt
        if (joinPrompt) {
            joinPrompt.style.display = 'none';
        }
        return;
    }
    
    try {
        // Verify authentication is valid
        try {
            await user.getIdToken(false); // Check token without forcing refresh
        } catch (authError) {
            console.error("Authentication verification failed:", authError);
            joinPrompt.style.display = 'none';
            return;
        }
        
        // Get the collection name based on the current ladder
        const collectionName = currentLadder === 'D1' ? 'players' : 'playersD2';
        
        // Check if user exists in this ladder collection
        const userDocRef = doc(db, collectionName, user.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (userDoc.exists()) {
            // User is part of this ladder, hide the join prompt
            joinPrompt.style.display = 'none';
        } else {
            // User is not part of this ladder, show the join prompt
            joinPrompt.style.display = 'block';
            joinLadderType.textContent = currentLadder;
            
            // Clear any previous inputs and status messages
            const usernameInput = document.getElementById('join-username-input');
            const joinStatus = document.getElementById('ladder-join-status');
            
            if (usernameInput) {
                usernameInput.value = '';
            }
            
            if (joinStatus) {
                joinStatus.textContent = '';
                joinStatus.className = 'ladder-join-status';
            }
        }
    } catch (error) {
        console.error('Error checking ladder status:', error);
        joinPrompt.style.display = 'none'; // Hide on error as a safety measure
    }
}

// Update the handleJoinLadder function to properly verify authentication
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
        const collections = ['players', 'playersD2', 'playersD3', 'playersDuos', 'playersCTF', 'nonParticipants'];
        
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
        
        // Get the collection name based on the current ladder
        const collectionName = currentLadder === 'D1' ? 'players' : 'playersD2';
        
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
        
        // Create player document in the ladder collection
        await setDoc(userDocRef, {
            username: username,
            email: user.email,
            eloRating: 1200,
            position: nextPosition,
            createdAt: serverTimestamp(),
            isAdmin: false,
            matches: 0,
            wins: 0,
            losses: 0,
            gameMode: currentLadder
        });
        
        // Show success message
        joinStatus.textContent = `Successfully joined the ${currentLadder} ladder! The page will refresh...`;
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