import { 
    collection, 
    query, 
    orderBy, 
    getDocs,
    where 
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

// Helper function to get player data
async function getPlayerData(username) {
    try {
        const playersRef = collection(window.db, 'players');
        const q = query(playersRef, where('username', '==', username));
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
            return snapshot.docs[0].data();
        }
        return null;
    } catch (error) {
        console.error('Error fetching player data:', error);
        return null;
    }
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
            
            // Get current player ELO ratings
            const winnerData = await getPlayerData(data.winnerUsername);
            const loserData = await getPlayerData(data.loserUsername);
            
            const winnerElo = winnerData?.eloRating || 1200;
            const loserElo = loserData?.eloRating || 1200;

            // Format date
            const date = data.createdAt ? new Date(data.createdAt.seconds * 1000).toLocaleString() : 'N/A';
            
            row.innerHTML = `
                <td>
                    <a href="profile.html?username=${encodeURIComponent(data.winnerUsername)}" 
                       class="player-link ${getEloClass(winnerElo)}">
                        ${data.winnerUsername}
                    </a>
                </td>
                <td>
                    <a href="profile.html?username=${encodeURIComponent(data.loserUsername)}" 
                       class="player-link ${getEloClass(loserElo)}">
                        ${data.loserUsername}
                    </a>
                </td>
                <td>${data.winnerScore}</td>
                <td>${data.loserScore}</td>
                <td>${data.winnerSuicides || 'N/A'}</td>
                <td>${data.loserSuicides || 'N/A'}</td>
                <td>${data.mapPlayed || 'N/A'}</td>
                <td>${data.winnerComment || 'N/A'}</td>
                <td>${data.loserComment || 'N/A'}</td>
                <td>${date}</td>
            `;
            
            tableBody.appendChild(row);
        }
    } catch (error) {
        console.error("Error fetching approved matches:", error);
        tableBody.innerHTML = '<tr><td colspan="10">Error loading matches</td></tr>';
    }
});
