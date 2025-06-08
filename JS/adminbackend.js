import { 
    collection, getDocs, query, orderBy, addDoc, deleteDoc, where, doc, getDoc,
    serverTimestamp, setDoc, updateDoc, writeBatch, limit, startAfter, endBefore,
    limitToLast, onSnapshot, deleteField, or, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { auth, db } from './firebase-config.js';
import { getRankStyle } from './ranks.js';
import { isAdmin } from './admin-check.js';

// At the top of adminbackend.js with other global variables
let matchesPagination = { 
    d1: { page: 1, lastVisible: null, firstVisible: null }, 
    d2: { page: 1, lastVisible: null, firstVisible: null },
    d3: { page: 1, lastVisible: null, firstVisible: null }
};

// Helper function to determine text color based on background
function getContrastColor(hexColor) {
    if (!hexColor) return '#ffffff'; // Default to white
    hexColor = hexColor.replace('#', '');
    if (hexColor.length === 3) {
        hexColor = hexColor.split('').map(char => char + char).join('');
    }
    if (hexColor.length !== 6) return '#ffffff'; // Invalid format

    const r = parseInt(hexColor.substring(0, 2), 16);
    const g = parseInt(hexColor.substring(2, 4), 16);
    const b = parseInt(hexColor.substring(4, 6), 16);
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return (yiq >= 128) ? '#000000' : '#ffffff'; // Return black for light colors, white for dark
}

// This is the base64 encoded string for a simple trophy icon
const DEFAULT_TROPHY_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAAACXBIWXMAAAsTAAALEwEAmpwYAAADHUlEQVR4nO2XS0hUURjHf3fGnPGB+cBkzEAFRSglH5mQEiitIFoYEW6iFrWJoE20SReCQUGbXrRqEVFB0SIKKnrhM3wUldmQjc5Yk46Njjpz7+06cO50vTP3jplJ0fnDYe75zpnz/e73+L5zFf4n+X1SUoAM624GUoA0IAjw+IS5BWwgCIwCbuAn0AcMWOsP4NHE+BlqEjmxDZQCq4H5QCoQsALMWJjLWgMTvN8FPALuWWs38MhnfCoQoBvIBY4Du4EVwCyPDj7L+ptA/S/WX4EW4ALQMM1g/k8FmA5UAPuBZYCK94wRyXmU6TlwDEFzwDHgltOHnQKcBWwFjgL5jglOTTeBI8BtuwdVmweLgCvAAsckpq8XwDagzQ7QboPZQC1Q7JjA7KgX2AJ02zkwmjINuAzUzHCyGnAFmDMZ4DqgERHNTEsBDmvT0eVSYNgx1PSl28pOldcGvw/WAOeB+Y6pzEwPEJV1zOvBPcAJx0RmLg3YGw0Yu80G4LRjErOjU0BxJGARcB1Y6JjE7GgQKAD6w4FmAM3AUscE4pMuozqigrMa52RUKiK+ipxKDRkVRAYSoiDwDLiLKKU9iqKMgiQRH2wElsdxwDPgLPAAOZ4Fo/YV5BNkAXXIvFgLXAS+2wDnAU2MZEmsJOIK8NqG/wEVwClEoREmLeKP50hn5FSvgT3AY5v+J5HmHVZ4iY+pNG0E1wEss+FbjXS2vjgeUJETzYLJE5+gz5aHXSzlQBnQFQ9gCPH5F4lL94B2G3yl0QE+jwdwBJgH9ESSMgrcteG7HNJihk1A3AMOAgeBT9E7NE0LAkEnEkYHqEa162QMn+02/LJsxpg0YLexURTl3cSgmqYFTNMccPJ1uIDPxuYScDyG31Ls1+EbK6muSIAul8tQ7Jrq5BoGWhVFCQJ7kQkjlnIQFR1TKowNGY6JomnMQkSoGviXvAWWKIoSjgVxPdLtvwKwQ1GUD7ECugBDURTPeHUBfIwVUNO0EWPyWT+mNGBQ13WXN6CqKoOGYYT8fj8+n2NCCYyLiooC8f75D86ukgTJZSGcAAAAAElFTkSuQmCC";

// Initialize charts container
const charts = {};
let currentLadder = 'D1'; // Default ladder mode
let eloHistoryPagination = { 
    d1: { page: 1, lastVisible: null, firstVisible: null }, 
    d2: { page: 1, lastVisible: null, firstVisible: null },
    d3: { page: 1, lastVisible: null, firstVisible: null } // Add D3 pagination
};
const PAGE_SIZE = 15; // Items per page for history tables

// In your DOMContentLoaded event listener
document.addEventListener('DOMContentLoaded', () => {
    auth.onAuthStateChanged(async (user) => {
        if (!user) {
            window.location.href = 'login.html';
            return;
        }
        
        try {
            // Just initialize the dashboard - permissions will be checked inside
            await initializeAdminDashboard();
        } catch (error) {
            console.error('Error initializing dashboard:', error);
            showNotification('Error setting up admin dashboard', 'error');
        }
    });
});

// Add this function after the initialization code

async function getUserTabPermissions(userEmail) {
    if (!userEmail) return ['dashboard']; // Default minimum access
    
    console.log(`Looking for user role information for ${userEmail} in all collections...`);
    
    // Define collections to check in priority order
    const collectionsToCheck = [
        { name: 'userProfiles', displayName: 'User Profiles' },
        { name: 'players', displayName: 'D1 Players' },
        { name: 'playersD2', displayName: 'D2 Players' },
        { name: 'playersD3', displayName: 'D3 Players' },
        { name: 'nonParticipants', displayName: 'Non-Participants' }
    ];
    
    // First try to find by UID if user is authenticated
    const user = auth.currentUser;
    
    let role = null;
    let roleSource = null;
    
    // Check all collections before deciding on permissions
    for (const collectionInfo of collectionsToCheck) {
        try {
            // If authenticated, try direct user ID lookup first
            if (user) {
                const docRef = doc(db, collectionInfo.name, user.uid);
                const docSnap = await getDoc(docRef);
                
                if (docSnap.exists()) {
                    const userData = docSnap.data();
                    // Log what we found for debugging
                    console.log(`Found user in ${collectionInfo.displayName} by UID:`, userData);
                    
                    // Use roleName if available, otherwise fall back to role
                    // Make sure to normalize by converting to lowercase
                    const foundRole = (userData.roleName || userData.role || '').toLowerCase();
                    
                    if (foundRole && foundRole !== 'none') {
                        role = foundRole;
                        roleSource = collectionInfo.displayName;
                        console.log(`Found specific role: ${role} in ${roleSource}`);
                        break; // Exit the loop once we find a role
                    }
                }
            }
            
            // If no role found by UID (or no authenticated user), try email lookup
            if (!role) {
                const collRef = collection(db, collectionInfo.name);
                const q = query(collRef, where('email', '==', userEmail));
                const querySnapshot = await getDocs(q);
                
                if (!querySnapshot.empty) {
                    const userData = querySnapshot.docs[0].data();
                    console.log(`Found user in ${collectionInfo.displayName} with email ${userEmail}:`, userData);
                    
                    // Use roleName if available, otherwise fall back to role
                    const foundRole = (userData.roleName || userData.role || '').toLowerCase();
                    
                    if (foundRole && foundRole !== 'none') {
                        role = foundRole;
                        roleSource = collectionInfo.displayName;
                        console.log(`Found specific role: ${role} in ${roleSource}`);
                        break; // Exit once we found a role
                    }
                }
            }
        } catch (error) {
            console.error(`Error checking ${collectionInfo.displayName}:`, error);
        }
    }
    
    // If we found a role in any collection, use it to set permissions
    if (role) {
        console.log(`Setting permissions based on role: ${role} (from ${roleSource})`);
        
        // Define role-based permissions
        // Make sure all role names are lowercase for consistency
        const rolePermissions = {
            'admin': ['dashboard', 'manage-players', 'manage-matches', 'manage-articles', 'manage-trophies', 'manage-ranks', 'inactive-players', 'settings', 'manage-trophies', 'elo-history', 'manage-highlights', 'user-roles-section', 'manage-matches', 'manage-points', 'manage-levels-ribbons', 'manage-ribbons'],
            'owner': ['dashboard', 'manage-players', 'manage-matches', 'manage-articles', 'manage-trophies', 'manage-ranks', 'inactive-players', 'settings', 'manage-trophies', 'elo-history', 'manage-highlights', 'user-roles-section', 'manage-matches', 'manage-points', 'manage-levels-ribbons', 'manage-ribbons'],
            'council': ['dashboard', 'manage-players', 'manage-matches'],
            'creative lead': ['dashboard', 'manage-articles', 'manage-trophies', 'elo-history', 'manage-highlights']
        };
        
        // Look up permissions for this role (case insensitive)
        if (rolePermissions[role]) {
            console.log(`Role '${role}' has permissions:`, rolePermissions[role]);
            return rolePermissions[role];
        }
    }
    
    // No role information found or no defined permissions, return default access
    console.log(`No specific permissions for user ${userEmail}, giving default access`);
    return ['dashboard'];
}
// Update the setupSidebarNavigation function

// Fix setupSidebarNavigation function
function setupSidebarNavigation(allowedTabs = []) {
    const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
    const sections = document.querySelectorAll('.admin-section');
    
    // Default to showing dashboard only if no permissions provided
    if (!allowedTabs || allowedTabs.length === 0) {
        allowedTabs = ['dashboard'];
    }
    
    // Hide or show navigation items based on permissions
    navItems.forEach(item => {
        const sectionId = item.getAttribute('data-section');
        
        // Show or hide based on permissions
        if (allowedTabs.includes(sectionId)) {
            item.style.display = 'flex'; // Show this nav item
        } else {
            item.style.display = 'none'; // Hide this nav item
        }
        
        // Setup click events for visible items
        item.addEventListener('click', () => {
            // Get the section ID from data attribute
            const sectionId = item.getAttribute('data-section');
            
            // Verify user has permission to access this section
            if (!allowedTabs.includes(sectionId)) {
                showNotification('You do not have permission to access this section', 'error');
                return;
            }
            
            // Update active state in navigation
            navItems.forEach(navItem => navItem.classList.remove('active'));
            item.classList.add('active');
            
            // Hide all sections and show the selected one
            sections.forEach(section => {
                section.style.display = 'none';
            });
            
            const targetSection = document.getElementById(sectionId);
            if (targetSection) {
                targetSection.style.display = 'block';
                console.log(`Switched to ${sectionId} section`);
            }
        });
    });
    
    // Activate the first allowed tab
    const firstAllowedTab = document.querySelector(`.sidebar-nav .nav-item[data-section="${allowedTabs[0]}"]`);
    if (firstAllowedTab) {
        firstAllowedTab.click();
    }
    
    // Log initialization
    console.log('Sidebar navigation initialized with permissions');
}

// Add lazy loading for tab data
function setupTabNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    let currentSection = null;
    let loadedSections = new Set(); // Track which sections have been loaded
    
    navItems.forEach(item => {
        item.addEventListener('click', function() {
            const targetSection = this.getAttribute('data-section');
            
            // Don't do anything if clicking current section
            if (targetSection === currentSection) return;
            
            // Hide current section if exists
            if (currentSection) {
                document.getElementById(currentSection).style.display = 'none';
                navItems.forEach(i => i.classList.remove('active'));
            }
            
            // Show target section
            document.getElementById(targetSection).style.display = 'block';
            this.classList.add('active');
            currentSection = targetSection;
            
            // No automatic data loading - user must click the load button
            // You can remove this block entirely if you want
        });
    });
}

// Remove automatic data loading from section changes
function loadSectionData(sectionId) {
    // This now does nothing - data loading is triggered by buttons only
    return;
}

// Modify initializeAdminDashboard to include the trophy management section
async function initializeAdminDashboard() {
    try {
        // Get current user and their permissions
        const user = auth.currentUser;
        const allowedTabs = await getUserTabPermissions(user.email);
        console.log(`User ${user.email} allowed tabs:`, allowedTabs);
        
        // Store permissions globally for reference in other functions
        window.userAllowedTabs = allowedTabs;
        
        // Initialize sidebar navigation WITH permissions
        setupSidebarNavigation(allowedTabs);
        
        // Initialize ladder selector
        setupLadderSelector();
        
        // Initialize sections conditionally based on permissions
        setupDashboardSection();
        
        if (allowedTabs.includes('manage-players')) {
            setupManagePlayersSection();
        }
        
        if (allowedTabs.includes('elo-history')) {
            setupEloHistorySection();
        }
        
        if (allowedTabs.includes('manage-ranks')) {
            setupRankControls();
        }
        
        if (allowedTabs.includes('manage-articles')) {
            setupManageArticlesSection();
        }
        
        if (allowedTabs.includes('user-roles-section')) {
            setupUserRolesSection();
        }
        
        // Add trophy management section initialization
        if (allowedTabs.includes('manage-trophies')) {
            setupTrophyManagementSection();
        }

        // Add highlights management section initialization
        if (allowedTabs.includes('manage-highlights')) {
            setupManageHighlightsSection();
        }

        if (allowedTabs.includes('inactive-players')) {
            setupInactivePlayersSection();
        }

        if (allowedTabs.includes('manage-matches')) {
            setupManageMatchesSection();
        }

        if (allowedTabs.includes('manage-points')) {
            setupManagePointsSection();
        }

        // Add ribbon management section initialization
        if (allowedTabs.includes('manage-ribbons')) {
            setupManageRibbonsSection();
        }

        setupDataLoadButtons(allowedTabs);

    } catch (error) {
        console.error("Error initializing admin dashboard:", error);
    }
}

// Fix setupDataLoadButtons function to include trophies
function setupDataLoadButtons(allowedTabs = []) {
    // Default to showing dashboard only if no permissions provided
    if (!allowedTabs || allowedTabs.length === 0) {
        allowedTabs = ['dashboard'];
    }
    
    // Dashboard load button - always available since dashboard is the minimum
    const loadDashboardBtn = document.getElementById('load-dashboard-data');
    if (loadDashboardBtn) {
        loadDashboardBtn.addEventListener('click', function() {
            this.classList.add('loading');
            this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
            
            loadDashboardOverview()
                .then(() => {
                    this.classList.remove('loading');
                    this.innerHTML = '<i class="fas fa-sync-alt"></i> Load Dashboard Data';
                })
                .catch(error => {
                    console.error('Error loading dashboard:', error);
                    this.classList.remove('loading');
                    this.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Error';
                    setTimeout(() => {
                        this.innerHTML = '<i class="fas fa-sync-alt"></i> Load Dashboard Data';
                    }, 3000);
                });
        });
    }
    
    // Trophy management load button
    if (allowedTabs.includes('manage-trophies')) {
        const loadTrophiesBtn = document.getElementById('load-trophies-data');
        if (loadTrophiesBtn) {
            loadTrophiesBtn.addEventListener('click', function() {
                console.log('Load trophies data clicked');
                this.classList.add('loading');
                this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
                
                loadTrophyDefinitions()
                    .then(() => {
                        this.classList.remove('loading');
                        this.innerHTML = '<i class="fas fa-sync-alt"></i> Load Trophies Data';
                    })
                    .catch(error => {
                        console.error('Error loading trophies:', error);
                        this.classList.remove('loading');
                        this.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Error';
                        setTimeout(() => {
                            this.innerHTML = '<i class="fas fa-sync-alt"></i> Load Trophies Data';
                        }, 3000);
                    });
            });
        }
    }
    
    // Players load button
    if (allowedTabs.includes('manage-players')) {
        const loadPlayersBtn = document.getElementById('load-players-data');
        if (loadPlayersBtn) {
            loadPlayersBtn.addEventListener('click', function() {
                console.log('Load players data clicked');
                this.classList.add('loading');
                this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
                
                loadPlayersData()
                    .then(() => {
                        this.classList.remove('loading');
                        this.innerHTML = '<i class="fas fa-sync-alt"></i> Load Players Data';
                    })
                    .catch(error => {
                        console.error('Error loading players:', error);
                        this.classList.remove('loading');
                        this.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Error';
                        setTimeout(() => {
                            this.innerHTML = '<i class="fas fa-sync-alt"></i> Load Players Data';
                        }, 3000);
                    });
            });
        }
    }
    
    // ELO history load button
    if (allowedTabs.includes('elo-history')) {
        const loadHistoryBtn = document.getElementById('load-elo-history-data');
        if (loadHistoryBtn) {
            loadHistoryBtn.addEventListener('click', function() {
                console.log('Load history data clicked');
                this.classList.add('loading');
                this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
                
                loadEloHistory(1)
                    .then(() => {
                        this.classList.remove('loading');
                        this.innerHTML = '<i class="fas fa-sync-alt"></i> Load History Data';
                    })
                    .catch(error => {
                        console.error('Error loading history:', error);
                        this.classList.remove('loading');
                        this.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Error';
                        setTimeout(() => {
                            this.innerHTML = '<i class="fas fa-sync-alt"></i> Load History Data';
                        }, 3000);
                    });
            });
        }
    }
    
    // Articles load button
    if (allowedTabs.includes('manage-articles')) {
        const loadArticlesBtn = document.getElementById('load-articles-data');
        if (loadArticlesBtn) {
            loadArticlesBtn.addEventListener('click', function() {
                console.log('Load articles data clicked');
                this.classList.add('loading');
                this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
                
                loadArticles()
                    .then(() => {
                        this.classList.remove('loading');
                        this.innerHTML = '<i class="fas fa-sync-alt"></i> Load Articles Data';
                    })
                    .catch(error => {
                        console.error('Error loading articles:', error);
                        this.classList.remove('loading');
                        this.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Error';
                        setTimeout(() => {
                            this.innerHTML = '<i class="fas fa-sync-alt"></i> Load Articles Data';
                        }, 3000);
                    });
            });
        }
    }
    
    // Users load button
    if (allowedTabs.includes('user-roles-section')) {
        const loadUsersBtn = document.getElementById('load-users-data');
        if (loadUsersBtn) {
            loadUsersBtn.addEventListener('click', function() {
                console.log('Load users data clicked');
                this.classList.add('loading');
                this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
                
                loadUsersWithRoles()
                    .then(() => {
                        this.classList.remove('loading');
                        this.innerHTML = '<i class="fas fa-sync-alt"></i> Load Users Data';
                    })
                    .catch(error => {
                        console.error('Error loading users:', error);
                        this.classList.remove('loading');
                        this.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Error';
                        setTimeout(() => {
                            this.innerHTML = '<i class="fas fa-sync-alt"></i> Load Users Data';
                        }, 3000);
                    });
            });
        }
    }

        // Add inside setupDataLoadButtons function
    if (allowedTabs.includes('inactive-players')) {
        const loadInactiveBtn = document.getElementById('load-inactive-players-data');
        if (loadInactiveBtn) {
            loadInactiveBtn.addEventListener('click', function() {
                console.log('Load inactive players data clicked');
                this.classList.add('loading');
                this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
                
                loadInactivePlayersData()
                    .then(() => {
                        this.classList.remove('loading');
                        this.innerHTML = '<i class="fas fa-sync-alt"></i> Load Inactive Players';
                    })
                    .catch(error => {
                        console.error('Error loading inactive players:', error);
                        this.classList.remove('loading');
                        this.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Error';
                        setTimeout(() => {
                            this.innerHTML = '<i class="fas fa-sync-alt"></i> Load Inactive Players';
                        }, 3000);
                    });
            });
        }
    }

    // Add highlights load button
    if (allowedTabs.includes('manage-highlights')) {
        const loadHighlightsBtn = document.getElementById('load-highlights-data');
        if (loadHighlightsBtn) {
            loadHighlightsBtn.addEventListener('click', function() {
                console.log('Load highlights data clicked');
                this.classList.add('loading');
                this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
                
                loadHighlightsAdmin()
                    .then(() => {
                        this.classList.remove('loading');
                        this.innerHTML = '<i class="fas fa-sync-alt"></i> Load Highlights';
                    })
                    .catch(error => {
                        console.error('Error loading highlights:', error);
                        this.classList.remove('loading');
                        this.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Error';
                        setTimeout(() => {
                            this.innerHTML = '<i class="fas fa-sync-alt"></i> Load Highlights';
                        }, 3000);
                    });
            });
        }
    }

     // Matches load button and create test match button
    if (allowedTabs.includes('manage-matches')) {
        const loadMatchesBtn = document.getElementById('load-matches-data');
        if (loadMatchesBtn) {
            loadMatchesBtn.addEventListener('click', function() {
                console.log('Load matches data clicked');
                this.classList.add('loading');
                this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
                
                loadMatchesData(1)
                    .then(() => {
                        this.classList.remove('loading');
                        this.innerHTML = '<i class="fas fa-sync-alt"></i> Load Matches';
                    })
                    .catch(error => {
                        console.error('Error loading matches:', error);
                        this.classList.remove('loading');
                        this.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Error';
                        setTimeout(() => {
                            this.innerHTML = '<i class="fas fa-sync-alt"></i> Load Matches';
                        }, 3000);
                    });
            });
        }
        
        // IMPORTANT: Set up the create test match button here too
        setupCreateTestMatchButton();
        setupCreateTestMatchModal();
    }

    // Ribbons management load button
    if (allowedTabs.includes('manage-ribbons')) {
        const loadRibbonsBtn = document.getElementById('load-ribbons-data');
        if (loadRibbonsBtn) {
            loadRibbonsBtn.addEventListener('click', function() {
                console.log('Load ribbons data clicked');
                this.classList.add('loading');
                this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
                
                loadRibbonsData()
                    .then(() => {
                        this.classList.remove('loading');
                        this.innerHTML = '<i class="fas fa-sync-alt"></i> Load Ribbons Data';
                    })
                    .catch(error => {
                        console.error('Error loading ribbons:', error);
                        this.classList.remove('loading');
                        this.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Error';
                        setTimeout(() => {
                            this.innerHTML = '<i class="fas fa-sync-alt"></i> Load Ribbons Data';
                        }, 3000);
                    });
            });
        }
    }

    
    console.log('Data load buttons initialized based on permissions');
}


// Add new setupDashboardSection function 
function setupDashboardSection() {
    // Just set up the UI without loading data
    document.getElementById('player-count').textContent = '-';
    document.getElementById('match-count').textContent = '-';
    document.getElementById('pending-count').textContent = '-';
    document.getElementById('rejected-count').textContent = '-';
}

// Modify setupLadderSelector function to not auto-load data
function setupLadderSelector() {
    const ladderSwitches = document.querySelectorAll('.ladder-switch input');
    
    ladderSwitches.forEach(switchInput => {
        switchInput.addEventListener('change', () => {
            currentLadder = switchInput.value;
            document.body.setAttribute('data-ladder', currentLadder);
            
            // Update the current ladder display for adding players
            const currentLadderDisplay = document.getElementById('current-ladder-display');
            if (currentLadderDisplay) {
                currentLadderDisplay.textContent = currentLadder;
            }
            
            // Reset dashboard stats without loading
            document.getElementById('player-count').textContent = '-';
            document.getElementById('match-count').textContent = '-';
            document.getElementById('pending-count').textContent = '-';
            document.getElementById('rejected-count').textContent = '-';
            
            // Reset charts
            if (charts.rankDistribution) {
                charts.rankDistribution.destroy();
                charts.rankDistribution = null;
            }
            
            if (charts.activity) {
                charts.activity.destroy();
                charts.activity = null;
            }
            
            // No automatic data loading
            showNotification(`Switched to ${currentLadder} ladder. Click "Load Data" to refresh.`, 'info');
        });
    });
    
    // Initialize the display with the current ladder
    const currentLadderDisplay = document.getElementById('current-ladder-display');
    if (currentLadderDisplay) {
        currentLadderDisplay.textContent = currentLadder;
    }
}

// Update loadDashboardOverview function
async function loadDashboardOverview() {
    try {
        console.log('Loading dashboard overview data...');
        
        // Show loading placeholders
        document.getElementById('player-count').textContent = '-';
        document.getElementById('match-count').textContent = '-';
        document.getElementById('pending-count').textContent = '-';
        document.getElementById('rejected-count').textContent = '-';

        // Get collection names based on current ladder
        const playerCollection = 
            currentLadder === 'D1' ? 'players' : 
            currentLadder === 'D2' ? 'playersD2' : 'playersD3';
            
        const matchesCollection = 
            currentLadder === 'D1' ? 'approvedMatches' : 
            currentLadder === 'D2' ? 'approvedMatchesD2' : 'approvedMatchesD3';
            
        const pendingCollection = 
            currentLadder === 'D1' ? 'pendingMatches' : 
            currentLadder === 'D2' ? 'pendingMatchesD2' : 'pendingMatchesD3';
            
        const rejectedCollection = 
            currentLadder === 'D1' ? 'RejectedD1' : 
            currentLadder === 'D2' ? 'RejectedD2' : 'RejectedD3';
        
        console.log(`Using collections for ${currentLadder}: ${playerCollection}, ${matchesCollection}`);
        
        // Get player count
        const playersSnapshot = await getDocs(collection(db, playerCollection));
        const playerCount = playersSnapshot.size;
        
        // Get match count
        const matchesSnapshot = await getDocs(collection(db, matchesCollection));
        const matchCount = matchesSnapshot.size;
        
        // Get pending matches count
        const pendingSnapshot = await getDocs(collection(db, pendingCollection));
        const pendingCount = pendingSnapshot.size;
        
        // Get rejected matches count
        const rejectedSnapshot = await getDocs(collection(db, rejectedCollection));
        const rejectedCount = rejectedSnapshot.size;
        
        // Update stat cards
        document.getElementById('player-count').textContent = playerCount;
        document.getElementById('match-count').textContent = matchCount;
        document.getElementById('pending-count').textContent = pendingCount;
        document.getElementById('rejected-count').textContent = rejectedCount;
        
        // Create dashboard charts
        await createRankDistributionChart();
        await createActivityChart();
        
        console.log('Dashboard data loaded successfully');
        return true;
        
    } catch (error) {
        console.error("Error loading dashboard data:", error);
        throw error;
    }
}

async function createRankDistributionChart() {
    try {
        // Determine collection based on ladder selection
        const playersRef = collection(db, currentLadder === 'D1' ? 'players' : 'playersD2');
        const querySnapshot = await getDocs(playersRef);

        // Count players in each rank
        const rankCounts = {
            'Unranked': 0,
            'Bronze': 0,
            'Silver': 0,
            'Gold': 0,
            'Emerald': 0
        };
        
        querySnapshot.forEach(doc => {
            const player = doc.data();
            const elo = player.eloRating || 1200;
            
            if (elo >= 2000) rankCounts['Emerald']++;
            else if (elo >= 1800) rankCounts['Gold']++;
            else if (elo >= 1600) rankCounts['Silver']++;
            else if (elo >= 1400) rankCounts['Bronze']++;
            else rankCounts['Unranked']++;
        });
        
        const chartContainer = document.getElementById('rank-distribution-chart');
        
        // Destroy existing chart if it exists
        if (charts.rankDistribution) {
            charts.rankDistribution.destroy();
        }
        
        // Create chart
        charts.rankDistribution = new Chart(chartContainer, {
            type: 'doughnut',
            data: {
                labels: Object.keys(rankCounts),
                datasets: [{
                    data: Object.values(rankCounts),
                    backgroundColor: [
                        '#808080', // Unranked - Gray
                        '#CD7F32', // Bronze
                        '#C0C0C0', // Silver
                        '#FFD700', // Gold
                        '#50C878'  // Emerald
                    ],
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            color: '#e0e0e0'
                        }
                    },
                    title: {
                        display: true,
                        text: `${currentLadder} Rank Distribution`,
                        color: '#e0e0e0',
                        font: {
                            size: 16
                        }
                    }
                }
            }
        });
    } catch (error) {
        console.error("Error creating rank distribution chart:", error);
        document.getElementById('rank-distribution-chart').innerHTML = 
            '<div class="chart-error">Error loading chart data</div>';
    }
}

async function createActivityChart() {
    try {
        const matchesCollection = currentLadder === 'D1' ? 'approvedMatches' : 'approvedMatchesD2';
        const matchesRef = collection(db, matchesCollection);
        
        // Get last 7 days of data
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        const q = query(
            matchesRef,
            where('approvedAt', '>=', sevenDaysAgo),
            orderBy('approvedAt', 'asc')
        );
        
        const querySnapshot = await getDocs(q);
        
        // Organize data by day of week
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const activityByDay = dayNames.reduce((acc, day) => ({...acc, [day]: 0}), {});
        
        querySnapshot.forEach(doc => {
            const match = doc.data();
            if (match.approvedAt) {
                const dayOfWeek = dayNames[new Date(match.approvedAt.seconds * 1000).getDay()];
                activityByDay[dayOfWeek]++;
            }
        });
        
        // Create chart
        const chartContainer = document.getElementById('activity-chart');
        
        // Destroy existing chart if it exists
        if (charts.activity) {
            charts.activity.destroy();
        }
        
        charts.activity = new Chart(chartContainer, {
            type: 'bar',
            data: {
                labels: dayNames,
                datasets: [{
                    label: 'Matches Played',
                    data: dayNames.map(day => activityByDay[day]),
                    backgroundColor: currentLadder === 'D1' ? 'rgba(211, 47, 47, 0.7)' : 'rgba(25, 118, 210, 0.7)',
                    borderColor: currentLadder === 'D1' ? '#d32f2f' : '#1976d2',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            color: '#e0e0e0'
                        },
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        }
                    },
                    x: {
                        ticks: {
                            color: '#e0e0e0'
                        },
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        }
                    }
                },
                plugins: {
                    legend: {
                        labels: {
                            color: '#e0e0e0'
                        }
                    },
                    title: {
                        display: true,
                        text: `${currentLadder} Weekly Activity`,
                        color: '#e0e0e0',
                        font: {
                            size: 16
                        }
                    }
                }
            }
        });
    } catch (error) {
        console.error("Error creating activity chart:", error);
        document.getElementById('activity-chart').innerHTML = 
            '<div class="chart-error">Error loading chart data</div>';
    }
}

async function loadPlayersData() {
    const playerTable = document.getElementById('players-table-body');
    if (!playerTable) return;
    
    playerTable.innerHTML = '<tr><td colspan="6" class="loading-cell">Loading players...</td></tr>';
    
    try {
        // Modified to handle D3 correctly
        let playerCollection = 'players'; // Default to D1
        
        if (currentLadder === 'D2') {
            playerCollection = 'playersD2';
        } else if (currentLadder === 'D3') {
            playerCollection = 'playersD3';
        }
        
        console.log(`Loading players from ${playerCollection} collection...`);
        const playersRef = collection(db, playerCollection);
        const q = query(playersRef, orderBy('eloRating', 'desc'));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            playerTable.innerHTML = '<tr><td colspan="6" class="empty-state">No players found</td></tr>';
            return;
        }
        
        playerTable.innerHTML = '';
        let position = 1;
        
        querySnapshot.forEach(doc => {
            const player = doc.data();
            const rank = getRankFromElo(player.eloRating || 1200);
            const rankStyle = getRankStyle(player.eloRating || 1200);
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="position">${position}</td>
                <td class="username" style="color: ${rankStyle.color}">
                    ${player.username || 'Unknown'}
                </td>
                <td class="elo">${player.eloRating || 1200}</td>
                <td class="rank">
                    <span class="rank-badge" style="background-color: ${rankStyle.color}">
                        ${rank}
                    </span>
                </td>
                <td class="stats">
                    ${player.wins || 0}W / ${player.losses || 0}L
                </td>
                <td class="actions">
                    <button class="edit-btn" data-id="${doc.id}">
                        <i class="fas fa-pencil-alt"></i>
                    </button>
                    <button class="delete-btn" data-id="${doc.id}">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </td>
            `;
            playerTable.appendChild(row);
            position++;
        });
        
        // Add event listeners to edit and delete buttons
        setupPlayerActionButtons();
        
    } catch (error) {
        console.error("Error loading players:", error);
        playerTable.innerHTML = `
            <tr>
                <td colspan="6" class="error-state">
                    Error loading players: ${error.message}
                </td>
            </tr>
        `;
    }
}

function getRankFromElo(elo) {
    if (elo >= 2000) return 'Emerald';
    if (elo >= 1800) return 'Gold';
    if (elo >= 1600) return 'Silver';
    if (elo >= 1400) return 'Bronze';
    return 'Unranked';
}

function setupPlayerActionButtons() {
    // Edit buttons
    document.querySelectorAll('.edit-btn').forEach(button => {
        button.addEventListener('click', async (e) => {
            const playerId = e.currentTarget.dataset.id;
            openEditPlayerModal(playerId);
        });
    });
    
    // Delete buttons
    document.querySelectorAll('.delete-btn').forEach(button => {
        button.addEventListener('click', async (e) => {
            const playerId = e.currentTarget.dataset.id;
            confirmDeletePlayer(playerId);
        });
    });
}

async function openEditPlayerModal(playerId) {
    try {
        const playerCollection = currentLadder === 'D1' ? 'players' : 'playersD2';
        const playerRef = doc(db, playerCollection, playerId);
        const playerSnap = await getDoc(playerRef);
        
        if (!playerSnap.exists()) {
            showNotification('Player not found', 'error');
            return;
        }
        
        const player = playerSnap.data();
        
        // Populate the edit modal
        const modal = document.getElementById('edit-player-modal');
        const usernameInput = document.getElementById('edit-username');
        const eloInput = document.getElementById('edit-elo');
        const winsInput = document.getElementById('edit-wins');
        const lossesInput = document.getElementById('edit-losses');
        
        usernameInput.value = player.username || '';
        eloInput.value = player.eloRating || 1200;
        winsInput.value = player.wins || 0;
        lossesInput.value = player.losses || 0;
        
        // Store player ID for the save function
        modal.dataset.playerId = playerId;
        
        // Show the modal
        modal.classList.add('active');
        
    } catch (error) {
        console.error("Error opening edit modal:", error);
        showNotification('Failed to load player data', 'error');
    }
}

async function saveEditedPlayer() {
    try {
        const modal = document.getElementById('edit-player-modal');
        const playerId = modal.dataset.playerId;
        
        if (!playerId) {
            showNotification('No player selected', 'error');
            return;
        }
        
        const usernameInput = document.getElementById('edit-username');
        const eloInput = document.getElementById('edit-elo');
        const winsInput = document.getElementById('edit-wins');
        const lossesInput = document.getElementById('edit-losses');
        
        const username = usernameInput.value.trim();
        const elo = parseInt(eloInput.value);
        const wins = parseInt(winsInput.value);
        const losses = parseInt(lossesInput.value);
        
        if (!username || isNaN(elo)) {
            showNotification('Please enter valid username and ELO', 'error');
            return;
        }
        
        // Update player data
        const playerCollection = currentLadder === 'D1' ? 'players' : 'playersD2';
        const playerRef = doc(db, playerCollection, playerId);
        
        // Get current player data for ELO history tracking
        const currentPlayerSnap = await getDoc(playerRef);
        const currentPlayer = currentPlayerSnap.exists() ? currentPlayerSnap.data() : {};
        const currentElo = currentPlayer.eloRating || 1200;
        
        // Update player document
        await updateDoc(playerRef, {
            username,
            eloRating: elo,
            wins: wins || 0,
            losses: losses || 0,
            lastModifiedAt: serverTimestamp(),
            lastModifiedBy: auth.currentUser.email
        });
        
        // If ELO changed, record in history
        if (elo !== currentElo) {
            const historyCollection = currentLadder === 'D1' ? 'eloHistory' : 'eloHistoryD2';
            await addDoc(collection(db, historyCollection), {
                player: username,
                previousElo: currentElo,
                newElo: elo,
                timestamp: serverTimestamp(),
                type: 'admin_modification',
                modifiedBy: auth.currentUser.email,
                gameMode: currentLadder
            });
        }
        
        // Close modal
        closeEditPlayerModal();
        
        // Refresh player data
        loadPlayersData();
        
        showNotification('Player updated successfully', 'success');
        
    } catch (error) {
        console.error("Error updating player:", error);
        showNotification('Failed to update player: ' + error.message, 'error');
    }
}

function closeEditPlayerModal() {
    const modal = document.getElementById('edit-player-modal');
    modal.classList.remove('active');
    modal.dataset.playerId = '';
}

async function confirmDeletePlayer(playerId) {
    if (confirm('Are you sure you want to delete this player? This action cannot be undone.')) {
        try {
            const playerCollection = currentLadder === 'D1' ? 'players' : 'playersD2';
            await deleteDoc(doc(db, playerCollection, playerId));
            
            // Refresh player data
            loadPlayersData();
            
            showNotification('Player deleted successfully', 'success');
            
        } catch (error) {
            console.error("Error deleting player:", error);
            showNotification('Failed to delete player: ' + error.message, 'error');
        }
    }
}

async function setupManagePlayersSection() {
    // Add player form
    const addPlayerForm = document.getElementById('add-player-form');
    if (addPlayerForm) {
        addPlayerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await addNewPlayer();
        });
    }
    
    // Search functionality
    const searchInput = document.getElementById('player-search');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(filterPlayerTable, 300));
    }
    
    // Edit player modal buttons
    const savePlayerBtn = document.getElementById('save-player-btn');
    if (savePlayerBtn) {
        savePlayerBtn.addEventListener('click', saveEditedPlayer);
    }
    
    const cancelEditBtn = document.getElementById('cancel-edit-btn');
    if (cancelEditBtn) {
        cancelEditBtn.addEventListener('click', closeEditPlayerModal);
    }
    
    // Modal background click to close
    const editModal = document.getElementById('edit-player-modal');
    if (editModal) {
        editModal.addEventListener('click', (e) => {
            if (e.target === editModal) {
                closeEditPlayerModal();
            }
        });
    }
    
    // Ladder selector for players section
    const ladderSelector = document.getElementById('players-ladder-selector');
    if (ladderSelector) {
        ladderSelector.addEventListener('change', () => {
            currentLadder = ladderSelector.value;
            loadPlayersData();
        });
    }
}

async function addNewPlayer() {
    try {
        const usernameInput = document.getElementById('new-player-username');
        const eloInput = document.getElementById('new-player-elo');
        
        const username = usernameInput.value.trim();
        const elo = parseInt(eloInput.value) || 1200;
        
        if (!username) {
            alert('Please enter a valid username');
            return;
        }
        
        console.log(`Adding player ${username} with ELO ${elo} to ${currentLadder} ladder`);
        
        // Determine which collection to use based on currentLadder
        let playerCollection = 'players'; // Default to D1
        let historyCollection = 'eloHistory';
        
        if (currentLadder === 'D2') {
            playerCollection = 'playersD2';
            historyCollection = 'eloHistoryD2';
        } else if (currentLadder === 'D3') {
            playerCollection = 'playersD3';
            historyCollection = 'eloHistoryD3';
        }
        
        // Check if username exists in the collection
        const playerQuery = query(collection(db, playerCollection), where('username', '==', username));
        const playerSnap = await getDocs(playerQuery);
        if (!playerSnap.empty) {
            alert(`Username ${username} already exists in ${currentLadder} ladder`);
            return;
        }
        
        // Add the player to the selected ladder
        const user = auth.currentUser;
        
        const playerData = {
            username,
            eloRating: elo,
            wins: 0,
            losses: 0,
            createdAt: serverTimestamp(),
            createdBy: user ? user.email : 'admin',
            gameMode: currentLadder
        };
        
        // Add player to collection
        await addDoc(collection(db, playerCollection), playerData);
        
        // Record initial ELO in history
        await addDoc(collection(db, historyCollection), {
            player: username,
            previousElo: 1200,
            newElo: elo,
            timestamp: serverTimestamp(),
            type: 'initial_placement',
            placedBy: user ? user.email : 'admin',
            gameMode: currentLadder
        });
        
        // Reset form and refresh display
        usernameInput.value = '';
        eloInput.value = '1200';
        
        // Show success message
        alert(`Player ${username} added successfully to ${currentLadder} ladder!`);
        
        // Refresh player list
        loadPlayersData();
        
    } catch (error) {
        console.error("Error adding player:", error);
        alert(`Error adding player: ${error.message}`);
    }
}

// Make sure the event listener is connected properly
document.addEventListener('DOMContentLoaded', () => {
    const addPlayerForm = document.getElementById('add-player-form');
    if (addPlayerForm) {
        addPlayerForm.addEventListener('submit', (e) => {
            e.preventDefault();
            addNewPlayer();
        });
    }
});

function filterPlayerTable() {
    const searchTerm = document.getElementById('player-search').value.toLowerCase();
    const rows = document.querySelectorAll('#players-table-body tr');
    
    let visibleCount = 0;
    
    rows.forEach(row => {
        const username = row.querySelector('.username')?.textContent.toLowerCase() || '';
        
        if (username.includes(searchTerm)) {
            row.style.display = '';
            visibleCount++;
        } else {
            row.style.display = 'none';
        }
    });
    
    // Show no results message if needed
    const noResults = document.getElementById('no-results-message');
    if (noResults) {
        if (visibleCount === 0 && searchTerm !== '') {
            noResults.style.display = 'block';
        } else {
            noResults.style.display = 'none';
        }
    }
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

async function loadEloHistory(page = 1) {
    const historyTable = document.getElementById('elo-history-table-body');
    const ladderPrefix = currentLadder.toLowerCase(); // d1 or d2 or d3
    
    if (!historyTable) return;
    
    historyTable.innerHTML = '<tr><td colspan="7" class="loading-cell">Loading history...</td></tr>';
    
    try {
        // Update this line to handle D3
        const historyCollection = 
            currentLadder === 'D1' ? 'eloHistory' : 
            currentLadder === 'D2' ? 'eloHistoryD2' : 'eloHistoryD3';
        
        const historyRef = collection(db, historyCollection);
        
        let q;
        
        if (page > eloHistoryPagination[ladderPrefix].page && eloHistoryPagination[ladderPrefix].lastVisible) {
            // Next page
            q = query(
                historyRef,
                orderBy('timestamp', 'desc'),
                startAfter(eloHistoryPagination[ladderPrefix].lastVisible),
                limit(PAGE_SIZE)
            );
        } else if (page < eloHistoryPagination[ladderPrefix].page && eloHistoryPagination[ladderPrefix].firstVisible) {
            // Previous page
            q = query(
                historyRef,
                orderBy('timestamp', 'desc'),
                endBefore(eloHistoryPagination[ladderPrefix].firstVisible),
                limitToLast(PAGE_SIZE)
            );
        } else {
            // First page or reset
            q = query(
                historyRef,
                orderBy('timestamp', 'desc'),
                limit(PAGE_SIZE)
            );
        }
        
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            historyTable.innerHTML = '<tr><td colspan="7" class="empty-state">No ELO history found</td></tr>';
            document.getElementById(`${ladderPrefix}-page-indicator`).textContent = 'Page 1';
            return;
        }   
        
        // Update pagination controls
        eloHistoryPagination[ladderPrefix].page = page;
        
        // Store first and last documents for pagination
        eloHistoryPagination[ladderPrefix].firstVisible = querySnapshot.docs[0];
        eloHistoryPagination[ladderPrefix].lastVisible = querySnapshot.docs[querySnapshot.docs.length - 1];
        
        // Create a cache for userId-to-username lookups to avoid repeated queries
        const usernameCache = new Map();
        
        // Render table
        historyTable.innerHTML = '';
        
        // Function to convert userIds to usernames if needed
        const resolveUsername = async (playerField) => {
            // If it's already clearly a username (contains non-alphanumeric chars or is short)
            if (typeof playerField !== 'string' || 
                playerField.length < 20 || // Most userIds are longer than typical usernames
                /[^a-zA-Z0-9-_]/.test(playerField)) { // Contains special chars
                return playerField;
            }
            
            // Check if we've already resolved this ID
            if (usernameCache.has(playerField)) {
                return usernameCache.get(playerField);
            }
            
            // Try to find the username in multiple collections
            try {
                // Try all player collections 
                for (const collection of ['players', 'playersD2', 'playersD3', 'nonParticipants']) {
                    const userDoc = await getDoc(doc(db, collection, playerField));
                    if (userDoc.exists() && userDoc.data().username) {
                        const username = userDoc.data().username;
                        usernameCache.set(playerField, username);
                        return username;
                    }
                }
                
                // If we get here, we couldn't resolve the username
                return playerField;
            } catch (error) {
                console.warn(`Error resolving username for ${playerField}:`, error);
                return playerField;
            }
        };
        
        // Process entries and render rows with proper username resolution
        for (const doc of querySnapshot.docs) {
            const history = doc.data();
            const row = document.createElement('tr');
            
            const timestamp = history.timestamp 
                ? new Date(history.timestamp.seconds * 1000).toLocaleString() 
                : 'N/A';
            
            const eloChange = history.newElo - history.previousElo;
            const changeClass = eloChange > 0 ? 'positive-change' : eloChange < 0 ? 'negative-change' : '';
            const changeSign = eloChange > 0 ? '+' : '';
            
            // Try to resolve the player name if it might be a userId
            const playerNameField = history.player || history.username || history.userId || 'N/A';
            const playerName = await resolveUsername(playerNameField);
            
            row.innerHTML = `
                <td class="timestamp">${timestamp}</td>
                <td class="player">${playerName}</td>
                <td class="previous-elo">${history.previousElo || 'N/A'}</td>
                <td class="new-elo">${history.newElo || 'N/A'}</td>
                <td class="elo-change ${changeClass}">${changeSign}${eloChange}</td>
                <td class="type">${formatHistoryType(history.type)}</td>
                <td class="admin-action">
                    ${history.modifiedBy || history.promotedBy || history.demotedBy || 'System'}
                </td>
            `;
            
            historyTable.appendChild(row);
        }
        
        // Update page indicator
        document.getElementById(`${ladderPrefix}-page-indicator`).textContent = `Page ${page}`;
        
        // Enable/disable pagination buttons
        const prevButton = document.getElementById(`${ladderPrefix}-prev-page`);
        const nextButton = document.getElementById(`${ladderPrefix}-next-page`);
        
        if (prevButton) prevButton.disabled = page <= 1;
        
        // Check if there are more records
        const nextPageCheck = query(
            historyRef, 
            orderBy('timestamp', 'desc'),
            startAfter(eloHistoryPagination[ladderPrefix].lastVisible),
            limit(1)
        );
        const nextPageSnapshot = await getDocs(nextPageCheck);
        
        if (nextButton) nextButton.disabled = nextPageSnapshot.empty;
        
    } catch (error) {
        console.error("Error loading ELO history:", error);
        historyTable.innerHTML = `
            <tr>
                <td colspan="7" class="error-state">
                    Error loading history: ${error.message}
                </td>
            </tr>
        `;
    }
}

function formatHistoryType(type) {
    switch(type) {
        case 'match_result':
            return 'Match Result';
        case 'promotion':
            return 'Promotion';
        case 'demotion':
            return 'Demotion';
        case 'admin_modification':
            return 'Admin Adjustment';
        case 'initial_placement':
            return 'Initial Placement';
        default:
            return type || 'Unknown';
    }
}

function setupEloHistorySection() {
    // Existing D1 and D2 pagination buttons
    document.getElementById('d1-prev-page').addEventListener('click', () => {
        loadEloHistory(eloHistoryPagination.d1.page - 1);
    });
    
    document.getElementById('d1-next-page').addEventListener('click', () => {
        loadEloHistory(eloHistoryPagination.d1.page + 1);
    });
    
    document.getElementById('d2-prev-page').addEventListener('click', () => {
        loadEloHistory(eloHistoryPagination.d2.page - 1);
    });
    
    document.getElementById('d2-next-page').addEventListener('click', () => {
        loadEloHistory(eloHistoryPagination.d2.page + 1);
    });
    
    // Add D3 pagination buttons if they exist in your HTML
    const d3PrevPage = document.getElementById('d3-prev-page');
    const d3NextPage = document.getElementById('d3-next-page');
    
    if (d3PrevPage) {
        d3PrevPage.addEventListener('click', () => {
            loadEloHistory(eloHistoryPagination.d3.page - 1);
        });
    }
    
    if (d3NextPage) {
        d3NextPage.addEventListener('click', () => {
            loadEloHistory(eloHistoryPagination.d3.page + 1);
        });
    }
    
    // Search functionality
    const historySearch = document.getElementById('elo-history-search');
    if (historySearch) {
        historySearch.addEventListener('input', debounce(filterEloHistoryTable, 300));
    }
    
    // Type filter functionality
    const typeFilter = document.getElementById('history-type-filter');
    if (typeFilter) {
        typeFilter.addEventListener('change', applyEloHistoryFilters);
    }
    
    // Reset filters
    const resetFiltersBtn = document.getElementById('reset-history-filters');
    if (resetFiltersBtn) {
        resetFiltersBtn.addEventListener('click', resetEloHistoryFilters);
    }
}

function filterEloHistoryTable() {
    const searchTerm = document.getElementById('elo-history-search').value.toLowerCase();
    const rows = document.querySelectorAll('#elo-history-table-body tr');
    
    let visibleCount = 0;
    
    rows.forEach(row => {
        if (row.classList.contains('loading-cell') || 
            row.classList.contains('empty-state') || 
            row.classList.contains('error-state')) {
            return;
        }
        
        const player = row.querySelector('.player')?.textContent.toLowerCase() || '';
        const type = row.querySelector('.type')?.textContent.toLowerCase() || '';
        const admin = row.querySelector('.admin-action')?.textContent.toLowerCase() || '';
        
        if (player.includes(searchTerm) || type.includes(searchTerm) || admin.includes(searchTerm)) {
            row.style.display = '';
            visibleCount++;
        } else {
            row.style.display = 'none';
        }
    });
}

async function applyEloHistoryFilters() {
    const startDate = document.getElementById('history-start-date').value;
    const endDate = document.getElementById('history-end-date').value;
    const typeFilter = document.getElementById('history-type-filter').value;
    
    // Reset pagination
    const ladderPrefix = currentLadder.toLowerCase();
    eloHistoryPagination[ladderPrefix] = { page: 1, lastVisible: null, firstVisible: null };
    
    const historyTable = document.getElementById('elo-history-table-body');
    historyTable.innerHTML = '<tr><td colspan="7" class="loading-cell">Applying filters...</td></tr>';
    
    try {
        const historyCollection = currentLadder === 'D1' ? 'eloHistory' : 'eloHistoryD2';
        const historyRef = collection(db, historyCollection);
        
        // Build query constraints
        let constraints = [orderBy('timestamp', 'desc')];
        
        if (startDate) {
            const startDateTime = new Date(startDate);
            startDateTime.setHours(0, 0, 0, 0);
            constraints.push(where('timestamp', '>=', startDateTime));
        }
        
        if (endDate) {
            const endDateTime = new Date(endDate);
            endDateTime.setHours(23, 59, 59, 999);
            constraints.push(where('timestamp', '<=', endDateTime));
        }
        
        if (typeFilter && typeFilter !== 'all') {
            constraints.push(where('type', '==', typeFilter));
        }
        
        // Add pagination limit
        constraints.push(limit(PAGE_SIZE));
        
        const q = query(historyRef, ...constraints);
        const querySnapshot = await getDocs(q);
        
        // Update pagination
        if (!querySnapshot.empty) {
            eloHistoryPagination[ladderPrefix].firstVisible = querySnapshot.docs[0];
            eloHistoryPagination[ladderPrefix].lastVisible = querySnapshot.docs[querySnapshot.docs.length - 1];
        }
        
        // Render results
        historyTable.innerHTML = '';
        
        if (querySnapshot.empty) {
            historyTable.innerHTML = '<tr><td colspan="7" class="empty-state">No matches found for the selected filters</td></tr>';
            return;
        }
        
        querySnapshot.forEach(doc => {
            const history = doc.data();
            const row = document.createElement('tr');
            
            const timestamp = history.timestamp 
                ? new Date(history.timestamp.seconds * 1000).toLocaleString() 
                : 'N/A';
            
            const eloChange = history.newElo - history.previousElo;
            const changeClass = eloChange > 0 ? 'positive-change' : eloChange < 0 ? 'negative-change' : '';
            const changeSign = eloChange > 0 ? '+' : '';
            
            // Make sure we're using player, not userId or email
            const playerName = history.player || history.username || history.userId || 'N/A';
            
            row.innerHTML = `
                <td class="timestamp">${timestamp}</td>
                <td class="player">${playerName}</td>
                <td class="previous-elo">${history.previousElo || 'N/A'}</td>
                <td class="new-elo">${history.newElo || 'N/A'}</td>
                <td class="elo-change ${changeClass}">${changeSign}${eloChange}</td>
                <td class="type">${formatHistoryType(history.type)}</td>
                <td class="admin-action">
                    ${history.modifiedBy || history.promotedBy || history.demotedBy || 'System'}
                </td>
            `;
            
            historyTable.appendChild(row);
        });
        
        // Update page indicator
        document.getElementById(`${ladderPrefix}-page-indicator`).textContent = 'Page 1';
        
    } catch (error) {
        console.error("Error applying filters:", error);
        historyTable.innerHTML = `
            <tr>
                <td colspan="7" class="error-state">
                    Error applying filters: ${error.message}
                </td>
            </tr>
        `;
    }
}

function resetEloHistoryFilters() {
    document.getElementById('history-start-date').value = '';
    document.getElementById('history-end-date').value = '';
    document.getElementById('history-type-filter').value = 'all';
    document.getElementById('elo-history-search').value = '';
    
    // Reset pagination
    const ladderPrefix = currentLadder.toLowerCase();
    eloHistoryPagination[ladderPrefix] = { page: 1, lastVisible: null, firstVisible: null };
    
    // Reload history
    loadEloHistory(1);
}

function setupRankControls() {
    // Promote player modal
    const promoteBtn = document.getElementById('promote-player-btn');
    const promoteModal = document.getElementById('promote-modal');
    const promoteForm = document.getElementById('promote-form');
    
    if (promoteBtn && promoteModal && promoteForm) {
        promoteBtn.addEventListener('click', () => {
            promoteModal.classList.add('active');
        });
        
        // Close when clicking outside
        promoteModal.addEventListener('click', (e) => {
            if (e.target === promoteModal) {
                promoteModal.classList.remove('active');
            }
        });
        
        // Handle form submit
        promoteForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const usernameInput = document.getElementById('promote-username');
            const ladderSelect = document.getElementById('promote-ladder');
            
            const username = usernameInput.value.trim();
            const ladder = ladderSelect.value;
            
            if (!username) {
                showNotification('Please enter a username', 'error');
                return;
            }
            
            try {
                await promotePlayer(username, ladder);
                promoteModal.classList.remove('active');
                usernameInput.value = '';
            } catch (error) {
                showNotification(error.message, 'error');
            }
        });
        
        // Cancel button
        document.getElementById('cancel-promote-btn').addEventListener('click', () => {
            promoteModal.classList.remove('active');
        });
    }
    
    // Demote player modal
    const demoteBtn = document.getElementById('demote-player-btn');
    const demoteModal = document.getElementById('demote-modal');
    const demoteForm = document.getElementById('demote-form');
    
    if (demoteBtn && demoteModal && demoteForm) {
        demoteBtn.addEventListener('click', () => {
            demoteModal.classList.add('active');
        });
        
        // Close when clicking outside
        demoteModal.addEventListener('click', (e) => {
            if (e.target === demoteModal) {
                demoteModal.classList.remove('active');
            }
        });
        
        // Handle form submit
        demoteForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const usernameInput = document.getElementById('demote-username');
            const ladderSelect = document.getElementById('demote-ladder');
            
            const username = usernameInput.value.trim();
            const ladder = ladderSelect.value;
            
            if (!username) {
                alert('Please enter a username');
                return;
            }
            
            try {
                await demotePlayer(username, ladder);
                document.getElementById('demote-modal').classList.remove('active');
                document.getElementById('demote-username').value = '';
            } catch (error) {
                console.error('Error in demotion:', error);
            }
        });
    }
    
    // Set custom ELO modal
    const setEloBtn = document.getElementById('set-elo-btn');
    const setEloModal = document.getElementById('set-elo-modal');
    const setEloForm = document.getElementById('set-elo-form');
    
    if (setEloBtn && setEloModal && setEloForm) {
        setEloBtn.addEventListener('click', () => {
            setEloModal.classList.add('active');
        });
        
        // Close when clicking outside
        setEloModal.addEventListener('click', (e) => {
            if (e.target === setEloModal) {
                setEloModal.classList.remove('active');
            }
        });
        
        // Handle form submit
setEloForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const usernameInput = document.getElementById('set-elo-username');
    const eloInput = document.getElementById('set-elo-value');
    
    // Fix: Check if it's a radio button group instead of a select element
    let ladder;
    const ladderSelect = document.getElementById('set-elo-ladder');
    const ladderRadio = document.querySelector('input[name="set-elo-ladder"]:checked');
    
    if (ladderSelect) {
        ladder = ladderSelect.value;
    } else if (ladderRadio) {
        ladder = ladderRadio.value;
    } else {
        ladder = 'D1'; // Default to D1 if no selection found
    }
    
    if (!usernameInput || !eloInput) {
        showNotification('Form elements are missing', 'error');
        return;
    }
    
    const username = usernameInput.value.trim();
    const elo = parseInt(eloInput.value);
    
    if (!username || isNaN(elo)) {
        showNotification('Please enter valid username and ELO', 'error');
        return;
    }
    
    try {
        await setCustomElo(username, elo, ladder);
        setEloModal.classList.remove('active');
        usernameInput.value = '';
        eloInput.value = '';
    } catch (error) {
        showNotification(error.message, 'error');
    }
});
        
        // Cancel button
        document.getElementById('cancel-set-elo-btn').addEventListener('click', () => {
            setEloModal.classList.remove('active');
        });
    }
    
    // Role assignment modal (Update this part)
    const setRoleModal = document.getElementById('set-role-modal');
    const setRoleForm = document.getElementById('set-role-form');

    if (setRoleModal && setRoleForm) {
        // Close when clicking outside
        setRoleModal.addEventListener('click', (e) => {
            if (e.target === setRoleModal) {
                closeModalHandler();
            }
        });

        // Handle form submit
        setRoleForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const usernameInput = document.getElementById('role-username');
            const roleNameInput = document.getElementById('role-name'); // New input
            const roleColorInput = document.getElementById('role-color'); // New input

            const username = usernameInput.value.trim();
            const roleName = roleNameInput.value.trim(); // Get custom name
            const roleColor = roleColorInput.value; // Get custom color

            if (!username) { // Only username is strictly required to identify the user
                showNotification('Username is missing', 'error');
                return;
            }

            try {
                // Call updated function
                await setUserRole(username, roleName, roleColor);
                closeModalHandler();
                loadUsersWithRoles(); // Refresh the table
            } catch (error) {
                // Error is already handled in setUserRole
            }
        });

        // Cancel button (ensure closeModalHandler is used)
        const cancelBtn = document.getElementById('cancel-role-btn');
        if (cancelBtn) {
            cancelBtn.removeEventListener('click', closeModalHandler);
            cancelBtn.addEventListener('click', closeModalHandler);
        }
    }
}

// Replace the promotePlayer function with this implementation
async function promotePlayer(username, ladder) {
    try {
        console.log(`Attempting to promote ${username} in ${ladder} ladder`);
        
        // Check if current user is admin
        const user = auth.currentUser;
        if (!user) {
            throw new Error('You must be logged in to perform this action');
        }
        
        // Determine which collection to use
        const collectionName = ladder === 'D2' ? 'playersD2' : 'players';
        const historyCollection = ladder === 'D2' ? 'eloHistoryD2' : 'eloHistory';
        
        // Get player data
        console.log(`Searching for player in ${collectionName}`);
        const playersRef = collection(db, collectionName);
        const q = query(playersRef, where('username', '==', username));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            alert(`Player not found in ${ladder} ladder`);
            throw new Error(`Player not found in ${ladder} ladder`);
        }

        const playerDoc = querySnapshot.docs[0];
        const playerData = playerDoc.data();
        const currentElo = playerData.eloRating || 1200;
        const playerId = playerDoc.id;
        
        console.log(`Found player with current ELO: ${currentElo}`);

        // Define ELO thresholds
        const thresholds = [
            { name: 'Bronze', elo: 1400 },
            { name: 'Silver', elo: 1600 },
            { name: 'Gold', elo: 1800 },
            { name: 'Emerald', elo: 2000 }
        ];

        // Find next threshold
        let nextThreshold = thresholds.find(t => t.elo > currentElo);
        
        if (!nextThreshold) {
            alert(`Player is already at maximum rank (Emerald) in ${ladder} ladder`);
            throw new Error(`Player is already at maximum rank (Emerald) in ${ladder} ladder`);
        }
        
        console.log(`Promoting player to ${nextThreshold.name} (${nextThreshold.elo})`);
        
        // Update player document
        await updateDoc(doc(db, collectionName, playerDoc.id), {
            eloRating: nextThreshold.elo,
            lastPromotedAt: serverTimestamp(),
            promotedBy: user.email || 'admin'
        });

        // Add history entry
        await addDoc(collection(db, historyCollection), {
            player: username,
            previousElo: currentElo,
            newElo: nextThreshold.elo,
            timestamp: serverTimestamp(),
            type: 'promotion',
            rankAchieved: nextThreshold.name,
            promotedBy: user.email || 'admin',
            gameMode: ladder
        });

        // Add new code to send Discord notification for promotions
        try {
            // Import the promotion manager
            const { promotionManager } = await import('./promotions.js');
            
            // Get old and new rank names
            const oldRank = promotionManager.getRankName(currentElo);
            const newRank = nextThreshold.name;
            
            // Send notification to Discord bot
            await promotionManager.sendPromotionNotification(
                playerId,
                username,
                currentElo,
                nextThreshold.elo,
                oldRank,
                newRank,
                'promotion',
                {
                    displayName: username,
                    source: 'admin',
                    adminUser: user.email,
                    ladder: ladder
                }
            );
            console.log('Promotion notification sent to Discord bot');
        } catch (notificationError) {
            console.error('Failed to send Discord notification:', notificationError);
            // Continue execution even if notification fails
        }

        // Show success message
        alert(`Successfully promoted ${username} to ${nextThreshold.name} (${nextThreshold.elo})`);
        
        // Refresh relevant data
        if (currentLadder === ladder) {
            loadPlayersData();
            loadEloHistory(1);
        }

        return true;
    } catch (error) {
        console.error('Error promoting player:', error);
        alert(`Error promoting player: ${error.message}`);
        throw error;
    }
}

// Ensure the promote form is properly connected
document.addEventListener('DOMContentLoaded', () => {
    const promoteForm = document.getElementById('promote-form');
    if (promoteForm) {
        promoteForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const username = document.getElementById('promote-username').value.trim();
            const ladder = document.querySelector('input[name="promote-ladder"]:checked').value;
            
            if (!username) {
                alert('Please enter a username');
                return;
            }
            
            try {
                await promotePlayer(username, ladder);
                document.getElementById('promote-modal').classList.remove('active');
                document.getElementById('promote-username').value = '';
            } catch (error) {
                console.error('Error in promotion:', error);
            }
        });
    }
});

// Replace the demotePlayer function with this implementation
async function demotePlayer(username, ladder) {
    try {
        console.log(`Attempting to demote ${username} in ${ladder} ladder`);
        
        // Check if current user is admin
        const user = auth.currentUser;
        if (!user) {
            throw new Error('You must be logged in to perform this action');
        }
        
        // Determine which collection to use
        const collectionName = ladder === 'D2' ? 'playersD2' : 'players';
        const historyCollection = ladder === 'D2' ? 'eloHistoryD2' : 'eloHistory';
        
        // Get player data
        console.log(`Searching for player in ${collectionName}`);
        const playersRef = collection(db, collectionName);
        const q = query(playersRef, where('username', '==', username));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            alert(`Player not found in ${ladder} ladder`);
            throw new Error(`Player not found in ${ladder} ladder`);
        }

        const playerDoc = querySnapshot.docs[0];
        const playerData = playerDoc.data();
        const currentElo = playerData.eloRating || 1200;
        
        console.log(`Found player with current ELO: ${currentElo}`);

        // Define ELO thresholds (in reverse order for demotion)
        const thresholds = [
            { name: 'Gold', elo: 1800 },
            { name: 'Silver', elo: 1600 },
            { name: 'Bronze', elo: 1400 },
            { name: 'Unranked', elo: 1200 }
        ];

        // Find previous threshold
        let prevThreshold = thresholds.find(t => t.elo < currentElo);
        
        if (!prevThreshold) {
            alert(`Player is already at minimum rank (Unranked) in ${ladder} ladder`);
            throw new Error(`Player is already at minimum rank (Unranked) in ${ladder} ladder`);
        }

        console.log(`Demoting player to ${prevThreshold.name} (${prevThreshold.elo})`);
        
        // Update player document
        await updateDoc(doc(db, collectionName, playerDoc.id), {
            eloRating: prevThreshold.elo,
            lastDemotedAt: serverTimestamp(),
            demotedBy: user.email || 'admin'
        });

        // Add history entry
        await addDoc(collection(db, historyCollection), {
            player: username,
            previousElo: currentElo,
            newElo: prevThreshold.elo,
            timestamp: serverTimestamp(),
            type: 'demotion',
            rankAchieved: prevThreshold.name,
            demotedBy: user.email || 'admin',
            gameMode: ladder
        });

        // Add new code to send Discord notification for demotions
        try {
            // Import the promotion manager
            const { promotionManager } = await import('./promotions.js');
            
            // Get old and new rank names
            const oldRank = promotionManager.getRankName(currentElo);
            const newRank = prevThreshold.name;
            
            // Send notification to Discord bot
            await promotionManager.sendPromotionNotification(
                playerDoc.id,
                username,
                currentElo,
                prevThreshold.elo,
                oldRank,
                newRank,
                'demotion',
                {
                    displayName: username,
                    source: 'admin',
                    adminUser: user.email,
                    ladder: ladder
                }
            );
            console.log('Demotion notification sent to Discord bot');
        } catch (notificationError) {
            console.error('Failed to send Discord notification:', notificationError);
            // Continue execution even if notification fails
        }

        // Show success message
        alert(`Successfully demoted ${username} to ${prevThreshold.name} (${prevThreshold.elo})`);
        
        // Refresh relevant data
        if (currentLadder === ladder) {
            loadPlayersData();
            loadEloHistory(1);
        }

        return true;
    } catch (error) {
        console.error('Error demoting player:', error);
        alert(`Error demoting player: ${error.message}`);
        throw error;
    }
}

// Ensure the demote form is properly connected
document.addEventListener('DOMContentLoaded', () => {
    const demoteForm = document.getElementById('demote-form');
    if (demoteForm) {
        demoteForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const username = document.getElementById('demote-username').value.trim();
            const ladder = document.querySelector('input[name="demote-ladder"]:checked').value;
            
            if (!username) {
                alert('Please enter a username');
                return;
            }
            
            try {
                await demotePlayer(username, ladder);
                document.getElementById('demote-modal').classList.remove('active');
                document.getElementById('demote-username').value = '';
            } catch (error) {
                console.error('Error in demotion:', error);
            }
        });
    }
});

async function setCustomElo(username, elo, ladder) {
    try {
        // Check if current user is admin
        const user = auth.currentUser;
        if (!user || !isAdmin(user.email)) {
            throw new Error('Unauthorized: Admin access required');
        }

        // Determine which collection to use
        const collectionName = ladder === 'D2' ? 'playersD2' : 'players';
        const historyCollection = ladder === 'D2' ? 'eloHistoryD2' : 'eloHistory';

        // Get player data
        const playersRef = collection(db, collectionName)        
        const q = query(playersRef, where('username', '==', username));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            throw new Error(`Player not found in ${ladder} ladder`);
        }

        const playerDoc = querySnapshot.docs[0];
        const playerData = playerDoc.data();
        const currentElo = playerData.eloRating || 1200;

        // Begin transaction
        const batch = writeBatch(db);
        
        // Update player document
        batch.update(doc(db, collectionName, playerDoc.id), {
            eloRating: elo,
            lastModifiedAt: serverTimestamp(),
            lastModifiedBy: user.email
        });

        // Add history entry
        const historyRef = doc(collection(db, historyCollection));
        batch.set(historyRef, {
            player: username,
            previousElo: currentElo,
            newElo: elo,
            timestamp: serverTimestamp(),
            type: 'admin_modification',
            modifiedBy: user.email,
            gameMode: ladder
        });

        await batch.commit();

        showNotification(`ELO rating for ${username} was updated from ${currentElo} to ${elo}`, 'success');
        
        // Refresh relevant data if same ladder is active
        if (currentLadder === ladder) {
            loadDashboardOverview();
            loadPlayersData();
            loadEloHistory(1);
        }

        return true;
    } catch (error) {
        console.error('Error setting custom ELO:', error);
        throw error;
    }
}

// Update setUserRole function to focus on players collections

async function setUserRole(username, roleName, roleColor) {
    try {
        const user = auth.currentUser;
        if (!user || !isAdmin(user.email)) {
            throw new Error('Unauthorized: Admin access required');
        }

        // Normalize inputs
        const finalRoleName = roleName ? roleName.trim() : null;
        const finalRoleColor = finalRoleName ? (roleColor || '#808080') : null;

        // UPDATED: Prioritize looking in player collections
        const [d1Query, d2Query] = await Promise.all([
            getDocs(query(collection(db, 'players'), where('username', '==', username))),
            getDocs(query(collection(db, 'playersD2'), where('username', '==', username)))
        ]);

        const userDocs = [];
        
        // Store player doc references if found
        if (!d1Query.empty) userDocs.push({ref: d1Query.docs[0].ref, source: 'D1'});
        if (!d2Query.empty) userDocs.push({ref: d2Query.docs[0].ref, source: 'D2'});
        
        // If no player docs found, check other collections as backup
        if (userDocs.length === 0) {
            const [nonParticipantQuery, userProfilesQuery] = await Promise.all([
                getDocs(query(collection(db, 'nonParticipants'), where('username', '==', username))),
                getDocs(query(collection(db, 'userProfiles'), where('username', '==', username)))
            ]);
            
            if (!nonParticipantQuery.empty) userDocs.push({ref: nonParticipantQuery.docs[0].ref, source: 'NonParticipant'});
            if (!userProfilesQuery.empty) userDocs.push({ref: userProfilesQuery.docs[0].ref, source: 'UserProfile'});
        }

        if (userDocs.length === 0) {
            throw new Error(`User "${username}" not found in any collection`);
        }

        const batch = writeBatch(db);

        userDocs.forEach(docInfo => {
            console.log(`Updating role for ${username} in ${docInfo.source}`);
            
            if (!finalRoleName) {
                batch.update(docInfo.ref, {
                    roleName: deleteField(),
                    roleColor: deleteField(),
                    roleAssignedBy: deleteField(),
                    roleAssignedAt: deleteField()
                });
            } else {
                batch.update(docInfo.ref, {
                    roleName: finalRoleName,
                    roleColor: finalRoleColor,
                    roleAssignedBy: user.email,
                    roleAssignedAt: serverTimestamp()
                });
            }
        });

        await batch.commit();

        const actionMessage = finalRoleName ? `Role "${finalRoleName}" set` : "Role removed";
        showNotification(`${actionMessage} for user "${username}"`, 'success');
        return true;

    } catch (error) {
        console.error('Error setting user role:', error);
        showNotification(`Error: ${error.message}`, 'error');
        throw error;
    }
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <i class="fas ${getNotificationIcon(type)}"></i>
            <span>${message}</span>
        </div>
        <button class="close-notification">×</button>
    `;
    
    document.body.appendChild(notification);
    
    // Display animation
    setTimeout(() => {
        notification.classList.add('active');
    }, 10);
    
    // Auto-remove after delay
    const timeout = setTimeout(() => {
        closeNotification(notification);
    }, 5000);
    
    // Close button
    notification.querySelector('.close-notification').addEventListener('click', () => {
        clearTimeout(timeout);
        closeNotification(notification);
    });
}

function getNotificationIcon(type) {
    switch(type) {
        case 'success': return 'fa-check-circle';
        case 'error': return 'fa-exclamation-circle';
        case 'warning': return 'fa-exclamation-triangle';
        case 'info':
        default: return 'fa-info-circle';
    }
}

function closeNotification(notification) {
    notification.classList.remove('active');
    setTimeout(() => {
        notification.remove();
    }, 300);
}

// Add this new function
function setupUserRolesSection() {
    // Set up the load button
    const loadUsersBtn = document.getElementById('load-users-data');
    if (loadUsersBtn) {
        loadUsersBtn.addEventListener('click', function() {
            this.classList.add('loading');
            this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
            
            loadUsersWithRoles()
                .then(() => {
                    this.classList.remove('loading');
                    this.innerHTML = '<i class="fas fa-sync-alt"></i> Load Users Data';
                })
                .catch(error => {
                    console.error('Error loading users:', error);
                    this.classList.remove('loading');
                    this.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Error';
                    setTimeout(() => {
                        this.innerHTML = '<i class="fas fa-sync-alt"></i> Load Users Data';
                    }, 3000);
                });
        });
    }
    
    // Add new role button
    const addRoleBtn = document.getElementById('add-new-role-btn');
    if (addRoleBtn) {
        addRoleBtn.addEventListener('click', () => {
            const modal = document.getElementById('set-role-modal');
            if (modal) {
                modal.classList.add('active');
            }
        });
    }
    
    // Set up search filter
    const userSearch = document.getElementById('user-search');
    if (userSearch) {
        userSearch.addEventListener('input', debounce(filterUsersTable, 300));
    }
    
    // Set up role filter
    const roleFilter = document.getElementById('role-filter');
    if (roleFilter) {
        roleFilter.addEventListener('change', filterUsersTable);
    }
}

// Function to load users with roles
async function loadUsersWithRoles() {
    const tableBody = document.getElementById('users-table-body');
    if (!tableBody) return;
    
    tableBody.innerHTML = '<tr><td colspan="5" class="loading-cell">Loading users...</td></tr>';
    
    try {
        // Get all users from various collections
        const [d1Players, d2Players, nonParticipants, userProfiles] = await Promise.all([
            getDocs(collection(db, 'players')),
            getDocs(collection(db, 'playersD2')),
            getDocs(collection(db, 'nonParticipants')),
            getDocs(collection(db, 'userProfiles'))
        ]);
        
        // Consolidate users into a map with username as key
        const usersMap = new Map();
        
        // Function to process documents and add to map
        function processDocuments(snapshot, source) {
            snapshot.forEach(doc => {
                const data = doc.data();
                if (!data.username) return;

                if (!usersMap.has(data.username)) {
                    usersMap.set(data.username, {
                        username: data.username,
                        roleName: data.roleName || null,
                        roleColor: data.roleColor || null,
                        roleAssignedBy: data.roleAssignedBy || null,
                        roleAssignedAt: data.roleAssignedAt || null,
                        sources: [source]
                    });
                } else {
                    const user = usersMap.get(data.username);
                    
                    // UPDATED: Prioritize roles from players collections over other sources
                    // This ensures D1/D2 player roles take precedence
                    if (data.roleName && (
                        !user.roleName || 
                        source === 'D1' || 
                        source === 'D2'
                    )) {
                        user.roleName = data.roleName;
                        user.roleColor = data.roleColor;
                        user.roleAssignedBy = data.roleAssignedBy;
                        user.roleAssignedAt = data.roleAssignedAt;
                    }
                    
                    if (!user.sources.includes(source)) {
                        user.sources.push(source);
                    }
                }
            });
        }

        // Process all collections
        processDocuments(d1Players, 'D1');
        processDocuments(d2Players, 'D2');
        processDocuments(nonParticipants, 'Non-Participant');
        processDocuments(userProfiles, 'Profile');
        
        // Convert map to array and sort by username
        const usersArray = Array.from(usersMap.values()).sort((a, b) => 
            a.username.localeCompare(b.username)
        );
        
        if (usersArray.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="5" class="empty-state">No users found</td></tr>';
            return;
        }
        
        // Render user table
        tableBody.innerHTML = '';
        
        usersArray.forEach(user => {
            const row = document.createElement('tr');
            row.dataset.username = user.username;
            // Store custom role data in dataset for the modal
            row.dataset.roleName = user.roleName || '';
            row.dataset.roleColor = user.roleColor || '#808080';

            const formattedDate = user.roleAssignedAt ?
                new Date(user.roleAssignedAt.seconds * 1000).toLocaleDateString() :
                'N/A';

            // Generate badge with custom name and color
            const roleBadge = user.roleName ?
                `<span class="role-badge" style="background-color: ${user.roleColor}; color: ${getContrastColor(user.roleColor)};">${user.roleName}</span>` :
                '<span class="no-role">None</span>';

            row.innerHTML = `
                <td>${user.username} <span class="user-source">(${user.sources.join(', ')})</span></td>
                <td>${roleBadge}</td>
                <td>${user.roleAssignedBy || 'N/A'}</td>
                <td>${formattedDate}</td>
                <td class="actions">
                    <button class="edit-role-btn" data-username="${user.username}">
                        <i class="fas fa-edit"></i>
                    </button>
                    ${user.roleName ? `
                        <button class="remove-role-btn" data-username="${user.username}" title="Remove Role">
                            <i class="fas fa-times"></i> <!-- Changed icon -->
                        </button>
                    ` : ''}
                </td>
            `;

            tableBody.appendChild(row);
        });

        // Add event listeners to action buttons
        document.querySelectorAll('.edit-role-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const username = btn.dataset.username;
                openRoleEditModal(username);
            });
        });

        // Update event listeners for remove button
        document.querySelectorAll('.remove-role-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const username = btn.dataset.username;
                if (confirm(`Are you sure you want to remove the role from ${username}?`)) {
                    // Call setUserRole with nulls to remove
                    setUserRole(username, null, null)
                        .then(() => loadUsersWithRoles()) // Refresh table on success
                        .catch(error => console.error('Error removing role:', error));
                }
            });
        });
    } catch (error) {
        console.error('Error loading users:', error);
        tableBody.innerHTML = '<tr><td colspan="5" class="error-state">Error loading users</td></tr>';
    }
}

// Modify openRoleEditModal
function openRoleEditModal(username) {
    console.log('Attempting to open role edit modal for:', username); // Log start
    const modal = document.getElementById('set-role-modal');
    const usernameInput = document.getElementById('role-username');
    const roleSelect = document.getElementById('user-role');

    if (!modal) {
        console.error('CRITICAL: Role modal element (#set-role-modal) not found in the DOM!');
        alert('Error: Could not find the role editing dialog.'); // User feedback
        return;
    }
    console.log('Modal element found:', modal); // Log success

    // Pre-fill the username
    if (usernameInput) {
        usernameInput.value = username;
        console.log(`Username input set to: ${username}`);
    } else {
        console.warn('Username input field (#role-username) not found in modal.');
    }

    // Find current role from table row data attribute
    const userRow = document.querySelector(`#users-table-body tr[data-username="${username}"]`);
    if (userRow && roleSelect) {
        const currentRole = userRow.dataset.role;
        roleSelect.value = currentRole === 'none' ? '' : currentRole;
        console.log(`Role select set to: ${roleSelect.value} (based on data-role: ${currentRole})`);
    } else {
        if (!userRow) console.warn(`Table row for user ${username} not found.`);
        if (!roleSelect) console.warn('Role select field (#user-role) not found in modal.');
        if (roleSelect) roleSelect.value = ''; // Default to empty if row not found
    }

    // Show the modal using only the active class
    console.log('Adding "active" class to modal.');
    modal.classList.add('active');

    // Add the cancel button event listener
    const cancelBtn = document.getElementById('cancel-role-btn');
    if (cancelBtn) {
        console.log('Attaching cancel button listener.');
        // Remove previous listener to prevent duplicates
        cancelBtn.removeEventListener('click', closeModalHandler);
        cancelBtn.addEventListener('click', closeModalHandler);
    } else {
        console.warn('Cancel button (#cancel-role-btn) not found in modal.');
    }

    // Add listener to close modal on background click
    console.log('Attaching background click listener.');
    modal.removeEventListener('click', closeModalBackgroundHandler); // Prevent duplicates
    modal.addEventListener('click', closeModalBackgroundHandler);
}

// Define the handler for background click
function closeModalBackgroundHandler(event) {
    // Only close if the click is directly on the modal background
    if (event.target === this) {
        closeModalHandler();
    }
}

// Modify closeModalHandler
function closeModalHandler() {
    const modal = document.getElementById('set-role-modal');
    if (modal) {
        modal.classList.remove('active');
        // Remove the background click listener when closed
        modal.removeEventListener('click', closeModalBackgroundHandler);
    }
}

// Function to filter user table
function filterUsersTable() {
    const searchTerm = document.getElementById('user-search')?.value.toLowerCase() || '';
    const roleFilter = document.getElementById('role-filter')?.value || 'all';
    const rows = document.querySelectorAll('#users-table-body tr');
    
    let visibleCount = 0;
    
    rows.forEach(row => {
        // Skip special rows
        if (row.querySelector('.loading-cell') || 
            row.querySelector('.empty-state') || 
            row.querySelector('.error-state')) {
            return;
        }
        
        const username = row.dataset.username?.toLowerCase() || '';
        const role = row.dataset.role || 'none';
        
        // Check if row matches filters
        const matchesSearch = username.includes(searchTerm);
        const matchesRole = roleFilter === 'all' || role === roleFilter;
        
        if (matchesSearch && matchesRole) {
            row.style.display = '';
            visibleCount++;
        } else {
            row.style.display = 'none';
        }
    });
    
    // Show no results message if needed
    if (visibleCount === 0 && rows.length > 0) {
        const tableBody = document.getElementById('users-table-body');
        if (tableBody) {
            // Only add if there's no existing message
            if (!tableBody.querySelector('.no-results')) {
                const noResultsRow = document.createElement('tr');
                noResultsRow.classList.add('no-results');
                noResultsRow.innerHTML = '<td colspan="5" class="empty-state">No users match your filters</td>';
                tableBody.appendChild(noResultsRow);
            }
        }
    } else {
        // Remove no results message if it exists
        const noResultsRow = document.querySelector('.no-results');
        if (noResultsRow) {
            noResultsRow.remove();
        }
    }
}

// Add this function to setup the article management section
function setupManageArticlesSection() {
    // Load Articles button
    const loadArticlesBtn = document.getElementById('load-articles-data');
    if (loadArticlesBtn) {
        loadArticlesBtn.addEventListener('click', function() {
            this.classList.add('loading');
            this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
            
            loadArticles()
                .then(() => {
                    this.classList.remove('loading');
                    this.innerHTML = '<i class="fas fa-sync-alt"></i> Load Articles';
                })
                .catch(error => {
                    console.error('Error loading articles:', error);
                    this.classList.remove('loading');
                    this.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Error';
                    setTimeout(() => {
                        this.innerHTML = '<i class="fas fa-sync-alt"></i> Load Articles';
                    }, 3000);
                });
        });
    }
    
    // Create New Article button - Directly show it since this setup function implies permission
    const createArticleBtn = document.getElementById('create-new-article-btn');
    if (createArticleBtn) {
        console.log("Setting up Manage Articles section - Found Create Article button."); // Add this log
        // Show the button because if this function runs, the user has access to the section
        createArticleBtn.style.display = 'block';

        createArticleBtn.addEventListener('click', () => {
            openArticleModal();
        });
    } else {
        console.error("Setup Manage Articles: Create Article button not found!"); // Add this error log
    }
    
    // Article form submit (changed from Trophy form submit comment)
    const articleForm = document.getElementById('article-form');
    if (articleForm) {
        articleForm.addEventListener('submit', (e) => {
            e.preventDefault();
            saveArticle();
        });
    }
    
    // Cancel button
    const cancelArticleBtn = document.getElementById('cancel-article-btn');
    if (cancelArticleBtn) {
        cancelArticleBtn.addEventListener('click', () => {
            closeArticleModal();
        });
    }
    
    // Modal close button
    const closeBtn = document.querySelector('#article-modal .close-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            closeArticleModal();
        });
    }
    
    // Modal background click
    const articleModal = document.getElementById('article-modal');
    if (articleModal) {
        articleModal.addEventListener('click', (e) => {
            if (e.target === articleModal) {
                closeArticleModal();
            }
        });
    }
}

// Load articles from Firestore
async function loadArticles() {
    const articlesTable = document.getElementById('articles-table-body');
    if (!articlesTable) return;
    
    articlesTable.innerHTML = '<tr><td colspan="4" class="loading-cell">Loading articles...</td></tr>';
    
    try {
        const articlesRef = collection(db, 'articles');
        const q = query(articlesRef, orderBy('createdAt', 'desc'));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            articlesTable.innerHTML = '<tr><td colspan="4" class="empty-state">No articles found</td></tr>';
            return;
        }
        
        articlesTable.innerHTML = '';
        
        querySnapshot.forEach(doc => {
            const article = doc.data();
            const row = document.createElement('tr');
            
            // Format the timestamp
            const timestamp = article.createdAt 
                ? new Date(article.createdAt.seconds * 1000).toLocaleString() 
                : 'N/A';
                
            row.innerHTML = `
                <td>${article.title || 'Untitled'}</td>
                <td>${article.author || 'Unknown'}</td>
                <td>${timestamp}</td>
                <td class="actions">
                    <button class="edit-article-btn" data-id="${doc.id}">
                        <i class="fas fa-pencil-alt"></i>
                    </button>
                    <button class="delete-article-btn" data-id="${doc.id}">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </td>
            `;
            
            articlesTable.appendChild(row);
        });
        
        // Add event listeners to buttons
        setupArticleActionButtons();
        
    } catch (error) {
        console.error("Error loading articles:", error);
        articlesTable.innerHTML = `
            <tr>
                <td colspan="4" class="error-state">
                    Error loading articles: ${error.message}
                </td>
            </tr>
        `;
    }
}

// Setup action buttons for article rows
function setupArticleActionButtons() {
    // Edit buttons
    document.querySelectorAll('.edit-article-btn').forEach(button => {
        button.addEventListener('click', async (e) => {
            const articleId = e.currentTarget.dataset.id;
            openArticleModal(articleId);
        });
    });
    
    // Delete buttons
    document.querySelectorAll('.delete-article-btn').forEach(button => {
        button.addEventListener('click', async (e) => {
            const articleId = e.currentTarget.dataset.id;
            confirmDeleteArticle(articleId);
        });
    });
}

// Open the article modal for creating or editing
function openArticleModal(articleId = null) {
    const modal = document.getElementById('article-modal');
    const titleElement = document.getElementById('article-modal-title');
    const form = document.getElementById('article-form');
    const idInput = document.getElementById('article-id');
    
    // Clear form
    form.reset();
    idInput.value = '';
    
    if (articleId) {
        // Edit existing article
        titleElement.textContent = 'Edit Article';
        idInput.value = articleId;
        
        // Load article data
        loadArticleData(articleId);
    } else {
        // Create new article
        titleElement.textContent = 'Create Article';
        
        // Pre-fill author with current user if available
        const user = auth.currentUser;
        if (user) {
            const authorInput = document.getElementById('article-author');
            if (authorInput && user.displayName) {
                authorInput.value = user.displayName;
            } else if (authorInput) {
                authorInput.value = user.email;
            }
        }
    }
    
    // Show modal
    modal.classList.add('active');
}

// Load article data for editing
async function loadArticleData(articleId) {
    try {
        const articleRef = doc(db, 'articles', articleId);
        const articleSnap = await getDoc(articleRef);
        
        if (!articleSnap.exists()) {
            showNotification('Article not found', 'error');
            return;
        }
        
        const article = articleSnap.data();
        
        // Populate form fields
        document.getElementById('article-title').value = article.title || '';
        document.getElementById('article-author').value = article.author || '';
        document.getElementById('article-image-url').value = article.imageUrl || '';
        document.getElementById('article-content').value = article.content || '';
        
    } catch (error) {
        console.error("Error loading article data:", error);
        showNotification('Failed to load article data', 'error');
    }
}

// Save article to Firestore
async function saveArticle() {
    try {
        const articleId = document.getElementById('article-id').value;
        const title = document.getElementById('article-title').value.trim();
        const author = document.getElementById('article-author').value.trim();
        const imageUrl = document.getElementById('article-image-url').value.trim();
        const content = document.getElementById('article-content').value.trim();
        
        if (!title || !content) {
            showNotification('Title and content are required', 'error');
            return;
        }
        
        // Check authorization
        const user = auth.currentUser;
        if (!user) {
            showNotification('You must be logged in to save articles', 'error');
            return;
        }
        
        const articleData = {
            title,
            author,
            imageUrl: imageUrl || null,
            content,
            lastModifiedAt: serverTimestamp(),
            lastModifiedBy: user.email
        };
        
        if (!articleId) {
            // Create new article
            articleData.createdAt = serverTimestamp();
            articleData.createdBy = user.email;
            
            await addDoc(collection(db, 'articles'), articleData);
            showNotification('Article created successfully', 'success');
        } else {
            // Update existing article
            await updateDoc(doc(db, 'articles', articleId), articleData);
            showNotification('Article updated successfully', 'success');
        }
        
        // Close modal and refresh list
        closeArticleModal();
        loadArticles();
        
    } catch (error) {
        console.error("Error saving article:", error);
        showNotification(`Failed to save article: ${error.message}`, 'error');
    }
}

// Close the article modal
function closeArticleModal() {
    const modal = document.getElementById('article-modal');
    if (modal) {
        modal.classList.remove('active');
    }
}

// Confirm and delete an article
async function confirmDeleteArticle(articleId) {
    if (confirm('Are you sure you want to delete this article? This action cannot be undone.')) {
        try {
            await deleteDoc(doc(db, 'articles', articleId));
            
            // Refresh article list
            loadArticles();
            
            showNotification('Article deleted successfully', 'success');
            
        } catch (error) {
            console.error("Error deleting article:", error);
            showNotification('Failed to delete article: ' + error.message, 'error');
        }
    }
}

// Add this function to setup the trophy management section
function setupTrophyManagementSection() {
    // Load Trophies button
    const loadTrophiesBtn = document.getElementById('load-trophies-data');
    if (loadTrophiesBtn) {
        loadTrophiesBtn.addEventListener('click', function() {
            this.classList.add('loading');
            this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';

                // Add error handler to trophy image in assign modal
                const assignTrophyImage = document.getElementById('assign-trophy-image');
                if (assignTrophyImage) {
                    assignTrophyImage.onerror = function() {
                        this.src = DEFAULT_TROPHY_IMAGE;
                    };
                }
            
            loadTrophyDefinitions()
                .then(() => {
                    this.classList.remove('loading');
                    this.innerHTML = '<i class="fas fa-sync-alt"></i> Load Trophies';
                })
                .catch(error => {
                    console.error('Error loading trophies:', error);
                    this.classList.remove('loading');
                    this.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Error';
                    setTimeout(() => {
                        this.innerHTML = '<i class="fas fa-sync-alt"></i> Load Trophies';
                    }, 3000);
                });
        });
    }
    
    // Create New Trophy button
    const createTrophyBtn = document.getElementById('create-new-trophy-btn');
    if (createTrophyBtn) {
        createTrophyBtn.addEventListener('click', () => {
            openTrophyModal();
        });
    }
    
    // Trophy form submit
    const trophyForm = document.getElementById('trophy-form');
    if (trophyForm) {
        trophyForm.addEventListener('submit', (e) => {
            e.preventDefault();
            saveTrophyDefinition();
        });
    }
    
    // Cancel button
    const cancelTrophyBtn = document.getElementById('cancel-trophy-btn');
    if (cancelTrophyBtn) {
        cancelTrophyBtn.addEventListener('click', () => {
            closeTrophyModal();
        });
    }
    
    // Modal close buttons
    document.querySelectorAll('#trophy-modal .close-btn, #assign-trophy-modal .close-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            closeTrophyModal();
            closeAssignTrophyModal();
        });
    });
    
    // Modal background click
    const trophyModal = document.getElementById('trophy-modal');
    if (trophyModal) {
        trophyModal.addEventListener('click', (e) => {
            if (e.target === trophyModal) {
                closeTrophyModal();
            }
        });
    }
    
    // Assign trophy modal
    const assignTrophyModal = document.getElementById('assign-trophy-modal');
    if (assignTrophyModal) {
        assignTrophyModal.addEventListener('click', (e) => {
            if (e.target === assignTrophyModal) {
                closeAssignTrophyModal();
            }
        });
    }
    
    // Assign trophy form submit
    const assignTrophyForm = document.getElementById('assign-trophy-form');
    if (assignTrophyForm) {
        assignTrophyForm.addEventListener('submit', (e) => {
            e.preventDefault();
            assignTrophyToPlayer();
        });
    }
    
    // Cancel assign button
    const cancelAssignBtn = document.getElementById('cancel-assign-btn');
    if (cancelAssignBtn) {
        cancelAssignBtn.addEventListener('click', () => {
            closeAssignTrophyModal();
        });
    }

    // Add image preview functionality for trophy creation/editing
    const trophyImageUrlInput = document.getElementById('trophy-image-url');
    if (trophyImageUrlInput) {
        trophyImageUrlInput.addEventListener('input', updateTrophyImagePreview);
        trophyImageUrlInput.addEventListener('paste', () => {
            setTimeout(updateTrophyImagePreview, 10); // Small delay to ensure paste completes
        });
    }
}

// Add this new function to handle trophy image preview
function updateTrophyImagePreview() {
    const imageUrl = document.getElementById('trophy-image-url').value.trim();
    const previewContainer = document.getElementById('trophy-image-preview');
    
    // Create preview container if it doesn't exist
    if (!previewContainer) {
        const formGroup = document.getElementById('trophy-image-url').closest('.form-group');
        const newPreviewContainer = document.createElement('div');
        newPreviewContainer.id = 'trophy-image-preview';
        newPreviewContainer.className = 'trophy-preview-container';
        formGroup.appendChild(newPreviewContainer);
        
        // Add image element
        const previewImg = document.createElement('img');
        previewImg.id = 'trophy-preview-img';
        previewImg.alt = 'Trophy Preview';
        previewImg.onerror = function() {
            this.src = DEFAULT_TROPHY_IMAGE;
            this.classList.add('error');
        };
        newPreviewContainer.appendChild(previewImg);
    }
    
    // Update the preview image
    const previewImg = document.getElementById('trophy-preview-img');
    if (imageUrl) {
        previewImg.src = imageUrl;
        previewImg.style.display = 'block';
        previewImg.classList.remove('error');
    } else {
        previewImg.src = DEFAULT_TROPHY_IMAGE;
        previewImg.style.display = 'block';
    }
}

// Load trophy definitions from Firestore
async function loadTrophyDefinitions() {
    const trophiesTable = document.getElementById('trophies-table-body');
    if (!trophiesTable) return;
    
    trophiesTable.innerHTML = '<tr><td colspan="5" class="loading-cell">Loading trophies...</td></tr>';
    
    try {
        const trophiesRef = collection(db, 'trophyDefinitions');
        const q = query(trophiesRef, orderBy('createdAt', 'desc'));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            trophiesTable.innerHTML = '<tr><td colspan="5" class="empty-state">No trophy definitions found</td></tr>';
            return;
        }
        
        trophiesTable.innerHTML = '';
        
        querySnapshot.forEach(doc => {
            const trophy = doc.data();
            const row = document.createElement('tr');
            
            // Format the timestamp
            const timestamp = trophy.createdAt 
                ? new Date(trophy.createdAt.seconds * 1000).toLocaleString() 
                : 'N/A';
                
            row.innerHTML = `
                <td class="trophy-image-cell">
                    <img src="${trophy.image || DEFAULT_TROPHY_IMAGE}" 
                         alt="${trophy.name}" 
                         onerror="this.src='${DEFAULT_TROPHY_IMAGE}';">
                </td>
                <td class="trophy-name">${trophy.name || 'Untitled Trophy'}</td>
                <td class="trophy-rarity-cell">
                    <span class="trophy-rarity ${trophy.rarity || 'common'}">${trophy.rarity || 'common'}</span>
                </td>
                <td>${timestamp}</td>
                <td class="actions">
                    <button class="edit-trophy-btn" data-id="${doc.id}">
                        <i class="fas fa-pencil-alt"></i>
                    </button>
                    <button class="assign-trophy-btn" data-id="${doc.id}">
                        <i class="fas fa-user-plus" title="Assign to player"></i>
                    </button>
                    <button class="delete-trophy-btn" data-id="${doc.id}">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </td>
            `;
            
            trophiesTable.appendChild(row);
        });
        
        // Add event listeners to buttons
        setupTrophyActionButtons();
        
    } catch (error) {
        console.error("Error loading trophy definitions:", error);
        trophiesTable.innerHTML = `
            <tr>
                <td colspan="5" class="error-state">
                    Error loading trophies: ${error.message}
                </td>
            </tr>
        `;
    }
}

// Setup action buttons for trophy rows
function setupTrophyActionButtons() {
    // Edit buttons
    document.querySelectorAll('.edit-trophy-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const trophyId = e.currentTarget.dataset.id;
            openTrophyModal(trophyId);
        });
    });
    
    // Assign buttons
    document.querySelectorAll('.assign-trophy-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const trophyId = e.currentTarget.dataset.id;
            openAssignTrophyModal(trophyId);
        });
    });
    
    // Delete buttons
    document.querySelectorAll('.delete-trophy-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const trophyId = e.currentTarget.dataset.id;
            confirmDeleteTrophy(trophyId);
        });
    });
}

// Open the trophy modal for creating or editing
function openTrophyModal(trophyId = null) {
    const modal = document.getElementById('trophy-modal');
    const titleElement = document.getElementById('trophy-modal-title');
    const form = document.getElementById('trophy-form');
    const idInput = document.getElementById('trophy-id');
    
    // Clear form
    form.reset();
    idInput.value = '';
    
    // Clear image preview if it exists
    const previewImg = document.getElementById('trophy-preview-img');
    if (previewImg) {
        previewImg.src = DEFAULT_TROPHY_IMAGE;
        previewImg.classList.remove('error');
    }
    
    if (trophyId) {
        // Edit existing trophy
        titleElement.textContent = 'Edit Trophy';
        idInput.value = trophyId;
        
        // Load trophy data
        loadTrophyData(trophyId);
    } else {
        // Create new trophy
        titleElement.textContent = 'Create New Trophy';
    }
    
    // Show modal
    modal.classList.add('active');
}

// Load trophy data for editing
async function loadTrophyData(trophyId) {
    try {
        const trophyRef = doc(db, 'trophyDefinitions', trophyId);
        const trophySnap = await getDoc(trophyRef);
        
        if (!trophySnap.exists()) {
            showNotification('Trophy not found', 'error');
            return;
        }
        
        const trophy = trophySnap.data();
        
        // Populate form fields
        document.getElementById('trophy-name').value = trophy.name || '';
        document.getElementById('trophy-description').value = trophy.description || '';
        document.getElementById('trophy-image-url').value = trophy.image || '';
        document.getElementById('trophy-rarity').value = trophy.rarity || 'common';
        
        // Trigger image preview update
        updateTrophyImagePreview();
        
    } catch (error) {
        console.error("Error loading trophy data:", error);
        showNotification('Failed to load trophy data', 'error');
    }
}

// Save trophy definition to Firestore
async function saveTrophyDefinition() {
    try {
        const trophyId = document.getElementById('trophy-id').value;
        const name = document.getElementById('trophy-name').value.trim();
        const description = document.getElementById('trophy-description').value.trim();
        const imageUrl = document.getElementById('trophy-image-url').value.trim();
        const rarity = document.getElementById('trophy-rarity').value;
        
        if (!name || !description || !imageUrl) {
            showNotification('All fields are required', 'error');
            return;
        }
        
        // Check authorization
        const user = auth.currentUser;
        if (!user) {
            showNotification('You must be logged in to save trophies', 'error');
            return;
        }
        
        const trophyData = {
            name,
            description,
            image: imageUrl,
            rarity,
            lastModifiedAt: serverTimestamp(),
            lastModifiedBy: user.email
        };
        
        if (!trophyId) {
            // Create new trophy
            trophyData.createdAt = serverTimestamp();
            trophyData.createdBy = user.email;
            
            await addDoc(collection(db, 'trophyDefinitions'), trophyData);
            showNotification('Trophy created successfully', 'success');
        } else {
            // Update existing trophy
            await updateDoc(doc(db, 'trophyDefinitions', trophyId), trophyData);
            showNotification('Trophy updated successfully', 'success');
        }
        
        // Close modal and refresh list
        closeTrophyModal();
        loadTrophyDefinitions();
        
    } catch (error) {
        console.error("Error saving trophy:", error);
        showNotification(`Failed to save trophy: ${error.message}`, 'error');
    }
}

// Close the trophy modal
function closeTrophyModal() {
    const modal = document.getElementById('trophy-modal');
    if (modal) {
        modal.classList.remove('active');
    }
}

// Add this function to handle trophy deletion
async function confirmDeleteTrophy(trophyId) {
    if (!trophyId) {
        console.error("Delete Trophy: No trophy ID provided.");
        return;
    }

    if (confirm('Are you sure you want to delete this trophy definition? This action cannot be undone and might affect players who have been awarded this trophy.')) {
        try {
            // Check authorization (ensure user is logged in and has permission)
            const user = auth.currentUser;
            if (!user) {
                showNotification('You must be logged in to delete trophies', 'error');
                return;
            }
            // Optional: Add a server-side check or rely on security rules

            console.log(`Attempting to delete trophy definition with ID: ${trophyId}`);
            await deleteDoc(doc(db, 'trophyDefinitions', trophyId));

            showNotification('Trophy definition deleted successfully', 'success');

            // Refresh the trophy list in the admin panel
            loadTrophyDefinitions();

        } catch (error) {
            console.error("Error deleting trophy definition:", error);
            showNotification(`Failed to delete trophy: ${error.message}`, 'error');
        }
    }
}

// Open the assign trophy modal
async function openAssignTrophyModal(trophyId) {
    try {
        const trophyRef = doc(db, 'trophyDefinitions', trophyId);
        const trophySnap = await getDoc(trophyRef);
        
        if (!trophySnap.exists()) {
            showNotification('Trophy not found', 'error');
            return;
        }
        
        const trophy = trophySnap.data();
        
        // Populate form fields
        document.getElementById('assign-trophy-id').value = trophyId;
        document.getElementById('assign-trophy-name').value = trophy.name;
        document.getElementById('assign-trophy-image').src = trophy.image || DEFAULT_TROPHY_IMAGE;
        document.getElementById('assign-trophy-title').textContent = trophy.name || 'Unnamed Trophy';
        document.getElementById('assign-trophy-description').textContent = trophy.description || 'No description';
        
        const rarityElement = document.getElementById('assign-trophy-rarity');
        rarityElement.textContent = trophy.rarity || 'common';
        rarityElement.className = `trophy-rarity ${trophy.rarity || 'common'}`;
        
        // Show modal
        const modal = document.getElementById('assign-trophy-modal');
        modal.classList.add('active');
        
    } catch (error) {
        console.error("Error opening assign trophy modal:", error);
        showNotification('Failed to load trophy data', 'error');
    }
}

// Close the assign trophy modal
function closeAssignTrophyModal() {
    const modal = document.getElementById('assign-trophy-modal');
    if (modal) {
        modal.classList.remove('active');
    }
}

// Assign trophy to player
async function assignTrophyToPlayer() {
    try {
        const trophyId = document.getElementById('assign-trophy-id').value;
        const trophyName = document.getElementById('assign-trophy-name').value;
        const username = document.getElementById('assign-player-username').value.trim();
        const ladder = document.querySelector('input[name="assign-ladder"]:checked').value;
        
        if (!trophyId || !username) {
            showNotification('Trophy ID and username are required', 'error');
            return;
        }
        
        // Check authorization
        const user = auth.currentUser;
        if (!user) {
            showNotification('You must be logged in to assign trophies', 'error');
            return;
        }
        
        // Find the player
        const collectionName = ladder === 'D2' ? 'playersD2' : 'players';
        const playersRef = collection(db, collectionName);
        const q = query(playersRef, where('username', '==', username));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            showNotification(`Player "${username}" not found in ${ladder} ladder`, 'error');
            return;
        }
        
        const playerDoc = querySnapshot.docs[0];
        const playerData = playerDoc.data();
        const userId = playerDoc.id;
        
        // Check if player already has this trophy
        const userTrophiesRef = collection(db, 'userTrophies');
        const existingTrophyQuery = query(
            userTrophiesRef, 
            where('userId', '==', userId),
            where('trophyId', '==', trophyId)
        );
        
        const existingTrophySnapshot = await getDocs(existingTrophyQuery);
        
        if (!existingTrophySnapshot.empty) {
            showNotification(`Player "${username}" already has this trophy`, 'warning');
            return;
        }
        
        // Add trophy to user
        await addDoc(collection(db, 'userTrophies'), {
            userId: userId,
            playerUsername: username,
            trophyId: trophyId,
            awardedAt: serverTimestamp(),
            awardedBy: user.email,
            ladder: ladder
        });
        
        showNotification(`Trophy "${trophyName}" awarded to ${username}`, 'success');
        closeAssignTrophyModal();
        
    } catch (error) {
        console.error("Error assigning trophy:", error);
        showNotification(`Failed to assign trophy: ${error.message}`, 'error');
    }
}

// Add this function to setup the inactive players section
function setupInactivePlayersSection() {
    // Load button is already handled in setupDataLoadButtons
    
    // Add filter event handlers
    const daysFilter = document.getElementById('inactive-days-filter');
    if (daysFilter) {
        daysFilter.addEventListener('change', function() {
            // Get the current button to preserve loading state
            const loadBtn = document.getElementById('load-inactive-players-data');
            if (loadBtn) loadBtn.click();
        });
    }
    
    // Handle ladder selection for inactive players
    const ladderSelector = document.querySelector('.ladder-switch input[value="D1"]');
    const ladderSelector2 = document.querySelector('.ladder-switch input[value="D2"]');
    
    if (ladderSelector && ladderSelector2) {
        ladderSelector.addEventListener('change', function() {
            if (this.checked) {
                currentLadder = 'D1';
                // Reload inactive players if we're on that tab
                if (document.getElementById('inactive-players').style.display !== 'none') {
                    const loadBtn = document.getElementById('load-inactive-players-data');
                    if (loadBtn) loadBtn.click();
                }
            }
        });
        
        ladderSelector2.addEventListener('change', function() {
            if (this.checked) {
                currentLadder = 'D2';
                // Reload inactive players if we're on that tab
                if (document.getElementById('inactive-players').style.display !== 'none') {
                    const loadBtn = document.getElementById('load-inactive-players-data');
                    if (loadBtn) loadBtn.click();
                }
            }
        });
    }
    
    // Setup players search functionality
    const searchInput = document.getElementById('inactive-players-search');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(function() {
            const searchTerm = searchInput.value.toLowerCase();
            const rows = document.querySelectorAll('#inactive-players-table-body tr');
            
            rows.forEach(row => {
                if (row.querySelector('.loading-cell') || 
                    row.querySelector('.empty-state') || 
                    row.querySelector('.error-state')) {
                    return;
                }
                
                const username = row.cells[0]?.textContent.toLowerCase() || '';
                const lastMatch = row.cells[5]?.textContent.toLowerCase() || '';
                
                if (username.includes(searchTerm) || lastMatch.includes(searchTerm)) {
                    row.style.display = '';
                } else {
                    row.style.display = 'none';
                }
            });
        }, 300));
    }
    
    // Setup view player buttons
    document.addEventListener('click', function(e) {
        if (e.target.closest('.view-player-btn')) {
            const button = e.target.closest('.view-player-btn');
            const username = button.dataset.username;
            if (username) {
                alert(`View player details for ${username} - Feature coming soon`);
                // Here you could implement a modal to show player details
            }
        }
    });
    
    console.log('Inactive players section initialized');
}

// Load inactive players and show their last match
async function loadInactivePlayersData() {
    const tableBody = document.getElementById('inactive-players-table-body');
    if (!tableBody) return;

    tableBody.innerHTML = '<tr><td colspan="7" class="loading-cell">Loading inactive players...</td></tr>';

    try {
        // Get minimum days threshold from filter if it exists
        const daysFilter = document.getElementById('inactive-days-filter');
        const minInactiveDays = daysFilter ? parseInt(daysFilter.value) || 0 : 0;
        
        // Fetch all players from the current ladder
        const playersRef = collection(db, currentLadder === 'D1' ? 'players' : 'playersD2');
        const playersSnapshot = await getDocs(playersRef);

        if (playersSnapshot.empty) {
            tableBody.innerHTML = '<tr><td colspan="7" class="empty-state">No players found in this ladder</td></tr>';
            return;
        }

        // Prepare array of player data
        const players = [];
        playersSnapshot.forEach(doc => {
            const player = doc.data();
            players.push({ 
                ...player, 
                id: doc.id,
                username: player.username || 'Unknown Player'
            });
        });

        console.log(`Found ${players.length} total players in the ${currentLadder} ladder`);

        // Fetch last match for each player
        const matchesCollection = currentLadder === 'D1' ? 'approvedMatches' : 'approvedMatchesD2';
        const lastMatchPromises = players.map(async player => {
            try {
                const matchesRef = collection(db, matchesCollection);
                const q = query(
                    matchesRef,
                    or(
                        where('winnerUsername', '==', player.username),
                        where('loserUsername', '==', player.username)
                    ),
                    orderBy('approvedAt', 'desc'),
                    limit(1)
                );
                
                const matchSnap = await getDocs(q);
                
                if (!matchSnap.empty) {
                    const match = matchSnap.docs[0].data();
                    const matchDate = match.approvedAt ? new Date(match.approvedAt.seconds * 1000) : null;
                    const now = new Date();
                    const daysSinceMatch = matchDate ? 
                        Math.floor((now - matchDate) / (1000 * 60 * 60 * 24)) : null;
                    
                    const opponent = match.winnerUsername === player.username ? 
                        match.loserUsername : match.winnerUsername;
                    
                    const result = match.winnerUsername === player.username ? 'Won' : 'Lost';
                    
                    return { 
                        ...player, 
                        lastMatch: { 
                            date: matchDate ? matchDate.toLocaleDateString() : 'N/A',
                            opponent: opponent || 'Unknown',
                            result,
                            timestamp: matchDate || new Date(0),
                            daysSinceMatch: daysSinceMatch || Number.MAX_SAFE_INTEGER
                        } 
                    };
                } else {
                    // No matches found for this player
                    return { 
                        ...player, 
                        lastMatch: { 
                            date: 'Never played',
                            opponent: 'N/A',
                            result: 'N/A',
                            timestamp: new Date(0),
                            daysSinceMatch: Number.MAX_SAFE_INTEGER
                        } 
                    };
                }
            } catch (error) {
                console.error(`Error fetching matches for ${player.username}:`, error);
                return { 
                    ...player, 
                    lastMatch: { 
                        date: 'Error',
                        opponent: 'Error',
                        result: 'Error',
                        timestamp: new Date(0),
                        daysSinceMatch: 0
                    } 
                };
            }
        });

        let playersWithLastMatch = await Promise.all(lastMatchPromises);
        
        // Sort by days since last match (most inactive first)
        playersWithLastMatch.sort((a, b) => b.lastMatch.daysSinceMatch - a.lastMatch.daysSinceMatch);
        
        // Filter based on minimum days inactive if specified
        if (minInactiveDays > 0) {
            playersWithLastMatch = playersWithLastMatch.filter(
                player => player.lastMatch.daysSinceMatch >= minInactiveDays
            );
        }

        // Render table
        tableBody.innerHTML = '';
        
        if (playersWithLastMatch.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="7" class="empty-state">No inactive players match your criteria</td></tr>';
            return;
        }
        
        playersWithLastMatch.forEach(player => {
            const row = document.createElement('tr');
            
            // Style for very inactive players (>30 days)
            const inactiveClass = player.lastMatch.daysSinceMatch > 30 ? 'highly-inactive' : 
                                player.lastMatch.daysSinceMatch > 14 ? 'moderately-inactive' : '';
            
            row.className = inactiveClass;
            row.innerHTML = `
                <td>${player.username}</td>
                <td>${player.eloRating || 1200}</td>
                <td>${player.lastMatch.date}</td>
                <td>${player.lastMatch.daysSinceMatch === Number.MAX_SAFE_INTEGER ? 'N/A' : player.lastMatch.daysSinceMatch}</td>
                <td>${currentLadder}</td>
                <td>${player.lastMatch.date === 'Never played' ? 'No matches found' : 
                    `${player.lastMatch.result} vs ${player.lastMatch.opponent}`}</td>
                <td>
                    <button class="view-player-btn" data-username="${player.username}" title="View Player Details">
                        <i class="fas fa-eye"></i>
                    </button>
                </td>
            `;
            tableBody.appendChild(row);
        });

        console.log(`Displaying ${playersWithLastMatch.length} inactive players`);

    } catch (error) {
        console.error('Error loading inactive players:', error);
        tableBody.innerHTML = `<tr><td colspan="7" class="error-state">Error loading inactive players: ${error.message}</td></tr>`;
    }
}

// --- HIGHLIGHTS MANAGEMENT SECTION ---

function setupHighlightButtons() {
    console.log("Setting up highlight buttons");
    
    // Match highlight button
    const matchHighlightBtn = document.getElementById('create-match-highlight-btn');
    if (matchHighlightBtn) {
        matchHighlightBtn.addEventListener('click', function() {
            console.log("Match highlight button clicked");
            openHighlightModal('match');
        });
    }
    
    // Featured creator button
    const creatorHighlightBtn = document.getElementById('create-creator-highlight-btn');
    if (creatorHighlightBtn) {
        creatorHighlightBtn.addEventListener('click', function() {
            console.log("Creator highlight button clicked");
            openHighlightModal('creator');
        });
    }
    
    // Player achievement button
    const achievementHighlightBtn = document.getElementById('create-achievement-highlight-btn');
    if (achievementHighlightBtn) {
        achievementHighlightBtn.addEventListener('click', function() {
            console.log("Achievement highlight button clicked");
            openHighlightModal('achievement');
        });
    }
}

function openHighlightModal(typeOrId = 'match') {
    console.log(`Opening highlight modal with parameter: ${typeOrId}`);
    const modal = document.getElementById('highlight-modal');
    const form = document.getElementById('highlight-form');
    const titleElement = document.getElementById('highlight-modal-title');
    const idField = document.getElementById('highlight-id');

    if (!modal || !form || !titleElement) {
        console.error("Essential highlight modal elements not found!");
        return;
    }

    // Clear previous form data
    form.reset();
    idField.value = '';

    const knownTypes = ['match', 'creator', 'achievement'];
    const isEditing = !knownTypes.includes(typeOrId);

    if (isEditing) {
        // We're editing an existing highlight
        const highlightId = typeOrId;
        idField.value = highlightId;
        titleElement.textContent = 'Loading...';

        // Load the highlight data
        loadHighlightDataAdmin(highlightId);
    } else {
        // Creating a new highlight
        const type = typeOrId;
        document.getElementById('highlight-type').value = type;
        titleElement.textContent = `Create New ${getHighlightTypeName(type)}`;
        
        // Initialize the form for this type
        toggleHighlightFields(type);
        
        // Set current user as submitter
        const user = auth.currentUser;
        if (user && document.getElementById('highlight-submitted-by')) {
            document.getElementById('highlight-submitted-by').value = user.displayName || user.email;
        }
    }

    // Show the modal
    modal.classList.add('active');
}

function toggleHighlightFields(type) {
    console.log(`Toggling fields for highlight type: ${type}`);
    const form = document.getElementById('highlight-form');
    
    if (!form) return;
    
    // First hide ALL form fields
    const allFields = form.querySelectorAll('.form-group, .form-row');
    allFields.forEach(field => field.style.display = 'none');
    
    // Hide video preview by default
    const videoPreview = document.getElementById('highlight-video-preview-container');
    if (videoPreview) videoPreview.style.display = 'none';
    
    // Always show common fields (present in all highlight types)
    const commonFields = [
        'highlight-title-container',
        'highlight-description-container',
        'highlight-submitted-by-container'
    ];
    
    commonFields.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'block';
    });
    
    // Type-specific fields
    if (type === 'match') {
        // Show match highlight fields
        const matchFields = [
            'highlight-video-container',
            'highlight-match-info-container',
            'highlight-map-container',
            'highlight-match-date-container',
            'highlight-players-container', // Container for winner/loser rows
            'highlight-match-link-container'
        ];
        
        matchFields.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                if (id === 'highlight-players-container') {
                    el.style.display = 'flex'; // Use flex for the players row
                } else {
                    el.style.display = 'block';
                }
            }
        });
        
        // Make video required for match highlights
        const videoIdInput = document.getElementById('highlight-video-id');
        if (videoIdInput) {
            videoIdInput.required = true;
            const label = videoIdInput.previousElementSibling;
            if (label) label.innerHTML = 'YouTube Video ID*';
        }
        
        // Show video preview
        if (videoPreview) videoPreview.style.display = 'block';
        updateHighlightVideoPreview();
        
    } else if (type === 'creator') {
        // Show creator highlight fields
        const creatorFields = [
            'highlight-map-container',
            'highlight-map-creator-container',
            'highlight-map-version-container',
            'highlight-creator-image-container',
            'highlight-video-container' // Video is optional
        ];
        
        creatorFields.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'block';
        });
        
        // Make video optional
        const videoIdInput = document.getElementById('highlight-video-id');
        if (videoIdInput) {
            videoIdInput.required = false;
            const label = videoIdInput.previousElementSibling;
            if (label) label.innerHTML = 'YouTube Video ID (Optional)';
        }
        
    } else if (type === 'achievement') {
                // Show achievement highlight fields
            const achievementFields = [
                'highlight-achievement-player-container',
                'highlight-achievement-type-container',
                'highlight-achievement-details-container',
                'highlight-player-profile-container',
                'highlight-achievement-image-container', // Add this line
                'highlight-video-container' // Video is optional for achievements
            ];
            
            achievementFields.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'block';
            });
            
            // Make video optional
            const videoIdInput = document.getElementById('highlight-video-id');
            if (videoIdInput) {
                videoIdInput.required = false;
                const label = videoIdInput.previousElementSibling;
                if (label) label.innerHTML = 'YouTube Video ID (Optional)';
            }
        }
}

async function loadHighlightDataAdmin(highlightId) {
    try {
        const highlightRef = doc(db, 'highlights', highlightId);
        const highlightDoc = await getDoc(highlightRef);

        if (!highlightDoc.exists()) {
            showNotification('Highlight not found', 'error');
            return;
        }
        
        const data = highlightDoc.data();
        const type = data.type || 'match';
        
        // Update the title
        document.getElementById('highlight-modal-title').textContent = `Edit ${getHighlightTypeName(type)}`;
        
        // Set the highlight type and toggle fields
        document.getElementById('highlight-type').value = type;
        toggleHighlightFields(type);
        
        // Fill common fields
        document.getElementById('highlight-title').value = data.title || '';
        document.getElementById('highlight-description').value = data.description || '';
        document.getElementById('highlight-submitted-by').value = data.submittedBy || '';
        
        if (data.videoId) {
            document.getElementById('highlight-video-id').value = data.videoId;
            updateHighlightVideoPreview();
        }
        
        // Fill type-specific fields
        if (type === 'match') {
            document.getElementById('highlight-match-info').value = data.matchInfo || '';
            document.getElementById('highlight-map').value = data.map || '';
            
            // Format date for input if exists
            if (data.matchDate) {
                const date = new Date(data.matchDate.seconds * 1000);
                document.getElementById('highlight-match-date').value = 
                    date.toISOString().split('T')[0]; // YYYY-MM-DD format
            }
            
            document.getElementById('highlight-winner-name').value = data.winnerName || '';
            document.getElementById('highlight-winner-score').value = data.winnerScore || '';
            document.getElementById('highlight-loser-name').value = data.loserName || '';
            document.getElementById('highlight-loser-score').value = data.loserScore || '';
            document.getElementById('highlight-match-link').value = data.matchLink || '';
            
        } else if (type === 'creator') {
            document.getElementById('highlight-map').value = data.map || '';
            document.getElementById('highlight-map-creator').value = data.mapCreator || '';
            document.getElementById('highlight-map-version').value = data.mapVersion || '';
            document.getElementById('highlight-creator-image').value = data.creatorImageUrl || '';
            
        } else if (type === 'achievement') {
            document.getElementById('highlight-achievement-player').value = data.achievementPlayer || '';
            document.getElementById('highlight-achievement-type').value = data.achievementType || '';
            document.getElementById('highlight-achievement-details').value = data.achievementDetails || '';
            document.getElementById('highlight-player-profile').value = data.playerProfileUrl || '';
            document.getElementById('highlight-achievement-image').value = data.achievementImageUrl || ''; // Add this line
        }
        
    } catch (error) {
        console.error("Error loading highlight:", error);
        showNotification(`Error loading highlight: ${error.message}`, 'error');
    }
}

async function saveHighlight() {
    try {
        const highlightId = document.getElementById('highlight-id')?.value || '';
        const highlightType = document.getElementById('highlight-type')?.value || 'match';
        
        // Get common fields
        const data = {
            title: document.getElementById('highlight-title')?.value?.trim() || '',
            description: document.getElementById('highlight-description')?.value?.trim() || '',
            submittedBy: document.getElementById('highlight-submitted-by')?.value?.trim() || '',
            videoId: document.getElementById('highlight-video-id')?.value?.trim() || null,
            type: highlightType
        };
        
        // Validate required fields
        if (!data.title) {
            showNotification('Title is required', 'error');
            return;
        }
        
        // Add type-specific fields
        if (highlightType === 'match') {
            // For match highlights
            data.matchInfo = document.getElementById('highlight-match-info')?.value?.trim() || '';
            data.map = document.getElementById('highlight-map')?.value?.trim() || '';
            
            const matchDateInput = document.getElementById('highlight-match-date');
            const matchDateValue = matchDateInput?.value || '';
            data.matchDate = matchDateValue ? Timestamp.fromDate(new Date(matchDateValue)) : null;
            
            data.winnerName = document.getElementById('highlight-winner-name')?.value?.trim() || '';
            data.winnerScore = document.getElementById('highlight-winner-score')?.value?.trim() || '';
            data.loserName = document.getElementById('highlight-loser-name')?.value?.trim() || '';
            data.loserScore = document.getElementById('highlight-loser-score')?.value?.trim() || '';
            data.matchLink = document.getElementById('highlight-match-link')?.value?.trim() || '';
            
            // Validate required match fields
            if (!data.videoId) {
                showNotification('YouTube Video ID is required for match highlights', 'error');
                return;
            }
            
        } else if (highlightType === 'creator') {
            // For creator highlights
            data.map = document.getElementById('highlight-map')?.value?.trim() || '';
            data.mapCreator = document.getElementById('highlight-map-creator')?.value?.trim() || '';
            data.mapVersion = document.getElementById('highlight-map-version')?.value?.trim() || '';
            data.creatorImageUrl = document.getElementById('highlight-creator-image')?.value?.trim() || '';
            
            // Validate required creator fields
            if (!data.mapCreator) {
                showNotification('Map Creator is required', 'error');
                return;
            }
            
        } else if (highlightType === 'achievement') {
            // For achievement highlights
            data.achievementPlayer = document.getElementById('highlight-achievement-player')?.value?.trim() || '';
            data.achievementType = document.getElementById('highlight-achievement-type')?.value?.trim() || '';
            data.achievementDetails = document.getElementById('highlight-achievement-details')?.value?.trim() || '';
            data.playerProfileUrl = document.getElementById('highlight-player-profile')?.value?.trim() || '';
            data.achievementImageUrl = document.getElementById('highlight-achievement-image')?.value?.trim() || ''; 
            
            // Validate required achievement fields
            if (!data.achievementPlayer) {
                showNotification('Player Name is required', 'error');
                return;
            }
        }
        
        // Add timestamps
        if (highlightId) {
            // Updating existing highlight
            data.updatedAt = serverTimestamp();
            await updateDoc(doc(db, 'highlights', highlightId), data);
            showNotification('Highlight updated successfully!', 'success');
        } else {
            // Creating new highlight
            data.createdAt = serverTimestamp();
            await addDoc(collection(db, 'highlights'), data);
            showNotification('Highlight created successfully!', 'success');
        }
        
        // Close modal and refresh data
        closeHighlightModal();
        loadHighlightsAdmin();
        
    } catch (error) {
        console.error("Error saving highlight:", error);
        showNotification(`Error saving highlight: ${error.message}`, 'error');
    }
}

function closeHighlightModal() {
    const modal = document.getElementById('highlight-modal');
    if (modal) modal.classList.remove('active');
}

function getHighlightTypeName(type) {
    switch(type) {
        case 'match': return 'Match Highlight';
        case 'creator': return 'Featured Creator';
        case 'achievement': return 'Player Achievement';
        default: return 'Highlight';
    }
}

function updateHighlightVideoPreview() {
    const videoIdInput = document.getElementById('highlight-video-id');
    const previewContainer = document.getElementById('highlight-video-preview-container');
    const previewFrame = document.getElementById('highlight-video-preview');
    
    if (!videoIdInput || !previewFrame || !previewContainer) return;
    
    const videoId = videoIdInput.value.trim();
    
    if (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        previewFrame.src = `https://www.youtube.com/embed/${videoId}`;
        previewContainer.style.display = 'block';
    } else {
        previewFrame.src = '';
        previewContainer.style.display = 'none';
    }
}

// Load highlights into the admin table
async function loadHighlightsAdmin() {
    const tableBody = document.getElementById('highlights-table-body');
    if (!tableBody) return;
    
    tableBody.innerHTML = '<tr><td colspan="6" class="loading-cell">Loading highlights...</td></tr>';
    
    try {
        const q = query(collection(db, 'highlights'), orderBy('createdAt', 'desc'));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            tableBody.innerHTML = '<tr><td colspan="6" class="empty-state">No highlights found</td></tr>';
            return;
        }
        
        tableBody.innerHTML = '';
        
        querySnapshot.forEach(doc => {
            const data = doc.data();
            const row = document.createElement('tr');
            
            const createdDate = data.createdAt ? 
                new Date(data.createdAt.seconds * 1000).toLocaleDateString() : 'N/A';
                
            // Format type for display
            let typeDisplay = 'Unknown';
            let typeClass = '';
            
            switch(data.type) {
                case 'match':
                    typeDisplay = 'Match';
                    typeClass = 'match-type';
                    break;
                case 'creator':
                    typeDisplay = 'Creator';
                    typeClass = 'creator-type';
                    break;
                case 'achievement':
                    typeDisplay = 'Achievement';
                    typeClass = 'achievement-type';
                    break;
            }
            
            row.innerHTML = `
                <td>${data.title || 'Untitled'}</td>
                <td><span class="highlight-type ${typeClass}">${typeDisplay}</span></td>
                <td>${createdDate}</td>
                <td>${data.submittedBy || 'Unknown'}</td>
                <td>${data.videoId ? '<i class="fas fa-video"></i> Yes' : '<i class="fas fa-times"></i> No'}</td>
                <td class="actions">
                    <button class="edit-highlight-btn" data-id="${doc.id}" title="Edit">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="delete-highlight-btn" data-id="${doc.id}" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            `;
            
            tableBody.appendChild(row);
        });
        
        // Add event listeners to buttons
        document.querySelectorAll('.edit-highlight-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                openHighlightModal(e.currentTarget.dataset.id);
            });
        });
        
        document.querySelectorAll('.delete-highlight-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                confirmDeleteHighlight(e.currentTarget.dataset.id);
            });
        });
        
    } catch (error) {
        console.error("Error loading highlights:", error);
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" class="error-state">
                    Error loading highlights: ${error.message}
                </td>
            </tr>
        `;
    }
}

async function confirmDeleteHighlight(highlightId) {
    if (confirm('Are you sure you want to delete this highlight? This cannot be undone.')) {
        try {
            await deleteDoc(doc(db, 'highlights', highlightId));
            showNotification('Highlight deleted successfully', 'success');
            loadHighlightsAdmin();
        } catch (error) {
            console.error("Error deleting highlight:", error);
            showNotification(`Error deleting highlight: ${error.message}`, 'error');
        }
    }
}

function setupCreateTestMatchModal() {
    console.log('Setting up create test match modal events');
    
    const modal = document.getElementById('create-test-match-modal');
    const form = document.getElementById('create-test-match-form');
    
    if (!modal) {
        console.error('Create test match modal not found in DOM');
        return;
    }
    
    if (!form) {
        console.error('Create test match form not found in DOM');
        return;
    }
    
    // Remove any existing event listeners by cloning elements
    const newModal = modal.cloneNode(true);
    modal.parentNode.replaceChild(newModal, modal);
    
    const newForm = newModal.querySelector('#create-test-match-form');
    
    // Modal background click to close
    newModal.addEventListener('click', function(e) {
        if (e.target === newModal) {
            console.log('Modal background clicked');
            closeCreateTestMatchModal();
        }
    });
    
    // Close button
    const closeBtn = newModal.querySelector('.close-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('Modal close button clicked');
            closeCreateTestMatchModal();
        });
    }
    
    // Cancel button
    const cancelBtn = newModal.querySelector('#cancel-create-test-match-btn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('Modal cancel button clicked');
            closeCreateTestMatchModal();
        });
    }
    
    // Form submission
    if (newForm) {
        newForm.addEventListener('submit', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('Create test match form submitted');
            createTestMatch();
        });
        
        // Also handle button click directly if form submit doesn't work
        const submitBtn = newForm.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                console.log('Submit button clicked directly');
                createTestMatch();
            });
        }
    }
    
    console.log('Create test match modal setup complete');
}

function setupManageHighlightsSection() {
    console.log('Setting up Manage Highlights section');
    
    // Load highlights button is already set up in setupDataLoadButtons
    
    // Create highlight buttons for each type
    setupHighlightButtons();
    
    // Set up the highlight modal form submission
    const highlightForm = document.getElementById('highlight-form');
    if (highlightForm) {
        highlightForm.addEventListener('submit', (e) => {
            e.preventDefault();
            saveHighlight();
        });
    }
    
    // Close button for highlight modal
    const closeHighlightBtn = document.getElementById('cancel-highlight-btn');
    if (closeHighlightBtn) {
        closeHighlightBtn.addEventListener('click', closeHighlightModal);
    }
    
    // Modal close button (X)
    const closeBtn = document.querySelector('#highlight-modal .close-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeHighlightModal);
    }
    
    // Modal background click
    const highlightModal = document.getElementById('highlight-modal');
    if (highlightModal) {
        highlightModal.addEventListener('click', (e) => {
            if (e.target === highlightModal) {
                closeHighlightModal();
            }
        });
    }
    
    // Video ID input for preview update
    const videoIdInput = document.getElementById('highlight-video-id');
    if (videoIdInput) {
        videoIdInput.addEventListener('input', () => {
            updateHighlightVideoPreview();
        });
    }
    
    console.log('Manage Highlights section initialized');
}

function setupManageMatchesSection() {
    console.log('Setting up Manage Matches section');
    
    // Pagination buttons
    const prevBtn = document.getElementById('matches-prev-page');
    const nextBtn = document.getElementById('matches-next-page');
    
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            const ladderPrefix = currentLadder.toLowerCase();
            loadMatchesData(matchesPagination[ladderPrefix].page - 1);
        });
    }
    
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            const ladderPrefix = currentLadder.toLowerCase();
            loadMatchesData(matchesPagination[ladderPrefix].page + 1);
        });
    }
    
    // Filter buttons
    const applyFiltersBtn = document.getElementById('apply-matches-filters');
    const resetFiltersBtn = document.getElementById('reset-matches-filters');
    
    if (applyFiltersBtn) {
        applyFiltersBtn.addEventListener('click', applyMatchesFilters);
    }
    
    if (resetFiltersBtn) {
        resetFiltersBtn.addEventListener('click', resetMatchesFilters);
    }
    
    // Search functionality
    const matchesSearch = document.getElementById('matches-search');
    if (matchesSearch) {
        matchesSearch.addEventListener('input', debounce(filterMatchesTable, 300));
    }
    
    // FIXED: Create test match button setup
    setupCreateTestMatchButton();
    
    // FIXED: Set up modal event handlers
    setupCreateTestMatchModal();
    
    console.log('Manage Matches section initialized');
}


// Open create test match modal
function openCreateTestMatchModal() {
    console.log('Opening create test match modal');
    
    const modal = document.getElementById('create-test-match-modal');
    const form = document.getElementById('create-test-match-form');
    
    if (!modal) {
        console.error('Create test match modal not found');
        showNotification('Create test match modal not found', 'error');
        return;
    }
    
    if (!form) {
        console.error('Create test match form not found');
        showNotification('Create test match form not found', 'error');
        return;
    }
    
    // Reset form
    form.reset();
    
    // Set default ladder to current ladder
    const ladderRadios = document.querySelectorAll('input[name="test-match-ladder"]');
    let radioFound = false;
    
    ladderRadios.forEach(radio => {
        console.log('Found radio with value:', radio.value);
        if (radio.value === currentLadder) {
            radio.checked = true;
            radioFound = true;
            console.log('Set default ladder to:', currentLadder);
        }
    });
    
    if (!radioFound) {
        console.warn('No radio button found for current ladder:', currentLadder);
        // Default to D1 if no match found
        const defaultRadio = document.querySelector('input[name="test-match-ladder"][value="D1"]');
        if (defaultRadio) {
            defaultRadio.checked = true;
            console.log('Defaulted to D1 ladder');
        }
    }
    
    // Set default date to today
    const dateInput = document.getElementById('test-match-date');
    if (dateInput) {
        const today = new Date().toISOString().split('T')[0];
        dateInput.value = today;
    }
    
    // Show modal with proper display and visibility
    modal.style.display = 'flex';
    modal.style.visibility = 'visible';
    modal.style.opacity = '1';
    modal.classList.add('active');
    
    console.log('Modal should now be visible');
    
    // Focus on first input
    const firstInput = document.getElementById('test-match-winner-username');
    if (firstInput) {
        setTimeout(() => {
            firstInput.focus();
        }, 100);
    }
}

function closeCreateTestMatchModal() {
    console.log('Closing create test match modal');
    
    const modal = document.getElementById('create-test-match-modal');
    if (!modal) {
        console.error('Modal not found when trying to close');
        return;
    }
    
    // Remove active class and hide modal
    modal.classList.remove('active');
    modal.style.opacity = '0';
    modal.style.visibility = 'hidden';
    
    // Use CSS transition, then hide completely
    setTimeout(() => {
        if (!modal.classList.contains('active')) {
            modal.style.display = 'none';
        }
    }, 300);
    
    console.log('Modal closed');
}

// Create test match
async function createTestMatch() {
    console.log('Creating test match without player validation...');
    
    try {
        const user = auth.currentUser;
        if (!user) {
            showNotification('You must be logged in', 'error');
            return;
        }
        
        const selectedLadder = 'D1'; // Default for testing
        const matchesCollection = 'approvedMatches';
        
        const matchData = {
            winnerUsername: 'TestWinner',
            winnerScore: 20,
            winnerSuicides: 0,
            winnerComment: 'Test match',
            winnerDemoLink: null,
            loserUsername: 'TestLoser',
            loserScore: 15,
            loserSuicides: 0,
            loserComment: 'Test match',
            loserDemoLink: null,
            mapPlayed: 'TestMap',
            approvedAt: Timestamp.fromDate(new Date()),
            approvedBy: user.email,
            createdAt: serverTimestamp(),
            createdBy: user.email,
            isTestMatch: true,
            ladder: selectedLadder,
            testMatchCreatedAt: serverTimestamp(),
            testMatchNote: `Simple test match created by admin ${user.email}`
        };
        
        console.log('Adding simple test match...');
        await addDoc(collection(db, matchesCollection), matchData);
        
        showNotification('Simple test match created successfully', 'success');
        closeCreateTestMatchModal();
        
    } catch (error) {
        console.error('Error creating simple test match:', error);
        showNotification(`Failed to create simple test match: ${error.message}`, 'error');
    }
}

// Add this to your browser console to test Firebase connection
window.testFirebaseConnection = async function() {
    try {
        console.log('Testing Firebase connection...');
        console.log('Auth:', auth);
        console.log('DB:', db);
        console.log('Current user:', auth.currentUser);
        
        // Try a simple query
        const testRef = collection(db, 'players');
        console.log('Collection reference created:', testRef);
        
        const testQuery = query(testRef, where('username', '==', 'nonexistent'));
        console.log('Query created:', testQuery);
        
        const snapshot = await getDocs(testQuery);
        console.log('Query executed. Empty:', snapshot.empty);
        console.log('Firebase connection test successful!');
        
    } catch (error) {
        console.error('Firebase connection test failed:', error);
    }
};

function setupCreateTestMatchButton() {
    const createTestMatchBtn = document.getElementById('create-test-match-btn');
    if (!createTestMatchBtn) {
        console.error('Create test match button not found in DOM');
        return;
    }
    
    console.log('Setting up create test match button');
    
    // Remove any existing event listeners by cloning the element
    const newBtn = createTestMatchBtn.cloneNode(true);
    createTestMatchBtn.parentNode.replaceChild(newBtn, createTestMatchBtn);
    
    // Add fresh event listener
    newBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('Create test match button clicked');
        openCreateTestMatchModal();
    });
    
    console.log('Create test match button setup complete');
}



// Load matches data with pagination
async function loadMatchesData(page = 1) {
    const tableBody = document.getElementById('matches-table-body');
    if (!tableBody) return;
    
    tableBody.innerHTML = '<tr><td colspan="7" class="loading-cell">Loading matches...</td></tr>';
    
    try {
        const ladderPrefix = currentLadder.toLowerCase();
        const pagination = matchesPagination[ladderPrefix];
        
        // Collection name based on ladder
        const matchesCollection = 
            currentLadder === 'D1' ? 'approvedMatches' : 
            currentLadder === 'D2' ? 'approvedMatchesD2' : 'approvedMatchesD3';
        
        const matchesRef = collection(db, matchesCollection);
        
        // Reset pagination if going back to page 1
        if (page <= 1) {
            pagination.page = 1;
            pagination.firstVisible = null;
            pagination.lastVisible = null;
        } else {
            pagination.page = page;
        }
        
        // Apply filters if any
        const filters = getMatchesFilters();
        let q = matchesRef;
        
        if (filters.startDate || filters.endDate || filters.searchTerm) {
            // Create query with filters
            let queryConstraints = [];
            
            if (filters.startDate && filters.endDate) {
                queryConstraints.push(
                    where('approvedAt', '>=', filters.startDate),
                    where('approvedAt', '<=', filters.endDate)
                );
                q = query(matchesRef, ...queryConstraints);
            } else {
                q = query(matchesRef, orderBy('approvedAt', 'desc'));
            }
        } else {
            // Default ordering
            q = query(matchesRef, orderBy('approvedAt', 'desc'));
        }
        
        // Add pagination
        if (page > 1 && pagination.lastVisible) {
            q = query(q, startAfter(pagination.lastVisible), limit(PAGE_SIZE));
        } else {
            q = query(q, limit(PAGE_SIZE));
        }
        
        const querySnapshot = await getDocs(q);
        
        // Update pagination state
        if (!querySnapshot.empty) {
            pagination.firstVisible = querySnapshot.docs[0];
            pagination.lastVisible = querySnapshot.docs[querySnapshot.docs.length - 1];
        }
        
        // Check if there are more records for next page
        let hasNextPage = false;
        if (!querySnapshot.empty) {
            const nextPageQuery = query(q, startAfter(pagination.lastVisible), limit(1));
            const nextPageSnapshot = await getDocs(nextPageQuery);
            hasNextPage = !nextPageSnapshot.empty;
        }
        
        // Enable/disable pagination buttons
        const prevBtn = document.getElementById('matches-prev-page');
        const nextBtn = document.getElementById('matches-next-page');
        const pageIndicator = document.getElementById('matches-page-indicator');
        
        if (prevBtn) prevBtn.disabled = pagination.page <= 1;
        if (nextBtn) nextBtn.disabled = !hasNextPage;
        if (pageIndicator) pageIndicator.textContent = `Page ${pagination.page}`;
        
        if (querySnapshot.empty) {
            tableBody.innerHTML = '<tr><td colspan="7" class="empty-state">No matches found</td></tr>';
            return;
        }
        
        tableBody.innerHTML = '';
        
        querySnapshot.forEach(doc => {
            const match = doc.data();
            const row = document.createElement('tr');
            
            // Format date
            const dateStr = match.approvedAt ? 
                new Date(match.approvedAt.seconds * 1000).toLocaleDateString() : 'N/A';
            
            // IMPORTANT: Set data attributes for the action buttons
            row.setAttribute('data-id', doc.id);
            row.setAttribute('data-ladder', currentLadder);
            
            // Add a class to identify match rows
            row.classList.add('match-row');
            
            row.innerHTML = `
                <td>${dateStr}</td>
                <td class="winner-cell">${match.winnerUsername || 'Unknown'}</td>
                <td class="loser-cell">${match.loserUsername || 'Unknown'}</td>
                <td class="score-cell">${match.winnerScore || 0} - ${match.loserScore || 0}</td>
                <td class="map-cell">${match.mapPlayed || 'N/A'}</td>
                <td class="ladder-cell">${currentLadder}</td>
                <td class="actions">
                    <button class="edit-match-btn btn-small" data-id="${doc.id}" title="Edit Match">
                        <i class="fas fa-pencil-alt"></i>
                    </button>
                    <button class="delete-match-btn btn-small btn-danger" data-id="${doc.id}" title="Delete Match">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </td>
            `;
            
            tableBody.appendChild(row);
        });
        
        // IMPORTANT: Set up action buttons AFTER adding all rows
        setupMatchesActionButtons();
        
        // Apply search filter if there's a term
        if (filters.searchTerm) {
            filterMatchesTable();
        }
        
        console.log(`Loaded ${querySnapshot.size} matches for ${currentLadder} ladder, page ${pagination.page}`);
        
    } catch (error) {
        console.error('Error loading matches:', error);
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="error-state">
                    Error loading matches: ${error.message}
                </td>
            </tr>
        `;
    }
}

async function deleteMatch(matchId, ladder) {
    try {
        console.log(`Deleting match ${matchId} from ${ladder} ladder`);
        
        // Check authorization
        const user = auth.currentUser;
        if (!user) {
            showNotification('You must be logged in to delete matches', 'error');
            return;
        }
        
        // Collection name based on ladder
        const matchesCollection = 
            ladder === 'D1' ? 'approvedMatches' : 
            ladder === 'D2' ? 'approvedMatchesD2' : 'approvedMatchesD3';
        
        console.log(`Using collection: ${matchesCollection}`);
        
        // Show loading notification
        showNotification('Deleting match...', 'info');
        
        // Delete the match
        await deleteDoc(doc(db, matchesCollection, matchId));
        
        console.log('Match deleted successfully');
        showNotification('Match deleted successfully', 'success');
        
        // Reload matches table
        const ladderPrefix = ladder.toLowerCase();
        loadMatchesData(matchesPagination[ladderPrefix].page);
        
    } catch (error) {
        console.error('Error deleting match:', error);
        showNotification(`Failed to delete match: ${error.message}`, 'error');
    }
}

// Setup action buttons for matches table
function setupMatchesActionButtons() {
    console.log('Setting up matches action buttons...');
    
    // Edit buttons
    document.querySelectorAll('.edit-match-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const matchId = e.currentTarget.dataset.id;
            const row = e.currentTarget.closest('tr');
            const ladder = row.dataset.ladder;
            console.log('Edit match clicked:', matchId, ladder);
            openEditMatchModal(matchId, ladder);
        });
    });
    
    // Delete buttons - FIXED
    document.querySelectorAll('.delete-match-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const matchId = e.currentTarget.dataset.id;
            const row = e.currentTarget.closest('tr');
            const ladder = row.dataset.ladder || currentLadder; // Fallback to currentLadder
            console.log('Delete match clicked:', matchId, ladder);
            
            // For now, use a simple confirm dialog instead of modal
            if (confirm('Are you sure you want to delete this match? This action cannot be undone.')) {
                deleteMatch(matchId, ladder);
            }
        });
    });
    
    console.log('Matches action buttons setup complete');
}

// Filter matches table based on search term
function filterMatchesTable() {
    const searchTerm = document.getElementById('matches-search').value.toLowerCase();
    const rows = document.querySelectorAll('#matches-table-body tr');
    
    let visibleCount = 0;
    
    rows.forEach(row => {
        if (row.classList.contains('loading-cell') || 
            row.classList.contains('empty-state') || 
            row.classList.contains('error-state')) {
            return;
        }
        
        const winner = row.cells[1].textContent.toLowerCase();
        const loser = row.cells[2].textContent.toLowerCase();
        const map = row.cells[4].textContent.toLowerCase();
        
        if (winner.includes(searchTerm) || loser.includes(searchTerm) || map.includes(searchTerm)) {
            row.style.display = '';
            visibleCount++;
        } else {
            row.style.display = 'none';
        }
    });
    
    // Show no results message if needed
    if (visibleCount === 0 && rows.length > 0) {
        const tableBody = document.getElementById('matches-table-body');
        const hasNoResultsRow = tableBody.querySelector('.no-results');
        
        if (!hasNoResultsRow) {
            const noResultsRow = document.createElement('tr');
            noResultsRow.className = 'no-results';
            noResultsRow.innerHTML = `<td colspan="7">No matches found matching '${searchTerm}'</td>`;
            tableBody.appendChild(noResultsRow);
        }
    } else {
        const noResultsRow = document.querySelector('.no-results');
        if (noResultsRow) {
            noResultsRow.remove();
        }
    }
}

// Get filters for matches query
function getMatchesFilters() {
    const searchTerm = document.getElementById('matches-search').value.toLowerCase();
    const startDateStr = document.getElementById('matches-start-date').value;
    const endDateStr = document.getElementById('matches-end-date').value;
    
    let startDate = null;
    let endDate = null;
    
    if (startDateStr) {
        startDate = new Date(startDateStr);
        startDate.setHours(0, 0, 0, 0);
        startDate = Timestamp.fromDate(startDate);
    }
    
    if (endDateStr) {
        endDate = new Date(endDateStr);
        endDate.setHours(23, 59, 59, 999);
        endDate = Timestamp.fromDate(endDate);
    }
    
    return { searchTerm, startDate, endDate };
}

// Apply filters to matches
async function applyMatchesFilters() {
    // Reset pagination
    const ladderPrefix = currentLadder.toLowerCase();
    matchesPagination[ladderPrefix] = { page: 1, lastVisible: null, firstVisible: null };
    
    // Reload with filters applied
    await loadMatchesData(1);
}

// Reset match filters
function resetMatchesFilters() {
    document.getElementById('matches-start-date').value = '';
    document.getElementById('matches-end-date').value = '';
    document.getElementById('matches-search').value = '';
    
    // Reset pagination
    const ladderPrefix = currentLadder.toLowerCase();
    matchesPagination[ladderPrefix] = { page: 1, lastVisible: null, firstVisible: null };
    
    // Reload matches
    loadMatchesData(1);
}

// Open edit match modal
async function openEditMatchModal(matchId, ladder) {
    const modal = document.getElementById('edit-match-modal');
    if (!modal) return;
    
    try {
        // Collection name based on ladder
        const matchesCollection = 
            ladder === 'D1' ? 'approvedMatches' : 
            ladder === 'D2' ? 'approvedMatchesD2' : 'approvedMatchesD3';
        
        // Get match data
        const matchRef = doc(db, matchesCollection, matchId);
        const matchSnap = await getDoc(matchRef);
        
        if (!matchSnap.exists()) {
            showNotification('Match not found', 'error');
            return;
        }
        
        const match = matchSnap.data();
        
        // Set form fields
        document.getElementById('edit-match-id').value = matchId;
        document.getElementById('edit-match-ladder').value = ladder;
        document.getElementById('edit-match-winner').value = match.winnerUsername || '';
        document.getElementById('edit-match-winner-score').value = match.winnerScore || 0;
        document.getElementById('edit-match-winner-suicides').value = match.winnerSuicides || 0;
        document.getElementById('edit-match-winner-comment').value = match.winnerComment || '';
        document.getElementById('edit-match-loser').value = match.loserUsername || '';
        document.getElementById('edit-match-loser-score').value = match.loserScore || 0;
        document.getElementById('edit-match-loser-suicides').value = match.loserSuicides || 0;
        document.getElementById('edit-match-loser-comment').value = match.loserComment || '';
        document.getElementById('edit-match-map').value = match.mapPlayed || '';
        document.getElementById('edit-match-winner-demo').value = match.winnerDemoLink || '';
        document.getElementById('edit-match-loser-demo').value = match.loserDemoLink || match.demoLink || '';
        
        // Update title
        document.getElementById('edit-match-title').textContent = `Edit Match: ${match.winnerUsername} vs ${match.loserUsername}`;
        
        // Show the modal
        modal.classList.add('active');
        
    } catch (error) {
        console.error('Error loading match data:', error);
        showNotification('Failed to load match data', 'error');
    }
}

// Close edit match modal
function closeEditMatchModal() {
    const modal = document.getElementById('edit-match-modal');
    if (modal) {
        modal.classList.remove('active');
    }
}

// Save edited match
async function saveEditedMatch() {
    try {
        const matchId = document.getElementById('edit-match-id').value;
        const ladder = document.getElementById('edit-match-ladder').value;
        
        if (!matchId || !ladder) {
            showNotification('Match ID or ladder missing', 'error');
            return;
        }
        
        // Collection name based on ladder
        const matchesCollection = 
            ladder === 'D1' ? 'approvedMatches' : 
            ladder === 'D2' ? 'approvedMatchesD2' : 'approvedMatchesD3';
        
        // Get form values
        const winnerUsername = document.getElementById('edit-match-winner').value.trim();
        const winnerScore = parseInt(document.getElementById('edit-match-winner-score').value);
        const winnerSuicides = parseInt(document.getElementById('edit-match-winner-suicides').value);
        const winnerComment = document.getElementById('edit-match-winner-comment').value.trim();
        const loserUsername = document.getElementById('edit-match-loser').value.trim();
        const loserScore = parseInt(document.getElementById('edit-match-loser-score').value);
        const loserSuicides = parseInt(document.getElementById('edit-match-loser-suicides').value);
        const loserComment = document.getElementById('edit-match-loser-comment').value.trim();
        const mapPlayed = document.getElementById('edit-match-map').value.trim();
        const winnerDemoLink = document.getElementById('edit-match-winner-demo').value.trim();
        const loserDemoLink = document.getElementById('edit-match-loser-demo').value.trim();
        
        if (!winnerUsername || !loserUsername) {
            showNotification('Winner and loser usernames are required', 'error');
            return;
        }
        
        // Update the match document
        await updateDoc(doc(db, matchesCollection, matchId), {
            winnerUsername,
            winnerScore,
            winnerSuicides,
            winnerComment,
            loserUsername,
            loserScore,
            loserSuicides,
            loserComment,
            mapPlayed,
            winnerDemoLink: winnerDemoLink || null,
            loserDemoLink: loserDemoLink || null,
            lastModifiedAt: serverTimestamp(),
            lastModifiedBy: auth.currentUser.email,
            isEdited: true
        });
        
        showNotification('Match updated successfully', 'success');
        closeEditMatchModal();
        
        // Reload matches table
        loadMatchesData(matchesPagination[ladder.toLowerCase()].page);
        
    } catch (error) {
        console.error('Error saving match:', error);
        showNotification('Failed to save match: ' + error.message, 'error');
    }
}

// Open delete match confirmation modal
async function openDeleteMatchModal(matchId, ladder) {
    try {
        // Collection name based on ladder
        const matchesCollection = 
            ladder === 'D1' ? 'approvedMatches' : 
            ladder === 'D2' ? 'approvedMatchesD2' : 'approvedMatchesD3';
        
        // Get match data
        const matchRef = doc(db, matchesCollection, matchId);
        const matchSnap = await getDoc(matchRef);
        
        if (!matchSnap.exists()) {
            showNotification('Match not found', 'error');
            return;
        }
        
        const match = matchSnap.data();
        
        // Store match ID and ladder for deletion
        const deleteModal = document.getElementById('delete-match-confirm-modal');
        deleteModal.dataset.matchId = matchId;
        deleteModal.dataset.ladder = ladder;
        
        // Format date
        const dateStr = match.approvedAt ? 
            new Date(match.approvedAt.seconds * 1000).toLocaleDateString() : 'N/A';
        
        // Create match summary
        const summary = document.getElementById('delete-match-summary');
        summary.innerHTML = `
            <p><strong>Date:</strong> ${dateStr}</p>
            <p><strong>Players:</strong> ${match.winnerUsername} (winner) vs ${match.loserUsername} (loser)</p>
            <p><strong>Score:</strong> ${match.winnerScore || 0} - ${match.loserScore || 0}</p>
            <p><strong>Map:</strong> ${match.mapPlayed || 'N/A'}</p>
            <p><strong>Ladder:</strong> ${ladder}</p>
        `;
        
        // Show the modal
        deleteModal.classList.add('active');
        
    } catch (error) {
        console.error('Error loading match for deletion:', error);
        showNotification('Failed to load match data', 'error');
    }
}

// Close delete match modal
function closeDeleteMatchModal() {
    const modal = document.getElementById('delete-match-confirm-modal');
    if (modal) {
        modal.classList.remove('active');
        // Clear data attributes
        modal.removeAttribute('data-match-id');
        modal.removeAttribute('data-ladder');
    }
}

// Confirm and delete match
async function confirmDeleteMatch() {
    const modal = document.getElementById('delete-match-confirm-modal');
    const matchId = modal.dataset.matchId;
    const ladder = modal.dataset.ladder;
    
    if (!matchId || !ladder) {
        showNotification('Match ID or ladder missing', 'error');
        closeDeleteMatchModal();
        return;
    }
    
    try {
        // Collection name based on ladder
        const matchesCollection = 
            ladder === 'D1' ? 'approvedMatches' : 
            ladder === 'D2' ? 'approvedMatchesD2' : 'approvedMatchesD3';
        
        // Delete the match
        await deleteDoc(doc(db, matchesCollection, matchId));
        
        showNotification('Match deleted successfully', 'success');
        closeDeleteMatchModal();
        
        // Reload matches table
        loadMatchesData(matchesPagination[ladder.toLowerCase()].page);
        
    } catch (error) {
        console.error('Error deleting match:', error);
        showNotification('Failed to delete match: ' + error.message, 'error');
    }
}

async function saveHighlightChanges() {
    const highlightId = document.getElementById('edit-highlight-id').value;
    const type = document.getElementById('edit-highlight-type-select').value;

    // Base data object with common fields
    let highlightData = {
        title: document.getElementById('edit-highlight-title-input').value.trim(),
        type: type,
        description: document.getElementById('edit-highlight-description-input').value.trim(),
        videoId: document.getElementById('edit-highlight-videoId-input').value.trim(),
        submittedBy: auth.currentUser.email,
        // Timestamps will be handled below (createdAt for new, updatedAt for existing)
    };

    // Populate fields based on type and nullify irrelevant ones
    if (type === 'match') {
        highlightData.matchInfo = document.getElementById('edit-highlight-matchInfo-input').value.trim();
        highlightData.map = document.getElementById('edit-highlight-map-input').value.trim();
        const matchDateValue = document.getElementById('edit-highlight-matchDate-input').value;
        highlightData.matchDate = matchDateValue ? Timestamp.fromDate(new Date(matchDateValue)) : null;
        highlightData.winnerName = document.getElementById('edit-highlight-winnerName-input').value.trim();
        highlightData.winnerScore = document.getElementById('edit-highlight-winnerScore-input').value.trim();
        highlightData.loserName = document.getElementById('edit-highlight-loserName-input').value.trim();
        highlightData.loserScore = document.getElementById('edit-highlight-loserScore-input').value.trim();
        highlightData.matchLink = document.getElementById('edit-highlight-matchLink-input').value.trim();

        // Nullify creator/achievement specific fields
        highlightData.mapCreator = null;
        highlightData.mapVersion = null;
        highlightData.creatorImageUrl = null;
        highlightData.achievementPlayer = null;
        highlightData.achievementType = null;
        highlightData.achievementDetails = null;
        highlightData.playerProfileUrl = null;

    } else if (type === 'creator') {
        highlightData.map = document.getElementById('edit-highlight-map-input').value.trim(); // Map name is relevant for creator
        highlightData.mapCreator = document.getElementById('edit-highlight-mapCreator-input').value.trim();
        highlightData.mapVersion = document.getElementById('edit-highlight-mapVersion-input').value.trim();
        highlightData.creatorImageUrl = document.getElementById('edit-highlight-creatorImageUrl-input').value.trim();

        // Nullify match/achievement specific fields
        highlightData.matchInfo = null;
        highlightData.matchDate = null;
        highlightData.winnerName = null;
        highlightData.winnerScore = null;
        highlightData.loserName = null;
        highlightData.loserScore = null;
        highlightData.matchLink = null;
        highlightData.achievementPlayer = null;
        highlightData.achievementType = null;
        highlightData.achievementDetails = null;
        highlightData.playerProfileUrl = null;

    } else if (type === 'achievement') {
        highlightData.achievementPlayer = document.getElementById('edit-highlight-achievementPlayer-input').value.trim();
        highlightData.achievementType = document.getElementById('edit-highlight-achievementType-input').value.trim();
        highlightData.achievementDetails = document.getElementById('edit-highlight-achievementDetails-input').value.trim();
        highlightData.playerProfileUrl = document.getElementById('edit-highlight-playerProfileUrl-input').value.trim();

        // Nullify match/creator specific fields
        highlightData.matchInfo = null;
        highlightData.map = null; // Map name might not be relevant here, nullifying
        highlightData.matchDate = null;
        highlightData.winnerName = null;
        highlightData.winnerScore = null;
        highlightData.loserName = null;
        highlightData.loserScore = null;
        highlightData.matchLink = null;
        highlightData.mapCreator = null;
        highlightData.mapVersion = null;
        highlightData.creatorImageUrl = null;
    }

    try {
        if (highlightId) {
            highlightData.updatedAt = serverTimestamp();
            // To preserve createdAt on update, ensure it's not overwritten if not changed.
            // If your form doesn't allow editing createdAt, this is fine.
            // Otherwise, you might need to fetch the original doc to keep original createdAt.
            const highlightRef = doc(db, 'highlights', highlightId);
            await updateDoc(highlightRef, highlightData);
            showNotification('Highlight updated successfully!', 'success');
        } else {
            highlightData.createdAt = serverTimestamp();
            // For new documents, `updatedAt` is often omitted or set to the same as `createdAt`.
            // highlightData.updatedAt = serverTimestamp(); // Optional: if you want updatedAt on creation too
            await addDoc(collection(db, 'highlights'), highlightData);
            showNotification('Highlight added successfully!', 'success');
        }
        closeEditHighlightModal();
        loadHighlightsAdmin(); // Refresh the admin list of highlights
    } catch (error) {
        console.error('Error saving highlight:', error);
        showNotification(`Error saving highlight: ${error.message}`, 'error');
    }
}

//points section 

// Load points data (overview and history)
async function loadPointsData() {
    console.log('Loading points data...');
    try {
        await Promise.all([
            loadPointsOverview(),
            loadPointsHistory()
        ]);
        showNotification('Points data loaded successfully', 'success');
    } catch (error) {
        console.error('Error loading points data:', error);
        showNotification('Failed to load points data: ' + error.message, 'error');
    }
}

// Render points overview table
function renderPointsOverview(users) {
    const tableBody = document.getElementById('points-overview-table-body');
    if (!tableBody) return;
    
    if (users.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="5" class="empty-state">No users found</td></tr>';
        return;
    }
    
    tableBody.innerHTML = '';
    
    users.forEach(user => {
        const row = document.createElement('tr');
        
        const displayName = user.displayName || user.username || 'Unknown User';
        const email = user.email || 'No email';
        const points = user.points || 0;
        const lastModified = user.lastPointsModified ? 
            new Date(user.lastPointsModified.seconds * 1000).toLocaleDateString() : 'Never';
        
        row.innerHTML = `
            <td>
                <div class="user-info">
                    <i class="fas fa-user user-icon"></i>
                    <span class="user-name">${displayName}</span>
                </div>
            </td>
            <td>${email}</td>
            <td>
                <span class="points-badge ${points > 1000 ? 'high-points' : points > 500 ? 'medium-points' : 'low-points'}">
                    <i class="fas fa-coins"></i> ${points.toLocaleString()}
                </span>
            </td>
            <td>${lastModified}</td>
            <td class="actions">
                <button class="quick-edit-btn" data-user-id="${user.id}" title="Quick Edit Points">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="view-history-btn" data-user-id="${user.id}" title="View Points History">
                    <i class="fas fa-history"></i>
                </button>
            </td>
        `;
        
        // Add the row to the table body - THIS WAS MISSING!
        tableBody.appendChild(row);
    });
    
    // Add event listeners to action buttons AFTER all rows are added
    setupPointsActionButtons();
}


// Setup action buttons for points overview - FIXED VERSION
function setupPointsActionButtons() {
    console.log('Setting up points action buttons...');
    
    // Quick edit buttons
    const quickEditButtons = document.querySelectorAll('.quick-edit-btn');
    console.log(`Found ${quickEditButtons.length} quick edit buttons`);
    
    quickEditButtons.forEach(button => {
        // Remove any existing listeners by cloning
        const newButton = button.cloneNode(true);
        button.parentNode.replaceChild(newButton, button);
    });
    
    // View history buttons
    const viewHistoryButtons = document.querySelectorAll('.view-history-btn');
    console.log(`Found ${viewHistoryButtons.length} view history buttons`);
    
    viewHistoryButtons.forEach(button => {
        // Remove any existing listeners by cloning
        const newButton = button.cloneNode(true);
        button.parentNode.replaceChild(newButton, button);
    });
    
    // Add fresh event listeners to the new buttons
    document.querySelectorAll('.quick-edit-btn').forEach(button => {
        button.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            const userId = this.dataset.userId;
            console.log('Quick edit clicked for user:', userId);
            
            if (!userId) {
                console.error('No user ID found on button');
                return;
            }
            
            // Add visual feedback
            this.style.opacity = '0.6';
            setTimeout(() => { this.style.opacity = '1'; }, 200);
            
            openQuickEditModal(userId);
        });
    });
    
    document.querySelectorAll('.view-history-btn').forEach(button => {
        button.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            const userId = this.dataset.userId;
            console.log('View history clicked for user:', userId);
            
            if (!userId) {
                console.error('No user ID found on button');
                return;
            }
            
            // Add visual feedback
            this.style.opacity = '0.6';
            setTimeout(() => { this.style.opacity = '1'; }, 200);
            
            loadUserPointsHistory(userId);
        });
    });
    
    console.log('Points action buttons setup complete');
}

// Make sure the quick edit modal elements exist and work
async function openQuickEditModal(userId) {
    console.log('Opening quick edit modal for user ID:', userId);
    
    const modal = document.getElementById('quick-edit-points-modal');
    if (!modal) {
        console.error('Quick edit modal not found! Make sure the HTML element exists.');
        showNotification('Quick edit modal not found in the page', 'error');
        return;
    }
    
    try {
        // Show loading state
        showNotification('Loading user data...', 'info');
        
        // Get user data
        const userRef = doc(db, 'userProfiles', userId);
        const userDoc = await getDoc(userRef);
        
        if (!userDoc.exists()) {
            showNotification('User not found', 'error');
            return;
        }
        
        const userData = userDoc.data();
        console.log('User data loaded:', userData);
        
        // Check if form elements exist
        const userIdField = document.getElementById('quick-edit-user-id');
        const displayNameField = document.getElementById('quick-edit-display-name');
        const emailField = document.getElementById('quick-edit-email');
        const currentPointsField = document.getElementById('quick-edit-current-points');
        const form = document.getElementById('quick-edit-points-form');
        
        if (!userIdField || !displayNameField || !emailField || !currentPointsField || !form) {
            console.error('Quick edit form elements missing from HTML');
            showNotification('Quick edit form is incomplete. Check the HTML structure.', 'error');
            return;
        }
        
        // Populate modal with user info
        userIdField.value = userId;
        displayNameField.textContent = userData.displayName || userData.username || 'Unknown User';
        emailField.textContent = userData.email || 'No email';
        currentPointsField.textContent = (userData.points || 0).toLocaleString();
        
        // Reset form
        form.reset();
        
        // Set default action to add
        const addRadio = document.getElementById('quick-add');
        if (addRadio) {
            addRadio.checked = true;
        }
        
        // Show modal
        modal.classList.add('active');
        console.log('Modal opened successfully');
        
        // Focus on points amount input
        const amountInput = document.getElementById('quick-points-amount');
        if (amountInput) {
            setTimeout(() => amountInput.focus(), 100);
        }
        
    } catch (error) {
        console.error('Error opening quick edit modal:', error);
        showNotification('Failed to load user data: ' + error.message, 'error');
    }
}

// Close quick edit modal
function closeQuickEditModal() {
    const modal = document.getElementById('quick-edit-points-modal');
    if (modal) {
        modal.classList.remove('active');
    }
}

// Update the handleQuickEditPoints function to add more debugging
async function handleQuickEditPoints(e) {
    e.preventDefault();
    
    const userId = document.getElementById('quick-edit-user-id').value;
    const action = document.querySelector('input[name="quick-action"]:checked').value;
    const amount = parseInt(document.getElementById('quick-points-amount').value);
    const reason = document.getElementById('quick-points-reason').value.trim();
    
    console.log('Processing points edit:', { userId, action, amount, reason });
    
    if (!userId || !amount || amount < 0) {
        showNotification('Please enter valid data', 'error');
        return;
    }
    
    try {
        await modifyUserPoints(userId, action, amount, reason);
        closeQuickEditModal();
        loadPointsOverview(); // Refresh the table
        showNotification('Points updated successfully', 'success');
        console.log('Points updated successfully for user:', userId);
    } catch (error) {
        console.error('Error updating points:', error);
        showNotification('Failed to update points: ' + error.message, 'error');
    }
}

// Search users for points management
async function searchUsersForPoints() {
    const searchTerm = document.getElementById('points-user-search').value.trim().toLowerCase();
    const resultsContainer = document.getElementById('user-search-results');
    
    if (!searchTerm || searchTerm.length < 2) {
        resultsContainer.innerHTML = '';
        return;
    }
    
    resultsContainer.innerHTML = '<div class="loading">Searching...</div>';
    
    try {
        const usersRef = collection(db, 'userProfiles');
        const querySnapshot = await getDocs(usersRef);
        
        const matchingUsers = [];
        querySnapshot.forEach(doc => {
            const userData = doc.data();
            const displayName = (userData.displayName || userData.username || '').toLowerCase();
            const email = (userData.email || '').toLowerCase();
            
            if (displayName.includes(searchTerm) || email.includes(searchTerm)) {
                matchingUsers.push({
                    id: doc.id,
                    ...userData
                });
            }
        });
        
        if (matchingUsers.length === 0) {
            resultsContainer.innerHTML = '<div class="no-results">No users found</div>';
            return;
        }
        
        // Render search results
        resultsContainer.innerHTML = '';
        matchingUsers.forEach(user => {
            const resultItem = document.createElement('div');
            resultItem.className = 'search-result-item';
            resultItem.innerHTML = `
                <div class="user-info">
                    <strong>${user.displayName || user.username || 'Unknown'}</strong>
                    <div class="user-email">${user.email || 'No email'}</div>
                    <div class="user-points">${(user.points || 0).toLocaleString()} points</div>
                </div>
            `;
            
            resultItem.addEventListener('click', () => selectUserForPoints(user));
            resultsContainer.appendChild(resultItem);
        });
        
    } catch (error) {
        console.error('Error searching users:', error);
        resultsContainer.innerHTML = '<div class="error">Error searching users</div>';
    }
}

// Select user for points management
function selectUserForPoints(user) {
    // Update selected user info
    document.getElementById('selected-user-name').textContent = user.displayName || user.username || 'Unknown User';
    document.getElementById('selected-user-points').textContent = (user.points || 0).toLocaleString();
    document.getElementById('selected-user-id').value = user.id;
    
    // Show user info and management forms
    document.getElementById('selected-user-info').style.display = 'block';
    document.getElementById('points-management-forms').style.display = 'block';
    
    // Clear search results
    document.getElementById('user-search-results').innerHTML = '';
    document.getElementById('points-user-search').value = '';
}

// Handle modify points form submission
async function handleModifyPoints(e) {
    e.preventDefault();
    
    const userId = document.getElementById('selected-user-id').value;
    const action = document.getElementById('points-action').value;
    const amount = parseInt(document.getElementById('points-amount').value);
    const reason = document.getElementById('points-reason').value.trim();
    
    if (!userId || !amount || amount < 0) {
        showNotification('Please select a user and enter a valid amount', 'error');
        return;
    }
    
    try {
        await modifyUserPoints(userId, action, amount, reason);
        
        // Reset form
        document.getElementById('modify-points-form').reset();
        
        // Refresh user info
        const userRef = doc(db, 'userProfiles', userId);
        const userDoc = await getDoc(userRef);
        if (userDoc.exists()) {
            const userData = userDoc.data();
            document.getElementById('selected-user-points').textContent = (userData.points || 0).toLocaleString();
        }
        
        showNotification('Points modified successfully', 'success');
        loadPointsHistory(); // Refresh history
        
    } catch (error) {
        console.error('Error modifying points:', error);
        showNotification('Failed to modify points: ' + error.message, 'error');
    }
}

// Modify user points (common function)

// Load points history
async function loadPointsHistory() {
    const tableBody = document.getElementById('points-history-table-body');
    if (!tableBody) return;
    
    tableBody.innerHTML = '<tr><td colspan="6" class="loading-cell">Loading history...</td></tr>';
    
    try {
        const historyRef = collection(db, 'pointsHistory');
        const q = query(historyRef, orderBy('timestamp', 'desc'), limit(50));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            tableBody.innerHTML = '<tr><td colspan="6" class="empty-state">No history found</td></tr>';
            return;
        }
        
        tableBody.innerHTML = '';
        
        querySnapshot.forEach(doc => {
            const data = doc.data();
            const row = document.createElement('tr');
            
            const date = data.timestamp ? 
                new Date(data.timestamp.seconds * 1000).toLocaleString() : 'Unknown';
            
            let actionText = '';
            switch (data.action) {
                case 'add':
                    actionText = `Added ${data.amount} points`;
                    break;
                case 'subtract':
                    actionText = `Subtracted ${data.amount} points`;
                    break;
                case 'set':
                    actionText = `Set to ${data.amount} points`;
                    break;
                default:
                    actionText = `${data.action} ${data.amount} points`;
            }
            
            row.innerHTML = `
                <td>${date}</td>
                <td>${data.displayName || 'Unknown User'}</td>
                <td>${actionText}</td>
                <td>
                    <span class="points-change ${data.action}">
                        ${data.previousPoints || 0} → ${data.newPoints || 0}
                    </span>
                </td>
                <td>${data.reason || 'No reason provided'}</td>
                <td>${data.adminEmail || 'Unknown Admin'}</td>
            `;
            
            tableBody.appendChild(row);
        });
        
    } catch (error) {
        console.error('Error loading points history:', error);
        tableBody.innerHTML = '<tr><td colspan="6" class="error-state">Error loading history: ' + error.message + '</td></tr>';
    }
}

// Filter points overview
function filterPointsOverview() {
    const searchTerm = document.getElementById('points-overview-search').value.toLowerCase();
    
    if (!window.allUsersPoints) return;
    
    const filteredUsers = window.allUsersPoints.filter(user => {
        const displayName = (user.displayName || user.username || '').toLowerCase();
        const email = (user.email || '').toLowerCase();
        return displayName.includes(searchTerm) || email.includes(searchTerm);
    });
    
    renderPointsOverview(filteredUsers);
}

// Sort points overview
function sortPointsOverview() {
    const sortOrder = document.getElementById('points-sort-order').value;
    
    if (!window.allUsersPoints) return;
    
    const sortedUsers = [...window.allUsersPoints];
    
    switch (sortOrder) {
        case 'points-desc':
            sortedUsers.sort((a, b) => (b.points || 0) - (a.points || 0));
            break;
        case 'points-asc':
            sortedUsers.sort((a, b) => (a.points || 0) - (b.points || 0));
            break;
        case 'name-asc':
            sortedUsers.sort((a, b) => {
                const nameA = (a.displayName || a.username || '').toLowerCase();
                const nameB = (b.displayName || b.username || '').toLowerCase();
                return nameA.localeCompare(nameB);
            });
            break;
        case 'name-desc':
            sortedUsers.sort((a, b) => {
                const nameA = (a.displayName || a.username || '').toLowerCase();
                const nameB = (b.displayName || b.username || '').toLowerCase();
                return nameB.localeCompare(nameA);
            });
            break;
    }
    
    renderPointsOverview(sortedUsers);
}

// Handle award item form submission
async function handleAwardItem(e) {
    e.preventDefault();
    
    const userId = document.getElementById('selected-user-id').value;
    const itemId = document.getElementById('store-item-select').value;
    const reason = document.getElementById('award-reason').value.trim();
    
    if (!userId || !itemId) {
        showNotification('Please select a user and store item', 'error');
        return;
    }
    
    try {
        // This would integrate with your store system
        // For now, just show a success message
        showNotification('Store item awarded successfully', 'success');
        
        // Reset form
        document.getElementById('award-item-form').reset();
        
    } catch (error) {
        console.error('Error awarding item:', error);
        showNotification('Failed to award item: ' + error.message, 'error');
    }
}

// Load user points history (for specific user)
async function loadUserPointsHistory(userId) {
    try {
        const historyRef = collection(db, 'pointsHistory');
        const q = query(historyRef, where('userId', '==', userId), orderBy('timestamp', 'desc'));
        const querySnapshot = await getDocs(q);
        
        console.log(`Found ${querySnapshot.size} history entries for user ${userId}`);
        
        // You could show this in a modal or separate section
        showNotification(`User has ${querySnapshot.size} points history entries`, 'info');
        
    } catch (error) {
        console.error('Error loading user points history:', error);
        showNotification('Failed to load user history', 'error');
    }
}

async function initializeUserPointsField() {
    try {
        console.log('Starting points field initialization for all users...');
        
        // Get all users from userProfiles collection
        const usersRef = collection(db, 'userProfiles');
        const querySnapshot = await getDocs(usersRef);
        
        if (querySnapshot.empty) {
            console.log('No users found in userProfiles collection');
            return;
        }
        
        let updatedCount = 0;
        let alreadyHadPoints = 0;
        const batch = writeBatch(db);
        let batchCount = 0;
        
        console.log(`Found ${querySnapshot.size} users to check...`);
        
        querySnapshot.forEach(doc => {
            const userData = doc.data();
            
            // Only update if the user doesn't already have a points field
            if (userData.points === undefined || userData.points === null) {
                batch.update(doc.ref, {
                    points: 0,
                    pointsInitializedAt: serverTimestamp()
                });
                updatedCount++;
                batchCount++;
                
                console.log(`Queued ${userData.displayName || userData.username || userData.email || 'Unknown'} for points initialization`);
            } else {
                alreadyHadPoints++;
                console.log(`${userData.displayName || userData.username || userData.email || 'Unknown'} already has points: ${userData.points}`);
            }
            
            // Firestore batch limit is 500 operations
            if (batchCount >= 500) {
                console.warn('Batch limit reached - you may need to run this function multiple times for large datasets');
            }
        });
        
        if (updatedCount > 0) {
            console.log(`Committing batch update for ${updatedCount} users...`);
            await batch.commit();
            console.log(`✅ Successfully initialized points field for ${updatedCount} users`);
        } else {
            console.log('No users needed points field initialization');
        }
        
        // Log summary
        console.log(`Migration Summary:
        - Total users checked: ${querySnapshot.size}
        - Users updated with points: ${updatedCount}
        - Users who already had points: ${alreadyHadPoints}`);
        
        showNotification(`Points field initialized for ${updatedCount} users. ${alreadyHadPoints} users already had points.`, 'success');
        
        // Refresh the points overview if it's currently loaded
        if (window.allUsersPoints) {
            loadPointsOverview();
        }
        
        return {
            totalUsers: querySnapshot.size,
            usersUpdated: updatedCount,
            usersAlreadyHadPoints: alreadyHadPoints
        };
        
    } catch (error) {
        console.error('Error initializing points field:', error);
        showNotification(`Error initializing points: ${error.message}`, 'error');
        throw error;
    }
}

// Add this function to create a manual migration button (optional)
function addPointsMigrationButton() {
    // Only add this button for admins
    const pointsSection = document.getElementById('manage-points');
    if (!pointsSection) return;
    
    // Check if button already exists
    if (document.getElementById('migrate-points-btn')) return;
    
    // Create migration button
    const migrationContainer = document.createElement('div');
    migrationContainer.className = 'migration-section';
    migrationContainer.style.marginBottom = '20px';
    migrationContainer.style.padding = '15px';
    migrationContainer.style.backgroundColor = 'rgba(255, 193, 7, 0.1)';
    migrationContainer.style.border = '1px solid rgba(255, 193, 7, 0.3)';
    migrationContainer.style.borderRadius = '5px';
    
    migrationContainer.innerHTML = `
        <h4><i class="fas fa-database"></i> Database Migration</h4>
        <p>Initialize the points field for all users who don't have it yet. This is safe to run multiple times.</p>
        <button id="migrate-points-btn" class="btn btn-warning">
            <i class="fas fa-magic"></i> Initialize Points Field for All Users
        </button>
    `;
    
    // Insert at the top of the points section
    const sectionHeader = pointsSection.querySelector('.section-header');
    if (sectionHeader) {
        sectionHeader.insertAdjacentElement('afterend', migrationContainer);
    }
    
    // Add event listener
    document.getElementById('migrate-points-btn').addEventListener('click', async function() {
        if (confirm('This will add a points field (set to 0) for all users who don\'t have one yet. Continue?')) {
            this.disabled = true;
            this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Initializing...';
            
            try {
                await initializeUserPointsField();
                this.innerHTML = '<i class="fas fa-check"></i> Completed';
                this.style.backgroundColor = '#28a745';
                
                // Hide the migration section after successful completion
                setTimeout(() => {
                    migrationContainer.style.display = 'none';
                }, 3000);
            } catch (error) {
                this.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Error - Try Again';
                this.disabled = false;
            }
        }
    });
}

// Also make sure the setupManagePointsSection properly sets up the modal form
function setupManagePointsSection() {
    console.log('Setting up Manage Points section');
    
    // Add migration button for initializing points field
    addPointsMigrationButton();
    
    // User search functionality
    const userSearchInput = document.getElementById('points-user-search');
    if (userSearchInput) {
        userSearchInput.addEventListener('input', debounce(searchUsersForPoints, 300));
    }
    
    // Modify points form
    const modifyPointsForm = document.getElementById('modify-points-form');
    if (modifyPointsForm) {
        modifyPointsForm.addEventListener('submit', handleModifyPoints);
    }
    
    // Award item form
    const awardItemForm = document.getElementById('award-item-form');
    if (awardItemForm) {
        awardItemForm.addEventListener('submit', handleAwardItem);
    }
    
    // Points overview controls
    const pointsOverviewSearch = document.getElementById('points-overview-search');
    if (pointsOverviewSearch) {
        pointsOverviewSearch.addEventListener('input', debounce(filterPointsOverview, 300));
    }
    
    const pointsSortOrder = document.getElementById('points-sort-order');
    if (pointsSortOrder) {
        pointsSortOrder.addEventListener('change', sortPointsOverview);
    }
    
    const refreshPointsBtn = document.getElementById('refresh-points-overview');
    if (refreshPointsBtn) {
        refreshPointsBtn.addEventListener('click', loadPointsOverview);
    }
    
    // Quick edit modal events - MAKE SURE THESE WORK
    const quickEditModal = document.getElementById('quick-edit-points-modal');
    if (quickEditModal) {
        console.log('Quick edit modal found, setting up events...');
        
        // Close button
        const closeBtn = quickEditModal.querySelector('.close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                console.log('Modal close button clicked');
                closeQuickEditModal();
            });
        } else {
            console.warn('Close button not found in quick edit modal');
        }
        
        // Cancel button
        const cancelBtn = document.getElementById('cancel-quick-edit');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', function() {
                console.log('Modal cancel button clicked');
                closeQuickEditModal();
            });
        } else {
            console.warn('Cancel button not found');
        }
        
        // Form submission
        const quickEditForm = document.getElementById('quick-edit-points-form');
        if (quickEditForm) {
            quickEditForm.addEventListener('submit', function(e) {
                console.log('Quick edit form submitted');
                handleQuickEditPoints(e);
            });
        } else {
            console.error('Quick edit form not found!');
        }
        
        // Modal background click to close
        quickEditModal.addEventListener('click', function(e) {
            if (e.target === quickEditModal) {
                console.log('Modal background clicked');
                closeQuickEditModal();
            }
        });
        
    } else {
        console.error('Quick edit modal not found in DOM!');
    }
    
    console.log('Manage Points section initialized');
}

// Setup manage ribbons section
function setupManageRibbonsSection() {
    console.log('Setting up Manage Ribbons section');
    
    // User search functionality
    const userSearchInput = document.getElementById('ribbon-user-search');
    if (userSearchInput) {
        userSearchInput.addEventListener('input', debounce(searchRibbonUser, 300));
    }
    
    // Search button
    const searchBtn = document.getElementById('search-ribbon-user-btn');
    if (searchBtn) {
        searchBtn.addEventListener('click', searchRibbonUser);
    }
    
    // Add ribbon form
    const addRibbonForm = document.getElementById('add-ribbon-form');
    if (addRibbonForm) {
        addRibbonForm.addEventListener('submit', addRibbon);
    }
    
    // Search input enter key
    if (userSearchInput) {
        userSearchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                searchRibbonUser();
            }
        });
    }
    
    console.log('Manage Ribbons section initialized');
}

// Update the modifyUserPoints function to ensure user has points field
async function modifyUserPoints(userId, action, amount, reason = '') {
    const userRef = doc(db, 'userProfiles', userId);
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) {
        throw new Error('User not found');
    }
    
    const userData = userDoc.data();
    
    // Initialize points to 0 if it doesn't exist
    const currentPoints = userData.points !== undefined ? userData.points : 0;
    
    // If user didn't have points field, initialize it first
    if (userData.points === undefined) {
        console.log(`Initializing points field for user ${userData.displayName || userData.email || 'Unknown'}`);
        await updateDoc(userRef, {
            points: 0,
            pointsInitializedAt: serverTimestamp()
        });
    }
    
    let newPoints = currentPoints;
    
    switch (action) {
        case 'add':
            newPoints = currentPoints + amount;
            break;
        case 'subtract':
            newPoints = Math.max(0, currentPoints - amount);
            break;
        case 'set':
            newPoints = amount;
            break;
        default:
            throw new Error('Invalid action');
    }
    
    // Update user points
    await updateDoc(userRef, {
        points: newPoints,
        lastPointsModified: serverTimestamp()
    });
    
    // Log the points change
    await addDoc(collection(db, 'pointsHistory'), {
        userId: userId,
        userEmail: userData.email || 'unknown',
        displayName: userData.displayName || userData.username || 'Unknown User',
        action: action,
        amount: amount,
        previousPoints: currentPoints,
        newPoints: newPoints,
        reason: reason,
        adminEmail: auth.currentUser.email,
        timestamp: serverTimestamp()
    });
}

// Also update loadPointsOverview to handle users without points field gracefully
async function loadPointsOverview() {
    const tableBody = document.getElementById('points-overview-table-body');
    if (!tableBody) return;
    
    tableBody.innerHTML = '<tr><td colspan="5" class="loading-cell">Loading user points...</td></tr>';
    
    try {
        const usersRef = collection(db, 'userProfiles');
        const querySnapshot = await getDocs(usersRef);
        
        if (querySnapshot.empty) {
            tableBody.innerHTML = '<tr><td colspan="5" class="empty-state">No users found</td></tr>';
            return;
        }
        
        const users = [];
        let usersWithoutPoints = 0;
        
        querySnapshot.forEach(doc => {
            const userData = doc.data();
            const points = userData.points !== undefined ? userData.points : 0;
            
            // Count users without points field for info
            if (userData.points === undefined) {
                usersWithoutPoints++;
            }
            
            users.push({
                id: doc.id,
                ...userData,
                points: points
            });
        });
        
        // Show info if some users don't have points field
        if (usersWithoutPoints > 0) {
            console.log(`Found ${usersWithoutPoints} users without points field - they will display as 0 points`);
            showNotification(`${usersWithoutPoints} users don't have points field yet. Use the migration button to initialize.`, 'info');
        }
        
        // Sort users by points (highest first) by default
        users.sort((a, b) => (b.points || 0) - (a.points || 0));
        
        // Store for filtering/sorting
        window.allUsersPoints = users;
        
        renderPointsOverview(users);
        
    } catch (error) {
        console.error('Error loading points overview:', error);
        tableBody.innerHTML = '<tr><td colspan="5" class="error-state">Error loading users: ' + error.message + '</td></tr>';
    }
}

// Add these functions to your JS/adminbackend.js

// Load all ribbon data
async function loadRibbonsData() {
    const tableBody = document.getElementById('ribbons-overview-table-body');
    if (!tableBody) return;
    
    tableBody.innerHTML = '<tr><td colspan="5" class="loading-cell">Loading ribbons data...</td></tr>';
    
    try {
        // Load from all ribbon collections
        const [d1Ribbons, d2Ribbons, d3Ribbons] = await Promise.all([
            getDocs(collection(db, 'playerRibbons')),
            getDocs(collection(db, 'playerRibbonsD2')),  
            getDocs(collection(db, 'playerRibbonsD3'))
        ]);
        
        tableBody.innerHTML = '';
        
        const addRibbonRows = (snapshot, ladder) => {
            snapshot.forEach(doc => {
                const data = doc.data();
                const ribbons = data.ribbons || {};
                const ribbonCount = Object.keys(ribbons).length;
                
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${data.username || 'Unknown'}</td>
                    <td><span class="ladder-badge ${ladder.toLowerCase()}">${ladder}</span></td>
                    <td>${ribbonCount}</td>
                    <td>${data.lastUpdated ? new Date(data.lastUpdated.seconds * 1000).toLocaleDateString() : 'Unknown'}</td>
                    <td>
                        <button class="btn btn-sm edit-ribbons-btn" data-username="${data.username}" data-ladder="${ladder}">
                            <i class="fas fa-edit"></i> Edit
                        </button>
                    </td>
                `;
                tableBody.appendChild(row);
            });
        };
        
        addRibbonRows(d1Ribbons, 'D1');
        addRibbonRows(d2Ribbons, 'D2'); 
        addRibbonRows(d3Ribbons, 'D3');
        
        // Setup edit buttons
        document.querySelectorAll('.edit-ribbons-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const username = this.dataset.username;
                const ladder = this.dataset.ladder;
                editUserRibbons(username, ladder);
            });
        });
        
        showNotification('Ribbons data loaded successfully', 'success');
        
    } catch (error) {
        console.error('Error loading ribbons:', error);
        tableBody.innerHTML = '<tr><td colspan="5" class="error-state">Error loading ribbons</td></tr>';
        showNotification('Error loading ribbons data', 'error');
    }
}
// Search for user ribbons
async function searchRibbonUser() {
    const username = document.getElementById('ribbon-user-search').value.trim();
    if (!username) {
        showNotification('Please enter a username', 'error');
        return;
    }
    
    try {
        // Search in all ladders
        const [d1Doc, d2Doc, d3Doc] = await Promise.all([
            getDoc(doc(db, 'playerRibbons', username)),
            getDoc(doc(db, 'playerRibbonsD2', username)),
            getDoc(doc(db, 'playerRibbonsD3', username))
        ]);
        
        let foundLadder = null;
        let userData = null;
        
        if (d1Doc.exists()) {
            foundLadder = 'D1';
            userData = d1Doc.data();
        } else if (d2Doc.exists()) {
            foundLadder = 'D2'; 
            userData = d2Doc.data();
        } else if (d3Doc.exists()) {
            foundLadder = 'D3';
            userData = d3Doc.data();
        }
        
        if (foundLadder) {
            document.getElementById('current-ribbon-user').textContent = username;
            document.getElementById('ribbon-target-user').value = username;
            document.getElementById('ribbon-target-ladder').value = foundLadder;
            document.getElementById('user-ribbon-management').style.display = 'block';
            
            displayCurrentRibbons(userData.ribbons || {});
            showNotification(`Found ${username} in ${foundLadder} ladder`, 'success');
        } else {
            showNotification(`User ${username} not found in any ladder`, 'error');
        }
        
    } catch (error) {
        console.error('Error searching user:', error);
        showNotification('Error searching for user', 'error');
    }
}
// Display current ribbons
// Display current ribbons
function displayCurrentRibbons(ribbons) {
    const container = document.getElementById('current-ribbons-list');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (Object.keys(ribbons).length === 0) {
        container.innerHTML = '<p class="no-ribbons">No ribbons found</p>';
        return;
    }
    
    Object.entries(ribbons).forEach(([ribbonName, ribbonData]) => {
        const ribbonDiv = document.createElement('div');
        ribbonDiv.className = 'ribbon-item';
        ribbonDiv.innerHTML = `
            <div class="ribbon-info">
                <strong>${ribbonName}</strong>
                <span>Level: ${ribbonData.level || 1}</span>
                <small>Awarded: ${ribbonData.awardedAt ? new Date(ribbonData.awardedAt.seconds * 1000).toLocaleDateString() : 'Unknown'}</small>
            </div>
            <button class="btn btn-danger btn-sm remove-ribbon-btn" data-ribbon="${ribbonName}">
                <i class="fas fa-trash"></i> Remove
            </button>
        `;
        container.appendChild(ribbonDiv);
    });
    
    // Setup remove buttons
    document.querySelectorAll('.remove-ribbon-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const ribbonName = this.dataset.ribbon;
            removeRibbon(ribbonName);
        });
    });
}

// Add or update ribbon
async function addRibbon(event) {
    event.preventDefault();
    
    const username = document.getElementById('ribbon-target-user').value;
    const ladder = document.getElementById('ribbon-target-ladder').value;
    const ribbonType = document.getElementById('ribbon-type-select').value;
    const level = parseInt(document.getElementById('ribbon-level').value);
    
    if (!username || !ladder || !ribbonType || !level) {
        showNotification('Please fill all fields', 'error');
        return;
    }
    
    try {
        const collectionName = `playerRibbons${ladder === 'D1' ? '' : ladder}`;
        const ribbonRef = doc(db, collectionName, username);
        
        // Get current ribbons
        const ribbonDoc = await getDoc(ribbonRef);
        const currentRibbons = ribbonDoc.exists() ? ribbonDoc.data().ribbons || {} : {};
        
        // Add/update ribbon
        currentRibbons[ribbonType] = {
            level: level,
            awardedAt: serverTimestamp()
        };
        
        // Save updated ribbons
        await setDoc(ribbonRef, {
            username: username,
            ladder: ladder,
            ribbons: currentRibbons,
            lastUpdated: serverTimestamp()
        }, { merge: true });
        
        showNotification(`Added ${ribbonType} Level ${level} to ${username}`, 'success');
        displayCurrentRibbons(currentRibbons);
        
        // Clear form
        document.getElementById('ribbon-type-select').value = '';
        document.getElementById('ribbon-level').value = '1';
        
    } catch (error) {
        console.error('Error adding ribbon:', error);
        showNotification('Error adding ribbon', 'error');
    }
}

// Remove ribbon
async function removeRibbon(ribbonName) {
    const username = document.getElementById('ribbon-target-user').value;
    const ladder = document.getElementById('ribbon-target-ladder').value;
    
    if (!confirm(`Remove ${ribbonName} from ${username}?`)) return;
    
    try {
        const collectionName = `playerRibbons${ladder === 'D1' ? '' : ladder}`;
        const ribbonRef = doc(db, collectionName, username);
        
        // Get current ribbons
        const ribbonDoc = await getDoc(ribbonRef);
        const currentRibbons = ribbonDoc.exists() ? ribbonDoc.data().ribbons || {} : {};
        
        // Remove ribbon
        delete currentRibbons[ribbonName];
        
        // Save updated ribbons
        await setDoc(ribbonRef, {
            username: username,
            ladder: ladder,
            ribbons: currentRibbons,
            lastUpdated: serverTimestamp()
        }, { merge: true });
        
        showNotification(`Removed ${ribbonName} from ${username}`, 'success');
        displayCurrentRibbons(currentRibbons);
        
    } catch (error) {
        console.error('Error removing ribbon:', error);
        showNotification('Error removing ribbon', 'error');
    }
}

// Edit user ribbons (called from table)
function editUserRibbons(username, ladder) {
    document.getElementById('ribbon-user-search').value = username;
    searchRibbonUser();
}