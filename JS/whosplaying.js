import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export class RetroTrackerMonitor {
    constructor() {
        this.lastUpdate = null;
        this.activeGames = new Map();
        this.updateInterval = 300000; // 30 seconds
        this.isMainPage = window.location.pathname.endsWith('/whosplaying.html');
    }

    async initialize() {
        if (this.isMainPage) {
            this.createGameDisplay();
        }
        this.startMonitoring();
    }

    initializeBannerOnly() {
        this.activeGames = new Map();
        this.updateInterval = 30000; // 30 seconds
        
        // Don't create the game container
        this.startMonitoring();
    }

    createGameDisplay() {
        if (!this.isMainPage) return;
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

        // Add banner
        const banner = document.createElement('div');
        banner.className = 'game-banner';
        banner.innerHTML = '<div class="game-banner-content"><span class="game-banner-text"></span></div>';
        document.body.appendChild(banner);
    }

    // Optimize game data extraction
    async fetchGameData() {
        try {
            const proxyUrl = 'https://api.allorigins.win/get?url=';
            const targetUrl = encodeURIComponent('https://retro-tracker.game-server.cc/');
            
            const response = await fetch(`${proxyUrl}${targetUrl}`);
            if (!response.ok) throw new Error('Network response was not ok');

            const doc = new DOMParser().parseFromString((await response.json()).contents, 'text/html');
            const gamesList = doc.querySelectorAll('.scoreboard_game');
            
            if (!gamesList.length) {
                throw new Error('No games found');
            }

            const games = Array.from(gamesList)
                .map(game => {
                    const gameId = game.getAttribute('onclick')?.match(/\d+/)?.[0];
                    if (!gameId) return null;

                    const detailsTable = doc.querySelector(`#game${gameId}`);
                    if (!detailsTable) return null;

                    return {
                        gameVersion: this.getVersionInfo(detailsTable),
                        gameName: this.findDetailText(detailsTable, 'Game Name:'),
                        map: this.findDetailText(detailsTable, 'Mission:'),
                        players: this.findPlayers(detailsTable),
                        scores: this.findScores(detailsTable),
                        startTime: this.findDetailText(detailsTable, 'Start time:'),
                        status: this.findDetailText(detailsTable, 'Status:')?.includes('Playing') ? 'active' : 'inactive',
                        playerCount: this.findDetailText(detailsTable, 'Players:'),
                        gameMode: this.findDetailText(detailsTable, 'Mode:'),
                        timestamp: new Date().toISOString()
                    };
                })
                .filter(Boolean); // Remove null entries

            return this.processGameData(games);
        } catch (error) {
            console.error('Error fetching game data:', error);
            this.displayError('Unable to fetch game data.');
            return null;
        }
    }

    // New helper method to get version info
    getVersionInfo(detailsTable) {
        const versionCell = detailsTable.querySelector('td[bgcolor="#D0D0D0"]');
        return versionCell?.textContent?.split('-')[0]?.trim() || 'Unknown Version';
    }

    // Optimize player finding
    findPlayers(detailsTable) {
        if (!detailsTable) return [];
        
        // Find Score Board section using standard selectors
        const scoreBoardHeaders = Array.from(detailsTable.querySelectorAll('td[bgcolor="#D0D0D0"]'))
            .find(td => td.textContent.includes('Score Board'));
        
        if (!scoreBoardHeaders) return [];

        // Get the score board table that follows the header
        const scoreBoardTable = scoreBoardHeaders.closest('tr').nextElementSibling?.querySelector('table');
        if (!scoreBoardTable) return [];

        // Process player rows
        return Array.from(scoreBoardTable.querySelectorAll('tr'))
            .slice(1) // Skip header row
            .filter(row => row.getAttribute('style')?.includes('color:#7878B8'))
            .map(row => {
                const cells = row.querySelectorAll('td');
                if (cells.length < 6) return null;

                return {
                    name: cells[0]?.textContent?.trim() || '',
                    kills: parseInt(cells[1]?.textContent?.trim() || '0', 10),
                    deaths: parseInt(cells[2]?.textContent?.trim() || '0', 10),
                    suicides: parseInt(cells[3]?.textContent?.trim() || '0', 10),
                    kdr: parseFloat(cells[4]?.textContent?.trim() || '0'),
                    timeInGame: cells[5]?.textContent?.trim() || ''
                };
            })
            .filter(Boolean); // Remove any null entries
    }

    // Optimize score finding
    findScores(detailsTable) {
        const detailedScoreTable = Array.from(detailsTable.querySelectorAll('table'))
            .find(table => 
                table.previousElementSibling?.textContent?.includes('Detailed Score Board')
            );

        if (!detailedScoreTable) return {};

        return Object.fromEntries(
            Array.from(detailedScoreTable.querySelectorAll('tr'))
                .filter(row => row.getAttribute('style')?.includes('color:#7878B8'))
                .map(row => {
                    const cells = row.querySelectorAll('td');
                    return [
                        cells[0]?.textContent?.trim() || 'Unknown',
                        cells[1]?.textContent?.trim() || '0'
                    ];
                })
        );
    }

    // Optimize game data processing
    processGameData(data) {
        if (!data?.length) {
            console.log('No games data received');
            return;
        }

        this.activeGames.clear();
        
        const activeGames = data.filter(game => 
            game.status === 'active' && game.players?.length > 0
        );
        
        activeGames.forEach(game => {
            const gameId = `${game.gameName}-${game.startTime}`;
            this.activeGames.set(gameId, game);
        });

        this.updateDisplay();
    }

    findDetailText(element, label) {
        if (!element) return '';
        const nodes = element.querySelectorAll('td');
        for (const node of nodes) {
            if (node.textContent.includes(label)) {
                const parts = node.textContent.split(label);
                if (parts.length > 1) {
                    let value = parts[1].trim();
                    
                    // Handle specific fields
                    switch(label) {
                        case 'Game Name:':
                            return value.split('Mission:')[0].trim();
                        case 'Mission:':
                            return value.split('Level Number:')[0].trim();
                        case 'Players:':
                            return value.split('Mode:')[0].trim();
                        case 'Mode:':
                            return value.split('\n')[0].trim();
                        default:
                            return value;
                    }
                }
            }
        }
        return '';
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
        if (this.isMainPage) {
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

        // Update the banner at the end
        this.updateBanner();
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

    // Add new method to update banner
    updateBanner() {
        const banner = document.querySelector('.game-banner');
        const bannerText = document.querySelector('.game-banner-text');
        
        if (!banner || !bannerText) return;

        // Hide banner if no games
        if (this.activeGames.size === 0) {
            banner.style.display = 'none';
            return;
        }

        // Show banner and start cycling through games
        banner.style.display = 'block';
        
        const games = Array.from(this.activeGames.values());
        let currentGameIndex = 0;

        // Clear any existing game rotation interval
        if (this.gameRotationInterval) {
            clearInterval(this.gameRotationInterval);
        }

        // Function to update the banner text
        const updateBannerText = () => {
            const game = games[currentGameIndex];
            if (game) {
                const gameType = game.players?.length > 2 ? 'FFA' : '1v1';
                const playerCount = game.players?.length || 0;
                const text = `LIVE GAME: (${game.gameVersion}) - ${game.gameName} - ${gameType} - Map: ${game.map}`;
                
                bannerText.textContent = text;
                
                // Move to next game
                currentGameIndex = (currentGameIndex + 1) % games.length;
            }
        };

        // Set initial text
        updateBannerText();

        // If multiple games, rotate every 10 seconds
        if (games.length > 1) {
            this.gameRotationInterval = setInterval(updateBannerText, 10000);
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
    if (window.location.pathname.endsWith('whosplaying.html')) {
        monitor.initialize();
    } else {
        monitor.initializeBannerOnly();
    }
});
