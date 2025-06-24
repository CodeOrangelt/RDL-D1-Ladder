import { 
    collection, 
    getDocs, 
    query, 
    orderBy 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from './firebase-config.js';

class ELOCalculator {
    constructor() {
        this.currentLadder = 'D1';
        this.players = new Map();
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadPlayers();
    }

    setupEventListeners() {
        // Ladder selection buttons
        document.querySelectorAll('.ladder-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                // Update active button
                document.querySelectorAll('.ladder-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                
                // Update current ladder and reload players
                this.currentLadder = e.target.dataset.ladder;
                this.loadPlayers();
            });
        });

        // Refresh button
        document.getElementById('refresh-players').addEventListener('click', () => {
            this.loadPlayers();
        });

        // Player selection dropdowns
        document.getElementById('winner-select').addEventListener('change', () => this.calculateMatch());
        document.getElementById('loser-select').addEventListener('change', () => this.calculateMatch());
    }

    async loadPlayers() {
        try {
            // Show loading state
            this.updateDropdowns('<option value="">Loading players...</option>');
            
            // Determine collection based on ladder
            const collectionName = this.currentLadder === 'D1' ? 'players' : 
                                 this.currentLadder === 'D2' ? 'playersD2' : 'playersD3';
            
            // Query players ordered by ELO descending
            const playersRef = collection(db, collectionName);
            const playersQuery = query(playersRef, orderBy('eloRating', 'desc'));
            const playersSnapshot = await getDocs(playersQuery);
            
            // Clear and rebuild players map
            this.players.clear();
            
            playersSnapshot.forEach(doc => {
                const playerData = doc.data();
                if (playerData.username) {
                    this.players.set(playerData.username, {
                        id: doc.id,
                        username: playerData.username,
                        elo: parseInt(playerData.eloRating) || 1200,
                        position: playerData.position || 999
                    });
                }
            });

            // Update dropdowns with player data
            this.updateDropdowns();
            
            console.log(`Loaded ${this.players.size} players from ${this.currentLadder} ladder`);
            
        } catch (error) {
            console.error('Error loading players:', error);
            this.updateDropdowns('<option value="">Error loading players</option>');
        }
    }

    updateDropdowns(content = null) {
        const winnerSelect = document.getElementById('winner-select');
        const loserSelect = document.getElementById('loser-select');
        
        if (content) {
            winnerSelect.innerHTML = content;
            loserSelect.innerHTML = content;
            return;
        }

        // Build options from players
        let options = '<option value="">Select a player...</option>';
        
        // Sort players by ELO descending for better UX
        const sortedPlayers = Array.from(this.players.values())
            .sort((a, b) => b.elo - a.elo);
        
        sortedPlayers.forEach(player => {
            const rankClass = this.getELORankClass(player.elo);
            options += `<option value="${player.username}" data-elo="${player.elo}" class="${rankClass}">
                ${player.username} (${player.elo} ELO)
            </option>`;
        });
        
        winnerSelect.innerHTML = options;
        loserSelect.innerHTML = options;
    }

    calculateMatch() {
        const winnerSelect = document.getElementById('winner-select');
        const loserSelect = document.getElementById('loser-select');
        
        const winnerName = winnerSelect.value;
        const loserName = loserSelect.value;
        
        if (!winnerName || !loserName) {
            document.getElementById('match-result').style.display = 'none';
            document.getElementById('calculation-details').style.display = 'none';
            return;
        }

        if (winnerName === loserName) {
            alert('Please select different players for winner and loser');
            return;
        }

        const winner = this.players.get(winnerName);
        const loser = this.players.get(loserName);
        
        if (!winner || !loser) {
            console.error('Player not found');
            return;
        }

        // Calculate ELO changes
        const result = this.calculateELO(winner.elo, loser.elo);
        
        // Update UI
        this.displayMatchResult(winner, loser, result);
        this.displayCalculationDetails(winner, loser, result);
    }

    calculateELO(winnerRating, loserRating, kFactor = 32) {
        // Expected scores
        const expectedScoreWinner = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
        const expectedScoreLoser = 1 / (1 + Math.pow(10, (winnerRating - loserRating) / 400));

        // New ratings
        const newWinnerRating = winnerRating + kFactor * (1 - expectedScoreWinner);
        const newLoserRating = loserRating + kFactor * (0 - expectedScoreLoser);

        return {
            winnerChange: Math.round(newWinnerRating - winnerRating),
            loserChange: Math.round(newLoserRating - loserRating),
            newWinnerRating: Math.round(newWinnerRating),
            newLoserRating: Math.round(newLoserRating),
            expectedScoreWinner,
            expectedScoreLoser
        };
    }

    displayMatchResult(winner, loser, result) {
        // Winner card
        document.getElementById('winner-name').textContent = winner.username;
        document.getElementById('winner-current-elo').textContent = `Current ELO: ${winner.elo}`;
        document.getElementById('winner-elo-change').textContent = `+${result.winnerChange}`;
        document.getElementById('winner-new-elo').textContent = `New ELO: ${result.newWinnerRating}`;
        
        // Loser card
        document.getElementById('loser-name').textContent = loser.username;
        document.getElementById('loser-current-elo').textContent = `Current ELO: ${loser.elo}`;
        document.getElementById('loser-elo-change').textContent = `${result.loserChange}`;
        document.getElementById('loser-new-elo').textContent = `New ELO: ${result.newLoserRating}`;

        // Apply ELO-based colors
        const winnerColor = this.getELOColor(winner.elo);
        const loserColor = this.getELOColor(loser.elo);
        
        document.getElementById('winner-name').style.color = winnerColor;
        document.getElementById('loser-name').style.color = loserColor;

        // Show the result
        document.getElementById('match-result').style.display = 'grid';
    }

    displayCalculationDetails(winner, loser, result) {
        const details = `

Initial Ratings:
  ${winner.username}: ${winner.elo}
  ${loser.username}: ${loser.elo}
  
Expected Scores:
  ${winner.username}: ${result.expectedScoreWinner.toFixed(3)} (${(result.expectedScoreWinner * 100).toFixed(1)}% chance to win)
  ${loser.username}: ${result.expectedScoreLoser.toFixed(3)} (${(result.expectedScoreLoser * 100).toFixed(1)}% chance to win)

ELO Changes:
  ${winner.username}: ${winner.elo} + ${result.winnerChange} = ${result.newWinnerRating}
  ${loser.username}: ${loser.elo} + ${result.loserChange} = ${result.newLoserRating}

Formula Used:
  New Rating = Old Rating + K-factor × (Actual Score - Expected Score)
  K-factor = 32
  Actual Score: Winner = 1, Loser = 0
  
${result.winnerChange > 20 ? ' High ELO gain' : ''}
${result.winnerChange < 5 ? 'Low ELO gain.' : ''}
        `;
        
        document.getElementById('calculation-text').textContent = details;
        document.getElementById('calculation-details').style.display = 'block';
    }

    getELOColor(elo) {
        if (elo >= 2000) return '#50C878';      // Emerald
        else if (elo >= 1800) return '#FFD700'; // Gold
        else if (elo >= 1600) return '#C0C0C0'; // Silver
        else if (elo >= 1400) return '#CD7F32'; // Bronze
        else return '#808080';                  // Unranked/Default
    }

    getELORankClass(elo) {
        if (elo >= 2000) return 'emerald';
        else if (elo >= 1800) return 'gold';
        else if (elo >= 1600) return 'silver';
        else if (elo >= 1400) return 'bronze';
        else return 'unranked';
    }
}

// Initialize the calculator when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Only initialize if we're on the rules page with the sandbox section
    if (document.getElementById('sandbox')) {
        new ELOCalculator();
    }
});