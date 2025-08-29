import { 
    collection, 
    getDocs,
    doc,
    getDoc,
    query,
    where,
    updateDoc,
    Timestamp,
    orderBy,
    limit
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from './firebase-config.js';
import firebaseIdle from './firebase-idle-wrapper.js';
import { getTokensByUsernames, getPrimaryDisplayToken, clearTokenCache } from './tokens.js';

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

// Enhanced caching system with multiple cache types
const playerCacheD3 = { data: null, timestamp: 0 };
const profileCacheD3 = { data: null, timestamp: 0 };
const matchStatsCacheD3 = { data: null, timestamp: 0 };
const eloHistoryCacheD3 = { data: null, timestamp: 0 };

// Cache durations
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const PROFILE_CACHE_DURATION = 10 * 60 * 1000; // 10 minutes
const MATCH_STATS_CACHE_DURATION = 3 * 60 * 1000; // 3 minutes
const ELO_HISTORY_CACHE_DURATION = 2 * 60 * 1000; // 2 minutes
/**
 * Optimized D3 ladder data loading with parallel fetching and caching
 */
async function loadLadderDataOptimizedD3(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && playerCacheD3.data && (now - playerCacheD3.timestamp < CACHE_DURATION)) {
        console.log('Using cached D3 ladder data');
        const usernames = playerCacheD3.data.map(p => p.username);
        const matchStatsBatch = await fetchBatchMatchStatsD3(usernames);
        return { players: playerCacheD3.data, matchStatsBatch };
    }

    const [playersSnapshot, profilesSnapshot] = await Promise.all([
        getDocs(collection(db, 'playersD3')),
        getDocs(collection(db, 'userProfiles'))
    ]);

    const players = [];
    playersSnapshot.forEach((doc) => {
        const playerData = doc.data();
        if (playerData.username) {
            players.push({
                ...playerData,
                id: doc.id,
                elo: playerData.eloRating || 0,
                position: playerData.position || Number.MAX_SAFE_INTEGER
            });
        }
    });

    const profilesByUsername = new Map();
    profilesSnapshot.forEach((doc) => {
        const profileData = doc.data();
        if (profileData.username) {
            profilesByUsername.set(profileData.username.toLowerCase(), profileData);
        }
    });

    for (const player of players) {
        const username = player.username.toLowerCase();
        if (profilesByUsername.has(username)) {
            const profile = profilesByUsername.get(username);
            if (profile.country) {
                player.country = profile.country.toLowerCase();
            }
            player.points = profile.points || 0;
        } else {
            player.points = 0;
        }
    }

    const usernames = players.map(p => p.username);
    const matchStatsBatch = await fetchBatchMatchStatsD3(usernames);

    players.sort((a, b) => {
        const aMatches = matchStatsBatch.get(a.username)?.totalMatches || 0;
        const bMatches = matchStatsBatch.get(b.username)?.totalMatches || 0;

        if ((aMatches === 0) !== (bMatches === 0)) {
            return aMatches === 0 ? 1 : -1;
        }

        return (a.position || 999) - (b.position || 999);
    });

    players.forEach((player, index) => {
        player.position = index + 1;
    });

    playerCacheD3.data = players;
    playerCacheD3.timestamp = now;

    return { players, matchStatsBatch };
}

/**
 * Main D3 ladder display function with progressive rendering
 */
async function displayLadderD3(forceRefresh = false) {
    const tableBody = document.querySelector('#ladder-d3 tbody');
    if (!tableBody) {
        console.error('D3 Ladder table body not found');
        return;
    }

    tableBody.innerHTML = '<tr><td colspan="9" class="loading-cell">Loading D3 ladder data...</td></tr>';

    try {
        const { players, matchStatsBatch } = await loadLadderDataOptimizedD3(forceRefresh);
        await updateLadderDisplayD3(players, matchStatsBatch);
    } catch (error) {
        console.error("Error loading D3 ladder:", error);
        tableBody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align: center; color: red;">
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

            // Invalidate cache to ensure fresh data is loaded
            playerCacheD3.timestamp = 0;
        }
    } catch (error) {
        console.error("Error updating D3 player positions:", error);
    }
}

/**
 * Progressive D3 ladder display with immediate basic rendering and background enhancements
 */
async function updateLadderDisplayD3(ladderData, matchStatsBatch = null) {
    const tbody = document.querySelector('#ladder-d3 tbody');
    if (!tbody) {
        console.error('D3 Ladder table body not found');
        return;
    }

    const thead = document.querySelector('#ladder-d3 thead tr');
    if (thead && !thead.dataset.initialized) {
        thead.innerHTML = `
            <th>Rank</th>
            <th>Username</th>
            <th>ELO</th>
            <th>Matches</th>
            <th>Wins</th>
            <th>Losses</th>
            <th>K/D</th>
            <th>Win Rate</th>
            <th>Points</th>
        `;
        thead.dataset.initialized = 'true';
    }

    ladderData.sort((a, b) => a.position - b.position);

    if (!matchStatsBatch) {
        const usernames = ladderData.map(p => p.username);
        matchStatsBatch = await fetchBatchMatchStatsD3(usernames);
    }

    const fragment = document.createDocumentFragment();
    
    ladderData.forEach(player => {
        const stats = matchStatsBatch.get(player.username) || {
            totalMatches: 0, wins: 0, losses: 0,
            totalKills: 0, totalDeaths: 0, kda: 0, winRate: 0, points: 0
        };

        const row = document.createElement('tr');
        row.innerHTML = createPlayerRowD3(player, stats, null);
        fragment.appendChild(row);
    });

    tbody.innerHTML = '';
    tbody.appendChild(fragment);

    const usernames = ladderData.map(p => p.username);
    
    loadTokensAsyncD3(tbody, ladderData, matchStatsBatch, usernames);
    loadEloChangesAsyncD3(tbody, usernames);
}

/**
 * Load tokens asynchronously for D3 ladder
 */
async function loadTokensAsyncD3(tbody, ladderData, matchStatsBatch, usernames) {
    try {
        const userTokensMap = await getTokensByUsernames(usernames);
        enhanceLadderWithTokensD3(tbody, ladderData, matchStatsBatch, userTokensMap);
    } catch (error) {
        console.error('Error loading D3 tokens:', error);
        return new Map();
    }
}

/**
 * Enhance existing D3 rows with tokens and flags
 */
function enhanceLadderWithTokensD3(tbody, ladderData, matchStatsBatch, userTokensMap) {
    const rows = tbody.querySelectorAll('tr');
    
    ladderData.forEach((player, index) => {
        if (index >= rows.length) return;
        
        const row = rows[index];
        const flagPlaceholder = row.querySelector('.flag-placeholder');
        const tokenPlaceholder = row.querySelector('.token-placeholder');
        
        if (player.country && flagPlaceholder) {
            flagPlaceholder.innerHTML = `<img src="../images/flags/${player.country.toLowerCase()}.png" 
                alt="${player.country}" class="player-flag" 
                style="margin-left: 5px; vertical-align: middle; width: 20px; height: auto;"
                onerror="this.style.display='none'">`;
        }
        
        const userTokens = userTokensMap.get(player.username) || [];
        const primaryToken = getPrimaryDisplayToken(userTokens);
        
        if (primaryToken && tokenPlaceholder) {
            tokenPlaceholder.innerHTML = `<img src="${primaryToken.tokenImage}" 
                alt="${primaryToken.tokenName}" class="player-token" 
                title="${primaryToken.tokenName} ${primaryToken.equipped ? '(Equipped)' : ''}" 
                style="width: 35px; height: 35px; margin-left: 5px; vertical-align: middle; object-fit: contain;"
                onerror="this.style.display='none'">`;
        }
    });
}

/**
 * Load ELO changes asynchronously for D3
 */
function loadEloChangesAsyncD3(tbody, usernames) {
    getPlayersLastEloChangesD3(usernames)
        .then(changes => {
            const rows = tbody.querySelectorAll('tr');
            
            changes.forEach((change, username) => {
                const userIndex = usernames.indexOf(username);
                if (userIndex !== -1 && userIndex < rows.length && change !== 0) {
                    const row = rows[userIndex];
                    const eloCell = row.querySelector('td:nth-child(3)');
                    if (eloCell) {
                        const indicator = eloCell.querySelector('.trend-indicator');
                        if (indicator) {
                            const formattedChange = change > 0 ? `+${change}` : `${change}`;
                            indicator.textContent = formattedChange;
                            indicator.style.color = change > 0 ? '#4CAF50' : '#F44336';
                            indicator.style.fontWeight = 'bold';
                            indicator.style.fontSize = '0.85em';
                            indicator.style.display = 'inline';
                        }
                    }
                }
            });
        })
        .catch(error => console.error('Error updating D3 ELO changes:', error));
}

/**
 * Optimized batch match stats fetching with caching for D3
 */
async function fetchBatchMatchStatsD3(usernames) {
    const now = Date.now();
    
    if (matchStatsCacheD3.data && (now - matchStatsCacheD3.timestamp < MATCH_STATS_CACHE_DURATION)) {
        const cachedStats = new Map();
        usernames.forEach(username => {
            if (matchStatsCacheD3.data.has(username)) {
                cachedStats.set(username, matchStatsCacheD3.data.get(username));
            } else {
                cachedStats.set(username, {
                    totalMatches: 0, wins: 0, losses: 0,
                    totalKills: 0, totalDeaths: 0, kda: 0, winRate: 0, points: 0
                });
            }
        });
        return cachedStats;
    }

    const matchStats = new Map();
    
    try {
        usernames.forEach(username => {
            matchStats.set(username, {
                totalMatches: 0, wins: 0, losses: 0,
                totalKills: 0, totalDeaths: 0, kda: 0, winRate: 0
            });
        });
        
        const approvedMatchesRef = collection(db, 'approvedMatchesD3');
        const allMatches = await getDocs(approvedMatchesRef);
        
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
        
        usernames.forEach(username => {
            const stats = matchStats.get(username);
            stats.kda = stats.totalDeaths > 0 ? 
                (stats.totalKills / stats.totalDeaths).toFixed(2) : stats.totalKills;
            stats.winRate = stats.totalMatches > 0 ? 
                ((stats.wins / stats.totalMatches) * 100).toFixed(1) : 0;
        });

        matchStatsCacheD3.data = matchStats;
        matchStatsCacheD3.timestamp = now;
        
    } catch (error) {
        console.error('Error fetching batch match stats for D3:', error);
    }
    
    return matchStats;
}

function createPlayerRowD3(player, stats, primaryToken) { 
    const elo = parseFloat(player.elo) || 0;

    // Set ELO-based colors with new thresholds
    let usernameColor = '#DC143C'; // Default for unranked
    if (stats.totalMatches === 0) {
        usernameColor = '#DC143C'; // Unranked (0 games)
    } else if (elo >= 1000 && stats.winRate >= 80 && stats.totalMatches >= 20) {
        usernameColor = '#50C878'; // Emerald (special requirements)
    } else if (elo >= 700) {
        usernameColor = '#FFD700'; // Gold (700-999)
    } else if (elo >= 500) {
        usernameColor = '#C0C0C0'; // Silver (500-699)
    } else if (elo >= 200) {
        usernameColor = '#CD7F32'; // Bronze (200-499)
    }

    return `
    <tr>
        <td>${player.position}</td>
        <td style="position: relative;">
            <div style="display: flex; align-items: center; position: relative;">
                <a href="profile.html?username=${encodeURIComponent(player.username)}&ladder=d3" 
                   style="color: ${usernameColor}; text-decoration: none;">
                    ${player.username}
                </a>
                <span class="flag-placeholder"></span>
                <span class="token-placeholder"></span>
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
        <td style="color: gray;">${player.points || 0}</td>
    </tr>`;
}

// Function for tracking ELO changes
async function getPlayersLastEloChangesD3(usernames) {
    const changes = new Map();
    usernames.forEach(username => changes.set(username, 0));
    
    try {
        // Build a player ID to username mapping
        const playerIdToUsername = new Map();
        const playersQuery = await getDocs(collection(db, 'playersD3'));
        playersQuery.forEach(doc => {
            const data = doc.data();
            if (data.username) {
                playerIdToUsername.set(doc.id, data.username);
            }
        });
        
        // Query for ELO history
        const eloHistoryRef = collection(db, 'eloHistoryD3');
        const eloQuery = query(eloHistoryRef, orderBy('timestamp', 'desc'), limit(100));
        const eloSnapshot = await getDocs(eloQuery);
        
        // Process entries and find most recent change for each player
        const entriesByUsername = new Map();
        
        eloSnapshot.forEach(doc => {
            const entry = doc.data();
            let username = null;
            
            // Try different fields to find username
            if (entry.username) username = entry.username;
            else if (entry.playerUsername) username = entry.playerUsername;
            else if (entry.player && typeof entry.player === 'string') username = entry.player;
            // Try player ID lookup
            else if (entry.player && playerIdToUsername.has(entry.player)) {
                username = playerIdToUsername.get(entry.player);
            }
            // Try other ID fields
            else if (entry.playerId && playerIdToUsername.has(entry.playerId)) {
                username = playerIdToUsername.get(entry.playerId);
            }
            
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
        
        // Process each player's entries
        entriesByUsername.forEach((playerEntries, username) => {
            if (playerEntries.length > 0) {
                playerEntries.sort((a, b) => b.timestamp - a.timestamp);
                
                const recentEntry = playerEntries.find(entry => 
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
        
        // Fallback to main eloHistory if needed
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
                    let username = entry.username || entry.playerUsername;
                    
                    // Try player ID lookup in fallback too
                    if (!username && entry.player && playerIdToUsername.has(entry.player)) {
                        username = playerIdToUsername.get(entry.player);
                    }
                    
                    if (username && usernames.includes(username)) {
                        const eloChange = entry.change || 
                            (entry.newElo !== undefined && entry.previousElo !== undefined ? 
                             entry.newElo - entry.previousElo : 0);
                        
                        if (eloChange !== 0) {
                            changes.set(username, eloChange);
                        }
                    }
                });
            } catch (fallbackError) {
                console.error('D3: Fallback query failed:', fallbackError);
            }
        }
    } catch (error) {
        console.error('D3: Error fetching ELO history:', error);
    }
    
    return changes;
}

// Add global refresh function
window.refreshLadderDisplayD3 = function(forceRefresh = true) {
    if (typeof displayLadderD3 === 'function') {
        displayLadderD3(forceRefresh);
    } else {
        console.warn('displayLadderD3 function not available');
    }
};

// Export the D3 ladder functions
export { displayLadderD3, updatePlayerPositions };