import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
    doc,
    getDoc,
    getDocs,
    updateDoc,
    deleteDoc,
    query,
    collection,
    where
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { auth, db } from './firebase-config.js';

document.addEventListener('DOMContentLoaded', () => {
    // DOM elements
    const tinyRetireButton = document.getElementById('tiny-retire-button');
    const retirePrompt = document.getElementById('ladder-retire-prompt');
    const retireLadderTypeSpan = document.getElementById('retire-ladder-type');
    const retireUsernameInput = document.getElementById('retire-username-input');
    const retireLadderButton = document.getElementById('retire-ladder-button');
    const retireStatusSpan = document.getElementById('ladder-retire-status');
    
    // New elements for leave team functionality
    const leaveTeamButton = document.getElementById('leave-team-button');
    const leaveTeamPrompt = document.getElementById('leave-team-prompt');
    const leaveTeamStatusSpan = document.getElementById('leave-team-status');
    const confirmLeaveTeamButton = document.getElementById('confirm-leave-team-button');
    const leaveTeamUsernameInput = document.getElementById('leave-team-username-input');
    
    let currentLadderMode = 'D1'; // Default to D1
    
    // Function to get the correct collection name based on ladder type
    function getCollectionName(ladderType) {
        switch(ladderType) {
            case 'D1':
                return 'players';
            case 'D2':
                return 'playersD2';
            case 'D3':
                return 'playersD3';
            case 'DUOS':
                return 'playersDuos';
            case 'CTF':
                return 'playersCTF';
            default:
                return 'players';
        }
    }
    
    // Listen for radio button changes to detect ladder switches
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
                    
                    // Check if we should show the retire/leave team buttons for new ladder
                    updateRetireButtonVisibility();
                }
            });
        });
    }
    
    // Function to show/hide retire and leave team buttons based on ladder membership
    function updateRetireButtonVisibility() {
        console.log("Checking retire visibility for ladder:", currentLadderMode);
        
        const user = auth.currentUser;
        if (!user) {
            if (tinyRetireButton) tinyRetireButton.style.display = 'none';
            if (leaveTeamButton) leaveTeamButton.style.display = 'none';
            return;
        }
        
        checkPlayerStatus(user);
    }
    
    // Check if player is on the selected ladder and if they're in a team
    async function checkPlayerStatus(user) {
        try {
            const playerCollection = getCollectionName(currentLadderMode);
            console.log(`Checking if user is in ${playerCollection} collection`);
            
            const playerRef = doc(db, playerCollection, user.uid);
            const playerDoc = await getDoc(playerRef);
            
            if (playerDoc.exists()) {
                console.log(`User is on the ${currentLadderMode} ladder`);
                if (tinyRetireButton) tinyRetireButton.style.display = 'block';
                
                // Check if user is in a team (for DUOS ladder)
                if (currentLadderMode === 'DUOS') {
                    const playerData = playerDoc.data();
                    if (playerData.hasTeam && playerData.teamId) {
                        console.log("User is in a team, showing leave team button");
                        if (leaveTeamButton) leaveTeamButton.style.display = 'block';
                    } else {
                        console.log("User is not in a team, hiding leave team button");
                        if (leaveTeamButton) leaveTeamButton.style.display = 'none';
                    }
                } else {
                    if (leaveTeamButton) leaveTeamButton.style.display = 'none';
                }
            } else {
                console.log(`User is NOT on the ${currentLadderMode} ladder`);
                if (tinyRetireButton) tinyRetireButton.style.display = 'none';
                if (leaveTeamButton) leaveTeamButton.style.display = 'none';
            }
        } catch (error) {
            console.error("Error checking player status:", error);
            if (tinyRetireButton) tinyRetireButton.style.display = 'none';
            if (leaveTeamButton) leaveTeamButton.style.display = 'none';
        }
    }
    
    // Handle team dissolution for DUOS ladder
    async function handleTeamDissolution(userData, collectionName) {
        if (userData.hasTeam && userData.teamId && userData.teammate) {
            console.log("Dissolving team for retiring player...");
            
            try {
                // Find the teammate and remove their team data
                const playersRef = collection(db, collectionName);
                const teammateQuery = query(playersRef, where('username', '==', userData.teammate));
                const teammateSnapshot = await getDocs(teammateQuery);
                
                if (!teammateSnapshot.empty) {
                    const teammateDoc = teammateSnapshot.docs[0];
                    await updateDoc(teammateDoc.ref, {
                        hasTeam: false,
                        teamId: null,
                        teamName: null,
                        teammate: null,
                        teamColor: null
                    });
                    console.log("Teammate's team data cleared successfully");
                }
            } catch (error) {
                console.error("Error dissolving team:", error);
                // Continue with retirement even if team dissolution fails
            }
        }
    }
    
    // Leave team function (keeps player on ladder but removes team)
    async function leaveTeam(username, user) {
        const playerCollection = getCollectionName(currentLadderMode);
        
        try {
            // Get player document to verify and get team info
            const playerRef = doc(db, playerCollection, user.uid);
            const playerDoc = await getDoc(playerRef);
            
            if (!playerDoc.exists()) {
                throw new Error('You are not on this ladder.');
            }
            
            const playerData = playerDoc.data();
            
            // Verify username matches
            if (playerData.username.toLowerCase() !== username.toLowerCase()) {
                throw new Error('Username does not match your account.');
            }
            
            // Check if player is actually in a team
            if (!playerData.hasTeam || !playerData.teamId) {
                throw new Error('You are not currently in a team.');
            }
            
            // Handle team dissolution
            await handleTeamDissolution(playerData, playerCollection);
            
            // Remove team data from current player but keep them on ladder
            await updateDoc(playerRef, {
                hasTeam: false,
                teamId: null,
                teamName: null,
                teammate: null,
                teamColor: null
            });
            
            return { success: true };
            
        } catch (error) {
            console.error("Error leaving team:", error);
            throw error;
        }
    }
    
    // Main retire function
    async function retireFromLadder(username, user) {
        const playerCollection = getCollectionName(currentLadderMode);
        
        try {
            // Get player document to verify and get team info
            const playerRef = doc(db, playerCollection, user.uid);
            const playerDoc = await getDoc(playerRef);
            
            if (!playerDoc.exists()) {
                throw new Error('You are not on this ladder.');
            }
            
            const playerData = playerDoc.data();
            
            // Verify username matches
            if (playerData.username.toLowerCase() !== username.toLowerCase()) {
                throw new Error('Username does not match your account.');
            }
            
            // Handle special cases for DUOS ladder
            if (currentLadderMode === 'DUOS') {
                await handleTeamDissolution(playerData, playerCollection);
            }
            
            // Delete player from ladder
            await deleteDoc(playerRef);
            
            return { success: true };
            
        } catch (error) {
            console.error("Error retiring from ladder:", error);
            throw error;
        }
    }
    
    // Set up auth state listener
    onAuthStateChanged(auth, (user) => {
        if (user) {
            updateRetireButtonVisibility();
        } else {
            if (tinyRetireButton) tinyRetireButton.style.display = 'none';
            if (leaveTeamButton) leaveTeamButton.style.display = 'none';
            if (retirePrompt) retirePrompt.style.display = 'none';
            if (leaveTeamPrompt) leaveTeamPrompt.style.display = 'none';
        }
    });
    
    // Toggle retire form visibility when tiny retire button is clicked
    if (tinyRetireButton) {
        tinyRetireButton.addEventListener('click', () => {
            console.log("Retire button clicked");
            if (retirePrompt) {
                retirePrompt.style.display = 'flex';
            }
            if (retireLadderTypeSpan) {
                retireLadderTypeSpan.textContent = currentLadderMode;
            }
            
            // Clear previous feedback
            if (retireStatusSpan) {
                retireStatusSpan.textContent = '';
                retireStatusSpan.style.color = '';
            }
            if (retireUsernameInput) {
                retireUsernameInput.value = '';
            }
        });
    }
    
    // Toggle leave team form visibility when leave team button is clicked
    if (leaveTeamButton) {
        leaveTeamButton.addEventListener('click', () => {
            console.log("Leave team button clicked");
            if (leaveTeamPrompt) {
                leaveTeamPrompt.style.display = 'flex';
            }
            
            // Clear previous feedback
            if (leaveTeamStatusSpan) {
                leaveTeamStatusSpan.textContent = '';
                leaveTeamStatusSpan.style.color = '';
            }
            if (leaveTeamUsernameInput) {
                leaveTeamUsernameInput.value = '';
            }
        });
    }
    
    // Handle retire form submission
    if (retireLadderButton) {
        retireLadderButton.addEventListener('click', async () => {
            const username = retireUsernameInput ? retireUsernameInput.value.trim() : '';
            
            // Validation
            if (!username) {
                if (retireStatusSpan) {
                    retireStatusSpan.textContent = 'Please enter your username to confirm.';
                    retireStatusSpan.style.color = '#ff6b6b';
                }
                return;
            }
            
            const user = auth.currentUser;
            if (!user) {
                if (retireStatusSpan) {
                    retireStatusSpan.textContent = 'You must be logged in to retire.';
                    retireStatusSpan.style.color = '#ff6b6b';
                }
                return;
            }
            
            // Disable button and show loading
            retireLadderButton.disabled = true;
            if (retireStatusSpan) {
                retireStatusSpan.textContent = `Retiring from ${currentLadderMode} ladder...`;
                retireStatusSpan.style.color = '#ffa500';
            }
            
            try {
                await retireFromLadder(username, user);
                
                // Success feedback
                if (retireStatusSpan) {
                    retireStatusSpan.textContent = `Successfully retired from ${currentLadderMode} ladder!`;
                    retireStatusSpan.style.color = '#4CAF50';
                }
                
                // Hide retire elements and reload page after delay
                setTimeout(() => {
                    if (tinyRetireButton) tinyRetireButton.style.display = 'none';
                    if (retirePrompt) retirePrompt.style.display = 'none';
                    
                    // Reload the page to update all UI elements
                    window.location.reload();
                }, 2000);
                
            } catch (error) {
                console.error("Error during retirement:", error);
                if (retireStatusSpan) {
                    retireStatusSpan.textContent = error.message || 'Error processing your request. Please try again.';
                    retireStatusSpan.style.color = '#ff6b6b';
                }
                retireLadderButton.disabled = false;
            }
        });
    }
    
    // Handle leave team form submission
    if (confirmLeaveTeamButton) {
        confirmLeaveTeamButton.addEventListener('click', async () => {
            const username = leaveTeamUsernameInput ? leaveTeamUsernameInput.value.trim() : '';
            
            // Validation
            if (!username) {
                if (leaveTeamStatusSpan) {
                    leaveTeamStatusSpan.textContent = 'Please enter your username to confirm.';
                    leaveTeamStatusSpan.style.color = '#ff6b6b';
                }
                return;
            }
            
            const user = auth.currentUser;
            if (!user) {
                if (leaveTeamStatusSpan) {
                    leaveTeamStatusSpan.textContent = 'You must be logged in to leave a team.';
                    leaveTeamStatusSpan.style.color = '#ff6b6b';
                }
                return;
            }
            
            // Disable button and show loading
            confirmLeaveTeamButton.disabled = true;
            if (leaveTeamStatusSpan) {
                leaveTeamStatusSpan.textContent = 'Leaving team...';
                leaveTeamStatusSpan.style.color = '#ffa500';
            }
            
            try {
                await leaveTeam(username, user);
                
                // Success feedback
                if (leaveTeamStatusSpan) {
                    leaveTeamStatusSpan.textContent = 'Successfully left team! You remain on the ladder as a solo player.';
                    leaveTeamStatusSpan.style.color = '#4CAF50';
                }
                
                // Hide leave team elements and reload page after delay
                setTimeout(() => {
                    if (leaveTeamButton) leaveTeamButton.style.display = 'none';
                    if (leaveTeamPrompt) leaveTeamPrompt.style.display = 'none';
                    
                    // Reload the page to update all UI elements
                    window.location.reload();
                }, 2000);
                
            } catch (error) {
                console.error("Error leaving team:", error);
                if (leaveTeamStatusSpan) {
                    leaveTeamStatusSpan.textContent = error.message || 'Error processing your request. Please try again.';
                    leaveTeamStatusSpan.style.color = '#ff6b6b';
                }
                confirmLeaveTeamButton.disabled = false;
            }
        });
    }
    
    // Close retire prompt functionality
    const closeRetireButton = document.querySelector('#ladder-retire-prompt .close-button');
    if (closeRetireButton) {
        closeRetireButton.addEventListener('click', () => {
            if (retirePrompt) retirePrompt.style.display = 'none';
        });
    }
    
    // Close leave team prompt functionality
    const closeLeaveTeamButton = document.querySelector('#leave-team-prompt .close-button');
    if (closeLeaveTeamButton) {
        closeLeaveTeamButton.addEventListener('click', () => {
            if (leaveTeamPrompt) leaveTeamPrompt.style.display = 'none';
        });
    }
    
    // Close on outside click
    if (retirePrompt) {
        retirePrompt.addEventListener('click', (e) => {
            if (e.target === retirePrompt) {
                retirePrompt.style.display = 'none';
            }
        });
    }
    
    // Close leave team on outside click
    if (leaveTeamPrompt) {
        leaveTeamPrompt.addEventListener('click', (e) => {
            if (e.target === leaveTeamPrompt) {
                leaveTeamPrompt.style.display = 'none';
            }
        });
    }
    
    // Initialize everything
    setupRadioListeners();
    
    // Initial check when page loads
    setTimeout(() => {
        updateRetireButtonVisibility();
    }, 1000); // Small delay to ensure auth state is loaded
});