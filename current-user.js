// Update import statement to use named import
import { 
    getAuth, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { auth, db } from './firebase-config.js';
import { isAdmin } from './admin-check.js';

// Add debugging for imports
console.log('Auth imports loaded:', { onAuthStateChanged: !!onAuthStateChanged });

// Add admin emails array at the top of the file
const ADMIN_EMAILS = ['admin@ladder.com', 'Brian2af@outlook.com'];

// Add loading state function
function showLoadingState() {
    const authSection = document.getElementById('auth-section');
    if (authSection) {
        authSection.innerHTML = '<span class="loading">Loading...</span>';
    }
}

async function updateAuthSection(user) {
    const authSection = document.getElementById('auth-section');
    if (!authSection) {
        console.log('Auth section element not found in DOM');
        return;
    }
    
    console.log('Updating auth section. Current user:', user ? 'logged in' : 'not logged in');
    showLoadingState();
    
    if (user) {
        try {
            const userDoc = await getDoc(doc(db, 'players', user.uid));
            const username = userDoc.exists() ? userDoc.data().username : user.email;
            const isUserAdmin = isAdmin(user.email);
            
            console.log('User data loaded:', { username, isAdmin: isUserAdmin });
            
            authSection.innerHTML = `
                <div class="user-dropdown">
                    <span id="current-user">${username}</span>
                    <div class="dropdown-content">
                        <a href="profile.html?username=${encodeURIComponent(username)}">Profile</a>
                        ${isUserAdmin ? '<a href="admin.html" class="admin-only">Admin</a>' : ''}
                        <a href="#" id="sign-out-link">Sign Out</a>
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('Error updating auth section:', error);
            authSection.innerHTML = `<a href="login.html" class="auth-link">Login</a>`;
        }
    } else {
        console.log('No user logged in, showing login link');
        authSection.innerHTML = `<a href="login.html" class="auth-link">Login</a>`;
    }
    console.log('Auth section update complete. Current HTML:', authSection.innerHTML);
}

// Initialize immediately and listen for auth state changes
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, checking auth dependencies');
    
    if (!onAuthStateChanged) {
        console.error('onAuthStateChanged is not defined!');
        return;
    }
    
    console.log('Setting up auth state listener');
    try {
        onAuthStateChanged(auth, async (user) => {
            console.log('Auth state changed:', {
                userExists: !!user,
                authObject: !!auth,
                timestamp: new Date().toISOString()
            });
            await updateAuthSection(user);
            
            const adminLink = document.querySelector('.admin-only');
            if (adminLink && user) {
                console.log('Updating admin link visibility');
                adminLink.style.display = isAdmin(user.email) ? 'block' : 'none';
            }
        });
    } catch (error) {
        console.error('Error in auth state listener setup:', error);
    }
});