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
import firebaseIdle from './firebase-idle-wrapper.js';

// Add a style block for consistent styling
const styleEl = document.createElement('style');
styleEl.textContent = `
  .streak-indicator {
    font-size: 0.9em;
    color: #FF4500;
    margin-left: 5px;
    font-weight: bold;
  }
`;
document.head.appendChild(styleEl);

// Add caching system like in D1 ladder
const playerCacheD3 = {
    data: null,
    timestamp: 0
};
const CACHE_DURATION = 30000; // 30 seconds cache validity

// Complete displayLadderD3 function implementation
async function displayLadderD3(forceRefresh = false) {
    const tableBody = document.querySelector('#ladder-d3 tbody');
    if (!tableBody) {
        console.error('D3 Ladder table body not found');
        return;
    }
    
    // Clear the table first to prevent duplicates
    tableBody.innerHTML = '<tr><td colspan="8" class="loading-cell">Loading D3 ladder data...</td></tr>';
    
    try {
        // Use cache if available and not expired
        const now = Date.now();
        if (!forceRefresh && playerCacheD3.data && (now - playerCacheD3.timestamp < CACHE_DURATION)) {
            updateLadderDisplayD3(playerCacheD3.data);
            return;
        }
        
        // Query players
        const playersRef = collection(db, 'playersD3');
        const querySnapshot = await getDocs(playersRef);
        
        // Process players in a single pass
        const players = [];
        querySnapshot.forEach((doc) => {
            const playerData = doc.data();
            if (playerData.username) { // Ensure valid player
                players.push({
                    ...playerData,
                    id: doc.id,
                    elo: playerData.eloRating || 0,
                    position: playerData.position || Number.MAX_SAFE_INTEGER
                });
            }
        });
                
        // Fetch profiles for flags
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
        
        // Get all usernames for batch processing
        const usernames = players.map(p => p.username);
        
        // Pre-fetch all match statistics in a single batch operation
        const matchStatsBatch = await fetchBatchMatchStatsD3(usernames);
        
        // Sort players: players with 0 matches at the bottom
        players.sort((a, b) => {
            const aMatches = matchStatsBatch.get(a.username)?.totalMatches || 0;
            const bMatches = matchStatsBatch.get(b.username)?.totalMatches || 0;
            
            // First check: put players with no matches at the bottom
            if ((aMatches === 0) !== (bMatches === 0)) {
                return aMatches === 0 ? 1 : -1;
            }
            
            // Then sort by position for players in the same category
            return (a.position || 999) - (b.position || 999);
        });
        
        // Reassign positions sequentially
        players.forEach((player, index) => {
            player.position = index + 1;
        });
        
        // Cache the results
        playerCacheD3.data = players;
        playerCacheD3.timestamp = now;
        
        // Update display
        updateLadderDisplayD3(players);
        
    } catch (error) {
        console.error("Error loading D3 ladder:", error);
        tableBody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; color: red;">
                    Error loading D3 ladder data: ${error.message}
                </td>
            </tr>
        `;
    }
}

// Helper function to calculate streak days
function calculateStreakDays(startDate) {
    if (!startDate) return 0;
    const start = startDate.toDate();
    const now = new Date();
    const diffTime = Math.abs(now - start);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

// Improved function to handle all position update scenarios for D3
async function updatePlayerPositions(winnerUsername, loserUsername) {
    try {
        // Get all players
        const playersRef = collection(db, 'playersD3');
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
            console.error("Could not find winner or loser in D3 players list");
            return;
        }

        // Only update positions if winner is below loser in the ladder
        if (winner.position > loser.position) {
            const winnerNewPosition = loser.position;
            
            // Update positions for players between winner and loser
            for (const player of players) {
                if (player.position >= loser.position && player.position < winner.position && player.username !== winnerUsername) {
                    // Move everyone down one position
                    await updateDoc(doc(db, 'playersD3', player.id), {
                        position: player.position + 1
                    });
                }
            }

            // Update winner's position
            await updateDoc(doc(db, 'playersD3', winner.id), {
                position: winnerNewPosition
            });

            // Handle #1 position streak tracking
            if (winnerNewPosition === 1) {
                // Check if this is the first time reaching #1
                const winnerDoc = doc(db, 'playersD3', winner.id);
                const winnerData = await getDoc(winnerDoc);
                
                if (!winnerData.data().firstPlaceDate) {
                    await updateDoc(winnerDoc, {
                        firstPlaceDate: Timestamp.now()
                    });
                }
            }

            // If the previous #1 player is displaced
            if (loser.position === 1) {
                const loserDoc = doc(db, 'playersD3', loser.id);
                await updateDoc(loserDoc, {
                    firstPlaceDate: null // Reset their streak
                });
            }
        }
    } catch (error) {
        console.error("Error updating D3 player positions:", error);
    }
}

// Optimized displayLadder with batch processing
async function updateLadderDisplayD3(ladderData) {
    // Sort by position before displaying
    ladderData.sort((a, b) => a.position - b.position);
    
    const tbody = document.querySelector('#ladder-d3 tbody');
    if (!tbody) return;
    
    // Clear any existing content
    tbody.innerHTML = '';
    
    // Get all usernames for batch processing
    const usernames = ladderData.map(p => p.username);
    
    // Pre-fetch all match statistics in a single batch operation
    const matchStatsBatch = await fetchBatchMatchStatsD3(usernames);
    
    // Update the table header with new columns - add ELO column
    const thead = document.querySelector('#ladder-d3 thead tr');
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
    
    // Create all rows at once for better performance
    const rowsHtml = ladderData.map(player => {
        // Get pre-fetched stats from our batch operation
        const stats = matchStatsBatch.get(player.username) || {
            totalMatches: 0, wins: 0, losses: 0, 
            kda: 0, winRate: 0, totalKills: 0, totalDeaths: 0
        };
        
        return createPlayerRowD3(player, stats);
    }).join('');
    
    // Append all rows at once (much faster than individual DOM operations)
    tbody.innerHTML = rowsHtml;
    
    // Get all ELO changes and update indicators
    getPlayersLastEloChangesD3(usernames)
        .then(changes => {
            console.log('D3: Got changes map with', changes.size, 'entries:', 
                Array.from(changes.entries())
                    .filter(([_, change]) => change !== 0)
                    .map(([name, change]) => `${name}: ${change}`)
            );
            
            // Create a mapping of username to row for quick updates
            const rowMap = new Map();
            tbody.querySelectorAll('tr').forEach((row, index) => {
                if (index < usernames.length) {
                    rowMap.set(usernames[index], row);
                }
            });
            
            changes.forEach((change, username) => {
                const row = rowMap.get(username);
                if (row && change !== 0) {
                    const eloCell = row.querySelector('td:nth-child(3)');
                    if (eloCell) {
                        // Format the change value with + or - sign
                        const formattedChange = change > 0 ? `+${change}` : `${change}`;
                        
                        // Clear any existing indicators
                        const existingIndicator = eloCell.querySelector('.trend-indicator');
                        if (existingIndicator) {
                            existingIndicator.remove();
                        }
                        
                        // Convert eloCell to use flexbox for alignment - LIKE D1 LADDER
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
                        const indicator = document.createElement('span');
                        indicator.className = 'trend-indicator';
                        indicator.textContent = formattedChange;
                        
                        // Use absolute positioning EXACTLY like D1 ladder
                        eloCell.style.position = 'relative'; // Make the cell a positioned container
                        
                        // Style based on positive/negative change
                        indicator.style.color = change > 0 ? '#4CAF50' : '#F44336'; // Green or Red
                        indicator.style.position = 'absolute';
                        indicator.style.right = '5px';
                        indicator.style.top = '50%';
                        indicator.style.transform = 'translateY(-50%)';
                        indicator.style.fontWeight = 'bold';
                        indicator.style.fontSize = '0.7em'; // Match D1's font size
                        
                        eloCell.appendChild(indicator);
                                            }
                }
            });
        })
        .catch(error => console.error('Error updating D3 ELO trend indicators:', error));
}

// Helper function to fetch all match stats at once for D3
async function fetchBatchMatchStatsD3(usernames) {
    const matchStats = new Map();
    
    try {
        const approvedMatchesRef = collection(db, 'approvedMatchesD3');
        const allMatches = await getDocs(approvedMatchesRef);
        
        // Process all matches in a single pass
        allMatches.forEach(doc => {
            const match = doc.data();
            
            // Process winner stats
            if (usernames.includes(match.winnerUsername)) {
                const username = match.winnerUsername;
                if (!matchStats.has(username)) {
                    matchStats.set(username, {
                        totalMatches: 0,
                        wins: 0,
                        losses: 0,
                        totalKills: 0,
                        totalDeaths: 0,
                        kda: 0,
                        winRate: 0
                    });
                }
                
                const stats = matchStats.get(username);
                stats.wins++;
                stats.totalMatches++;
                stats.totalKills += parseInt(match.winnerScore) || 0;
                stats.totalDeaths += parseInt(match.loserScore) || 0;
            }
            
            // Process loser stats
            if (usernames.includes(match.loserUsername)) {
                const username = match.loserUsername;
                if (!matchStats.has(username)) {
                    matchStats.set(username, {
                        totalMatches: 0,
                        wins: 0,
                        losses: 0,
                        totalKills: 0,
                        totalDeaths: 0,
                        kda: 0,
                        winRate: 0
                    });
                }
                
                const stats = matchStats.get(username);
                stats.losses++;
                stats.totalMatches++;
                stats.totalKills += parseInt(match.loserScore) || 0;
                stats.totalDeaths += parseInt(match.winnerScore) || 0;
            }
        });
        
        // Calculate derived stats for all users
        matchStats.forEach(stats => {
            // Calculate KDA
            stats.kda = stats.totalDeaths > 0 ? 
                (stats.totalKills / stats.totalDeaths).toFixed(2) : stats.totalKills;
            
            // Calculate win rate
            stats.winRate = stats.totalMatches > 0 ? 
                ((stats.wins / stats.totalMatches) * 100).toFixed(1) : 0;
        });
        
    } catch (error) {
        console.error('Error fetching batch match stats for D3:', error);
    }
    
    return matchStats;
}

// Create player row function for D3
function createPlayerRowD3(player, stats) {
    const elo = parseFloat(player.elo) || 0;
    
    // Set ELO-based colors
    let usernameColor = 'gray'; // Default for unranked
    if (elo >= 2000) {
        usernameColor = '#50C878'; // Emerald Green
    } else if (elo >= 1800) {
        usernameColor = '#FFD700'; // Gold
    } else if (elo >= 1600) {
        usernameColor = '#C0C0C0'; // Silver
    } else if (elo >= 1400) {
        usernameColor = '#CD7F32'; // Bronze
    }
    
    // Create streak HTML if player is #1 - UPDATED IMPLEMENTATION
    let streakHtml = '';
    if (player.position === 1 && player.firstPlaceDate) {
        const streakDays = calculateStreakDays(player.firstPlaceDate);
        if (streakDays > 0) {
            // Change margin-left from 5px to -79px to match D1 ladder
            streakHtml = `<span style="font-size:0.9em; color:#FF4500; margin-left:-79px;">${streakDays}d</span>`;
        }
    }
    
    // Create flag HTML if player has country
    let flagHtml = '';
    if (player.country) {
        flagHtml = `<img src="../images/flags/${player.country.toLowerCase()}.png" 
                        alt="${player.country}" 
                        class="player-flag" 
                        onerror="this.style.display='none'">`;
    }
    
    return `
    <tr>
        <td>${player.position}</td>
        <td style="position: relative;">
            <a href="profile.html?username=${encodeURIComponent(player.username)}&ladder=d3" 
               style="color: ${usernameColor}; text-decoration: none;">
                ${player.username}
            </a>
            ${streakHtml}
            ${flagHtml}
        </td>
        <td style="color: ${usernameColor}; position: relative;">${elo}</td>
        <td>${stats.totalMatches}</td>
        <td>${stats.wins}</td>
        <td>${stats.losses}</td>
        <td>${stats.kda}</td>
        <td>${stats.winRate}%</td>
    </tr>`;
}

// Function for D3 ELO change tracking
async function getPlayersLastEloChangesD3(usernames) {
    // Initialize map with default values
    const changes = new Map();
    usernames.forEach(username => changes.set(username, 0));
    
    try {
        // Query for ELO history
        const eloHistoryRef = collection(db, 'eloHistoryD3');
        const eloQuery = query(eloHistoryRef, orderBy('timestamp', 'desc'), limit(100));
        const eloSnapshot = await getDocs(eloQuery);
        
        if (eloSnapshot.empty) {
            return changes;
        }
                
        // Process entries and find most recent change for each player
        const entriesByUsername = new Map();
        
        eloSnapshot.forEach(doc => {
            const entry = doc.data();
            // Try multiple field names for username
            const username = entry.player || entry.playerUsername || entry.username;
            
            if (username && usernames.includes(username)) {
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
                // Sort entries by timestamp descending to ensure we get the most recent
                playerEntries.sort((a, b) => b.timestamp - a.timestamp);
                
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
        
        // If no changes found in D3 history, check main history collection as fallback
        if (entriesByUsername.size === 0) {            
            const fallbackRef = collection(db, 'eloHistory');
            const fallbackQuery = query(
                fallbackRef, 
                where('gameMode', '==', 'D3'), 
                orderBy('timestamp', 'desc'), 
                limit(50)
            );
            
            try {
                const fallbackSnapshot = await getDocs(fallbackQuery);
                            
                fallbackSnapshot.forEach(doc => {
                    const entry = doc.data();
                    const username = entry.player || entry.playerUsername || entry.username;
                    
                    if (username && usernames.includes(username)) {
                        const eloChange = entry.change || 
                            (entry.newElo !== undefined && entry.previousElo !== undefined ? 
                             entry.newElo - entry.previousElo : 0);
                        
                        if (eloChange !== 0) {
                            changes.set(username, eloChange);
                            console.log(`D3: ${username} fallback ELO change: ${eloChange}`);
                        }
                    }
                });
            } catch (fallbackError) {
                console.log('D3: Error checking fallback history:', fallbackError);
            }
        }
    } catch (error) {
        console.error('Error fetching ELO history for D3:', error);
    }
    
    return changes;
}

// Set up on document load
document.addEventListener('DOMContentLoaded', () => {
    // Setup raw ladder feed for D3
    setupRawLadderFeedD3();
});

// Export the D3 ladder functions
export { displayLadderD3, updatePlayerPositions };