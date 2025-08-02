import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from './firebase-config.js';

const state = {
    currentGameMode: 'D1',
    cache: { D1: {}, D2: {}, D3: {} }
};

// Cache configuration
const CACHE_CONFIG = {
    EXPIRY_TIME: 5 * 60 * 1000, // 5 minutes in milliseconds
    MAX_CACHE_SIZE: 3, // Maximum number of game modes to cache
    STORAGE_KEY: 'rdl_stats_cache'
};

// Load cache from localStorage on startup
function loadCacheFromStorage() {
    try {
        const stored = localStorage.getItem(CACHE_CONFIG.STORAGE_KEY);
        if (stored) {
            const parsedCache = JSON.parse(stored);
            // Validate cache structure and merge with default
            for (const gameMode in parsedCache) {
                if (['D1', 'D2', 'D3'].includes(gameMode) && parsedCache[gameMode]) {
                    state.cache[gameMode] = parsedCache[gameMode];
                }
            }
            console.log('Cache loaded from localStorage');
        }
    } catch (error) {
        console.warn('Failed to load cache from storage:', error);
        // Clear corrupted cache
        localStorage.removeItem(CACHE_CONFIG.STORAGE_KEY);
    }
}

// Save cache to localStorage
function saveCacheToStorage() {
    try {
        localStorage.setItem(CACHE_CONFIG.STORAGE_KEY, JSON.stringify(state.cache));
    } catch (error) {
        console.warn('Failed to save cache to storage:', error);
        // Storage might be full, try to clear old entries
        try {
            localStorage.removeItem(CACHE_CONFIG.STORAGE_KEY);
            localStorage.setItem(CACHE_CONFIG.STORAGE_KEY, JSON.stringify(state.cache));
        } catch (retryError) {
            console.error('Cache storage failed completely:', retryError);
        }
    }
}

// Check if cache is valid (not expired)
function isCacheValid(cacheEntry) {
    if (!cacheEntry || !cacheEntry.timestamp) return false;
    const now = Date.now();
    return (now - cacheEntry.timestamp) < CACHE_CONFIG.EXPIRY_TIME;
}

// Clean expired cache entries
function cleanExpiredCache() {
    let cleaned = false;
    for (const gameMode in state.cache) {
        if (!isCacheValid(state.cache[gameMode])) {
            console.log(`Cleaning expired cache for ${gameMode}`);
            state.cache[gameMode] = {};
            cleaned = true;
        }
    }
    if (cleaned) {
        saveCacheToStorage();
    }
}

// Get cache status for UI feedback
function getCacheStatus(gameMode) {
    const cacheEntry = state.cache[gameMode];
    if (!cacheEntry || !cacheEntry.timestamp) {
        return { status: 'empty', message: 'No cached data' };
    }
    
    const age = Date.now() - cacheEntry.timestamp;
    const remaining = CACHE_CONFIG.EXPIRY_TIME - age;
    
    if (remaining <= 0) {
        return { status: 'expired', message: 'Cache expired' };
    }
    
    const minutesRemaining = Math.ceil(remaining / (60 * 1000));
    return { 
        status: 'valid', 
        message: `Cached data (expires in ${minutesRemaining}m)`,
        age: Math.floor(age / 1000)
    };
}

// Helper functions
function getPlayerTier(eloRating) {
    const elo = Number(eloRating) || 1200;
    if (elo >= 2000) return 'emerald';
    if (elo >= 1800) return 'gold';
    if (elo >= 1600) return 'silver';
    if (elo >= 1400) return 'bronze';
    return 'default';
}

function getPlayerElo(username, currentMode) {
    // Try to get ELO from cache first
    const cachedData = state.cache[currentMode];
    if (cachedData && cachedData.playerData) {
        const playerData = cachedData.playerData.find(player => player.username === username);
        if (playerData) {
            return playerData.eloRating || playerData.elo || 1200;
        }
    }
    return 1200; // Default ELO
}

function updateRecordRow(elementId, recordData, unit = '', formatSign = false) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    const tier = getPlayerTier(recordData.elo);
    let displayValue = recordData.value;
    if (formatSign && recordData.value > 0) displayValue = `+${recordData.value}`;
    
    // Create clickable profile link
    element.innerHTML = `<a href="profile.html?username=${encodeURIComponent(recordData.username)}" class="player-link tier-${tier}">${recordData.username}</a>`;
    element.nextElementSibling.textContent = `${displayValue}${unit}`;
    element.classList.remove('loading');
}

// Initialize subgame stats structure
function initializeSubgameStats(currentMode) {
    return {
        totalCounts: new Map(),
        playerPerformance: new Map()
    };
}

function processData(playerSnapshot, matchSnapshot) {
    const playerStats = new Map();
    const playerMatchesMap = new Map();
    const mapStats = new Map();
    const subgameStats = initializeSubgameStats(state.currentGameMode);

    // Pre-allocate player data structures
    playerSnapshot.forEach(playerDoc => {
        const player = playerDoc.data();
        if (player.username) {
            playerMatchesMap.set(player.username, { wins: [], losses: [] });
            playerStats.set(player.username, {
                wins: 0, losses: 0, totalMatches: 0, 
                totalKills: 0, totalDeaths: 0, totalSuicides: 0, 
                scoreDifferential: 0,
                eloRating: player.eloRating || player.elo || 1200,
                position: player.position || player.rank || 999
            });
        }
    });

    // Process matches in a single pass
    matchSnapshot.forEach(matchDoc => {
        const match = matchDoc.data();
        
        const winnerUsername = match.winnerUsername || match.winner || match.player1;
        const loserUsername = match.loserUsername || match.loser || match.player2;
        
        if (!winnerUsername || !loserUsername) return;

        // Track maps
        const map = match.mapPlayed || match.map || match.level || 'Unknown';
        mapStats.set(map, (mapStats.get(map) || 0) + 1);

        // Track subgames
        const rawSubgameType = match.subgameType || match.gameType || match.type;
        const displaySubgameType = rawSubgameType === "" || rawSubgameType === undefined || rawSubgameType === null 
            ? "Standard Match" 
            : rawSubgameType;
        
        subgameStats.totalCounts.set(
            displaySubgameType, 
            (subgameStats.totalCounts.get(displaySubgameType) || 0) + 1
        );

        // Initialize player performance tracking for this subgame if needed
        if (!subgameStats.playerPerformance.has(displaySubgameType)) {
            subgameStats.playerPerformance.set(displaySubgameType, new Map());
        }
        
        const subgamePerf = subgameStats.playerPerformance.get(displaySubgameType);
        
        if (!subgamePerf.has(winnerUsername)) {
            subgamePerf.set(winnerUsername, { wins: 0, matches: 0 });
        }
        if (!subgamePerf.has(loserUsername)) {
            subgamePerf.set(loserUsername, { wins: 0, matches: 0 });
        }
        
        subgamePerf.get(winnerUsername).wins++;
        subgamePerf.get(winnerUsername).matches++;
        subgamePerf.get(loserUsername).matches++;

        // Track player matches if players exist
        const winnerMatches = playerMatchesMap.get(winnerUsername);
        const loserMatches = playerMatchesMap.get(loserUsername);
        
        if (winnerMatches) winnerMatches.wins.push(match);
        if (loserMatches) loserMatches.losses.push(match);
    });

    // Calculate player stats efficiently
    for (const [username, playerMatches] of playerMatchesMap) {
        const stats = playerStats.get(username);
        if (!stats) continue;

        const wins = playerMatches.wins.length;
        const losses = playerMatches.losses.length;
        const totalMatches = wins + losses;

        if (totalMatches === 0) continue;

        let totalKills = 0, totalDeaths = 0, totalSuicides = 0, scoreDifferential = 0;

        // Process wins
        for (const match of playerMatches.wins) {
            const winnerScore = parseInt(match.winnerScore || match.score1 || match.winnerKills || 0) || 0;
            const loserScore = parseInt(match.loserScore || match.score2 || match.loserKills || 0) || 0;
            const suicides = parseInt(match.winnerSuicides || match.suicides1 || 0) || 0;
            
            totalKills += winnerScore;
            totalDeaths += loserScore;
            totalSuicides += suicides;
            scoreDifferential += (winnerScore - loserScore);
        }

        // Process losses
        for (const match of playerMatches.losses) {
            const winnerScore = parseInt(match.winnerScore || match.score1 || match.winnerKills || 0) || 0;
            const loserScore = parseInt(match.loserScore || match.score2 || match.loserKills || 0) || 0;
            const suicides = parseInt(match.loserSuicides || match.suicides2 || 0) || 0;
            
            totalKills += loserScore;
            totalDeaths += winnerScore;
            totalSuicides += suicides;
            scoreDifferential -= (winnerScore - loserScore);
        }

        // Calculate derived stats
        const kdRatio = totalDeaths > 0 ? parseFloat((totalKills / totalDeaths).toFixed(2)) : totalKills;
        const winRate = parseFloat(((wins / totalMatches) * 100).toFixed(1));

        // Update stats object
        Object.assign(stats, {
            wins, losses, totalMatches, kdRatio, winRate,
            totalKills, totalDeaths, totalSuicides, scoreDifferential
        });
    }

    return { playerStats, subgameStats, mapStats };
}

// Enhanced data loading function with caching
async function loadStats(forceRefresh = false) {
    const currentMode = state.currentGameMode;
    
    // Clean expired cache entries
    cleanExpiredCache();
    
    // Check if we have valid cached data and not forcing refresh
    if (!forceRefresh && isCacheValid(state.cache[currentMode])) {
        console.log(`Using cached data for ${currentMode}`);
        const cachedData = state.cache[currentMode];
        
        // Show cache status in header
        const cacheStatus = getCacheStatus(currentMode);
        updateCacheStatusDisplay(cacheStatus);
        
        // Restore Maps from cached data
        const restoredPlayerStats = new Map();
        const restoredMapStats = new Map();
        const restoredSubgameStats = {
            totalCounts: new Map(),
            playerPerformance: new Map()
        };

        // Restore playerStats Map
        if (cachedData.playerStats) {
            Object.entries(cachedData.playerStats).forEach(([key, value]) => {
                restoredPlayerStats.set(key, value);
            });
        }

        // Restore mapStats Map
        if (cachedData.mapStats) {
            Object.entries(cachedData.mapStats).forEach(([key, value]) => {
                restoredMapStats.set(key, value);
            });
        }

        // Restore subgameStats Maps
        if (cachedData.subgameStats) {
            if (cachedData.subgameStats.totalCounts) {
                Object.entries(cachedData.subgameStats.totalCounts).forEach(([key, value]) => {
                    restoredSubgameStats.totalCounts.set(key, value);
                });
            }

            if (cachedData.subgameStats.playerPerformance) {
                Object.entries(cachedData.subgameStats.playerPerformance).forEach(([subgameType, playerMap]) => {
                    const restoredPlayerMap = new Map();
                    if (playerMap && typeof playerMap === 'object') {
                        Object.entries(playerMap).forEach(([username, stats]) => {
                            restoredPlayerMap.set(username, stats);
                        });
                    }
                    restoredSubgameStats.playerPerformance.set(subgameType, restoredPlayerMap);
                });
            }
        }

        // Create mock snapshot objects for compatibility
        const mockPlayerSnapshot = {
            size: cachedData.recordCount?.players || 0,
            forEach: (callback) => {
                if (cachedData.playerData && Array.isArray(cachedData.playerData)) {
                    cachedData.playerData.forEach(playerData => {
                        callback({
                            data: () => playerData
                        });
                    });
                }
            }
        };

        const mockMatchSnapshot = {
            size: cachedData.recordCount?.matches || 0
        };

        // Update displays with restored cached data
        updatePlayerRecords(restoredPlayerStats);
        updateTopPlayers(mockPlayerSnapshot);
        updateMapStats(restoredMapStats);
        updateSubgameStats(restoredSubgameStats, currentMode);
        updateTopPointEarners(currentMode); // Add this line
        updateSummary(mockPlayerSnapshot, mockMatchSnapshot);
        
        return;
    }
    
    let playersCollection, matchesCollection;
    
    // Set collection names based on game mode
    switch(currentMode) {
        case 'D1':
            playersCollection = 'players';
            matchesCollection = 'approvedMatches';
            break;
        case 'D2':
            playersCollection = 'playersD2';
            matchesCollection = 'approvedMatchesD2';
            break;
        case 'D3':
            playersCollection = 'playersD3';
            matchesCollection = 'approvedMatchesD3';
            break;
        default:
            playersCollection = 'players';
            matchesCollection = 'approvedMatches';
    }

    try {
        console.log(`Loading ${currentMode} statistics from Firebase...`);
        
        // Show loading states
        showLoadingStates();
        updateCacheStatusDisplay({ status: 'loading', message: 'Loading from Firebase...' });
        
        // Fetch all data
        const [playerSnapshot, matchSnapshot] = await Promise.all([
            getDocs(collection(db, playersCollection)),
            getDocs(collection(db, matchesCollection))
        ]);

        console.log(`Loaded ${playerSnapshot.size} players, ${matchSnapshot.size} matches`);

        // Check if we have any data
        if (playerSnapshot.size === 0 && matchSnapshot.size === 0) {
            showNoDataState();
            return;
        }

        // Process data
        const { playerStats, subgameStats, mapStats } = processData(playerSnapshot, matchSnapshot);

        // Extract player data for caching
        const playerData = [];
        playerSnapshot.forEach(doc => {
            playerData.push(doc.data());
        });

        // Store in cache with timestamp
        const cacheEntry = {
            playerStats: Object.fromEntries(playerStats),
            subgameStats: {
                totalCounts: Object.fromEntries(subgameStats.totalCounts),
                playerPerformance: Object.fromEntries(
                    Array.from(subgameStats.playerPerformance.entries()).map(([key, value]) => [
                        key, 
                        Object.fromEntries(value)
                    ])
                )
            },
            mapStats: Object.fromEntries(mapStats),
            playerData: playerData,
            timestamp: Date.now(),
            recordCount: {
                players: playerSnapshot.size,
                matches: matchSnapshot.size
            }
        };
        
        state.cache[currentMode] = cacheEntry;
        
        // Save to localStorage
        saveCacheToStorage();
        
        // Update cache status display
        const cacheStatus = getCacheStatus(currentMode);
        updateCacheStatusDisplay(cacheStatus);

        // Update displays
        updatePlayerRecords(playerStats);
        updateTopPlayers(playerSnapshot);
        updateMapStats(mapStats);
        updateSubgameStats(subgameStats, currentMode);
        updateTopPointEarners(currentMode); // Add this line
        updateSummary(playerSnapshot, matchSnapshot);

        console.log(`${currentMode} data cached successfully`);

    } catch (error) {
        console.error('Error loading stats:', error);
        showErrorState();
        updateCacheStatusDisplay({ status: 'error', message: 'Error loading data' });
    }
}

function updatePlayerRecords(playerStats) {
    if (playerStats.size === 0) {
        const recordElements = [
            'most-wins', 'best-winrate', 'best-kd', 'most-matches',
            'best-differential', 'most-kills', 'best-elo', 'least-suicides'
        ];
        
        recordElements.forEach(elementId => {
            const element = document.getElementById(elementId);
            if (element) {
                element.textContent = 'No data';
                element.classList.remove('loading');
                if (element.nextElementSibling) {
                    element.nextElementSibling.textContent = '-';
                }
            }
        });
        return;
    }

    const MIN_MATCHES = 10;
    
    const records = {
        mostWins: { username: 'N/A', value: 0, elo: 0 },
        bestWinRate: { username: 'N/A', value: 0, elo: 0 },
        bestKD: { username: 'N/A', value: 0, elo: 0 },
        mostMatches: { username: 'N/A', value: 0, elo: 0 },
        bestDiff: { username: 'N/A', value: -Infinity, elo: 0 },
        mostKills: { username: 'N/A', value: 0, elo: 0 },
        bestElo: { username: 'N/A', value: 0, elo: 0 },
        leastSuicides: { username: 'N/A', value: Infinity, elo: 0 }
    };

    for (const [username, stats] of playerStats) {
        const elo = stats.eloRating;
        const hasMinMatches = stats.totalMatches >= MIN_MATCHES;

        if (stats.wins > records.mostWins.value) {
            records.mostWins = { username, value: stats.wins, elo };
        }

        if (stats.totalMatches > records.mostMatches.value) {
            records.mostMatches = { username, value: stats.totalMatches, elo };
        }

        if (stats.totalKills > records.mostKills.value) {
            records.mostKills = { username, value: stats.totalKills, elo };
        }

        if (stats.eloRating > records.bestElo.value) {
            records.bestElo = { username, value: Math.round(stats.eloRating), elo };
        }

        if (hasMinMatches) {
            if (stats.winRate > records.bestWinRate.value) {
                records.bestWinRate = { username, value: stats.winRate, elo };
            }

            if (stats.kdRatio > records.bestKD.value) {
                records.bestKD = { username, value: stats.kdRatio, elo };
            }

            if (stats.scoreDifferential > records.bestDiff.value) {
                records.bestDiff = { username, value: stats.scoreDifferential, elo };
            }

            // Fix suicide calculation - show average suicides per match, not percentage
            const avgSuicides = stats.totalSuicides / stats.totalMatches;
            if (avgSuicides < records.leastSuicides.value) {
                records.leastSuicides = { 
                    username, 
                    value: avgSuicides.toFixed(2), // Average suicides per match
                    elo
                };
            }
        }
    }

    const updateRecordOrNoData = (elementId, record, unit = '', formatSign = false) => {
        const element = document.getElementById(elementId);
        if (!element) return;

        if (record.username === 'N/A' || (record.value === 0 && elementId !== 'best-elo') || 
            record.value === -Infinity || record.value === Infinity) {
            element.textContent = 'No data';
            element.classList.remove('loading');
            if (element.nextElementSibling) {
                element.nextElementSibling.textContent = '-';
            }
        } else {
            updateRecordRow(elementId, record, unit, formatSign);
        }
    };

    updateRecordOrNoData('most-wins', records.mostWins);
    updateRecordOrNoData('best-winrate', records.bestWinRate, '%');
    updateRecordOrNoData('best-kd', records.bestKD);
    updateRecordOrNoData('most-matches', records.mostMatches);
    updateRecordOrNoData('best-differential', records.bestDiff, '', true);
    updateRecordOrNoData('most-kills', records.mostKills);
    updateRecordOrNoData('best-elo', records.bestElo);
    updateRecordOrNoData('least-suicides', records.leastSuicides, ' avg'); // Changed from '%' to ' avg'
}

function updateTopPlayers(playerSnapshot) {
    const tiers = {
        emerald: { min: 2000, players: [] },
        gold: { min: 1800, players: [] },
        silver: { min: 1600, players: [] },
        bronze: { min: 1400, players: [] }
    };

    if (playerSnapshot && playerSnapshot.forEach) {
        playerSnapshot.forEach(doc => {
            const player = doc.data();
            if (!player.username) return;
            
            const elo = player.eloRating || player.elo || 1200;
            const position = player.position || player.rank || 999;
            
            const playerData = { username: player.username, elo, position };

            if (elo >= tiers.emerald.min) tiers.emerald.players.push(playerData);
            else if (elo >= tiers.gold.min) tiers.gold.players.push(playerData);
            else if (elo >= tiers.silver.min) tiers.silver.players.push(playerData);
            else if (elo >= tiers.bronze.min) tiers.bronze.players.push(playerData);
        });
    }

    const tbody = document.getElementById('tier-table');
    let html = '';

    for (const [tierName, tierData] of Object.entries(tiers)) {
        if (tierData.players.length > 0) {
            tierData.players.sort((a, b) => {
                if (a.position !== b.position) return a.position - b.position;
                return b.elo - a.elo;
            });

            const topPlayer = tierData.players[0];
            const displayRank = topPlayer.position < 999 ? topPlayer.position : 1;
            
            html += `
                <tr>
                    <td>${tierName.charAt(0).toUpperCase() + tierName.slice(1)}</td>
                    <td>
                        <a href="profile.html?username=${encodeURIComponent(topPlayer.username)}" 
                           class="player-link tier-${tierName}">
                            ${topPlayer.username}
                        </a>
                    </td>
                    <td>${Math.round(topPlayer.elo)}</td>
                    <td>#${displayRank}</td>
                </tr>
            `;
        }
    }

    tbody.innerHTML = html || '<tr><td colspan="4">No ranked players found</td></tr>';
}

function updateMapStats(mapStats) {
    const tbody = document.querySelector('#maps-table tbody');
    
    if (mapStats.size === 0) {
        tbody.innerHTML = '<tr><td colspan="4">No map data available</td></tr>';
        return;
    }

    const totalMatches = Array.from(mapStats.values()).reduce((sum, count) => sum + count, 0);
    const sortedMaps = Array.from(mapStats.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    let html = '';
    sortedMaps.forEach(([map, count], index) => {
        const percentage = ((count / totalMatches) * 100).toFixed(1);
        html += `
            <tr>
                <td>${index + 1}</td>
                <td>${map}</td>
                <td>${count}</td>
                <td>${percentage}%</td>
            </tr>
        `;
    });

    tbody.innerHTML = html || '<tr><td colspan="4">No map data found</td></tr>';
}

function updateSubgameStats(subgameStats, currentMode) {
    const tbody = document.querySelector('#subgame-table tbody');
    
    if (!subgameStats.totalCounts || subgameStats.totalCounts.size === 0) {
        tbody.innerHTML = '<tr><td colspan="4">No subgame data available</td></tr>';
        return;
    }

    const totalMatches = Array.from(subgameStats.totalCounts.values()).reduce((sum, count) => sum + count, 0);
    const sortedSubgames = Array.from(subgameStats.totalCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    let html = '';
    sortedSubgames.forEach(([subgame, count], index) => {
        const percentage = ((count / totalMatches) * 100).toFixed(1);
        
        // Find champion for this subgame
        let championInfo = '';
        const subgamePerf = subgameStats.playerPerformance.get(subgame);
        if (subgamePerf) {
            let bestPlayer = null;
            let bestWinRate = 0;
            
            for (const [username, stats] of subgamePerf.entries()) {
                if (stats.matches >= 3) {
                    const winRate = (stats.wins / stats.matches) * 100;
                    if (winRate > bestWinRate) {
                        bestWinRate = winRate;
                        bestPlayer = {
                            username,
                            winRate: winRate.toFixed(1),
                            wins: stats.wins,
                            matches: stats.matches
                        };
                    }
                }
            }
            
            if (bestPlayer) {
                const elo = getPlayerElo(bestPlayer.username, currentMode);
                const tier = getPlayerTier(elo);
                championInfo = `<a href="profile.html?username=${encodeURIComponent(bestPlayer.username)}" 
                               class="player-link tier-${tier}">${bestPlayer.username}</a> 
                               (${bestPlayer.wins}/${bestPlayer.matches}, ${bestPlayer.winRate}%)`;
            } else {
                championInfo = 'No champion (min 3 matches)';
            }
        }
        
        html += `
            <tr>
                <td>${index + 1}</td>
                <td>${subgame}</td>
                <td>${count} (${percentage}%)</td>
                <td>${championInfo}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html || '<tr><td colspan="4">No subgame data found</td></tr>';
}

// Add this function after updateSubgameStats
async function updateTopPointEarners(currentMode) {
    const tbody = document.querySelector('#points-table tbody');
    
    try {
        // Determine collection name based on game mode
        let profilesCollection;
        switch(currentMode) {
            case 'D1':
                profilesCollection = 'userProfiles';
                break;
            case 'D2':
                profilesCollection = 'userProfilesD2';
                break;
            case 'D3':
                profilesCollection = 'userProfilesD3';
                break;
            default:
                profilesCollection = 'userProfiles';
        }

        const profilesSnapshot = await getDocs(collection(db, profilesCollection));
        
        if (profilesSnapshot.size === 0) {
            tbody.innerHTML = '<tr><td colspan="3">No point data available</td></tr>';
            return;
        }

        const pointsData = [];
        profilesSnapshot.forEach(doc => {
            const profile = doc.data();
            const points = parseInt(profile.points) || 0;
            if (profile.username && points > 0) {
                pointsData.push({
                    username: profile.username,
                    points: points,
                    elo: profile.eloRating || profile.elo || 1200
                });
            }
        });

        if (pointsData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3">No players with points found</td></tr>';
            return;
        }

        // Sort by points (descending) and take top 10
        pointsData.sort((a, b) => b.points - a.points);
        const top10 = pointsData.slice(0, 10);

        let html = '';
        top10.forEach((player, index) => {
            const tier = getPlayerTier(player.elo);
            html += `
                <tr>
                    <td>${index + 1}</td>
                    <td>
                        <a href="profile.html?username=${encodeURIComponent(player.username)}" 
                           class="player-link tier-${tier}">
                            ${player.username}
                        </a>
                    </td>
                    <td>${player.points.toLocaleString()}</td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
        console.log(`Top point earners updated: ${top10.length} players`);

    } catch (error) {
        console.error('Error loading point earners:', error);
        tbody.innerHTML = '<tr><td colspan="3">Error loading point data</td></tr>';
    }
}

function updateSummary(playerSnapshot, matchSnapshot) {
    document.getElementById('total-matches').textContent = matchSnapshot.size;
    document.getElementById('total-players').textContent = playerSnapshot.size;
    document.getElementById('last-updated').textContent = new Date().toLocaleDateString();
}

// UI state management functions
function showLoadingStates() {
    const recordElements = ['most-wins', 'best-winrate', 'best-kd', 'most-matches', 'best-differential', 'most-kills', 'best-elo', 'least-suicides'];
    recordElements.forEach(elementId => {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = 'Loading...';
            element.classList.add('loading');
            if (element.nextElementSibling) {
                element.nextElementSibling.textContent = '';
            }
        }
    });
    
    const tierTable = document.getElementById('tier-table');
    if (tierTable) tierTable.innerHTML = '<tr><td colspan="4" class="loading">Loading players...</td></tr>';
    
    const mapsTableBody = document.querySelector('#maps-table tbody');
    if (mapsTableBody) mapsTableBody.innerHTML = '<tr><td colspan="4" class="loading">Loading maps...</td></tr>';
    
    const subgameTableBody = document.querySelector('#subgame-table tbody');
    if (subgameTableBody) subgameTableBody.innerHTML = '<tr><td colspan="4" class="loading">Loading subgames...</td></tr>';
    
    const pointsTableBody = document.querySelector('#points-table tbody');
    if (pointsTableBody) pointsTableBody.innerHTML = '<tr><td colspan="3" class="loading">Loading points...</td></tr>';
}

function showNoDataState() {
    const recordElements = ['most-wins', 'best-winrate', 'best-kd', 'most-matches', 'best-differential', 'most-kills', 'best-elo', 'least-suicides'];
    recordElements.forEach(elementId => {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = 'No data';
            element.classList.remove('loading');
            if (element.nextElementSibling) {
                element.nextElementSibling.textContent = '-';
            }
        }
    });
    
    const tierTable = document.getElementById('tier-table');
    const mapsTableBody = document.querySelector('#maps-table tbody');
    const subgameTableBody = document.querySelector('#subgame-table tbody');
    const pointsTableBody = document.querySelector('#points-table tbody');
    
    if (tierTable) tierTable.innerHTML = '<tr><td colspan="4">No data available</td></tr>';
    if (mapsTableBody) mapsTableBody.innerHTML = '<tr><td colspan="4">No data available</td></tr>';
    if (subgameTableBody) subgameTableBody.innerHTML = '<tr><td colspan="4">No data available</td></tr>';
    if (pointsTableBody) pointsTableBody.innerHTML = '<tr><td colspan="3">No data available</td></tr>';
    
    updateSummary({ size: 0 }, { size: 0 });
}

function showErrorState() {
    const recordElements = ['most-wins', 'best-winrate', 'best-kd', 'most-matches', 'best-differential', 'most-kills', 'best-elo', 'least-suicides'];
    recordElements.forEach(elementId => {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = 'Error';
            element.classList.remove('loading');
            if (element.nextElementSibling) {
                element.nextElementSibling.textContent = 'Error loading data';
            }
        }
    });
    
    const tierTable = document.getElementById('tier-table');
    const mapsTableBody = document.querySelector('#maps-table tbody');
    const subgameTableBody = document.querySelector('#subgame-table tbody');
    const pointsTableBody = document.querySelector('#points-table tbody');
    
    if (tierTable) tierTable.innerHTML = '<tr><td colspan="4">Error loading data</td></tr>';
    if (mapsTableBody) mapsTableBody.innerHTML = '<tr><td colspan="4">Error loading data</td></tr>';
    if (subgameTableBody) subgameTableBody.innerHTML = '<tr><td colspan="4">Error loading data</td></tr>';
    if (pointsTableBody) pointsTableBody.innerHTML = '<tr><td colspan="3">Error loading data</td></tr>';
}

function updateCacheStatusDisplay(cacheStatus) {
    let statusElement = document.getElementById('cache-status');
    if (!statusElement) {
        statusElement = document.createElement('div');
        statusElement.id = 'cache-status';
        statusElement.style.cssText = `
            font-size: 12px; 
            color: #ccc; 
            margin-top: 5px; 
            text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
        `;
        
        const summaryElement = document.querySelector('.summary');
        if (summaryElement) {
            summaryElement.appendChild(statusElement);
        }
    }
    
    let statusColor = '#ccc';
    switch(cacheStatus.status) {
        case 'valid': statusColor = '#50C878'; break;
        case 'expired': statusColor = '#FFD700'; break;
        case 'error': statusColor = '#FF6B6B'; break;
        case 'loading': statusColor = '#87CEEB'; break;
    }
    
    statusElement.style.color = statusColor;
    statusElement.textContent = cacheStatus.message;
}

function setupGameModeToggle() {
    document.querySelectorAll('.toggle-btn').forEach(button => {
        button.addEventListener('click', function() {
            if (this.classList.contains('active')) return;

            document.querySelectorAll('.toggle-btn').forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');

            state.currentGameMode = this.getAttribute('data-game').toUpperCase();
            loadStats();
        });
    });
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadCacheFromStorage();
    setupGameModeToggle();
    loadStats();
    setInterval(cleanExpiredCache, 30000);
});

// Export cache management functions for debugging
window.rdlCache = {
    clear: () => {
        state.cache = { D1: {}, D2: {}, D3: {} };
        localStorage.removeItem(CACHE_CONFIG.STORAGE_KEY);
        console.log('Cache cleared');
    },
    status: () => {
        console.log('Cache status:', {
            D1: getCacheStatus('D1'),
            D2: getCacheStatus('D2'),
            D3: getCacheStatus('D3')
        });
    }
};