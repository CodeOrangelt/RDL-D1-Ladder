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
            winRate: 0
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

                // Query matches where user was winner
                const wonMatchesQuery = query(
                    collection(db, 'approvedMatches'),
                    where('winnerUsername', '==', username)
                );
                
                // Query matches where user was loser
                const lostMatchesQuery = query(
                    collection(db, 'approvedMatches'),
                    where('loserUsername', '==', username)
                );

                const [wonMatches, lostMatches] = await Promise.all([
                    getDocs(wonMatchesQuery),
                    getDocs(lostMatchesQuery)
                ]);

                // Calculate stats
                this.stats.wins = wonMatches.size;
                this.stats.losses = lostMatches.size;
                this.stats.totalKills = 0;
                this.stats.totalDeaths = 0;

                // Calculate kills and deaths
                wonMatches.forEach(match => {
                    this.stats.totalKills += parseInt(match.data().winnerScore || 0);
                    this.stats.totalDeaths += parseInt(match.data().loserScore || 0);
                });

                lostMatches.forEach(match => {
                    this.stats.totalKills += parseInt(match.data().loserScore || 0);
                    this.stats.totalDeaths += parseInt(match.data().winnerScore || 0);
                });

                // Calculate win rate
                const totalGames = this.stats.wins + this.stats.losses;
                this.stats.winRate = totalGames > 0 ? 
                    ((this.stats.wins / totalGames) * 100).toFixed(1) : 0;

                // Update stats display
                this.updateStatsDisplay();
            } catch (error) {
                console.error('Error loading stats:', error);
            }
        });
    }

    updateStatsDisplay() {
        const statsHTML = `
            <div class="stats-container">
                <p>Wins: ${this.stats.wins}</p>
                <p>Losses: ${this.stats.losses}</p>
                <p>Total Kills: ${this.stats.totalKills}</p>
                <p>Total Deaths: ${this.stats.totalDeaths}</p>
                <p>Win Rate: ${this.stats.winRate}%</p>
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