import { 
    getAuth, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    doc, 
    getDoc 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from './firebase-config.js';
import { isAdmin } from './admin-check.js';

// Add debugging for imports
console.log('Auth imports loaded:', { onAuthStateChanged: !!onAuthStateChanged });

// Add admin emails array at the top of the file
const ADMIN_EMAILS = ['admin@ladder.com', 'Brian2af@outlook.com'];

// Add loading state function
function showLoadingState() {
    const authSection = document.getElementById('auth-section');
    if (authSection) {
        authSection.innerHTML = '<span>Loading...</span>';
    }
}

async function updateAuthSection(user) {
    const authSection = document.getElementById('auth-section');
    
    if (!authSection) {
        console.log('Auth section element not found in DOM');
        return;
    }
    
    console.log('Updating auth section. Current user:', user ? 'logged in' : 'not logged in');
    
    if (user) {
        try {
            // Check all possible collections
            const collections = [
                'players',     // D1
                'playersD2', 
                'playersD3', 
                'playersDuos', 
                'playersCTF',
                'nonParticipants'
            ];
            
            let username = null;
            let isNonParticipant = false;
            
            // Check each collection until we find the user
            for (const collection of collections) {
                try {
                    const userDocRef = doc(db, collection, user.uid);
                    const userDoc = await getDoc(userDocRef);
                    
                    if (userDoc.exists()) {
                        username = userDoc.data().username;
                        isNonParticipant = collection === 'nonParticipants';
                        console.log(`Username found in ${collection} collection:`, username);
                        break;
                    }
                } catch (collectionError) {
                    // Log error but continue trying other collections
                    console.warn(`Error checking ${collection} collection:`, collectionError);
                }
            }
            
            // If not found in any collection, fallback to email
            if (!username) {
                username = user.email.split('@')[0];
                console.log('Username not found in any collection, using email part:', username);
            }
            
            const isUserAdmin = isAdmin(user.email);
            
            // Update the UI with dropdown - modify this part in your updateAuthSection function
            authSection.innerHTML = `
                <div class="nav-dropdown">
                    <a href="#" class="nav-username">${username}</a>
                    <div class="nav-dropdown-content">
                        <a href="profile.html?username=${encodeURIComponent(username)}">Profile</a>
                        <a href="#" id="logout-link">Sign Out</a>
                    </div>
                </div>
            `;
            
            // Add event listener to logout link
            const logoutLink = document.getElementById('logout-link');
            if (logoutLink) {
                logoutLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    auth.signOut().then(() => {
                        console.log('User signed out');
                        window.location.reload();
                    }).catch(error => {
                        console.error('Error signing out:', error);
                    });
                });
            }
            
        } catch (error) {
            console.error('Error updating auth section:', error);
            // Still provide basic functionality even if there's an error
            authSection.innerHTML = `
                <div class="dropdown">
                    <span class="username-display">${user.email.split('@')[0]}</span>
                    <div class="dropdown-content">
                        <a href="#" id="logout-link">Sign Out</a>
                    </div>
                </div>
            `;
            
            // Add event listener to logout link
            const logoutLink = document.getElementById('logout-link');
            if (logoutLink) {
                logoutLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    auth.signOut().then(() => {
                        console.log('User signed out');
                        window.location.reload();
                    }).catch(error => {
                        console.error('Error signing out:', error);
                    });
                });
            }
        }
    } else {
        // No user signed in
        authSection.innerHTML = `<a href="login.html">Login</a>`;
    }
}

// Initialize auth state listener
const auth = getAuth();
console.log('Auth object initialized:', !!auth);

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, setting up auth state listener');
    
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

export { updateAuthSection };