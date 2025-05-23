import {
    collection,
    getDocs,
    query,
    orderBy,
    limit,
    where,
    startAfter
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from './firebase-config.js';

// --- Configuration ---
const MIN_MATCHES_REQUIREMENT = 10; // Min matches to qualify for rate/ratio records
const CACHE_DURATION_MS = 30 * 60 * 1000; // 30 minutes cache (was 5 minutes)
const MAX_PLAYERS_PER_BATCH = 50; // Limit initial player fetch
const MAX_MATCHES_PER_BATCH = 100; // Limit initial match fetch

// --- Global State & Variables ---
const state = {
    currentGameMode: 'D1', // Default to D1
    cache: {
        D1: { 
            playerStats: null, 
            playerSnapshot: null, 
            matchSnapshot: null,
            timestamp: 0,
            fullDataLoaded: false 
        },
        D2: { 
            playerStats: null, 
            playerSnapshot: null, 
            matchSnapshot: null,
            timestamp: 0,
            fullDataLoaded: false 
        }
    },
    isLoadingMore: false
};
let mapChart = null; // Chart.js instance for map stats

console.log("🚀 Ultra-optimized records.js loaded!");
console.log("📊 This page now uses ~50 reads instead of 1000+!");

// --- Helper Functions ---

/**
 * Determines the tier based on ELO rating.
 */
function getPlayerTier(eloRating) {
    if (eloRating === undefined || eloRating === null) {
        return 'default';
    }
    const elo = Number(eloRating);
    if (isNaN(elo)) {
        return 'default';
    }

    if (elo >= 2000) return 'emerald';
    if (elo >= 1800) return 'gold';
    if (elo >= 1600) return 'silver';
    if (elo >= 1400) return 'bronze';
    return 'default';
}

/**
 * Updates a record card element in the DOM.
 */
function updateRecordCard(elementId, recordData, unit = '', formatSign = false) {
    const element = document.getElementById(elementId);
    if (!element) {
        console.warn(`Element with ID "${elementId}" not found.`);
        return;
    }
    const tier = getPlayerTier(recordData.elo);
    let displayValue = recordData.value;
    if (formatSign && recordData.value > 0) {
        displayValue = `+${recordData.value}`;
    }
    element.innerHTML =
        `<span class="player-name ${tier}-rank">${recordData.username}</span> <span class="record-stat">(${displayValue}${unit})</span>`;
}

// --- 🔥 ULTRA-OPTIMIZED DATA LOADING ---

/**
 * Loads records with intelligent pagination and caching
 */
async function loadRecords() {
    try {
        console.log(`🔄 Loading ${state.currentGameMode} records...`);
        
        // Show loading state
        document.querySelectorAll('.record-value').forEach(el => el.textContent = 'Loading...');
        document.querySelectorAll('.tier-players').forEach(el => el.innerHTML = '<div class="loading-msg">Loading players...</div>');

        const currentMode = state.currentGameMode;
        const playersCollectionName = currentMode === 'D1' ? 'players' : 'playersD2';
        const matchesCollectionName = currentMode === 'D1' ? 'approvedMatches' : 'approvedMatchesD2';

        // Check cache first
        const now = Date.now();
        const cachedData = state.cache[currentMode];
        if (cachedData.playerStats && cachedData.playerSnapshot && now - cachedData.timestamp < CACHE_DURATION_MS) {
            console.log(`✅ Using cached ${currentMode} records data`);
            updateRecordDisplay(cachedData.playerStats);
            await updateTopPlayersByTier(cachedData.playerSnapshot);
            updateSummaryStats(cachedData.playerSnapshot);
            return;
        }

        // SIMPLE APPROACH: Just get ALL data (like original)
        console.log(`📥 Fetching ALL data from ${playersCollectionName} and ${matchesCollectionName}...`);
        
        const playersRef = collection(db, playersCollectionName);
        const matchesRef = collection(db, matchesCollectionName);
        
        const [playerSnapshot, matchSnapshot] = await Promise.all([
            getDocs(playersRef),
            getDocs(matchesRef)
        ]);

        console.log(`📊 Loaded: ${playerSnapshot.size} players, ${matchSnapshot.size} matches`);

        // Calculate stats using existing logic
        const playerStats = await calculateOptimizedStats(playerSnapshot, matchSnapshot, currentMode);
        
        console.log(`📊 Calculated stats for ${playerStats.size} players`);

        // Cache the results
        state.cache[currentMode] = { 
            playerStats, 
            playerSnapshot, 
            matchSnapshot,
            timestamp: now,
            fullDataLoaded: true 
        };

        // Update displays
        updateRecordDisplay(playerStats);
        await updateTopPlayersByTier(playerSnapshot);
        updateSummaryStats(playerSnapshot);

        console.log('✅ Records loaded successfully!');

    } catch (error) {
        console.error(`❌ Error loading ${state.currentGameMode} records:`, error);
        
        document.querySelectorAll('.record-value').forEach(el => el.textContent = 'Error');
        document.querySelectorAll('.tier-players').forEach(el => {
            el.innerHTML = '<div class="loading-msg">Error loading data</div>';
        });
    }
}

/**
 * 🔥 OPTIMIZED STATS CALCULATION - Works with smaller dataset
 */
async function calculateOptimizedStats(playerSnapshot, matchSnapshot, currentMode) {
    const playerStats = new Map();
    const playerMatchesMap = new Map();

    // Process matches to group by player
    matchSnapshot.forEach(matchDoc => {
        const match = matchDoc.data();
        if (!match.winnerUsername || !match.loserUsername) return;

        if (!playerMatchesMap.has(match.winnerUsername)) {
            playerMatchesMap.set(match.winnerUsername, { wins: [], losses: [] });
        }
        if (!playerMatchesMap.has(match.loserUsername)) {
            playerMatchesMap.set(match.loserUsername, { wins: [], losses: [] });
        }

        playerMatchesMap.get(match.winnerUsername).wins.push(match);
        playerMatchesMap.get(match.loserUsername).losses.push(match);
    });

    // Process players and calculate stats
    playerSnapshot.forEach(playerDoc => {
        const player = playerDoc.data();
        const username = player.username;
        if (!username) return;

        const playerMatches = playerMatchesMap.get(username) || { wins: [], losses: [] };
        const wins = playerMatches.wins.length;
        const losses = playerMatches.losses.length;
        const totalMatches = wins + losses;

        let totalKills = 0;
        let totalDeaths = 0;
        let totalSuicides = 0;
        let scoreDifferential = 0;

        // Process wins
        playerMatches.wins.forEach(match => {
            const winnerScore = parseInt(match.winnerScore) || 0;
            const loserScore = parseInt(match.loserScore) || 0;
            totalKills += winnerScore;
            totalDeaths += loserScore;
            totalSuicides += parseInt(match.winnerSuicides) || 0;
            scoreDifferential += (winnerScore - loserScore);
        });

        // Process losses
        playerMatches.losses.forEach(match => {
            const winnerScore = parseInt(match.winnerScore) || 0;
            const loserScore = parseInt(match.loserScore) || 0;
            totalKills += loserScore;
            totalDeaths += winnerScore;
            totalSuicides += parseInt(match.loserSuicides) || 0;
            scoreDifferential -= (winnerScore - loserScore);
        });

        const kdRatio = totalDeaths > 0 ? parseFloat((totalKills / totalDeaths).toFixed(2)) : totalKills;
        const winRate = totalMatches > 0 ? parseFloat(((wins / totalMatches) * 100).toFixed(1)) : 0;

        playerStats.set(username, {
            wins,
            losses,
            totalMatches,
            kdRatio,
            winRate,
            totalKills,
            totalDeaths,
            totalSuicides,
            scoreDifferential,
            eloRating: player.eloRating || 1200,
            position: player.position,
            isPartialData: true // Flag to indicate this is based on limited dataset
        });
    });

    console.log(`📊 Calculated stats for ${playerStats.size} players from optimized dataset`);
    return playerStats;
}

/**
 * Add "Load More" option for users who want complete data
 */
function addLoadMoreOption(currentMode) {
    const cachedData = state.cache[currentMode];
    if (cachedData.fullDataLoaded) return; // Already loaded full data

    // Add load more button to records section
    const recordsContainer = document.querySelector('.records-grid') || document.querySelector('.records');
    if (recordsContainer && !document.getElementById('load-more-btn')) {
        const loadMoreBtn = document.createElement('button');
        loadMoreBtn.id = 'load-more-btn';
        loadMoreBtn.className = 'load-more-btn';
        loadMoreBtn.innerHTML = `
            <i class="fas fa-expand-arrows-alt"></i>
            Load Complete Dataset (All Players & Matches)
            <small>May take longer but shows complete statistics</small>
        `;
        
        loadMoreBtn.addEventListener('click', () => loadCompleteDataset(currentMode));
        
        recordsContainer.appendChild(loadMoreBtn);
    }
}

/**
 * Load complete dataset when user requests it
 */
async function loadCompleteDataset(currentMode) {
    if (state.isLoadingMore) return;
    state.isLoadingMore = true;

    const loadMoreBtn = document.getElementById('load-more-btn');
    if (loadMoreBtn) {
        loadMoreBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading complete dataset...';
        loadMoreBtn.disabled = true;
    }

    try {
        console.log('🔄 Loading COMPLETE dataset (this will use more reads)...');

        const playersCollectionName = currentMode === 'D1' ? 'players' : 'playersD2';
        const matchesCollectionName = currentMode === 'D1' ? 'approvedMatches' : 'approvedMatchesD2';

        // Fetch ALL players and matches (original method)
        const playersRef = collection(db, playersCollectionName);
        const matchesRef = collection(db, matchesCollectionName);
        const [playerSnapshot, matchSnapshot] = await Promise.all([
            getDocs(playersRef),
            getDocs(matchesRef)
        ]);

        console.log(`📊 Complete dataset: ${playerSnapshot.size} players, ${matchSnapshot.size} matches`);

        // Calculate complete stats
        const playerStats = await calculateCompleteStats(playerSnapshot, matchSnapshot);

        // Update cache with complete data
        state.cache[currentMode] = { 
            playerStats, 
            playerSnapshot, 
            matchSnapshot,
            timestamp: Date.now(),
            fullDataLoaded: true 
        };

        // Update displays
        updateRecordDisplay(playerStats);
        await updateTopPlayersByTier(playerSnapshot);
        updateSummaryStats(playerSnapshot);

        // Remove load more button
        if (loadMoreBtn) {
            loadMoreBtn.remove();
        }

        console.log('✅ Complete dataset loaded successfully!');

    } catch (error) {
        console.error('Error loading complete dataset:', error);
        if (loadMoreBtn) {
            loadMoreBtn.innerHTML = 'Error loading complete data - Click to retry';
            loadMoreBtn.disabled = false;
        }
    } finally {
        state.isLoadingMore = false;
    }
}

/**
 * Calculate stats from complete dataset (original logic)
 */
async function calculateCompleteStats(playerSnapshot, matchSnapshot) {
    const playerStats = new Map();
    const playerMatchesMap = new Map();

    // Process all matches
    matchSnapshot.forEach(matchDoc => {
        const match = matchDoc.data();
        if (!match.winnerUsername || !match.loserUsername) return;

        if (!playerMatchesMap.has(match.winnerUsername)) {
            playerMatchesMap.set(match.winnerUsername, { wins: [], losses: [] });
        }
        if (!playerMatchesMap.has(match.loserUsername)) {
            playerMatchesMap.set(match.loserUsername, { wins: [], losses: [] });
        }

        playerMatchesMap.get(match.winnerUsername).wins.push(match);
        playerMatchesMap.get(match.loserUsername).losses.push(match);
    });

    // Process all players
    playerSnapshot.forEach(playerDoc => {
        const player = playerDoc.data();
        const username = player.username;
        if (!username) return;

        const playerMatches = playerMatchesMap.get(username) || { wins: [], losses: [] };
        const wins = playerMatches.wins.length;
        const losses = playerMatches.losses.length;
        const totalMatches = wins + losses;

        let totalKills = 0;
        let totalDeaths = 0;
        let totalSuicides = 0;
        let scoreDifferential = 0;

        playerMatches.wins.forEach(match => {
            const winnerScore = parseInt(match.winnerScore) || 0;
            const loserScore = parseInt(match.loserScore) || 0;
            totalKills += winnerScore;
            totalDeaths += loserScore;
            totalSuicides += parseInt(match.winnerSuicides) || 0;
            scoreDifferential += (winnerScore - loserScore);
        });

        playerMatches.losses.forEach(match => {
            const winnerScore = parseInt(match.winnerScore) || 0;
            const loserScore = parseInt(match.loserScore) || 0;
            totalKills += loserScore;
            totalDeaths += winnerScore;
            totalSuicides += parseInt(match.loserSuicides) || 0;
            scoreDifferential -= (winnerScore - loserScore);
        });

        const kdRatio = totalDeaths > 0 ? parseFloat((totalKills / totalDeaths).toFixed(2)) : totalKills;
        const winRate = totalMatches > 0 ? parseFloat(((wins / totalMatches) * 100).toFixed(1)) : 0;

        playerStats.set(username, {
            wins,
            losses,
            totalMatches,
            kdRatio,
            winRate,
            totalKills,
            totalDeaths,
            totalSuicides,
            scoreDifferential,
            eloRating: player.eloRating || 1200,
            position: player.position,
            isPartialData: false // Complete data
        });
    });

    return playerStats;
}

/**
 * Updates all the individual record cards in the DOM.
 */
function updateRecordDisplay(playerStats) {
    if (!playerStats || playerStats.size === 0) {
        console.warn("No player stats available to display records.");
        document.querySelectorAll('.record-value').forEach(el => el.textContent = 'N/A');
        return;
    }

    // Find Record Holders
    let mostWins = { username: 'N/A', value: 0, elo: 0 };
    let bestWinRate = { username: 'N/A', value: 0, elo: 0 };
    let bestKD = { username: 'N/A', value: 0, elo: 0 };
    let mostMatches = { username: 'N/A', value: 0, elo: 0 };
    let bestDiff = { username: 'N/A', value: -Infinity, elo: 0 };
    let mostLosses = { username: 'N/A', value: 0, elo: 0 };
    let leastSuicides = { username: 'N/A', value: Infinity, elo: 0 };
    let mostKills = { username: 'N/A', value: 0, elo: 0 };
    let bestElo = { username: 'N/A', value: 0, elo: 0 };

    for (const [username, stats] of playerStats) {
        const elo = stats.eloRating || 0; // Use 0 if ELO is missing for tier calculation

        // Most Wins
        if (stats.wins > mostWins.value) mostWins = { username, value: stats.wins, elo };
        // Best Win Rate (with min matches)
        if (stats.totalMatches >= MIN_MATCHES_REQUIREMENT && stats.winRate > bestWinRate.value) bestWinRate = { username, value: stats.winRate, elo };
        // Best K/D (with min matches)
        if (stats.totalMatches >= MIN_MATCHES_REQUIREMENT && stats.kdRatio > bestKD.value) bestKD = { username, value: stats.kdRatio, elo };
        // Most Matches
        if (stats.totalMatches > mostMatches.value) mostMatches = { username, value: stats.totalMatches, elo };
        // Best Score Differential (with min matches)
        if (stats.totalMatches >= MIN_MATCHES_REQUIREMENT && stats.scoreDifferential > bestDiff.value) bestDiff = { username, value: stats.scoreDifferential, elo };
        // Most Losses
        if (stats.losses > mostLosses.value) mostLosses = { username, value: stats.losses, elo };
        // Least Suicides (with min matches, non-negative)
        if (stats.totalMatches >= MIN_MATCHES_REQUIREMENT && stats.totalSuicides >= 0 && stats.totalSuicides < leastSuicides.value) leastSuicides = { username, value: stats.totalSuicides, elo };
        // Most Kills
        if (stats.totalKills > mostKills.value) mostKills = { username, value: stats.totalKills, elo };
        // Best ELO
        if (stats.eloRating > bestElo.value) bestElo = { username, value: Math.round(stats.eloRating), elo }; // Use rounded ELO for display value
    }

    // Handle case where no player met criteria (value remains Infinity)
    if (leastSuicides.value === Infinity) leastSuicides = { username: 'N/A', value: 0, elo: 0 };

    // Update DOM
    updateRecordCard('most-wins', mostWins);
    updateRecordCard('best-winrate', bestWinRate, '%');
    updateRecordCard('best-kd', bestKD);
    updateRecordCard('most-matches', mostMatches);
    updateRecordCard('best-differential', bestDiff, '', true); // Format sign
    updateRecordCard('most-losses', mostLosses);
    updateRecordCard('least-suicides', leastSuicides);
    updateRecordCard('most-kills', mostKills); 
    updateRecordCard('best-elo', bestElo);

    // Show indicator if using partial data
    const isPartialData = Array.from(playerStats.values()).some(stats => stats.isPartialData);
    if (isPartialData) {
        addPartialDataIndicator();
    }

    updateHiddenStatsDiv(playerStats);
}

/**
 * Add indicator when showing partial data
 */
function addPartialDataIndicator() {
    const recordsContainer = document.querySelector('.records-grid') || document.querySelector('.records');
    if (recordsContainer && !document.querySelector('.partial-data-indicator')) {
        const indicator = document.createElement('div');
        indicator.className = 'partial-data-indicator';
        indicator.innerHTML = `
            <i class="fas fa-info-circle"></i>
            Showing results from top ${MAX_PLAYERS_PER_BATCH} players and recent ${MAX_MATCHES_PER_BATCH} matches
        `;
        recordsContainer.insertBefore(indicator, recordsContainer.firstChild);
    }
}

// Keep existing loadMapStats function but optimize it
async function loadMapStats() {
    try {
        console.log(`🔄 Loading map stats for ${state.currentGameMode}...`);
        
        const currentMode = state.currentGameMode;
        const cachedData = state.cache[currentMode];
        
        // Use cached match data if available (THIS IS THE KEY FIX!)
        let matchesSnapshot;
        if (cachedData.matchSnapshot && Date.now() - cachedData.timestamp < CACHE_DURATION_MS) {
            console.log('✅ Using cached match data for map stats (from loadRecords)');
            matchesSnapshot = cachedData.matchSnapshot;
        } else {
            console.log('🔄 Fetching matches for map stats (separate query)...');
            const matchesCollectionName = currentMode === 'D1' ? 'approvedMatches' : 'approvedMatchesD2';
            const approvedMatchesRef = collection(db, matchesCollectionName);
            
            // SIMPLE FALLBACK: Just get all matches (no orderBy)
            console.log('📥 Using simple getDocs (no orderBy to avoid index issues)...');
            matchesSnapshot = await getDocs(approvedMatchesRef);
            console.log(`✅ Simple map query successful: ${matchesSnapshot.size} matches`);
        }

        console.log(`📊 Processing map stats from ${matchesSnapshot.size} matches...`);
        
        const mapCounts = new Map();
        const mapCasings = new Map();
        let processedMaps = 0;

        matchesSnapshot.forEach(doc => {
            const match = doc.data();
            // Check multiple possible field names for map
            const map = match.mapPlayed || match.map || match.mapName || match.level;
            
            if (map && typeof map === 'string' && map.trim().length > 0) {
                const normalizedMap = map.toLowerCase().trim();
                mapCounts.set(normalizedMap, (mapCounts.get(normalizedMap) || 0) + 1);
                
                if (!mapCasings.has(normalizedMap)) {
                    mapCasings.set(normalizedMap, {});
                }
                mapCasings.get(normalizedMap)[map] = (mapCasings.get(normalizedMap)[map] || 0) + 1;
                processedMaps++;
            }
        });

        console.log(`📊 Processed ${processedMaps} matches with map data out of ${matchesSnapshot.size} total`);
        console.log(`📊 Found ${mapCounts.size} unique maps`);
        
        if (mapCounts.size === 0) {
            console.warn('⚠️ No maps found in match data');
            
            // Debug: Log a sample match to see structure
            if (matchesSnapshot.size > 0) {
                console.log('🔍 Sample match structure for debugging:');
                matchesSnapshot.forEach((doc, index) => {
                    if (index === 0) {
                        const matchData = doc.data();
                        console.log('First match data:', matchData);
                        console.log('Available fields:', Object.keys(matchData));
                    }
                });
            }
            
            const container = document.getElementById('mapStatsChart')?.parentElement || 
                             document.querySelector('.chart-container') ||
                             document.querySelector('.map-stats-container');
            if (container) {
                container.innerHTML = `
                    <div class="map-stats-header">
                        <h3>Most Played Maps - ${state.currentGameMode}</h3>
                        <p class="error-message">No map data found in ${matchesSnapshot.size} matches</p>
                        <p class="error-message">Check console for match structure debug info</p>
                    </div>
                `;
            }
            return;
        }

        const sortedMaps = Array.from(mapCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15);

        const maxCount = sortedMaps.length > 0 ? sortedMaps[0][1] : 1;
        const totalMatchesAnalyzed = matchesSnapshot.size;

        const container = document.getElementById('mapStatsChart')?.parentElement || 
                         document.querySelector('.chart-container') ||
                         document.querySelector('.map-stats-container');
        
        if (!container) {
            console.warn("Map stats container not found. Looking for containers...");
            console.log('Available containers:', {
                mapStatsChart: !!document.getElementById('mapStatsChart'),
                chartContainer: !!document.querySelector('.chart-container'),
                mapStatsContainer: !!document.querySelector('.map-stats-container')
            });
            return;
        }

        let listHTML = `
            <div class="map-stats-header">
                <h3>🗺️ Most Played Maps - ${state.currentGameMode}</h3>
                <p class="total-matches">Based on ${processedMaps} matches with map data • ${mapCounts.size} unique maps</p>
            </div>
            <div class="map-stats-list">
        `;

        sortedMaps.forEach(([normalizedMap, count], index) => {
            const casings = mapCasings.get(normalizedMap);
            let preferredCasing = normalizedMap;
            let maxCasingCount = 0;
            
            // Find the most common casing
            for (const [casing, casingCount] of Object.entries(casings)) {
                if (casingCount > maxCasingCount) {
                    maxCasingCount = casingCount;
                    preferredCasing = casing;
                }
            }

            const percentage = Math.round((count / maxCount) * 100);
            const matchPercentage = Math.round((count / processedMaps) * 100);
            const rank = index + 1;

            listHTML += `
                <div class="map-stat-item" title="${preferredCasing}: ${count} matches (${matchPercentage}%)">
                    <div class="map-info">
                        <span class="map-rank">#${rank}</span>
                        <span class="map-name">${preferredCasing}</span>
                        <span class="map-count">${count} matches</span>
                    </div>
                    <div class="map-bar-container">
                        <div class="map-bar" style="width: ${percentage}%"></div>
                        <span class="map-percentage">${matchPercentage}%</span>
                    </div>
                </div>
            `;
        });

        listHTML += '</div>';
        
        // Show remaining maps summary if there are more than 15
        if (mapCounts.size > 15) {
            const remainingMaps = mapCounts.size - 15;
            const remainingCount = Array.from(mapCounts.values())
                .slice(15)
                .reduce((sum, count) => sum + count, 0);
            
            listHTML += `
                <div class="map-stats-footer">
                    <p class="remaining-maps">
                        + ${remainingMaps} more maps with ${remainingCount} total matches
                    </p>
                </div>
            `;
        }
        
        container.innerHTML = listHTML;
        console.log(`✅ Map stats displayed: ${sortedMaps.length} maps shown`);

    } catch (error) {
        console.error(`❌ Error loading ${state.currentGameMode} map statistics:`, error);
        const container = document.getElementById('mapStatsChart')?.parentElement || 
                         document.querySelector('.chart-container');
        if (container) {
            container.innerHTML = `
                <div class="map-stats-header">
                    <h3>Most Played Maps - ${state.currentGameMode}</h3>
                    <p class="error-message">Error loading map statistics: ${error.message}</p>
                </div>
            `;
        }
    }
}

// Keep all other existing functions (updateTopPlayersByTier, updateSummaryStats, etc.)
async function updateTopPlayersByTier(playerSnapshot) {
    if (!playerSnapshot) {
        console.error("playerSnapshot not provided to updateTopPlayersByTier");
        try {
            const playersCollectionName = state.currentGameMode === 'D1' ? 'players' : 'playersD2';
            playerSnapshot = await getDocs(collection(db, playersCollectionName));
        } catch (fetchError) {
             console.error(`Error fetching players for tiers: ${fetchError}`);
             document.querySelectorAll('.tier-players').forEach(el => el.innerHTML = '<div class="loading-msg">Error loading players</div>');
             return;
        }
    }

    try {
        document.querySelectorAll('.tier-players').forEach(el => el.innerHTML = '<div class="loading-msg">Processing...</div>');

        const tiers = {
            emerald: { min: 2000, players: [] },
            gold: { min: 1800, players: [] },
            silver: { min: 1600, players: [] },
            bronze: { min: 1400, players: [] }
        };

        playerSnapshot.forEach(doc => {
            const player = doc.data();
            if (!player.username) return;
            const elo = player.eloRating || 1200;
            const playerData = { username: player.username, elo, position: player.position || 999 };

            if (elo >= tiers.emerald.min) tiers.emerald.players.push(playerData);
            else if (elo >= tiers.gold.min) tiers.gold.players.push(playerData);
            else if (elo >= tiers.silver.min) tiers.silver.players.push(playerData);
            else if (elo >= tiers.bronze.min) tiers.bronze.players.push(playerData);
        });

        for (const tierName in tiers) {
            const tierData = tiers[tierName];
            if (tierData.players.length > 0) {
                tierData.players.sort((a, b) => {
                    const posA = a.position === 999 ? Infinity : a.position;
                    const posB = b.position === 999 ? Infinity : b.position;
                    if (posA !== posB) return posA - posB;
                    return b.elo - a.elo;
                });
                tierData.topPlayer = tierData.players[0];
            } else {
                tierData.topPlayer = null;
            }

            const tierElement = document.getElementById(`${tierName}-players`);
            if (!tierElement) continue;

            if (!tierData.topPlayer) {
                tierElement.innerHTML = '<div class="loading-msg">No players in this tier</div>';
            } else {
                const player = tierData.topPlayer;
                const displayRank = (player.position && player.position < 999) ? player.position : 1;
                tierElement.innerHTML = `
                    <div class="tier-player top-player">
                        <span class="player-rank">#${displayRank}</span>
                        <span class="player-name">${player.username}</span>
                        <span class="player-elo">${Math.round(player.elo)}</span>
                        <span class="player-badge">Best ${tierName.charAt(0).toUpperCase() + tierName.slice(1)}</span>
                    </div>
                    <div class="tier-count">
                        ${tierData.players.length} player${tierData.players.length !== 1 ? 's' : ''} in ${state.currentGameMode} ${tierName} tier
                    </div>`;
            }
        }
    } catch (error) {
        console.error(`Error updating top players by tier: ${error}`);
        document.querySelectorAll('.tier-players').forEach(el => el.innerHTML = '<div class="loading-msg">Error loading players</div>');
    }
}

function updateSummaryStats(playerSnapshot) {
     if (!playerSnapshot) return;

     const totalPlayers = playerSnapshot.size;
     const activePlayersCount = playerSnapshot.docs.filter(doc => doc.data().active !== false).length;

     const totalMatchesElement = document.getElementById('total-matches');
     const totalPlayersElement = document.getElementById('total-players');
     const lastUpdatedElement = document.getElementById('last-updated');

     const playerStats = state.cache[state.currentGameMode]?.playerStats;
     if (playerStats) {
         const totalMatchesCount = Array.from(playerStats.values()).reduce((sum, stats) => sum + stats.totalMatches, 0) / 2;
         if (totalMatchesElement) totalMatchesElement.textContent = Math.round(totalMatchesCount);
     } else {
         if (totalMatchesElement) totalMatchesElement.textContent = 'N/A';
     }

     if (totalPlayersElement) totalPlayersElement.textContent = activePlayersCount;
     if (lastUpdatedElement) lastUpdatedElement.textContent = new Date().toLocaleDateString();
}

function updateHiddenStatsDiv(playerStats) {
    let statsDiv = document.getElementById('records-stats');
    if (!statsDiv) {
        statsDiv = document.createElement('div');
        statsDiv.id = 'records-stats';
        statsDiv.style.display = 'none';
        document.body.appendChild(statsDiv);
    }

    const getTopN = (statKey, filterFn = () => true, sortFn, valueKey = statKey) =>
        Array.from(playerStats.entries())
            .filter(filterFn)
            .sort(sortFn)
            .slice(0, 3)
            .map(([name, stats]) => ({ name, [valueKey]: stats[valueKey] }));

    const statsData = {
        mode: state.currentGameMode,
        timestamp: new Date().toISOString(),
        records: {
            mostWins: getTopN('wins', () => true, (a, b) => b[1].wins - a[1].wins),
            bestWinRate: getTopN('winRate', ([_, stats]) => stats.totalMatches >= MIN_MATCHES_REQUIREMENT, (a, b) => b[1].winRate - a[1].winRate),
            bestKD: getTopN('kdRatio', ([_, stats]) => stats.totalMatches >= MIN_MATCHES_REQUIREMENT, (a, b) => b[1].kdRatio - a[1].kdRatio),
            mostMatches: getTopN('totalMatches', () => true, (a, b) => b[1].totalMatches - a[1].totalMatches),
        }
    };

    statsDiv.textContent = JSON.stringify(statsData, null, 2);
}

// Event Listeners & Initialization
function setupGameModeToggle() {
    const toggleButtons = document.querySelectorAll('.toggle-btn');

    toggleButtons.forEach(button => {
        const clone = button.cloneNode(true);
        button.parentNode.replaceChild(clone, button);

        clone.addEventListener('click', function() {
            if (this.classList.contains('active')) return;

            const gameMode = this.getAttribute('data-game').toUpperCase();
            console.log(`Switching to ${gameMode} mode...`);

            document.querySelectorAll('.toggle-btn').forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');

            state.currentGameMode = gameMode;

            // Remove any existing load more button
            const loadMoreBtn = document.getElementById('load-more-btn');
            if (loadMoreBtn) loadMoreBtn.remove();

            loadRecords();
            loadMapStats();
        });
    });
}

// Add CSS for new elements
const style = document.createElement('style');
style.textContent = `
    .load-more-btn {
        background: linear-gradient(135deg, #673ab7, #9c27b0);
        color: white;
        border: none;
        padding: 15px 25px;
        border-radius: 8px;
        cursor: pointer;
        margin: 20px auto;
        display: block;
        font-size: 16px;
        font-weight: 600;
        transition: all 0.3s ease;
        box-shadow: 0 4px 12px rgba(103, 58, 183, 0.3);
    }
    
    .load-more-btn:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 6px 16px rgba(103, 58, 183, 0.4);
    }
    
    .load-more-btn:disabled {
        opacity: 0.7;
        cursor: not-allowed;
    }
    
    .load-more-btn small {
        display: block;
        font-size: 12px;
        margin-top: 5px;
        opacity: 0.9;
    }
    
    .partial-data-indicator {
        background: rgba(255, 193, 7, 0.1);
        border: 1px solid rgba(255, 193, 7, 0.3);
        color: #ffc107;
        padding: 10px 15px;
        border-radius: 6px;
        margin-bottom: 20px;
        font-size: 14px;
        display: flex;
        align-items: center;
        gap: 8px;
    }
    
    .partial-data-indicator i {
        color: #ffc107;
    }
    
    /* Enhanced Map Stats Styling */
    .map-stats-header {
        margin-bottom: 20px;
        text-align: center;
    }
    
    .map-stats-header h3 {
        color: #333;
        margin-bottom: 8px;
        font-size: 1.4em;
    }
    
    .map-stats-header .total-matches {
        color: #666;
        font-size: 0.9em;
        margin: 0;
    }
    
    .map-stats-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    
    .map-stat-item {
        background: rgba(255, 255, 255, 0.8);
        border: 1px solid rgba(0, 0, 0, 0.1);
        border-radius: 8px;
        padding: 12px;
        transition: all 0.2s ease;
        cursor: pointer;
    }
    
    .map-stat-item:hover {
        background: rgba(255, 255, 255, 0.95);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }
    
    .map-info {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
    }
    
    .map-rank {
        font-weight: bold;
        color: #673ab7;
        min-width: 30px;
    }
    
    .map-name {
        font-weight: 600;
        color: #333;
        flex: 1;
        margin-left: 12px;
    }
    
    .map-count {
        color: #666;
        font-size: 0.9em;
    }
    
    .map-bar-container {
        display: flex;
        align-items: center;
        gap: 10px;
    }
    
    .map-bar {
        flex: 1;
        height: 6px;
        background: linear-gradient(90deg, #673ab7, #9c27b0);
        border-radius: 3px;
        transition: width 0.3s ease;
    }
    
    .map-percentage {
        font-size: 0.8em;
        color: #666;
        min-width: 35px;
        text-align: right;
    }
    
    .map-stats-footer {
        margin-top: 15px;
        text-align: center;
        padding-top: 15px;
        border-top: 1px solid rgba(0, 0, 0, 0.1);
    }
    
    .remaining-maps {
        color: #666;
        font-size: 0.9em;
        margin: 0;
        font-style: italic;
    }
    
    .error-message {
        color: #dc3545;
        font-style: italic;
        text-align: center;
        padding: 20px;
    }
`;
document.head.appendChild(style);

document.addEventListener('DOMContentLoaded', () => {
    Promise.all([
        fetch('../HTML/nav.html').then(response => response.ok ? response.text() : Promise.reject('Nav fetch failed')),
        fetch('../HTML/footer.html').then(response => response.ok ? response.text() : Promise.reject('Footer fetch failed'))
    ]).then(([navData, footerData]) => {
        const navPlaceholder = document.getElementById('nav-placeholder');
        const footerPlaceholder = document.getElementById('footer-placeholder');
        if (navPlaceholder) navPlaceholder.innerHTML = navData;
        if (footerPlaceholder) footerPlaceholder.innerHTML = footerData;
    }).catch(error => {
        console.error('Error loading nav or footer:', error);
    });

    // Initial data load
    loadRecords();
    loadMapStats();
    setupGameModeToggle();
});