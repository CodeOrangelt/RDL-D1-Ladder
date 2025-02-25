import { 
    collection, 
    getDocs,
    deleteDoc,
    doc,
    getDoc,
    query,
    where,
    updateDoc,
    Timestamp,
    onSnapshot
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
        const playersRef = collection(db, 'players');
        const querySnapshot = await getDocs(playersRef);
        
        // Convert to array and filter out test players
        const players = [];
        querySnapshot.forEach((doc) => {
            const playerData = doc.data();
            players.push({
                ...playerData,
                id: doc.id,
                elo: playerData.eloRating || 0,
                position: playerData.position || Number.MAX_SAFE_INTEGER // Use existing position
            });
        });

        // Sort players by position
        players.sort((a, b) => {
            if (!a.position) return 1;
            if (!b.position) return -1;
            return a.position - b.position;
        });

        // Reassign positions sequentially
        players.forEach((player, index) => {
            player.position = index + 1;
        });

        // Update the display
        updateLadderDisplay(players);

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

// Add this new function
async function updatePlayerPositions(winnerUsername, loserUsername) {
    try {
        // Get all players
        const playersRef = collection(db, 'players');
        const querySnapshot = await getDocs(playersRef);
        const players = [];
        
        querySnapshot.forEach((doc) => {
            players.push({
                id: doc.id,
                ...doc.data()
            });
        });

        // Get winner and loser positions
        const winner = players.find(p => p.username === winnerUsername);
        const loser = players.find(p => p.username === loserUsername);

        // Only update positions if winner is below loser
        if (winner.position > loser.position) {
            const winnerNewPosition = loser.position;
            
            // Update positions for players between winner and loser
            for (const player of players) {
                if (player.position >= loser.position && player.position < winner.position) {
                    // Move everyone down one position
                    await updateDoc(doc(db, 'players', player.id), {
                        position: player.position + 1
                    });
                }
            }

            // Update winner's position
            await updateDoc(doc(db, 'players', winner.id), {
                position: winnerNewPosition
            });

            // Inside updatePlayerPositions function, after updating winner's position
            if (winnerNewPosition === 1) {
                // Check if this is the first time reaching #1
                const winnerDoc = doc(db, 'players', winner.id);
                const winnerData = await getDoc(winnerDoc);
                
                if (!winnerData.data().firstPlaceDate) {
                    await updateDoc(winnerDoc, {
                        firstPlaceDate: Timestamp.now()
                    });
                }
            }

            // If the previous #1 player is displaced
            if (loser.position === 1) {
                const loserDoc = doc(db, 'players', loser.id);
                await updateDoc(loserDoc, {
                    firstPlaceDate: null // Reset their streak
                });
            }
        }
    } catch (error) {
        console.error("Error updating player positions:", error);
    }
}

// Add this helper function at the top level
function calculateStreakDays(startDate) {
    if (!startDate) return 0;
    const start = startDate.toDate();
    const now = new Date();
    const diffTime = Math.abs(now - start);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

// Modify your existing updateLadderDisplay function to sort by position
async function updateLadderDisplay(ladderData) {
    // Sort by position before displaying
    ladderData.sort((a, b) => a.position - b.position);
    
    const tbody = document.querySelector('#ladder tbody');
    tbody.innerHTML = '';
    
    // Update the table header with new columns
    const thead = document.querySelector('#ladder thead tr');
    thead.innerHTML = `
        <th>Rank</th>
        <th>Username</th>
        <th>Matches</th>
        <th>Wins</th>
        <th>Losses</th>
        <th>K/D</th>
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
                
                // Add streak display for #1 position
                if (player.firstPlaceDate) {
                    const streakDays = calculateStreakDays(player.firstPlaceDate);
                    if (streakDays > 0) {
                        const streakSpan = document.createElement('span');
                        streakSpan.innerHTML = ` 🔥 ${streakDays}d`;
                        streakSpan.style.fontSize = '0.9em';
                        streakSpan.style.color = '#FF4500';
                        streakSpan.style.marginLeft = '5px';
                        usernameCell.appendChild(streakSpan);
                    }
                }
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
            totalMatches: winnerMatches.size + loserMatches.size,
            kda: 0,
            winRate: 0
        };

        // Calculate kills and deaths from matches
        winnerMatches.forEach(doc => {
            const match = doc.data();
            stats.totalKills += parseInt(match.winnerScore) || 0;
            stats.totalDeaths += parseInt(match.loserScore) || 0;
        });

        loserMatches.forEach(doc => {
            const match = doc.data();
            stats.totalKills += parseInt(match.loserScore) || 0;
            stats.totalDeaths += parseInt(match.winnerScore) || 0;
        });

        // Calculate KDA ratio
        stats.kda = stats.totalDeaths > 0 ? 
            (stats.totalKills / stats.totalDeaths).toFixed(2) : 
            stats.totalKills;

        // Calculate win rate
        stats.winRate = stats.totalMatches > 0 ? 
            ((stats.wins / stats.totalMatches) * 100).toFixed(1) : 0;

        // Create cells with new stats
        const matchesCell = document.createElement('td');
        matchesCell.textContent = stats.totalMatches;

        const winsCell = document.createElement('td');
        winsCell.textContent = stats.wins;
        
        const lossesCell = document.createElement('td');
        lossesCell.textContent = stats.losses;
        
        const kdaCell = document.createElement('td');
        kdaCell.textContent = stats.kda;
        
        const winRateCell = document.createElement('td');
        winRateCell.textContent = `${stats.winRate}%`;

        // Add all cells to row
        row.appendChild(rankCell);
        row.appendChild(usernameCell);
        row.appendChild(matchesCell);
        row.appendChild(winsCell);
        row.appendChild(lossesCell);
        row.appendChild(kdaCell);
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

/// Simplified function to create and update raw ladder feed
function setupRawLadderFeed() {
    const playersRef = collection(db, 'players');
    
    // Set up real-time listener for player changes
    onSnapshot(playersRef, (snapshot) => {
        try {
            console.log("Raw leaderboard snapshot received");
            
            // Extract player data
            const players = [];
            snapshot.forEach((doc) => {
                const playerData = doc.data();
                players.push({
                    username: playerData.username,
                    elo: parseInt(playerData.eloRating) || 0,
                    position: playerData.position || Number.MAX_SAFE_INTEGER
                });
            });
            
            // Sort players by ELO rating (highest to lowest)
            players.sort((a, b) => b.elo - a.elo);
            
            // Assign positions sequentially
            players.forEach((player, index) => {
                player.position = index + 1;
            });
            
            // Create raw text representation
            let rawText = 'NGS LADDER - RAW DATA\n\n';
            players.forEach(player => {
                rawText += `${player.position}. ${player.username} (${player.elo})\n`;
            });
            
            // Update the page content if we're on the raw leaderboard page
            if (window.location.pathname.includes('../HTML/rawleaderboard.html')) {
                console.log("Updating raw leaderboard content");
                document.body.innerText = rawText;
            }
        } catch (error) {
            console.error("Error updating raw ladder feed:", error);
            if (window.location.pathname.includes('../HTML/rawleaderboard.html')) {
                document.body.innerText = `Error loading ladder data: ${error.message}`;
            }
        }
    });
}

// Initialize both functions when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Only run displayLadder if we're on a page with the ladder element
    if (document.querySelector('#ladder')) {
        displayLadder();
    }
    
    // Always set up the raw ladder feed listener
    setupRawLadderFeed();
    
    // Add debug info for raw leaderboard page
    if (window.location.pathname.includes('../HTML/rawleaderboard.html')) {
        console.log("Raw leaderboard page detected");
    }
});