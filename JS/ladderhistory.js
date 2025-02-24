import { db } from './firebase-config.js';
import { collection, query, orderBy, getDocs } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { getRankStyle } from './ranks.js';

document.addEventListener('DOMContentLoaded', () => {
    const season0Btn = document.getElementById('season0-btn');
    const season0Ladder = document.getElementById('season0-ladder');

    season0Btn.addEventListener('click', () => {
        const isHidden = season0Ladder.style.display === 'none' || !season0Ladder.style.display;
        season0Ladder.style.display = isHidden ? 'block' : 'none';
        
        if (isHidden) {
            loadSeason0Ladder();
        }
    });
});

async function loadSeason0Ladder() {
    try {
        const season0Ref = collection(db, 'season0');
        const q = query(season0Ref, orderBy('eloRating', 'desc'));
        const snapshot = await getDocs(q);

        const tbody = document.querySelector('#season0-table tbody');
        tbody.innerHTML = '';

        let position = 1;
        snapshot.forEach((doc) => {
            const data = doc.data();
            const tr = document.createElement('tr');
            
            // Apply rank styling
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
        console.error('Error loading season 0 ladder:', error);
    }
}