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

// Add caching system like in D1 ladder
const playerCacheD2 = {
    data: null,
    timestamp: 0
};
const CACHE_DURATION = 30000; // 30 seconds cache validity

// Optimized display function with caching
async function displayLadderD2(forceRefresh = false) {
    const tableBody = document.querySelector('#ladder-d2 tbody');
    if (!tableBody) {
        console.error('D2 Ladder table body not found');
        return;
    }

    // Clear the table first to prevent duplicates
    tableBody.innerHTML = '<tr><td colspan="8" class="loading-cell">Loading D2 ladder data...</td></tr>';
    
    try {
        // Use cache if available and not expired
        const now = Date.now();
        if (!forceRefresh && playerCacheD2.data && (now - playerCacheD2.timestamp < CACHE_DURATION)) {
            console.log('Using cached D2 ladder data');
            updateLadderDisplayD2(playerCacheD2.data);
            return;
        }
        
        // Query players with server-side ordering for efficiency
        const playersRef = collection(db, 'playersD2');
        const orderedQuery = query(playersRef, orderBy('position', 'asc'));
        const querySnapshot = await firebaseIdle.getDocuments(playersRef);
        
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
        
        // Cache the results
        playerCacheD2.data = players;
        playerCacheD2.timestamp = now;
        
        // Update display
        updateLadderDisplayD2(players);
        
    } catch (error) {
        console.error("Error loading D2 ladder:", error);
        tableBody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; color: red;">
                    Error loading D2 ladder data: ${error.message}
                </td>
            </tr>
        `;
    }
}

// Helper function to get the next available position
function getNextAvailablePositionD2(players) {
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

// Improved function to handle all position update scenarios for D2
async function updatePlayerPositions(winnerUsername, loserUsername) {
    try {
        // Get all players
        const playersRef = collection(db, 'playersD2');
        const querySnapshot = await firebaseIdle.getDocuments(playersRef);
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
            console.error("Could not find winner or loser in D2 players list");
            return;
        }

        console.log(`D2 Match result: ${winnerUsername}(${winner.position}) beat ${loserUsername}(${loser.position})`);

        // Only update positions if winner is below loser in the ladder
        if (winner.position > loser.position) {
            console.log(`Winner ${winnerUsername} is moving up from position ${winner.position} to ${loser.position}`);
            const winnerNewPosition = loser.position;
            
            // Update positions for players between winner and loser
            for (const player of players) {
                if (player.position >= loser.position && player.position < winner.position && player.username !== winnerUsername) {
                    // Move everyone down one position
                    await firebaseIdle.updateDocument(doc(db, 'playersD2', player.id), {
                        position: player.position + 1
                    });
                    console.log(`Moving ${player.username} down to position ${player.position + 1}`);
                }
            }

            // Update winner's position
            await firebaseIdle.updateDocument(doc(db, 'playersD2', winner.id), {
                position: winnerNewPosition
            });
            console.log(`Updated ${winnerUsername} to position ${winnerNewPosition}`);

            // Handle #1 position streak tracking
            if (winnerNewPosition === 1) {
                // Check if this is the first time reaching #1
                const winnerDoc = doc(db, 'playersD2', winner.id);
                const winnerData = await firebaseIdle.getDocument(winnerDoc);
                
                if (!winnerData.data().firstPlaceDate) {
                    await firebaseIdle.updateDocument(winnerDoc, {
                        firstPlaceDate: Timestamp.now()
                    });
                    console.log(`${winnerUsername} reached #1 for the first time, setting firstPlaceDate`);
                }
            }

            // If the previous #1 player is displaced
            if (loser.position === 1) {
                const loserDoc = doc(db, 'playersD2', loser.id);
                await firebaseIdle.updateDocument(loserDoc, {
                    firstPlaceDate: null // Reset their streak
                });
                console.log(`${loserUsername} lost #1 position, resetting firstPlaceDate`);
            }
            
            // Invalidate cache to ensure fresh data is loaded
            playerCacheD2.timestamp = 0;
        } else {
            // If winner is already above loser or equal, maintain positions
            console.log(`No position change needed: winner ${winnerUsername}(${winner.position}) is already above or equal to loser ${loserUsername}(${loser.position})`);
        }
    } catch (error) {
        console.error("Error updating D2 player positions:", error);
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

// Optimized displayLadder with batch processing
async function updateLadderDisplayD2(ladderData) {
    // Sort by position before displaying
    ladderData.sort((a, b) => a.position - b.position);
    
    const tbody = document.querySelector('#ladder-d2 tbody');
    if (!tbody) return;
    
    // Clear any existing content
    tbody.innerHTML = '';
    
    // Get all usernames for batch processing
    const usernames = ladderData.map(p => p.username);
    
    // Pre-fetch all match statistics in a single batch operation
    const matchStatsBatch = await fetchBatchMatchStatsD2(usernames);
    
    // Update the table header with new columns - add ELO column
    const thead = document.querySelector('#ladder-d2 thead tr');
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
        
        return createPlayerRowD2(player, stats);
    }).join('');
    
    // Append all rows at once (much faster than individual DOM operations)
    tbody.innerHTML = rowsHtml;
    
    // Get all ELO changes and update indicators
    getPlayersLastEloChangesD2(usernames)
        .then(changes => {
            console.log('D2: Got changes map with', changes.size, 'entries:', 
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
                        
                        // Format the change value with + or - sign
                        const formattedChange = change > 0 ? `+${change}` : `${change}`;
                        
                        // Add numeric indicator with the actual value
                        const indicator = document.createElement('span');
                        indicator.className = 'trend-indicator';
                        indicator.textContent = formattedChange;
                        
                        // Style based on positive/negative change
                        indicator.style.color = change > 0 ? '#4CAF50' : '#F44336'; // Green or Red
                        indicator.style.position = 'absolute';
                        indicator.style.right = '5px';
                        indicator.style.top = '50%';
                        indicator.style.transform = 'translateY(-50%)';
                        indicator.style.fontWeight = 'bold';
                        indicator.style.fontSize = '0.7em';
                        
                        // Make the cell a positioned container
                        eloCell.style.position = 'relative';
                        
                        eloCell.appendChild(indicator);
                        console.log(`D2: Added ELO indicator ${formattedChange} to ${username}`);
                    }
                }
            });
        })
        .catch(error => console.error('Error updating D2 ELO trend indicators:', error));
}

// Helper function to fetch all match stats at once for D2
async function fetchBatchMatchStatsD2(usernames) {
    const matchStats = new Map();
    
    try {
        // Create two queries and execute them in parallel
        const approvedMatchesRef = collection(db, 'approvedMatchesD2');
        
        // Process in smaller batches to avoid overloading Firebase
        const BATCH_SIZE = 10;
        
        for (let i = 0; i < usernames.length; i += BATCH_SIZE) {
            const batchUsernames = usernames.slice(i, i + BATCH_SIZE);
            
            // Use Promise.all for parallel execution of multiple queries
            const matchPromises = batchUsernames.map(username => {
                return Promise.all([
                    firebaseIdle.getDocuments(query(approvedMatchesRef, 
                        where('winnerUsername', '==', username),
                        limit(100))), // Limit for optimization
                    firebaseIdle.getDocuments(query(approvedMatchesRef, 
                        where('loserUsername', '==', username),
                        limit(100)))
                ]);
            });
            
            const results = await Promise.all(matchPromises);
            
            // Process results efficiently
            results.forEach((userMatches, index) => {
                const username = batchUsernames[index];
                const [winnerMatches, loserMatches] = userMatches;
                
                // Calculate stats
                let wins = winnerMatches.size;
                let losses = loserMatches.size;
                let totalKills = 0;
                let totalDeaths = 0;
                
                // Process winner matches
                winnerMatches.forEach(doc => {
                    const match = doc.data();
                    totalKills += parseInt(match.winnerScore) || 0;
                    totalDeaths += parseInt(match.loserScore) || 0;
                });
                
                // Process loser matches
                loserMatches.forEach(doc => {
                    const match = doc.data();
                    totalKills += parseInt(match.loserScore) || 0;
                    totalDeaths += parseInt(match.winnerScore) || 0;
                });
                
                // Calculate derived stats
                const totalMatches = wins + losses;
                const kda = totalDeaths > 0 ? 
                    (totalKills / totalDeaths).toFixed(2) : totalKills.toString();
                const winRate = totalMatches > 0 ? 
                    ((wins / totalMatches) * 100).toFixed(1) : "0.0";
                    
                // Store stats
                matchStats.set(username, {
                    wins, losses, totalKills, totalDeaths,
                    totalMatches, kda, winRate
                });
            });
        }
    } catch (error) {
        console.error("Error batch fetching D2 match stats:", error);
    }
    
    return matchStats;
}

// Create player row using string template for performance
function createPlayerRowD2(player, stats) {
    // Set ELO-based colors
    const elo = parseFloat(player.elo) || 0;
    let usernameColor = 'gray';  // default color
    
    if (elo >= 2100) {
        usernameColor = '#50C878';  // Emerald Green
    } else if (elo >= 1800) {
        usernameColor = '#FFD700';  // Gold
    } else if (elo >= 1600) {
        usernameColor = '#C0C0C0';  // Silver
    } else if (elo >= 1400) {
        usernameColor = '#CD7F32';  // Bronze
    }
    
    // Special styling for #1 position
    let streakHtml = '';
    if (player.position === 1 && player.firstPlaceDate && elo >= 2100) {
        const streakDays = calculateStreakDays(player.firstPlaceDate);
        if (streakDays > 0) {
            streakHtml = `<span style="font-size:0.9em; color:#FF4500; margin-left:5px;">🔥 ${streakDays}d</span>`;
        }
    }
    
    // Construct and return the HTML for this row
    return `
        <tr>
            <td>${player.position}</td>
            <td>
                <a href="profile.html?username=${encodeURIComponent(player.username)}&ladder=d2" 
                   style="color:${usernameColor}; text-decoration:none; 
                   ${player.position === 1 && elo >= 2100 ? 'text-shadow:0 0 5px '+usernameColor+'; animation:glow 2s ease-in-out infinite;' : ''}">
                    ${player.username}
                </a>
                ${streakHtml}
            </td>
            <td style="color:${usernameColor};">${elo}</td>
            <td>${stats.totalMatches}</td>
            <td>${stats.wins}</td>
            <td>${stats.losses}</td>
            <td>${stats.kda}</td>
            <td>${stats.winRate}%</td>
        </tr>
    `;
}

// Function for D2 ELO change tracking - KEEP THIS AS IS
async function getPlayersLastEloChangesD2(usernames) {
    console.log('D2: Finding ELO changes for', usernames.length, 'players');
    const changes = new Map();
    usernames.forEach(username => changes.set(username, 0));
    
    try {
        // Try direct Firestore call first in case the idle wrapper is causing issues
        const eloHistoryRef = collection(db, 'eloHistoryD2');
        const recentHistoryQuery = query(eloHistoryRef, orderBy('timestamp', 'desc'), limit(100));
        const snapshot = await getDocs(recentHistoryQuery);
        
        console.log('D2: Found', snapshot.size, 'history entries');
        
        // Build a player ID to username mapping to improve matching
        const playerIdToUsername = new Map();
        const playersQuery = await getDocs(collection(db, 'playersD2'));
        playersQuery.forEach(doc => {
            const data = doc.data();
            if (data.username) {
                playerIdToUsername.set(doc.id, data.username);
            }
        });
        
        // Process entries by username with enhanced matching
        const entriesByUsername = new Map();
        
        snapshot.forEach(doc => {
            const entry = doc.data();
            // Try different fields for username
            let username = entry.username || entry.playerUsername;
            
            // If we have a player ID, try to match it
            if (!username && entry.player && playerIdToUsername.has(entry.player)) {
                username = playerIdToUsername.get(entry.player);
            }
            
            // If still no username but we have match ID, try to get from match data
            if (!username && entry.matchId) {
                // This will be handled later if needed
            }
            
            if (username && usernames.includes(username)) {
                if (!entriesByUsername.has(username)) {
                    entriesByUsername.set(username, []);
                }
                
                // Add entry to the user's history
                entriesByUsername.get(username).push({
                    ...entry,
                    timestamp: entry.timestamp?.seconds || 0,
                    username: username // Ensure username is set
                });
            }
        });
        
        console.log('D2: Found entries for', entriesByUsername.size, 'players');
        
        entriesByUsername.forEach((entries, username) => {
            if (entries.length > 0) {
                entries.sort((a, b) => b.timestamp - a.timestamp);
                
                const recentEntry = entries.find(entry => 
                    entry.change !== undefined || 
                    (entry.newElo !== undefined && entry.previousElo !== undefined)
                );
                
                if (recentEntry) {
                    let eloChange;
                    if (recentEntry.change !== undefined) {
                        eloChange = recentEntry.change;
                    } else if (recentEntry.newElo !== undefined && recentEntry.previousElo !== undefined) {
                        eloChange = recentEntry.newElo - recentEntry.previousElo;
                    }
                    
                    if (eloChange !== undefined) {
                        changes.set(username, eloChange);
                        console.log(`D2: ${username} ELO change: ${eloChange}`);
                    }
                }
            }
        });
        
        // If we didn't find any changes, try fallback to main eloHistory
        if (entriesByUsername.size === 0) {
            console.log('D2: No entries found in D2 history, checking main history');
            
            const fallbackRef = collection(db, 'eloHistory');
            const fallbackQuery = query(
                fallbackRef, 
                where('gameMode', '==', 'D2'), 
                orderBy('timestamp', 'desc'), 
                limit(50)
            );
            
            try {
                const fallbackSnapshot = await getDocs(fallbackQuery);
                console.log('D2: Found', fallbackSnapshot.size, 'fallback entries');
                
                fallbackSnapshot.forEach(doc => {
                    const entry = doc.data();
                    const username = entry.username || entry.playerUsername;
                    
                    if (username && usernames.includes(username)) {
                        const eloChange = entry.change || 
                            (entry.newElo !== undefined && entry.previousElo !== undefined ? 
                             entry.newElo - entry.previousElo : 0);
                        
                        if (eloChange !== 0) {
                            changes.set(username, eloChange);
                            console.log(`D2: ${username} fallback ELO change: ${eloChange}`);
                        }
                    }
                });
            } catch (fallbackError) {
                console.log('D2: Error checking fallback history:', fallbackError);
            }
        }
    } catch (error) {
        console.error('D2: Error fetching ELO history:', error);
    }
    
    return changes;
}

// Simplified function for raw ladder feed with improved efficiency
function setupRawLadderFeed() {
    const playersRef = collection(db, 'playersD2');
    
    // Use the standard onSnapshot directly instead of the non-existent wrapper
    onSnapshot(playersRef, (snapshot) => {
        try {
            console.log("Raw D2 leaderboard snapshot received");
            
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
            let rawText = 'NGS LADDER D2 - RAW DATA\n\n';
            players.forEach(player => {
                rawText += `${player.position}. ${player.username} (${player.elo})\n`;
            });
            
            // Update the page content if we're on the raw leaderboard page
            if (window.location.pathname.includes('../HTML/rawleaderboardd2.html')) {
                console.log("Updating raw D2 leaderboard content");
                document.body.innerText = rawText;
            }
        } catch (error) {
            console.error("Error updating raw D2 ladder feed:", error);
            if (window.location.pathname.includes('../HTML/rawleaderboardd2.html')) {
                document.body.innerText = `Error loading D2 ladder data: ${error.message}`;
            }
        }
    });
}

// Set up on document load
document.addEventListener('DOMContentLoaded', () => {
    // Setup raw ladder feed for D2
    setupRawLadderFeed();
});

// Export the D2 ladder functions
export { displayLadderD2, updatePlayerPositions };