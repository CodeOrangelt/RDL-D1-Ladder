import { 
    collection, 
    query, 
    orderBy, 
    getDocs 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from './firebase-config.js';

async function displayLadder() {
    const tableBody = document.querySelector('#ladder tbody');
    if (!tableBody) {
        console.error('Ladder table body not found');
        return;
    }

    try {
        // Get players collection reference
        const playersRef = collection(db, 'players');
        // Create query ordered by position
        const q = query(playersRef, orderBy('position', 'asc'));
        // Get all players
        const querySnapshot = await getDocs(q);

        // Clear existing table content
        tableBody.innerHTML = '';
        
        // Check if we have any players
        if (querySnapshot.empty) {
            console.log('No players found in the database');
            return;
        }

        // Populate table with players
        let rank = 1;
        querySnapshot.forEach((doc) => {
            const playerData = doc.data();
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
    console.log('Loading ladder...');
    displayLadder();
});

// Export for use in other modules if needed
export { displayLadder };
