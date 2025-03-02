import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc, getFirestore, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
    const auth = getAuth();
    const db = getFirestore();
    
    const tinyRetireButton = document.getElementById('tiny-retire-button');
    const retirePrompt = document.getElementById('ladder-retire-prompt');
    const retireLadderTypeSpan = document.getElementById('retire-ladder-type');
    const retireUsernameInput = document.getElementById('retire-username-input');
    const retireLadderButton = document.getElementById('retire-ladder-button');
    const retireStatusSpan = document.getElementById('ladder-retire-status');
    
    let currentLadderMode = 'D1'; // Default to D1
    
    // Listen for ladder toggle changes
    const d1Toggle = document.getElementById('d1-toggle');
    const d2Toggle = document.getElementById('d2-toggle');
    
    if (d1Toggle) {
        d1Toggle.addEventListener('click', () => {
            currentLadderMode = 'D1';
            updateRetireButtonVisibility();
            if (retireLadderTypeSpan) retireLadderTypeSpan.textContent = 'D1';
        });
    }
    
    if (d2Toggle) {
        d2Toggle.addEventListener('click', () => {
            currentLadderMode = 'D2';
            updateRetireButtonVisibility();
            if (retireLadderTypeSpan) retireLadderTypeSpan.textContent = 'D2';
        });
    }
    
    // Toggle retire form visibility when tiny retire button is clicked
    if (tinyRetireButton) {
        tinyRetireButton.addEventListener('click', () => {
            console.log("Retire button clicked");
            retirePrompt.style.display = 'flex';
            retireLadderTypeSpan.textContent = currentLadderMode;
            
            // Clear previous feedback
            retireStatusSpan.textContent = '';
            retireUsernameInput.value = '';
        });
    }
    
    // Function to check if current user is on ladder and show/hide retire button
    function updateRetireButtonVisibility() {
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                try {
                    // Determine which collection to check based on ladder mode
                    const playerCollection = currentLadderMode === 'D1' ? 'players' : 'playersD2';
                    const playerRef = doc(db, playerCollection, user.uid);
                    const playerDoc = await getDoc(playerRef);
                    
                    if (playerDoc.exists()) {
                        // User is on the ladder, show retire button
                        tinyRetireButton.style.display = 'block';
                    } else {
                        // User not on this ladder, hide button
                        tinyRetireButton.style.display = 'none';
                    }
                } catch (error) {
                    console.error("Error checking player status:", error);
                    tinyRetireButton.style.display = 'none';
                }
            } else {
                // No user logged in, hide button
                tinyRetireButton.style.display = 'none';
            }
        });
    }
    
    // Handle retire form submission
    if (retireLadderButton) {
        retireLadderButton.addEventListener('click', async () => {
            const username = retireUsernameInput.value.trim();
            
            if (!username) {
                retireStatusSpan.textContent = 'Please enter your username to confirm.';
                retireStatusSpan.style.color = '#ff6b6b';
                return;
            }
            
            const user = auth.currentUser;
            if (!user) {
                retireStatusSpan.textContent = 'You must be logged in to retire.';
                retireStatusSpan.style.color = '#ff6b6b';
                return;
            }
            
            try {
                // Get player doc to verify username
                const playerCollection = currentLadderMode === 'D1' ? 'players' : 'playersD2';
                const playerRef = doc(db, playerCollection, user.uid);
                const playerDoc = await getDoc(playerRef);
                
                if (!playerDoc.exists()) {
                    retireStatusSpan.textContent = 'You are not on this ladder.';
                    retireStatusSpan.style.color = '#ff6b6b';
                    return;
                }
                
                const playerData = playerDoc.data();
                
                // Check username matches
                if (playerData.username.toLowerCase() !== username.toLowerCase()) {
                    retireStatusSpan.textContent = 'Username does not match your account.';
                    retireStatusSpan.style.color = '#ff6b6b';
                    return;
                }
                
                // Delete player from ladder
                await deleteDoc(playerRef);
                
                // Success feedback
                retireStatusSpan.textContent = 'Successfully retired from the ladder!';
                retireStatusSpan.style.color = '#4CAF50';
                
                // Hide retire button and retire form after a delay
                setTimeout(() => {
                    tinyRetireButton.style.display = 'none';
                    retirePrompt.style.display = 'none';
                    
                    // Reload the page to update UI
                    window.location.reload();
                }, 2000);
                
            } catch (error) {
                console.error("Error retiring from ladder:", error);
                retireStatusSpan.textContent = 'Error processing your request. Please try again.';
                retireStatusSpan.style.color = '#ff6b6b';
            }
        });
    }
    
    // Initial check when page loads
    updateRetireButtonVisibility();
});