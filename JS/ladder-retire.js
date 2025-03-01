import {
    doc,
    getDoc,
    deleteDoc,
    serverTimestamp,
    setDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth, db } from './firebase-config.js';

// Track currently selected ladder
let currentLadder = 'D1';

document.addEventListener('DOMContentLoaded', () => {
    // Initialize references to elements
    const d1Toggle = document.getElementById('d1-toggle');
    const d2Toggle = document.getElementById('d2-toggle');
    const retirePrompt = document.getElementById('ladder-retire-prompt');
    const retireButton = document.getElementById('retire-ladder-button');
    const retireStatus = document.getElementById('ladder-retire-status');
    const ladderType = document.getElementById('retire-ladder-type');
    
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
    
    // Setup retire button click handler
    if (retireButton) {
        retireButton.addEventListener('click', handleRetireLadder);
    }
    
    // Listen for auth state changes
    onAuthStateChanged(auth, (user) => {
        if (user) {
            checkUserLadderStatus();
        } else {
            if (retirePrompt) {
                retirePrompt.style.display = 'none';
            }
        }
    });
});

// Check if user is part of the selected ladder
async function checkUserLadderStatus() {
    const user = auth.currentUser;
    const retirePrompt = document.getElementById('ladder-retire-prompt');
    const tinyRetireButton = document.getElementById('tiny-retire-button');
    const ladderType = document.getElementById('retire-ladder-type');

    if (!user || !user.uid || !retirePrompt || !tinyRetireButton || !ladderType) {
        // Hide everything if user isn’t signed in or UI elements missing.
        if (retirePrompt) retirePrompt.style.display = 'none';
        if (tinyRetireButton) tinyRetireButton.style.display = 'none';
        return;
    }

    try {
        // Verify authentication validity
        await user.getIdToken(false);
        
        // Determine the collection name based on the current ladder
        const collectionName = currentLadder === 'D1' ? 'players' : 'playersD2';
        const userDocRef = doc(db, collectionName, user.uid);
        const userDoc = await getDoc(userDocRef);
        
        // If the user is on the ladder, show the tiny retire button.
        if (userDoc.exists()) {
            tinyRetireButton.style.display = 'block';
            ladderType.textContent = currentLadder;

            // Toggle the full retire prompt when the tiny button is clicked
            tinyRetireButton.addEventListener('click', () => {
                if (retirePrompt.style.display === 'block') {
                    retirePrompt.style.display = 'none';
                } else {
                    retirePrompt.style.display = 'block';
                }
            });
        } else {
            // Not on ladder, hide the tiny retire button.
            tinyRetireButton.style.display = 'none';
            retirePrompt.style.display = 'none';
        }
    } catch (error) {
        console.error('Error checking ladder status:', error);
        tinyRetireButton.style.display = 'none';
        retirePrompt.style.display = 'none';
    }
}

// Handle the retire ladder button click
async function handleRetireLadder() {
    const user = auth.currentUser;
    const retireButton = document.getElementById('retire-ladder-button');
    const retireStatus = document.getElementById('ladder-retire-status');
    const usernameInput = document.getElementById('retire-username-input');
    
    // First, make sure the user is authenticated
    if (!user || !user.uid) {
        retireStatus.textContent = 'You must be signed in to retire from a ladder.';
        retireStatus.className = 'ladder-retire-status error';
        return;
    }
    
    // Verify authentication state again
    try {
        // This will throw an error if the user's auth token is invalid or expired
        await user.getIdToken(true);
    } catch (authError) {
        console.error("Authentication error:", authError);
        retireStatus.textContent = 'Authentication failed. Please sign in again.';
        retireStatus.className = 'ladder-retire-status error';
        return;
    }
    
    if (!usernameInput || !usernameInput.value.trim()) {
        retireStatus.textContent = 'Please enter your username to confirm.';
        retireStatus.className = 'ladder-retire-status error';
        return;
    }
    
    try {
        // Disable the button and show loading state
        retireButton.disabled = true;
        retireStatus.textContent = `Verifying username...`;
        retireStatus.className = 'ladder-retire-status loading';
        
        // Get the collection name based on the current ladder
        const collectionName = currentLadder === 'D1' ? 'players' : 'playersD2';
        
        // Check if user exists in this ladder collection
        const userDocRef = doc(db, collectionName, user.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (!userDoc.exists()) {
            retireStatus.textContent = `You are not part of the ${currentLadder} ladder.`;
            retireStatus.className = 'ladder-retire-status error';
            retireButton.disabled = false;
            return;
        }
        
        // Get the user's actual username from the document
        const userData = userDoc.data();
        const actualUsername = userData.username;
        
        // Verify the entered username matches the actual username
        const enteredUsername = usernameInput.value.trim();
        
        if (enteredUsername.toLowerCase() !== actualUsername.toLowerCase()) {
            retireStatus.textContent = `Username doesn't match. Please enter "${actualUsername}" to confirm.`;
            retireStatus.className = 'ladder-retire-status error';
            retireButton.disabled = false;
            return;
        }
        
        // Username verified, now continue with the retire process
        retireStatus.textContent = `Retiring from ${currentLadder} ladder...`;
        
        // Add to nonParticipants collection first for record keeping
        await setDoc(doc(db, 'nonParticipants', user.uid), {
            username: actualUsername,
            email: user.email,
            previousRating: userData.eloRating || 1200,
            retiredFrom: currentLadder,
            retiredAt: serverTimestamp(),
            reason: 'User requested retirement'
        });
        
        // Now delete from the active ladder
        await deleteDoc(userDocRef);
        
        // Show success message
        retireStatus.textContent = `Successfully retired from the ${currentLadder} ladder! The page will refresh...`;
        retireStatus.className = 'ladder-retire-status success';
        
        // Refresh the page after a delay to show the updated ladder
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (error) {
        console.error('Error retiring from ladder:', error);
        retireStatus.textContent = `Error retiring from ladder: ${error.message}`;
        retireStatus.className = 'ladder-retire-status error';
        retireButton.disabled = false;
    }
}