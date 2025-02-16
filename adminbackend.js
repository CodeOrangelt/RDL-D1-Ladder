import { auth, db } from './firebase-config.js';
import { collection, getDocs, query, orderBy } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { getEloHistory } from './elo-history.js';

document.addEventListener('DOMContentLoaded', async () => {
    // Check if user is admin
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            const userDoc = await db.collection('users').doc(user.uid).get();
            const isAdmin = userDoc.data()?.isAdmin || false;
            
            if (!isAdmin) {
                window.location.href = 'index.html'; // Redirect non-admins
            }
        } else {
            window.location.href = 'login.html'; // Redirect if not logged in
        }
    });

    const viewEloButton = document.getElementById('view-elo-ratings');
    if (viewEloButton) {
        viewEloButton.addEventListener('click', async () => {
            document.getElementById('elo-ratings').style.display = 'block';
            await loadEloRatings();
        });
    }

    const viewEloHistoryBtn = document.getElementById('view-elo-history');
    const eloHistoryDiv = document.getElementById('elo-history');
    
    viewEloHistoryBtn.addEventListener('click', async () => {
        eloHistoryDiv.style.display = 'block';
        await loadEloHistory();
    });
});

async function loadEloRatings() {
    const tableBody = document.querySelector('#elo-table tbody');
    tableBody.innerHTML = ''; // Clear existing content

    try {
        const playersRef = collection(db, 'players');
        const q = query(playersRef, orderBy('eloRating', 'desc'));
        const querySnapshot = await getDocs(q);
        
        querySnapshot.forEach(doc => {
            const data = doc.data();
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${data.username}</td>
                <td>${data.eloRating || 1200}</td>
            `;
            tableBody.appendChild(row);
        });
    } catch (error) {
        console.error("Error loading ELO ratings:", error);
    }
}

async function loadEloHistory() {
    const tableBody = document.querySelector('#elo-history-table tbody');
    tableBody.innerHTML = ''; // Clear existing content

    try {
        const history = await getEloHistory();
        
        history.forEach(record => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${record.timestamp.toDate().toLocaleString()}</td>
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
    }
}

import { auth, db } from './firebase-config.js';
import { collection, getDocs, query, orderBy, addDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { getEloHistory } from './elo-history.js';

// Add test data array
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

document.addEventListener('DOMContentLoaded', async () => {
    // ...existing auth code...

    // Add new button to HTML
    const adminActions = document.getElementById('admin-actions');
    if (adminActions) {
        const populateButton = document.createElement('button');
        populateButton.id = 'populate-test-ladder';
        populateButton.textContent = 'Populate Test Ladder';
        adminActions.appendChild(populateButton);

        populateButton.addEventListener('click', populateTestLadder);
    }
});

async function populateTestLadder() {
    try {
        const playersRef = collection(db, 'players');
        
        // Clear existing players
        const existingPlayers = await getDocs(playersRef);
        const deletePromises = existingPlayers.docs.map(doc => doc.ref.delete());
        await Promise.all(deletePromises);

        // Add test players
        const addPromises = testPlayers.map(player => addDoc(playersRef, player));
        await Promise.all(addPromises);

        alert('Test ladder populated successfully!');
        // Refresh ELO ratings display if visible
        if (document.getElementById('elo-ratings').style.display === 'block') {
            await loadEloRatings();
        }
    } catch (error) {
        console.error("Error populating test ladder:", error);
        alert('Error populating test ladder: ' + error.message);
    }
}

// ...existing code for loadEloRatings and loadEloHistory...