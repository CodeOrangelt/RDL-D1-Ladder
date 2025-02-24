import { db, auth } from './firebase-config.js';
import { collection, query, orderBy, getDocs, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { getRankStyle } from './ranks.js';

document.addEventListener('DOMContentLoaded', () => {
    setupSeasonButton('season0');
    // Add more seasons as they come
    // setupSeasonButton('season1');
    // setupSeasonButton('season2');

    auth.onAuthStateChanged(user => {
        if (user) {
            setupStatsButton();
        } else {
            console.log('User not authenticated');
            // Optionally redirect to login page
            // window.location.href = 'login.html';
        }
    });
});

function setupSeasonButton(seasonId) {
    const button = document.getElementById(`${seasonId}-btn`);
    const ladder = document.getElementById(`${seasonId}-ladder`);

    button.addEventListener('click', () => {
        const isHidden = ladder.style.display === 'none' || !ladder.style.display;
        ladder.style.display = isHidden ? 'block' : 'none';
        
        if (isHidden) {
            loadSeasonLadder(seasonId);
        }
    });
}

function setupStatsButton() {
    const statsBtn = document.getElementById('season0-stats-btn');
    const statsSection = document.getElementById('season0-stats');

    statsBtn.addEventListener('click', () => {
        const isHidden = statsSection.style.display === 'none' || !statsSection.style.display;
        statsSection.style.display = isHidden ? 'block' : 'none';
        
        if (isHidden) {
            loadSeasonStats();
        }
    });
}

async function loadSeasonLadder(seasonId) {
    try {
        const seasonRef = collection(db, seasonId);
        const q = query(seasonRef, orderBy('eloRating', 'desc'));
        const snapshot = await getDocs(q);

        const tbody = document.querySelector(`#${seasonId}-table tbody`);
        tbody.innerHTML = '';

        let position = 1;
        snapshot.forEach((doc) => {
            const data = doc.data();
            const tr = document.createElement('tr');
            
            const rankStyle = getRankStyle(data.eloRating);
            tr.style.backgroundColor = rankStyle.backgroundColor;
            tr.style.color = rankStyle.color;

            tr.innerHTML = `
                <td>${position}</td>
                <td>${data.username || 'Unknown'}</td>
                <td>${Math.round(data.eloRating)}</td>
            `;
            tbody.appendChild(tr);
            position++;
        });
    } catch (error) {
        console.error(`Error loading ${seasonId} ladder:`, error);
    }
}

async function loadSeasonStats() {
    try {
        const user = auth.currentUser;
        if (!user) {
            console.error('No authenticated user');
            return;
        }

        const statsRef = doc(db, 'season0records', 'snapshot');
        const statsDoc = await getDoc(statsRef);
        
        if (!statsDoc.exists()) {
            console.log('No stats found for season 0');
            return;
        }

        const records = statsDoc.data().records;
        const tbody = document.querySelector('#season0-stats-table tbody');
        tbody.innerHTML = '';

        records.forEach(record => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${record.username}</td>
                <td>${record.wins}</td>
                <td>${record.losses}</td>
                <td>${(record.winRate * 100).toFixed(1)}%</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (error) {
        console.error('Error loading season stats:', error);
        const statsSection = document.getElementById('season0-stats');
        if (statsSection) {
            statsSection.innerHTML = '<p class="error-message">Error loading stats. Please try again later.</p>';
        }
    }
}