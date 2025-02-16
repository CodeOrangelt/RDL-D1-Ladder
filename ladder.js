import { 
    collection, 
    query, 
    orderBy, 
    getDocs 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from './firebase-config.js';

async function displayLadder() {
    console.log('Loading ladder...');
    const tableBody = document.querySelector('#ladder tbody');
    if (!tableBody) {
        console.error('Ladder table body not found');
        return;
    }

    try {
        const playersRef = collection(db, 'players');
        // Order by position ascending, then by username as backup
        const q = query(
            playersRef, 
            orderBy('position', 'asc'),
            orderBy('username', 'asc')
        );
        
        const querySnapshot = await getDocs(q);
        
        // Clear existing content
        tableBody.innerHTML = '';

        if (querySnapshot.empty) {
            console.log('No players found in the database');
            const emptyRow = document.createElement('tr');
            emptyRow.innerHTML = `
                <td colspan="3" style="text-align: center;">No players found</td>
            `;
            tableBody.appendChild(emptyRow);
            return;
        }

        let rank = 1;
        querySnapshot.forEach((doc) => {
            const playerData = doc.data();
            console.log('Player data:', playerData); // Debug log
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${rank}</td>
                <td>${playerData.username || 'Unknown'}</td>
                <td>${playerData.eloRating || 1200}</td>
            `;
            tableBody.appendChild(row);
            rank++;
        });

        console.log(`Loaded ${querySnapshot.size} players into ladder`);
    } catch (error) {
        console.error("Error loading ladder:", error);
    }
}

// Initialize ladder when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    displayLadder();
});

// Export for use in other modules if needed
export { displayLadder };
