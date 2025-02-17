
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

class ProfileViewer {
    constructor() {
        this.loadProfile();
    }

    async loadProfile() {
        // Get userId from URL parameter
        const urlParams = new URLSearchParams(window.location.search);
        const userId = urlParams.get('id');

        if (!userId) {
            window.location.href = 'index.html';
            return;
        }

        try {
            const profileDoc = await getDoc(doc(db, 'profiles', userId));
            if (profileDoc.exists()) {
                const data = profileDoc.data();
                this.displayProfile(data);
            } else {
                this.showError('Profile not found');
            }
        } catch (error) {
            console.error('Error loading profile:', error);
            this.showError('Error loading profile');
        }
    }

    displayProfile(data) {
        document.getElementById('profile-preview').src = data.pfpUrl || 'default-avatar.png';
        document.getElementById('nickname').textContent = data.nickname || 'Anonymous';
        document.getElementById('motto').textContent = data.motto || '';
        document.getElementById('favorite-map').textContent = data.favoriteMap || 'Not specified';
        document.getElementById('favorite-weapon').textContent = data.favoriteWeapon || 'Not specified';
        
        // Show edit button only if viewing own profile
        const currentUser = auth.currentUser;
        if (currentUser && currentUser.uid === userId) {
            document.getElementById('edit-profile').style.display = 'block';
        }
    }

    showError(message) {
        const container = document.querySelector('.container');
        container.innerHTML = `<div class="error-message">${message}</div>`;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new ProfileViewer();
});