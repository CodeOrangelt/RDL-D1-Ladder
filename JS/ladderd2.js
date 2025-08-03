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
import { getTokensByUsernames, getPrimaryDisplayToken, clearTokenCache } from './tokens.js';

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
        const matchStatsBatch = await fetchBatchMatchStatsD2(usernames);
        
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
            console.error("Could not find winner or loser in D2 players list");
            return;
        }

        // Only update positions if winner is below loser in the ladder
        if (winner.position > loser.position) {
            const winnerNewPosition = loser.position;
            
            // Update positions for players between winner and loser
            for (const player of players) {
                if (player.position >= loser.position && player.position < winner.position && player.username !== winnerUsername) {
                    // Move everyone down one position
                    await updateDoc(doc(db, 'playersD2', player.id), {
                        position: player.position + 1
                    });
                }
            }

            // Update winner's position
            await updateDoc(doc(db, 'playersD2', winner.id), {
                position: winnerNewPosition
            });

            // Handle #1 position streak tracking (same as D1)
            if (winnerNewPosition === 1) {
                const winnerDoc = doc(db, 'playersD2', winner.id);
                const winnerData = await getDoc(winnerDoc);
                
                if (!winnerData.data().firstPlaceDate) {
                    await updateDoc(winnerDoc, {
                        firstPlaceDate: Timestamp.now()
                    });
                }
            }
            
            // If the previous #1 player is displaced
            if (loser.position === 1) {
                const loserDoc = doc(db, 'playersD2', loser.id);
                await updateDoc(loserDoc, {
                    firstPlaceDate: null // Reset their streak
                });
            }
            
            // Invalidate cache to ensure fresh data is loaded
            playerCacheD2.timestamp = 0;
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

// Update the D2 ladder structure to match D1
function getPlayerRankNameD2(elo) {
    if (elo >= 2100) return 'Emerald';
    if (elo >= 1800) return 'Gold';
    if (elo >= 1600) return 'Silver';
    if (elo >= 1400) return 'Bronze';
    return 'Unranked';
}

// Add global refresh function
window.refreshLadderDisplayD2 = function(forceRefresh = true) {
    console.log('🔄 External D2 ladder refresh triggered');
    if (typeof displayLadderD2 === 'function') {
        displayLadderD2(forceRefresh);
    } else {
        console.warn('displayLadderD2 function not available');
    }
};

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

    // NEW: Get tokens for all players with forced refresh
    let userTokensMap = new Map();
    try {
        // Clear token cache before fetching to ensure fresh data
        if (typeof clearTokenCache === 'function') {
            clearTokenCache();
        }
        
        userTokensMap = await getTokensByUsernames(usernames);
        console.log('🪙 D2: Loaded fresh tokens for', userTokensMap.size, 'players');
        
        // Debug: Log equipped tokens
        userTokensMap.forEach((tokens, username) => {
            const equipped = tokens.find(token => token.equipped);
            if (equipped) {
                console.log(`🎯 D2: ${username} has equipped: ${equipped.tokenName}`);
            }
        });
        
    } catch (error) {
        console.error('D2: Error fetching tokens:', error);
    }

    // Update the table header to match D1
    const thead = document.querySelector('#ladder-d2 thead tr');
    if (thead) {
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
    }

    // Create all rows at once for better performance
    const rowsHtml = ladderData.map(player => {
        const stats = matchStatsBatch.get(player.username) || {
            totalMatches: 0, wins: 0, losses: 0, 
            kda: 0, winRate: 0, totalKills: 0, totalDeaths: 0
        };
        
        // NEW: Get user's tokens
        const userTokens = userTokensMap.get(player.username) || [];
        const primaryToken = getPrimaryDisplayToken(userTokens);
        
        // Debug: Log what token is being used for each player
        if (primaryToken) {
            console.log(`🎨 D2: ${player.username} displaying token: ${primaryToken.tokenName} (equipped: ${primaryToken.equipped})`);
        }
        
        return createPlayerRowWithTokenD2(player, stats, primaryToken);
    }).join('');

    // Append all rows at once
    tbody.innerHTML = rowsHtml;

    // Get all ELO changes and update indicators (same pattern as D1)
    getPlayersLastEloChangesD2(usernames)
        .then(changes => {
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
                        
                        // Find the indicator element that's already in the DOM
                        const indicator = eloCell.querySelector('.trend-indicator');
                        if (indicator) {
                            // Update the existing indicator (same as D1)
                            indicator.textContent = formattedChange;
                            indicator.style.color = change > 0 ? '#4CAF50' : '#F44336';
                            indicator.style.fontWeight = 'bold';
                            indicator.style.fontSize = '0.85em';
                            indicator.style.display = 'inline';
                            indicator.style.visibility = 'visible';
                            indicator.style.opacity = '1';
                        }
                    }
                }
            });
        })
        .catch(error => console.error('Error updating D2 ELO trend indicators:', error));
}

// NEW: Function to create HTML for a single D2 player row with token support
function createPlayerRowWithTokenD2(player, stats, primaryToken) {
    const elo = parseFloat(player.elo) || 0;
    
    // Set ELO-based colors (same as D1)
    let usernameColor = 'gray';
    if (elo >= 2000) {
        usernameColor = '#50C878'; // Emerald Green
    } else if (elo >= 1800) {
        usernameColor = '#FFD700'; // Gold
    } else if (elo >= 1600) {
        usernameColor = '#C0C0C0'; // Silver
    } else if (elo >= 1400) {
        usernameColor = '#CD7F32'; // Bronze
    }

    // Create flag HTML if player has country (comes AFTER username)
    let flagHtml = '';
    if (player.country) {
        flagHtml = `<img src="../images/flags/${player.country.toLowerCase()}.png" 
                        alt="${player.country}" 
                        class="player-flag" 
                        style="margin-left: 5px; vertical-align: middle; width: 20px; height: auto;"
                        onerror="this.style.display='none'">`;
    }

    // NEW: Create token HTML if player has tokens (comes AFTER flag)
    let tokenHtml = '';
    if (primaryToken) {
        tokenHtml = `<img src="${primaryToken.tokenImage}" 
                         alt="${primaryToken.tokenName}" 
                         class="player-token" 
                         title="${primaryToken.tokenName} ${primaryToken.equipped ? '(Equipped)' : ''}"
                         style="width: 35px; height: 35px; margin-left: 5px; vertical-align: middle; object-fit: contain;"
                         onerror="this.style.display='none'">`;
    }

    return `
    <tr>
        <td>${player.position}</td>
        <td style="position: relative;">
            <div style="display: flex; align-items: center; position: relative;">
                <a href="profile.html?username=${encodeURIComponent(player.username)}&ladder=d2" 
                   style="color: ${usernameColor}; text-decoration: none;">
                    ${player.username}
                </a>
                ${flagHtml}
                ${tokenHtml}
            </div>
        </td>
        <td style="color: ${usernameColor}; position: relative;">
            <div class="elo-container" style="display: flex; align-items: center;">
                <span class="elo-value">${elo}</span>
                <span class="trend-indicator" style="margin-left: 5px;"></span>
            </div>
        </td>
        <td>${stats.totalMatches}</td>
        <td>${stats.wins}</td>
        <td>${stats.losses}</td>
        <td>${stats.kda}</td>
        <td>${stats.winRate}%</td>
    </tr>`;
}

// Function for D2 ELO change tracking - KEEP THIS AS IS
async function getPlayersLastEloChangesD2(usernames) {
    const changes = new Map();
    usernames.forEach(username => changes.set(username, 0));
    
    try {
        // Try direct Firestore call first in case the idle wrapper is causing issues
        const eloHistoryRef = collection(db, 'eloHistoryD2');
        const recentHistoryQuery = query(eloHistoryRef, orderBy('timestamp', 'desc'), limit(100));
        const snapshot = await getDocs(recentHistoryQuery);
                
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
                    }
                }
            }
        });
        
        // If we didn't find any changes, try fallback to main eloHistory
        if (entriesByUsername.size === 0) {
            
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
            }
        }
    } catch (error) {
        console.error('D2: Error fetching ELO history:', error);
    }
    
    return changes;
}

// Helper function to fetch all D2 match stats at once - much more efficient
async function fetchBatchMatchStatsD2(usernames) {
    const matchStats = new Map();
    
    try {
        // Initialize stats for all players
        usernames.forEach(username => {
            matchStats.set(username, {
                totalMatches: 0,
                wins: 0,
                losses: 0,
                totalKills: 0,
                totalDeaths: 0,
                kda: 0,
                winRate: 0
            });
        });
        
        // Get all matches in one query instead of per-player
        const approvedMatchesRef = collection(db, 'approvedMatchesD2');
        const allMatches = await getDocs(approvedMatchesRef);
        
        // Process all matches in a single pass
        allMatches.forEach(doc => {
            const match = doc.data();
            const winnerUsername = match.winnerUsername;
            const loserUsername = match.loserUsername;
            
            if (usernames.includes(winnerUsername)) {
                const stats = matchStats.get(winnerUsername);
                stats.wins++;
                stats.totalMatches++;
                stats.totalKills += parseInt(match.winnerScore) || 0;
                stats.totalDeaths += parseInt(match.loserScore) || 0;
            }
            
            if (usernames.includes(loserUsername)) {
                const stats = matchStats.get(loserUsername);
                stats.losses++;
                stats.totalMatches++;
                stats.totalKills += parseInt(match.loserScore) || 0;
                stats.totalDeaths += parseInt(match.winnerScore) || 0;
            }
        });
        
        // Calculate derived stats
        usernames.forEach(username => {
            const stats = matchStats.get(username);
            
            // Calculate KDA ratio
            stats.kda = stats.totalDeaths > 0 ? 
                (stats.totalKills / stats.totalDeaths).toFixed(2) : 
                stats.totalKills.toFixed(2);
            
            // Calculate win rate
            stats.winRate = stats.totalMatches > 0 ? 
                ((stats.wins / stats.totalMatches) * 100).toFixed(1) : 0;
        });
        
    } catch (error) {
        console.error("Error fetching batch D2 match stats:", error);
    }
    
    return matchStats;
}

// Export the D2 ladder functions
export { displayLadderD2, updatePlayerPositions };