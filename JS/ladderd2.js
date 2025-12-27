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

// Enhanced caching system with multiple cache types
const playerCacheD2 = { data: null, timestamp: 0 };
const profileCacheD2 = { data: null, timestamp: 0 };
const matchStatsCacheD2 = { data: null, timestamp: 0 };
const eloHistoryCacheD2 = { data: null, timestamp: 0 };

// Cache durations
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const PROFILE_CACHE_DURATION = 10 * 60 * 1000; // 10 minutes
const MATCH_STATS_CACHE_DURATION = 3 * 60 * 1000; // 3 minutes
const ELO_HISTORY_CACHE_DURATION = 2 * 60 * 1000; // 2 minutes

/**
 * Optimized D2 ladder data loading with parallel fetching and caching
 */
async function loadLadderDataOptimizedD2(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && playerCacheD2.data && (now - playerCacheD2.timestamp < CACHE_DURATION)) {
        console.log('Using cached D2 ladder data');
        const usernames = playerCacheD2.data.map(p => p.username);
        const matchStatsBatch = await fetchBatchMatchStatsD2(usernames);
        return { players: playerCacheD2.data, matchStatsBatch };
    }

    const [playersSnapshot, profilesSnapshot] = await Promise.all([
        getDocs(collection(db, 'playersD2')),
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
    const matchStatsBatch = await fetchBatchMatchStatsD2(usernames);

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

    playerCacheD2.data = players;
    playerCacheD2.timestamp = now;

    return { players, matchStatsBatch };
}

/**
 * Main D2 ladder display function with progressive rendering
 */
async function displayLadderD2(forceRefresh = false) {
    const tableBody = document.querySelector('#ladder-d2 tbody');
    if (!tableBody) {
        console.error('D2 Ladder table body not found');
        return;
    }

    tableBody.innerHTML = '<tr><td colspan="9" class="loading-cell">Loading D2 ladder data...</td></tr>';

    try {
        const { players, matchStatsBatch } = await loadLadderDataOptimizedD2(forceRefresh);
        await updateLadderDisplayD2(players, matchStatsBatch);
    } catch (error) {
        console.error("Error loading D2 ladder:", error);
        tableBody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align: center; color: red;">
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

// Update the getPlayerRankNameD2 function
function getPlayerRankNameD2(elo, matchCount = 0, winRate = 0) {
    if (matchCount === 0) return 'Unranked';
    
    // 5+ matches rule: minimum Bronze rank
    if (matchCount >= 5 && elo < 200) return 'Bronze';
    
    if (elo >= 1000 && winRate >= 80 && matchCount >= 20) return 'Emerald';
    if (elo >= 700) return 'Gold';
    if (elo >= 500) return 'Silver';
    if (elo >= 200) return 'Bronze';
    return 'Unranked';
}

// Add global refresh function
window.refreshLadderDisplayD2 = function(forceRefresh = true) {
    if (typeof displayLadderD2 === 'function') {
        displayLadderD2(forceRefresh);
    } else {
        console.warn('displayLadderD2 function not available');
    }
};

/**
 * Progressive D2 ladder display with immediate basic rendering and background enhancements
 */
async function updateLadderDisplayD2(ladderData, matchStatsBatch = null) {
    const tbody = document.querySelector('#ladder-d2 tbody');
    if (!tbody) {
        console.error('D2 Ladder table body not found');
        return;
    }

    const thead = document.querySelector('#ladder-d2 thead tr');
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
        matchStatsBatch = await fetchBatchMatchStatsD2(usernames);
    }

    const fragment = document.createDocumentFragment();
    
    ladderData.forEach(player => {
        const stats = matchStatsBatch.get(player.username) || {
            totalMatches: 0, wins: 0, losses: 0,
            totalKills: 0, totalDeaths: 0, kda: 0, winRate: 0, points: 0
        };

        const row = document.createElement('tr');
        row.innerHTML = createPlayerRowWithTokenD2(player, stats, null);
        fragment.appendChild(row);
    });

    // Add spacer row for Toggle ELO button gap
    const spacerRow = document.createElement('tr');
    spacerRow.style.height = '60px';
    spacerRow.innerHTML = '<td colspan="9"></td>';
    fragment.appendChild(spacerRow);

    tbody.innerHTML = '';
    tbody.appendChild(fragment);

    const usernames = ladderData.map(p => p.username);
    
    loadTokensAsyncD2(tbody, ladderData, matchStatsBatch, usernames);
    loadEloChangesAsyncD2(tbody, usernames);
}

/**
 * Load tokens asynchronously for D2 ladder
 */
async function loadTokensAsyncD2(tbody, ladderData, matchStatsBatch, usernames) {
    try {
        const userTokensMap = await getTokensByUsernames(usernames);
        enhanceLadderWithTokensD2(tbody, ladderData, matchStatsBatch, userTokensMap);
    } catch (error) {
        console.error('Error loading D2 tokens:', error);
        return new Map();
    }
}

/**
 * Enhance existing D2 rows with tokens and flags
 */
function enhanceLadderWithTokensD2(tbody, ladderData, matchStatsBatch, userTokensMap) {
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
 * Load ELO changes asynchronously for D2
 */
function loadEloChangesAsyncD2(tbody, usernames) {
    getPlayersLastEloChangesD2(usernames)
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
        .catch(error => console.error('Error updating D2 ELO changes:', error));
}

// Function to create HTML for a single D2 player row with progressive enhancement
function createPlayerRowWithTokenD2(player, stats, primaryToken) {
    const elo = parseFloat(player.elo) || 0;

    // Set ELO-based colors with new thresholds
    let usernameColor = '#DC143C'; // Default for unranked
    if (stats.totalMatches === 0) {
        usernameColor = '#DC143C'; // Unranked (0 games)
    } else if (stats.totalMatches >= 5 && elo < 200) {
        usernameColor = '#CD7F32'; // Bronze (5+ matches rule)
    } else if (elo >= 1000 && stats.winRate >= 80 && stats.totalMatches >= 20) {
        usernameColor = '#50C878'; // Emerald (special requirements)
    } else if (elo >= 700) {
        usernameColor = '#FFD700'; // Gold (700+)
    } else if (elo >= 500) {
        usernameColor = '#b9f1fc'; // Silver (500-700)
    } else if (elo >= 200) {
        usernameColor = '#CD7F32'; // Bronze (200-500)
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

// Function for D2 ELO change tracking
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
                fallbackSnapshot.forEach(doc => {
                    const entry = doc.data();
                    const username = entry.username || entry.playerUsername;

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
                // Silently continue if fallback fails
            }
        }
    } catch (error) {
        console.error('D2: Error fetching ELO history:', error);
    }

    return changes;
}

/**
 * Optimized batch match stats fetching with caching for D2
 */
async function fetchBatchMatchStatsD2(usernames) {
    const now = Date.now();
    
    if (matchStatsCacheD2.data && (now - matchStatsCacheD2.timestamp < MATCH_STATS_CACHE_DURATION)) {
        const cachedStats = new Map();
        usernames.forEach(username => {
            if (matchStatsCacheD2.data.has(username)) {
                cachedStats.set(username, matchStatsCacheD2.data.get(username));
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

        const approvedMatchesRef = collection(db, 'approvedMatchesD2');
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
                (stats.totalKills / stats.totalDeaths).toFixed(2) : 
                stats.totalKills.toFixed(2);
            stats.winRate = stats.totalMatches > 0 ? 
                ((stats.wins / stats.totalMatches) * 100).toFixed(1) : 0;
        });

        matchStatsCacheD2.data = matchStats;
        matchStatsCacheD2.timestamp = now;

    } catch (error) {
        console.error("Error fetching batch D2 match stats:", error);
    }

    return matchStats;
}

// Export the D2 ladder functions
export { displayLadderD2, updatePlayerPositions };