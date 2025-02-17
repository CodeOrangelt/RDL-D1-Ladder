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
            console.log('Starting profile initialization...');
            const urlParams = new URLSearchParams(window.location.search);
            let username = urlParams.get('username');
            console.log('URL username parameter:', username);

            if (!username) {
                const currentUser = auth.currentUser;
                console.log('No username in URL, checking current user:', currentUser);
                
                if (currentUser) {
                    // Get current user's profile
                    console.log('Getting current user document for ID:', currentUser.uid);
                    const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
                    if (userDoc.exists()) {
                        console.log('User document found:', userDoc.data());
                        username = userDoc.data().username;
                    } else {
                        console.log('No user document found for current user');
                    }
                } else {
                    console.log('No current user and no username provided');
                    this.showError('Profile not found - No username provided');
                    return;
                }
            }

            // Query players collection by username
            console.log('Querying players collection for username:', username);
            const playersRef = collection(db, 'players');
            const q = query(playersRef, where('username', '==', username));
            const playerSnapshot = await getDocs(q);

            console.log('Player query results:', {
                empty: playerSnapshot.empty,
                size: playerSnapshot.size
            });

            if (playerSnapshot.empty) {
                console.log('No player found with username:', username);
                this.showError('User not found');
                return;
            }

            // Get the player document
            const playerDoc = playerSnapshot.docs[0];
            const userId = playerDoc.id;
            const playerData = playerDoc.data();
            console.log('Player data found:', {
                userId: userId,
                playerData: playerData
            });

            // Get profile data
            console.log('Fetching profile data for userId:', userId);
            const profileDoc = await getDoc(doc(db, 'userProfiles', userId));
            const profileData = profileDoc.exists() ? profileDoc.data() : {};
            console.log('Profile data:', profileData);

            // Display the combined profile data
            const combinedData = {
                ...profileData,
                ...playerData,
                username: playerData.username,
                userId: userId
            };
            console.log('Combined profile data:', combinedData);
            this.displayProfile(combinedData);

            // Show edit controls if viewing own profile
            const currentUser = auth.currentUser;
            console.log('Checking edit permissions:', {
                currentUser: currentUser?.uid,
                profileUserId: userId,
                canEdit: currentUser && currentUser.uid === userId
            });

            if (currentUser && currentUser.uid === userId) {
                document.getElementById('edit-profile').style.display = 'block';
                const uploadBtn = document.querySelector('.upload-btn');
                if (uploadBtn) uploadBtn.style.display = 'inline-block';
            }

        } catch (error) {
            console.error('Profile initialization error:', error);
            console.error('Error stack:', error.stack);
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

    // Also modify the displayProfile method to store the data
    displayProfile(data) {
        this.currentProfileData = data;
        
        // Always use default profile picture
        const profilePreview = document.getElementById('profile-preview');
        if (profilePreview) {
            profilePreview.src = 'images/shieldorb.png';
        }

        // Rest of the display logic...
        document.getElementById('nickname').textContent = data.username;
        document.getElementById('motto-view').textContent = data.motto || 'No motto set';
        document.getElementById('favorite-map-view').textContent = data.favoriteMap || 'Not specified';
        document.getElementById('favorite-weapon-view').textContent = data.favoriteWeapon || 'Not specified';

        // Check if current user is the profile owner
        const currentUser = auth.currentUser;
        const isOwner = currentUser && currentUser.uid === data.userId;

        // Show/hide edit controls based on ownership
        const editBtn = document.getElementById('edit-profile');
        const imageUploadControls = document.querySelector('.image-upload-controls');
        
        if (editBtn) editBtn.style.display = isOwner ? 'block' : 'none';
        if (imageUploadControls) imageUploadControls.style.display = isOwner ? 'block' : 'none';

        // Only populate edit fields if user is the owner
        if (isOwner) {
            const mottoEdit = document.getElementById('motto-edit');
            const mapEdit = document.getElementById('favorite-map-edit');
            const weaponEdit = document.getElementById('favorite-weapon-edit');

            if (mottoEdit) mottoEdit.value = data.motto || '';
            if (mapEdit) mapEdit.value = data.favoriteMap || '';
            if (weaponEdit) weaponEdit.value = data.favoriteWeapon || '';
        }
    }

    // Modify the toggleEditMode method to populate form fields
    toggleEditMode(isEditing) {
        const viewMode = document.querySelector('.view-mode');
        const editMode = document.querySelector('.edit-mode');
        
        if (isEditing && this.currentProfileData) {
            // Populate edit fields
            document.getElementById('motto-edit').value = this.currentProfileData.motto || '';
            document.getElementById('favorite-map-edit').value = this.currentProfileData.favoriteMap || '';
            document.getElementById('favorite-weapon-edit').value = this.currentProfileData.favoriteWeapon || '';
            
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