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
    getDocs,
    limit  // Add this missing import
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
    lastChecked: 0,
    role: null // Add this line to store the user's role
};

// Remove the setInterval completely and replace with event-driven checks

// Add caching for invitation checks
const invitationCache = {
    lastCheck: 0,
    pendingCount: 0,
    checkInterval: 300000 // 5 minutes cache
};

// Add this missing function
function updateInboxNotification(pendingCount) {
    const inboxNotification = document.getElementById('inbox-notification');
    if (inboxNotification) {
        if (pendingCount > 0) {
            inboxNotification.style.display = 'inline-block';
            inboxNotification.textContent = pendingCount > 9 ? '9+' : pendingCount;
        } else {
            inboxNotification.style.display = 'none';
        }
    }
}

// Update the invitation checking function with caching
async function checkPendingInvitationsForCurrentUser(userId) {
    try {
        const now = Date.now();
        
        // Use cache if recent
        if (now - invitationCache.lastCheck < invitationCache.checkInterval) {
            updateInboxNotification(invitationCache.pendingCount);
            return invitationCache.pendingCount;
        }
        
        invitationCache.lastCheck = now;
        
        const invitationsRef = collection(db, 'gameInvitations');
        const q = query(
            invitationsRef,
            where('toUserId', '==', userId),
            where('status', '==', 'pending'),
            limit(5) // Only need count
        );
        
        const snapshot = await getDocs(q);
        const pendingCount = snapshot.size;
        
        // Update cache
        invitationCache.pendingCount = pendingCount;
        
        updateInboxNotification(pendingCount);
        return pendingCount;
        
    } catch (error) {
        console.warn('Could not check pending invitations for current user:', error);
        return 0;
    }
}

// Modify updateAuthSectionImmediate to display the role instead of just "(Admin)"
function updateAuthSectionImmediate(user, isAdmin = false) {
    const authSection = document.getElementById('auth-section');
    if (!authSection) return;
    
    // Handle admin link visibility
    document.querySelectorAll('.admin-only').forEach(link => {
        if (isAdmin) {
            if (link.closest('li')) {
                link.closest('li').style.display = 'block';
            } else {
                link.style.display = 'block';
            }
        } else {
            if (link.closest('li')) {
                link.closest('li').style.display = 'none';
            } else {
                link.style.display = 'none';
            }
        }
    });
    
    // Update auth section UI
    if (user) {
        // Use cached username or email initially
        const displayName = userCache.username || 
                           (user.email ? user.email.split('@')[0] : 'User');
        
        // Use the specific role if available, otherwise use "(Admin)" if they're an admin
        const roleDisplay = userCache.role ? ` (${userCache.role})` : (isAdmin ? ' (Admin)' : '');
        
        // Build admin link HTML if user is admin
        const adminLinkHtml = isAdmin ? '<a href="./admin.html"><i class="fas fa-shield-alt"></i> Admin</a>' : '';
        
        authSection.innerHTML = `
            <div class="nav-dropdown">
            <a href="#" class="nav-username">${displayName}${roleDisplay}</a>
            <div class="nav-dropdown-content">
                <a href="profile.html?username=${encodeURIComponent(displayName)}"><i class="fas fa-user"></i> Profile</a>
                <a href="./inbox.html" class="nav-notification">
                <i class="fas fa-inbox"></i>&nbsp;Inbox 
                <span id="inbox-notification" class="notification-dot" style="display: none;"></span>
                </a>
                <a href="./highlights.html"><i class="fas fa-star"></i> Highlights</a>
                <a href="./articles.html"><i class="fas fa-newspaper"></i> News</a>
                <a href="members.html"><i class="fas fa-users"></i> Members</a>
                <a href="./redeem.html"><i class="fas fa-gift"></i> Store</a>
                ${adminLinkHtml}
                <a href="#" id="logout-link"><i class="fas fa-sign-out-alt"></i> Sign Out</a>
            </div>
            </div>
        `;
        
        // Update the logout handler to be more robust (around line 123)
        const logoutLink = document.getElementById('logout-link');
        if (logoutLink) {
            // Remove any existing listeners to prevent duplicates
            const newLogoutLink = logoutLink.cloneNode(true);
            logoutLink.parentNode.replaceChild(newLogoutLink, logoutLink);
            
            newLogoutLink.addEventListener('click', async (e) => {
                e.preventDefault();
                try {
                    const auth = getAuth();
                    
                    // Clear all caches BEFORE signing out
                    userCache.uid = null;
                    userCache.username = null;
                    userCache.isAdmin = false;
                    userCache.hasCheckedCollections = false;
                    userCache.role = null;
                    invitationCache.lastCheck = 0;
                    invitationCache.pendingCount = 0;
                    
                    // Clear localStorage and sessionStorage
                    localStorage.clear();
                    sessionStorage.clear();
                    
                    // Update UI immediately to show logged out state
                    updateAuthSectionImmediate(null, false);
                    
                    // Sign out from Firebase
                    await auth.signOut();
                    
                    // Wait a bit to ensure Firebase state has propagated
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                    // Redirect to index page
                    window.location.href = './index.html';
                } catch (error) {
                    console.error('Error signing out:', error);
                    // Even if there's an error, try to clear everything and reload
                    localStorage.clear();
                    sessionStorage.clear();
                    window.location.href = './index.html';
                }
            });
        }
        
        // Check for pending invitations after creating the UI
        if (user.uid) {
            setTimeout(() => {
                checkPendingInvitationsForCurrentUser(user.uid);
            }, 1000);
        }
        
    } else {
        // No user - always show login
        authSection.innerHTML = `<a href="login.html" class="login-link">Login</a>`;
    }
}

// Update the checkAdminRoles function to return the role, not just a boolean
async function checkAdminRoles(user) {
    if (!user || !user.email) return { isAdmin: false, role: null };
    
    try {
        // Set up logging for debugging
        console.log(`Checking roles for user: ${user.email}`);
        
        const collections = ['players', 'playersD2', 'playersD3', 'nonParticipants', 'userProfiles'];
        const adminRoles = ['council', 'creative lead', 'owner', 'admin'];
        
        // 1. First try direct user ID lookup
        for (const collectionName of collections) {
            try {
                const docRef = doc(db, collectionName, user.uid);
                const docSnap = await getDoc(docRef);
                
                if (docSnap.exists()) {
                    const userData = docSnap.data();
                    console.log(`Found user in ${collectionName} by UID:`, userData);
                    
                    let roleName = (userData.roleName || userData.role || '').toLowerCase();
                    let originalRoleName = userData.roleName || userData.role || '';
                    
                    if (roleName && adminRoles.includes(roleName)) {
                        console.log(`Found admin role: ${roleName} in ${collectionName}`);
                        
                        const displayRole = originalRoleName.split(' ')
                            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                            .join(' ');
                        
                        return { isAdmin: true, role: displayRole };
                    }
                }
            } catch (err) {
                console.error(`Error checking ${collectionName} by UID:`, err);
            }
        }
        
        // 2. Then try email lookup (case insensitive)
        for (const collectionName of collections) {
            try {
                const colRef = collection(db, collectionName);
                // First try exact match
                let q = query(colRef, where('email', '==', user.email));
                let snapshot = await getDocs(q);
                
                // If no results, try lowercase
                if (snapshot.empty) {
                    q = query(colRef, where('email', '==', user.email.toLowerCase()));
                    snapshot = await getDocs(q);
                }
                
                if (!snapshot.empty) {
                    const userData = snapshot.docs[0].data();
                    console.log(`Found user in ${collectionName} by email:`, userData);
                    
                    let roleName = (userData.roleName || userData.role || '').toLowerCase();
                    let originalRoleName = userData.roleName || userData.role || '';
                    
                    if (roleName && adminRoles.includes(roleName)) {
                        console.log(`Found admin role: ${roleName} in ${collectionName}`);
                        
                        const displayRole = originalRoleName.split(' ')
                            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                            .join(' ');
                        
                        return { isAdmin: true, role: displayRole };
                    }
                }
            } catch (err) {
                console.error(`Error checking ${collectionName} by email:`, err);
            }
        }
        
        console.log("No admin roles found for user");
        return { isAdmin: false, role: null };
    } catch (error) {
        console.error('Error in checkAdminRoles:', error);
        return { isAdmin: false, role: null };
    }
}

// Update the main updateAuthSection function to use the new role info
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
        userCache.role = null; // Reset role
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
            // Check for admin roles if not already an admin by email
            const { isAdmin: hasAdminRole, role } = await checkAdminRoles(user);
            userCache.isAdmin = hasAdminRole;
            userCache.role = role;
            
            // Update the UI immediately with the role if admin
            if (hasAdminRole) {
                updateAuthSectionImmediate(user, true);
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
        
        // Check for pending invitations with the updated UI
        setTimeout(() => {
            checkPendingInvitationsForCurrentUser(user.uid);
        }, 500);
        
    } catch (error) {
        console.error('Error in full auth update:', error);
    }
}

// Initialize auth state listener
document.addEventListener('DOMContentLoaded', () => {
    const auth = getAuth();
    
    // Listen for auth state changes
    onAuthStateChanged(auth, async (user) => {
        await updateAuthSection(user);
        
        // Only check invitations once on auth state change
        if (user) {
            checkPendingInvitationsForCurrentUser(user.uid);
        }
    });
    
    // Check invitations when page becomes visible (user returns to tab)
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && auth.currentUser) {
            checkPendingInvitationsForCurrentUser(auth.currentUser.uid);
        }
    });
    
    // Check invitations when user clicks on navigation (page navigation)
    document.addEventListener('click', (e) => {
        if (e.target.closest('a[href]') && auth.currentUser) {
            checkPendingInvitationsForCurrentUser(auth.currentUser.uid);
        }
    });
});

export { updateAuthSection };