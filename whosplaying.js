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
                <div id="games-list">
                    <div class="loading">Fetching active games...</div>
                </div>
                <div class="last-update"></div>
            </div>
        `;
        
        // Insert before footer
        const main = document.querySelector('main');
        if (main) {
            main.appendChild(container);
        }
    }

    async fetchGameData() {
        try {
            const proxyUrl = 'https://api.allorigins.win/get?url=';
            const targetUrl = encodeURIComponent('https://retro-tracker.game-server.cc/');
            
            const response = await fetch(`${proxyUrl}${targetUrl}`);

            if (!response.ok) {
                throw new Error('Network response was not ok');
            }

            const data = await response.json();
            const html = data.contents;
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // Update selectors based on actual RetroTracker HTML structure
            const gamesList = doc.querySelectorAll('.game-list .game'); // Updated selector
            console.log('Found games:', gamesList.length); // Debug log

            const games = Array.from(gamesList).map(game => {
                const gameData = {
                    host: game.querySelector('.game-host')?.textContent?.trim() || 'Unknown Host',
                    status: 'active', // Default to active since we're only scraping active games
                    type: game.querySelector('.game-mode')?.textContent?.trim() || 'Unknown Type',
                    gameName: game.querySelector('.game-name')?.textContent?.trim() || 'Unknown Game',
                    gameVersion: game.querySelector('.game-version')?.textContent?.trim() || '',
                    startTime: new Date().toISOString(), // Current time as fallback
                    players: Array.from(game.querySelectorAll('.player-item')).map(player => ({
                        name: player.querySelector('.player-name')?.textContent?.trim(),
                        score: player.querySelector('.player-score')?.textContent?.trim(),
                        character: player.querySelector('.player-char')?.textContent?.trim(),
                        wins: player.querySelector('.player-wins')?.textContent?.trim()
                    }))
                };
                console.log('Processed game:', gameData); // Debug log
                return gameData;
            });

            return this.processGameData(games);
        } catch (error) {
            console.error('Error fetching game data:', error);
            this.displayError('Unable to fetch game data. Check console for details.');
            return null;
        }
    }

    processGameData(data) {
        if (!data || data.length === 0) {
            console.log('No games data received'); // Debug log
            return;
        }

        // Clear existing games before adding new ones
        this.activeGames.clear();
        
        const activeGames = data.filter(game => game.status === 'active');
        console.log('Active games found:', activeGames.length); // Debug log
        
        activeGames.forEach(game => {
            this.storeGameData(game);
        });
    }

    storeGameData(game) {
        if (!game.host || !game.players) {
            console.error('Invalid game data:', game);
            return;
        }

        // Add directly to local tracking first
        this.activeGames.set(game.host, game);
        
        // Then store in Firebase
        addDoc(collection(db, 'retroTracker'), game)
            .catch(error => {
                console.error('Error storing game data:', error);
                // Don't display error to user, just log it
            });
            
        this.updateDisplay();
    }

    updateDisplay() {
        const gamesList = document.getElementById('games-list');
        if (!gamesList) return;

        if (this.activeGames.size === 0) {
            gamesList.innerHTML = `
                <div class="no-games">
                    <p>No active games found</p>
                </div>
            `;
            return;
        }

        gamesList.innerHTML = '';
        this.activeGames.forEach((game, id) => {
            const gameElement = document.createElement('div');
            gameElement.className = 'game-box';
            gameElement.innerHTML = `
                <div class="game-header">
                    <div class="game-title">
                        <span class="game-name">${game.gameName}</span>
                        ${game.gameVersion ? `<span class="game-version">(v${game.gameVersion})</span>` : ''}
                    </div>
                    <span class="host">Host: ${game.host}</span>
                </div>
                <div class="game-info">
                    <span class="game-type">${game.gameType}</span>
                    <span class="game-status">${game.status}</span>
                </div>
                <div class="players-list">
                    ${game.players.map(player => `
                        <div class="player">
                            <div class="player-info">
                                <span class="player-name">${player.name}</span>
                                ${player.character ? 
                                    `<span class="player-character">${player.character}</span>` : ''}
                            </div>
                            <div class="player-stats">
                                ${player.score ? 
                                    `<span class="player-score">Score: ${player.score}</span>` : ''}
                                ${player.wins ? 
                                    `<span class="player-wins">Wins: ${player.wins}</span>` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
                <div class="game-footer">
                    <span class="start-time">Started: ${new Date(game.startTime).toLocaleTimeString()}</span>
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
        max-width: 800px;
        margin: 20px auto 40px;
        font-family: Arial, sans-serif;
    }

    .active-games-box {
        background: rgba(255, 255, 255, 0.9);
        border-radius: 8px;
        padding: 20px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    }

    .active-games-box h2 {
        color: #881e8e;
        text-align: center;
        margin-bottom: 20px;
    }

    .game-box {
        background: rgba(240, 240, 240, 0.9);
        border-radius: 4px;
        padding: 15px;
        margin: 10px 0;
        border: 1px solid rgba(136, 30, 142, 0.2);
    }

    .game-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-bottom: 10px;
        border-bottom: 1px solid rgba(136, 30, 142, 0.1);
    }

    .game-title {
        font-size: 1.2em;
        color: #881e8e;
    }

    .game-version {
        font-size: 0.8em;
        color: #666;
        margin-left: 8px;
    }

    .game-info {
        display: flex;
        gap: 15px;
        margin: 10px 0;
        font-size: 0.9em;
        color: #444;
    }

    .players-list {
        display: grid;
        gap: 8px;
        margin: 15px 0;
    }

    .player {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        background: rgba(255, 255, 255, 0.7);
        border-radius: 4px;
        transition: background-color 0.2s;
    }

    .player:hover {
        background: rgba(255, 255, 255, 0.9);
    }

    .player-info {
        display: flex;
        gap: 10px;
        align-items: center;
    }

    .player-character {
        color: #666;
        font-size: 0.9em;
    }

    .player-stats {
        display: flex;
        gap: 15px;
    }

    .player-score, .player-wins {
        font-weight: bold;
        color: #881e8e;
    }

    .game-footer {
        margin-top: 15px;
        padding-top: 10px;
        border-top: 1px solid rgba(136, 30, 142, 0.1);
        display: flex;
        justify-content: space-between;
        font-size: 0.8em;
        color: #666;
    }

    .loading, .no-games {
        text-align: center;
        padding: 20px;
        color: #666;
    }

    .error-message {
        text-align: center;
        color: #ff0000;
        padding: 20px;
        background: rgba(255, 0, 0, 0.1);
        border-radius: 4px;
        margin: 10px 0;
    }
`;

const styleSheet = document.createElement('style');
styleSheet.textContent = styles;
document.head.appendChild(styleSheet);

// Initialize the monitor
document.addEventListener('DOMContentLoaded', () => {
    const monitor = new RetroTrackerMonitor();
    monitor.initialize();
});