import { 
    collection, 
    query, 
    orderBy, 
    getDocs,
    getDoc,
    doc 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// approved-matches.js

// Helper function to get ELO class
function getEloClass(elo) {
    if (elo >= 2000) return 'elo-emerald';
    if (elo >= 1800) return 'elo-gold';
    if (elo >= 1600) return 'elo-silver';
    if (elo >= 1400) return 'elo-bronze';
    return 'elo-unranked';
}

document.addEventListener('DOMContentLoaded', async () => {
    const approvedMatchesRef = collection(window.db, 'approvedMatches');
    const q = query(approvedMatchesRef, orderBy('createdAt', 'desc'));
    
    try {
        const querySnapshot = await getDocs(q);
        const tableBody = document.querySelector('#approved-matches-table tbody');
        
        for (const doc of querySnapshot.docs) {
            const data = doc.data();
            const row = document.createElement('tr');
            
            // Get player ELO ratings
            const winnerData = await getPlayerData(data.winnerUsername);
            const loserData = await getPlayerData(data.loserUsername);
            
            // Create cells with ELO-colored player names
            const winnerCell = document.createElement('td');
            const loserCell = document.createElement('td');
            
            winnerCell.innerHTML = `<a href="profile.html?username=${encodeURIComponent(data.winnerUsername)}" 
                class="player-link ${getEloClass(winnerData?.eloRating || 1200)}">${data.winnerUsername}</a>`;
            loserCell.innerHTML = `<a href="profile.html?username=${encodeURIComponent(data.loserUsername)}" 
                class="player-link ${getEloClass(loserData?.eloRating || 1200)}">${data.loserUsername}</a>`;

            // Add winner and loser cells
            row.appendChild(winnerCell);
            row.appendChild(loserCell);
            
            // Create and populate remaining table cells
            const cells = [
                data.winnerScore || 'N/A',
                data.loserScore,
                data.winnerSuicides || 'N/A',
                data.suicides,
                data.mapPlayed,
                data.winnerComment || 'N/A',
                data.loserComment,
                data.createdAt ? new Date(data.createdAt.seconds * 1000).toLocaleString() : 'N/A'
            ];

            cells.forEach(cellData => {
                const cell = document.createElement('td');
                cell.textContent = cellData;
                row.appendChild(cell);
            });

            tableBody.appendChild(row);
        }
    } catch (error) {
        console.error("Error fetching approved matches:", error);
    }
});

async function getPlayerData(username) {
    const playerDoc = await getDoc(doc(window.db, 'players', username));
    return playerDoc.exists() ? playerDoc.data() : null;
}
