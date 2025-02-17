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
        updateLadderDisplay(players);

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

function updateLadderDisplay(ladderData) {
    const tbody = document.querySelector('#ladder tbody');
    tbody.innerHTML = '';
    
    let rank = 1;
    ladderData.forEach(player => {
        const row = document.createElement('tr');
        
        // Create rank cell
        const rankCell = document.createElement('td');
        rankCell.textContent = rank;
        
        // Create username cell with clickable link
        const usernameCell = document.createElement('td');
        const usernameLink = document.createElement('a');
        usernameLink.href = `profile.html?id=${player.uid}`; // Link to player's profile
        usernameLink.textContent = player.username;
        usernameLink.style.color = 'white'; // Match existing text color
        usernameLink.style.textDecoration = 'none'; // Remove default underline
        
        // Add hover effect
        usernameLink.addEventListener('mouseenter', () => {
            usernameLink.style.textDecoration = 'underline';
            usernameLink.style.color = '#b026b9'; // Purple hover color
        });
        
        usernameLink.addEventListener('mouseleave', () => {
            usernameLink.style.textDecoration = 'none';
            usernameLink.style.color = 'white';
        });
        
        usernameCell.appendChild(usernameLink);
        
        // Add cells to row
        row.appendChild(rankCell);
        row.appendChild(usernameCell);
        tbody.appendChild(row);
        
        rank++;
    });
}

// Initialize ladder when DOM is loaded
document.addEventListener('DOMContentLoaded', displayLadder);

export { displayLadder };
