import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

class ProfileViewer {
    constructor() {
        this.init();
    }

    async init() {
        // Wait for auth state to be determined
        onAuthStateChanged(auth, async (user) => {
            // Get userId from URL parameter
            const urlParams = new URLSearchParams(window.location.search);
            let userId = urlParams.get('id');

            try {
                // If no ID in URL, try to get current user's profile
                if (!userId && user) {
                    userId = user.uid;
                }

                if (!userId) {
                    this.showError('Profile not found - No user ID provided');
                    return;
                }

                // Load profile data
                const profileDoc = await getDoc(doc(db, 'profiles', userId));
                const userDoc = await getDoc(doc(db, 'users', userId));

                if (!profileDoc.exists() && !userDoc.exists()) {
                    this.showError(`Profile not found for ID: ${userId}`);
                    return;
                }

                const profileData = profileDoc.exists() ? profileDoc.data() : {};
                const userData = userDoc.exists() ? userDoc.data() : {};

                this.displayProfile({
                    ...profileData,
                    ...userData,
                    userId: userId,
                    username: userData.username || profileData.nickname || 'Anonymous'
                });

                // Show edit button if viewing own profile
                if (user && user.uid === userId) {
                    document.getElementById('edit-profile').style.display = 'block';
                }

            } catch (error) {
                console.error('Error loading profile:', error);
                this.showError(`Error loading profile: ${error.message}`);
            }
        });
    }

    displayProfile(data) {
        document.getElementById('profile-preview').src = data.pfpUrl || 'default-avatar.png';
        document.getElementById('nickname').textContent = data.username;
        document.getElementById('motto').textContent = data.motto || 'No motto set';
        document.getElementById('favorite-map').textContent = data.favoriteMap || 'Not specified';
        document.getElementById('favorite-weapon').textContent = data.favoriteWeapon || 'Not specified';
    }

    showError(message) {
        const container = document.querySelector('.profile-content');
        container.innerHTML = `<div class="error-message">${message}</div>`;
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new ProfileViewer();
});