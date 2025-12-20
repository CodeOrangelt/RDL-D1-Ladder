import { db } from './firebase-config.js';
import { 
    collection, 
    getDocs,
    doc,
    getDoc,
    query,
    where,
    orderBy,
    limit
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { displayLadderD2 } from './ladderd2.js';
import { displayLadderD3 } from './ladderd3.js'; 
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    getLadderData, 
    getEloHistoryBatch, 
    setupEfficientListener 
} from './services/firebaseService.js';
import { displayLadderDuos } from './ladderduos.js';
import { getTokensByUsernames, getPrimaryDisplayToken } from './tokens.js';
import { displayLadderFFA } from './FFA/ladderffa.js';

const auth = getAuth();

// Track active listeners for cleanup
let activeListeners = [];

// Load ladder data efficiently
export async function loadLadderData(division = 1) {
  try {
    document.getElementById('loading-indicator').style.display = 'block';

    // Get ladder data with caching
    const players = await getLadderData(division);

    // Sort by ELO descending
    players.sort((a, b) => b.elo - a.elo);

    // Fetch ELO history in batch
    const playerIds = players.map(p => p.id);
    const eloHistoryData = await getEloHistoryBatch(playerIds, division);

    // Process and display ladder
    const processedPlayers = players.map((player, index) => {
      const history = eloHistoryData[player.id] || [];
      const lastMatches = history
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 5);

      return {
        ...player,
        rank: index + 1,
        lastMatches: lastMatches,
        recentActivity: lastMatches.length > 0
      };
    });

    renderLadder(processedPlayers);
    setupRealTimeUpdates(division);

  } catch (error) {
    console.error("Error loading ladder data:", error);
    document.getElementById('error-message').innerText = "Failed to load ladder data. Please try again.";
  } finally {
    document.getElementById('loading-indicator').style.display = 'none';
  }
}

// Setup efficient real-time updates
function setupRealTimeUpdates(division = 1) {
  // Clear previous listeners
  activeListeners.forEach(unsubscribe => unsubscribe());
  activeListeners = [];

  // Collection references
  const collectionName = division === 1 ? 'players' : `playersD${division}`;
  const matchesCollectionName = division === 1 ? 'matches' : `matchesD${division}`;

  // Listen only for recent matches (last 24 hours)
  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);

  // Set up efficient listeners with constraints
  const matchListener = setupEfficientListener(
    matchesCollectionName,
    [where('date', '>=', oneDayAgo.toISOString()), limit(10), orderBy('date', 'desc')],
    async (changes) => {
      // Only refresh ladder data if there are actual match changes
      if (changes.length > 0) {
        await loadLadderData(division);
      }
    }
  );

  activeListeners.push(matchListener);
}

// Clean up listeners when navigating away
export function cleanupListeners() {
  activeListeners.forEach(unsubscribe => unsubscribe());
  activeListeners = [];
}

function renderLadder(players) {
  const ladderContainer = document.getElementById('ladder-container');
  ladderContainer.innerHTML = '';

  players.forEach(player => {
    const playerElement = document.createElement('div');
    playerElement.className = 'ladder-player';
    playerElement.innerHTML = `
      <div class="rank">#${player.rank}</div>
      <div class="player-name">${player.username || player.id}</div>
      <div class="player-elo">${player.elo}</div>
      <div class="player-activity ${player.recentActivity ? 'active' : 'inactive'}">
        ${player.recentActivity ? 'Active' : 'Inactive'}
      </div>
    `;
    ladderContainer.appendChild(playerElement);
  });
}

// Add caching system like D2/D3 ladders
const playerCache = {
    data: null,
    timestamp: 0
};
const profileCache = {
    data: null,
    timestamp: 0
};
const matchStatsCache = {
    data: null,
    timestamp: 0
};
const eloHistoryCache = {
    data: null,
    timestamp: 0
};
const CACHE_DURATION = 300000;
const PROFILE_CACHE_DURATION = 600000;
const MATCH_STATS_CACHE_DURATION = 180000;
const ELO_HISTORY_CACHE_DURATION = 120000;

async function displayLadder(forceRefresh = false) {
    const tableBody = document.querySelector('#ladder tbody');
    if (!tableBody) {
        console.error('Ladder table body not found');
        return;
    }

    // Show loading state immediately
    tableBody.innerHTML = '<tr><td colspan="8" class="loading-cell">Loading ladder data...</td></tr>';
    
    // Start loading data immediately without waiting
    const loadingPromise = loadLadderDataOptimized(forceRefresh);
    
    try {
        const { players, matchStatsBatch } = await loadingPromise;
        await updateLadderDisplay(players, matchStatsBatch);
    } catch (error) {
        console.error("Error loading ladder:", error);
        tableBody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; color: red;">
                    Error loading ladder data: ${error.message}
                </td>
            </tr>
        `;
    }
}

// Optimized data loading with parallel operations
async function loadLadderDataOptimized(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && playerCache.data && (now - playerCache.timestamp < CACHE_DURATION)) {
        console.log('Using cached D1 ladder data');
        const usernames = playerCache.data.map(p => p.username);
        const matchStatsBatch = await fetchBatchMatchStats(usernames);
        return { players: playerCache.data, matchStatsBatch };
    }

    const [playersSnapshot, profilesSnapshot] = await Promise.all([
        getDocs(collection(db, 'players')),
        getDocs(collection(db, 'userProfiles'))
    ]);

    const players = [];
    const profilesByUsername = new Map();

    playersSnapshot.forEach((doc) => {
        const playerData = doc.data();
        players.push({
            ...playerData,
            id: doc.id,
            elo: playerData.eloRating || 0,
            position: playerData.position || Number.MAX_SAFE_INTEGER
        });
    });

    profilesSnapshot.forEach((doc) => {
        const profileData = doc.data();
        if (profileData.username) {
            profilesByUsername.set(profileData.username.toLowerCase(), profileData);
        }
    });

    profileCache.data = profilesByUsername;
    profileCache.timestamp = now;

    // Match profiles to players - assign country data
    players.forEach(player => {
        const username = player.username?.toLowerCase();
        if (username && profilesByUsername.has(username)) {
            const profile = profilesByUsername.get(username);
            if (profile.country) {
                player.country = profile.country.toLowerCase();
            }
            player.points = profile.points || 0;
        } else {
            player.points = 0;
        }
    });

    const usernames = players.map(p => p.username);
    const matchStatsBatch = await fetchBatchMatchStats(usernames);

    // Sort players with match info
    players.sort((a, b) => {
        const aMatches = matchStatsBatch.get(a.username)?.totalMatches || 0;
        const bMatches = matchStatsBatch.get(b.username)?.totalMatches || 0;

        if ((aMatches === 0) !== (bMatches === 0)) {
            return aMatches === 0 ? 1 : -1;
        }
        return (a.position || 999) - (b.position || 999);
    });

    // Reassign positions
    players.forEach((player, index) => {
        player.position = index + 1;
    });

    playerCache.data = players;
    playerCache.timestamp = now;

    return { players, matchStatsBatch };
}

// Helper function to fetch all match stats at once - much more efficient
async function fetchBatchMatchStats(usernames) {
    const now = Date.now();
    
    if (matchStatsCache.data && (now - matchStatsCache.timestamp < MATCH_STATS_CACHE_DURATION)) {
        const cachedStats = new Map();
        usernames.forEach(username => {
            if (matchStatsCache.data.has(username)) {
                cachedStats.set(username, matchStatsCache.data.get(username));
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
                totalKills: 0, totalDeaths: 0, kda: 0, winRate: 0, points: 0
            });
        });

        const approvedMatchesRef = collection(db, 'approvedMatches');
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

        usernames.forEach(username => {
            const stats = matchStats.get(username);
            stats.kda = stats.totalDeaths > 0 ? 
                (stats.totalKills / stats.totalDeaths).toFixed(2) : 
                stats.totalKills.toFixed(2);
            stats.winRate = stats.totalMatches > 0 ? 
                ((stats.wins / stats.totalMatches) * 100).toFixed(1) : 0;
        });

        matchStatsCache.data = matchStats;
        matchStatsCache.timestamp = now;

    } catch (error) {
        console.error("Error fetching batch match stats:", error);
    }

    return matchStats;
}

// Update getPlayerRankName function
function getPlayerRankName(elo, matchCount = 0, winRate = 0) {
    if (matchCount === 0) return 'Unranked';
    if (elo >= 1000 && winRate >= 80 && matchCount >= 20) return 'Emerald';
    if (elo >= 700) return 'Gold';
    if (elo >= 500) return 'Silver';
    if (elo >= 200) return 'Bronze';
    return 'Unranked';
}

/**
 * Get username color based on rank and statistics
 * @param {number} elo - Player's ELO rating
 * @param {Object} stats - Player statistics
 * @returns {string} Color hex code
 */
function getUsernameColor(elo, stats) {
    if (stats.totalMatches === 0) return '#DC143C'; // Unranked (0 games)
    if (elo >= 1000 && stats.winRate >= 80 && stats.totalMatches >= 20) return '#50C878'; // Emerald
    if (elo >= 700) return '#FFD700'; // Gold
    if (elo >= 500) return '#C0C0C0'; // Silver
    if (elo >= 200) return '#CD7F32'; // Bronze
    return '#DC143C'; // Default unranked
}

// Add this function right before updateLadderDisplay function (around line 280)

// Function to get the last ELO change for each player
async function getPlayersLastEloChanges(usernames) {
    const now = Date.now();
    const changes = new Map();
    usernames.forEach(username => {
        changes.set(username, 0);
    });

    if (eloHistoryCache.data && (now - eloHistoryCache.timestamp < ELO_HISTORY_CACHE_DURATION)) {
        usernames.forEach(username => {
            if (eloHistoryCache.data.has(username)) {
                changes.set(username, eloHistoryCache.data.get(username));
            }
        });
        return changes;
    }

    try {
        let userIdToUsername = new Map();
        let usernameToUserId = new Map();

        if (playerCache.data) {
            playerCache.data.forEach(player => {
                if (player.username) {
                    userIdToUsername.set(player.id, player.username);
                    usernameToUserId.set(player.username.toLowerCase(), player.id);
                }
            });
        } else {
            const playersRef = collection(db, 'players');
            const playersSnapshot = await getDocs(playersRef);
            playersSnapshot.forEach(doc => {
                const userData = doc.data();
                if (userData.username) {
                    userIdToUsername.set(doc.id, userData.username);
                    usernameToUserId.set(userData.username.toLowerCase(), doc.id);
                }
            });
        }

        const eloHistoryRef = collection(db, 'eloHistory');
        const eloQuery = query(eloHistoryRef, orderBy('timestamp', 'desc'), limit(300));
        const eloSnapshot = await getDocs(eloQuery);

        if (eloSnapshot.empty) {
            console.log('ELO history collection is empty');
            return changes;
        }


        // Process entries and group by username
        const entriesByUsername = new Map();
        let matchCount = 0;

        eloSnapshot.forEach(doc => {
            const entry = doc.data();
            let username = null;

            // First try: Direct user ID match in the player field
            if (entry.player && userIdToUsername.has(entry.player)) {
                username = userIdToUsername.get(entry.player);
            }
            // Second try: Look for username field in case some entries use that
            else if (entry.username && usernameToUserId.has(entry.username.toLowerCase())) {
                username = entry.username;
            }
            // Third try: Try playerUsername field
            else if (entry.playerUsername && usernameToUserId.has(entry.playerUsername.toLowerCase())) {
                username = entry.playerUsername;
            }

            if (username && usernames.includes(username)) {
                matchCount++;

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
                    (entry.newElo !== undefined && entry.previousElo !== undefined) ||
                    (entry.newEloRating !== undefined && entry.oldEloRating !== undefined)
                );

                if (recentEntry) {
                    let eloChange;
                    if (recentEntry.change !== undefined) {
                        eloChange = parseInt(recentEntry.change);
                    } else if (recentEntry.newElo !== undefined && recentEntry.previousElo !== undefined) {
                        eloChange = parseInt(recentEntry.newElo) - parseInt(recentEntry.previousElo);
                    } else if (recentEntry.newEloRating !== undefined && recentEntry.oldEloRating !== undefined) {
                        eloChange = parseInt(recentEntry.newEloRating) - parseInt(recentEntry.oldEloRating);
                    }

                    if (!isNaN(eloChange) && eloChange !== 0) {
                        changes.set(username, eloChange);
                    }
                }
            }
        });

        eloHistoryCache.data = changes;
        eloHistoryCache.timestamp = now;

    } catch (error) {
        console.error('Error fetching ELO history:', error);
    }

    return changes;
}

/**
 * Create HTML for a single player row with token support
 * @param {Object} player - Player data
 * @param {Object} stats - Player statistics
 * @param {Object} primaryToken - Primary display token
 * @returns {string} HTML string for player row
 */
function createPlayerRowWithToken(player, stats, primaryToken) {
    const elo = parseFloat(player.elo) || 0;

    // Update the color logic in createPlayerRow and createPlayerRowWithToken functions
    const usernameColor = getUsernameColor(elo, stats);

    // Create flag HTML if player has country (comes AFTER username)
    let flagHtml = '';
    if (player.country) {
        flagHtml = `<img src="../images/flags/${player.country.toLowerCase()}.png" 
                        alt="${player.country}" 
                        class="player-flag" 
                        style="margin-left: 5px; vertical-align: middle; width: 20px; height: auto;"
                        onerror="this.style.display='none'">`;
    }

    // Create token HTML if player has tokens
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
                <a href="profile.html?username=${encodeURIComponent(player.username)}&ladder=d1" 
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
        <td style="color: gray;">${player.points || 0}</td>
    </tr>`;
}

/**
 * Update ladder display with optimized batch operations and progressive rendering
 * @param {Array} ladderData - Array of player data
 * @param {Map} matchStatsBatch - Pre-fetched match statistics
 */
async function updateLadderDisplay(ladderData, matchStatsBatch = null) {
    const tbody = document.querySelector('#ladder tbody');
    if (!tbody) {
        console.error('Ladder table body not found');
        return;
    }

    // Update header only once
    const thead = document.querySelector('#ladder thead tr');
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

    const usernames = ladderData.map(p => p.username);

    // Fetch match stats if not provided
    if (!matchStatsBatch) {
        matchStatsBatch = await fetchBatchMatchStats(usernames);
    }

    // Load tokens in background (non-blocking)
    let userTokensMap = new Map();
    const tokenPromise = loadTokensInBackground(usernames);
    
    // Render basic ladder first for immediate feedback
    renderBasicLadder(tbody, ladderData, matchStatsBatch);
    
    // Then enhance with tokens when ready
    try {
        userTokensMap = await tokenPromise;
        enhanceLadderWithTokens(tbody, ladderData, matchStatsBatch, userTokensMap);
    } catch (error) {
        console.error('Error loading tokens:', error);
    }
    
    // Load ELO changes asynchronously
    loadEloChangesAsync(tbody, usernames);
}

// Fast basic rendering without tokens
function renderBasicLadder(tbody, ladderData, matchStatsBatch) {
    const fragment = document.createDocumentFragment();
    
    ladderData.forEach(player => {
        const stats = matchStatsBatch.get(player.username) || {
            totalMatches: 0, wins: 0, losses: 0, 
            kda: 0, winRate: 0, totalKills: 0, totalDeaths: 0
        };
        
        const row = createBasicPlayerRow(player, stats);
        fragment.appendChild(row);
    });
    
    tbody.innerHTML = '';
    tbody.appendChild(fragment);
}

// Create basic row element (faster than innerHTML)
function createBasicPlayerRow(player, stats) {
    const elo = parseFloat(player.elo) || 0;
    const usernameColor = getUsernameColor(elo, stats);
    
    const row = document.createElement('tr');
    row.innerHTML = `
        <td>${player.position}</td>
        <td style="position: relative;">
            <div style="display: flex; align-items: center;">
                <a href="profile.html?username=${encodeURIComponent(player.username)}&ladder=d1" 
                   style="color: ${usernameColor}; text-decoration: none;">
                    ${player.username}
                </a>
                <span class="flag-placeholder"></span>
                <span class="token-placeholder"></span>
            </div>
        </td>
        <td style="color: ${usernameColor};">
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
    `;
    
    return row;
}

// Load tokens in background
async function loadTokensInBackground(usernames) {
    try {
        return await getTokensByUsernames(usernames);
    } catch (error) {
        console.error('Error loading tokens:', error);
        return new Map();
    }
}

// Enhance existing rows with tokens and flags
function enhanceLadderWithTokens(tbody, ladderData, matchStatsBatch, userTokensMap) {
    const rows = tbody.querySelectorAll('tr');
    
    ladderData.forEach((player, index) => {
        if (index >= rows.length) return;
        
        const row = rows[index];
        const flagPlaceholder = row.querySelector('.flag-placeholder');
        const tokenPlaceholder = row.querySelector('.token-placeholder');
        
        // Add flag
        if (player.country && flagPlaceholder) {
            flagPlaceholder.innerHTML = `<img src="../images/flags/${player.country.toLowerCase()}.png" 
                alt="${player.country}" class="player-flag" 
                style="margin-left: 5px; vertical-align: middle; width: 20px; height: auto;"
                onerror="this.style.display='none'">`;
        }
        
        // Add token
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

// Load ELO changes asynchronously
function loadEloChangesAsync(tbody, usernames) {
    getPlayersLastEloChanges(usernames)
        .then(changes => {
            const rows = tbody.querySelectorAll('tr');
            
            changes.forEach((change, username) => {
                const playerIndex = usernames.indexOf(username);
                if (playerIndex >= 0 && playerIndex < rows.length && change !== 0) {
                    const row = rows[playerIndex];
                    const indicator = row.querySelector('.trend-indicator');
                    
                    if (indicator) {
                        const formattedChange = change > 0 ? `+${change}` : `${change}`;
                        indicator.textContent = formattedChange;
                        indicator.style.color = change > 0 ? '#4CAF50' : '#F44336';
                        indicator.style.fontWeight = 'bold';
                        indicator.style.fontSize = '0.85em';
                    }
                }
            });
        })
        .catch(error => console.error('Error updating ELO indicators:', error));

}

/**
 * Initialize ladder toggle functionality
 */
function initLadderToggles() {    
    const d1Toggle = document.getElementById('d1-switch');
    const d2Toggle = document.getElementById('d2-switch');
    const d3Toggle = document.getElementById('d3-switch');
    const duosToggle = document.getElementById('duos-switch');
    const ffaToggle = document.getElementById('ffa-switch');

    const d1Container = document.getElementById('d1-ladder-container');
    const d2Container = document.getElementById('d2-ladder-container');
    const d3Container = document.getElementById('d3-ladder-container');
    const duosContainer = document.getElementById('duos-ladder-container');
    const ffaContainer = document.getElementById('ffa-ladder-container');

    function hideAllLadders() {
        // First, remove active class from all containers
        if (d1Container) d1Container.classList.remove('active');
        if (d2Container) d2Container.classList.remove('active');
        if (d3Container) d3Container.classList.remove('active');
        if (duosContainer) duosContainer.style.display = 'none';
        if (ffaContainer) ffaContainer.style.display = 'none';

        // Also ensure display is none (as a fallback)
        if (d1Container) d1Container.style.display = 'none';
        if (d2Container) d2Container.style.display = 'none';
        if (d3Container) d3Container.style.display = 'none';
    }

    // D1 button event listener
    if (d1Toggle) {
        d1Toggle.addEventListener('click', () => {
            console.log("D1 toggle clicked");
            hideAllLadders(); // Hide all ladders first

            // Show D1 ladder
            if (d1Container) {
                d1Container.classList.add('active');
                d1Container.style.display = 'block';
            }

            // Show D1 recommendation, hide others
            document.getElementById('elo-recommendation-text-d1').style.display = 'block';
            document.getElementById('elo-recommendation-text-d2').style.display = 'none';
            document.getElementById('elo-recommendation-text-d3').style.display = 'none';

            // Update button UI
            if (d1Toggle) d1Toggle.classList.add('active');
            if (d2Toggle) d2Toggle.classList.remove('active');
            if (d3Toggle) d3Toggle.classList.remove('active');

            // Load ladder data
            displayLadder();
            findBestOpponent('d1');
        });
    }

    // D2 button event listener
    if (d2Toggle) {
        d2Toggle.addEventListener('click', () => {
            console.log("D2 toggle clicked");
            hideAllLadders(); // Hide all ladders first

            if (d2Container) {
                d2Container.classList.add('active');
                d2Container.style.display = 'block';
            }

            // Show D2 recommendation, hide others
            document.getElementById('elo-recommendation-text-d1').style.display = 'none';
            document.getElementById('elo-recommendation-text-d2').style.display = 'block';
            document.getElementById('elo-recommendation-text-d3').style.display = 'none';

            // Update button UI
            if (d2Toggle) d2Toggle.classList.add('active');
            if (d1Toggle) d1Toggle.classList.remove('active');
            if (d3Toggle) d3Toggle.classList.remove('active');

            // Load ladder data
            displayLadderD2();
            findBestOpponent('d2');
        });
    }

    if (d3Toggle) {
        d3Toggle.addEventListener('click', () => {
            console.log("D3 toggle clicked");
            hideAllLadders(); // Hide all ladders first

            if (d3Container) {
                d3Container.classList.add('active');
                d3Container.style.display = 'block';
            }

            // Show D3 recommendation, hide others
            document.getElementById('elo-recommendation-text-d1').style.display = 'none';
            document.getElementById('elo-recommendation-text-d2').style.display = 'none';
            document.getElementById('elo-recommendation-text-d3').style.display = 'block';

            // Update button UI
            if (d3Toggle) d3Toggle.classList.add('active');
            if (d1Toggle) d1Toggle.classList.remove('active');
            if (d2Toggle) d2Toggle.classList.remove('active');

            // Load ladder data
            displayLadderD3();
            findBestOpponent('d3');
        });
    }

    // Duos button event listener
    if (duosToggle) {
        duosToggle.addEventListener('click', () => {
            hideAllLadders();
            if (duosContainer) duosContainer.style.display = 'block';
            displayLadderDuos();
            findBestOpponent('duos');
            if (document.getElementById('elo-recommendation-text-duos')) {
                document.getElementById('elo-recommendation-text-duos').style.display = 'block';
            }

        // Show Duos recommendation, hide others
            document.getElementById('elo-recommendation-text-d1').style.display = 'none';
            document.getElementById('elo-recommendation-text-d2').style.display = 'none';
            document.getElementById('elo-recommendation-text-d3').style.display = 'none'; 
        });
    }

    // FFA button event listener
    if (ffaToggle) {
        ffaToggle.addEventListener('click', () => {
            console.log("FFA toggle clicked");
            hideAllLadders();

            // Show FFA container
            if (ffaContainer) {
                ffaContainer.style.display = 'block';
            }

            // Load FFA ladder data
            displayLadderFFA();
            findBestOpponent('ffa');

            // Show FFA recommendation, hide others
            document.getElementById('elo-recommendation-text-d1').style.display = 'none';
            document.getElementById('elo-recommendation-text-d2').style.display = 'none';
            document.getElementById('elo-recommendation-text-d3').style.display = 'none';
            if (document.getElementById('elo-recommendation-text-duos')) {
                document.getElementById('elo-recommendation-text-duos').style.display = 'none';
            }
            if (document.getElementById('elo-recommendation-text-ffa')) {
                document.getElementById('elo-recommendation-text-ffa').style.display = 'block';
            }
        });
    }
}

/**
 * Initialize ladder on document ready
 */
document.addEventListener('DOMContentLoaded', () => {
    initLadderToggles();
    displayLadder();  // Initial display of the ladder
    findBestOpponent('d1'); // Initial opponent recommendation

    // Show only D1 recommendation initially (D1 is the default ladder)
    document.getElementById('elo-recommendation-text-d1').style.display = 'block';
});

// Export functions for external use
export { displayLadder};

/**
 * Find the best opponent for the current user based on ELO and ladder type
 * @param {string} currentLadder - Current ladder type (d1, d2, d3, duos)
 */
async function findBestOpponent(currentLadder = 'd1') {
    // Get the appropriate recommendation element based on ladder type
    const recommendationElId = `elo-recommendation-text-${currentLadder}`;
    const recommendationEl = document.getElementById(recommendationElId);

    if (!recommendationEl) {
        console.error(`Recommendation element for ${currentLadder} not found`);
        return;
    }

    // Get the current user
    const user = auth.currentUser;
    if (!user) {
        recommendationEl.textContent = '';
        return;
    }

    try {
        // Get the user's profile
        const profileRef = doc(db, 'userProfiles', user.uid);
        const profileDoc = await getDoc(profileRef);

        if (!profileDoc.exists()) {
            console.log('No user profile found');
            recommendationEl.textContent = 'Complete your profile to see recommended opponents';
            return;
        }

        const profile = profileDoc.data();
        const username = profile.username;

        if (!username) {
            recommendationEl.textContent = 'Set your username to see recommended opponents';
            return;
        }

        // Determine which collection to query based on current ladder
        let ladderCollection;
        switch(currentLadder) {
            case 'd1':
                ladderCollection = 'players';
                break;
            case 'd2':
                ladderCollection = 'playersD2';
                break;
            case 'd3':
                ladderCollection = 'playersD3';
                break;
            case 'duos':
                ladderCollection = 'playersDuos';
                break;
            case 'ffa':
            ladderCollection = 'playersFFA';
                break;
            default:
                ladderCollection = 'players';
        }

        // Special handling for DUOS ladder
        if (currentLadder === 'duos') {
            // Get the user's data from DUOS ladder
            const playersRef = collection(db, ladderCollection);
            const playerQuery = query(playersRef, where('username', '==', username));
            const playerSnapshot = await getDocs(playerQuery);

            if (playerSnapshot.empty) {
                recommendationEl.textContent = 
                    `You're not registered on the DUOS ladder`;
                return;
            }

            const playerData = playerSnapshot.docs[0].data();
            const userElo = parseInt(playerData.eloRating) || 200;

            // Check if user has a team
            if (playerData.hasTeam && playerData.teammate) {
                recommendationEl.innerHTML = `You're teamed with <span class="recommendation-highlight">${playerData.teammate}</span>. Challenge other teams!`;
                return;
            }

            // If no team, find potential teammates or opponents
            const allPlayersSnapshot = await getDocs(playersRef);
            let bestTeammate = null;
            let bestTeammateScore = -1;

            allPlayersSnapshot.forEach(doc => {
                const potentialTeammate = doc.data();

                // Skip if this is the current user
                if (potentialTeammate.username === username) return;

                // Skip if they already have a team
                if (potentialTeammate.hasTeam) return;

                const teammateElo = parseInt(potentialTeammate.eloRating) || 200;
                const eloDifference = Math.abs(teammateElo - userElo);

                // Calculate teammate compatibility score (closer ELO is better)
                const compatibilityScore = Math.max(0, 200 - eloDifference);

                if (compatibilityScore > bestTeammateScore) {
                    bestTeammate = potentialTeammate;
                    bestTeammateScore = compatibilityScore;
                }
            });

            if (bestTeammate) {
                const teammateElo = parseInt(bestTeammate.eloRating) || 200;

                // Set ELO-based colors
                let usernameColor = 'gray';
                if (teammateElo >= 2000) {
                    usernameColor = '#50C878'; // Emerald Green
                } else if (teammateElo >= 1800) {
                    usernameColor = '#FFD700'; // Gold
                } else if (teammateElo >= 1600) {
                    usernameColor = '#C0C0C0'; // Silver
                } else if (teammateElo >= 1400) {
                    usernameColor = '#CD7F32'; // Bronze
                } else {
                    usernameColor = '#DC143C'; // Unranked
                }

                recommendationEl.innerHTML = `Looking for a teammate? Consider <span class="recommendation-highlight" style="color: ${usernameColor};">${bestTeammate.username}</span> (ELO: ${teammateElo})`;
            } else {
                recommendationEl.textContent = `No available teammates found. More players needed on DUOS ladder!`;
            }

            return;
        }

        // Original logic for solo ladders (D1, D2, D3)
        const playersRef = collection(db, ladderCollection);
        const playerQuery = query(playersRef, where('username', '==', username));
        const playerSnapshot = await getDocs(playerQuery);

        if (playerSnapshot.empty) {
            recommendationEl.textContent = 
                `You're not registered on the ${currentLadder.toUpperCase()} ladder`;
            return;
        }

        const playerData = playerSnapshot.docs[0].data();
        const userElo = parseInt(playerData.eloRating) || 1500;

        // Get all players to find best match
        const allPlayersSnapshot = await getDocs(playersRef);
        let bestMatch = null;
        let bestMatchScore = -1;

        // Get user's rank tier
        const userRankTier = getPlayerRankName(userElo);

        allPlayersSnapshot.forEach(doc => {
            const potentialOpponent = doc.data();

            // Skip if this is the current user - use normalized comparison
            if (potentialOpponent.username && 
                (potentialOpponent.username.toLowerCase().trim() === username.toLowerCase().trim() ||
                potentialOpponent.userId === user.uid)) {
                return;
            }   

            const opponentElo = parseInt(potentialOpponent.eloRating) || 1500;
            const opponentRankTier = getPlayerRankName(opponentElo);

            // Calculate ELO difference (absolute value)
            const eloDifference = Math.abs(opponentElo - userElo);

            // Calculate expected ELO gain using the ELO formula
            const K = 32;
            const expectedScore = 1 / (1 + Math.pow(10, (opponentElo - userElo) / 400));
            const potentialEloGain = Math.round(K * (1 - expectedScore));

            // Skip opponents where you wouldn't gain any ELO
            if (potentialEloGain <= 0) return;

            // Calculate match quality score
            let matchScore = 0;

            // Base score from ELO proximity
            const proximityScore = Math.max(0, 100 - (eloDifference * 0.5));

            // ELO gain score
            const gainScore = potentialEloGain >= 3 && potentialEloGain <= 8 ? 50 : 
                             potentialEloGain > 0 && potentialEloGain < 15 ? 30 : 10;

            // Same rank tier bonus
            const tierBonus = userRankTier === opponentRankTier ? 40 : 0;

            // Calculate final score
            matchScore = proximityScore + gainScore + tierBonus;

            // Update best match if we found a better one
            if (matchScore > bestMatchScore) {
                bestMatch = potentialOpponent;
                bestMatchScore = matchScore;
            }
        });

        if (bestMatch) {
            const opponentElo = parseInt(bestMatch.eloRating) || 1500;
            
            // Get match stats for proper rank color calculation
            const matchStats = await fetchBatchMatchStats([bestMatch.username]);
            const stats = matchStats.get(bestMatch.username) || {
                totalMatches: 0, wins: 0, losses: 0,
                totalKills: 0, totalDeaths: 0, kda: 0, winRate: 0, points: 0
            };

            // Use the same color logic as the ladder display
            let usernameColor = '#DC143C'; // Default for unranked
            if (stats.totalMatches === 0) {
                usernameColor = '#DC143C'; // Unranked (0 games)
            } else if (opponentElo >= 1000 && stats.winRate >= 80 && stats.totalMatches >= 20) {
                usernameColor = '#50C878'; // Emerald (special requirements)
            } else if (opponentElo >= 700) {
                usernameColor = '#FFD700'; // Gold (700+)
            } else if (opponentElo >= 500) {
                usernameColor = '#C0C0C0'; // Silver (500-700)
            } else if (opponentElo >= 200) {
                usernameColor = '#CD7F32'; // Bronze (200-500)
            }

            recommendationEl.innerHTML = `Based on your ELO (${userElo}), you should be playing <span class="recommendation-highlight" style="color: ${usernameColor};">${bestMatch.username}</span>`;
        } else {
            recommendationEl.innerHTML = `No ideal opponent found for your current ELO (${userElo})`;
        }

    } catch (error) {
        console.error('Error finding best opponent:', error);
        recommendationEl.textContent = 'Error finding recommended opponent';
    }
}

// Listen for auth state changes to update recommendations
auth.onAuthStateChanged(user => {
    // Get current active ladder
    const d1Active = document.getElementById('d1-ladder-container') && document.getElementById('d1-ladder-container').style.display !== 'none';
    const d2Active = document.getElementById('d2-ladder-container') && document.getElementById('d2-ladder-container').style.display !== 'none';
    const d3Active = document.getElementById('d3-ladder-container') && document.getElementById('d3-ladder-container').style.display !== 'none';
    const duosActive = document.getElementById('duos-ladder-container') && document.getElementById('duos-ladder-container').style.display !== 'none';
    const ffaActive = document.getElementById('ffa-ladder-container') && document.getElementById('ffa-ladder-container').style.display !== 'none';

    const currentLadder = d1Active ? 'd1' : d2Active ? 'd2' : d3Active ? 'd3' : duosActive ? 'duos' : ffaActive ? 'ffa' : 'd1'; 
    findBestOpponent(currentLadder);
});

/**
 * Initialize admin-only DUOS ladder restrictions
 */
document.addEventListener('DOMContentLoaded', () => {
    // Add admin check for DUOS radio button
    const duosRadio = document.getElementById('duos-switch');
    const duosLabel = document.querySelector('label[for="duos-switch"]');
    
    if (duosRadio && duosLabel) {
        // Check if user is admin when they try to select DUOS
        duosRadio.addEventListener('change', async (e) => {
            if (e.target.checked) {
                const user = auth?.currentUser;
                const isUserAdmin = await checkIfUserIsAdmin(user);
                
                if (!isUserAdmin) {
                    // Prevent selection and reset to D1
                    e.preventDefault();
                    const d1Radio = document.getElementById('d1-switch');
                    if (d1Radio) {
                        d1Radio.checked = true;
                        // Trigger the D1 change event
                        d1Radio.dispatchEvent(new Event('change'));
                    }
                    
                    // Show admin-only message
                    showAdminOnlyMessage();
                    return false;
                }
            }
        });
        
        // Also disable the radio button visually for non-admins
        auth.onAuthStateChanged(async (user) => {
            const isUserAdmin = await checkIfUserIsAdmin(user);
            if (!isUserAdmin) {
                duosRadio.disabled = true;
                duosLabel.style.opacity = '0.5';
                duosLabel.style.cursor = 'not-allowed';
                duosLabel.title = 'Duos ladder is currently admin-only';
            } else {
                duosRadio.disabled = false;
                duosLabel.style.opacity = '1';
                duosLabel.style.cursor = 'pointer';
                duosLabel.title = '';
            }
        });
    }
});

/**
 * Check if user has admin privileges
 * @param {Object} user - Firebase user object
 * @returns {Promise<boolean>} True if user is admin
 */
const adminCache = new Map();
const ADMIN_CACHE_DURATION = 900000;

async function checkIfUserIsAdmin(user) {
    if (!user) return false;
    
    const now = Date.now();
    const cacheKey = user.uid;
    
    if (adminCache.has(cacheKey)) {
        const cached = adminCache.get(cacheKey);
        if (now - cached.timestamp < ADMIN_CACHE_DURATION) {
            return cached.isAdmin;
        }
    }
    
    try {
        const adminEmails = ['admin@ladder.com', 'brian2af@outlook.com'];
        if (user.email && adminEmails.includes(user.email.toLowerCase())) {
            adminCache.set(cacheKey, { isAdmin: true, timestamp: now });
            return true;
        }
        
        const docRef = doc(db, 'userProfiles', user.uid);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            const userData = docSnap.data();
            const roleName = (userData.roleName || userData.role || '').toLowerCase();
            const adminRoles = ['admin', 'owner', 'council', 'creative lead'];
            
            const isAdmin = roleName && adminRoles.includes(roleName);
            adminCache.set(cacheKey, { isAdmin, timestamp: now });
            return isAdmin;
        }
        
        adminCache.set(cacheKey, { isAdmin: false, timestamp: now });
        return false;
    } catch (error) {
        console.error('Error checking admin status:', error);
        return false;
    }
}

function showAdminOnlyMessage() {
    // Remove any existing message
    const existingMessage = document.getElementById('admin-only-message');
    if (existingMessage) {
        existingMessage.remove();
    }//
    //
    // Create new message
    const messageDiv = document.createElement('div');
    messageDiv.id = 'admin-only-message';
    messageDiv.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: #2a2a2a;
        border: 2px solid #ff6b6b;
        border-radius: 8px;
        padding: 1.5rem;
        text-align: center;
        color: #ff6b6b;
        z-index: 1000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    `;
    messageDiv.innerHTML = `
        <strong>🔒 Duos Ladder - Admin Only</strong><br>
        <span style="color: #ccc;">Currently in testing phase</span>
    `;
    
    document.body.appendChild(messageDiv);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
        if (messageDiv.parentNode) {
            messageDiv.remove();
        }
    }, 3000);
}