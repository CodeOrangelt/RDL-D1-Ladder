import { 
    collection, 
    query, 
    orderBy, 
    getDocs 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// approved-matches.js

document.addEventListener('DOMContentLoaded', async () => {
    const approvedMatchesRef = collection(window.db, 'approvedMatches');
    const q = query(approvedMatchesRef, orderBy('createdAt', 'desc'));
    
    try {
        const querySnapshot = await getDocs(q);
        const tableBody = document.querySelector('#approved-matches-table tbody');
        
        querySnapshot.forEach(doc => {
            const data = doc.data();
            const row = document.createElement('tr');
            
            // Create and populate table cells
            const cells = [
                data.winnerUsername,
                data.loserUsername,
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
        });
    } catch (error) {
        console.error("Error fetching approved matches:", error);
    }
});
