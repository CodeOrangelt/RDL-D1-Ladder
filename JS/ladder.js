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
import { displayLadderD2 } from './ladderd2.js';
import { displayLadderD3 } from './ladderd3.js'; 
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const auth = getAuth();

// Add caching system like D2/D3 ladders
const playerCache = {
    data: null,
    timestamp: 0
};
const CACHE_DURATION = 30000; // 30 seconds cache validity

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

// Calculate how many days a player has been in first place
function calculateStreakDays(firstPlaceDate) {
    if (!firstPlaceDate) return 0;
    
    // Convert Firebase timestamp to JavaScript Date if needed
    let dateObj;
    if (firstPlaceDate.seconds) {
        // It's a Firebase Timestamp
        dateObj = new Date(firstPlaceDate.seconds * 1000);
    } else if (firstPlaceDate instanceof Date) {
        // It's already a Date object
        dateObj = firstPlaceDate;
    } else if (typeof firstPlaceDate === 'string') {
        // It's a date string
        dateObj = new Date(firstPlaceDate);
    } else {
        // Unknown format
        console.error('Unknown date format for firstPlaceDate:', firstPlaceDate);
        return 0;
    }
    
    // Calculate difference in days
    const now = new Date();
    const diffTime = Math.abs(now - dateObj);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays;
}

// Function to create HTML for a single player row
function createPlayerRow(player, stats) {
    const elo = parseFloat(player.elo) || 0;
    
    // Set ELO-based colors
    let usernameColor = 'gray'; // Default for unranked
    if (elo >= 2000) {
        usernameColor = '#50C878'; // Emerald Green
    } else if (elo >= 1800) {
        usernameColor = '#FFD700'; // Gold
    } else if (elo >= 1600) {
        usernameColor = '#C0C0C0'; // Silver
    } else if (elo >= 1400) {
        usernameColor = '#CD7F32'; // Bronze
    }
    
    // Create streak HTML if player is #1
    let streakHtml = '';
    if (player.position === 1 && player.firstPlaceDate) {
        const streakDays = calculateStreakDays(player.firstPlaceDate);
        if (streakDays > 0) {
            streakHtml = `<span style="position: absolute; left: -35px; top: 50%; transform: translateY(-50%); font-size:0.9em; color:#FF4500;">${streakDays}d</span>`;
        }
    }
    
    // Create flag HTML if player has country
    let flagHtml = '';
    if (player.country) {
        flagHtml = `<img src="../images/flags/${player.country.toLowerCase()}.png" 
                        alt="${player.country}" 
                        class="player-flag" 
                        style="margin-left: 5px; vertical-align: middle;"
                        onerror="this.style.display='none'">`;
    }
    
    return `
    <tr>
        <td>${player.position}</td>
        <td style="position: relative;">
            <div style="display: flex; align-items: center; position: relative;">
                ${streakHtml}
                <a href="profile.html?username=${encodeURIComponent(player.username)}&ladder=d1" 
                   style="color: ${usernameColor}; text-decoration: none;">
                    ${player.username}
                </a>
                ${flagHtml}
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

// Add this function to determine the player's rank name by ELO
function getPlayerRankName(elo) {
    if (elo >= 2000) return 'Emerald';
    if (elo >= 1800) return 'Gold';
    if (elo >= 1600) return 'Silver';
    if (elo >= 1400) return 'Bronze';
    return 'Unranked';
}

// Add this function right before updateLadderDisplay function (around line 280)

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
        
        
        // Query for ELO history
        const eloHistoryRef = collection(db, 'eloHistory');
        const eloQuery = query(eloHistoryRef, orderBy('timestamp', 'desc'), limit(300));
        const eloSnapshot = await getDocs(eloQuery);
        
        if (eloSnapshot.empty) {
            console.log('ELO history collection is empty');
            return changes;
        }
                
        // Log sample entry structure
        if (eloSnapshot.docs.length > 0) {
            const sample = eloSnapshot.docs[0].data();
            // Check if the player field is a user ID
            if (sample.player && userIdToUsername.has(sample.player)) {
            }
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
                    // Calculate ELO change from available fields
                    let eloChange;
                    
                    if (recentEntry.change !== undefined) {
                        eloChange = parseInt(recentEntry.change);
                    } else if (recentEntry.newElo !== undefined && entry.previousElo !== undefined) {
                        eloChange = parseInt(recentEntry.newElo) - parseInt(recentEntry.previousElo);
                    } else if (recentEntry.newEloRating !== undefined && entry.oldEloRating !== undefined) {
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

// Updated to use batch HTML creation
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
    
    // Create all rows at once for better performance
    const rowsHtml = ladderData.map(player => {
        // Get pre-fetched stats from our batch operation
        const stats = matchStatsBatch.get(player.username) || {
            totalMatches: 0, wins: 0, losses: 0, 
            kda: 0, winRate: 0, totalKills: 0, totalDeaths: 0
        };
        
        return createPlayerRow(player, stats);
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
                            indicator.style.fontSize = '0.85em'; // Make slightly larger
                            indicator.style.display = 'inline'; // Ensure it's displayed
                            indicator.style.visibility = 'visible';
                            indicator.style.opacity = '1';
                        } else {
                        }
                    }
                }
            });
        })
        .catch(error => console.error('Error updating ELO trend indicators:', error));
}

// Update the ladder toggle function to properly handle container visibility
function initLadderToggles() {
    console.log("Initializing ladder toggles...");
    
    const d1Toggle = document.getElementById('d1-switch');
    const d2Toggle = document.getElementById('d2-switch');
    const d3Toggle = document.getElementById('d3-switch');
    
    const d1Container = document.getElementById('d1-ladder-container');
    const d2Container = document.getElementById('d2-ladder-container');
    const d3Container = document.getElementById('d3-ladder-container');
    
    function hideAllLadders() {
        // First, remove active class from all containers
        if (d1Container) d1Container.classList.remove('active');
        if (d2Container) d2Container.classList.remove('active');
        if (d3Container) d3Container.classList.remove('active');
        
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
    
    // Similarly update the D2 and D3 button event listeners
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
}

// Add document ready event to initialize everything
document.addEventListener('DOMContentLoaded', () => {
    initLadderToggles();
    displayLadder();  // Initial display of the ladder
    findBestOpponent('d1'); // Initial opponent recommendation
    
    // Show only D1 recommendation initially (D1 is the default ladder)
    document.getElementById('elo-recommendation-text-d1').style.display = 'block';
});

// Export the displayLadder function so it can be called from other modules
export { displayLadder };

// Add this function to ladder.js
// Add this after the updateLadderDisplay function

// Find the best opponent for the current user
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
        const ladderCollection = currentLadder === 'd1' ? 'players' : 
                               currentLadder === 'd2' ? 'playersD2' : 'playersD3';
        
        // Get the user's ELO from the appropriate ladder
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
        let bestMatchScore = -1; // Use a score-based approach instead
        
        // Get user's rank tier
        const userRankTier = getPlayerRankName(userElo);
        
        allPlayersSnapshot.forEach(doc => {
            const potentialOpponent = doc.data();
            
            // Skip if this is the current user
            if (potentialOpponent.username === username) return;
            
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
            
            // Calculate match quality score - balances closeness and potential gain
            // Lower ELO difference is better, but we still want some gain
            // Perfect score would be someone very close to your ELO but slightly higher
            let matchScore = 0;
            
            // 1. Base score from ELO proximity - closer is better
            // Maximum proximity score for players within 100 ELO points
            const proximityScore = Math.max(0, 100 - (eloDifference * 0.5));
            
            // 2. ELO gain score - some gain is good, but we don't want to overweight it
            // Maximum gain score for 5-10 point gains
            const gainScore = potentialEloGain >= 3 && potentialEloGain <= 8 ? 50 : 
                             potentialEloGain > 0 && potentialEloGain < 15 ? 30 : 10;
            
            // 3. Same rank tier bonus
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
            
            // Set ELO-based colors (same logic used in createPlayerRow)
            let usernameColor = 'gray'; // Default for unranked
            if (opponentElo >= 2000) {
                usernameColor = '#50C878'; // Emerald Green
            } else if (opponentElo >= 1800) {
                usernameColor = '#FFD700'; // Gold
            } else if (opponentElo >= 1600) {
                usernameColor = '#C0C0C0'; // Silver
            } else if (opponentElo >= 1400) {
                usernameColor = '#CD7F32'; // Bronze
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
    const d1Active = document.getElementById('d1-ladder-container').classList.contains('active');
    const d2Active = document.getElementById('d2-ladder-container').classList.contains('active');
    const d3Active = document.getElementById('d3-ladder-container').classList.contains('active');
    
    const currentLadder = d1Active ? 'd1' : d2Active ? 'd2' : 'd3';
    findBestOpponent(currentLadder);
});