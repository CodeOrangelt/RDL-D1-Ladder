import { 
    collection, getDocs, query, orderBy, addDoc, deleteDoc, where, doc, getDoc,
    serverTimestamp, setDoc, updateDoc, writeBatch, limit, startAfter, endBefore,
    limitToLast, onSnapshot, deleteField, or 
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { auth, db } from './firebase-config.js';
import { getRankStyle } from './ranks.js';
import { isAdmin } from './admin-check.js';

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
let eloHistoryPagination = { d1: { page: 1, lastVisible: null, firstVisible: null }, d2: { page: 1, lastVisible: null, firstVisible: null } };
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

// Define tab permissions by role
function getUserTabPermissions(user) {
  if (!user) return [];
  
  // Update permissions for admin
if (isAdmin(user.email)) {
    console.log(`User ${user.email} is a system admin - full access granted`);
    return ['dashboard', 'players', 'elo-history', 'manage-ranks', 'manage-articles', 'user-roles-section', 'manage-trophies', 'inactive-players'];
}
  
  // For non-admins, check for role-based permissions
  const email = user.email;
  
  return new Promise(async (resolve) => {
    try {
      console.log(`Looking for user role information for ${email} in all collections...`);
      let roleInfo = null;
      
      // 1. FIRST check in players collections (D1 and D2) since that's where roles are stored
      // Check D1 players
      const playersRef = collection(db, 'players');
      let q1 = query(playersRef, where('email', '==', email));
      let snapshot1 = await getDocs(q1);
      
      // If no match by email in D1, try by username
      if (snapshot1.empty) {
        q1 = query(playersRef, where('username', '==', email.toLowerCase()));
        snapshot1 = await getDocs(q1);
      }
      
      // If found in D1 players
      if (!snapshot1.empty) {
        const userData = snapshot1.docs[0].data();
        roleInfo = {
          role: userData.roleName?.toLowerCase() || 'none',
          source: 'D1 Players'
        };
        console.log(`Found user in D1 Players with role: ${roleInfo.role}`);
      }
      
      // 2. If not found in D1, check D2 players
      if (!roleInfo) {
        const playersD2Ref = collection(db, 'playersD2');
        let q2 = query(playersD2Ref, where('email', '==', email));
        let snapshot2 = await getDocs(q2);
        
        // If no match by email in D2, try by username
        if (snapshot2.empty) {
          q2 = query(playersD2Ref, where('username', '==', email.toLowerCase()));
          snapshot2 = await getDocs(q2);
        }
        
        // If found in D2 players
        if (!snapshot2.empty) {
          const userData = snapshot2.docs[0].data();
          roleInfo = {
            role: userData.roleName?.toLowerCase() || 'none',
            source: 'D2 Players'
          };
          console.log(`Found user in D2 Players with role: ${roleInfo.role}`);
        }
      }
      
      // 3. As a last resort, check userProfiles (which might not have roles yet)
      if (!roleInfo) {
        const userProfilesRef = collection(db, 'userProfiles');
        let q3 = query(userProfilesRef, where('email', '==', email));
        let snapshot3 = await getDocs(q3);
        
        // If no match by email, try username
        if (snapshot3.empty) {
          q3 = query(userProfilesRef, where('username', '==', email.toLowerCase()));
          snapshot3 = await getDocs(q3);
        }
        
        // If found in userProfiles
        if (!snapshot3.empty) {
          const userData = snapshot3.docs[0].data();
          roleInfo = {
            role: userData.roleName?.toLowerCase() || 'none',
            source: 'User Profiles'
          };
          console.log(`Found user in userProfiles with role: ${roleInfo.role}`);
        }
      }
      
      // Determine permissions based on role
      if (roleInfo) {
        console.log(`Setting permissions based on role: ${roleInfo.role} (from ${roleInfo.source})`);
        
        // Assign permissions based on role
        switch (roleInfo.role) {
          case 'admin':
          case 'owner':
            resolve(['dashboard', 'players', 'elo-history', 'manage-ranks', 'manage-articles', 'user-roles-section', 'manage-trophies', 'inactive-players']);
            break;
          case 'council':
            resolve(['dashboard', 'elo-history']);
            break;
          case 'creative lead':
            resolve(['dashboard', 'elo-history', 'manage-articles', 'manage-trophies']); 
            break;
          default:
            console.log(`Role '${roleInfo.role}' has no special permissions, giving default access`);
            resolve(['dashboard']); // Minimal access
        }
      } else {
        console.log(`User ${email} not found in any collection - giving default access`);
        resolve(['dashboard']);
      }
    } catch (error) {
      console.error('Error fetching user role:', error);
      resolve(['dashboard']);
    }
  });
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

// Add setupTabNavigation function
function setupTabNavigation() {
    const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
    const sections = document.querySelectorAll('.main-content .admin-section'); // Use .admin-section if that's your container class

    if (navItems.length === 0 || sections.length === 0) {
        console.error("Tab navigation elements not found!");
        return;
    }

    console.log(`Found ${navItems.length} nav items and ${sections.length} sections.`);

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const sectionId = item.getAttribute('data-section');
            console.log(`Nav item clicked: data-section=${sectionId}`);

            if (!sectionId) {
                console.error("Nav item missing data-section attribute:", item);
                return;
            }

            // Remove active class from all items and sections
            navItems.forEach(nav => nav.classList.remove('active'));
            sections.forEach(sec => sec.classList.remove('active'));

            // Add active class to the clicked item and corresponding section
            item.classList.add('active');
            const targetSection = document.getElementById(sectionId);

            if (targetSection) {
                console.log(`Activating section: #${sectionId}`);
                targetSection.classList.add('active');
                // Optional: Update header title based on active section
                const headerTitle = document.querySelector('.content-header h1');
                if (headerTitle && item.querySelector('span')) {
                    headerTitle.textContent = item.querySelector('span').textContent;
                }
            } else {
                console.error(`Target section #${sectionId} not found!`);
            }
        });
    });

    // Activate the first tab by default (or a specific one)
    const defaultActiveNavItem = document.querySelector('.sidebar-nav .nav-item[data-section="dashboard-section"]') || navItems[0];
    if (defaultActiveNavItem) {
        defaultActiveNavItem.click(); // Simulate a click to activate the default tab
        console.log("Default tab activated.");
    } else {
        console.error("Could not find default tab to activate.");
    }
}

// Modify initializeAdminDashboard to include the trophy management section
async function initializeAdminDashboard() {
    try {
        // Get current user and their permissions
        const user = auth.currentUser;
        const allowedTabs = await getUserTabPermissions(user);
        console.log(`User ${user.email} allowed tabs:`, allowedTabs);
        
        // Store permissions globally for reference in other functions
        window.userAllowedTabs = allowedTabs;
        
        // Initialize sidebar navigation WITH permissions
        setupSidebarNavigation(allowedTabs);
        
        // Initialize ladder selector
        setupLadderSelector();
        
        // Initialize sections conditionally based on permissions
        setupDashboardSection();
        
        if (allowedTabs.includes('players')) {
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

        if (allowedTabs.includes('inactive-players')) {
            setupInactivePlayersSection();
        }
        // Set up data load buttons with permissions
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
    if (allowedTabs.includes('players')) {
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
    
    console.log('Data load buttons initialized based on permissions');
}

// Remove automatic data loading from section changes
function loadSectionData(sectionId) {
    // This now does nothing - data loading is triggered by buttons only
    return;
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
        const playerCollection = currentLadder === 'D1' ? 'players' : 'playersD2';
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
        const ladder = document.querySelector('input[name="new-player-ladder"]:checked').value;
        
        const username = usernameInput.value.trim();
        const elo = parseInt(eloInput.value) || 1200;
        
        if (!username) {
            alert('Please enter a valid username');
            return;
        }
        
        console.log(`Adding player ${username} with ELO ${elo} to ${ladder} ladder(s)`);
        
        // Determine which collection(s) to use
        const addToD1 = ladder === 'D1' || ladder === 'BOTH';
        const addToD2 = ladder === 'D2' || ladder === 'BOTH';
        
        // Check if username exists in the collections
        if (addToD1) {
            const d1Query = query(collection(db, 'players'), where('username', '==', username));
            const d1Snap = await getDocs(d1Query);
            if (!d1Snap.empty) {
                alert(`Username ${username} already exists in D1 ladder`);
                return;
            }
        }
        
        if (addToD2) {
            const d2Query = query(collection(db, 'playersD2'), where('username', '==', username));
            const d2Snap = await getDocs(d2Query);
            if (!d2Snap.empty) {
                alert(`Username ${username} already exists in D2 ladder`);
                return;
            }
        }
        
        // Add the player to selected ladder(s)
        const promises = [];
        const user = auth.currentUser;
        
        if (addToD1) {
            const playerData = {
                username,
                eloRating: elo,
                wins: 0,
                losses: 0,
                createdAt: serverTimestamp(),
                createdBy: user ? user.email : 'admin',
                gameMode: 'D1'
            };
            
            promises.push(addDoc(collection(db, 'players'), playerData));
            
            // Record initial ELO in history
            promises.push(addDoc(collection(db, 'eloHistory'), {
                player: username,
                previousElo: 1200,
                newElo: elo,
                timestamp: serverTimestamp(),
                type: 'initial_placement',
                placedBy: user ? user.email : 'admin',
                gameMode: 'D1'
            }));
        }
        
        if (addToD2) {
            const playerData = {
                username,
                eloRating: elo,
                wins: 0,
                losses: 0,
                createdAt: serverTimestamp(),
                createdBy: user ? user.email : 'admin',
                gameMode: 'D2'
            };
            
            promises.push(addDoc(collection(db, 'playersD2'), playerData));
            
            // Record initial ELO in history
            promises.push(addDoc(collection(db, 'eloHistoryD2'), {
                player: username,
                previousElo: 1200,
                newElo: elo,
                timestamp: serverTimestamp(),
                type: 'initial_placement',
                placedBy: user ? user.email : 'admin',
                gameMode: 'D2'
            }));
        }
        
        await Promise.all(promises);
        
        // Reset form and refresh display
        usernameInput.value = '';
        eloInput.value = '1200';
        document.querySelector('input[id="new-player-d1"]').checked = true;
        
        // Show success message
        alert(`Player ${username} added successfully!`);
        
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
    const ladderPrefix = currentLadder.toLowerCase(); // d1 or d2
    
    if (!historyTable) return;
    
    historyTable.innerHTML = '<tr><td colspan="7" class="loading-cell">Loading history...</td></tr>';
    
    try {
        const historyCollection = currentLadder === 'D1' ? 'eloHistory' : 'eloHistoryD2';
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
        
        // Render table
        historyTable.innerHTML = '';
        
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
    // Pagination buttons for D1
    document.getElementById('d1-prev-page').addEventListener('click', () => {
        loadEloHistory(eloHistoryPagination.d1.page - 1);
    });
    
    document.getElementById('d1-next-page').addEventListener('click', () => {
        loadEloHistory(eloHistoryPagination.d1.page + 1);
    });
    
    // Pagination buttons for D2
    document.getElementById('d2-prev-page').addEventListener('click', () => {
        loadEloHistory(eloHistoryPagination.d2.page - 1);
    });
    
    document.getElementById('d2-next-page').addEventListener('click', () => {
        loadEloHistory(eloHistoryPagination.d2.page + 1);
    });
    
    // Search functionality
    const historySearch = document.getElementById('elo-history-search');
    if (historySearch) {
        historySearch.addEventListener('input', debounce(filterEloHistoryTable, 300));
    }
    
    // Date filters
    const startDateFilter = document.getElementById('history-start-date');
    const endDateFilter = document.getElementById('history-end-date');
    
    if (startDateFilter && endDateFilter) {
        startDateFilter.addEventListener('change', applyEloHistoryFilters);
        endDateFilter.addEventListener('change', applyEloHistoryFilters);
    }
    
    // Type filter
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
            const ladderSelect = document.getElementById('set-elo-ladder');
            
            const username = usernameInput.value.trim();
            const elo = parseInt(eloInput.value);
            const ladder = ladderSelect.value;
            
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
                    
                    // Check permissions and show create button if authorized
                    checkArticlePermissions();
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
    
    // Create New Article button
    const createArticleBtn = document.getElementById('create-new-article-btn');
    if (createArticleBtn) {
        createArticleBtn.addEventListener('click', () => {
            openArticleModal();
        });
    }
    
    // Trophy form submit
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

// Check if user has permissions to create/edit articles
async function checkArticlePermissions() {
    const user = auth.currentUser;
    if (!user) return;
    
    try {
        // Check if user has permission to create articles
        if (isAdmin(user.email)) {
            const createBtn = document.getElementById('create-new-article-btn');
            if (createBtn) {
                createBtn.style.display = 'block';
            }
        } else {
            // Check for specific roles that can manage articles
            const userDocRef = doc(db, 'userProfiles', user.uid);
            const userSnapshot = await getDoc(userDocRef);
            
            if (userSnapshot.exists()) {
                const userData = userSnapshot.data();
                const role = userData.roleName?.toLowerCase();
                
                if (role === 'admin' || role === 'owner' || role === 'creative lead') {
                    const createBtn = document.getElementById('create-new-article-btn');
                    if (createBtn) {
                        createBtn.style.display = 'block';
                    }
                }
            }
        }
    } catch (error) {
        console.error("Error checking article permissions:", error);
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