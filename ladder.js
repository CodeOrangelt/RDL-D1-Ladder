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
        console.log('Fetching players from Firestore...');
        const playersRef = collection(db, 'players');
        // Simplified query to just order by position
        const q = query(playersRef, orderBy('position', 'asc'));
        
        console.log('Executing query...');
        const querySnapshot = await getDocs(q);
        console.log('Query complete. Number of documents:', querySnapshot.size);
        
        // Clear existing content
        tableBody.innerHTML = '';

        if (querySnapshot.empty) {
            console.log('No players found in the database. Checking database connection...');
            // Test database connection
            const testQuery = await getDocs(collection(db, 'players'));
            console.log('Raw collection access returned:', testQuery.size, 'documents');
            
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
            console.log('Player document ID:', doc.id);
            console.log('Player data:', playerData);
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${rank}</td>
                <td>${playerData.username || 'Unknown'}</td>
                <td>${playerData.eloRating || 1200}</td>
            `;
            tableBody.appendChild(row);
            rank++;
        });

        console.log(`Successfully loaded ${querySnapshot.size} players into ladder`);
    } catch (error) {
        console.error("Error loading ladder:", error);
        console.error("Error details:", {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
        tableBody.innerHTML = `
            <tr>
                <td colspan="3" style="text-align: center; color: red;">
                    Error loading ladder data: ${error.message}
                </td>
            </tr>
        `;
    }
}

// Initialize ladder when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing ladder display...');
    displayLadder().catch(error => {
        console.error('Failed to display ladder:', error);
    });
});

export { displayLadder };
