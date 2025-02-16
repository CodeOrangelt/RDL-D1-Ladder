import { auth, db } from './firebase-config.js';
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
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
        viewEloButton.addEventListener('click', displayEloRatings);
    }

    const viewEloHistoryBtn = document.getElementById('view-elo-history');
    const eloHistoryDiv = document.getElementById('elo-history');
    
    viewEloHistoryBtn.addEventListener('click', async () => {
        eloHistoryDiv.style.display = 'block';
        await loadEloHistory();
    });
});

async function displayEloRatings() {
    try {
        const playersRef = collection(db, 'players');
        const snapshot = await getDocs(playersRef);
        const tableBody = document.querySelector('#elo-table tbody');
        tableBody.innerHTML = '';

        snapshot.forEach(doc => {
            const player = doc.data();
            const row = `
                <tr>
                    <td>${player.username}</td>
                    <td>${player.eloRating || 1000}</td>
                </tr>
            `;
            tableBody.innerHTML += row;
        });

        document.getElementById('elo-ratings').style.display = 'block';
    } catch (error) {
        console.error('Error fetching ELO ratings:', error);
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