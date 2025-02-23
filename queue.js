import { db } from './firebase-config.js';
import { collection, query, where, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

// Get reference to player-status collection
const playerStatusRef = collection(db, 'player-status');

// Create query for active players
const activePlayersQuery = query(playerStatusRef, where('isReady', '==', true));

// Function to update queue display
function updateQueueDisplay(players) {
    console.log('Updating queue display with players:', players); // Debug log
    const queueContainer = document.getElementById('queue-container');
    
    if (!queueContainer) {
        console.error('Queue container not found!'); // Debug log
        return;
    }
    
    if (players.length === 0) {
        console.log('No players found in queue'); // Debug log
        queueContainer.innerHTML = '<p class="no-players">No players in queue</p>';
        return;
    }

    let queueHTML = `
        <div class="queue-box">
            <h3>Players Ready to Play</h3>
            <div class="queue-list">
    `;

    players.sort((a, b) => b.queueStartTime.seconds - a.queueStartTime.seconds);

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
console.log('Setting up queue listener...'); // Debug log

onSnapshot(activePlayersQuery, (snapshot) => {
    const activePlayers = [];
    console.log('Queue snapshot received:', {
        size: snapshot.size,
        empty: snapshot.empty,
        metadata: snapshot.metadata
    });
    
    snapshot.forEach(doc => {
        const data = doc.data();
        console.log('Raw player data:', data); // Show full player data
        console.log(`Player document found:
            ID: ${doc.id}
            Username: ${data.username}
            isReady: ${data.isReady}
            Queue Time: ${data.queueStartTime}
        `);
        
        if (data.isReady === true) { // Explicit check
            activePlayers.push({
                id: doc.id,
                username: data.username,
                queueStartTime: data.queueStartTime || new Date() // Fallback for missing timestamp
            });
        }
    });
    
    console.log('Processing complete. Active players:', activePlayers);
    updateQueueDisplay(activePlayers);
}, (error) => {
    console.error('Error in queue listener:', error);
});