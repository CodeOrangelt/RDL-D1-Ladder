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

// Add these variables at the top of your file to implement caching
const playerCache = {
    d1: { data: null, timestamp: 0 },
    d2: { data: null, timestamp: 0 }
};
const CACHE_DURATION = 30000; // 30 seconds cache validity

// Optimized display function with caching and batching
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
        if (!forceRefresh && playerCache.d1.data && (now - playerCache.d1.timestamp < CACHE_DURATION)) {
            console.log('Using cached D1 ladder data');
            updateLadderDisplay(playerCache.d1.data);
            return;
        }
        
        // Query players with server-side ordering for efficiency
        const playersRef = collection(db, 'players');
        const orderedQuery = query(playersRef, orderBy('position', 'asc'));
        const querySnapshot = await getDocs(orderedQuery);
        
        // Process players in a single pass
        const players = [];
        querySnapshot.forEach((doc) => {
            const playerData = doc.data();
            if (playerData.username) { // Ensure valid player
                players.push({
                    ...playerData,
                    id: doc.id,
                    elo: playerData.eloRating || 0,
                    position: playerData.position || Number.MAX_SAFE_INTEGER
                });
            }
        });
        
        // Cache the results
        playerCache.d1.data = players;
        playerCache.d1.timestamp = now;
        
        // Update display
        updateLadderDisplay(players);
        
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

// Optimized updateLadderDisplay function
async function updateLadderDisplay(ladderData) {
    const tbody = document.querySelector('#ladder tbody');
    if (!tbody) return;
    
    // Clear any existing content
    tbody.innerHTML = '';
    
    // Get all usernames for batch processing
    const usernames = ladderData.map(p => p.username);
    
    // Prefetch all match statistics in a single batch operation
    const matchStatsBatch = await fetchBatchMatchStats(usernames);
    
    // Batch fetch ELO changes to reduce reads
    const eloChangesBatch = await fetchBatchEloChanges(usernames);
    
    // Update table header
    updateTableHeader();
    
    // Create all rows at once for better performance
    const rowsHtml = ladderData.map(player => {
        // Get pre-fetched stats from our batch operation
        const stats = matchStatsBatch.get(player.username) || {
            totalMatches: 0, wins: 0, losses: 0, 
            kda: 0, winRate: 0, totalKills: 0, totalDeaths: 0
        };
        
        // Get ELO change from batch
        const eloChange = eloChangesBatch.get(player.username) || 0;
        
        // Create the row using string concatenation for speed
        return createPlayerRow(player, stats, eloChange);
    }).join('');
    
    // Append all rows at once (much faster than individual DOM operations)
    tbody.innerHTML = rowsHtml;
}

// Helper function to fetch all match stats at once
async function fetchBatchMatchStats(usernames) {
    const matchStats = new Map();
    
    try {
        // Create two queries and execute them in parallel
        const approvedMatchesRef = collection(db, 'approvedMatches');
        
        // Use Promise.all for parallel execution of multiple queries
        const matchPromises = usernames.map(username => {
            return Promise.all([
                getDocs(query(approvedMatchesRef, 
                    where('winnerUsername', '==', username),
                    limit(100))), // Limit for optimization
                getDocs(query(approvedMatchesRef, 
                    where('loserUsername', '==', username),
                    limit(100)))
            ]);
        });
        
        const results = await Promise.all(matchPromises);
        
        // Process results efficiently
        results.forEach((userMatches, index) => {
            const username = usernames[index];
            const [winnerMatches, loserMatches] = userMatches;
            
            // Calculate stats
            let wins = winnerMatches.size;
            let losses = loserMatches.size;
            let totalKills = 0;
            let totalDeaths = 0;
            
            // Process winner matches
            winnerMatches.forEach(doc => {
                const match = doc.data();
                totalKills += parseInt(match.winnerScore) || 0;
                totalDeaths += parseInt(match.loserScore) || 0;
            });
            
            // Process loser matches
            loserMatches.forEach(doc => {
                const match = doc.data();
                totalKills += parseInt(match.loserScore) || 0;
                totalDeaths += parseInt(match.winnerScore) || 0;
            });
            
            // Calculate derived stats
            const totalMatches = wins + losses;
            const kda = totalDeaths > 0 ? 
                (totalKills / totalDeaths).toFixed(2) : totalKills.toString();
            const winRate = totalMatches > 0 ? 
                ((wins / totalMatches) * 100).toFixed(1) : "0.0";
                
            // Store stats
            matchStats.set(username, {
                wins, losses, totalKills, totalDeaths,
                totalMatches, kda, winRate
            });
        });
    } catch (error) {
        console.error("Error batch fetching match stats:", error);
    }
    
    return matchStats;
}

// Add this function after fetchBatchMatchStats

// Helper function to batch fetch ELO changes for efficiency
async function fetchBatchEloChanges(usernames) {
    const eloChanges = new Map();
    
    try {
        // Reference to ELO history collection
        const eloHistoryRef = collection(db, 'eloHistory');
        
        // Get the timestamp for 24 hours ago
        const oneDayAgo = new Date();
        oneDayAgo.setDate(oneDayAgo.getDate() - 1);
        
        // Execute queries in parallel for all usernames
        const eloPromises = usernames.map(username => {
            return getDocs(query(
                eloHistoryRef,
                where('username', '==', username),
                where('timestamp', '>=', Timestamp.fromDate(oneDayAgo)),
                orderBy('timestamp', 'desc'),
                limit(20) // Limit for optimization
            ));
        });
        
        const results = await Promise.all(eloPromises);
        
        // Process results and calculate net ELO change
        results.forEach((snapshot, index) => {
            const username = usernames[index];
            let netChange = 0;
            
            if (!snapshot.empty) {
                // Get the most recent and oldest ELO values within time window
                const eloEntries = [];
                snapshot.forEach(doc => {
                    eloEntries.push({
                        elo: doc.data().newElo || 0,
                        timestamp: doc.data().timestamp?.toDate() || new Date()
                    });
                });
                
                // Sort by timestamp (newest to oldest)
                eloEntries.sort((a, b) => b.timestamp - a.timestamp);
                
                // Calculate change if we have at least 2 entries
                if (eloEntries.length >= 2) {
                    const newest = eloEntries[0].elo;
                    const oldest = eloEntries[eloEntries.length - 1].elo;
                    netChange = newest - oldest;
                } else if (eloEntries.length === 1) {
                    // If only one entry, check if it has oldElo field
                    const entry = snapshot.docs[0].data();
                    if (entry.oldElo !== undefined) {
                        netChange = (entry.newElo || 0) - (entry.oldElo || 0);
                    }
                }
            }
            
            eloChanges.set(username, netChange);
        });
    } catch (error) {
        console.error("Error batch fetching ELO changes:", error);
    }
    
    return eloChanges;
}

// Update table header function
function updateTableHeader() {
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
}

// Create player row using string template for performance
function createPlayerRow(player, stats, eloChange) {
    // Set ELO-based colors
    const elo = parseFloat(player.elo) || 0;
    let usernameColor = 'gray';  // default color
    
    if (elo >= 2000) {
        usernameColor = '#50C878';  // Emerald Green
    } else if (elo >= 1800) {
        usernameColor = '#FFD700';  // Gold
    } else if (elo >= 1600) {
        usernameColor = '#C0C0C0';  // Silver
    } else if (elo >= 1400) {
        usernameColor = '#CD7F32';  // Bronze
    }
    
    // Special styling for #1 position
    let streakHtml = '';
    if (player.position === 1 && player.firstPlaceDate && elo >= 2000) {
        const streakDays = calculateStreakDays(player.firstPlaceDate);
        if (streakDays > 0) {
            streakHtml = `<span style="font-size:0.9em; color:#FF4500; margin-left:5px;">🔥 ${streakDays}d</span>`;
        }
    }
    
    // Format ELO change indicator
    let eloIndicator = '';
    if (eloChange !== 0) {
        const sign = eloChange > 0 ? '+' : '';
        const color = eloChange > 0 ? '#4CAF50' : '#F44336';
        eloIndicator = `<span class="trend-indicator" style="color:${color};">${sign}${eloChange}</span>`;
    }
    
    // Construct and return the HTML for this row
    return `
        <tr>
            <td>${player.position}</td>
            <td>
                <a href="profile.html?username=${encodeURIComponent(player.username)}&ladder=d1" 
                   style="color:${usernameColor}; text-decoration:none; 
                   ${player.position === 1 && elo >= 2000 ? 'text-shadow:0 0 5px '+usernameColor+'; animation:glow 2s ease-in-out infinite;' : ''}">
                    ${player.username}
                </a>
                ${streakHtml}
            </td>
            <td style="color:${usernameColor}; position:relative;">
                ${elo}
                ${eloIndicator}
            </td>
            <td>${stats.totalMatches}</td>
            <td>${stats.wins}</td>
            <td>${stats.losses}</td>
            <td>${stats.kda}</td>
            <td>${stats.winRate}%</td>
        </tr>
    `;
}

// Add this helper function at the top level
function calculateStreakDays(startDate) {
    if (!startDate) return 0;
    const start = startDate.toDate();
    const now = new Date();
    const diffTime = Math.abs(now - start);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

async function loadPlayers() {
    const tableBody = document.querySelector('#players-table tbody');
    tableBody.innerHTML = '';

    try {
        const playersRef = collection(db, 'players');
        const playersSnapshot = await getDocs(playersRef);

        playersSnapshot.forEach(doc => {
            const player = doc.data();
            const row = document.createElement('tr');
            
            // Apply color based on ELO rating
            const elo = parseFloat(player.eloRating) || 0;
            let usernameColor = 'gray'; // default color for unranked

            if (elo >= 2000) {
                usernameColor = '#50C878'; // Emerald Green
            } else if (elo >= 1800) {
                usernameColor = '#FFD700'; // Gold
            } else if (elo >= 1600) {
                usernameColor = '#C0C0C0'; // Silver
            } else if (elo >= 1400) {
                usernameColor = '#CD7F32'; // Bronze
            }

            row.innerHTML = `
                <td style="color: ${usernameColor}">${player.username}</td>
                <td style="color: ${usernameColor}">${player.eloRating || 'N/A'}</td>
                <td>
                    <button class="remove-btn" data-id="${doc.id}">Remove</button>
                </td>
            `;
            tableBody.appendChild(row);
        });

        // Add event listeners for remove buttons
        document.querySelectorAll('.remove-btn').forEach(button => {
            button.addEventListener('click', async (e) => {
                if (confirm('Are you sure you want to remove this player?')) {
                    const playerId = e.target.dataset.id;
                    try {
                        await deleteDoc(doc(db, 'players', playerId));
                        loadPlayers(); // Refresh the list
                    } catch (error) {
                        console.error('Error removing player:', error);
                        alert('Failed to remove player');
                    }
                }
            });
        });
    } catch (error) {
        console.error('Error loading players:', error);
        alert('Failed to load players');
    }
}

// Add validation for ELO input if element exists
const eloInput = document.getElementById('new-player-elo');
if (eloInput) {
    eloInput.addEventListener('input', function() {
        const value = parseInt(this.value);
        if (value > 3000) {
            this.value = 3000;
        } else if (value < 0) {
            this.value = 0;
        }
    });
}

/// Simplified function to create and update raw ladder feed
function setupRawLadderFeed() {
    const playersRef = collection(db, 'players');
    
    // Set up real-time listener for player changes
    onSnapshot(playersRef, (snapshot) => {
        try {
            console.log("Raw leaderboard snapshot received");
            
            // Extract player data
            const players = [];
            snapshot.forEach((doc) => {
                const playerData = doc.data();
                players.push({
                    username: playerData.username,
                    elo: parseInt(playerData.eloRating) || 0,
                    position: playerData.position || Number.MAX_SAFE_INTEGER
                });
            });
            
            // Sort players by ELO rating (highest to lowest)
            players.sort((a, b) => b.elo - a.elo);
            
            // Assign positions sequentially
            players.forEach((player, index) => {
                player.position = index + 1;
            });
            
            // Create raw text representation
            let rawText = 'NGS LADDER - RAW DATA\n\n';
            players.forEach(player => {
                rawText += `${player.position}. ${player.username} (${player.elo})\n`;
            });
            
            // Update the page content if we're on the raw leaderboard page
            if (window.location.pathname.includes('../HTML/rawleaderboard.html')) {
                console.log("Updating raw leaderboard content");
                document.body.innerText = rawText;
            }
        } catch (error) {
            console.error("Error updating raw ladder feed:", error);
            if (window.location.pathname.includes('../HTML/rawleaderboard.html')) {
                document.body.innerText = `Error loading ladder data: ${error.message}`;
            }
        }
    });
}

// Add this to the bottom of your file, replacing the current toggle functionality

document.addEventListener('DOMContentLoaded', () => {
    // Only run displayLadder if we're on a page with the ladder element
    if (document.querySelector('#ladder')) {
        displayLadder();
    }
    
    // Always set up the raw ladder feed listener
    setupRawLadderFeed();
    
    // Add debug info for raw leaderboard page
    if (window.location.pathname.includes('../HTML/rawleaderboard.html')) {
        console.log("Raw leaderboard page detected");
    }
    
    // Updated ladder switch functionality for radio buttons
    const d1Switch = document.getElementById('d1-switch');
    const d2Switch = document.getElementById('d2-switch');
    const d1Container = document.getElementById('d1-ladder-container');
    const d2Container = document.getElementById('d2-ladder-container');
    
    if (d1Switch && d2Switch && d1Container && d2Container) {
        // Function to handle ladder switching
        function handleLadderSwitch() {
            if (d1Switch.checked) {
                d1Container.classList.add('active');
                d2Container.classList.remove('active');
                
                // Ensure D1 ladder is displayed
                if (document.querySelector('#ladder')) {
                    displayLadder();
                }
            } else if (d2Switch.checked) {
                d2Container.classList.add('active');
                d1Container.classList.remove('active');
                
                // Ensure D2 ladder is displayed
                if (document.querySelector('#ladder-d2')) {
                    if (typeof displayLadderD2 === 'function') {
                        displayLadderD2();
                    } else {
                        console.error('displayLadderD2 function not found. Make sure ladderd2.js is loaded properly.');
                    }
                }
            }
        }
        
        // Add event listeners
        d1Switch.addEventListener('change', handleLadderSwitch);
        d2Switch.addEventListener('change', handleLadderSwitch);
        
        // Initialize the correct view based on which button is checked
        handleLadderSwitch();
    } else {
        console.warn('Ladder switch elements not found in the DOM');
    }
});