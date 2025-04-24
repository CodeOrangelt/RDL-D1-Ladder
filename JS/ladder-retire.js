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
    
    // Listen for radio button changes instead of button clicks
    function setupRadioListeners() {
        document.querySelectorAll('input[name="ladder"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.checked) {
                    currentLadderMode = e.target.value;
                    console.log(`Retire: Ladder changed to: ${currentLadderMode}`);
                    
                    // Update UI elements
                    if (retireLadderTypeSpan) {
                        retireLadderTypeSpan.textContent = currentLadderMode;
                    }
                    
                    // Check if we should show the retire button
                    updateRetireButtonVisibility();
                }
            });
        });
    }
    
    // Call the setup function
    setupRadioListeners();
    
    // Function to show/hide retire button based on ladder membership
    function updateRetireButtonVisibility() {
        console.log("Checking retire visibility for ladder:", currentLadderMode);
        
        const user = auth.currentUser;
        if (!user || !tinyRetireButton) return;
        
        checkPlayerStatus(user);
    }
    
    // Check if player is on the selected ladder
    async function checkPlayerStatus(user) {
        try {
            const playerCollection = 
                currentLadderMode === 'D1' ? 'players' : 
                currentLadderMode === 'D2' ? 'playersD2' : 'playersD3';
            console.log(`Checking if user is in ${playerCollection} collection`);
            
            const playerRef = doc(db, playerCollection, user.uid);
            const playerDoc = await getDoc(playerRef);
            
            if (playerDoc.exists()) {
                console.log(`User is on the ${currentLadderMode} ladder`);
                tinyRetireButton.style.display = 'block';
            } else {
                console.log(`User is NOT on the ${currentLadderMode} ladder`);
                tinyRetireButton.style.display = 'none';
            }
        } catch (error) {
            console.error("Error checking player status:", error);
            if (tinyRetireButton) tinyRetireButton.style.display = 'none';
        }
    }
    
    // Set up auth state listener
    onAuthStateChanged(auth, (user) => {
        if (user) {
            checkPlayerStatus(user);
        } else {
            if (tinyRetireButton) tinyRetireButton.style.display = 'none';
        }
    });
    
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
                const playerCollection = 
                    currentLadderMode === 'D1' ? 'players' : 
                    currentLadderMode === 'D2' ? 'playersD2' : 'playersD3';
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