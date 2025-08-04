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

const auth = getAuth();

// Track active listeners for cleanup
let activeListeners = [];

// Cache configuration
const playerCache = {
    data: null,
    timestamp: 0
};
const CACHE_DURATION = 30000; // 30 seconds cache validity

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

async function displayLadder(forceRefresh = false) {
    const tableBody = document.querySelector('#ladder tbody');
    if (!tableBody) {
        console.error('Ladder table body not found');
        return;
    }

    // Clear the table first to prevent duplicates
    tableBody.innerHTML = '<tr><td colspan="8" class="loading-cell">Loading ladder data...</td></tr>';

    try {
        // Use cache if available and not expired
        const now = Date.now();
        if (!forceRefresh && playerCache.data && (now - playerCache.timestamp < CACHE_DURATION)) {
            console.log('Using cached D1 ladder data');
            updateLadderDisplay(playerCache.data);
            return;
        }

        // First get all players
        const playersRef = collection(db, 'players');
        const querySnapshot = await getDocs(playersRef);
        const players = [];

        querySnapshot.forEach((doc) => {
            const playerData = doc.data();
            players.push({
                ...playerData,
                id: doc.id,
                elo: playerData.eloRating || 0,
                position: playerData.position || Number.MAX_SAFE_INTEGER
            });
        });

        // Get all user profiles in one go
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

        // Match profiles to players - assign country data
        players.forEach(player => {
            const username = player.username?.toLowerCase();
            if (username && profilesByUsername.has(username)) {
                const profile = profilesByUsername.get(username);
                if (profile.country) {
                    player.country = profile.country.toLowerCase();
                }
            }
        });

        // Extract all usernames for batch operations
        const usernames = players.map(p => p.username);

        // Get match stats for all players at once
        const matchStatsBatch = await fetchBatchMatchStats(usernames);

        // Sort players with match info already available
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

        // Store in cache
        playerCache.data = players;
        playerCache.timestamp = now;

        // Update the display with batch HTML creation
        updateLadderDisplay(players, matchStatsBatch);

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

// Helper function to fetch all match stats at once - much more efficient
async function fetchBatchMatchStats(usernames) {
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
        console.error("Error fetching batch match stats:", error);
    }

    return matchStats;
}

// Get player's rank name by ELO
function getPlayerRankName(elo) {
    if (elo >= 2000) return 'Emerald';
    if (elo >= 1800) return 'Gold';
    if (elo >= 1600) return 'Silver';
    if (elo >= 1400) return 'Bronze';
    return 'Unranked';
}

// Function to get the last ELO change for each player
async function getPlayersLastEloChanges(usernames) {
    // Initialize changes map first
    const changes = new Map();
    usernames.forEach(username => {
        changes.set(username, 0);
    });

    try {
        // First step: Create a mapping between user IDs and usernames
        const playersRef = collection(db, 'players');
        const playersSnapshot = await getDocs(playersRef);

        // Create two mappings: id→username and username→id (both case-insensitive)
        const userIdToUsername = new Map();
        const usernameToUserId = new Map();

        playersSnapshot.forEach(doc => {
            const userData = doc.data();
            if (userData.username) {
                userIdToUsername.set(doc.id, userData.username);
                usernameToUserId.set(userData.username.toLowerCase(), doc.id);
            }
        });

        // Query for ELO history - limit to most recent 300 entries
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
            // Second try: Look for username field
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
                    // Calculate ELO change from available fields
                    let eloChange;

                    if (recentEntry.change !== undefined) {
                        eloChange = parseInt(recentEntry.change);
                    } else if (recentEntry.newElo !== undefined && recentEntry.previousElo !== undefined) {
                        eloChange = parseInt(recentEntry.newElo) - parseInt(recentEntry.previousElo);
                    } else if (recentEntry.newEloRating !== undefined && recentEntry.oldEloRating !== undefined) {
                        eloChange = parseInt(recentEntry.newEloRating) - parseInt(recentEntry.oldEloRating);
                    }

                    if (!isNaN(eloChange) && eloChange !== 0) {
                        // Store the change
                        changes.set(username, eloChange);
                    }
                }
            }
        });

    } catch (error) {
        console.error('Error fetching ELO history:', error);
    }

    return changes;
}

// Function to create HTML for a single player row with token support
function createPlayerRowWithToken(player, stats, primaryToken) {
    const elo = parseFloat(player.elo) || 0;

    // Set ELO-based colors
    let usernameColor = 'gray'; // Default for unranked
    if (elo >= 2000) {
        usernameColor = '#50C878'; // Emerald Green
    } else if (elo >= 1800) {
        usernameColor = '#FFD700'; // Gold
    } else if (elo >= 1600) {
        usernameColor = '#b9f1fc'; // Silver
    } else if (elo >= 1400) {
        usernameColor = '#CD7F32'; // Bronze
    }

    // Create flag HTML if player has country
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
    </tr>`;
}

// Updated ladder display function with batch HTML creation
async function updateLadderDisplay(ladderData, matchStatsBatch = null) {
    const tbody = document.querySelector('#ladder tbody');
    if (!tbody) {
        console.error('Ladder table body not found');
        return;
    }

    // Update the table header with new columns
    const thead = document.querySelector('#ladder thead tr');
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

    // Get all usernames for batch processing
    const usernames = ladderData.map(p => p.username);

    // If match stats not provided, fetch them
    if (!matchStatsBatch) {
        matchStatsBatch = await fetchBatchMatchStats(usernames);
    }

    // Get tokens for all players
    let userTokensMap = new Map();
    try {
        // Clear token cache before fetching to ensure fresh data
        if (typeof clearTokenCache === 'function') {
            clearTokenCache();
        }
        
        userTokensMap = await getTokensByUsernames(usernames);
        console.log('🪙 Loaded fresh tokens for', userTokensMap.size, 'players');
    } catch (error) {
        console.error('Error fetching tokens:', error);
    }

    // Create all rows at once for better performance
    const rowsHtml = ladderData.map(player => {
        // Get pre-fetched stats from our batch operation
        const stats = matchStatsBatch.get(player.username) || {
            totalMatches: 0, wins: 0, losses: 0, 
            kda: 0, winRate: 0, totalKills: 0, totalDeaths: 0
        };

        // Get user's tokens
        const userTokens = userTokensMap.get(player.username) || [];
        const primaryToken = getPrimaryDisplayToken(userTokens);

        return createPlayerRowWithToken(player, stats, primaryToken);
    }).join('');

    // Append all rows at once (much faster than individual DOM operations)
    tbody.innerHTML = rowsHtml;

    // Get all ELO changes at once
    getPlayersLastEloChanges(usernames)
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
                            // Update the existing indicator
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
        .catch(error => console.error('Error updating ELO trend indicators:', error));
}

// Initialize ladder toggle functionality
function initLadderToggles() {    
    const toggles = {
        d1: document.getElementById('d1-switch'),
        d2: document.getElementById('d2-switch'),
        d3: document.getElementById('d3-switch'),
        duos: document.getElementById('duos-switch')
    };
    
    const containers = {
        d1: document.getElementById('d1-ladder-container'),
        d2: document.getElementById('d2-ladder-container'),
        d3: document.getElementById('d3-ladder-container'),
        duos: document.getElementById('duos-ladder-container')
    };
    
    const recommendationTexts = {
        d1: document.getElementById('elo-recommendation-text-d1'),
        d2: document.getElementById('elo-recommendation-text-d2'),
        d3: document.getElementById('elo-recommendation-text-d3'),
        duos: document.getElementById('elo-recommendation-text-duos')
    };

    // Helper function to hide all ladders
    function hideAllLadders() {
        Object.values(containers).forEach(container => {
            if (container) {
                container.classList.remove('active');
                container.style.display = 'none';
            }
        });
        
        // Hide all recommendation texts
        Object.values(recommendationTexts).forEach(text => {
            if (text) text.style.display = 'none';
        });
        
        // Remove active class from all toggles
        Object.values(toggles).forEach(toggle => {
            if (toggle) toggle.classList.remove('active');
        });
    }
    
    // Create event listeners for each toggle
    if (toggles.d1) {
        toggles.d1.addEventListener('click', () => {
            hideAllLadders();
            if (containers.d1) {
                containers.d1.classList.add('active');
                containers.d1.style.display = 'block';
            }
            if (recommendationTexts.d1) recommendationTexts.d1.style.display = 'block';
            toggles.d1.classList.add('active');
            displayLadder();
            findBestOpponent('d1');
        });
    }

    if (toggles.d2) {
        toggles.d2.addEventListener('click', () => {
            hideAllLadders();
            if (containers.d2) {
                containers.d2.classList.add('active');
                containers.d2.style.display = 'block';
            }
            if (recommendationTexts.d2) recommendationTexts.d2.style.display = 'block';
            toggles.d2.classList.add('active');
            displayLadderD2();
            findBestOpponent('d2');
        });
    }

    if (toggles.d3) {
        toggles.d3.addEventListener('click', () => {
            hideAllLadders();
            if (containers.d3) {
                containers.d3.classList.add('active');
                containers.d3.style.display = 'block';
            }
            if (recommendationTexts.d3) recommendationTexts.d3.style.display = 'block';
            toggles.d3.classList.add('active');
            displayLadderD3();
            findBestOpponent('d3');
        });
    }

    if (toggles.duos) {
        toggles.duos.addEventListener('click', () => {
            hideAllLadders();
            if (containers.duos) containers.duos.style.display = 'block';
            if (recommendationTexts.duos) recommendationTexts.duos.style.display = 'block';
            displayLadderDuos();
            findBestOpponent('duos');
        });
    }
}

// Find the best opponent for the current user
async function findBestOpponent(currentLadder = 'd1') {
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
        const ladderCollection = currentLadder === 'd1' ? 'players' : 
                               currentLadder === 'd2' ? 'playersD2' :
                               currentLadder === 'd3' ? 'playersD3' : 'playersDuos';

        // Special handling for DUOS ladder
        if (currentLadder === 'duos') {
            await handleDuosRecommendation(username, ladderCollection, recommendationEl);
            return;
        }

        // Handle solo ladder recommendations
        await handleSoloRecommendation(username, ladderCollection, recommendationEl);

    } catch (error) {
        console.error('Error finding best opponent:', error);
        recommendationEl.textContent = 'Error finding recommended opponent';
    }
}

// Helper function for duos ladder recommendation
async function handleDuosRecommendation(username, ladderCollection, recommendationEl) {
    // Get the user's data from DUOS ladder
    const playersRef = collection(db, ladderCollection);
    const playerQuery = query(playersRef, where('username', '==', username));
    const playerSnapshot = await getDocs(playerQuery);

    if (playerSnapshot.empty) {
        recommendationEl.textContent = `You're not registered on the DUOS ladder`;
        return;
    }

    const playerData = playerSnapshot.docs[0].data();
    const userElo = parseInt(playerData.eloRating) || 1200;

    // Check if user has a team
    if (playerData.hasTeam && playerData.teammate) {
        recommendationEl.innerHTML = `You're teamed with <span class="recommendation-highlight">${playerData.teammate}</span>. Challenge other teams!`;
        return;
    }

    // If no team, find potential teammates
    const allPlayersSnapshot = await getDocs(playersRef);
    let bestTeammate = null;
    let bestTeammateScore = -1;

    allPlayersSnapshot.forEach(doc => {
        const potentialTeammate = doc.data();

        // Skip if this is the current user or they already have a team
        if (potentialTeammate.username === username || potentialTeammate.hasTeam) return;

        const teammateElo = parseInt(potentialTeammate.eloRating) || 1200;
        const eloDifference = Math.abs(teammateElo - userElo);

        // Calculate teammate compatibility score - closer ELO is better for teamwork
        const compatibilityScore = Math.max(0, 200 - eloDifference);

        if (compatibilityScore > bestTeammateScore) {
            bestTeammate = potentialTeammate;
            bestTeammateScore = compatibilityScore;
        }
    });

    if (bestTeammate) {
        const teammateElo = parseInt(bestTeammate.eloRating) || 1200;
        const usernameColor = getEloColor(teammateElo);

        recommendationEl.innerHTML = `Looking for a teammate? Consider <span class="recommendation-highlight" style="color: ${usernameColor};">${bestTeammate.username}</span> (ELO: ${teammateElo})`;
    } else {
        recommendationEl.textContent = `No available teammates found. More players needed on DUOS ladder!`;
    }
}

// Helper function for solo ladder recommendation
async function handleSoloRecommendation(username, ladderCollection, recommendationEl) {
    const playersRef = collection(db, ladderCollection);
    const playerQuery = query(playersRef, where('username', '==', username));
    const playerSnapshot = await getDocs(playerQuery);

    if (playerSnapshot.empty) {
        const ladderName = ladderCollection === 'players' ? 'D1' : 
                         ladderCollection === 'playersD2' ? 'D2' : 'D3';
        recommendationEl.textContent = `You're not registered on the ${ladderName} ladder`;
        return;
    }

    const playerData = playerSnapshot.docs[0].data();
    const userElo = parseInt(playerData.eloRating) || 1500;
    const userRankTier = getPlayerRankName(userElo);

    // Get all players to find best match
    const allPlayersSnapshot = await getDocs(playersRef);
    let bestMatch = null;
    let bestMatchScore = -1;

    allPlayersSnapshot.forEach(doc => {
        const potentialOpponent = doc.data();
        if (potentialOpponent.username === username) return; // Skip self

        const opponentElo = parseInt(potentialOpponent.eloRating) || 1500;
        const opponentRankTier = getPlayerRankName(opponentElo);
        const eloDifference = Math.abs(opponentElo - userElo);

        // Calculate expected ELO gain using the ELO formula
        const K = 32;
        const expectedScore = 1 / (1 + Math.pow(10, (opponentElo - userElo) / 400));
        const potentialEloGain = Math.round(K * (1 - expectedScore));

        // Skip opponents where you wouldn't gain any ELO
        if (potentialEloGain <= 0) return;

        // Calculate match quality score
        const proximityScore = Math.max(0, 100 - (eloDifference * 0.5));
        const gainScore = potentialEloGain >= 3 && potentialEloGain <= 8 ? 50 : 
                         potentialEloGain > 0 && potentialEloGain < 15 ? 30 : 10;
        const tierBonus = userRankTier === opponentRankTier ? 40 : 0;
        const matchScore = proximityScore + gainScore + tierBonus;

        // Update best match if we found a better one
        if (matchScore > bestMatchScore) {
            bestMatch = potentialOpponent;
            bestMatchScore = matchScore;
        }
    });

    if (bestMatch) {
        const opponentElo = parseInt(bestMatch.eloRating) || 1500;
        const usernameColor = getEloColor(opponentElo);

        recommendationEl.innerHTML = `Based on your ELO (${userElo}), you should be playing <span class="recommendation-highlight" style="color: ${usernameColor};">${bestMatch.username}</span>`;
    } else {
        recommendationEl.innerHTML = `No ideal opponent found for your current ELO (${userElo})`;
    }
}

// Helper function to get ELO-based color
function getEloColor(elo) {
    if (elo >= 2000) return '#50C878'; // Emerald
    if (elo >= 1800) return '#FFD700'; // Gold
    if (elo >= 1600) return '#b9f1fc'; // Silver
    if (elo >= 1400) return '#CD7F32'; // Bronze
    return 'gray'; // Unranked
}

// Admin check function
async function checkIfUserIsAdmin(user) {
    if (!user) return false;
    
    try {
        // Check admin emails first
        const adminEmails = ['admin@ladder.com', 'brian2af@outlook.com'];
        if (user.email && adminEmails.includes(user.email.toLowerCase())) {
            return true;
        }
        
        // Check for admin roles in database
        const collections = ['userProfiles', 'players', 'playersD2', 'playersD3'];
        const adminRoles = ['admin', 'owner', 'council', 'creative lead'];
        
        for (const collectionName of collections) {
            try {
                const docRef = doc(db, collectionName, user.uid);
                const docSnap = await getDoc(docRef);
                
                if (docSnap.exists()) {
                    const userData = docSnap.data();
                    const roleName = (userData.roleName || userData.role || '').toLowerCase();
                    
                    if (roleName && adminRoles.includes(roleName)) {
                        return true;
                    }
                }
            } catch (err) {
                console.warn(`Error checking ${collectionName}:`, err);
            }
        }
        
        return false;
    } catch (error) {
        console.error('Error checking admin status:', error);
        return false;
    }
}

// Show admin-only message for restricted features
function showAdminOnlyMessage() {
    // Remove any existing message
    const existingMessage = document.getElementById('admin-only-message');
    if (existingMessage) {
        existingMessage.remove();
    }
    
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

// Initialize DUOS admin-only restrictions
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
                        d1Radio.dispatchEvent(new Event('change'));
                    }
                    
                    showAdminOnlyMessage();
                    return false;
                }
            }
        });
        
        // Disable the radio button visually for non-admins
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
    
    // Initialize ladder toggles and default ladder
    initLadderToggles();
    displayLadder();
    findBestOpponent('d1');
    
    // Show only D1 recommendation initially
    const d1RecommendationText = document.getElementById('elo-recommendation-text-d1');
    if (d1RecommendationText) d1RecommendationText.style.display = 'block';
});

// Listen for auth state changes to update recommendations
auth.onAuthStateChanged(user => {
    // Get current active ladder
    const d1Active = document.getElementById('d1-ladder-container') && 
                     document.getElementById('d1-ladder-container').style.display !== 'none';
    const d2Active = document.getElementById('d2-ladder-container') && 
                     document.getElementById('d2-ladder-container').style.display !== 'none';
    const d3Active = document.getElementById('d3-ladder-container') && 
                     document.getElementById('d3-ladder-container').style.display !== 'none';
    const duosActive = document.getElementById('duos-ladder-container') && 
                       document.getElementById('duos-ladder-container').style.display !== 'none';

    const currentLadder = d1Active ? 'd1' : d2Active ? 'd2' : d3Active ? 'd3' : duosActive ? 'duos' : 'd1';
    findBestOpponent(currentLadder);
});

// Export functions for external use
export { displayLadder };