import { 
    collection, 
    getDocs 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from './firebase-config.js';
import { getRankStyle } from './ranks.js';

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
        
        console.log('Executing query...');
        const querySnapshot = await getDocs(playersRef);
        console.log('Query complete. Number of documents:', querySnapshot.size);
        
        // Clear existing content
        tableBody.innerHTML = '';

        if (querySnapshot.empty) {
            console.log('No players found in the database.');
            const emptyRow = document.createElement('tr');
            emptyRow.innerHTML = `
                <td colspan="3" style="text-align: center;">No players found</td>
            `;
            tableBody.appendChild(emptyRow);
            return;
        }

        // Convert to array for sorting and filter out test players
        const players = [];
        querySnapshot.forEach((doc) => {
            const playerData = doc.data();
            // Skip test players
            if (playerData.email && (playerData.email.includes('test4@') || playerData.email.includes('test5@'))) {
                return;
            }
            console.log('Player data:', playerData);
            players.push({
                ...playerData,
                position: playerData.position || Number.MAX_SAFE_INTEGER,
            });
        });

        // Sort players by position
        players.sort((a, b) => a.position - b.position);

        // Display sorted players
        players.forEach((playerData, index) => {
            const rankStyle = getRankStyle(playerData.eloRating);
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${index + 1}</td>
                <td style="color: ${rankStyle.color}; font-weight: bold;" title="${rankStyle.name}">
                    ${playerData.username || 'Unknown'}
                </td>
            `;
            tableBody.appendChild(row);
        });

        console.log(`Successfully loaded ${players.length} players into ladder`);
    } catch (error) {
        console.error("Error loading ladder:", error);
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
document.addEventListener('DOMContentLoaded', displayLadder);

export { displayLadder };
