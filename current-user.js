import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { auth, db } from './firebase-config.js';

// Add loading state function
function showLoadingState() {
    const authSection = document.getElementById('auth-section');
    if (authSection) {
        authSection.innerHTML = '<span class="loading">Loading...</span>';
    }
}

async function updateAuthSection(user) {
    const authSection = document.getElementById('auth-section');
    if (!authSection) return;
    
    // Show loading state while fetching data
    showLoadingState();
    
    if (user) {
        try {
            const userDoc = await getDoc(doc(db, 'players', user.uid));
            const username = userDoc.exists() ? userDoc.data().username : user.email;
            
            authSection.innerHTML = `
                <div class="user-dropdown">
                    <span id="current-user">${username}</span>
                    <div class="dropdown-content">
                        <a href="profile.html?username=${encodeURIComponent(username)}">Profile</a>
                        <a href="#" id="sign-out-link">Sign Out</a>
                    </div>
                </div>
            `;
        } catch (error) {
            console.error("Error fetching user data:", error);
            authSection.innerHTML = `<a href="login.html" class="auth-link">Login</a>`;
        }
    } else {
        authSection.innerHTML = `<a href="login.html" class="auth-link">Login</a>`;
    }
}

// Initialize immediately and listen for auth state changes
document.addEventListener('DOMContentLoaded', () => {
    showLoadingState();
    onAuthStateChanged(auth, async (user) => {
        await updateAuthSection(user);
        // Show/hide admin link based on user email
        const adminLink = document.querySelector('.admin-only');
        if (adminLink) {
            adminLink.style.display = user?.email === 'admin@ladder.com' ? 'block' : 'none';
        }
    });
});