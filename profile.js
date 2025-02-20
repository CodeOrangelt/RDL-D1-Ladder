//profile.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

class ProfileManager {
    constructor() {
        this.form = document.getElementById('profile-form');
        this.pfpInput = document.getElementById('pfp-upload');
        this.pfpPreview = document.getElementById('profile-preview');
        this.statsContainer = document.getElementById('player-stats');
        this.setupEventListeners();
        this.loadProfile();
    }

    setupEventListeners() {
        this.pfpInput.addEventListener('change', (e) => this.handleImageUpload(e));
        this.form.addEventListener('submit', (e) => this.handleSubmit(e));
    }

    async handleImageUpload(event) {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                this.pfpPreview.src = e.target.result;
            };
            reader.readAsDataURL(file);
        }
    }

    async handleSubmit(event) {
        event.preventDefault();
        const user = auth.currentUser;
        if (!user) {
            alert('Please sign in to save your profile');
            return;
        }

        try {
            const formData = new FormData(this.form);
            const profileData = {
                nickname: formData.get('nickname'),
                motto: formData.get('motto'),
                favoriteMap: formData.get('favorite-map'),
                favoriteWeapon: formData.get('favorite-weapon'),
                updatedAt: new Date().toISOString()
            };

            // Handle profile picture upload
            const pfpFile = this.pfpInput.files[0];
            if (pfpFile) {
                const storageRef = ref(storage, `profile-pictures/${user.uid}`);
                await uploadBytes(storageRef, pfpFile);
                profileData.pfpUrl = await getDownloadURL(storageRef);
            }

            // Save to Firestore
            await setDoc(doc(db, 'profiles', user.uid), profileData);
            alert('Profile saved successfully!');

        } catch (error) {
            console.error('Error saving profile:', error);
            alert('Error saving profile. Please try again.');
        }
    }

    async loadProfile() {
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                try {
                    const profileDoc = await getDoc(doc(db, 'profiles', user.uid));
                    if (profileDoc.exists()) {
                        const data = profileDoc.data();
                        document.getElementById('nickname').value = data.nickname || '';
                        document.getElementById('motto').value = data.motto || '';
                        document.getElementById('favorite-map').value = data.favoriteMap || '';
                        document.getElementById('favorite-weapon').value = data.favoriteWeapon || '';
                        if (data.pfpUrl) {
                            this.pfpPreview.src = data.pfpUrl;
                        }
                        await this.loadPlayerStats(data.nickname);
                    }
                } catch (error) {
                    console.error('Error loading profile:', error);
                }
            }
        });
    }

    async loadPlayerStats(username) {
        if (!username) return;

        try {
            // Get match history for the player
            const approvedMatchesRef = collection(db, 'approvedMatches');
            const [winnerMatches, loserMatches] = await Promise.all([
                getDocs(query(approvedMatchesRef, where('winnerUsername', '==', username))),
                getDocs(query(approvedMatchesRef, where('loserUsername', '==', username)))
            ]);

            // Calculate stats
            let stats = {
                wins: winnerMatches.size,
                losses: loserMatches.size,
                totalKills: 0,
                totalDeaths: 0,
                totalMatches: winnerMatches.size + loserMatches.size,
                kda: 0,
                winRate: 0
            };

            // Calculate kills and deaths
            winnerMatches.forEach(doc => {
                const match = doc.data();
                stats.totalKills += parseInt(match.winnerScore) || 0;
                stats.totalDeaths += parseInt(match.loserScore) || 0;
            });

            loserMatches.forEach(doc => {
                const match = doc.data();
                stats.totalKills += parseInt(match.loserScore) || 0;
                stats.totalDeaths += parseInt(match.winnerScore) || 0;
            });

            // Calculate KDA and win rate
            stats.kda = stats.totalDeaths > 0 ? 
                (stats.totalKills / stats.totalDeaths).toFixed(2) : 
                stats.totalKills;
            stats.winRate = stats.totalMatches > 0 ? 
                ((stats.wins / stats.totalMatches) * 100).toFixed(1) : 0;

            // Update stats display
            this.statsContainer.innerHTML = `
                <div class="stats-grid">
                    <div class="stat-item">
                        <h3>Matches</h3>
                        <p>${stats.totalMatches}</p>
                    </div>
                    <div class="stat-item">
                        <h3>Wins</h3>
                        <p>${stats.wins}</p>
                    </div>
                    <div class="stat-item">
                        <h3>Losses</h3>
                        <p>${stats.losses}</p>
                    </div>
                    <div class="stat-item">
                        <h3>KDA</h3>
                        <p>${stats.kda}</p>
                    </div>
                    <div class="stat-item">
                        <h3>Win Rate</h3>
                        <p>${stats.winRate}%</p>
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('Error loading player stats:', error);
            this.statsContainer.innerHTML = '<p class="error">Error loading stats</p>';
        }
    }
}

// Initialize profile manager when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new ProfileManager();
});