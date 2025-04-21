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

// Admin emails (quick access)
const ADMIN_EMAILS = ['admin@ladder.com', 'Brian2af@outlook.com'];

// Cache for auth state to avoid unnecessary checks
const userCache = {
    uid: null,
    username: null,
    isAdmin: false,
    hasCheckedCollections: false,
    lastChecked: 0
};

// Update auth section without database checks
function updateAuthSectionImmediate(user, isAdmin = false) {
    const authSection = document.getElementById('auth-section');
    if (!authSection) return;
    
    // Show admin links immediately if we know they're an admin
    if (user && isAdmin) {
        document.querySelectorAll('.admin-only').forEach(link => {
            link.style.display = 'block';
        });
    } else if (!user) {
        document.querySelectorAll('.admin-only').forEach(link => {
            link.style.display = 'none';
        });
    }
    
    // Update auth section UI
    if (user) {
        // Use cached username or email initially
        const displayName = userCache.username || 
                           (user.email ? user.email.split('@')[0] : 'User');
        
        authSection.innerHTML = `
            <div class="nav-dropdown">
                <a href="#" class="nav-username">${displayName}${isAdmin ? ' (Admin)' : ''}</a>
                <div class="nav-dropdown-content">
                    <a href="profile.html?username=${encodeURIComponent(displayName)}">Profile</a>
                    <a href="#" id="logout-link">Sign Out</a>
                </div>
            </div>
        `;
        
        // Set up logout handler
        const logoutLink = document.getElementById('logout-link');
        if (logoutLink) {
            logoutLink.addEventListener('click', (e) => {
                e.preventDefault();
                const auth = getAuth();
                
                // Don't reload - just update UI first
                updateAuthSectionImmediate(null);
                
                // Then sign out
                auth.signOut().catch(error => {
                    console.error('Error signing out:', error);
                });
            });
        }
    } else {
        // No user - always show login
        authSection.innerHTML = `<a href="login.html" class="login-link">Login</a>`;
    }
}

// Main auth section update with database checks
async function updateAuthSection(user) {
    // Update UI immediately with what we know
    const quickAdminCheck = user && isAdmin(user.email);
    updateAuthSectionImmediate(user, quickAdminCheck);
    
    // Exit early if no user
    if (!user) {
        userCache.uid = null;
        userCache.username = null;
        userCache.isAdmin = false;
        userCache.hasCheckedCollections = false;
        return;
    }
    
    // If user hasn't changed and we've checked collections recently, don't recheck
    const now = Date.now();
    if (user.uid === userCache.uid && 
        userCache.hasCheckedCollections && 
        now - userCache.lastChecked < 300000) { // 5 minutes
        return;
    }
    
    try {
        // Update cache with current user ID
        userCache.uid = user.uid;
        userCache.lastChecked = now;
        
        // Check admin status first (fastest)
        const isUserAdmin = isAdmin(user.email);
        userCache.isAdmin = isUserAdmin;
        
        if (!isUserAdmin) {
            // Check for admin roles if not already an admin
            const hasAdminRole = await checkAdminRoles(user);
            userCache.isAdmin = hasAdminRole;
            
            // Update admin links if role check found admin privileges
            if (hasAdminRole) {
                document.querySelectorAll('.admin-only').forEach(link => {
                    link.style.display = 'block';
                });
            }
        }
        
        // Check collections in parallel for username
        const collections = [
            'players',
            'playersD2', 
            'playersD3', 
            'playersDuos', 
            'playersCTF',
            'nonParticipants',
            'userProfiles' // Check userProfiles too for username
        ];
        
        const checkPromises = collections.map(collection => 
            getDoc(doc(db, collection, user.uid))
                .then(doc => doc.exists() ? { collection, data: doc.data() } : null)
                .catch(() => null)
        );
        
        const results = await Promise.all(checkPromises);
        const validResults = results.filter(result => result !== null);
        
        // Find username from results
        let username = null;
        for (const result of validResults) {
            if (result.data.username) {
                username = result.data.username;
                break;
            }
        }
        
        // Update cache
        userCache.username = username || (user.email ? user.email.split('@')[0] : 'User');
        userCache.hasCheckedCollections = true;
        
        // Final UI update with complete info
        updateAuthSectionImmediate(user, userCache.isAdmin);
        
    } catch (error) {
        console.error('Error in full auth update:', error);
    }
}

// Simplified admin role check
async function checkAdminRoles(user) {
    if (!user || !user.email) return false;
    
    try {
        // Check critical collections in parallel
        const collections = ['players', 'playersD2', 'nonParticipants'];
        
        const queries = collections.map(async (collectionName) => {
            const playersRef = collection(db, collectionName);
            const q = query(playersRef, where('email', '==', user.email));
            return getDocs(q).then(snapshot => {
                if (!snapshot.empty) {
                    const userData = snapshot.docs[0].data();
                    const roleName = userData.roleName?.toLowerCase();
                    return roleName === 'council' || 
                           roleName === 'creative lead' || 
                           roleName === 'owner';
                }
                return false;
            }).catch(() => false);
        });
        
        const results = await Promise.all(queries);
        return results.includes(true);
    } catch {
        return false;
    }
}

// Initialize auth state listener
document.addEventListener('DOMContentLoaded', () => {
    const auth = getAuth();
    
    // Listen for auth state changes
    onAuthStateChanged(auth, async (user) => {
        await updateAuthSection(user);
    });
});

export { updateAuthSection };