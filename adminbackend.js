import { collection, getDocs, query, orderBy, addDoc, deleteDoc, where, doc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { auth, db } from './firebase-config.js';
import { getEloHistory } from './elo-history.js';
import { getRankStyle } from './ranks.js';

// Add admin emails array at the top with other constants
const ADMIN_EMAILS = [
    'admin@ladder.com',
    'Brian2af@outlook.com'
];

// Test data array
const testPlayers = [
    { username: "EmergingPro", eloRating: 2250, position: 1 },    // Emerald
    { username: "GoldMaster", eloRating: 1950, position: 2 },     // Gold
    { username: "SilverStriker", eloRating: 1750, position: 3 },  // Silver
    { username: "BronzeWarrior", eloRating: 1500, position: 4 },  // Bronze
    { username: "GoldChampion", eloRating: 1850, position: 5 },   // Gold
    { username: "EmberEmerald", eloRating: 2150, position: 6 },   // Emerald
    { username: "SilverPhoenix", eloRating: 1650, position: 7 },  // Silver
    { username: "BronzeKnight", eloRating: 1450, position: 8 },   // Bronze
    { username: "Newcomer", eloRating: 1200, position: 9 },       // Unranked
    { username: "RookiePlayer", eloRating: 1350, position: 10 }   // Unranked
];

document.addEventListener('DOMContentLoaded', () => {
    auth.onAuthStateChanged(async (user) => {
        if (!user) {
            window.location.href = 'login.html';
            return;
        }
        
        if (ADMIN_EMAILS.includes(user.email)) {
            setupCollapsibleButtons();
            setupPromotePlayerButton();
            setupManagePlayersSection();
            // Initial load of ELO ratings if the section is visible
            if (document.getElementById('elo-ratings').style.display !== 'none') {
                loadEloRatings();
            }
        } else {
            window.location.href = 'index.html';
        }
    });
});

function setupCollapsibleButtons() {
    const buttons = document.querySelectorAll('.collapse-btn');
    
    buttons.forEach(button => {
        button.addEventListener('click', () => {
            const targetId = button.getAttribute('data-target');
            if (targetId) {
                const targetSection = document.getElementById(targetId);
                if (targetSection) {
                    // Toggle sections
                    document.querySelectorAll('.admin-section').forEach(section => {
                        section.style.display = 'none';
                    });
                    
                    targetSection.style.display = 'block';
                    
                    // Load appropriate data
                    if (targetId === 'elo-history') {
                        loadEloHistory();
                    } else if (targetId === 'elo-ratings') {
                        loadEloRatings();
                    }
                }
            } else if (button.id === 'toggle-manage-players') {
                const section = document.getElementById('manage-players-section');
                if (section) {
                    section.style.display = 
                        section.style.display === 'none' ? 'block' : 'none';
                }
            }
        });
    });
}

async function setupAdminButtons() {
    const viewEloButton = document.getElementById('view-elo-ratings');
    if (viewEloButton) {
        viewEloButton.addEventListener('click', async () => {
            document.getElementById('elo-ratings').style.display = 'block';
            await loadEloRatings();
        });
    }

    const viewEloHistoryBtn = document.getElementById('view-elo-history');
    if (viewEloHistoryBtn) {
        viewEloHistoryBtn.addEventListener('click', async () => {
            document.getElementById('elo-history').style.display = 'block';
            await loadEloHistory();
        });
    }

    const populateButton = document.getElementById('populate-test-ladder');
    if (populateButton) {
        populateButton.addEventListener('click', populateTestLadder);
    }

    const viewTemplateBtn = document.getElementById('view-template-ladder');
    if (viewTemplateBtn) {
        viewTemplateBtn.addEventListener('click', () => {
            const templateSection = document.getElementById('template-ladder');
            templateSection.style.display = templateSection.style.display === 'none' ? 'block' : 'none';
            if (templateSection.style.display === 'block') {
                displayTemplateLadder();
            }
        });
    }
}

async function populateTestLadder() {
    try {
        const playersRef = collection(db, 'players');
        
        // Clear existing players
        const existingPlayers = await getDocs(playersRef);
        await Promise.all(existingPlayers.docs.map(doc => deleteDoc(doc.ref)));

        // Add test players
        await Promise.all(testPlayers.map(player => addDoc(playersRef, player)));

        alert('Test ladder populated successfully!');
        
        // Refresh ELO ratings display if visible
        const eloRatings = document.getElementById('elo-ratings');
        if (eloRatings && eloRatings.style.display === 'block') {
            await loadEloRatings();
        }
    } catch (error) {
        console.error("Error populating test ladder:", error);
        alert('Error populating test ladder: ' + error.message);
    }
}

async function loadEloRatings() {
    const tableBody = document.querySelector('#elo-table tbody');
    if (!tableBody) return;

    tableBody.innerHTML = '<tr><td colspan="2">Loading...</td></tr>';

    try {
        const playersRef = collection(db, 'players');
        const q = query(playersRef, orderBy('eloRating', 'desc'));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            tableBody.innerHTML = '<tr><td colspan="2">No players found</td></tr>';
            return;
        }

        tableBody.innerHTML = '';
        querySnapshot.forEach(doc => {
            const data = doc.data();
            const row = document.createElement('tr');
            const rankStyle = getRankStyle(data.eloRating);
            
            row.innerHTML = `
                <td style="color: ${rankStyle.color}; font-weight: bold;" title="${rankStyle.name}">
                    ${data.username || 'Unknown'}
                </td>
                <td>${data.eloRating || 1200}</td>
            `;
            tableBody.appendChild(row);
        });
    } catch (error) {
        console.error("Error loading ELO ratings:", error);
        tableBody.innerHTML = '<tr><td colspan="2">Error loading ratings</td></tr>';
    }
}

async function loadEloHistory() {
    const tableBody = document.querySelector('#elo-history-table tbody');
    if (!tableBody) {
        console.error('ELO history table not found');
        return;
    }

    tableBody.innerHTML = '<tr><td colspan="7">Loading history...</td></tr>';

    try {
        const eloHistoryRef = collection(db, 'eloHistory');
        const q = query(eloHistoryRef, orderBy('timestamp', 'desc'));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            tableBody.innerHTML = '<tr><td colspan="7">No ELO history found</td></tr>';
            return;
        }

        tableBody.innerHTML = '';
        querySnapshot.forEach(doc => {
            const data = doc.data();
            const row = document.createElement('tr');
            const eloChange = data.newElo - data.previousElo;
            const changeColor = eloChange > 0 ? 'color: #4CAF50;' : eloChange < 0 ? 'color: #f44336;' : '';
            
            row.innerHTML = `
                <td>${data.timestamp?.toDate().toLocaleString() || 'N/A'}</td>
                <td>${data.player || 'N/A'}</td>
                <td>${data.previousElo || 'N/A'}</td>
                <td>${data.newElo || 'N/A'}</td>
                <td style="${changeColor}">${eloChange > 0 ? '+' + eloChange : eloChange}</td>
                <td>${data.opponent || 'N/A'}</td>
                <td>${data.matchResult || 'N/A'}</td>
            `;
            tableBody.appendChild(row);
        });
    } catch (error) {
        console.error("Error loading ELO history:", error);
        tableBody.innerHTML = '<tr><td colspan="7">Error loading history: ' + error.message + '</td></tr>';
    }
}

function displayTemplateLadder() {
    const tableBody = document.querySelector('#template-table tbody');
    tableBody.innerHTML = '';

    testPlayers.forEach(player => {
        const row = document.createElement('tr');
        const rankStyle = getRankStyle(player.eloRating);
        row.innerHTML = `
            <td>${player.position}</td>
            <td style="color: ${rankStyle.color}; font-weight: bold;">${player.username}</td>
        `;
        tableBody.appendChild(row);
    });
}

document.getElementById('toggle-manage-players').addEventListener('click', function() {
    const section = document.getElementById('manage-players-section');
    const button = this;
    
    if (section.style.display === 'none') {
        section.style.display = 'block';
        button.classList.add('active');
        loadPlayers(); // Load current players when section is opened
    } else {
        section.style.display = 'none';
        button.classList.remove('active');
    }
});

async function loadPlayers() {
    const tableBody = document.querySelector('#players-table tbody');
    tableBody.innerHTML = '';

    try {
        const playersRef = collection(db, 'players');
        const playersSnapshot = await getDocs(playersRef);

        playersSnapshot.forEach(doc => {
            const player = doc.data();
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${player.username}</td>
                <td>${player.eloRating || 'N/A'}</td>
                <td>
                    <button class="remove-btn" data-id="${doc.id}">Remove</button>
                </td>
            `;
            tableBody.appendChild(row);
        });

        // Add event listeners to remove buttons
        document.querySelectorAll('.remove-btn').forEach(button => {
            button.addEventListener('click', async (e) => {
                if (confirm('Are you sure you want to remove this player?')) {
                    const playerId = e.target.dataset.id;
                    try {
                        await deleteDoc(doc(db, 'players', playerId));
                        loadPlayers(); // Refresh the list
                    } catch (error) {
                        console.error('Error removing player:', error);
                        alert('Failed to remove player');
                    }
                }
            });
        });
    } catch (error) {
        console.error('Error loading players:', error);
        alert('Failed to load players');
    }
}

document.getElementById('add-player-btn').addEventListener('click', async () => {
    const username = document.getElementById('new-player-username').value.trim();
    const eloRating = parseInt(document.getElementById('new-player-elo').value);

    if (!username || isNaN(eloRating)) {
        alert('Please enter both username and ELO rating');
        return;
    }

    try {
        // Check if username exists
        const playersRef = collection(db, 'players');
        const q = query(playersRef, where('username', '==', username));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            alert('Username already exists');
            return;
        }

        // Get all players to determine next position
        const allPlayersSnapshot = await getDocs(playersRef);
        const positions = [];
        allPlayersSnapshot.forEach(doc => {
            const playerData = doc.data();
            if (playerData.position) {
                positions.push(playerData.position);
            }
        });

        // Calculate next position
        const nextPosition = positions.length > 0 ? Math.max(...positions) + 1 : 1;

        // Add new player with calculated position
        const playerData = {
            username: username,
            eloRating: eloRating,
            position: nextPosition,
            createdAt: serverTimestamp()
        };

        await addDoc(collection(db, 'players'), playerData);
        alert('Player added successfully at position ' + nextPosition);

        // Clear inputs and refresh
        document.getElementById('new-player-username').value = '';
        document.getElementById('new-player-elo').value = '';
        loadPlayers();

    } catch (error) {
        console.error('Error adding player:', error);
        alert('Failed to add player');
    }
});

// Add this function to handle promotions
async function promotePlayer(username) {
    try {
        // First check if current user is admin
        const user = auth.currentUser;
        if (!user || !ADMIN_EMAILS.includes(user.email)) {
            throw new Error('Unauthorized: Admin access required');
        }

        const playersRef = collection(db, 'players');
        const q = query(playersRef, where('username', '==', username));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            throw new Error('Player not found');
        }

        const playerDoc = querySnapshot.docs[0];
        const playerData = playerDoc.data();
        const currentElo = playerData.eloRating || 1200;

        // Define ELO thresholds
        const thresholds = [
            { name: 'Bronze', elo: 1400 },
            { name: 'Silver', elo: 1600 },
            { name: 'Gold', elo: 1800 },
            { name: 'Emerald', elo: 2000 }
        ];

        // Find next threshold
        let nextThreshold = thresholds.find(t => t.elo > currentElo);
        
        if (!nextThreshold) {
            throw new Error('Player is already at maximum rank (Emerald)');
        }

        const batch = writeBatch(db);
        
        // Update player document
        batch.update(doc(db, 'players', playerDoc.id), {
            eloRating: nextThreshold.elo,
            lastPromotedAt: serverTimestamp(),
            promotedBy: user.email
        });

        // Record promotion in history
        batch.set(doc(collection(db, 'eloHistory')), {
            player: username,
            previousElo: currentElo,
            newElo: nextThreshold.elo,
            timestamp: serverTimestamp(),
            type: 'promotion',
            rankAchieved: nextThreshold.name,
            promotedBy: user.email
        });

        await batch.commit();

        // Update UI
        alert(`Successfully promoted ${username} to ${nextThreshold.name} (${nextThreshold.elo} ELO)`);
        
        // Refresh displays
        await Promise.all([
            loadPlayers(),
            loadEloRatings(),
            loadEloHistory()
        ]);

    } catch (error) {
        console.error('Error promoting player:', error);
        throw error;
    }
}

// Add the button click handler
// Remove this standalone event listener
/*
document.getElementById('promote-player-btn').addEventListener('click', async () => {
    const username = prompt('Enter the username of the player to promote:');
    if (username) {
        await promotePlayer(username.trim());
    }
});
*/

// Add this new function to handle promote player button setup
function setupPromotePlayerButton() {
    const promoteBtn = document.getElementById('promote-player');
    const promoteDialog = document.getElementById('promote-dialog');
    const confirmPromoteBtn = document.getElementById('confirm-promote');
    const cancelPromoteBtn = document.getElementById('cancel-promote');
    const promoteUsernameInput = document.getElementById('promote-username');

    if (promoteBtn && promoteDialog) {
        promoteBtn.addEventListener('click', () => {
            promoteDialog.style.display = 'block';
        });
    }

    if (cancelPromoteBtn && promoteDialog) {
        cancelPromoteBtn.addEventListener('click', () => {
            promoteDialog.style.display = 'none';
            if (promoteUsernameInput) {
                promoteUsernameInput.value = '';
            }
        });
    }

    if (confirmPromoteBtn && promoteUsernameInput) {
        confirmPromoteBtn.addEventListener('click', async () => {
            const username = promoteUsernameInput.value.trim();
            if (!username) {
                alert('Please enter a username');
                return;
            }
            try {
                await promotePlayer(username);
                promoteDialog.style.display = 'none';
                promoteUsernameInput.value = '';
            } catch (error) {
                console.error('Error promoting player:', error);
                alert('Failed to promote player: ' + error.message);
            }
        });
    }
}

// Add a new function to handle the manage players section setup
function setupManagePlayersSection() {
    const toggleManagePlayersBtn = document.getElementById('toggle-manage-players');
    const addPlayerBtn = document.getElementById('add-player-btn');

    if (toggleManagePlayersBtn) {
        toggleManagePlayersBtn.addEventListener('click', function() {
            const section = document.getElementById('manage-players-section');
            if (section) {
                if (section.style.display === 'none') {
                    section.style.display = 'block';
                    this.classList.add('active');
                    loadPlayers();
                } else {
                    section.style.display = 'none';
                    this.classList.remove('active');
                }
            }
        });
    }

    if (addPlayerBtn) {
        addPlayerBtn.addEventListener('click', async () => {
            const usernameInput = document.getElementById('new-player-username');
            const eloInput = document.getElementById('new-player-elo');
            
            if (!usernameInput || !eloInput) {
                console.error('Player input fields not found');
                return;
            }

            const username = usernameInput.value.trim();
            const eloRating = parseInt(eloInput.value);

            if (!username || isNaN(eloRating)) {
                alert('Please enter both username and ELO rating');
                return;
            }

            // ... rest of your add player logic ...
        });
    }
}