import { 
    collection, 
    getDocs, 
    query, 
    orderBy, 
    addDoc, 
    deleteDoc, 
    where, 
    doc, 
    getDoc,
    serverTimestamp, 
    setDoc, 
    updateDoc, 
    writeBatch,
    runTransaction 
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { auth, db } from './firebase-config.js';
import { getEloHistory } from './elo-history.js';
import { getRankStyle } from './ranks.js';
import { ADMIN_EMAILS } from './admin-config.js';
import { isAdmin } from './admin-check.js';

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
        
        if (isAdmin(user.email)) {
            setupCollapsibleButtons();
            setupPromotePlayerButton();
            setupDemotePlayerButton();
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
    const adminSections = document.querySelectorAll('.admin-section');
    
    buttons.forEach(button => {
        button.addEventListener('click', async () => {
            const targetId = button.getAttribute('data-target');
            
            // Hide all sections first
            adminSections.forEach(section => {
                section.style.display = 'none';
            });

            // Show target section and load appropriate data
            const targetSection = document.getElementById(targetId);
            if (targetSection) {
                targetSection.style.display = 'block';
                
                // Load appropriate data based on section
                if (targetId === 'manage-players-section') {
                    await loadPlayers();
                } else if (targetId === 'elo-history') {
                    await loadEloHistory();
                } else if (targetId === 'elo-ratings') {
                    await loadEloRatings();
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

// Update loadPlayers function to prevent duplicates and handle visibility
async function loadPlayers() {
    const tableBody = document.querySelector('#players-table tbody');
    if (!tableBody) return;
    
    tableBody.innerHTML = '<tr><td colspan="4">Loading...</td></tr>';

    try {
        const playersRef = collection(db, 'players');
        const q = query(playersRef, orderBy('username'));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            tableBody.innerHTML = '<tr><td colspan="4">No players found</td></tr>';
            return;
        }

        tableBody.innerHTML = '';
        let position = 1;

        querySnapshot.forEach(doc => {
            const player = doc.data();
            const row = document.createElement('tr');
            const rankStyle = getRankStyle(player.eloRating || 1200);
            
            row.innerHTML = `
                <td>${position}</td>
                <td style="color: ${rankStyle.color}; font-weight: bold;">
                    ${player.username || 'Unknown'}
                </td>
                <td>${player.eloRating || 1200}</td>
                <td>
                    <button class="move-btn" data-direction="up" data-id="${doc.id}" data-pos="${position}">↑</button>
                    <button class="move-btn" data-direction="down" data-id="${doc.id}" data-pos="${position}">↓</button>
                    <button class="remove-btn" data-id="${doc.id}">Remove</button>
                </td>
            `;
            tableBody.appendChild(row);
            position++;
        });

        // Use setupLadderControls instead of setupPlayerControls
        setupLadderControls();

    } catch (error) {
        console.error('Error loading players:', error);
        tableBody.innerHTML = '<tr><td colspan="4">Error loading players</td></tr>';
    }
}

async function setupLadderControls() {
    // Handle move buttons
    document.querySelectorAll('.move-btn').forEach(button => {
        button.addEventListener('click', async (e) => {
            const direction = e.target.dataset.direction;
            const playerId = e.target.dataset.id;
            const currentPos = parseInt(e.target.dataset.pos);
            
            try {
                const batch = writeBatch(db);
                const playersRef = collection(db, 'players');
                
                // Get current player
                const currentPlayerDoc = await getDoc(doc(playersRef, playerId));
                
                // Get adjacent player
                const targetPos = direction === 'up' ? currentPos - 1 : currentPos + 1;
                const targetQuery = query(playersRef, where('position', '==', targetPos));
                const targetSnapshot = await getDocs(targetQuery);
                
                if (!targetSnapshot.empty) {
                    const targetDoc = targetSnapshot.docs[0];
                    
                    // Swap positions
                    batch.update(doc(playersRef, playerId), {
                        position: targetPos
                    });
                    batch.update(doc(playersRef, targetDoc.id), {
                        position: currentPos
                    });
                    
                    await batch.commit();
                    await loadPlayers(); // Refresh the display
                }
            } catch (error) {
                console.error('Error moving player:', error);
                alert('Failed to move player: ' + error.message);
            }
        });
    });

    // Handle remove buttons
    document.querySelectorAll('.remove-btn').forEach(button => {
        button.addEventListener('click', async (e) => {
            if (confirm('Are you sure you want to remove this player?')) {
                try {
                    await deleteDoc(doc(db, 'players', e.target.dataset.id));
                    await loadPlayers(); // Refresh the list
                } catch (error) {
                    console.error('Error removing player:', error);
                    alert('Failed to remove player: ' + error.message);
                }
            }
        });
    });
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
        // Check if current user is admin
        const user = auth.currentUser;
        if (!user || !ADMIN_EMAILS.includes(user.email)) {
            throw new Error('Unauthorized: Admin access required');
        }

        // Get player data
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

        // Use batch write instead of transaction
        const batch = writeBatch(db);
        
        // Update player document
        batch.update(doc(db, 'players', playerDoc.id), {
            eloRating: nextThreshold.elo,
            lastPromotedAt: serverTimestamp(),
            promotedBy: user.email
        });

        // Add promotion history
        const historyRef = doc(collection(db, 'eloHistory'));
        batch.set(historyRef, {
            player: username,
            previousElo: currentElo,
            newElo: nextThreshold.elo,
            timestamp: serverTimestamp(),
            type: 'promotion',
            rankAchieved: nextThreshold.name,
            promotedBy: user.email
        });

        // Commit the batch
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

    if (!promoteBtn || !promoteDialog || !confirmPromoteBtn || !cancelPromoteBtn || !promoteUsernameInput) {
        console.error('Missing promote dialog elements');
        return;
    }

    promoteBtn.addEventListener('click', () => {
        promoteDialog.style.display = 'block';
    });

    cancelPromoteBtn.addEventListener('click', () => {
        promoteDialog.style.display = 'none';
        promoteUsernameInput.value = '';
    });

    // Close modal if clicked outside
    promoteDialog.addEventListener('click', (e) => {
        if (e.target === promoteDialog) {
            promoteDialog.style.display = 'none';
            promoteUsernameInput.value = '';
        }
    });

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

// Add a new function to handle the manage players section setup
function setupManagePlayersSection() {
    const section = document.getElementById('manage-players-section');
    if (!section) return;

    // Set initial display state
    section.style.display = 'none';

    // Setup add player functionality
    const addPlayerBtn = document.getElementById('add-player-btn');
    if (addPlayerBtn) {
        addPlayerBtn.addEventListener('click', async () => {
            const usernameInput = document.getElementById('new-player-username');
            const eloInput = document.getElementById('new-player-elo');
            if (!usernameInput || !eloInput) return;

            const username = usernameInput.value.trim();
            const eloRating = parseInt(eloInput.value);

            if (!username || isNaN(eloRating)) {
                alert('Please enter both username and ELO rating');
                return;
            }

            try {
                // Rest of the add player logic...
            } catch (error) {
                console.error('Error adding player:', error);
                alert('Failed to add player: ' + error.message);
            }
        });
    }
}

// Add demote player function
async function demotePlayer(username) {
    try {
        // Check if current user is admin
        const user = auth.currentUser;
        if (!user || !isAdmin(user.email)) {
            throw new Error('Unauthorized: Admin access required');
        }

        // Get player data
        const playersRef = collection(db, 'players');
        const q = query(playersRef, where('username', '==', username));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            throw new Error('Player not found');
        }

        const playerDoc = querySnapshot.docs[0];
        const playerData = playerDoc.data();
        const currentElo = playerData.eloRating || 1200;

        // Define ELO thresholds (in reverse order for demotion)
        const thresholds = [
            { name: 'Gold', elo: 1800 },
            { name: 'Silver', elo: 1600 },
            { name: 'Bronze', elo: 1400 },
            { name: 'Unranked', elo: 1200 }
        ];

        // Find previous threshold
        let prevThreshold = thresholds.find(t => t.elo < currentElo);
        
        if (!prevThreshold) {
            throw new Error('Player is already at minimum rank (Unranked)');
        }

        // Use batch write
        const batch = writeBatch(db);
        
        // Update player document
        batch.update(doc(db, 'players', playerDoc.id), {
            eloRating: prevThreshold.elo,
            lastDemotedAt: serverTimestamp(),
            demotedBy: user.email
        });

        // Add demotion history
        const historyRef = doc(collection(db, 'eloHistory'));
        batch.set(historyRef, {
            player: username,
            previousElo: currentElo,
            newElo: prevThreshold.elo,
            timestamp: serverTimestamp(),
            type: 'demotion',
            rankAchieved: prevThreshold.name,
            demotedBy: user.email
        });

        // Commit the batch
        await batch.commit();

        // Update UI
        alert(`Successfully demoted ${username} to ${prevThreshold.name} (${prevThreshold.elo} ELO)`);
        
        // Refresh displays
        await Promise.all([
            loadPlayers(),
            loadEloRatings(),
            loadEloHistory()
        ]);

    } catch (error) {
        console.error('Error demoting player:', error);
        throw error;
    }
}

// Add setup for demote button
function setupDemotePlayerButton() {
    const demoteBtn = document.getElementById('demote-player');
    const demoteDialog = document.getElementById('demote-dialog');
    const confirmDemoteBtn = document.getElementById('confirm-demote');
    const cancelDemoteBtn = document.getElementById('cancel-demote');
    const demoteUsernameInput = document.getElementById('demote-username');

    if (!demoteBtn || !demoteDialog || !confirmDemoteBtn || !cancelDemoteBtn || !demoteUsernameInput) {
        console.error('Missing demote dialog elements');
        return;
    }

    demoteBtn.addEventListener('click', () => {
        demoteDialog.style.display = 'block';
    });

    cancelDemoteBtn.addEventListener('click', () => {
        demoteDialog.style.display = 'none';
        demoteUsernameInput.value = '';
    });

    // Close modal if clicked outside
    demoteDialog.addEventListener('click', (e) => {
        if (e.target === demoteDialog) {
            demoteDialog.style.display = 'none';
            demoteUsernameInput.value = '';
        }
    });

    confirmDemoteBtn.addEventListener('click', async () => {
        const username = demoteUsernameInput.value.trim();
        if (!username) {
            alert('Please enter a username');
            return;
        }
        try {
            await demotePlayer(username);
            demoteDialog.style.display = 'none';
            demoteUsernameInput.value = '';
        } catch (error) {
            console.error('Error demoting player:', error);
            alert('Failed to demote player: ' + error.message);
        }
    });
}