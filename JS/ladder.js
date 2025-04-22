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
    onSnapshot,
    orderBy,
    limit
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from './firebase-config.js';
import { getRankStyle } from './ranks.js';
import { displayLadderD2 } from './ladderd2.js';

async function displayLadder() {
    const tableBody = document.querySelector('#ladder tbody');
    if (!tableBody) {
        console.error('Ladder table body not found');
        return;
    }

    try {
        // First get all players
        const playersRef = collection(db, 'players');
        const querySnapshot = await getDocs(playersRef);
        const players = [];
        
        querySnapshot.forEach((doc) => {
            const playerData = doc.data();
            players.push({
                ...playerData,
                id: doc.id,
                elo: playerData.eloRating || 0,
                position: playerData.position || Number.MAX_SAFE_INTEGER
            });
        });

        // Get all user profiles in one go
        const profilesRef = collection(db, 'userProfiles');
        const profilesSnapshot = await getDocs(profilesRef);
        
        // Create a map of username -> profile data
        const profilesByUsername = new Map();
        profilesSnapshot.forEach((doc) => {
            const profileData = doc.data();
            if (profileData.username) {
                profilesByUsername.set(profileData.username.toLowerCase(), profileData);
            }
        });
        
        // Match profiles to players
        for (const player of players) {
            const username = player.username.toLowerCase();
            if (profilesByUsername.has(username)) {
                const profile = profilesByUsername.get(username);
                
                // Set country from profile
                if (profile.country) {
                    player.country = profile.country.toLowerCase();
                }
            }
        }

        // Rest of the code remains the same
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

// Improved function to handle all position update scenarios
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

        if (!winner || !loser) {
            console.error("Could not find winner or loser in players list");
            return;
        }

        // Only update positions if winner is below loser in the ladder
        if (winner.position > loser.position) {
            const winnerNewPosition = loser.position;
            
            // Update positions for players between winner and loser
            for (const player of players) {
                if (player.position >= loser.position && player.position < winner.position && player.username !== winnerUsername) {
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

            // Handle #1 position streak tracking
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

// Update the updateLadderDisplay function - modify username cell creation
async function updateLadderDisplay(ladderData) {
    // Sort by position before displaying
    ladderData.sort((a, b) => a.position - b.position);
    
    const tbody = document.querySelector('#ladder tbody');
    tbody.innerHTML = '';
    
    // Update the table header with new columns - add ELO column
    const thead = document.querySelector('#ladder thead tr');
    thead.innerHTML = `
        <th>Rank</th>
        <th>Username</th>
        <th>ELO</th>
        <th>Matches</th>
        <th>Wins</th>
        <th>Losses</th>
        <th>K/D</th>
        <th>Win Rate</th>
    `;
    
    // Cache for ELO history to minimize duplicate queries
    const eloHistoryCache = new Map();
    
    for (const player of ladderData) {
        const row = document.createElement('tr');
        
        // Create rank cell
        const rankCell = document.createElement('td');
        rankCell.textContent = player.position;
        
        // Create username cell with styling
        const usernameCell = document.createElement('td');

        // Create username link first (CHANGED ORDER)
        const usernameLink = document.createElement('a');
        usernameLink.href = `profile.html?username=${encodeURIComponent(player.username)}&ladder=d1`;
        usernameLink.textContent = player.username;

        // Set ELO-based colors
        const elo = parseFloat(player.elo) || 0;
        if (elo >= 2000) {
            usernameLink.style.color = '#50C878';
            // Other styling remains the same...
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

        // Add streak display for #1 position
        if (player.position === 1 && player.firstPlaceDate) {
            const streakDays = calculateStreakDays(player.firstPlaceDate);
            if (streakDays > 0) {
                const streakSpan = document.createElement('span');
                streakSpan.innerHTML = ` ${streakDays}d`;
                streakSpan.style.fontSize = '0.9em';
                streakSpan.style.color = '#FF4500';
                streakSpan.style.marginLeft = '-79px';
                usernameCell.appendChild(streakSpan);
            }
        }

                // Add this function temporarily for testing streak feature
        window.testSetStreak = async function(daysAgo = 7) {
            try {
            // Get reference to players collection
            const playersRef = collection(db, 'players');
            
            // Get all players
            const querySnapshot = await getDocs(playersRef);
            
            // Find the #1 positioned player
            let topPlayer = null;
            querySnapshot.forEach((doc) => {
                const playerData = doc.data();
                if (playerData.position === 1) {
                topPlayer = { id: doc.id, ...playerData };
                }
            });
            
            if (!topPlayer) {
                console.error("No player found in position #1");
                return;
            }
            
            
            // Calculate date X days ago
            const date = new Date();
            date.setDate(date.getDate() - daysAgo);
            
            // Update the player document
            const playerDoc = doc(db, 'players', topPlayer.id);
            await updateDoc(playerDoc, {
                firstPlaceDate: Timestamp.fromDate(date)
            });
            
            alert(`Streak set! ${daysAgo} days for player ${topPlayer.username}`);
            
            // Reload the ladder
            displayLadder();
            } catch (error) {
            console.error("Error setting streak:", error);
            alert("Error: " + error.message);
            }
        }
        
        // Add flag AFTER username (MOVED HERE)
        if (player.country) {
            const flagImg = document.createElement('img');
            const flagPath = `../images/flags/${player.country.toLowerCase()}.png`;
            flagImg.src = flagPath;
            flagImg.alt = player.country;
            flagImg.className = 'player-flag';
            
            // Add error handling for images
            flagImg.onerror = () => {
                console.error(`Flag image not found for ${player.country}: ${flagPath}`);
                flagImg.style.display = 'none'; // Hide broken image icon
            };
            
            usernameCell.appendChild(flagImg);
        }
        
        // Create ELO cell with trend indicator
        const eloCell = document.createElement('td');
        eloCell.textContent = elo.toString();
        eloCell.style.color = usernameLink.style.color; // Match username color
        
        // Get the ELO history for this player if not in cache
        if (!eloHistoryCache.has(player.username)) {
            // Get last ELO change from player's lastEloChange property, if it exists
            let direction = player.lastEloChange > 0 ? 'up' : 
                            player.lastEloChange < 0 ? 'down' : 'none';
            
            eloHistoryCache.set(player.username, direction);
        }
        
        // Get ELO direction from cache
        const eloDirection = eloHistoryCache.get(player.username);
        
        // Add the trend indicator
        if (eloDirection === 'up') {
            const trendIndicator = document.createElement('span');
            trendIndicator.innerHTML = ' ▲';
            trendIndicator.style.color = '#4CAF50'; // Green
            trendIndicator.style.marginLeft = '5px';
            eloCell.appendChild(trendIndicator);
        } else if (eloDirection === 'down') {
            const trendIndicator = document.createElement('span');
            trendIndicator.innerHTML = ' ▼';
            trendIndicator.style.color = '#F44336'; // Red
            trendIndicator.style.marginLeft = '5px';
            eloCell.appendChild(trendIndicator);
        }

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

        // Process match data and calculate stats
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

        // Create cells with stats
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
        row.appendChild(eloCell); // Add the new ELO cell
        row.appendChild(matchesCell);
        row.appendChild(winsCell);
        row.appendChild(lossesCell);
        row.appendChild(kdaCell);
        row.appendChild(winRateCell);
        
        tbody.appendChild(row);
    }
    
    // Get all usernames for batch processing
    const usernames = ladderData.map(p => p.username);
    
    // Create a mapping of username to row for quick updates
    const rowMap = new Map();
    tbody.querySelectorAll('tr').forEach((row, index) => {
        if (index < usernames.length) {
            rowMap.set(usernames[index], row);
        }
    });
    
    // Get all ELO changes at once
    getPlayersLastEloChanges(usernames)
        .then(changes => {
            changes.forEach((change, username) => {
                const row = rowMap.get(username);
                if (row) {
                    const eloCell = row.querySelector('td:nth-child(3)');
                    if (eloCell) {
                        // Clear any existing indicators
                        const existingIndicator = eloCell.querySelector('.trend-indicator');
                        if (existingIndicator) {
                            existingIndicator.remove();
                        }
                        
                        // Convert eloCell to use flexbox for alignment
                        eloCell.style.display = 'flex';
                        eloCell.style.alignItems = 'center';
                        
                        // Create a wrapper for the ELO value to maintain alignment
                        const eloValue = document.createElement('span');
                        eloValue.textContent = eloCell.textContent;
                        eloValue.style.flexGrow = '1';
                        
                        // Clear the cell and add the value back
                        eloCell.textContent = '';
                        eloCell.appendChild(eloValue);
                        
                        // Add numeric indicator with the actual value
                        if (change !== 0) {
                            const indicator = document.createElement('span');
                            indicator.className = 'trend-indicator';
                            
                            // Format the change value with + or - sign
                            const formattedChange = change > 0 ? `+${change}` : `${change}`;
                            indicator.textContent = formattedChange;
                            
                            // Use a completely different approach with positioning
                            eloCell.style.position = 'relative'; // Make the cell a positioned container
                            
                            // Style based on positive/negative change
                            indicator.style.color = change > 0 ? '#4CAF50' : '#F44336'; // Green or Red
                            indicator.style.position = 'absolute';
                            indicator.style.right = '5px';
                            indicator.style.top = '50%';
                            indicator.style.transform = 'translateY(-50%)';
                            indicator.style.fontWeight = 'bold';
                            indicator.style.fontSize = '0.7em';
                            
                            eloCell.appendChild(indicator);
                        }
                    }
                }
            });
        })
        .catch(error => console.error('Error updating ELO trend indicators:', error));
}

// Clean up getPlayersLastEloChanges function
async function getPlayersLastEloChanges(usernames) {
    // Initialize map with default values
    const changes = new Map();
    usernames.forEach(username => changes.set(username, 0));
    
    try {
        // Import the getEloHistory function from elo-history.js
        const { entries } = await import('./elo-history.js').then(module => module.getEloHistory());
        
        // Group entries by username
        const entriesByUsername = new Map();
        
        // Process all entries and associate them with usernames
        entries.forEach(entry => {
            const username = entry.playerUsername;
            
            if (usernames.includes(username)) {
                if (!entriesByUsername.has(username)) {
                    entriesByUsername.set(username, []);
                }
                
                entriesByUsername.get(username).push({
                    ...entry,
                    timestamp: entry.timestamp?.seconds || 0
                });
            }
        });
        
        // For each player, find and record their most recent ELO change
        entriesByUsername.forEach((playerEntries, username) => {
            if (playerEntries.length > 0) {
                // Use the first (most recent) entry that has valid change information
                const recentEntry = playerEntries.find(entry => 
                    entry.change !== undefined || 
                    (entry.newElo !== undefined && entry.previousElo !== undefined)
                );
                
                if (recentEntry) {
                    // Calculate ELO change
                    let eloChange;
                    if (recentEntry.change !== undefined) {
                        eloChange = recentEntry.change;
                    } else if (recentEntry.newElo !== undefined && recentEntry.previousElo !== undefined) {
                        eloChange = recentEntry.newElo - recentEntry.previousElo;
                    }
                    
                    if (eloChange !== undefined) {
                        // Store the change
                        changes.set(username, eloChange);
                    }
                }
            }
        });
    } catch (error) {
        console.error('Error fetching ELO history:', error);
    }
    
    return changes;
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

// Initialize functions when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Only run displayLadder if we're on a page with the ladder element
    if (document.querySelector('#ladder')) {
        displayLadder();
    }
    
    // Always set up the raw ladder feed listener
    setupRawLadderFeed();
    
    // Add toggle functionality for ladder selection
    const d1Toggle = document.getElementById('d1-switch');
    const d2Toggle = document.getElementById('d2-switch');
    const d1Container = document.getElementById('d1-ladder-container');
    const d2Container = document.getElementById('d2-ladder-container');
    
    if (d1Toggle && d2Toggle && d1Container && d2Container) {
        d1Toggle.addEventListener('click', () => {
            // Update button UI
            d1Toggle.classList.add('active');
            d2Toggle.classList.remove('active');
            
            // Show D1 ladder, hide D2 ladder
            d1Container.classList.add('active');
            d2Container.classList.remove('active');
            
            // Ensure D1 ladder is displayed
            if (document.querySelector('#ladder')) {
                displayLadder();
            }
        });
        
        d2Toggle.addEventListener('click', () => {
            // Update button UI
            d2Toggle.classList.add('active');
            d1Toggle.classList.remove('active');
            
            // Show D2 ladder, hide D1 ladder
            d2Container.classList.add('active');
            d1Container.classList.remove('active');
            
            // Ensure D2 ladder is displayed
            if (document.querySelector('#ladder-d2')) {
                if (typeof displayLadderD2 === 'function') {
                    displayLadderD2();
                } else {
                    console.error('displayLadderD2 function not found. Make sure ladderd2.js is loaded properly.');
                }
            }
        });
    } else {
        console.warn('Ladder toggle elements not found in the DOM');
    }
});