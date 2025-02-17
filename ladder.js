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
        // Store email as a data attribute and use username for display
        usernameLink.href = `profile.html?email=${encodeURIComponent(player.email)}`;
        usernameLink.textContent = player.username; // Only show username
        
        // Set color based on ELO
        const elo = parseFloat(player.elo) || 0;
        if (elo >= 2100) {
            usernameLink.style.color = '#50C878'; // Emerald Green
            if (rank === 1) {
                usernameLink.style.textShadow = '0 0 5px #50C878';
                usernameLink.style.animation = 'glow 2s ease-in-out infinite';
            }
        } else if (elo >= 1800) {
            usernameLink.style.color = '#C0C0C0'; // Silver
        } else if (elo >= 1400) {
            usernameLink.style.color = '#CD7F32'; // Bronze
        } else {
            usernameLink.style.color = 'gray'; // default color
        }
        
        usernameLink.style.textDecoration = 'none';
        
        // Add hover effect while maintaining rank color
        usernameLink.addEventListener('mouseenter', () => {
            usernameLink.style.textDecoration = 'underline';
            usernameLink.style.opacity = '0.8';
        });
        
        usernameLink.addEventListener('mouseleave', () => {
            usernameLink.style.textDecoration = 'none';
            usernameLink.style.opacity = '1';
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
