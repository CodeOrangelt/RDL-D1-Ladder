import { 
    collection,
    getDocs,
    query,
    orderBy 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from './firebase-config.js';

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const playersRef = collection(db, 'players');
        const q = query(playersRef, orderBy('elo', 'desc'));
        const querySnapshot = await getDocs(q);

        const ladderTable = document.getElementById('ladder').getElementsByTagName('tbody')[0];
        const usernamesSet = new Set(); // Set to keep track of usernames

        let rank = 1;
        querySnapshot.forEach(doc => {
            const player = doc.data();
            if (!usernamesSet.has(player.username)) { // Check if username is already added
                usernamesSet.add(player.username); // Add username to the set
                const row = ladderTable.insertRow();

                const rankCell = row.insertCell();
                rankCell.textContent = rank;

                const usernameCell = row.insertCell();
                usernameCell.textContent = player.username;

                // Apply shimmer effect to the #1 player
                if (rank === 1) {
                    usernameCell.classList.add('shimmer');
                    rankCell.classList.add('shimmer');
                }

                // Assign default ELO rating if not present
                if (!player.eloRating) {
                    const defaultEloRating = 1200; // Default ELO rating
                    db.collection('players').doc(doc.id).update({ eloRating: defaultEloRating })
                        .then(() => {
                            console.log(`Assigned default ELO rating to player ${player.username}`);
                        })
                        .catch(error => {
                            console.error('Error assigning default ELO rating:', error);
                        });
                }

                rank++;
            }
        });
    } catch (error) {
        console.error("Error loading ladder:", error);
    }
});
