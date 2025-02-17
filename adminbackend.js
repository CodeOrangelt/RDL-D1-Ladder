import { collection, getDocs, query, orderBy, addDoc, deleteDoc, where, doc, serverTimestamp, setDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
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
    // Check if user is admin
    auth.onAuthStateChanged(async (user) => {
        if (!user) {
            window.location.href = 'login.html';
            return;
        }
        
        if (ADMIN_EMAILS.includes(user.email)) {
            setupCollapsibleButtons();
        } else {
            window.location.href = 'index.html';
        }
    });

    // Promote player functionality
    const promoteBtn = document.getElementById('promote-player');
    const promoteDialog = document.getElementById('promote-dialog');
    const confirmPromoteBtn = document.getElementById('confirm-promote');
    const cancelPromoteBtn = document.getElementById('cancel-promote');
    const promoteUsernameInput = document.getElementById('promote-username');

    if (promoteBtn) {
        promoteBtn.addEventListener('click', () => {
            promoteDialog.style.display = 'block';
        });
    }

    if (cancelPromoteBtn) {
        cancelPromoteBtn.addEventListener('click', () => {
            promoteDialog.style.display = 'none';
            promoteUsernameInput.value = '';
        });
    }

    if (confirmPromoteBtn) {
        confirmPromoteBtn.addEventListener('click', async () => {
            const username = promoteUsernameInput.value.trim();
            if (!username) {
                alert('Please enter a username');
                return;
            }

            try {
                const playersRef = collection(db, 'players');
                const q = query(playersRef, where('username', '==', username));
                const querySnapshot = await getDocs(q);

                if (querySnapshot.empty) {
                    alert('Player not found');
                    return;
                }

                const playerDoc = querySnapshot.docs[0];
                const playerData = playerDoc.data();
                const currentElo = playerData.eloRating || 1200;

                const thresholds = [
                    { name: 'Bronze', elo: 1400 },
                    { name: 'Silver', elo: 1600 },
                    { name: 'Gold', elo: 1800 },
                    { name: 'Emerald', elo: 2000 }
                ];

                const nextThreshold = thresholds.find(t => t.elo > currentElo);
                
                if (!nextThreshold) {
                    alert('Player is already at maximum rank (Emerald)');
                    return;
                }

                await updateDoc(playerDoc.ref, {
                    eloRating: nextThreshold.elo
                });

                alert(`Successfully promoted ${username} to ${nextThreshold.name} (${nextThreshold.elo} ELO)`);
                promoteDialog.style.display = 'none';
                promoteUsernameInput.value = '';
                
                // Refresh the player list
                await loadPlayers();

            } catch (error) {
                console.error('Error promoting player:', error);
                alert('Failed to promote player: ' + error.message);
            }
        });
    }
});

function setupCollapsibleButtons() {
    const buttons = document.querySelectorAll('.collapse-btn');
    
    buttons.forEach(button => {
        button.addEventListener('click', async () => {
            const targetId = button.getAttribute('data-target');
            const targetDiv = document.getElementById(targetId);
            
            // Hide all sections first
            document.querySelectorAll('#elo-ratings, #elo-history, #template-ladder').forEach(div => {
                if (div.id !== targetId) {
                    div.style.display = 'none';
                }
            });
            
            // Toggle the clicked section and load data
            if (targetDiv.style.display === 'none' || targetDiv.style.display === '') {
                targetDiv.style.display = 'block';
                button.classList.add('active');
                
                // Load appropriate data based on button clicked
                switch(targetId) {
                    case 'elo-ratings':
                        await loadEloRatings();
                        break;
                    case 'elo-history':
                        await loadEloHistory();
                        break;
                    case 'template-ladder':
                        displayTemplateLadder();
                        break;
                }
            } else {
                targetDiv.style.display = 'none';
                button.classList.remove('active');
            }
            
            // Update other button states
            buttons.forEach(btn => {
                if (btn !== button) {
                    btn.classList.remove('active');
                }
            });
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
    tableBody.innerHTML = ''; // Clear existing content

    try {
        const playersRef = collection(db, 'players');
        const q = query(playersRef, orderBy('eloRating', 'desc'));
        const querySnapshot = await getDocs(q);
        
        querySnapshot.forEach(doc => {
            const data = doc.data();
            const rankStyle = getRankStyle(data.eloRating);
            const row = document.createElement('tr');
            row.innerHTML = `
                <td style="color: ${rankStyle.color}; font-weight: bold;" title="${rankStyle.name}">
                    ${data.username}
                </td>
                <td>${data.eloRating || 1200}</td>
            `;
            tableBody.appendChild(row);
        });
    } catch (error) {
        console.error("Error loading ELO ratings:", error);
    }
}

async function loadEloHistory() {
    const tableBody = document.querySelector('#elo-history-table tbody'); // Updated selector
    tableBody.innerHTML = ''; // Clear existing content

    try {
        const { entries } = await getEloHistory();
        
        entries.forEach(record => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${record.timestamp?.toDate().toLocaleString() || 'N/A'}</td>
                <td>${record.player}</td>
                <td>${record.previousElo}</td>
                <td>${record.newElo}</td>
                <td>${record.change > 0 ? '+' + record.change : record.change}</td>
                <td>${record.opponent}</td>
                <td>${record.matchResult}</td>
            `;
            tableBody.appendChild(row);
        });
    } catch (error) {
        console.error("Error loading ELO history:", error);
        tableBody.innerHTML = '<tr><td colspan="7">Error loading ELO history</td></tr>';
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
        // Get player's current data
        const playersRef = collection(db, 'players');
        const q = query(playersRef, where('username', '==', username));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            alert('Player not found');
            return;
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
            alert('Player is already at maximum rank (Emerald)');
            return;
        }

        // Update player's ELO
        await setDoc(playerDoc.ref, {
            ...playerData,
            eloRating: nextThreshold.elo
        });

        alert(`Successfully promoted ${username} to ${nextThreshold.name} (${nextThreshold.elo} ELO)`);
        loadPlayers(); // Refresh the display
    } catch (error) {
        console.error('Error promoting player:', error);
        alert('Failed to promote player');
    }
}

// Add the button click handler
document.getElementById('promote-player-btn').addEventListener('click', async () => {
    const username = prompt('Enter the username of the player to promote:');
    if (username) {
        await promotePlayer(username.trim());
    }
});

// Add these event listeners after your existing ones
document.getElementById('promote-player').addEventListener('click', () => {
    document.getElementById('promote-dialog').style.display = 'block';
});

document.getElementById('cancel-promote').addEventListener('click', () => {
    document.getElementById('promote-dialog').style.display = 'none';
    document.getElementById('promote-username').value = '';
});

document.getElementById('confirm-promote').addEventListener('click', async () => {
    const username = document.getElementById('promote-username').value.trim();
    if (!username) {
        alert('Please enter a username');
        return;
    }

    try {
        const playersRef = collection(db, 'players');
        const q = query(playersRef, where('username', '==', username));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            alert('Player not found');
            return;
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
        const nextThreshold = thresholds.find(t => t.elo > currentElo);
        
        if (!nextThreshold) {
            alert('Player is already at maximum rank (Emerald)');
            return;
        }

        // Update player's ELO
        await updateDoc(playerDoc.ref, {
            ...playerData,
            eloRating: nextThreshold.elo
        });

        alert(`Successfully promoted ${username} to ${nextThreshold.name} (${nextThreshold.elo} ELO)`);
        document.getElementById('promote-dialog').style.display = 'none';
        document.getElementById('promote-username').value = '';
        
        // Refresh the player list
        await loadPlayers();

    } catch (error) {
        console.error('Error promoting player:', error);
        alert('Failed to promote player');
    }
});