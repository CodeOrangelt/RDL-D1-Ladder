import { 
    getAuth, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    doc, 
    getDoc, 
    collection, 
    query, 
    where, 
    getDocs 
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
    
    // Add loading indication
    showLoadingState();
    
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
                username = user.email ? user.email.split('@')[0] : 'User';
                console.log('Username not found in any collection, using fallback:', username);
            }
            
            const isUserAdmin = isAdmin(user.email);
            console.log('User admin status:', isUserAdmin);
            
            // Update the UI with dropdown - consistent styling
            authSection.innerHTML = `
                <div class="nav-dropdown">
                    <a href="#" class="nav-username">${username}${isUserAdmin ? ' (Admin)' : ''}</a>
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
            const username = user.email ? user.email.split('@')[0] : 'User';
            
            authSection.innerHTML = `
                <div class="nav-dropdown">
                    <a href="#" class="nav-username">${username}</a>
                    <div class="nav-dropdown-content">
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

// Check if user should have admin access (admins + council + creative leads)
async function checkAdminAccess(user) {
    if (!user || !user.email) return false;
    
    // Check if user is a system admin first (fastest check)
    if (isAdmin(user.email)) {
        console.log(`${user.email} is a system admin - granting admin access`);
        return true;
    }
    
    // Check for role-based access
    try {
        // Check collections where roles might be stored
        const collections = [
            'players',     // D1
            'playersD2', 
            'nonParticipants'
        ];
        
        for (const collectionName of collections) {
            const playersRef = collection(db, collectionName);
            
            // Try to find by email
            let q = query(playersRef, where('email', '==', user.email));
            let snapshot = await getDocs(q);
            
            // If not found, try by username
            if (snapshot.empty) {
                q = query(playersRef, where('username', '==', user.email.toLowerCase()));
                snapshot = await getDocs(q);
            }
            
            // If found in this collection
            if (!snapshot.empty) {
                const userData = snapshot.docs[0].data();
                const roleName = userData.roleName?.toLowerCase();
                
                if (roleName === 'council' || roleName === 'creative lead' || roleName === 'owner') {
                    console.log(`${user.email} has role ${roleName} - granting admin access`);
                    return true;
                }
            }
        }
        
        console.log(`${user.email} has no admin access role`);
        return false;
    } catch (error) {
        console.error('Error checking admin access:', error);
        return false;
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
            
            // Update admin link visibility - UPDATED CODE HERE
            const adminLinks = document.querySelectorAll('.admin-only');
            if (adminLinks.length > 0 && user) {
                // Check both admin status and roles
                const hasAdminAccess = await checkAdminAccess(user);
                console.log('Updating admin link visibility:', hasAdminAccess);
                adminLinks.forEach(link => {
                    link.style.display = hasAdminAccess ? 'block' : 'none';
                });
            }
        });
    } catch (error) {
        console.error('Error in auth state listener setup:', error);
    }
});

export { updateAuthSection };