import { db } from './firebase-config.js';
import { collection, query, where, onSnapshot } from 'firebase/firestore';

// Get reference to player-status collection
const playerStatusRef = collection(db, 'player-status');

// Create query for active players
const activePlayersQuery = query(playerStatusRef, where('ready', '==', true));

// Function to update queue display
function updateQueueDisplay(players) {
    const queueContainer = document.getElementById('queue-container');
    
    if (players.length === 0) {
        queueContainer.innerHTML = '<p class="no-players">No players currently in queue</p>';
        return;
    }

    let queueHTML = `
        <div class="queue-box">
            <h2>Players Ready</h2>
            <div class="queue-list">
    `;

    players.forEach(player => {
        queueHTML += `
            <div class="player-card">
                <span class="player-name">${player.username}</span>
                <span class="queue-time">${formatQueueTime(player.queueStartTime)}</span>
            </div>
        `;
    });

    queueHTML += `
            </div>
        </div>
    `;

    queueContainer.innerHTML = queueHTML;
}

// Helper function to format queue time
function formatQueueTime(timestamp) {
    const queueTime = timestamp.toDate();
    const now = new Date();
    const minutesInQueue = Math.floor((now - queueTime) / 60000);
    return `${minutesInQueue}m in queue`;
}

// Real-time listener for queue updates
onSnapshot(activePlayersQuery, (snapshot) => {
    const activePlayers = [];
    snapshot.forEach(doc => {
        activePlayers.push({
            id: doc.id,
            ...doc.data()
        });
    });
    updateQueueDisplay(activePlayers);
});