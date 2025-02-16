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
        // Find the footer placeholder
        const footerPlaceholder = document.getElementById('footer-placeholder');mentById('footer-placeholder');
        
        // Create the container
        const container = document.createElement('div');div');
        container.id = 'retro-tracker-container';iner';
        container.innerHTML = `
            <div class="active-games-box">lass="active-games-box">
                <h2>Active RetroTracker Games</h2>      <h2>Active RetroTracker Games</h2>
                <div id="games-list"></div>
                <div class="last-update"></div>           <div class="last-update"></div>
            </div>            </div>
        `;
        
        // Insert the container before the footerthe footer
        if (footerPlaceholder) {
            footerPlaceholder.parentNode.insertBefore(container, footerPlaceholder);
        } else {        } else {
            document.body.appendChild(container); // Fallback if footer not found// Fallback if footer not found
        }
    }

    async fetchGameData() {
        try {        try {
            // Use a CORS proxy service service
            const proxyUrl = 'https://api.allorigins.win/get?url=';l=';
            const targetUrl = encodeURIComponent('https://retro-tracker.game-server.cc/');onst targetUrl = encodeURIComponent('https://retro-tracker.game-server.cc/');

            // Alternative proxy URLs you can try:ry:
            const corsAnywhere = 'https://cors-anywhere.herokuapp.com/';://cors-anywhere.herokuapp.com/';
            const corsProxy = 'https://api.codetabs.com/v1/proxy?quest=';codetabs.com/v1/proxy?quest=';
            
            const response = await fetch(`${proxyUrl}${targetUrl}`);            const response = await fetch(`${proxyUrl}${targetUrl}`);

            if (!response.ok) {
                throw new Error('Network response was not ok'););
            }

            const data = await response.json();
            const html = data.contents;
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // Rest of the scraping code remains the same
            const gamesList = doc.querySelectorAll('.game-session');
            const games = Array.from(gamesList).map(game => {
                return {
                    host: game.querySelector('.host-name')?.textContent || 'Unknown Host',nown Host',
                    status: game.querySelector('.game-status')?.textContent || 'active',tus: game.querySelector('.game-status')?.textContent || 'active',
                    type: game.querySelector('.game-type')?.textContent,  type: game.querySelector('.game-type')?.textContent,
                    gameName: game.querySelector('.game-title')?.textContent,     gameName: game.querySelector('.game-title')?.textContent,
                    gameVersion: game.querySelector('.game-version')?.textContent,                    gameVersion: game.querySelector('.game-version')?.textContent,
                    startTime: game.querySelector('.start-time')?.getAttribute('datetime'),or('.start-time')?.getAttribute('datetime'),
                    players: Array.from(game.querySelectorAll('.player')).map(player => ({rs: Array.from(game.querySelectorAll('.player')).map(player => ({
                        name: player.querySelector('.player-name')?.textContent,me')?.textContent,
                        score: player.querySelector('.player-score')?.textContent,
                        character: player.querySelector('.player-character')?.textContent,character: player.querySelector('.player-character')?.textContent,
                        wins: player.querySelector('.player-wins')?.textContent               wins: player.querySelector('.player-wins')?.textContent
                    }))               }))
                };                };
            });

            return this.processGameData(games);
        } catch (error) {
            console.error('Error fetching game data:', error);hing game data:', error);
            this.displayError('Unable to fetch game data. Using proxy service...'); this.displayError('Unable to fetch game data. Using proxy service...');
            return null;
        }   }
    }    }

    processGameData(data) {
        // Process the game data and store relevant informatione data and store relevant information
        const activeGames = data.filter(game => game.status === 'active');> game.status === 'active');
        activeGames.forEach(game => {
            this.storeGameData(game);
        });
        this.updateDisplay();
    }

    storeGameData(game) {
        // Ensure all required fields are present before storing
        const gameData = {nst gameData = {
            host: game.host || 'Unknown Host',            host: game.host || 'Unknown Host',
            players: game.players || [],
            scores: game.scores || {},  // Use empty object if scores undefinedect if scores undefined
            timestamp: new Date().toISOString(),w Date().toISOString(),
            gameType: game.type || 'Unknown Type',ype',
            status: game.status || 'active',
            gameName: game.gameName || 'Unknown Game',| 'Unknown Game',
            gameVersion: game.gameVersion || '',meVersion: game.gameVersion || '',
            startTime: game.startTime || new Date().toISOString()tartTime || new Date().toISOString()
        };

        // Store in Firebase with error handlinge in Firebase with error handling
        addDoc(collection(db, 'retroTracker'), gameData)   addDoc(collection(db, 'retroTracker'), gameData)
            .then(() => {            .then(() => {
                // Add game to local trackingd game to local tracking
                this.activeGames.set(game.host, gameData);
                this.updateDisplay();lay();
            })            })
            .catch(error => {
                console.error('Error storing game data:', error);e data:', error);
                this.displayError('Error saving game data');
            });
    }

    updateDisplay() {
        const gamesList = document.getElementById('games-list');
        if (!gamesList) return;

        gamesList.innerHTML = '';
        this.activeGames.forEach((game, id) => {es.forEach((game, id) => {
            const gameElement = document.createElement('div');
            gameElement.className = 'game-box';box';
            gameElement.innerHTML = `
                <div class="game-header">
                    <div class="game-title">
                        <span class="game-name">${game.gameName}</span>
                        ${game.gameVersion ? `<span class="game-version">(${game.gameVersion})</span>` : ''}
                    </div>
                    <span class="host">Host: ${game.host}</span>st}</span>
                </div>
                <div class="game-type">Type: ${game.gameType}</div>
                <div class="players-list">s-list">
                    ${game.players.map(player => `yers.map(player => `
                        <div class="player">ss="player">
                            <div class="player-info">      <div class="player-info">
                                <span class="player-name">${player.name}</span>ss="player-name">${player.name}</span>
                                ${player.character ? `<span class="player-character">Character: ${player.character}</span>` : ''}acter}</span>` : ''}
                            </div>
                            <div class="player-stats">      <div class="player-stats">
                                <span class="player-score">Score: ${player.score}</span>                  <span class="player-score">Score: ${player.score}</span>
                                ${player.wins !== undefined ? `<span class="player-wins">Wins: ${player.wins}</span>` : ''}== undefined ? `<span class="player-wins">Wins: ${player.wins}</span>` : ''}
                            </div>                 </div>
                        </div>                        </div>
                    `).join('')}
                </div>
                <div class="game-footer">           <div class="game-footer">
                    <span class="start-time">Started: ${new Date(game.startTime).toLocaleTimeString()}</span>                    <span class="start-time">Started: ${new Date(game.startTime).toLocaleTimeString()}</span>
                    <span class="timestamp">Updated: ${new Date(game.timestamp).toLocaleTimeString()}</span>an class="timestamp">Updated: ${new Date(game.timestamp).toLocaleTimeString()}</span>
                </div>
            `;
            gamesList.appendChild(gameElement);       gamesList.appendChild(gameElement);
        });        });

        document.querySelector('.last-update').textContent = tor('.last-update').textContent = 
            `Last updated: ${new Date().toLocaleTimeString()}`;
    }

    startMonitoring() {
        setInterval(() => this.fetchGameData(), this.updateInterval);ameData(), this.updateInterval);
        this.fetchGameData(); // Initial fetchData(); // Initial fetch
    }

    // Add error display method/ Add error display method
    displayError(message) {   displayError(message) {
        const gamesList = document.getElementById('games-list');        const gamesList = document.getElementById('games-list');
        if (gamesList) {) {
            gamesList.innerHTML = `sList.innerHTML = `
                <div class="error-message">ror-message">
                    <p>${message}</p>message}</p>
                </div>
            `;
        }   }
    }    }
}

// Add the CSS styles
const styles = `
    #retro-tracker-container {
        max-width: 600px;   max-width: 600px;
        margin: 20px auto;        margin: 20px auto;
        font-family: Arial, sans-serif;mily: Arial, sans-serif;
    }

    .active-games-box {{
        background: rgba(255, 255, 255, 0.9);a(255, 255, 255, 0.9);
        border-radius: 8px;   border-radius: 8px;
        padding: 20px;        padding: 20px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);: 0 2px 10px rgba(0, 0, 0, 0.1);
    }

    .game-box {
        background: rgba(240, 240, 240, 0.9);40, 240, 240, 0.9);
        border-radius: 4px;   border-radius: 4px;
        padding: 15px;        padding: 15px;
        margin: 10px 0;x 0;
    }

    .game-header {game-header {
        display: flex;        display: flex;
        justify-content: space-between;fy-content: space-between;
        margin-bottom: 10px; 10px;
        font-weight: bold;
    }

    .players-list {
        display: grid;   display: grid;
        gap: 5px;        gap: 5px;
    }

    .player {
        display: flex;x;
        justify-content: space-between;   justify-content: space-between;
        padding: 5px;        padding: 5px;
        background: rgba(255, 255, 255, 0.5);: rgba(255, 255, 255, 0.5);
        border-radius: 3px;
    }

    .game-footer {
        margin-top: 10px;   margin-top: 10px;
        font-size: 0.8em;      font-size: 0.8em;
        color: #666;        color: #666;
    }

    .last-update {
        text-align: center;
        margin-top: 20px;        margin-top: 20px;
        font-size: 0.9em;
        color: #666;
    }
`;











});    monitor.initialize();    const monitor = new RetroTrackerMonitor();document.addEventListener('DOMContentLoaded', () => {// Initialize the monitordocument.head.appendChild(styleSheet);styleSheet.textContent = styles;const styleSheet = document.createElement('style');// Add styles to document// Add styles to document
const styleSheet = document.createElement('style');
styleSheet.textContent = styles;
document.head.appendChild(styleSheet);

// Initialize the monitor
document.addEventListener('DOMContentLoaded', () => {
    const monitor = new RetroTrackerMonitor();
    monitor.initialize();
});