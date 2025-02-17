import { db } from './firebase-config.js';
import { collection, getDocs, setDoc, doc, increment } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

class SeasonManager {
    constructor() {
        this.setupEventListeners();
    }

    setupEventListeners() {
        const resetButton = document.getElementById('reset-season');
        const confirmButton = document.getElementById('confirm-reset');
        const cancelButton = document.getElementById('cancel-reset');

        resetButton?.addEventListener('click', () => {
            document.getElementById('reset-confirmation').style.display = 'block';
        });

        confirmButton?.addEventListener('click', async () => {
            const passwordInput = document.getElementById('reset-password');
            const user = auth.currentUser;
            
            if (!user || !passwordInput.value) {
                alert('Please enter your password');
                return;
            }

            try {
                // Reauthenticate user
                const credential = EmailAuthProvider.credential(
                    user.email,
                    passwordInput.value
                );
                await reauthenticateWithCredential(user, credential);
                
                // If authentication successful, proceed with reset
                await this.resetSeason();
                
                // Clear password and hide dialog
                passwordInput.value = '';
                document.getElementById('reset-confirmation').style.display = 'none';
                
            } catch (error) {
                alert('Invalid password or authentication failed');
                console.error('Authentication error:', error);
            }
        });

        cancelButton?.addEventListener('click', () => {
            const passwordInput = document.getElementById('reset-password');
            passwordInput.value = '';
            document.getElementById('reset-confirmation').style.display = 'none';
        });
    }

    async resetSeason() {
        try {
            // Get current season number
            const seasonCountDoc = await getDoc(doc(db, 'metadata', 'seasonCount'));
            let currentSeason = 1;
            
            if (seasonCountDoc.exists()) {
                currentSeason = seasonCountDoc.data().count + 1;
            }

            // Get all players
            const playersSnapshot = await getDocs(collection(db, 'players'));
            const seasonData = {
                players: [],
                date: new Date(),
                seasonNumber: currentSeason
            };

            // Archive current rankings and reset players
            for (const playerDoc of playersSnapshot.docs) {
                const playerData = playerDoc.data();
                
                // Archive player data
                seasonData.players.push({
                    username: playerData.username,
                    position: playerData.position,
                    eloRating: playerData.eloRating || 1200,
                });

                // Reset player's ELO
                await setDoc(doc(db, 'players', playerDoc.id), {
                    ...playerData,
                    eloRating: 1200,
                    position: playerData.position // Maintain position
                });
            }

            // Save season archive
            await setDoc(doc(db, 'seasons', `season${currentSeason}`), seasonData);
            
            // Update season counter
            await setDoc(doc(db, 'metadata', 'seasonCount'), {
                count: currentSeason
            });

            alert(`Season ${currentSeason} has been archived and players have been reset.`);
            location.reload();

        } catch (error) {
            console.error('Error resetting season:', error);
            alert('Error resetting season. Please try again.');
        }
    }
}

export const seasonManager = new SeasonManager();