import { db } from './firebase-config.js';
import { collection, getDocs, query, where, orderBy, setDoc, doc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

document.addEventListener('DOMContentLoaded', () => {
    // Setup modal structure
    setupModalStructure();
    
    // Setup button event listeners
    const season0Btn = document.getElementById('season0-btn');
    if (season0Btn) {
        season0Btn.addEventListener('click', async () => {
            const ladderData = await prepareSeason0LadderData();
            showModal('Season 0 Ladder (Final Standings)', ladderData);
        });
    }
    
    const season0StatsBtn = document.getElementById('season0-stats-btn');
    if (season0StatsBtn) {
        season0StatsBtn.addEventListener('click', async () => {
            const statsData = await prepareSeason0StatsData();
            showModal('Season 0 Stats', statsData);
        });
    }
    
    const season0MatchesBtn = document.getElementById('season0-matches-btn');
    if (season0MatchesBtn) {
        season0MatchesBtn.addEventListener('click', async () => {
            const matchesData = await prepareSeason0MatchesData();
            showModal('Season 0 Matches', matchesData);
        });
    }
    
    // Setup modal close button
    const closeBtn = document.querySelector('.close-modal');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeModal);
    }
    
    // Close modal when clicking outside of modal content
    window.addEventListener('click', (event) => {
        const modal = document.getElementById('data-modal');
        if (event.target === modal) {
            closeModal();
        }
    });

    // Example: call snapshotSeason0() when the archive button is clicked.
    document.getElementById("archive-season0-btn")?.addEventListener("click", async () => {
        const success = await snapshotSeason0();
        if (success) {
            alert("Season 0 archived successfully! You can now reset for a new season.");
        } else {
            alert("Error archiving Season 0. See console for details.");
        }
    });
});

// Function to prepare Season 0 ladder data
async function prepareSeason0LadderData() {
    try {
        // Using the db reference correctly
        const playersRef = collection(db, "players");
        const playersQuery = query(playersRef, orderBy("elo", "desc"));
        const playersSnapshot = await getDocs(playersQuery);
        
        // Create the table HTML
        let tableHTML = `
            <table class="modal-table">
                <thead>
                    <tr>
                        <th>Rank</th>
                        <th>Username</th>
                        <th>ELO</th>
                        <th>W-L</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        let rank = 1;
        playersSnapshot.forEach((doc) => {
            const player = doc.data();
            // Only include players who have played at least one match
            if (player.wins > 0 || player.losses > 0) {
                tableHTML += `
                    <tr>
                        <td>${rank}</td>
                        <td>${player.username}</td>
                        <td>${Math.round(player.elo)}</td>
                        <td>${player.wins}-${player.losses}</td>
                    </tr>
                `;
                rank++;
            }
        });
        
        tableHTML += `
                </tbody>
            </table>
        `;
        
        return tableHTML;
    } catch (error) {
        console.error("Error loading ladder data:", error);
        return `<p class="error-message">Error loading ladder data: ${error.message}</p>`;
    }
}

// Function to prepare Season 0 stats data
async function prepareSeason0StatsData() {
    try {
        const playersRef = collection(db, "players");
        const playersSnapshot = await getDocs(playersRef);
        
        let mostWins = { count: 0, player: "" };
        let bestWinRate = { rate: 0, player: "", games: 0 };
        let bestKD = { ratio: 0, player: "", kills: 0, deaths: 0 };
        
        playersSnapshot.forEach((doc) => {
            const player = doc.data();
            const totalGames = player.wins + player.losses;
            
            // Most wins
            if (player.wins > mostWins.count) {
                mostWins.count = player.wins;
                mostWins.player = player.username;
            }
            
            // Best win rate (minimum 5 games)
            if (totalGames >= 5) {
                const winRate = (player.wins / totalGames) * 100;
                if (winRate > bestWinRate.rate) {
                    bestWinRate.rate = winRate;
                    bestWinRate.player = player.username;
                    bestWinRate.games = totalGames;
                }
            }
            
            // Best K/D ratio (minimum 10 kills)
            if (player.kills >= 10) {
                const kdRatio = player.deaths > 0 ? player.kills / player.deaths : player.kills;
                if (kdRatio > bestKD.ratio) {
                    bestKD.ratio = kdRatio;
                    bestKD.player = player.username;
                    bestKD.kills = player.kills;
                    bestKD.deaths = player.deaths;
                }
            }
        });
        
        // Create stats HTML
        const statsHTML = `
            <div class="stats-grid">
                <div class="stat-card">
                    <h3>Most Wins</h3>
                    <div class="stat-value">${mostWins.count}</div>
                    <div class="stat-holder">${mostWins.player}</div>
                </div>
                
                <div class="stat-card">
                    <h3>Best Win Rate</h3>
                    <div class="stat-value">${bestWinRate.rate.toFixed(1)}%</div>
                    <div class="stat-holder">${bestWinRate.player} (${bestWinRate.games} games)</div>
                </div>
                
                <div class="stat-card">
                    <h3>Best K/D Ratio</h3>
                    <div class="stat-value">${bestKD.ratio.toFixed(2)}</div>
                    <div class="stat-holder">${bestKD.player} (${bestKD.kills}K/${bestKD.deaths}D)</div>
                </div>
            </div>
        `;
        
        return statsHTML;
    } catch (error) {
        console.error("Error loading stats data:", error);
        return `<p class="error-message">Error loading stats data: ${error.message}</p>`;
    }
}

// Function to prepare Season 0 matches data
async function prepareSeason0MatchesData() {
    try {
        const matchesRef = collection(db, "matches");
        const matchesQuery = query(
            matchesRef, 
            where("status", "==", "approved"),
            orderBy("timestamp", "desc")
        );
        const matchesSnapshot = await getDocs(matchesQuery);
        
        if (matchesSnapshot.empty) {
            return '<p>No matches found.</p>';
        }
        
        // Create matches HTML table
        let matchesHTML = `
            <table class="modal-table">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Winner</th>
                        <th>Loser</th>
                        <th>Score</th>
                    </tr>
                </thead>
                <tbody>`;
                
        matchesSnapshot.forEach((doc) => {
            const match = doc.data();
            // Format date
            const matchDate = match.timestamp ? new Date(match.timestamp.toDate()) : new Date();
            const dateString = matchDate.toLocaleDateString();
            
            matchesHTML += `
                <tr>
                    <td>${dateString}</td>
                    <td>${match.winner}</td>
                    <td>${match.loser}</td>
                    <td>${match.winnerScore} - ${match.loserScore}</td>
                </tr>`;
        });
        
        matchesHTML += `
                </tbody>
            </table>
        `;
        
        return matchesHTML;
        
    } catch (error) {
        console.error("Error loading matches data:", error);
        return `<p class="error-message">Error loading matches data: ${error.message}</p>`;
    }
}

// Function to setup modal structure
function setupModalStructure() {
    // Create modal elements if they don't exist
    if (!document.getElementById('data-modal')) {
        const modalHTML = `
            <div id="data-modal" class="modal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h2 id="modal-title">Title</h2>
                        <span class="close-modal">&times;</span>
                    </div>
                    <div id="modal-body" class="modal-body">
                        <!-- Content will be inserted here -->
                    </div>
                </div>
            </div>
        `;
        
        // Add modal HTML to the body
        const modalContainer = document.createElement('div');
        modalContainer.innerHTML = modalHTML;
        document.body.appendChild(modalContainer);
        
        // Add modal styles
        const styleElement = document.createElement('style');
        styleElement.textContent = `
            .modal {
                display: none;
                position: fixed;
                z-index: 1000;
                left: 0;
                top: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 0, 0, 0.7);
                overflow: auto;
            }
            
            .modal-content {
                background-color: #2c2c2c;
                margin: 5% auto;
                padding: 20px;
                border: 1px solid #444;
                width: 80%;
                max-width: 900px;
                border-radius: 8px;
                box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
            }
            
            .modal-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid #444;
                padding-bottom: 10px;
                margin-bottom: 20px;
            }
            
            .close-modal {
                color: #aaa;
                font-size: 28px;
                font-weight: bold;
                cursor: pointer;
            }
            
            .close-modal:hover {
                color: #f8c300;
            }
            
            .modal-body {
                max-height: 70vh;
                overflow-y: auto;
            }
            
            .modal-table {
                width: 100%;
                border-collapse: collapse;
            }
            
            .modal-table th, .modal-table td {
                padding: 10px;
                border-bottom: 1px solid #444;
                text-align: left;
            }
            
            .stats-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                gap: 20px;
            }
            
            .stat-card {
                background-color: #333;
                padding: 20px;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            }
            
            .stat-value {
                font-size: 2rem;
                font-weight: bold;
                color: #f8c300;
                margin: 10px 0;
            }
            
            .stat-holder {
                font-style: italic;
            }
            
            .error-message {
                color: #ff6b6b;
                font-weight: bold;
                padding: 10px;
                background-color: rgba(255, 107, 107, 0.1);
                border-radius: 5px;
            }
        `;
        document.head.appendChild(styleElement);
    }
}

// Function to show modal with content
function showModal(title, content) {
    const modal = document.getElementById('data-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');
    
    if (!modal || !modalTitle || !modalBody) {
        console.error("Modal elements not found");
        return;
    }
    
    modalTitle.textContent = title;
    modalBody.innerHTML = content;
    
    modal.style.display = 'block';
}

// Function to close modal
function closeModal() {
    const modal = document.getElementById('data-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Function to snapshot Season 0 data
async function snapshotSeason0() {
    try {
        console.log("snapshotSeason0(): Started");
        const seasonData = {};

        // 1. Ladder history snapshot (players ordered by ELO)
        const playersRef = collection(db, "players");
        const ladderQuery = query(playersRef, orderBy("elo", "desc"));
        const playersSnapshot = await getDocs(ladderQuery);
        seasonData.ladder = [];
        if (playersSnapshot.empty) {
            console.warn("No player documents found in the players collection.");
        }
        playersSnapshot.forEach((playerDoc) => {
            seasonData.ladder.push({ id: playerDoc.id, ...playerDoc.data() });
        });
        console.log(`Ladder: Found ${seasonData.ladder.length} players`);

        // 2. Stats snapshot (parsing from records.html)
        const recordsStatsElement = document.getElementById("records-stats");
        if (recordsStatsElement) {
            seasonData.stats = recordsStatsElement.innerText;
            console.log("Stats loaded from records element:", seasonData.stats);
        } else {
            seasonData.stats = "Stats not available";
            console.warn("records-stats element not found in the DOM.");
        }

        // 3. Match history snapshot (from approvedMatches collection)
        const matchesRef = collection(db, "approvedMatches");
        const matchesQuery = query(matchesRef, orderBy("timestamp", "desc"));
        const matchesSnapshot = await getDocs(matchesQuery);
        seasonData.matches = [];
        if (matchesSnapshot.empty) {
            console.warn("No approved match documents found in approvedMatches collection.");
        }
        matchesSnapshot.forEach((matchDoc) => {
            seasonData.matches.push({ id: matchDoc.id, ...matchDoc.data() });
        });
        console.log(`Matches: Found ${seasonData.matches.length} approved matches`);

        // Store the snapshot for Season 0 in a dedicated document
        await setDoc(doc(db, "seasons", "season0"), {
            archivedAt: new Date(),
            ...seasonData
        });
        console.log("Season 0 archived successfully.", seasonData);
        return true;
    } catch (error) {
        console.error("Error archiving Season 0:", error);
        return false;
    }
}