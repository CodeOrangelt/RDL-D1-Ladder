// Language: JavaScript
import { 
    collection, 
    getDocs, 
    query, 
    orderBy, 
    where, 
    limit, 
    doc, 
    getDoc, 
    updateDoc, 
    Timestamp, 
    onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from './firebase-config.js';

// Display the D2 ladder when the page loads
document.addEventListener('DOMContentLoaded', () => {
    // Only run displayLadder if we're on a page with the ladder-d2 element
    if (document.querySelector('#ladder-d2')) {
        displayLadderD2();
    }
    
    // Always set up the raw ladder feed listener
    setupRawLadderFeed();
});

async function displayLadderD2() {
    const tableBody = document.querySelector('#ladder-d2 tbody');
    if (!tableBody) {
        console.error('D2 Ladder table body not found');
        return;
    }

    try {
        const playersRef = collection(db, 'playersD2');
        const querySnapshot = await getDocs(playersRef);
        
        // Convert to array and filter out test players
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

        // Sort players by position
        players.sort((a, b) => {
            if (!a.position) return 1;
            if (!b.position) return -1;
            return a.position - b.position;
        });

        // Reassign positions sequentially
        players.forEach((player, index) => {
            player.position = index + 1;
        });

        // Update the display
        updateLadderDisplay(players);

    } catch (error) {
        console.error("Error loading D2 ladder:", error);
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; color: red;">
                    Error loading D2 ladder data: ${error.message}
                </td>
            </tr>
        `;
    }
}

// Helper function to get the next available position
function getNextAvailablePosition(players) {
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

        // Only update positions if winner is below loser
        if (winner.position > loser.position) {
            const winnerNewPosition = loser.position;
            
            // Update positions for players between winner and loser
            for (const player of players) {
                if (player.position >= loser.position && player.position < winner.position) {
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

            // Inside updatePlayerPositions function, after updating winner's position
            if (winnerNewPosition === 1) {
                // Check if this is the first time reaching #1
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
        }
    } catch (error) {
        console.error("Error updating player positions:", error);
    }
}

// Helper function to calculate streak days
function calculateStreakDays(startDate) {
    if (!startDate) return 0;
    const start = startDate.toDate();
    const now = new Date();
    const diffTime = Math.abs(now - start);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

async function updateLadderDisplay(ladderData) {
    // Sort by position before displaying
    ladderData.sort((a, b) => a.position - b.position);
    
    const tbody = document.querySelector('#ladder-d2 tbody');
    tbody.innerHTML = '';
    
    // Update the table header with new columns
    const thead = document.querySelector('#ladder-d2 thead tr');
    thead.innerHTML = `
        <th>Rank</th>
        <th>Username</th>
        <th>Matches</th>
        <th>Wins</th>
        <th>Losses</th>
        <th>K/D</th>
        <th>Win Rate</th>
    `;
    
    for (const player of ladderData) {
        const row = document.createElement('tr');
        
        // Create rank cell
        const rankCell = document.createElement('td');
        rankCell.textContent = player.position;
        
        // Create username cell with styling
        const usernameCell = document.createElement('td');
        const usernameLink = document.createElement('a');
        usernameLink.href = `profile.html?username=${encodeURIComponent(player.username)}`;
        usernameLink.textContent = player.username;
        
        // Set ELO-based colors
        const elo = parseFloat(player.elo) || 0;
        if (elo >= 2100) {
            usernameLink.style.color = '#50C878';
            if (player.position === 1) {
                usernameLink.style.textShadow = '0 0 5px #50C878';
                usernameLink.style.animation = 'glow 2s ease-in-out infinite';
                
                // Add streak display for #1 position
                if (player.firstPlaceDate) {
                    const streakDays = calculateStreakDays(player.firstPlaceDate);
                    if (streakDays > 0) {
                        const streakSpan = document.createElement('span');
                        streakSpan.innerHTML = ` 🔥 ${streakDays}d`;
                        streakSpan.style.fontSize = '0.9em';
                        streakSpan.style.color = '#FF4500';
                        streakSpan.style.marginLeft = '5px';
                        usernameCell.appendChild(streakSpan);
                    }
                }
            }
        } else if (elo >= 1800) {
            usernameLink.style.color = '#FFD700';
        } else if (elo >= 1600) {
            usernameLink.style.color = '#C0C0C0';
        } else if (elo >= 1400) {
            usernameLink.style.color = '#CD7F32';
        } else {
            usernameLink.style.color = 'gray';
        }
        
        usernameLink.style.textDecoration = 'none';
        usernameCell.appendChild(usernameLink);

        // Get match history for the player
        const approvedMatchesRef = collection(db, 'approvedMatchesD2'); // Use D2-specific matches
        const [winnerMatches, loserMatches] = await Promise.all([
            getDocs(query(approvedMatchesRef, where('winnerUsername', '==', player.username))),
            getDocs(query(approvedMatchesRef, where('loserUsername', '==', player.username)))
        ]);

        // Calculate stats from matches
        let stats = {
            wins: winnerMatches.size,
            losses: loserMatches.size,
            totalKills: 0,
            totalDeaths: 0,
            totalMatches: winnerMatches.size + loserMatches.size,
            kda: 0,
            winRate: 0
        };

        // Calculate kills and deaths from matches
        winnerMatches.forEach(doc => {
            const match = doc.data();
            stats.totalKills += parseInt(match.winnerScore) || 0;
            stats.totalDeaths += parseInt(match.loserScore) || 0;
        });

        loserMatches.forEach(doc => {
            const match = doc.data();
            stats.totalKills += parseInt(match.loserScore) || 0;
            stats.totalDeaths += parseInt(match.winnerScore) || 0;
        });

        // Calculate KDA ratio
        stats.kda = stats.totalDeaths > 0 ? 
            (stats.totalKills / stats.totalDeaths).toFixed(2) : 
            stats.totalKills;

        // Calculate win rate
        stats.winRate = stats.totalMatches > 0 ? 
            ((stats.wins / stats.totalMatches) * 100).toFixed(1) : 0;

        // Create cells with new stats
        const matchesCell = document.createElement('td');
        matchesCell.textContent = stats.totalMatches;

        const winsCell = document.createElement('td');
        winsCell.textContent = stats.wins;
        
        const lossesCell = document.createElement('td');
        lossesCell.textContent = stats.losses;
        
        const kdaCell = document.createElement('td');
        kdaCell.textContent = stats.kda;
        
        const winRateCell = document.createElement('td');
        winRateCell.textContent = `${stats.winRate}%`;
        
        // Add all cells to row
        row.appendChild(rankCell);
        row.appendChild(usernameCell);
        row.appendChild(matchesCell);
        row.appendChild(winsCell);
        row.appendChild(lossesCell);
        row.appendChild(kdaCell);
        row.appendChild(winRateCell);
        
        tbody.appendChild(row);
    }
}

// Simplified function to create and update raw ladder feed for D2
function setupRawLadderFeed() {
    const playersRef = collection(db, 'playersD2');
    
    // Set up real-time listener for player changes
    onSnapshot(playersRef, (snapshot) => {
        try {
            console.log("Raw D2 leaderboard snapshot received");
            
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
            let rawText = 'NGS D2 LADDER - RAW DATA\n\n';
            players.forEach(player => {
                rawText += `${player.position}. ${player.username} (${player.elo})\n`;
            });
            
            // Update the page content if we're on the raw leaderboard page
            if (window.location.pathname.includes('rawleaderboardD2.html')) {
                console.log("Updating raw D2 leaderboard content");
                document.body.innerText = rawText;
            }
        } catch (error) {
            console.error("Error updating raw D2 ladder feed:", error);
            if (window.location.pathname.includes('rawleaderboardD2.html')) {
                document.body.innerText = `Error loading ladder data: ${error.message}`;
            }
        }
    });
}

export { displayLadderD2, updatePlayerPositions };