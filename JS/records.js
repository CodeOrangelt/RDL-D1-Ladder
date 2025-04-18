import { 
    collection, 
    getDocs
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from './firebase-config.js';

// Global state to track game mode and caching
const state = {
    currentGameMode: 'D1', // Default to D1
    cache: {
        D1: { data: null, timestamp: 0 },
        D2: { data: null, timestamp: 0 }
    },
    cacheDuration: 5 * 60 * 1000 // 5 minutes cache validity
};

// Initialize chart objects
let mapChart = null;

// Fix the getPlayerTier function to correctly determine player ranks
function getPlayerTier(eloRating) {
    // Debug what's being passed in
    console.log(`Determining tier for ELO: ${eloRating}`);
    
    // Handle undefined or null ELO
    if (eloRating === undefined || eloRating === null) {
        console.log('No ELO rating found, using default tier');
        return 'default';
    }
    
    // Make sure we're working with a number
    const elo = Number(eloRating);
    
    // Apply correct tier logic
    if (elo >= 2000) {
        return 'emerald';
    } else if (elo >= 1800) {
        return 'gold';
    } else if (elo >= 1600) {
        return 'silver';
    } else if (elo >= 1400) { // Only positive ELO is bronze
        return 'bronze';
    } else {
        return 'default'; // For zero or negative ELO (shouldn't happen but just in case)
    }
}

async function loadRecords() {
    try {
        // Show loading state in all record values
        document.querySelectorAll('.record-value').forEach(el => {
            el.textContent = 'Loading...';
        });
        
        // Determine collections based on game mode
        const playersCollection = state.currentGameMode === 'D1' ? 'players' : 'playersD2';
        const matchesCollection = state.currentGameMode === 'D1' ? 'approvedMatches' : 'approvedMatchesD2';
        
        // Check cache first
        const now = Date.now();
        if (state.cache[state.currentGameMode].data && 
            now - state.cache[state.currentGameMode].timestamp < state.cacheDuration) {
            console.log(`Using cached ${state.currentGameMode} records data`);
            updateRecordDisplay(state.cache[state.currentGameMode].data);
            return;
        }
         
        console.log(`Loading fresh ${state.currentGameMode} records data`);
        
        // Get all players in a single query
        const playersRef = collection(db, playersCollection);
        const playerSnapshot = await getDocs(playersRef);
        
        // Get all matches in a single query
        const matchesRef = collection(db, matchesCollection);
        const matchSnapshot = await getDocs(matchesRef);
        
        // Build player stats map
        const playerStats = new Map();
        const playerMatchesMap = new Map(); // To store matches by username
        
        // Process all matches first and organize by player
        matchSnapshot.forEach(matchDoc => {
            const match = matchDoc.data();
            const winnerUsername = match.winnerUsername;
            const loserUsername = match.loserUsername;
            
            // Initialize player match arrays if needed
            if (!playerMatchesMap.has(winnerUsername)) {
                playerMatchesMap.set(winnerUsername, { wins: [], losses: [] });
            }
            if (!playerMatchesMap.has(loserUsername)) {
                playerMatchesMap.set(loserUsername, { wins: [], losses: [] });
            }
            
            // Add match to respective arrays
            playerMatchesMap.get(winnerUsername).wins.push(match);
            playerMatchesMap.get(loserUsername).losses.push(match);
        });
        
        // Now process all players with their match data
        playerSnapshot.forEach(playerDoc => {
            const player = playerDoc.data();
            const username = player.username;
            
            // Skip if no username
            if (!username) return;
            
            // Get player matches
            const playerMatches = playerMatchesMap.get(username) || { wins: [], losses: [] };
            const wins = playerMatches.wins.length;
            const losses = playerMatches.losses.length;
            const totalMatches = wins + losses;
            
            // Calculate stats
            let totalKills = 0;
            let totalDeaths = 0;
            let totalSuicides = 0;
            
            // Process winner matches
            playerMatches.wins.forEach(match => {
                totalKills += parseInt(match.winnerScore) || 0;
                totalDeaths += parseInt(match.loserScore) || 0;
                totalSuicides += parseInt(match.winnerSuicides) || 0;
            });
            
            // Process loser matches
            playerMatches.losses.forEach(match => {
                totalKills += parseInt(match.loserScore) || 0;
                totalDeaths += parseInt(match.winnerScore) || 0;
                totalSuicides += parseInt(match.loserSuicides) || 0;
            });
            
            // Calculate score differential
            let scoreDifferential = 0;
            playerMatches.wins.forEach(match => {
                scoreDifferential += (parseInt(match.winnerScore) || 0) - (parseInt(match.loserScore) || 0);
            });
            playerMatches.losses.forEach(match => {
                scoreDifferential -= (parseInt(match.winnerScore) || 0) - (parseInt(match.loserScore) || 0);
            });
            
            // Calculate final stats
            const kdRatio = totalDeaths > 0 ? (totalKills / totalDeaths).toFixed(2) : totalKills;
            const winRate = totalMatches > 0 ? ((wins / totalMatches) * 100).toFixed(1) : 0;
            
            // Store player stats
            playerStats.set(username, {
                wins,
                losses,
                totalMatches,
                kdRatio: parseFloat(kdRatio),
                winRate: parseFloat(winRate),
                totalKills,
                totalDeaths,
                totalSuicides,
                scoreDifferential,
                eloRating: player.eloRating || 1200,
                firstPlaceDate: player.firstPlaceDate,
                position: player.position
            });
        });
        
        // Cache the results
        state.cache[state.currentGameMode].data = playerStats;
        state.cache[state.currentGameMode].timestamp = now;
        
        // Update all record displays
        updateRecordDisplay(playerStats);
        
        // Also update top players by tier
        await updateTopPlayersByTier();
        
    } catch (error) {
        console.error(`Error loading ${state.currentGameMode} records:`, error);
        document.querySelectorAll('.record-value').forEach(el => {
            el.textContent = 'Error loading data';
        });
    }
}

function updateRecordDisplay(playerStats) {
    // Update each individual record
    updateMostWins(playerStats);
    updateBestWinRate(playerStats);
    updateBestKD(playerStats);
    updateMostMatches(playerStats);
    updateBestScoreDifferential(playerStats);
    updateMostLosses(playerStats);
    updateLeastSuicides(playerStats);
    updateLeastLosses(playerStats);
    updateMostKills(playerStats);
    updateBestELO(playerStats);
    
    // Update records-stats div for season archiving
    updateHiddenStatsDiv(playerStats);
    
    // Update total matches
    const totalMatches = Array.from(playerStats.values()).reduce((sum, stats) => sum + stats.totalMatches, 0) / 2;
    document.getElementById('total-matches').textContent = Math.round(totalMatches);
}

async function loadMapStats() {
    try {
        // Determine collection based on game mode
        const matchesCollection = state.currentGameMode === 'D1' ? 'approvedMatches' : 'approvedMatchesD2';
        
        const approvedMatchesRef = collection(db, matchesCollection);
        const matchesSnapshot = await getDocs(approvedMatchesRef);
        
        // Count matches per map
        const mapCounts = new Map();
        
        matchesSnapshot.forEach(doc => {
            const match = doc.data();
            const map = match.mapPlayed; // Using mapPlayed as the field name
            if (map) { // Only count if map exists
                mapCounts.set(map, (mapCounts.get(map) || 0) + 1);
            }
        });

        // Sort maps by count
        const sortedMaps = Array.from(mapCounts.entries())
            .sort((a, b) => b[1] - a[1]);

        // Prepare data for chart
        const labels = sortedMaps.slice(0, 10).map(([map]) => map); // Top 10 maps
        const data = sortedMaps.slice(0, 10).map(([, count]) => count);

        // Create or update the chart
        const ctx = document.getElementById('mapStatsChart').getContext('2d');
        
        if (mapChart) {
            mapChart.destroy();
        }
        
        mapChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: `Most Played Maps (${state.currentGameMode})`,
                    data: data,
                    backgroundColor: '#740a84',
                    borderColor: '#ffffff',
                    borderWidth: 1,
                    borderRadius: 5,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        labels: {
                            color: '#ffffff',
                            font: { size: 14 }
                        }
                    },
                    title: {
                        display: true,
                        text: `Map Popularity - ${state.currentGameMode}`,
                        color: '#ffffff',
                        font: { size: 18 }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(255, 255, 255, 0.1)' },
                        ticks: {
                            color: '#ffffff',
                            font: { size: 12 }
                        }
                    },
                    x: {
                        grid: { display: false },
                        ticks: {
                            color: '#ffffff',
                            font: { size: 12 }
                        }
                    }
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

// Updated function to show only the best ELO player from each tier with CORRECTED thresholds
async function updateTopPlayersByTier() {
    try {
        // Clear previous players
        document.querySelectorAll('.tier-players').forEach(el => {
            el.innerHTML = '<div class="loading-msg">Loading players...</div>';
        });
        
        // Determine collection based on game mode
        const playersCollection = state.currentGameMode === 'D1' ? 'players' : 'playersD2';
        
        // Get all players
        const playersRef = collection(db, playersCollection);
        const playerSnapshot = await getDocs(playersRef);
        
        // Define ELO thresholds for each tier - CORRECTED to match getPlayerTier function
        const tiers = {
            emerald: { min: 2000, players: [] },
            gold: { min: 1800, max: 1999, players: [] },
            silver: { min: 1600, max: 1799, players: [] },
            bronze: { min: 1400, max: 1599, players: [] }
        };
        
        // Categorize players by ELO
        playerSnapshot.forEach(doc => {
            const player = doc.data();
            if (!player.username) return; // Skip if no username
            
            const elo = player.eloRating || 1200;
            
            if (elo >= tiers.emerald.min) {
                tiers.emerald.players.push({ username: player.username, elo, position: player.position || 999 });
            } else if (elo >= tiers.gold.min) {
                tiers.gold.players.push({ username: player.username, elo, position: player.position || 999 });
            } else if (elo >= tiers.silver.min) {
                tiers.silver.players.push({ username: player.username, elo, position: player.position || 999 });
            } else if (elo >= tiers.bronze.min) {
                tiers.bronze.players.push({ username: player.username, elo, position: player.position || 999 });
            }
            // Note: we no longer add players below 1400 ELO to any tier
        });
        
        // Sort players by ELO (descending) within each tier and take the top player
        for (const tier in tiers) {
            tiers[tier].players.sort((a, b) => {
                // Sort by position first if available
                if (a.position && b.position && a.position !== b.position) {
                    return a.position - b.position;
                }
                // Otherwise sort by ELO
                return b.elo - a.elo;
            });
            
            // Only keep the top player (highest ELO)
            if (tiers[tier].players.length > 0) {
                tiers[tier].topPlayer = tiers[tier].players[0];
            }
        }
        
        // Update the DOM to show only the best player from each tier
        for (const tier in tiers) {
            const tierElement = document.getElementById(`${tier}-players`);
            if (!tierElement) continue;
            
            if (!tiers[tier].topPlayer) {
                tierElement.innerHTML = '<div class="loading-msg">No players in this tier</div>';
                continue;
            }
            
            const player = tiers[tier].topPlayer;
            tierElement.innerHTML = '';
            
            const playerElement = document.createElement('div');
            playerElement.className = 'tier-player top-player';
            
            // Show position (if available) or #1
            const displayRank = player.position && player.position < 999 ? player.position : 1;
            
            playerElement.innerHTML = `
                <span class="player-rank">#${displayRank}</span>
                <span class="player-name">${player.username}</span>
                <span class="player-elo">${Math.round(player.elo)}</span>
                <span class="player-badge">Best ${tier.charAt(0).toUpperCase() + tier.slice(1)}</span>
            `;
            tierElement.appendChild(playerElement);
            
            // Optional: Add a count of total players in this tier
            const countElement = document.createElement('div');
            countElement.className = 'tier-count';
            countElement.textContent = `${tiers[tier].players.length} player${tiers[tier].players.length !== 1 ? 's' : ''} in ${state.currentGameMode} ${tier} tier`;
            tierElement.appendChild(countElement);
        }
        
        // Update summary stats
        const totalPlayers = playerSnapshot.size;
        const activePlayersCount = Array.from(playerSnapshot.docs).filter(doc => {
            const player = doc.data();
            return player.active !== false; // Count as active if not explicitly set to false
        }).length;
        
        document.getElementById('total-players').textContent = activePlayersCount || totalPlayers;
        document.getElementById('last-updated').textContent = new Date().toLocaleDateString();
        
    } catch (error) {
        console.error(`Error loading top players: ${error}`);
        document.querySelectorAll('.tier-players').forEach(el => {
            el.innerHTML = '<div class="loading-msg">Error loading players</div>';
        });
    }
}

// Required minimum matches to qualify for certain records
const MIN_MATCHES_REQUIREMENT = 10;

function updateMostWins(playerStats) {
    let mostWins = { username: 'None', wins: 0, elo: 0 };
    for (const [username, stats] of playerStats) {
        if (stats.wins > mostWins.wins) {
            mostWins = { username, wins: stats.wins, elo: stats.eloRating };
        }
    }
    const tier = getPlayerTier(mostWins.elo);
    document.getElementById('most-wins').innerHTML = 
        `<span class="player-name ${tier}-rank">${mostWins.username}</span> <span class="record-stat">(${mostWins.wins})</span>`;
}

function updateBestWinRate(playerStats) {
    let bestWinRate = { username: 'None', rate: 0, elo: 0 };
    for (const [username, stats] of playerStats) {
        if (stats.totalMatches >= MIN_MATCHES_REQUIREMENT && parseFloat(stats.winRate) > bestWinRate.rate) {
            // Make sure we're storing the proper ELO value
            bestWinRate = { 
                username, 
                rate: parseFloat(stats.winRate), 
                elo: stats.eloRating || 0 // Ensure we have a value
            };
            console.log(`New best win rate: ${username} at ${bestWinRate.rate}% (ELO: ${bestWinRate.elo})`);
        }
    }
    
    // Get tier and log for debugging
    const tier = getPlayerTier(bestWinRate.elo);
    console.log(`Best win rate player ${bestWinRate.username} has tier: ${tier} (ELO: ${bestWinRate.elo})`);
    
    // Set the HTML with the proper tier class
    document.getElementById('best-winrate').innerHTML = 
        `<span class="player-name ${tier}-rank">${bestWinRate.username}</span> <span class="record-stat">(${bestWinRate.rate}%)</span>`;
}

function updateBestKD(playerStats) {
    let bestKD = { username: 'None', kd: 0, elo: 0 };
    for (const [username, stats] of playerStats) {
        if (stats.totalMatches >= MIN_MATCHES_REQUIREMENT && parseFloat(stats.kdRatio) > bestKD.kd) {
            bestKD = { username, kd: parseFloat(stats.kdRatio), elo: stats.eloRating };
        }
    }
    const tier = getPlayerTier(bestKD.elo);
    document.getElementById('best-kd').innerHTML = 
        `<span class="player-name ${tier}-rank">${bestKD.username}</span> <span class="record-stat">(${bestKD.kd})</span>`;
}

function updateMostMatches(playerStats) {
    let mostMatches = { username: 'None', matches: 0, elo: 0 };
    for (const [username, stats] of playerStats) {
        if (stats.totalMatches > mostMatches.matches) {
            mostMatches = { username, matches: stats.totalMatches, elo: stats.eloRating };
        }
    }
    const tier = getPlayerTier(mostMatches.elo);
    document.getElementById('most-matches').innerHTML = 
        `<span class="player-name ${tier}-rank">${mostMatches.username}</span> <span class="record-stat">(${mostMatches.matches})</span>`;
}

function updateBestScoreDifferential(playerStats) {
    let bestDiff = { username: 'None', diff: -Infinity, elo: 0 };
    for (const [username, stats] of playerStats) {
        if (stats.totalMatches >= MIN_MATCHES_REQUIREMENT && stats.scoreDifferential > bestDiff.diff) {
            bestDiff = { username, diff: stats.scoreDifferential, elo: stats.eloRating };
        }
    }
    const tier = getPlayerTier(bestDiff.elo);
    document.getElementById('best-differential').innerHTML = 
        `<span class="player-name ${tier}-rank">${bestDiff.username}</span> <span class="record-stat">(${bestDiff.diff > 0 ? '+' : ''}${bestDiff.diff})</span>`;
}

function updateMostLosses(playerStats) {
    let mostLosses = { username: 'None', losses: 0, elo: 0 };
    for (const [username, stats] of playerStats) {
        if (stats.losses > mostLosses.losses) {
            mostLosses = { username, losses: stats.losses, elo: stats.eloRating };
        }
    }
    const tier = getPlayerTier(mostLosses.elo);
    document.getElementById('most-losses').innerHTML = 
        `<span class="player-name ${tier}-rank">${mostLosses.username}</span> <span class="record-stat">(${mostLosses.losses})</span>`;
}

function updateLeastSuicides(playerStats) {
    let leastSuicides = { username: 'None', suicides: Infinity, elo: 0 };
    for (const [username, stats] of playerStats) {
        if (stats.totalMatches >= MIN_MATCHES_REQUIREMENT && 
            stats.totalSuicides < leastSuicides.suicides && 
            stats.totalSuicides >= 0) {
            leastSuicides = { username, suicides: stats.totalSuicides, elo: stats.eloRating };
        }
    }
    const tier = getPlayerTier(leastSuicides.elo);
    document.getElementById('least-suicides').innerHTML = 
        `<span class="player-name ${tier}-rank">${leastSuicides.username}</span> <span class="record-stat">(${leastSuicides.suicides === Infinity ? 0 : leastSuicides.suicides})</span>`;
}

function updateLeastLosses(playerStats) {
    let leastLosses = { username: 'None', losses: Infinity, elo: 0 };
    for (const [username, stats] of playerStats) {
        if (stats.totalMatches >= MIN_MATCHES_REQUIREMENT && stats.losses < leastLosses.losses) {
            leastLosses = { username, losses: stats.losses, elo: stats.eloRating };
        }
    }
    const tier = getPlayerTier(leastLosses.elo);
    document.getElementById('least-losses').innerHTML = 
        `<span class="player-name ${tier}-rank">${leastLosses.username}</span> <span class="record-stat">(${leastLosses.losses === Infinity ? 0 : leastLosses.losses})</span>`;
}

function updateMostKills(playerStats) {
    let mostKills = { username: 'None', kills: 0, elo: 0 };
    for (const [username, stats] of playerStats) {
        if (stats.totalKills > mostKills.kills) {
            mostKills = { username, kills: stats.totalKills, elo: stats.eloRating };
        }
    }
    const tier = getPlayerTier(mostKills.elo);
    const element = document.getElementById('most-kills');
    if (element) {
        element.innerHTML = 
            `<span class="player-name ${tier}-rank">${mostKills.username}</span> <span class="record-stat">(${mostKills.kills})</span>`;
    }
}

function updateBestELO(playerStats) {
    let bestElo = { username: 'None', elo: 0 };
    for (const [username, stats] of playerStats) {
        if (stats.eloRating > bestElo.elo) {
            bestElo = { username, elo: stats.eloRating };
        }
    }
    const tier = getPlayerTier(bestElo.elo);
    const element = document.getElementById('best-elo');
    if (element) {
        element.innerHTML = 
            `<span class="player-name ${tier}-rank">${bestElo.username}</span> <span class="record-stat">(${Math.round(bestElo.elo)})</span>`;
    }
}

// Update hidden stats div for season archiving
function updateHiddenStatsDiv(playerStats) {
    // Create a hidden div if it doesn't exist for season history archiving
    let statsDiv = document.getElementById('records-stats');
    if (!statsDiv) {
        statsDiv = document.createElement('div');
        statsDiv.id = 'records-stats';
        statsDiv.style.display = 'none';
        document.body.appendChild(statsDiv);
    }
    
    // Format stats as JSON for easy retrieval
    const statsData = {
        mode: state.currentGameMode,
        timestamp: new Date().toISOString(),
        records: {
            mostWins: Array.from(playerStats.entries())
                .sort((a, b) => b[1].wins - a[1].wins)
                .slice(0, 3)
                .map(([name, stats]) => ({ name, wins: stats.wins })),
                
            bestWinRate: Array.from(playerStats.entries())
                .filter(([_, stats]) => stats.totalMatches >= MIN_MATCHES_REQUIREMENT)
                .sort((a, b) => b[1].winRate - a[1].winRate)
                .slice(0, 3)
                .map(([name, stats]) => ({ name, winRate: stats.winRate })),
                
            bestKD: Array.from(playerStats.entries())
                .filter(([_, stats]) => stats.totalMatches >= MIN_MATCHES_REQUIREMENT)
                .sort((a, b) => b[1].kdRatio - a[1].kdRatio)
                .slice(0, 3)
                .map(([name, stats]) => ({ name, kdRatio: stats.kdRatio })),
                
            mostMatches: Array.from(playerStats.entries())
                .sort((a, b) => b[1].totalMatches - a[1].totalMatches)
                .slice(0, 3)
                .map(([name, stats]) => ({ name, matches: stats.totalMatches }))
        }
    };
    
    statsDiv.textContent = JSON.stringify(statsData);
}

// Fixed game mode toggle functionality
function setupGameModeToggle() {
    const toggleButtons = document.querySelectorAll('.toggle-btn');
    
    // Remove any existing event listeners first (in case of duplicates)
    toggleButtons.forEach(button => {
        button.replaceWith(button.cloneNode(true));
    });
    
    // Get fresh references after replacing
    const freshButtons = document.querySelectorAll('.toggle-btn');
    
    freshButtons.forEach(button => {
        button.addEventListener('click', function() {
            // Skip if already active
            if (this.classList.contains('active')) return;
            
            // Get the game mode from the data attribute
            const gameMode = this.getAttribute('data-game').toUpperCase();
            console.log(`Switching to ${gameMode} mode - loading data...`);
            
            // Update UI
            freshButtons.forEach(btn => {
                btn.classList.remove('active');
            });
            this.classList.add('active');
            
            // Update state
            state.currentGameMode = gameMode;
            
            // Clear cache for the selected game mode to force reload
            state.cache[state.currentGameMode] = { data: null, timestamp: 0 };
            
            // Reset display
            document.querySelectorAll('.record-value').forEach(el => {
                el.textContent = 'Loading...';
            });
            document.querySelectorAll('.tier-players').forEach(el => {
                el.innerHTML = '<div class="loading-msg">Loading players...</div>';
            });
            
            // Load new data
            loadRecords();
            loadMapStats();
        });
    });
}

// Make sure DOM is loaded before accessing elements
document.addEventListener('DOMContentLoaded', function() {
    // Load navigation and footer
    Promise.all([
        fetch('../HTML/nav.html').then(response => response.text()),
        fetch('../HTML/footer.html').then(response => response.text())
    ]).then(([navData, footerData]) => {
        document.getElementById('nav-placeholder').innerHTML = navData;
        document.getElementById('footer-placeholder').innerHTML = footerData;
        
        // Setup event handlers after nav is loaded (important for buttons to work)
        setTimeout(() => {
            setupGameModeToggle();
        }, 100);
    }).catch(error => {
        console.error('Error loading nav/footer:', error);
    });
    
    // Initial data load
    loadRecords();
    loadMapStats();
});