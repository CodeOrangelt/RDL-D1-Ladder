import {
    collection,
    getDocs
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from './firebase-config.js';

// --- Configuration ---
const MIN_MATCHES_REQUIREMENT = 10; // Min matches to qualify for rate/ratio records
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes cache validity

// --- Global State & Variables ---
const state = {
    currentGameMode: 'D1', // Default to D1
    cache: {
        D1: { playerStats: null, playerSnapshot: null, timestamp: 0 }, // Store both stats and snapshot
        D2: { playerStats: null, playerSnapshot: null, timestamp: 0 }
    }
};
let mapChart = null; // Chart.js instance for map stats

// --- Helper Functions ---

/**
 * Determines the tier based on ELO rating.
 * @param {number|null|undefined} eloRating - The player's ELO rating.
 * @returns {string} The tier name ('emerald', 'gold', 'silver', 'bronze', 'default').
 */
function getPlayerTier(eloRating) {
    if (eloRating === undefined || eloRating === null) {
        return 'default'; // Handle missing ELO
    }
    const elo = Number(eloRating);
    if (isNaN(elo)) {
        return 'default'; // Handle non-numeric ELO
    }

    if (elo >= 2000) return 'emerald';
    if (elo >= 1800) return 'gold';
    if (elo >= 1600) return 'silver';
    if (elo >= 1400) return 'bronze';
    return 'default'; // ELO below 1400 or invalid
}

/**
 * Updates a record card element in the DOM.
 * @param {string} elementId - The ID of the DOM element to update.
 * @param {object} recordData - Object containing { username, value, elo }.
 * @param {string} unit - The unit to display after the value (e.g., '%', ' matches'). Defaults to empty string.
 * @param {boolean} formatSign - Whether to prepend '+' for positive numbers. Defaults to false.
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

// --- Core Data Loading & Processing ---

/**
 * Loads player and match data, calculates stats, updates cache, and triggers display updates.
 */
async function loadRecords() {
    try {
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
            console.log(`Using cached ${currentMode} records data`);
            updateRecordDisplay(cachedData.playerStats);
            // Pass cached snapshot to avoid re-fetching players
            await updateTopPlayersByTier(cachedData.playerSnapshot);
            updateSummaryStats(cachedData.playerSnapshot); // Update summary from snapshot
            return;
        }

        console.log(`Loading fresh ${currentMode} records data from Firestore`);

        // Fetch players and matches concurrently
        const playersRef = collection(db, playersCollectionName);
        const matchesRef = collection(db, matchesCollectionName);
        const [playerSnapshot, matchSnapshot] = await Promise.all([
            getDocs(playersRef),
            getDocs(matchesRef)
        ]);

        // --- Calculate Player Stats ---
        const playerStats = new Map();
        const playerMatchesMap = new Map(); // Temp map to organize matches by player

        // 1. Process matches to group by player
        matchSnapshot.forEach(matchDoc => {
            const match = matchDoc.data();
            // Ensure usernames exist
            if (!match.winnerUsername || !match.loserUsername) return;

            // Initialize maps if needed
            if (!playerMatchesMap.has(match.winnerUsername)) playerMatchesMap.set(match.winnerUsername, { wins: [], losses: [] });
            if (!playerMatchesMap.has(match.loserUsername)) playerMatchesMap.set(match.loserUsername, { wins: [], losses: [] });

            // Add match data
            playerMatchesMap.get(match.winnerUsername).wins.push(match);
            playerMatchesMap.get(match.loserUsername).losses.push(match);
        });

        // 2. Process players and calculate aggregated stats
        playerSnapshot.forEach(playerDoc => {
            const player = playerDoc.data();
            const username = player.username;
            if (!username) return; // Skip players without username

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
                scoreDifferential -= (winnerScore - loserScore); // Subtract difference when losing
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
                eloRating: player.eloRating || 1200, // Default ELO if missing
                position: player.position // Keep position if available
            });
        });

        // Cache the results
        state.cache[currentMode] = { playerStats, playerSnapshot, timestamp: now };

        // Update displays
        updateRecordDisplay(playerStats);
        await updateTopPlayersByTier(playerSnapshot); // Pass snapshot
        updateSummaryStats(playerSnapshot); // Update summary from snapshot

    } catch (error) {
        console.error(`Error loading ${state.currentGameMode} records:`, error);
        document.querySelectorAll('.record-value, .tier-players').forEach(el => {
            el.textContent = 'Error';
            el.innerHTML = '<div class="loading-msg">Error loading data</div>';
        });
        // Clear potentially faulty cache on error
        state.cache[state.currentGameMode] = { playerStats: null, playerSnapshot: null, timestamp: 0 };
    }
}

/**
 * Updates all the individual record cards in the DOM.
 * @param {Map<string, object>} playerStats - Map of player stats.
 */
function updateRecordDisplay(playerStats) {
    if (!playerStats || playerStats.size === 0) {
        console.warn("No player stats available to display records.");
        // Optionally clear record fields or show 'N/A'
        document.querySelectorAll('.record-value').forEach(el => el.textContent = 'N/A');
        return;
    }

    // --- Find Record Holders ---
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

    // --- Update DOM using helper ---
    updateRecordCard('most-wins', mostWins);
    updateRecordCard('best-winrate', bestWinRate, '%');
    updateRecordCard('best-kd', bestKD);
    updateRecordCard('most-matches', mostMatches);
    updateRecordCard('best-differential', bestDiff, '', true); // Format sign
    updateRecordCard('most-losses', mostLosses);
    updateRecordCard('least-suicides', leastSuicides);
    updateRecordCard('most-kills', mostKills); 
    updateRecordCard('best-elo', bestElo);

    // Update hidden stats div for potential season archiving
    updateHiddenStatsDiv(playerStats);
}

/**
 * Updates the map statistics chart.
 */
async function loadMapStats() {
    try {
        const matchesCollectionName = state.currentGameMode === 'D1' ? 'approvedMatches' : 'approvedMatchesD2';
        const approvedMatchesRef = collection(db, matchesCollectionName);
        const matchesSnapshot = await getDocs(approvedMatchesRef);

        const mapCounts = new Map();
        matchesSnapshot.forEach(doc => {
            const map = doc.data().mapPlayed;
            if (map) { // Only count if map name exists
                mapCounts.set(map, (mapCounts.get(map) || 0) + 1);
            }
        });

        // Sort maps by play count descending, take top 10
        const sortedMaps = Array.from(mapCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

        const labels = sortedMaps.map(([map]) => map);
        const data = sortedMaps.map(([, count]) => count);

        // Create or update the chart
        const ctx = document.getElementById('mapStatsChart')?.getContext('2d');
        if (!ctx) {
            console.warn("Map stats chart canvas not found.");
            return;
        }

        if (mapChart) {
            mapChart.destroy(); // Destroy previous chart instance
        }

        mapChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: `Most Played Maps (${state.currentGameMode})`,
                    data: data,
                    backgroundColor: '#740a84', // Consider making this dynamic or CSS variable
                    borderColor: '#ffffff',
                    borderWidth: 1,
                    borderRadius: 5,
                }]
            },
            options: { // Keep existing chart options
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: '#ffffff', font: { size: 14 } } },
                    title: { display: true, text: `Map Popularity - ${state.currentGameMode}`, color: '#ffffff', font: { size: 18 } }
                },
                scales: {
                    y: { beginAtZero: true, grid: { color: 'rgba(255, 255, 255, 0.1)' }, ticks: { color: '#ffffff', font: { size: 12 } } },
                    x: { grid: { display: false }, ticks: { color: '#ffffff', font: { size: 12 } } }
                }
            }
        });

    } catch (error) {
        console.error(`Error loading ${state.currentGameMode} map statistics:`, error);
        const container = document.querySelector('.chart-container');
        if (container) {
            container.innerHTML = '<p class="error-message">Error loading map statistics</p>';
        }
    }
}

/**
 * Updates the display showing the top player in each ELO tier.
 * @param {firebase.firestore.QuerySnapshot} playerSnapshot - The snapshot of player documents.
 */
async function updateTopPlayersByTier(playerSnapshot) {
    // This function now receives the playerSnapshot, avoiding a redundant read
    if (!playerSnapshot) {
        console.error("playerSnapshot not provided to updateTopPlayersByTier");
        // Attempt to fetch if missing (fallback, less efficient)
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
        // Clear previous players
        document.querySelectorAll('.tier-players').forEach(el => el.innerHTML = '<div class="loading-msg">Processing...</div>');

        // Define tiers and thresholds
        const tiers = {
            emerald: { min: 2000, players: [] },
            gold: { min: 1800, players: [] },
            silver: { min: 1600, players: [] },
            bronze: { min: 1400, players: [] }
        };

        // Categorize players
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

        // Find top player for each tier
        for (const tierName in tiers) {
            const tierData = tiers[tierName];
            if (tierData.players.length > 0) {
                // Sort by position (ascending) then ELO (descending)
                tierData.players.sort((a, b) => {
                    const posA = a.position === 999 ? Infinity : a.position; // Treat 999 as last
                    const posB = b.position === 999 ? Infinity : b.position;
                    if (posA !== posB) return posA - posB;
                    return b.elo - a.elo; // Higher ELO first if positions are equal
                });
                tierData.topPlayer = tierData.players[0]; // The first player after sorting is the top one
            } else {
                tierData.topPlayer = null;
            }

            // Update DOM for the tier
            const tierElement = document.getElementById(`${tierName}-players`);
            if (!tierElement) continue;

            if (!tierData.topPlayer) {
                tierElement.innerHTML = '<div class="loading-msg">No players in this tier</div>';
            } else {
                const player = tierData.topPlayer;
                // Use position if valid, otherwise default to #1 for the top player display
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

/**
 * Updates the summary statistics header.
 * @param {firebase.firestore.QuerySnapshot} playerSnapshot - The snapshot of player documents.
 */
function updateSummaryStats(playerSnapshot) {
     if (!playerSnapshot) return; // Guard clause

     const totalPlayers = playerSnapshot.size;
     // Count active players (assuming 'active: false' means inactive)
     const activePlayersCount = playerSnapshot.docs.filter(doc => doc.data().active !== false).length;

     const totalMatchesElement = document.getElementById('total-matches');
     const totalPlayersElement = document.getElementById('total-players');
     const lastUpdatedElement = document.getElementById('last-updated');

     // Calculate total matches from cache if available, otherwise show 'N/A'
     const playerStats = state.cache[state.currentGameMode]?.playerStats;
     if (playerStats) {
         const totalMatchesCount = Array.from(playerStats.values()).reduce((sum, stats) => sum + stats.totalMatches, 0) / 2; // Each match involves 2 players
         if (totalMatchesElement) totalMatchesElement.textContent = Math.round(totalMatchesCount);
     } else {
         if (totalMatchesElement) totalMatchesElement.textContent = 'N/A';
     }

     if (totalPlayersElement) totalPlayersElement.textContent = activePlayersCount;
     if (lastUpdatedElement) lastUpdatedElement.textContent = new Date().toLocaleDateString(); // Or use cache timestamp
}


/**
 * Updates a hidden div with JSON stats for potential season archiving.
 * @param {Map<string, object>} playerStats - Map of player stats.
 */
function updateHiddenStatsDiv(playerStats) {
    let statsDiv = document.getElementById('records-stats');
    if (!statsDiv) {
        statsDiv = document.createElement('div');
        statsDiv.id = 'records-stats';
        statsDiv.style.display = 'none';
        document.body.appendChild(statsDiv); // Appends to body, ensure this is desired
    }

    // Prepare data for JSON (Top 3 for key records)
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
            // Add other records if needed for archiving
        }
    };

    statsDiv.textContent = JSON.stringify(statsData, null, 2); // Pretty print JSON
}

// --- Event Listeners & Initialization ---

/**
 * Sets up the event listeners for the D1/D2 toggle buttons.
 */
function setupGameModeToggle() {
    const toggleButtons = document.querySelectorAll('.toggle-btn');

    // Use cloning to ensure clean listeners, especially if nav is dynamically loaded
    toggleButtons.forEach(button => {
        const clone = button.cloneNode(true);
        button.parentNode.replaceChild(clone, button);

        clone.addEventListener('click', function() {
            if (this.classList.contains('active')) return; // Already active

            const gameMode = this.getAttribute('data-game').toUpperCase();
            console.log(`Switching to ${gameMode} mode...`);

            // Update UI state
            document.querySelectorAll('.toggle-btn').forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');

            // Update global state
            state.currentGameMode = gameMode;

            // Force reload by clearing cache for the *selected* mode
            // state.cache[gameMode] = { playerStats: null, playerSnapshot: null, timestamp: 0 }; // Keep cache for other mode

            // Load data for the new mode
            loadRecords();
            loadMapStats();
        });
    });
}

/**
 * Initializes the records page once the DOM is loaded.
 */
document.addEventListener('DOMContentLoaded', () => {
    // Load navigation and footer dynamically
    Promise.all([
        fetch('../HTML/nav.html').then(response => response.ok ? response.text() : Promise.reject('Nav fetch failed')),
        fetch('../HTML/footer.html').then(response => response.ok ? response.text() : Promise.reject('Footer fetch failed'))
    ]).then(([navData, footerData]) => {
        const navPlaceholder = document.getElementById('nav-placeholder');
        const footerPlaceholder = document.getElementById('footer-placeholder');
        if (navPlaceholder) navPlaceholder.innerHTML = navData;
        if (footerPlaceholder) footerPlaceholder.innerHTML = footerData;

        // Setup toggle *after* nav HTML is inserted.
        // setTimeout is a pragmatic way to ensure elements exist if nav loading is complex.
        setTimeout(() => {
            setupGameModeToggle();
            // Set initial active button based on default state
            const initialButton = document.querySelector(`.toggle-btn[data-game="${state.currentGameMode.toLowerCase()}"]`);
            if (initialButton) initialButton.classList.add('active');
            else document.querySelector('.toggle-btn')?.classList.add('active'); // Fallback to first button

        }, 150); // Slightly increased delay just in case

    }).catch(error => {
        console.error('Error loading nav/footer:', error);
        // Attempt to setup toggle anyway, might work if elements exist statically
         setTimeout(setupGameModeToggle, 150);
    });

    // Initial data load for the default game mode
    loadRecords();
    loadMapStats();

    // Add listeners for filters (if implemented)
    // document.getElementById('season-filter')?.addEventListener('change', handleFilterChange);
    // document.getElementById('map-filter')?.addEventListener('change', handleFilterChange);
});

// --- Future Optimization Note ---
// For significantly better Firestore read performance with large datasets,
// consider using Cloud Functions to aggregate player statistics (wins, losses, kills, etc.)
// directly within player documents whenever a match is approved.
// This would allow the client to fetch only the 'players' collection,
// drastically reducing the number of reads required.