import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

class ProfileViewer {
    constructor() {
        this.init();
        this.setupEventListeners();
    }

    setupEventListeners() {
        const editBtn = document.getElementById('edit-profile');
        const cancelBtn = document.querySelector('.cancel-btn');
        const profileForm = document.getElementById('profile-form');

        editBtn?.addEventListener('click', () => this.toggleEditMode(true));
        cancelBtn?.addEventListener('click', () => this.toggleEditMode(false));
        profileForm?.addEventListener('submit', (e) => this.handleSubmit(e));
    }

    async init() {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            let username = urlParams.get('username');

            if (!username) {
                const currentUser = auth.currentUser;
                if (currentUser) {
                    // Get current user's profile
                    const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
                    username = userDoc.data().username;
                } else {
                    this.showError('Profile not found - No username provided');
                    return;
                }
            }

            // Query players collection by username
            const playersRef = collection(db, 'players');
            const q = query(playersRef, where('username', '==', username));
            const playerSnapshot = await getDocs(q);

            if (playerSnapshot.empty) {
                this.showError('User not found');
                return;
            }

            // Get the player document
            const playerDoc = playerSnapshot.docs[0];
            const userId = playerDoc.id;
            const playerData = playerDoc.data();

            // Get profile data
            const profileDoc = await getDoc(doc(db, 'userProfiles', userId));
            const profileData = profileDoc.exists() ? profileDoc.data() : {};

            // Display the combined profile data
            this.displayProfile({
                ...profileData,
                ...playerData,
                username: playerData.username,
                userId: userId
            });

            // Show edit controls if viewing own profile
            const currentUser = auth.currentUser;
            if (currentUser && currentUser.uid === userId) {
                document.getElementById('edit-profile').style.display = 'block';
                const uploadBtn = document.querySelector('.upload-btn');
                if (uploadBtn) uploadBtn.style.display = 'inline-block';
            }

        } catch (error) {
            console.error('Error loading profile:', error);
            this.showError(`Error loading profile: ${error.message}`);
        }
    }

    async handleSubmit(event) {
        event.preventDefault();
        const user = auth.currentUser;
        
        if (!user) {
            this.showError('You must be logged in to edit your profile');
            return;
        }

        try {
            const profileData = {
                motto: document.getElementById('motto-edit').value,
                favoriteMap: document.getElementById('favorite-map-edit').value,
                favoriteWeapon: document.getElementById('favorite-weapon-edit').value,
                lastUpdated: new Date().toISOString()
            };

            // Save to userProfiles collection
            await setDoc(doc(db, 'userProfiles', user.uid), profileData, { merge: true });
            
            this.toggleEditMode(false);
            this.displayProfile({
                ...profileData,
                username: user.displayName || 'Anonymous',
                userId: user.uid
            });

        } catch (error) {
            console.error('Error saving profile:', error);
            this.showError('Failed to save profile changes');
        }
    }

    displayProfile(data) {
        document.getElementById('profile-preview').src = data.pfpUrl || 'default-avatar.png';
        document.getElementById('nickname').textContent = data.username; // Show username
        document.getElementById('motto-view').textContent = data.motto || 'No motto set';
        document.getElementById('favorite-map-view').textContent = data.favoriteMap || 'Not specified';
        document.getElementById('favorite-weapon-view').textContent = data.favoriteWeapon || 'Not specified';
        // Email is used for identification but not displayed
    }

    toggleEditMode(isEditing) {
        const viewMode = document.querySelector('.view-mode');
        const editMode = document.querySelector('.edit-mode');
        if (isEditing) {
            viewMode.style.display = 'none';
            editMode.style.display = 'block';
        } else {
            viewMode.style.display = 'block';
            editMode.style.display = 'none';
        }
    }

    showError(message) {
        const container = document.querySelector('.profile-content');
        container.innerHTML = `<div class="error-message" style="color: white; text-align: center; padding: 20px;">${message}</div>`;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new ProfileViewer();
});