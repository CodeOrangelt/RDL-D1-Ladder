import { db } from './firebase-config.js';
import { collection, query, where, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

// Debugging: Check if Firestore is initialized
console.log('Firestore initialization check:', !!db);

// Get reference to readyPlayers collection
const readyPlayersRef = collection(db, 'readyPlayers');
console.log('Ready players collection reference created');

// Create query for active players
const activePlayersQuery = query(readyPlayersRef, where('isReady', '==', true));
console.log('Active players query created');

// Function to update queue display
function updateQueueDisplay(players) {
    console.log('Received players data:', players);
    const queueContainer = document.getElementById('queue-container');
    
    if (!queueContainer) {
        console.error('Queue container not found!');
        return;
    }

    // Hide the entire queue section if no players are ready
    if (players.length === 0) {
        queueContainer.style.display = 'none';
        return;
    }

    // Show the queue section if there are players
    queueContainer.style.display = 'block';
    
    let queueHTML = `
        <div class="queue-box">
            <h2>Waiting for a game</h2>
            <div class="queue-list">
    `;

    players.forEach(player => {
        queueHTML += `
            <div class="player-card">
                <span class="player-name">${player.username || 'Unknown Player'}</span>
                <span class="queue-time">${formatQueueTime(player.lastUpdated)}</span>
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
    if (!timestamp) return 'Just now';
    
    // Handle both Firestore Timestamp and regular Date objects
    const queueTime = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const minutesInQueue = Math.floor((now - queueTime) / 60000);
    
    if (minutesInQueue < 1) return 'Just now';
    return `${minutesInQueue}m in queue`;
}

// Set up real-time listener
console.log('Setting up queue listener...');
const unsubscribe = onSnapshot(readyPlayersRef, 
    (snapshot) => {
        console.log('Queue snapshot received:', {
            size: snapshot.size,
            empty: snapshot.empty
        });

        const activePlayers = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            console.log('Player document:', {
                id: doc.id,
                username: data.username,
                isReady: data.isReady,
                lastUpdated: data.lastUpdated
            });
            
            if (data.isReady === true) {
                activePlayers.push({
                    id: doc.id,
                    username: data.username,
                    lastUpdated: data.lastUpdated || new Date()
                });
            }
        });

        console.log('Processing complete. Active players:', activePlayers);
        updateQueueDisplay(activePlayers);
    },
    (error) => {
        console.error('Error in queue listener:', error);
    }
);

// Cleanup listener on page unload
window.addEventListener('unload', () => {
    unsubscribe();
});