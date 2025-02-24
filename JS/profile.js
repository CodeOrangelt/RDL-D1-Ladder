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
            // Get matches from Firebase
            const approvedMatchesRef = collection(db, 'approvedMatches');
            const [winnerMatches, loserMatches] = await Promise.all([
                getDocs(query(approvedMatchesRef, where('winnerUsername', '==', username))),
                getDocs(query(approvedMatchesRef, where('loserUsername', '==', username)))
            ]);

            // Calculate basic stats
            const wins = winnerMatches.size;
            const losses = loserMatches.size;
            const totalMatches = wins + losses;
            let totalKills = 0;
            let totalDeaths = 0;

            // Calculate kills and deaths from winner matches
            winnerMatches.forEach(doc => {
                const match = doc.data();
                if (match.winnerScore) totalKills += parseInt(match.winnerScore);
                if (match.loserScore) totalDeaths += parseInt(match.loserScore);
            });

            // Calculate kills and deaths from loser matches
            loserMatches.forEach(doc => {
                const match = doc.data();
                if (match.loserScore) totalKills += parseInt(match.loserScore);
                if (match.winnerScore) totalDeaths += parseInt(match.winnerScore);
            });

            // Calculate K/D ratio and win rate
            const kdRatio = totalDeaths === 0 ? totalKills.toFixed(2) : (totalKills / totalDeaths).toFixed(2);
            const winRate = totalMatches === 0 ? '0' : ((wins / totalMatches) * 100).toFixed(1);

            console.log('Stats calculated:', {
                totalMatches,
                wins,
                losses,
                totalKills,
                totalDeaths,
                kdRatio,
                winRate
            });

            // Update DOM elements
            document.getElementById('stats-matches').textContent = totalMatches;
            document.getElementById('stats-wins').textContent = wins;
            document.getElementById('stats-losses').textContent = losses;
            document.getElementById('stats-kd').textContent = kdRatio;
            document.getElementById('stats-winrate').textContent = `${winRate}%`;

        } catch (error) {
            console.error('Error loading player stats:', error);
            // Set default values on error
            ['matches', 'wins', 'losses', 'kd', 'winrate'].forEach(stat => {
                document.getElementById(`stats-${stat}`).textContent = '-';
            });
        }
    }
}

// Initialize profile manager when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new ProfileManager();
});