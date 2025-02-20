import { 
    collection, 
    getDocs,
    deleteDoc,
    doc,
    getDoc,
    query,
    where
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from './firebase-config.js';
import { getRankStyle } from './ranks.js';

async function displayLadder() {
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
                <td colspan="7" style="text-align: center;">No players found</td>
            `;
            tableBody.appendChild(emptyRow);
            return;
        }

        // Convert to array for sorting and filter out test players
        const players = [];
        querySnapshot.forEach((doc) => {
            const playerData = doc.data();
            const position = playerData.position || getNextAvailablePosition(players);
            
            players.push({
                ...playerData,
                id: doc.id,
                elo: playerData.eloRating || 0,
                position: position
            });
        });

        // Sort players by position (lowest number first)
        players.sort((a, b) => a.position - b.position);

        // Display sorted players
        updateLadderDisplay(players);

        console.log(`Successfully loaded ${players.length} players into ladder`);
    } catch (error) {
        console.error("Error loading ladder:", error);
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; color: red;">
                    Error loading ladder data: ${error.message}
                </td>
            </tr>
        `;
    }
}

// Modify the getNextAvailablePosition function
function getNextAvailablePosition(players) {
    if (players.length === 0) return 1;
    
    // Find the highest position number
    let maxPosition = 0;
    players.forEach(player => {
        if (player.position && typeof player.position === 'number' && player.position > maxPosition) {
            maxPosition = player.position;
        }
    });
    
    return maxPosition + 1;
}

async function updateLadderDisplay(ladderData) {
    const tbody = document.querySelector('#ladder tbody');
    tbody.innerHTML = '';
    
    // Update the table header
    const thead = document.querySelector('#ladder thead tr');
    thead.innerHTML = `
        <th>Rank</th>
        <th>Username</th>
        <th>Wins</th>
        <th>Losses</th>
        <th>Kills</th>
        <th>Deaths</th>
        <th>Win Rate</th>
    `;
    
    for (const player of ladderData) {
        const row = document.createElement('tr');
        
        // Create rank cell
        const rankCell = document.createElement('td');
        rankCell.textContent = player.position;
        
        // Create username cell with styling
        const usernameCell = document.createElement('td');
        const usernameLink = document.createElement('a');
        usernameLink.href = `profile.html?username=${encodeURIComponent(player.username)}`;
        usernameLink.textContent = player.username;
        
        // Set ELO-based colors
        const elo = parseFloat(player.elo) || 0;
        if (elo >= 2000) {
            usernameLink.style.color = '#50C878';
            if (player.position === 1) {
                usernameLink.style.textShadow = '0 0 5px #50C878';
                usernameLink.style.animation = 'glow 2s ease-in-out infinite';
            }
        } else if (elo >= 1800) {
            usernameLink.style.color = '#FFD700';
        } else if (elo >= 1600) {
            usernameLink.style.color = '#C0C0C0';
        } else if (elo >= 1400) {
            usernameLink.style.color = '#CD7F32';
        } else {
            usernameLink.style.color = 'gray';
        }
        
        usernameLink.style.textDecoration = 'none';
        usernameCell.appendChild(usernameLink);

        // Get match history for the player
        const approvedMatchesRef = collection(db, 'approvedMatches');
        const [winnerMatches, loserMatches] = await Promise.all([
            getDocs(query(approvedMatchesRef, where('winnerUsername', '==', player.username))),
            getDocs(query(approvedMatchesRef, where('loserUsername', '==', player.username)))
        ]);

        // Calculate stats from matches
        let stats = {
            wins: winnerMatches.size,
            losses: loserMatches.size,
            totalKills: 0,
            totalDeaths: 0,
            winRate: 0
        };

        // Sum up kills and deaths
        winnerMatches.forEach(doc => {
            const match = doc.data();
            stats.totalKills += match.winnerKills || 0;
            stats.totalDeaths += match.winnerDeaths || 0;
        });

        loserMatches.forEach(doc => {
            const match = doc.data();
            stats.totalKills += match.loserKills || 0;
            stats.totalDeaths += match.loserDeaths || 0;
        });

        // Calculate win rate
        const totalMatches = stats.wins + stats.losses;
        stats.winRate = totalMatches > 0 ? ((stats.wins / totalMatches) * 100).toFixed(2) : 0;

        // Create stats cells
        const winsCell = document.createElement('td');
        winsCell.textContent = stats.wins || 0;
        
        const lossesCell = document.createElement('td');
        lossesCell.textContent = stats.losses || 0;
        
        const killsCell = document.createElement('td');
        killsCell.textContent = stats.totalKills || 0;
        
        const deathsCell = document.createElement('td');
        deathsCell.textContent = stats.totalDeaths || 0;
        
        const winRateCell = document.createElement('td');
        winRateCell.textContent = `${stats.winRate || 0}%`;

        // Add all cells to row
        row.appendChild(rankCell);
        row.appendChild(usernameCell);
        row.appendChild(winsCell);
        row.appendChild(lossesCell);
        row.appendChild(killsCell);
        row.appendChild(deathsCell);
        row.appendChild(winRateCell);
        
        tbody.appendChild(row);
    }
}

async function loadPlayers() {
    const tableBody = document.querySelector('#players-table tbody');
    tableBody.innerHTML = '';

    try {
        const playersRef = collection(db, 'players');
        const playersSnapshot = await getDocs(playersRef);

        playersSnapshot.forEach(doc => {
            const player = doc.data();
            const row = document.createElement('tr');
            
            // Apply color based on ELO rating
            const elo = parseFloat(player.eloRating) || 0;
            let usernameColor = 'gray'; // default color for unranked

            if (elo >= 2000) {
                usernameColor = '#50C878'; // Emerald Green
            } else if (elo >= 1800) {
                usernameColor = '#FFD700'; // Gold
            } else if (elo >= 1600) {
                usernameColor = '#C0C0C0'; // Silver
            } else if (elo >= 1400) {
                usernameColor = '#CD7F32'; // Bronze
            }

            row.innerHTML = `
                <td style="color: ${usernameColor}">${player.username}</td>
                <td style="color: ${usernameColor}">${player.eloRating || 'N/A'}</td>
                <td>
                    <button class="remove-btn" data-id="${doc.id}">Remove</button>
                </td>
            `;
            tableBody.appendChild(row);
        });

        // Add event listeners for remove buttons
        document.querySelectorAll('.remove-btn').forEach(button => {
            button.addEventListener('click', async (e) => {
                if (confirm('Are you sure you want to remove this player?')) {
                    const playerId = e.target.dataset.id;
                    try {
                        await deleteDoc(doc(db, 'players', playerId));
                        loadPlayers(); // Refresh the list
                    } catch (error) {
                        console.error('Error removing player:', error);
                        alert('Failed to remove player');
                    }
                }
            });
        });
    } catch (error) {
        console.error('Error loading players:', error);
        alert('Failed to load players');
    }
}

// Add validation for ELO input if element exists
const eloInput = document.getElementById('new-player-elo');
if (eloInput) {
    eloInput.addEventListener('input', function() {
        const value = parseInt(this.value);
        if (value > 3000) {
            this.value = 3000;
        } else if (value < 0) {
            this.value = 0;
        }
    });
}

// Initialize ladder when DOM is loaded
document.addEventListener('DOMContentLoaded', displayLadder);

export { displayLadder };
