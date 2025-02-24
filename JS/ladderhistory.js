import { db } from './firebase-config.js';
import { collection, query, orderBy, getDocs } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { getRankStyle } from './ranks.js';

document.addEventListener('DOMContentLoaded', () => {
    setupSeasonButton('season0');
    // Add more seasons as they come
    // setupSeasonButton('season1');
    // setupSeasonButton('season2');
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