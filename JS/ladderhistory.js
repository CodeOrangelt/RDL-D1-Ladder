import { db, auth } from './firebase-config.js';
import { collection, query, orderBy, getDocs, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { getRankStyle } from './ranks.js';

document.addEventListener('DOMContentLoaded', () => {
    auth.onAuthStateChanged(user => {
        if (user) {
            setupStatsButton();
            setupSeasonButton('season0');
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
    
    if (!button || !ladder) {
        console.error(`Missing elements for ${seasonId}`);
        return;
    }

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
    
    if (!statsBtn || !statsSection) {
        console.error('Missing stats elements');
        return;
    }

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
        const statsRef = doc(db, 'season0records', 'snapshot');
        const statsDoc = await getDoc(statsRef);
        
        if (!statsDoc.exists()) {
            console.log('No stats found for season 0');
            document.getElementById('season0-stats').innerHTML = '<p>No statistics available for this season.</p>';
            return;
        }

        const records = statsDoc.data().records;
        const tbody = document.querySelector('#season0-stats-table tbody');
        tbody.innerHTML = '';

        records.forEach(record => {
            const tr = document.createElement('tr');
            const winRate = record.wins + record.losses > 0 
                ? ((record.wins / (record.wins + record.losses)) * 100).toFixed(1) 
                : '0.0';
            
            tr.innerHTML = `
                <td>${record.username}</td>
                <td>${record.wins || 0}</td>
                <td>${record.losses || 0}</td>
                <td>${winRate}%</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (error) {
        console.error('Error loading season stats:', error);
        document.getElementById('season0-stats').innerHTML = '<p class="error-message">Error loading statistics. Please try again later.</p>';
    }
}