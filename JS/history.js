import { db } from './firebase-config.js';
import { collection, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

class HistoryViewer {
    async init() {
        try {
            const seasonsRef = collection(db, 'seasons');
            const seasonsQuery = query(seasonsRef, orderBy('seasonNumber', 'desc'));
            const seasonsSnapshot = await getDocs(seasonsQuery);
            
            const container = document.getElementById('seasons-container');
            
            seasonsSnapshot.forEach(doc => {
                const seasonData = doc.data();
                const seasonElement = this.createSeasonElement(seasonData);
                container.appendChild(seasonElement);
            });

        } catch (error) {
            console.error('Error loading seasons:', error);
        }
    }

    createSeasonElement(seasonData) {
        const div = document.createElement('div');
        div.className = 'season-container';
        
        const date = seasonData.date.toDate().toLocaleDateString();
        
        div.innerHTML = `
            <div class="season-header" onclick="this.nextElementSibling.classList.toggle('active'); this.querySelector('.toggle-icon').classList.toggle('active')">
                <h2>Season ${seasonData.seasonNumber}</h2>
                <span class="toggle-icon">▼</span>
            </div>
            <div class="season-content">
                <p>Archived: ${date}</p>
                <table class="season-table">
                    <thead>
                        <tr>
                            <th>Position</th>
                            <th>Player</th>
                            <th>Final ELO</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${seasonData.players
                            .sort((a, b) => a.position - b.position)
                            .map(player => `
                                <tr>
                                    <td>${player.position}</td>
                                    <td>${player.username}</td>
                                    <td>${player.eloRating}</td>
                                </tr>
                            `).join('')}
                    </tbody>
                </table>
            </div>
        `;
        
        return div;
    }
}

const viewer = new HistoryViewer();
viewer.init();