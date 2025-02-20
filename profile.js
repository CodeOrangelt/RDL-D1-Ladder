//profile.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
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
        this.setupEventListeners();
        this.stats = {
            wins: 0,
            losses: 0,
            totalKills: 0,
            totalDeaths: 0,
            winRate: 0,
            rank: 'Unranked'
        };
        this.loadProfile();
        this.loadStats();
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
                    }
                } catch (error) {
                    console.error('Error loading profile:', error);
                }
            }
        });
    }

    async loadStats() {
        onAuthStateChanged(auth, async (user) => {
            if (!user) return;

            try {
                const playerDoc = await getDoc(doc(db, 'players', user.uid));
                if (!playerDoc.exists()) return;

                const username = playerDoc.data().username;
                const eloRating = playerDoc.data().eloRating || 0;

                // Determine rank based on ELO
                if (eloRating >= 2100) {
                    this.stats.rank = 'Emerald';
                } else if (eloRating >= 1800) {
                    this.stats.rank = 'Gold';
                } else if (eloRating >= 1600) {
                    this.stats.rank = 'Silver';
                } else if (eloRating >= 1400) {
                    this.stats.rank = 'Bronze';
                } else {
                    this.stats.rank = 'Unranked';
                }

                // Get player stats from new playerStats collection
                const statsDoc = await getDoc(doc(db, 'playerStats', user.uid));
                
                if (statsDoc.exists()) {
                    const statsData = statsDoc.data();
                    this.stats = {
                        ...this.stats,
                        wins: statsData.wins || 0,
                        losses: statsData.losses || 0,
                        totalKills: statsData.totalKills || 0,
                        totalDeaths: statsData.totalDeaths || 0,
                        winRate: statsData.winRate || 0
                    };
                } else {
                    // Create new stats document if it doesn't exist
                    await setDoc(doc(db, 'playerStats', user.uid), {
                        wins: 0,
                        losses: 0,
                        totalKills: 0,
                        totalDeaths: 0,
                        winRate: 0,
                        lastUpdated: new Date().toISOString()
                    });
                }

                this.updateStatsDisplay();

            } catch (error) {
                console.error('Error loading stats:', error);
            }
        });
    }

    updateStatsDisplay() {
        const statsHTML = `
            <div class="stats-container">
                <div class="stat-item">
                    <span class="stat-label">Rank</span>
                    <span class="stat-value elo-${this.stats.rank.toLowerCase()}">${this.stats.rank}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Wins</span>
                    <span class="stat-value">${this.stats.wins}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Losses</span>
                    <span class="stat-value">${this.stats.losses}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Kills</span>
                    <span class="stat-value">${this.stats.totalKills}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Deaths</span>
                    <span class="stat-value">${this.stats.totalDeaths}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Win Rate</span>
                    <span class="stat-value">${this.stats.winRate}%</span>
                </div>
            </div>
        `;

        // Insert stats after motto
        const mottoElement = document.getElementById('motto');
        mottoElement.insertAdjacentHTML('afterend', statsHTML);
    }
}

// Initialize profile manager when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new ProfileManager();
});