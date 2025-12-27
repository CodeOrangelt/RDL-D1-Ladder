import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
    doc,
    getDoc,
    getDocs,
    updateDoc,
    deleteDoc,
    setDoc,
    query,
    collection,
    where,
    orderBy,
    limit
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { auth, db } from './firebase-config.js';

document.addEventListener('DOMContentLoaded', () => {
    // DOM elements - removed retirement elements
    
    // New elements for leave team functionality
    const leaveTeamButton = document.getElementById('leave-team-button');
    const leaveTeamPrompt = document.getElementById('leave-team-prompt');
    const leaveTeamStatusSpan = document.getElementById('leave-team-status');
    const confirmLeaveTeamButton = document.getElementById('confirm-leave-team-button');
    const leaveTeamUsernameInput = document.getElementById('leave-team-username-input');
    
    // New elements for hiatus functionality
    const hiatusButton = document.getElementById('hiatus-button');
    const hiatusPrompt = document.getElementById('hiatus-prompt');
    const hiatusLadderTypeSpan = document.getElementById('hiatus-ladder-type');
    const hiatusUsernameInput = document.getElementById('hiatus-username-input');
    const confirmHiatusButton = document.getElementById('confirm-hiatus-button');
    const hiatusStatusSpan = document.getElementById('hiatus-status');

    // Removed duplicate declaration of unhiatusButton
    const unhiatusPrompt = document.getElementById('unhiatus-prompt');
    const unhiatusLadderTypeSpan = document.getElementById('unhiatus-ladder-type');
    const unhiatusUsernameInput = document.getElementById('unhiatus-username-input');
    const confirmUnhiatusButton = document.getElementById('confirm-unhiatus-button');
    const unhiatusStatusSpan = document.getElementById('unhiatus-status');
    
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
            case 'FFA':
                return 'playersFFA';
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
                    console.log(`Ladder changed to: ${currentLadderMode}`);
                    
                    // Check if we should show the leave team buttons for new ladder
                    updateButtonVisibility();
                }
            });
        });
    }
    
    // Function to show/hide leave team and hiatus buttons based on ladder membership
    function updateButtonVisibility() {
        console.log("Checking button visibility for ladder:", currentLadderMode);
        
        const user = auth.currentUser;
        if (!user) {
            if (leaveTeamButton) leaveTeamButton.style.display = 'none';
            if (hiatusButton) hiatusButton.style.display = 'none';
            if (unhiatusButton) unhiatusButton.style.display = 'none';
            return;
        }
        
        checkPlayerStatus(user);
    }
    
    // Check if player is on the selected ladder and if they're in a team
async function checkPlayerStatus(user) {
    try {
        // First check if user is on hiatus - with proper error handling
        try {
            const hiatusRef = doc(db, 'playerHiatus', user.uid);
            const hiatusDoc = await getDoc(hiatusRef);

            if (hiatusDoc.exists()) {
                const hiatusData = hiatusDoc.data();
                if (hiatusData.fromLadder === currentLadderMode) {
                    // Only hide hiatus button if on hiatus from the current ladder
                    if (unhiatusButton) unhiatusButton.style.display = 'block';
                    if (leaveTeamButton) leaveTeamButton.style.display = 'none';
                    if (hiatusButton) hiatusButton.style.display = 'none';
                    return;
                }
            }
            if (unhiatusButton) unhiatusButton.style.display = 'none';

        } catch (hiatusError) {
            console.warn("Error checking hiatus status (this is expected if permissions aren't set):", hiatusError);
            // Continue with normal ladder check even if hiatus check fails
        }
        
        // Check ladder membership
        try {
            const playerCollection = getCollectionName(currentLadderMode);
            console.log(`Checking if user is in ${playerCollection} collection`);
            
            const playerRef = doc(db, playerCollection, user.uid);
            const playerDoc = await getDoc(playerRef);
            
            if (playerDoc.exists()) {
                console.log(`User is on the ${currentLadderMode} ladder`);
                if (hiatusButton) hiatusButton.style.display = 'block';
                
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
                if (leaveTeamButton) leaveTeamButton.style.display = 'none';
                if (hiatusButton) hiatusButton.style.display = 'none';
            }
        } catch (playerError) {
            console.error("Error checking player status:", playerError);
            if (leaveTeamButton) leaveTeamButton.style.display = 'none';
            if (hiatusButton) hiatusButton.style.display = 'none';
        }
    } catch (error) {
        console.error("Main error in checkPlayerStatus:", error);
        // Hide all buttons if there's a general error
        if (leaveTeamButton) leaveTeamButton.style.display = 'none';
        if (hiatusButton) hiatusButton.style.display = 'none';
        if (unhiatusButton) unhiatusButton.style.display = 'none';
    }
}
    
    // Handle team dissolution for DUOS ladder
    async function handleTeamDissolution(userData, collectionName) {
        if (userData.hasTeam && userData.teamId && userData.teammate) {
            console.log("Dissolving team...");
            
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
                // Continue even if team dissolution fails
            }
        }
    }
    
    // Leave team function (keeps player on ladder but removes team)
    async function leaveTeam(username, user) {
        const playerCollection = getCollectionName(currentLadderMode);
        
        try {
            // Get player document to verify and get team info
            const playerRef = doc(playerCollection, user.uid);
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
    
    // Function to handle going on hiatus
    async function goOnHiatus(username, user) {
        const playerCollection = getCollectionName(currentLadderMode);
        const hiatusCollection = 'playerHiatus';
        
        try {
            // Get player document to verify
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
            if (currentLadderMode === 'DUOS' && playerData.hasTeam) {
                await handleTeamDissolution(playerData, playerCollection);
            }
            
            // Store player data in hiatus collection with ladder info
            const hiatusData = {
                ...playerData,
                fromLadder: currentLadderMode,
                hiatusDate: new Date(),
                playerCollection: playerCollection
            };
            
            // Add to hiatus collection
            await setDoc(doc(db, hiatusCollection, user.uid), hiatusData);
            
            // Remove from ladder collection
            await deleteDoc(playerRef);
            
            return { success: true };
            
        } catch (error) {
            console.error("Error going on hiatus:", error);
            throw error;
        }
    }
    
    // Function to handle returning from hiatus
    async function returnFromHiatus(username, user) {
        const hiatusCollection = 'playerHiatus';
        
        try {
            // Get hiatus document to verify
            const hiatusRef = doc(db, hiatusCollection, user.uid);
            const hiatusDoc = await getDoc(hiatusRef);
            
            if (!hiatusDoc.exists()) {
                throw new Error('You are not on hiatus.');
            }
            
            const hiatusData = hiatusDoc.data();
            
            // Verify username matches
            if (hiatusData.username.toLowerCase() !== username.toLowerCase()) {
                throw new Error('Username does not match your account.');
            }
            
            // Get the original ladder collection
            const playerCollection = hiatusData.playerCollection || getCollectionName(hiatusData.fromLadder);
            
            // Prepare player data (remove hiatus-specific fields)
            const { hiatusDate, fromLadder, playerCollection: _, ...playerData } = hiatusData;
            
            // CRITICAL: Validate ELO rating is preserved
            if (!playerData.eloRating || playerData.eloRating <= 0) {
                console.error('ELO rating missing or invalid when returning from hiatus:', playerData);
                throw new Error('Cannot return from hiatus: ELO rating is missing or invalid.');
            }
            
            console.log(`Restoring player ${playerData.username} to ${fromLadder} with ELO: ${playerData.eloRating}`);
            
            // Get the highest position in the ladder to place returning player at the bottom
            const playersRef = collection(db, playerCollection);
            const positionQuery = query(playersRef, orderBy('position', 'desc'), limit(1));
            const positionSnapshot = await getDocs(positionQuery);
            
            let newPosition = 1;
            if (!positionSnapshot.empty) {
                const highestPosition = positionSnapshot.docs[0].data().position || 0;
                newPosition = highestPosition + 1;
            }
            
            // Update player data with new position at the bottom
            playerData.position = newPosition;
            
            console.log(`Assigning position ${newPosition} (bottom of ladder) to returning player`);
            
            // Add back to original ladder collection
            await setDoc(doc(db, playerCollection, user.uid), playerData);
            
            // Remove from hiatus collection
            await deleteDoc(hiatusRef);
            
            return { success: true, ladder: fromLadder, eloRating: playerData.eloRating };
            
        } catch (error) {
            console.error("Error returning from hiatus:", error);
            throw error;
        }
    }
    
    // Set up auth state listener
    onAuthStateChanged(auth, (user) => {
        if (user) {
            updateButtonVisibility();
        } else {
            if (leaveTeamButton) leaveTeamButton.style.display = 'none';
            if (leaveTeamPrompt) leaveTeamPrompt.style.display = 'none';
            if (hiatusButton) hiatusButton.style.display = 'none';
            if (unhiatusButton) unhiatusButton.style.display = 'none';
        }
    });
    
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
    
    // Toggle hiatus form visibility when hiatus button is clicked
    if (hiatusButton) {
        hiatusButton.addEventListener('click', () => {
            console.log("Hiatus button clicked");
            
            // Toggle the modal visibility
            if (hiatusPrompt) {
                const isVisible = hiatusPrompt.style.display === 'flex';
                
                if (isVisible) {
                    // Close the modal
                    hiatusPrompt.style.display = 'none';
                } else {
                    // Open the modal
                    hiatusPrompt.style.display = 'flex';
                    
                    // Set ladder type and clear form
                    if (hiatusLadderTypeSpan) {
                        hiatusLadderTypeSpan.textContent = currentLadderMode;
                    }
                    
                    // Clear previous feedback
                    if (hiatusStatusSpan) {
                        hiatusStatusSpan.textContent = '';
                        hiatusStatusSpan.style.color = '';
                    }
                    if (hiatusUsernameInput) {
                        hiatusUsernameInput.value = '';
                    }
                    
                    // Re-enable the confirm button if it was disabled
                    if (confirmHiatusButton) {
                        confirmHiatusButton.disabled = false;
                    }
                }
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
    
    // Handle hiatus form submission
    if (confirmHiatusButton) {
        confirmHiatusButton.addEventListener('click', async () => {
            const username = hiatusUsernameInput ? hiatusUsernameInput.value.trim() : '';
            
            // Validation
            if (!username) {
                if (hiatusStatusSpan) {
                    hiatusStatusSpan.textContent = 'Please enter your username to confirm.';
                    hiatusStatusSpan.style.color = '#ff6b6b';
                }
                return;
            }
            
            const user = auth.currentUser;
            if (!user) {
                if (hiatusStatusSpan) {
                    hiatusStatusSpan.textContent = 'You must be logged in to go on hiatus.';
                    hiatusStatusSpan.style.color = '#ff6b6b';
                }
                return;
            }
            
            // Disable button and show loading
            confirmHiatusButton.disabled = true;
            if (hiatusStatusSpan) {
                hiatusStatusSpan.textContent = `Going on hiatus from ${currentLadderMode} ladder...`;
                hiatusStatusSpan.style.color = '#ffa500';
            }
            
            try {
                await goOnHiatus(username, user);
                
                // Success feedback
                if (hiatusStatusSpan) {
                    hiatusStatusSpan.textContent = `Successfully went on hiatus from ${currentLadderMode} ladder!`;
                    hiatusStatusSpan.style.color = '#4CAF50';
                }
                
                // Hide hiatus elements and reload page after delay
                setTimeout(() => {
                    if (hiatusButton) hiatusButton.style.display = 'none';
                    if (hiatusPrompt) hiatusPrompt.style.display = 'none';
                    
                    // Reload the page to update all UI elements
                    window.location.reload();
                }, 2000);
                
            } catch (error) {
                console.error("Error during hiatus:", error);
                if (hiatusStatusSpan) {
                    hiatusStatusSpan.textContent = error.message || 'Error processing your request. Please try again.';
                    hiatusStatusSpan.style.color = '#ff6b6b';
                }
                confirmHiatusButton.disabled = false;
            }
        });
    }
    
 function createUnhiatusButton() {
        // Check if button already exists
        let unhiatusBtn = document.getElementById('unhiatus-button');
        if (!unhiatusBtn) {
            unhiatusBtn = document.createElement('button');
            unhiatusBtn.id = 'unhiatus-button';
            unhiatusBtn.className = 'tiny-retire-button';
            unhiatusBtn.style.display = 'none';
            unhiatusBtn.style.background = '#27ae60';
            unhiatusBtn.textContent = 'Return from Hiatus';
            unhiatusBtn.style.position = 'relative';
            unhiatusBtn.style.left = '0'; // Remove offset
            unhiatusBtn.style.zIndex = '1000';
            unhiatusBtn.style.cursor = 'pointer';
            unhiatusBtn.style.pointerEvents = 'auto';
            
            // Add to container
            const container = document.getElementById('ladder-retire-tiny-container');
            if (container) {
                container.appendChild(unhiatusBtn);
            }
        }
        return unhiatusBtn;
    }
    
    // Add this to your initialization
    const unhiatusButton = createUnhiatusButton();
    
    // Handle unhiatus button click
    if (unhiatusButton) {
        unhiatusButton.addEventListener('click', async () => {
            console.log("Unhiatus button clicked");
            
            // Get hiatus info for the user
            const user = auth.currentUser;
            if (!user) return;
            
            try {
                const hiatusRef = doc(db, 'playerHiatus', user.uid);
                const hiatusDoc = await getDoc(hiatusRef);
                
                if (hiatusDoc.exists()) {
                    const hiatusData = hiatusDoc.data();
                    const ladderType = hiatusData.fromLadder || 'D1';
                    
                    if (unhiatusPrompt) {
                        unhiatusPrompt.style.display = 'flex';
                    }
                    if (unhiatusLadderTypeSpan) {
                        unhiatusLadderTypeSpan.textContent = ladderType;
                    }
                    
                    // Clear previous feedback
                    if (unhiatusStatusSpan) {
                        unhiatusStatusSpan.textContent = '';
                        unhiatusStatusSpan.style.color = '';
                    }
                    if (unhiatusUsernameInput) {
                        unhiatusUsernameInput.value = '';
                    }
                }
            } catch (error) {
                console.error("Error getting hiatus data:", error);
            }
        });
    }
    
    // Handle unhiatus form submission
    if (confirmUnhiatusButton) {
        confirmUnhiatusButton.addEventListener('click', async () => {
            const username = unhiatusUsernameInput ? unhiatusUsernameInput.value.trim() : '';
            
            // Validation
            if (!username) {
                if (unhiatusStatusSpan) {
                    unhiatusStatusSpan.textContent = 'Please enter your username to confirm.';
                    unhiatusStatusSpan.style.color = '#ff6b6b';
                }
                return;
            }
            
            const user = auth.currentUser;
            if (!user) {
                if (unhiatusStatusSpan) {
                    unhiatusStatusSpan.textContent = 'You must be logged in to return from hiatus.';
                    unhiatusStatusSpan.style.color = '#ff6b6b';
                }
                return;
            }
            
            // Disable button and show loading
            confirmUnhiatusButton.disabled = true;
            if (unhiatusStatusSpan) {
                unhiatusStatusSpan.textContent = `Returning from hiatus...`;
                unhiatusStatusSpan.style.color = '#ffa500';
            }
            
            try {
                const result = await returnFromHiatus(username, user);
                
                // Success feedback
                if (unhiatusStatusSpan) {
                    unhiatusStatusSpan.textContent = `Successfully returned to ${result.ladder} ladder!`;
                    unhiatusStatusSpan.style.color = '#4CAF50';
                }
                
                // Hide unhiatus elements and reload page after delay
                setTimeout(() => {
                    if (unhiatusButton) unhiatusButton.style.display = 'none';
                    if (unhiatusPrompt) unhiatusPrompt.style.display = 'none';
                    
                    // Reload the page to update all UI elements
                    window.location.reload();
                }, 2000);
                
            } catch (error) {
                console.error("Error during return from hiatus:", error);
                if (unhiatusStatusSpan) {
                    unhiatusStatusSpan.textContent = error.message || 'Error processing your request. Please try again.';
                    unhiatusStatusSpan.style.color = '#ff6b6b';
                }
                confirmUnhiatusButton.disabled = false;
            }
        });
    }
    
    // Close leave team prompt functionality
    const closeLeaveTeamButton = document.querySelector('#leave-team-prompt .close-button');
    if (closeLeaveTeamButton) {
        closeLeaveTeamButton.addEventListener('click', () => {
            if (leaveTeamPrompt) leaveTeamPrompt.style.display = 'none';
        });
    }
    
    // Close hiatus prompt functionality
    const closeHiatusButton = document.querySelector('#hiatus-prompt .close-button');
    if (closeHiatusButton) {
        closeHiatusButton.addEventListener('click', () => {
            if (hiatusPrompt) hiatusPrompt.style.display = 'none';
        });
    }
    
    // Close unhiatus prompt functionality
    const closeUnhiatusButton = document.querySelector('#unhiatus-prompt .close-button');
    if (closeUnhiatusButton) {
        closeUnhiatusButton.addEventListener('click', () => {
            if (unhiatusPrompt) unhiatusPrompt.style.display = 'none';
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
    
    // Close on outside click for hiatus prompt
    if (hiatusPrompt) {
        hiatusPrompt.addEventListener('click', (e) => {
            if (e.target === hiatusPrompt) {
                hiatusPrompt.style.display = 'none';
            }
        });
    }
    
    // Close on outside click for unhiatus prompt
    if (unhiatusPrompt) {
        unhiatusPrompt.addEventListener('click', (e) => {
            if (e.target === unhiatusPrompt) {
                unhiatusPrompt.style.display = 'none';
            }
        });
    }
    
    // Initialize everything
    setupRadioListeners();
    
    // Initial check when page loads
    setTimeout(() => {
        updateButtonVisibility();
    }, 1000); // Small delay to ensure auth state is loaded
});