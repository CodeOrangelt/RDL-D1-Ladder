import { auth, db } from '../firebase-config.js';
import { 
    collection, 
    query, 
    where, 
    getDocs, 
    addDoc, 
    serverTimestamp,
    doc,
    getDoc
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

// Global state for FFA form
const ffaState = {
    playerCount: 0,
    players: [],
    currentLadder: 'D1'
};

// Max score rules based on player count
function getMaxScoreForPlayerCount(playerCount) {
    if (playerCount === 3) return 30;
    if (playerCount === 4) return 40;
    if (playerCount === 5 || playerCount === 6) return 50;
    if (playerCount >= 7 && playerCount <= 8) return 60;
    return 50; // Default fallback
}

async function fetchFFAPlayers() {
    try {
        const playersRef = collection(db, 'playersFFA');
        const snapshot = await getDocs(playersRef);

        const players = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.username) {
                players.push({ username: data.username });
            }
        });

        return players;
    } catch (error) {
        console.error('Error fetching FFA players:', error);
        return [];
    }
}

// Create a participant row
function createParticipantRow(index, playerCount, ffaPlayers = []) {
    const maxScore = getMaxScoreForPlayerCount(playerCount);

    const row = document.createElement('div');
    row.className = 'ffa-participant-row';
    row.setAttribute('data-participant-index', index);
    row.innerHTML = `
        <div class="participant-number-wrapper">
            <img src="../images/cloak.ico" class="participant-profile-image" alt="Player profile" data-participant-index="${index}">
            <div class="participant-number">${index + 1}</div>
        </div>
        <div class="participant-input-wrapper">
            <label>Player Username:</label>
            <select class="ffa-participant-username" data-participant-index="${index}" required>
                <option value="">Select a player</option>
                ${ffaPlayers.map(player => `<option value="${player.username}">${player.username}</option>`).join('')}
            </select>
        </div>
        <div class="participant-input-wrapper">
            <label>Score (Max: ${maxScore}):</label>
            <input type="number" 
                   class="ffa-participant-score" 
                   placeholder="0"
                   min="0"
                   max="${maxScore}"
                   data-participant-index="${index}"
                   required>
        </div>
    `;

    return row;
}

// Update max scores for all participant rows
function updateParticipantMaxScores(playerCount) {
    const maxScore = getMaxScoreForPlayerCount(playerCount);
    const scoreInputs = document.querySelectorAll('.ffa-participant-score');
    const labels = document.querySelectorAll('.ffa-participant-row .participant-input-wrapper:nth-child(3) label');
    
    scoreInputs.forEach(input => {
        input.setAttribute('max', maxScore);
        // Validate existing values against new max
        if (parseInt(input.value) > maxScore) {
            input.value = maxScore;
            showNotification(`Score adjusted to max ${maxScore} for ${playerCount} players`, 'info');
        }
    });
    
    labels.forEach(label => {
        label.textContent = `Score (Max: ${maxScore}):`;
    });
}

// NEW: Function to update available players in dropdowns
function updateAvailablePlayersInDropdowns() {
    const container = document.getElementById('ffa-participants-container');
    if (!container) return;
    
    const allSelects = container.querySelectorAll('.ffa-participant-username');
    const selectedPlayers = Array.from(allSelects)
        .map(select => select.value)
        .filter(value => value !== '');
    
    // Update each dropdown
    allSelects.forEach(select => {
        const currentValue = select.value;
        const options = Array.from(select.options);
        
        options.forEach(option => {
            if (option.value === '') {
                // Keep the placeholder option
                option.disabled = false;
                return;
            }
            
            // Disable if selected in another dropdown (but not this one)
            if (selectedPlayers.includes(option.value) && option.value !== currentValue) {
                option.disabled = true;
            } else {
                option.disabled = false;
            }
        });
    });
}

async function fetchPlayerProfileImage(username) {
    let profileImageUrl = '../images/cloak.ico'; // Default image
    
    try {
        // Get player's userId from playersFFA collection
        const playersRef = collection(db, 'playersFFA');
        const q = query(playersRef, where('username', '==', username));
        const snapshot = await getDocs(q);
        
        if (!snapshot.empty) {
            const playerData = snapshot.docs[0].data();
            const userId = playerData.odl_Id || playerData.userId || snapshot.docs[0].id;
            
            // Get profile from userProfiles collection
            const profileRef = doc(db, 'userProfiles', userId);
            const profileDoc = await getDoc(profileRef);
            
            if (profileDoc.exists()) {
                const profileData = profileDoc.data();
                if (profileData.profileImageUrl) {
                    profileImageUrl = profileData.profileImageUrl;
                }
            }
        }
    } catch (error) {
        console.warn(`Could not fetch profile image for ${username}:`, error);
    }
    
    return profileImageUrl;
}

// Setup event listeners for a participant row
function setupParticipantListeners(row, index) {
    const scoreInput = row.querySelector('.ffa-participant-score');
    const usernameInput = row.querySelector('.ffa-participant-username');
    const profileImage = row.querySelector('.participant-profile-image');
    
    // Score validation
    scoreInput.addEventListener('input', function() {
        const playerCount = ffaState.playerCount;
        const maxScore = getMaxScoreForPlayerCount(playerCount);
        const value = parseInt(this.value);
        
        if (value > maxScore) {
            this.value = maxScore;
            showNotification(`Maximum score for ${playerCount} players is ${maxScore}`, 'warning');
        }
        
        if (value < 0) {
            this.value = 0;
        }
    });
    
    // Username selection change - update available players AND profile image
    usernameInput.addEventListener('change', async function() {
        updateAvailablePlayersInDropdowns();
        
        // Update profile image when player is selected
        const selectedUsername = this.value;
        if (selectedUsername) {
            const profileImageUrl = await fetchPlayerProfileImage(selectedUsername);
            profileImage.src = profileImageUrl;
        } else {
            profileImage.src = '../images/cloak.ico';
        }
    });
}

// Handle username input for autocomplete
async function handleUsernameInput(input, index) {
    const searchTerm = input.value.trim().toLowerCase();
    const suggestionsDiv = document.getElementById(`ffa-suggestions-${index}`);
    
    if (!suggestionsDiv) return;
    
    if (searchTerm.length < 2) {
        suggestionsDiv.innerHTML = '';
        return;
    }
    
    try {
        // Get current ladder from radio buttons
        const selectedRadio = document.querySelector('input[name="ffa-game-version"]:checked');
        const ladder = selectedRadio ? selectedRadio.value : 'D1';
        const collectionName = ladder === 'D1' ? 'players' : 'playersD2';
        
        // Query for matching usernames
        const playersRef = collection(db, collectionName);
        const snapshot = await getDocs(playersRef);
        
        const matches = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.username && data.username.toLowerCase().includes(searchTerm)) {
                matches.push(data.username);
            }
        });
        
        // Display suggestions
        if (matches.length > 0) {
            suggestionsDiv.innerHTML = matches.slice(0, 5).map(username => `
                <div class="suggestion-item" data-username="${username}">
                    ${username}
                </div>
            `).join('');
            suggestionsDiv.style.display = 'block';
            
            // Add click handlers
            suggestionsDiv.querySelectorAll('.suggestion-item').forEach(item => {
                item.addEventListener('click', function() {
                    input.value = this.getAttribute('data-username');
                    suggestionsDiv.innerHTML = '';
                    suggestionsDiv.style.display = 'none';
                });
            });
        } else {
            suggestionsDiv.innerHTML = '';
            suggestionsDiv.style.display = 'none';
        }
    } catch (error) {
        console.error('Error fetching usernames:', error);
        suggestionsDiv.innerHTML = '';
        suggestionsDiv.style.display = 'none';
    }
}

async function handleParticipantCountChange() {
    const select = document.getElementById('ffa-participant-count');
    const container = document.getElementById('ffa-participants-container');

    if (!select || !container) return;

    select.addEventListener('change', async function () {
        const playerCount = parseInt(this.value);

        if (!playerCount || playerCount < 3 || playerCount > 8) {
            container.innerHTML = '';
            ffaState.playerCount = 0;
            return;
        }

        // Fetch players from FFA ladder
        const ffaPlayers = await fetchFFAPlayers();

        // Clear existing rows
        container.innerHTML = '';

        // Create new rows
        for (let i = 0; i < playerCount; i++) {
            const row = createParticipantRow(i, playerCount, ffaPlayers);
            container.appendChild(row);
            setupParticipantListeners(row, i);
        }

        // Add helper info
        addMaxScoreHelper(playerCount);

        ffaState.playerCount = playerCount;
    });

    // Set default value to non-value like the HTML form
    select.value = "";
}

// Add max score helper info
function addMaxScoreHelper(playerCount) {
    const container = document.getElementById('ffa-participants-container');
    
    if (!container) return;
    
    // Remove existing helper if present
    const existingHelper = container.querySelector('.max-score-helper');
    if (existingHelper) {
        existingHelper.remove();
    }
    
    const maxScore = getMaxScoreForPlayerCount(playerCount);
    
    const helperDiv = document.createElement('div');
    helperDiv.className = 'max-score-helper';
    
    container.insertBefore(helperDiv, container.firstChild);
}

// Validate FFA match data
function validateFFAMatch(players, mapPlayed) {
    const playerCount = players.length;
    const maxScore = getMaxScoreForPlayerCount(playerCount);
    
    // Check player count
    if (playerCount < 3 || playerCount > 8) {
        throw new Error('FFA matches require 3-8 players');
    }
    
    // Validate map
    if (!mapPlayed || mapPlayed.trim() === '') {
        throw new Error('Map name is required');
    }
    
    // Validate each player
    for (let i = 0; i < playerCount; i++) {
        const player = players[i];
        
        if (!player.username || player.username.trim() === '') {
            throw new Error(`Player ${i + 1} username is required`);
        }
        
        if (isNaN(player.score) || player.score < 0) {
            throw new Error(`Player ${i + 1} score must be a positive number`);
        }
        
        if (player.score > maxScore) {
            throw new Error(`Player ${i + 1} score exceeds maximum of ${maxScore}`);
        }
    }
    
    // Check for duplicate usernames
    const usernames = players.map(p => p.username.toLowerCase());
    const uniqueUsernames = new Set(usernames);
    if (usernames.length !== uniqueUsernames.size) {
        throw new Error('Cannot select the same player multiple times');
    }
    
    // Check for clear winner
    const scores = players.map(p => p.score);
    const maxPlayerScore = Math.max(...scores);
    const winnersCount = scores.filter(s => s === maxPlayerScore).length;
    
    if (winnersCount > 1) {
        throw new Error('There must be a clear winner (one player with highest score)');
    }
    
    return true;
}

// Submit FFA match
async function submitFFAMatch(players, mapPlayed, gameVersion, matchNotes = '', demoLink = '') {
    const user = auth.currentUser;
    if (!user) {
        throw new Error('You must be logged in to submit a match');
    }
    
    try {
        // Validate the match data
        validateFFAMatch(players, mapPlayed);
        
        // Determine collection
        const collectionName = 'pendingMatchesFFA';
        
        // Sort players by score (highest first)
        const sortedPlayers = [...players].sort((a, b) => b.score - a.score);
        
        // Fetch profile images for each player
        const playersWithProfiles = await Promise.all(
            sortedPlayers.map(async (p, index) => {
                let profileImageUrl = '../images/cloak.ico'; // Default image
                
                try {
                    // Get player's userId from playersFFA collection
                    const playersRef = collection(db, 'playersFFA');
                    const q = query(playersRef, where('username', '==', p.username));
                    const snapshot = await getDocs(q);
                    
                    if (!snapshot.empty) {
                        const playerData = snapshot.docs[0].data();
                        const userId = playerData.odl_Id || playerData.userId || snapshot.docs[0].id;
                        
                        // Get profile from userProfiles collection
                        const profileRef = doc(db, 'userProfiles', userId);
                        const profileDoc = await getDoc(profileRef);
                        
                        if (profileDoc.exists()) {
                            const profileData = profileDoc.data();
                            if (profileData.profileImageUrl) {
                                profileImageUrl = profileData.profileImageUrl;
                            }
                        }
                    }
                } catch (error) {
                    console.warn(`Could not fetch profile image for ${p.username}:`, error);
                    // Keep default image
                }
                
                return {
                    username: p.username,
                    score: p.score,
                    placement: index + 1,
                    profileImageUrl: profileImageUrl
                };
            })
        );
        
        // Prepare match data
        const matchData = {
            players: playersWithProfiles,
            winnerUsername: playersWithProfiles[0].username,
            winnerScore: playersWithProfiles[0].score,
            mapPlayed: mapPlayed,
            gameVersion: gameVersion,
            matchNotes: matchNotes || '',
            demoLink: demoLink || '',
            submittedBy: user.email,
            submittedByUID: user.uid,
            submittedAt: serverTimestamp(),
            status: 'pending',
            matchType: 'FFA',
            playerCount: players.length,
            maxScore: getMaxScoreForPlayerCount(players.length)
        };
        
        // Add to Firestore
        const docRef = await addDoc(collection(db, collectionName), matchData);
        
        return docRef.id;
        
    } catch (error) {
        console.error('Error submitting FFA match:', error);
        throw error;
    }
}

// Handle form submission
async function handleFFASubmit(e) {
    e.preventDefault();
    
    const container = document.getElementById('ffa-participants-container');
    const playerCount = ffaState.playerCount;
    
    if (playerCount < 3) {
        showNotification('Please select number of participants first', 'error');
        return;
    }
    
    const players = [];
    const rows = container.querySelectorAll('.ffa-participant-row');
    
    rows.forEach(row => {
        const username = row.querySelector('.ffa-participant-username').value.trim();
        const score = parseInt(row.querySelector('.ffa-participant-score').value);
        
        if (username && !isNaN(score)) {
            players.push({ username, score });
        }
    });
    
    // Get other form data
    const mapPlayed = document.getElementById('ffa-map-played').value.trim();
    const selectedRadio = document.querySelector('input[name="ffa-game-version"]:checked');
    const gameVersion = selectedRadio ? selectedRadio.value : 'D1';
    const matchNotes = document.getElementById('ffa-match-notes').value.trim();
    const demoLink = document.getElementById('ffa-demo-link').value.trim();
    
    // Show loading state
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';
    
    try {
        await submitFFAMatch(players, mapPlayed, gameVersion, matchNotes, demoLink);
        showNotification('FFA match submitted successfully! Awaiting approval.', 'success');
        
        // Reset form
        resetFFAForm();
        
    } catch (error) {
        console.error('Error submitting FFA match:', error);
        showNotification('Failed to submit match: ' + error.message, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
    }
}

// Reset the FFA form
function resetFFAForm() {
    const form = document.getElementById('ffa-report-form');
    if (form) {
        form.reset();
    }
    
    const container = document.getElementById('ffa-participants-container');
    if (container) {
        container.innerHTML = '';
    }
    
    ffaState.playerCount = 0;
    ffaState.players = [];
}

function initializeFFAForm() {
    const form = document.getElementById('ffa-report-form');
    const container = document.getElementById('ffa-participants-container');
    const participantCountSelect = document.getElementById('ffa-participant-count');

    if (!form || !container || !participantCountSelect) {
        console.error('❌ Required FFA form elements not found in DOM!');
        return;
    }

    // Reset state
    ffaState.playerCount = 0;
    ffaState.players = [];

    // Setup participant count change handler
    handleParticipantCountChange();

    // Setup form submission
    form.removeEventListener('submit', handleFFASubmit);
    form.addEventListener('submit', handleFFASubmit);

    // Setup game version radio change
    const radioButtons = document.querySelectorAll('input[name="ffa-game-version"]');
    radioButtons.forEach(radio => {
        radio.addEventListener('change', function () {
            ffaState.currentLadder = this.value;
        });
    });
}

// Show notification helper
function showNotification(message, type = 'info') {
    // Try to use existing notification system
    if (window.showNotification && typeof window.showNotification === 'function') {
        window.showNotification(message, type);
        return;
    }
    
    // Display in error div if available
    const errorDiv = document.getElementById('ffa-report-error');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.className = `error ${type}`;
        errorDiv.style.display = 'block';
        
        setTimeout(() => {
            errorDiv.style.display = 'none';
        }, 5000);
        return;
    }
    
    // Simple toast notification fallback
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        background: ${type === 'success' ? '#4caf50' : type === 'error' ? '#f44336' : '#2196F3'};
        color: white;
        border-radius: 5px;
        z-index: 10000;
        box-shadow: 0 4px 6px rgba(0,0,0,0.3);
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('ffa-report-form')) {
        initializeFFAForm();
    }
});

// Export functions for use in other modules
export {
    initializeFFAForm,
    submitFFAMatch,
    validateFFAMatch,
    ffaState,
    getMaxScoreForPlayerCount
};