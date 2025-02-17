import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { auth, db } from './firebase-config.js';

async function updateAuthSection(user) {
    const authSection = document.getElementById('auth-section');
    if (!authSection) return;
    
    if (user) {
        try {
            const userDoc = doc(db, 'players', user.uid);
            const docSnap = await getDoc(userDoc);
            const username = docSnap.exists() ? docSnap.data().username : user.email;
            
            authSection.innerHTML = `
                <div class="user-dropdown">
                    <span id="current-user">${username}</span>
                    <div class="dropdown-content">
                        <a href="profile.html">Profile</a>
                        <a href="#" id="sign-out-link">Sign Out</a>
                    </div>
                </div>
            `;
        } catch (error) {
            console.error("Error fetching user data:", error);
            authSection.innerHTML = `
                <div class="user-dropdown">
                    <span id="current-user">${user.email}</span>
                    <div class="dropdown-content">
                        <a href="profile.html">Profile</a>
                        <a href="#" id="sign-out-link">Sign Out</a>
                    </div>
                </div>
            `;
        }
    } else {
        authSection.innerHTML = `
            <a href="login.html" class="auth-link">Login</a>
        `;
    }
}

// Listen for auth state changes
onAuthStateChanged(auth, async (user) => {
    await updateAuthSection(user);
    // Show/hide admin link based on user email
    const adminLink = document.querySelector('.admin-only');
    if (adminLink) {
        adminLink.style.display = user?.email === 'admin@ladder.com' ? 'block' : 'none';
    }
});