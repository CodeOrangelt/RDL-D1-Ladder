import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

class RetroTrackerMonitor {
    constructor() {
        this.lastUpdate = null;
        this.activeGames = new Map();
        this.updateInterval = 30000; // 30 seconds
    }

    async initialize() {
        this.createGameDisplay();
        this.startMonitoring();
    }

    createGameDisplay() {
        const container = document.createElement('div');
        container.id = 'retro-tracker-container';
        container.innerHTML = `
            <div class="active-games-box">
                <h2>Active RetroTracker Games</h2>
                <div id="games-list"></div>
                <div class="last-update"></div>
            </div>
        `;
        document.body.appendChild(container);
    }

    async fetchGameData() {
        try {
            // Updated mock data to include proper score structure
            const mockData = {
                games: [
                    {
                        host: "Player1",
                        status: "active",
                        type: "Versus",
                        players: [
                            { name: "Player1", score: 100 },
                            { name: "Player2", score: 85 }
                        ],
                        scores: {
                            Player1: 100,
                            Player2: 85
                        }
                    }
                ]
            };

            // Process mock data
            return this.processGameData(mockData.games);
        } catch (error) {
            console.error('Error fetching game data:', error);
            this.displayError('Unable to fetch game data. Please try again later.');
            return null;
        }
    }

    processGameData(data) {
        // Process the game data and store relevant information
        const activeGames = data.filter(game => game.status === 'active');
        activeGames.forEach(game => {
            this.storeGameData(game);
        });
        this.updateDisplay();
    }

    storeGameData(game) {
        // Ensure all required fields are present before storing
        const gameData = {
            host: game.host || 'Unknown Host',
            players: game.players || [],
            scores: game.scores || {},  // Use empty object if scores undefined
            timestamp: new Date().toISOString(),
            gameType: game.type || 'Unknown Type',
            status: game.status || 'active'
        };

        // Store in Firebase with error handling
        addDoc(collection(db, 'retroTracker'), gameData)
            .then(() => {
                // Add game to local tracking
                this.activeGames.set(game.host, gameData);
                this.updateDisplay();
            })
            .catch(error => {
                console.error('Error storing game data:', error);
                this.displayError('Error saving game data');
            });
    }

    updateDisplay() {
        const gamesList = document.getElementById('games-list');
        if (!gamesList) return;

        gamesList.innerHTML = '';
        this.activeGames.forEach((game, id) => {
            const gameElement = document.createElement('div');
            gameElement.className = 'game-box';
            gameElement.innerHTML = `
                <div class="game-header">
                    <span class="host">${game.host}</span>
                    <span class="game-type">${game.gameType}</span>
                </div>
                <div class="players-list">
                    ${game.players.map(player => `
                        <div class="player">
                            <span class="player-name">${player.name}</span>
                            <span class="player-score">${player.score}</span>
                        </div>
                    `).join('')}
                </div>
                <div class="game-footer">
                    <span class="timestamp">Updated: ${new Date(game.timestamp).toLocaleTimeString()}</span>
                </div>
            `;
            gamesList.appendChild(gameElement);
        });

        document.querySelector('.last-update').textContent = 
            `Last updated: ${new Date().toLocaleTimeString()}`;
    }

    startMonitoring() {
        setInterval(() => this.fetchGameData(), this.updateInterval);
        this.fetchGameData(); // Initial fetch
    }

    // Add error display method
    displayError(message) {
        const gamesList = document.getElementById('games-list');
        if (gamesList) {
            gamesList.innerHTML = `
                <div class="error-message">
                    <p>${message}</p>
                </div>
            `;
        }
    }
}

// Add the CSS styles
const styles = `
    #retro-tracker-container {
        max-width: 600px;
        margin: 20px auto;
        font-family: Arial, sans-serif;
    }

    .active-games-box {
        background: rgba(255, 255, 255, 0.9);
        border-radius: 8px;
        padding: 20px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    }

    .game-box {
        background: rgba(240, 240, 240, 0.9);
        border-radius: 4px;
        padding: 15px;
        margin: 10px 0;
    }

    .game-header {
        display: flex;
        justify-content: space-between;
        margin-bottom: 10px;
        font-weight: bold;
    }

    .players-list {
        display: grid;
        gap: 5px;
    }

    .player {
        display: flex;
        justify-content: space-between;
        padding: 5px;
        background: rgba(255, 255, 255, 0.5);
        border-radius: 3px;
    }

    .game-footer {
        margin-top: 10px;
        font-size: 0.8em;
        color: #666;
    }

    .last-update {
        text-align: center;
        margin-top: 20px;
        font-size: 0.9em;
        color: #666;
    }
`;

// Add styles to document
const styleSheet = document.createElement('style');
styleSheet.textContent = styles;
document.head.appendChild(styleSheet);

// Initialize the monitor
document.addEventListener('DOMContentLoaded', () => {
    const monitor = new RetroTrackerMonitor();
    monitor.initialize();
});