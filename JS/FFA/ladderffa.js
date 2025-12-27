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
import { db } from '../firebase-config.js';
import firebaseIdle from '../firebase-idle-wrapper.js';
import { getTokensByUsernames, getPrimaryDisplayToken, clearTokenCache } from '../tokens.js';

// Enhanced caching system
const playerCacheFFA = { data: null, timestamp: 0 };
const profileCacheFFA = { data: null, timestamp: 0 };
const matchStatsCacheFFA = { data: null, timestamp: 0 };
const eloHistoryCacheFFA = { data: null, timestamp: 0 };

// Cache durations
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const PROFILE_CACHE_DURATION = 10 * 60 * 1000; // 10 minutes
const MATCH_STATS_CACHE_DURATION = 3 * 60 * 1000; // 3 minutes
const ELO_HISTORY_CACHE_DURATION = 2 * 60 * 1000; // 2 minutes

// HOT/COLD Temperature System Configuration
const TEMPERATURE_CONFIG = {
    // Recent match window (in days)
    RECENT_WINDOW_DAYS: 7,
    // Temperature thresholds based on recent performance
    THRESHOLDS: {
        BLAZING: { minWinRate: 80, minMatches: 5, color: '#FF4500', name: 'Blazing', emoji: '🔥🔥' },
        HOT: { minWinRate: 65, minMatches: 3, color: '#FF6347', name: 'Hot', emoji: '🔥' },
        WARM: { minWinRate: 50, minMatches: 2, color: '#FFA500', name: 'Warm', emoji: '☀️' },
        NEUTRAL: { minWinRate: 0, minMatches: 0, color: '#808080', name: 'Neutral', emoji: '' },
        COOL: { maxWinRate: 40, minMatches: 2, color: '#87CEEB', name: 'Cool', emoji: '❄️' },
        COLD: { maxWinRate: 25, minMatches: 3, color: '#379fc8ff', name: 'Cold', emoji: '❄️' },
        FROZEN: { maxWinRate: 15, minMatches: 5, color: '#4169E1', name: 'Frozen', emoji: '🧊' }
    }
};

// Points per placement - CUSTOMIZABLE
// Edit these values to change points awarded per placement
export const FFA_POINTS_CONFIG = {
    1: 100,  // 1st place
    2: 75,   // 2nd place
    3: 55,   // 3rd place
    4: 40,   // 4th place
    5: 30,   // 5th place
    6: 20,   // 6th place
    7: 15,   // 7th place
    8: 10,   // 8th place
    DEFAULT: 5 // 9th place and beyond
};

/**
 * Calculate player temperature based on recent match performance
 * @param {Array} recentMatches - Array of recent match results
 * @returns {Object} Temperature data with color, name, and emoji
 */
function calculatePlayerTemperature(recentMatches) {
    if (!recentMatches || recentMatches.length === 0) {
        return TEMPERATURE_CONFIG.THRESHOLDS.NEUTRAL;
    }

    const now = new Date();
    const windowStart = new Date(now.getTime() - (TEMPERATURE_CONFIG.RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000));
    
    const windowMatches = recentMatches.filter(match => {
        const matchDate = match.timestamp?.toDate ? match.timestamp.toDate() : new Date(match.timestamp);
        return matchDate >= windowStart;
    });

    if (windowMatches.length === 0) {
        return TEMPERATURE_CONFIG.THRESHOLDS.NEUTRAL;
    }

    const totalMatches = windowMatches.length;
    let topHalfFinishes = 0;
    let totalKills = 0;
    let totalDeaths = 0;

    windowMatches.forEach(match => {
        const placement = match.placement || match.position || 4;
        const totalPlayers = match.totalPlayers || 8;
        const midPoint = Math.ceil(totalPlayers / 2);
        
        if (placement <= midPoint) {
            topHalfFinishes++;
        }
        
        // Track K/D for the window
        totalKills += parseInt(match.kills) || 0;
        totalDeaths += parseInt(match.deaths) || 0;
    });

    const topHalfRate = (topHalfFinishes / totalMatches) * 100;
    const kd = totalDeaths > 0 ? totalKills / totalDeaths : totalKills;
    
    // NEW: Apply K/D penalty - reduce effective rate if K/D is poor
    let effectiveRate = topHalfRate;
    if (kd < 0.5) {
        effectiveRate *= 0.6;  // 40% penalty for very poor K/D
    } else if (kd < 1.0) {
        effectiveRate *= 0.8;  // 20% penalty for negative K/D
    }
    
    console.log(`Temperature: ${totalMatches} matches, ${topHalfRate.toFixed(1)}% top-half, K/D: ${kd.toFixed(2)}, effective: ${effectiveRate.toFixed(1)}%`);

    const thresholds = TEMPERATURE_CONFIG.THRESHOLDS;

    // Check with effectiveRate instead of topHalfRate
    if (totalMatches >= thresholds.BLAZING.minMatches && effectiveRate >= thresholds.BLAZING.minWinRate) {
        return thresholds.BLAZING;
    }
    if (totalMatches >= thresholds.HOT.minMatches && effectiveRate >= thresholds.HOT.minWinRate) {
        return thresholds.HOT;
    }
    if (totalMatches >= thresholds.WARM.minMatches && effectiveRate >= thresholds.WARM.minWinRate) {
        return thresholds.WARM;
    }
    
    if (totalMatches >= thresholds.FROZEN.minMatches && effectiveRate <= thresholds.FROZEN.maxWinRate) {
        return thresholds.FROZEN;
    }
    if (totalMatches >= thresholds.COLD.minMatches && effectiveRate <= thresholds.COLD.maxWinRate) {
        return thresholds.COLD;
    }
    if (totalMatches >= thresholds.COOL.minMatches && effectiveRate <= thresholds.COOL.maxWinRate) {
        return thresholds.COOL;
    }

    return thresholds.NEUTRAL;
}

/**
 * Optimized FFA ladder data loading with parallel fetching and caching
 */
async function loadLadderDataOptimizedFFA(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && playerCacheFFA.data && (now - playerCacheFFA.timestamp < CACHE_DURATION)) {
        console.log('Using cached FFA ladder data');
        const usernames = playerCacheFFA.data.map(p => p.username);
        const matchStatsBatch = await fetchBatchMatchStatsFFA(usernames);
        return { players: playerCacheFFA.data, matchStatsBatch };
    }

    const [playersSnapshot, profilesSnapshot] = await Promise.all([
        getDocs(collection(db, 'playersFFA')),
        getDocs(collection(db, 'userProfiles'))
    ]);

    const players = [];
    playersSnapshot.forEach((doc) => {
        const playerData = doc.data();
        if (playerData.username) {
            players.push({
                ...playerData,
                id: doc.id,
                elo: playerData.eloRating || 1000,
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

    // Match profiles to players
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
    const matchStatsBatch = await fetchBatchMatchStatsFFA(usernames);

    // Sort players by ELO (no tiers, just pure ELO ranking)
    players.sort((a, b) => {
        const aMatches = matchStatsBatch.get(a.username)?.totalMatches || 0;
        const bMatches = matchStatsBatch.get(b.username)?.totalMatches || 0;

        // Players with no matches go to bottom
        if ((aMatches === 0) !== (bMatches === 0)) {
            return aMatches === 0 ? 1 : -1;
        }

        // Sort by ELO descending
        return (b.elo || 0) - (a.elo || 0);
    });

    // Reassign positions
    players.forEach((player, index) => {
        player.position = index + 1;
    });

    playerCacheFFA.data = players;
    playerCacheFFA.timestamp = now;

    return { players, matchStatsBatch };
}

/**
 * Fetch batch match stats for FFA players
 */
async function fetchBatchMatchStatsFFA(usernames) {
    const matchStats = new Map();
    usernames.forEach(username => {
        matchStats.set(username, {
            totalMatches: 0, 
            wins: 0,
            top3: 0,
            avgPlacement: 0,
            totalKills: 0, 
            totalDeaths: 0, 
            kda: 0, 
            ffaPoints: 0,
            recentMatches: []
        });
    });

    try {
        const approvedMatchesRef = collection(db, 'approvedMatchesFFA');
        const allMatches = await getDocs(approvedMatchesRef);

        allMatches.forEach(doc => {
            const match = doc.data();
            // FIX: Handle both 'participants' and 'players' field names
            const participants = match.participants || match.players || [];
            const totalPlayers = participants.length;
            
            participants.forEach(participant => {
                const username = participant.username;
                if (usernames.includes(username)) {
                    const stats = matchStats.get(username);
                    stats.totalMatches++;
                    
                    const placement = participant.placement || participant.position;
                    if (placement === 1) stats.wins++;
                    if (placement <= 3) stats.top3++;
                    
                    stats.totalKills += parseInt(participant.kills) || 0;
                    stats.totalDeaths += parseInt(participant.deaths) || 0;
                    stats.ffaPoints += parseInt(participant.pointsEarned) || 0;
                    
                    // FIX: Include totalPlayers in recent matches for proper calculation
                    stats.recentMatches.push({
                        timestamp: match.approvedAt || match.timestamp,
                        placement: placement,
                        totalPlayers: totalPlayers,  // Use actual player count
                        kills: participant.kills || 0,
                        deaths: participant.deaths || 0
                    });
                }
            });
        });

        // Calculate derived stats
        matchStats.forEach((stats, username) => {
            if (stats.totalMatches > 0) {
                // Calculate average placement from recent matches
                if (stats.recentMatches.length > 0) {
                    const totalPlacements = stats.recentMatches.reduce((sum, m) => sum + (m.placement || 0), 0);
                    stats.avgPlacement = (totalPlacements / stats.recentMatches.length).toFixed(1);
                }
            }
            
            // Calculate K/D ratio
            stats.kda = stats.totalDeaths > 0 
                ? (stats.totalKills / stats.totalDeaths).toFixed(2) 
                : stats.totalKills.toFixed(2);
                
            // Sort recent matches by date for temperature calculation
            stats.recentMatches.sort((a, b) => {
                const dateA = a.timestamp?.toDate ? a.timestamp.toDate() : new Date(a.timestamp);
                const dateB = b.timestamp?.toDate ? b.timestamp.toDate() : new Date(b.timestamp);
                return dateB - dateA;
            });
        });

    } catch (error) {
        console.error('Error fetching FFA match stats:', error);
    }

    return matchStats;
}

/**
 * Main FFA ladder display function with progressive rendering
 */
async function displayLadderFFA(forceRefresh = false) {
    const tableBody = document.querySelector('#ladder-ffa tbody');
    if (!tableBody) {
        console.error('FFA Ladder table body not found');
        return;
    }

    tableBody.innerHTML = '<tr><td colspan="10" class="loading-cell">Loading FFA ladder data...</td></tr>';

    try {
        const { players, matchStatsBatch } = await loadLadderDataOptimizedFFA(forceRefresh);
        await updateLadderDisplayFFA(players, matchStatsBatch);
    } catch (error) {
        console.error("Error loading FFA ladder:", error);
        tableBody.innerHTML = `
            <tr>
                <td colspan="10" style="text-align: center; color: red;">
                    Error loading FFA ladder data: ${error.message}
                </td>
            </tr>
        `;
    }
}

/**
 * Progressive FFA ladder display with immediate basic rendering and background enhancements
 */
async function updateLadderDisplayFFA(ladderData, matchStatsBatch = null) {
    const tbody = document.querySelector('#ladder-ffa tbody');
    if (!tbody) {
        console.error('FFA Ladder table body not found');
        return;
    }

    const thead = document.querySelector('#ladder-ffa thead tr');
    if (thead && !thead.dataset.initialized) {
        thead.innerHTML = `
            <th style="text-align: center;">Rank</th>
            <th style="text-align: left;">Player</th>
            <th style="text-align: center;">ELO</th>
            <th style="text-align: center;">Matches</th>
            <th style="text-align: center;">Wins</th>
            <th style="text-align: center;">Top 3</th>
            <th style="text-align: center;">Avg Place</th>
            <th style="text-align: center;">K/D</th>
            <th style="text-align: center;">FFA Points</th>
        `;
        thead.dataset.initialized = 'true';
    }

    ladderData.sort((a, b) => a.position - b.position);

    if (!matchStatsBatch) {
        const usernames = ladderData.map(p => p.username);
        matchStatsBatch = await fetchBatchMatchStatsFFA(usernames);
    }

    const fragment = document.createDocumentFragment();
    
    ladderData.forEach(player => {
        const stats = matchStatsBatch.get(player.username) || {
            totalMatches: 0, wins: 0, top3: 0, avgPlacement: '-',
            totalKills: 0, totalDeaths: 0, kda: 0, ffaPoints: 0,
            recentMatches: []
        };

        const row = document.createElement('tr');
        row.innerHTML = createPlayerRowFFA(player, stats);
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
    
    // Load tokens and flags asynchronously
    loadTokensAsyncFFA(tbody, ladderData, matchStatsBatch, usernames);
    loadEloChangesAsyncFFA(tbody, usernames);
}


function createPlayerRowFFA(player, stats) {
    const elo = parseFloat(player.elo) || 1000;
    
    // Calculate temperature for username color
    const temperature = calculatePlayerTemperature(stats.recentMatches);
    const usernameColor = temperature.color;
    const temperatureEmoji = temperature.emoji;

    return `
        <td style="text-align: center;">${player.position}</td>
        <td style="position: relative; text-align: left;">
            <div style="display: flex; align-items: center;">
                <a href="profile.html?username=${encodeURIComponent(player.username)}&ladder=ffa" 
                   style="color: ${usernameColor}; text-decoration: none; font-weight: 600;"
                   title="${temperature.name} - Recent Performance">
                    ${player.username}
                </a>
                ${temperatureEmoji ? `<span style="margin-left: 4px;" title="${temperature.name}">${temperatureEmoji}</span>` : ''}
                <span class="flag-placeholder"></span>
                <span class="token-placeholder"></span>
            </div>
        </td>
        <td style="color: ${usernameColor}; text-align: center;">
            <div class="elo-container" style="display: flex; align-items: center; justify-content: center;">
                <span class="elo-value">${elo}</span>
                <span class="trend-indicator" style="margin-left: 5px;"></span>
            </div>
        </td>
        <td style="text-align: center;">${stats.totalMatches}</td>
        <td style="text-align: center;">${stats.wins}</td>
        <td style="text-align: center;">${stats.top3}</td>
        <td style="text-align: center;">${stats.avgPlacement || '-'}</td>
        <td style="text-align: center;">${stats.kda}</td>
        <td style="color: gray; ffont-weight: 300; text-align: center;">${stats.ffaPoints}</td>
    `;
}

/**
 * Load tokens asynchronously for FFA ladder
 */
async function loadTokensAsyncFFA(tbody, ladderData, matchStatsBatch, usernames) {
    try {
        const userTokensMap = await getTokensByUsernames(usernames);
        enhanceLadderWithTokensFFA(tbody, ladderData, matchStatsBatch, userTokensMap);
    } catch (error) {
        console.error('Error loading FFA tokens:', error);
    }
}

/**
 * Enhance existing FFA rows with tokens and flags
 */
function enhanceLadderWithTokensFFA(tbody, ladderData, matchStatsBatch, userTokensMap) {
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
            tokenPlaceholder.innerHTML = `
                <img src="${primaryToken.imageUrl}" 
                     alt="${primaryToken.name}"
                     title="${primaryToken.name}"
                     class="player-token"
                     style="width: 20px; height: 20px; margin-left: 5px; vertical-align: middle;"
                     onerror="this.style.display='none'">
            `;
        }
    });
}

/**
 * Load ELO changes asynchronously for FFA
 */
function loadEloChangesAsyncFFA(tbody, usernames) {
    getPlayersLastEloChangesFFA(usernames).then(eloChanges => {
        const rows = tbody.querySelectorAll('tr');
        
        rows.forEach((row, index) => {
            if (index >= usernames.length) return;
            
            const username = usernames[index];
            const change = eloChanges.get(username) || 0;
            const trendIndicator = row.querySelector('.trend-indicator');
            
            if (trendIndicator && change !== 0) {
                const color = change > 0 ? '#00FF00' : '#FF4444';
                const arrow = change > 0 ? '▲' : '▼';
                trendIndicator.innerHTML = `<span style="color: ${color}; font-size: 0.8em;">${arrow}${Math.abs(change)}</span>`;
            }
        });
    }).catch(error => {
        console.error('Error loading FFA ELO changes:', error);
    });
}

/**
 * Get players' last ELO changes for FFA
 */
async function getPlayersLastEloChangesFFA(usernames) {
    const changes = new Map();
    usernames.forEach(username => changes.set(username, 0));

    try {
        const eloHistoryRef = collection(db, 'eloHistoryFFA');
        const recentHistoryQuery = query(eloHistoryRef, orderBy('timestamp', 'desc'), limit(100));
        const snapshot = await getDocs(recentHistoryQuery);

        // Build a player ID to username mapping
        const playerIdToUsername = new Map();
        const playersQuery = await getDocs(collection(db, 'playersFFA'));
        playersQuery.forEach(doc => {
            const data = doc.data();
            if (data.username) {
                playerIdToUsername.set(doc.id, data.username);
            }
        });

        // Process entries by username
        const entriesByUsername = new Map();

        snapshot.forEach(doc => {
            const entry = doc.data();
            let username = null;
            
            if (entry.player && playerIdToUsername.has(entry.player)) {
                username = playerIdToUsername.get(entry.player);
            } else if (entry.username) {
                username = entry.username;
            }
            
            if (username && usernames.includes(username) && !entriesByUsername.has(username)) {
                entriesByUsername.set(username, entry);
            }
        });

        entriesByUsername.forEach((entry, username) => {
            const eloChange = (entry.newElo || 0) - (entry.previousElo || 0);
            changes.set(username, eloChange);
        });

    } catch (error) {
        console.error('Error fetching FFA ELO history:', error);
    }

    return changes;
}

// Add global refresh function
window.refreshLadderDisplayFFA = function(forceRefresh = true) {
    if (typeof displayLadderFFA === 'function') {
        displayLadderFFA(forceRefresh);
    } else {
        console.warn('displayLadderFFA function not available');
    }
};

// Export the FFA ladder functions
export { 
    displayLadderFFA, 
    fetchBatchMatchStatsFFA, 
    calculatePlayerTemperature,
    TEMPERATURE_CONFIG,
};