import { collection, getDocs, query, orderBy, addDoc, deleteDoc, where } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
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
    const tableBody = document.querySelector('#elo-history tbody'); // Fixed selector
    tableBody.innerHTML = ''; // Clear existing content

    try {
        const { entries } = await getEloHistory(); // Destructure to get entries
        
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