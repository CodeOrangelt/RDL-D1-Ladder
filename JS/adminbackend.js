import { 
    collection, getDocs, query, orderBy, addDoc, deleteDoc, where, doc, getDoc,
    serverTimestamp, setDoc, updateDoc, writeBatch, limit, startAfter, endBefore,
    limitToLast, onSnapshot, deleteField, or, Timestamp, getCountFromServer
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { auth, db } from './firebase-config.js';
import { getRankStyle } from './ranks.js';
import { isAdmin, isAdminWithRoles } from './admin-check.js';

// ============================================================================
// HELPER FUNCTIONS - Consolidated utilities to reduce code duplication
// ============================================================================

/**
 * Get collection names based on the current ladder (D1, D2, or D3)
 * @param {string} ladder - The ladder to get collection names for (defaults to currentLadder)
 * @returns {Object} Object containing all collection names for the specified ladder
 */
function getCollectionNames(ladder = null) {
    const l = ladder || currentLadder;
    
    // Add FFA collections
    if (l === 'FFA') {
        return {
            players: 'playersFFA',
            approvedMatches: 'approvedMatchesFFA',
            pendingMatches: 'pendingMatchesFFA',
            eloHistory: 'eloHistoryFFA',
            rejected: 'RejectedFFA',
            playerRibbons: 'playerRibbonsFFA'
        };
    }

    if (l === 'D1') {
        return {
            players: 'players',
            approvedMatches: 'approvedMatches',
            pendingMatches: 'pendingMatches',
            eloHistory: 'eloHistory',
            rejected: 'RejectedD1',
            playerRibbons: 'playerRibbons'
        };
    }
    
    // For D2 and D3 - use the ladder suffix
    return {
        players: `players${l}`,
        approvedMatches: `approvedMatches${l}`,
        pendingMatches: `pendingMatches${l}`,
        eloHistory: `eloHistory${l}`,
        rejected: `Rejected${l}`,
        playerRibbons: `playerRibbons${l}`
    };
}

/**
 * Setup a load button with standard loading/error states
 * @param {string} buttonId - The ID of the button element
 * @param {Function} loadFunction - Async function to call on click
 * @param {string} defaultText - The default button text (with icon)
 */
function setupLoadButton(buttonId, loadFunction, defaultText) {
    const btn = document.getElementById(buttonId);
    if (!btn) return;
    
    // Remove any existing click handlers to prevent duplicates
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    
    newBtn.addEventListener('click', async function() {
        console.log(`${buttonId} clicked`);
        this.classList.add('loading');
        this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
        
        try {
            await loadFunction();
            this.classList.remove('loading');
            this.innerHTML = defaultText;
        } catch (error) {
            console.error(`Error loading data for ${buttonId}:`, error);
            this.classList.remove('loading');
            this.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Error';
            setTimeout(() => {
                this.innerHTML = defaultText;
            }, 3000);
        }
    });
}

/**
 * Open a modal by ID with optional setup callback
 * @param {string} modalId - The ID of the modal element
 * @param {Function} setupCallback - Optional callback to run before showing
 */
function openModal(modalId, setupCallback = null) {
    const modal = document.getElementById(modalId);
    if (!modal) {
        console.error(`Modal ${modalId} not found`);
        return;
    }
    if (setupCallback) setupCallback(modal);
    modal.classList.add('active');
    modal.style.display = 'flex';
}

/**
 * Close a modal by ID
 * @param {string} modalId - The ID of the modal element
 */
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
    }
}

/**
 * Set table loading/empty/error state
 * @param {string} tableBodyId - The ID of the table body element
 * @param {string} state - 'loading', 'empty', or 'error'
 * @param {number} colspan - Number of columns to span
 * @param {string} message - Optional custom message
 */
function setTableState(tableBodyId, state, colspan, message = null) {
    const tableBody = document.getElementById(tableBodyId);
    if (!tableBody) return;
    
    const stateClasses = { loading: 'loading-cell', empty: 'empty-state', error: 'error-state' };
    const defaultMessages = { loading: 'Loading...', empty: 'No data found', error: 'Error loading data' };
    
    tableBody.innerHTML = `<tr><td colspan="${colspan}" class="${stateClasses[state]}">${message || defaultMessages[state]}</td></tr>`;
}

/**
 * Generic table filter function
 * @param {string} tableBodyId - The ID of the table body element
 * @param {string} searchTerm - The search term to filter by
 * @param {string[]} columnSelectors - CSS selectors for columns to search in
 */
function filterTable(tableBodyId, searchTerm, columnSelectors) {
    const term = searchTerm.toLowerCase();
    document.querySelectorAll(`#${tableBodyId} tr`).forEach(row => {
        const matches = columnSelectors.some(selector => 
            row.querySelector(selector)?.textContent.toLowerCase().includes(term)
        );
        row.style.display = matches ? '' : 'none';
    });
}

// ============================================================================
// END HELPER FUNCTIONS
// ============================================================================

// At the top with other global variables
let matchesPagination = { 
    d1: { page: 1, lastVisible: null, firstVisible: null }, 
    d2: { page: 1, lastVisible: null, firstVisible: null },
    d3: { page: 1, lastVisible: null, firstVisible: null },
    ffa: { page: 1, lastVisible: null, firstVisible: null } // Add FFA
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
    d3: { page: 1, lastVisible: null, firstVisible: null },
    ffa: { page: 1, lastVisible: null, firstVisible: null } // Add FFA
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
            'admin': ['dashboard', 'manage-players', 'manage-matches', 'manage-articles', 'manage-trophies', 'manage-ranks', 'inactive-players', 'settings', 'manage-trophies', 'elo-history', 'manage-highlights', 'user-roles-section', 'manage-matches', 'manage-points', 'manage-levels-ribbons', 'manage-ribbons', 'manage-store-inventory'],
            'owner': ['dashboard', 'manage-players', 'manage-matches', 'manage-articles', 'manage-trophies', 'manage-ranks', 'inactive-players', 'settings', 'manage-trophies', 'elo-history', 'manage-highlights', 'user-roles-section', 'manage-matches', 'manage-points', 'manage-levels-ribbons', 'manage-ribbons', 'manage-store-inventory'],
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

        window.searchUsername = searchUsername;
        window.handleChangeUsername = handleChangeUsername;
        window.changeUsernameInWorkspace = changeUsernameInWorkspace;
        window.scanAndAwardTopRankRibbons = scanAndAwardTopRankRibbons;

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

        if (allowedTabs.includes('manage-ribbons')) {
            setupManageRibbonsSection();
        }

        if (allowedTabs.includes('manage-store-inventory')) {
            setupManageStoreInventorySection();
        }

        setupDataLoadButtons(allowedTabs);

    } catch (error) {
        console.error("Error initializing admin dashboard:", error);
    }
}

// Add this function BEFORE setupDataLoadButtons (around line 450)

// Add flag to prevent concurrent loads
let isLoadingPlayers = false;

async function loadPlayersData() {
    // Prevent concurrent calls
    if (isLoadingPlayers) {
        console.log('Players already loading, skipping duplicate call');
        return;
    }
    
    const playerTable = document.getElementById('players-table-body');
    if (!playerTable) return;
    
    isLoadingPlayers = true;
    console.log('=== START loadPlayersData ===');
    
    setTableState('players-table-body', 'loading', 6, 'Loading players...');
    
    try {
        const { players: playerCollection } = getCollectionNames();
        const isFFA = currentLadder === 'FFA';
        
        console.log(`Loading players from ${playerCollection} collection...`);
        const playersRef = collection(db, playerCollection);
        const q = query(playersRef, orderBy('eloRating', 'desc'));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            playerTable.innerHTML = '<tr><td colspan="6" class="empty-state">No players found</td></tr>';
            isLoadingPlayers = false;
            return;
        }
        
        console.log(`Clearing table and adding ${querySnapshot.size} players...`);
        playerTable.innerHTML = '';
        let position = 1;
        
        querySnapshot.forEach(doc => {
            const player = doc.data();
            const row = document.createElement('tr');
            
            const rank = getRankFromElo(player.eloRating || 1200);
            const timestamp = player.createdAt 
                ? new Date(player.createdAt.seconds * 1000).toLocaleDateString() 
                : 'N/A';
            
            // Different stats display for FFA
            if (isFFA) {
                const matches = player.totalMatches || 0;
                const wins = player.firstPlaceWins || 0;
                const topThree = player.topThreeFinishes || 0;
                const avgPlace = player.averagePlacement ? player.averagePlacement.toFixed(2) : 'N/A';
                
                row.innerHTML = `
                    <td>${position}</td>
                    <td class="username">${player.username || 'Unknown'}</td>
                    <td><span class="rank-badge ${rank.toLowerCase()}">${rank}</span></td>
                    <td>${Math.round(player.eloRating || 1200)}</td>
                    <td>Matches: ${matches} | Wins: ${wins} | Top 3: ${topThree} | Avg: ${avgPlace}</td>
                    <td class="actions">
                        <button class="edit-btn" data-id="${doc.id}">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="delete-btn" data-id="${doc.id}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                `;
            } else {
                // Regular ladder display
                row.innerHTML = `
                    <td>${position}</td>
                    <td class="username">${player.username || 'Unknown'}</td>
                    <td><span class="rank-badge ${rank.toLowerCase()}">${rank}</span></td>
                    <td>${Math.round(player.eloRating || 1200)}</td>
                    <td>${player.wins || 0} - ${player.losses || 0}</td>
                    <td class="actions">
                        <button class="edit-btn" data-id="${doc.id}">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="delete-btn" data-id="${doc.id}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                `;
            }
            
            playerTable.appendChild(row);
            position++;
        });
        
        setupPlayerActionButtons();
        console.log(`=== END loadPlayersData: Added ${position - 1} players ===`);
        
    } catch (error) {
        console.error("Error loading players:", error);
        playerTable.innerHTML = `<tr><td colspan="6" class="error-state">Error loading players: ${error.message}</td></tr>`;
    } finally {
        isLoadingPlayers = false;
    }
}

// Refactored setupDataLoadButtons - uses setupLoadButton helper to eliminate duplicate code
function setupDataLoadButtons(allowedTabs = []) {
    // Default to showing dashboard only if no permissions provided
    if (!allowedTabs || allowedTabs.length === 0) {
        allowedTabs = ['dashboard'];
    }
    
    // Dashboard load button - always available since dashboard is the minimum
    setupLoadButton('load-dashboard-data', loadDashboardOverview, '<i class="fas fa-sync-alt"></i> Load Dashboard Data');
    
    // Define button configurations: [buttonId, permission, loadFunction, buttonText]
    const buttonConfigs = [
        ['load-trophies-data', 'manage-trophies', loadTrophyDefinitions, '<i class="fas fa-sync-alt"></i> Load Trophies Data'],
        ['load-players-data', 'manage-players', loadPlayersData, '<i class="fas fa-sync-alt"></i> Load Players Data'],
        ['load-elo-history-data', 'elo-history', () => loadEloHistory(1), '<i class="fas fa-sync-alt"></i> Load History Data'],
        ['load-articles-data', 'manage-articles', loadArticles, '<i class="fas fa-sync-alt"></i> Load Articles Data'],
        ['load-users-data', 'user-roles-section', loadUsersWithRoles, '<i class="fas fa-sync-alt"></i> Load Users Data'],
        ['load-inactive-players-data', 'inactive-players', loadInactivePlayersData, '<i class="fas fa-sync-alt"></i> Load Inactive Players'],
        ['load-highlights-data', 'manage-highlights', loadHighlightsAdmin, '<i class="fas fa-sync-alt"></i> Load Highlights'],
        ['load-matches-data', 'manage-matches', () => loadMatchesData(1), '<i class="fas fa-sync-alt"></i> Load Matches'],
        ['load-ribbons-data', 'manage-ribbons', loadRibbonsData, '<i class="fas fa-sync-alt"></i> Load Ribbons Data']
    ];
    
    // Setup each button if user has permission
    buttonConfigs.forEach(([buttonId, permission, loadFn, buttonText]) => {
        if (allowedTabs.includes(permission)) {
            setupLoadButton(buttonId, loadFn, buttonText);
        }
    });
    
    // Special setup for matches section
    if (allowedTabs.includes('manage-matches')) {
        setupCreateTestMatchButton();
        setupCreateTestMatchModal();
    }
    
    console.log('Data load buttons initialized based on permissions');
}


// Add new setupDashboardSection function 
function setupDashboardSection() {
    // Set placeholders
    const statElements = ['player-count', 'match-count', 'pending-count', 'rejected-count'];
    statElements.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '-';
    });
    
    // Setup refresh button (remove existing listener first to prevent duplicates)
    const refreshBtn = document.getElementById('refresh-dashboard-btn');
    if (refreshBtn) {
        // Clone and replace to remove all existing listeners
        const newRefreshBtn = refreshBtn.cloneNode(true);
        refreshBtn.parentNode.replaceChild(newRefreshBtn, refreshBtn);
        newRefreshBtn.addEventListener('click', () => loadDashboardOverview(true));
    }
    
    console.log('Dashboard section initialized');
}

function setupLadderSelector() {
    const ladderSwitches = document.querySelectorAll('.ladder-switch input');
    
    ladderSwitches.forEach(switchInput => {
        switchInput.addEventListener('change', () => {
            if (switchInput.checked) {
                currentLadder = switchInput.value; // 'D1', 'D2', 'D3', or 'FFA'
                document.body.dataset.ladder = currentLadder;
                
                // Clear dashboard cache when switching ladders
                clearDashboardCache();
                
                const currentLadderDisplay = document.getElementById('current-ladder-display');
                if (currentLadderDisplay) {
                    currentLadderDisplay.textContent = currentLadder;
                }
                
                console.log(`Switched to ${currentLadder} ladder`);
            }
        });
    });
    
    const currentLadderDisplay = document.getElementById('current-ladder-display');
    if (currentLadderDisplay) {
        currentLadderDisplay.textContent = currentLadder;
    }
}

/**
 * Set dashboard loading state
 */
function setDashboardLoadingState() {
    document.getElementById('player-count').textContent = '-';
    document.getElementById('match-count').textContent = '-';
    document.getElementById('pending-count').textContent = '-';
    document.getElementById('rejected-count').textContent = '-';
}

/**
 * Set dashboard error state
 */
function setDashboardErrorState(error) {
    console.error('Dashboard error:', error);
    document.getElementById('player-count').textContent = 'Error';
    document.getElementById('match-count').textContent = 'Error';
    document.getElementById('pending-count').textContent = 'Error';
    document.getElementById('rejected-count').textContent = 'Error';
}

// ============================================================================
// DASHBOARD OVERVIEW - COMPLETELY REWRITTEN
// ============================================================================

let dashboardRankChart = null;
let dashboardActivityChart = null;
let dashboardIsLoading = false;
let dashboardCache = { data: null, timestamp: null, ttl: 300000 };

async function loadDashboardOverview(forceRefresh = false) {
    if (dashboardIsLoading) {
        console.log('🛑 Dashboard load already in progress - BLOCKED');
        return;
    }

    dashboardIsLoading = true;
    console.log('🔄 Dashboard load started');

    try {
        // Check cache
        if (!forceRefresh && dashboardCache.data && (Date.now() - dashboardCache.timestamp) < dashboardCache.ttl) {
            console.log('📦 Using cached dashboard data');
            updateDashboardStats(dashboardCache.data);
            await rebuildDashboardCharts();
            return;
        }

        // Show loading
        ['player-count', 'match-count', 'pending-count', 'rejected-count'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '⏳';
        });

        // Fetch data
        const collections = getCollectionNames();
        const counts = await Promise.all([
            getCountFromServer(collection(db, collections.players)),
            getCountFromServer(collection(db, collections.approvedMatches)),
            getCountFromServer(collection(db, collections.pendingMatches)),
            currentLadder !== 'FFA' ? getCountFromServer(collection(db, collections.rejected)) : Promise.resolve({ data: () => ({ count: 0 }) })
        ]);

        const data = {
            playerCount: counts[0].data().count,
            matchCount: counts[1].data().count,
            pendingCount: counts[2].data().count,
            rejectedCount: counts[3].data().count
        };

        // Cache it
        dashboardCache.data = data;
        dashboardCache.timestamp = Date.now();

        // Update UI
        updateDashboardStats(data);
        await rebuildDashboardCharts();

        console.log('✅ Dashboard loaded successfully');

    } catch (error) {
        console.error('❌ Dashboard load error:', error);
        ['player-count', 'match-count', 'pending-count', 'rejected-count'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '❌';
        });
    } finally {
        dashboardIsLoading = false;
        console.log('🏁 Dashboard load finished');
    }
}

function updateDashboardStats(data) {
    document.getElementById('player-count').textContent = data.playerCount;
    document.getElementById('match-count').textContent = data.matchCount;
    document.getElementById('pending-count').textContent = data.pendingCount;
    document.getElementById('rejected-count').textContent = data.rejectedCount;
}

async function rebuildDashboardCharts() {
    console.log('📊 Rebuilding charts...');
    
    // DESTROY old charts completely
    if (dashboardRankChart) {
        dashboardRankChart.destroy();
        dashboardRankChart = null;
        console.log('🗑️ Rank chart destroyed');
    }
    
    if (dashboardActivityChart) {
        dashboardActivityChart.destroy();
        dashboardActivityChart = null;
        console.log('🗑️ Activity chart destroyed');
    }

    // Build new charts
    try {
        await buildRankChart();
        await buildActivityChart();
        console.log('✅ Charts rebuilt');
    } catch (error) {
        console.error('❌ Chart build error:', error);
    }
}

async function buildRankChart() {
    const { players: playerCollection } = getCollectionNames();
    const snapshot = await getDocs(collection(db, playerCollection));
    
    const isFFA = currentLadder === 'FFA';
    let chartData, chartLabels, chartColors;
    
    if (isFFA) {
        // FFA: Show ELO ranges instead of ranks
        const eloRanges = {
            '1700+': 0,
            '1500-1699': 0,
            '1300-1499': 0,
            '1200-1299': 0,
            '<1200': 0
        };
        
        snapshot.forEach(doc => {
            const elo = doc.data().eloRating || 1200;
            if (elo >= 1700) eloRanges['1700+']++;
            else if (elo >= 1500) eloRanges['1500-1699']++;
            else if (elo >= 1300) eloRanges['1300-1499']++;
            else if (elo >= 1200) eloRanges['1200-1299']++;
            else eloRanges['<1200']++;
        });
        
        chartLabels = Object.keys(eloRanges);
        chartData = Object.values(eloRanges);
        chartColors = ['#50C878', '#FFD700', '#C0C0C0', '#CD7F32', '#808080'];
    } else {
        // D1/D2/D3: Show actual rank tiers from player data
        const rankCounts = { 'Unranked': 0, 'Bronze': 0, 'Silver': 0, 'Gold': 0, 'Emerald': 0 };
        
        snapshot.forEach(doc => {
            const player = doc.data();
            const elo = player.eloRating || 1200;
            const matches = player.matches || player.totalMatches || 0;
            const wins = player.wins || 0;
            const winRate = matches > 0 ? (wins / matches) * 100 : 0;
            
            // Use getRankFromElo but with additional context
            let rank = getRankFromElo(elo);
            
            // Additional logic for Emerald rank (needs high win rate)
            if (rank === 'Emerald' && (matches < 20 || winRate < 80)) {
                rank = 'Gold';
            }
            
            rankCounts[rank]++;
        });
        
        chartLabels = Object.keys(rankCounts);
        chartData = Object.values(rankCounts);
        chartColors = ['#808080', '#CD7F32', '#C0C0C0', '#FFD700', '#50C878'];
    }

    const canvas = document.getElementById('rank-distribution-chart');
    if (!canvas) {
        console.error('❌ Rank chart canvas not found');
        return;
    }

    const title = isFFA ? `${currentLadder} ELO Distribution` : `${currentLadder} Rank Distribution`;

    dashboardRankChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: chartLabels,
            datasets: [{
                data: chartData,
                backgroundColor: chartColors,
                borderWidth: 2,
                borderColor: '#1a1a1a'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 1.5,
            plugins: {
                legend: { 
                    position: 'right', 
                    labels: { 
                        color: '#e0e0e0',
                        font: { size: 13 },
                        padding: 12
                    } 
                },
                title: { 
                    display: true, 
                    text: title, 
                    color: '#e0e0e0', 
                    font: { size: 16, weight: 'bold' },
                    padding: { top: 10, bottom: 20 }
                }
            }
        }
    });
    console.log('✅ Rank chart created');
}

async function buildActivityChart() {
    const { approvedMatches: matchesCollection } = getCollectionNames();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const snapshot = await getDocs(query(
        collection(db, matchesCollection),
        where('approvedAt', '>=', Timestamp.fromDate(sevenDaysAgo)),
        orderBy('approvedAt', 'asc')
    ));

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const activityByDay = dayNames.reduce((acc, day) => ({ ...acc, [day]: 0 }), {});
    
    let totalMatches = 0;
    let peakDay = '';
    let peakCount = 0;
    
    snapshot.forEach(doc => {
        const match = doc.data();
        if (match.approvedAt) {
            const dayName = dayNames[match.approvedAt.toDate().getDay()];
            activityByDay[dayName]++;
            totalMatches++;
            
            if (activityByDay[dayName] > peakCount) {
                peakCount = activityByDay[dayName];
                peakDay = dayName;
            }
        }
    });

    const canvas = document.getElementById('activity-chart');
    if (!canvas) {
        console.error('❌ Activity chart canvas not found');
        return;
    }

    const colors = {
        'D1': { bg: 'rgba(211, 47, 47, 0.7)', border: '#d32f2f' },
        'D2': { bg: 'rgba(25, 118, 210, 0.7)', border: '#1976d2' },
        'D3': { bg: 'rgba(76, 175, 80, 0.7)', border: '#4caf50' },
        'FFA': { bg: 'rgba(255, 87, 34, 0.7)', border: '#ff5722' }
    }[currentLadder] || { bg: 'rgba(211, 47, 47, 0.7)', border: '#d32f2f' };

    const subtitle = totalMatches > 0 
        ? `${totalMatches} matches | Peak: ${peakDay} (${peakCount})`
        : 'No matches this week';

    dashboardActivityChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: dayNames,
            datasets: [{
                label: currentLadder === 'FFA' ? 'FFA Matches' : 'Matches Played',
                data: dayNames.map(day => activityByDay[day]),
                backgroundColor: colors.bg,
                borderColor: colors.border,
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2,
            scales: {
                y: { 
                    beginAtZero: true, 
                    ticks: { 
                        color: '#e0e0e0', 
                        stepSize: 1,
                        font: { size: 12 }
                    }, 
                    grid: { color: 'rgba(255, 255, 255, 0.1)' }
                },
                x: { 
                    ticks: { 
                        color: '#e0e0e0',
                        font: { size: 12 }
                    }, 
                    grid: { color: 'rgba(255, 255, 255, 0.1)' }
                }
            },
            plugins: {
                legend: { 
                    display: false
                },
                title: { 
                    display: true, 
                    text: [`${currentLadder} Weekly Activity`, subtitle],
                    color: '#e0e0e0', 
                    font: { size: 16, weight: 'bold' },
                    padding: { top: 10, bottom: 20 }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const matches = context.parsed.y;
                            const percentage = totalMatches > 0 ? ((matches / totalMatches) * 100).toFixed(1) : 0;
                            return `${matches} matches (${percentage}% of week)`;
                        }
                    }
                }
            }
        }
    });
    console.log('✅ Activity chart created');
}

function clearDashboardCache() {
    dashboardCache = { data: null, timestamp: null, ttl: 300000 };
    if (dashboardRankChart) { dashboardRankChart.destroy(); dashboardRankChart = null; }
    if (dashboardActivityChart) { dashboardActivityChart.destroy(); dashboardActivityChart = null; }
    dashboardIsLoading = false;
    console.log('🧹 Dashboard cache cleared');
}

// ============================================================================
// END DASHBOARD OVERVIEW
// ============================================================================

function getRankFromElo(elo, matchCount = 0, winRate = 0) {
    // D1 rank thresholds based on actual ladder system
    if (matchCount === 0) return 'Unranked';
    
    // 5+ matches rule: minimum Bronze rank
    if (matchCount >= 5 && elo < 200) return 'Bronze';
    
    if (elo >= 1000 && winRate >= 80 && matchCount >= 20) return 'Emerald';
    if (elo >= 700) return 'Gold';
    if (elo >= 500) return 'Silver';
    if (elo >= 200) return 'Bronze';
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
        const { players: playerCollection } = getCollectionNames();
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
        const { players: playerCollection, eloHistory: historyCollection } = getCollectionNames();
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
            const { players: playerCollection } = getCollectionNames();
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
        const elo = parseInt(eloInput.value) || 200;
        
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
    const ladderPrefix = currentLadder.toLowerCase(); // d1, d2, d3, or ffa
    
    if (!historyTable) return;
    
    setTableState('elo-history-table-body', 'loading', 7, 'Loading history...');
    
    try {
        // Get collection name from helper
        const { eloHistory: historyCollection } = getCollectionNames();
        
        const historyRef = collection(db, historyCollection);
        
        let q;
        
        if (page > eloHistoryPagination[ladderPrefix].page && eloHistoryPagination[ladderPrefix].lastVisible) {
            q = query(
                historyRef,
                orderBy('timestamp', 'desc'),
                startAfter(eloHistoryPagination[ladderPrefix].lastVisible),
                limit(PAGE_SIZE)
            );
        } else if (page < eloHistoryPagination[ladderPrefix].page && eloHistoryPagination[ladderPrefix].firstVisible) {
            q = query(
                historyRef,
                orderBy('timestamp', 'desc'),
                endBefore(eloHistoryPagination[ladderPrefix].firstVisible),
                limitToLast(PAGE_SIZE)
            );
        } else {
            q = query(
                historyRef,
                orderBy('timestamp', 'desc'),
                limit(PAGE_SIZE)
            );
        }
        
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            historyTable.innerHTML = '<tr><td colspan="7" class="empty-state">No history records found</td></tr>';
            return;
        }
        
        // Update pagination controls
        eloHistoryPagination[ladderPrefix].page = page;
        eloHistoryPagination[ladderPrefix].firstVisible = querySnapshot.docs[0];
        eloHistoryPagination[ladderPrefix].lastVisible = querySnapshot.docs[querySnapshot.docs.length - 1];
        
        historyTable.innerHTML = '';
        
        querySnapshot.forEach(doc => {
            const history = doc.data();
            const row = document.createElement('tr');
            
            const date = history.timestamp?.toDate?.() 
                ? history.timestamp.toDate().toLocaleString() 
                : 'N/A';
            
            const player = history.player || history.username || 'Unknown';
            const previousElo = Math.round(history.previousElo || 0);
            const newElo = Math.round(history.newElo || 0);
            const change = newElo - previousElo;
            const changeClass = change > 0 ? 'positive' : change < 0 ? 'negative' : '';
            const changeSymbol = change > 0 ? '+' : '';
            
            // Format type based on ladder
            let type = formatHistoryType(history.type);
            if (currentLadder === 'FFA' && history.placement) {
                type += ` (${history.placement}${getOrdinalSuffix(history.placement)})`;
            }
            
            row.innerHTML = `
                <td>${date}</td>
                <td>${player}</td>
                <td>${previousElo}</td>
                <td>${newElo}</td>
                <td class="${changeClass}">${changeSymbol}${change}</td>
                <td>${type}</td>
                <td>${history.modifiedBy || history.placedBy || history.adminEmail || 'System'}</td>
            `;
            
            historyTable.appendChild(row);
        });
        
        // Update pagination button states
        updateHistoryPaginationButtons(page, querySnapshot.docs.length);
        
    } catch (error) {
        console.error("Error loading ELO history:", error);
        setTableState('elo-history-table-body', 'error', 7, error.message);
    }
}

// Helper function for ordinal suffix
function getOrdinalSuffix(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Update pagination buttons
function updateHistoryPaginationButtons(currentPage, resultCount) {
    const ladderPrefix = currentLadder.toLowerCase();
    
    const prevBtn = document.getElementById(`${ladderPrefix}-prev-page`);
    const nextBtn = document.getElementById(`${ladderPrefix}-next-page`);
    
    if (prevBtn) {
        prevBtn.disabled = currentPage === 1;
    }
    
    if (nextBtn) {
        nextBtn.disabled = resultCount < PAGE_SIZE;
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
    // D1 pagination buttons
    document.getElementById('d1-prev-page')?.addEventListener('click', () => {
        if (currentLadder === 'D1') loadEloHistory(eloHistoryPagination.d1.page - 1);
    });
    
    document.getElementById('d1-next-page')?.addEventListener('click', () => {
        if (currentLadder === 'D1') loadEloHistory(eloHistoryPagination.d1.page + 1);
    });
    
    // D2 pagination buttons
    document.getElementById('d2-prev-page')?.addEventListener('click', () => {
        if (currentLadder === 'D2') loadEloHistory(eloHistoryPagination.d2.page - 1);
    });
    
    document.getElementById('d2-next-page')?.addEventListener('click', () => {
        if (currentLadder === 'D2') loadEloHistory(eloHistoryPagination.d2.page + 1);
    });
    
    // D3 pagination buttons
    document.getElementById('d3-prev-page')?.addEventListener('click', () => {
        if (currentLadder === 'D3') loadEloHistory(eloHistoryPagination.d3.page - 1);
    });
    
    document.getElementById('d3-next-page')?.addEventListener('click', () => {
        if (currentLadder === 'D3') loadEloHistory(eloHistoryPagination.d3.page + 1);
    });
    
    // FFA pagination buttons
    document.getElementById('ffa-prev-page')?.addEventListener('click', () => {
        if (currentLadder === 'FFA') loadEloHistory(eloHistoryPagination.ffa.page - 1);
    });
    
    document.getElementById('ffa-next-page')?.addEventListener('click', () => {
        if (currentLadder === 'FFA') loadEloHistory(eloHistoryPagination.ffa.page + 1);
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
        const { eloHistory: historyCollection } = getCollectionNames();
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
    const modal = document.getElementById('rank-manager-modal');
    const openBtn = document.getElementById('open-rank-manager-btn');
    const closeBtn = document.getElementById('close-rank-manager');
    
    if (!modal || !openBtn) {
        console.warn('Rank manager elements not found');
        return;
    }
    
    // Setup each tab's functionality first
    const reloadPromotePlayers = setupPromoteTab();
    const reloadDemotePlayers = setupDemoteTab();
    const reloadSetEloPlayers = setupSetEloTab();
    
    // Open modal and load initial data
    openBtn.addEventListener('click', () => {
        modal.classList.add('active');
        // Wait for modal to render before loading players
        setTimeout(() => {
            reloadPromotePlayers();
        }, 100);
    });
    
    // Close modal handlers
    const closeModal = () => {
        modal.classList.remove('active');
        // Clear all forms
        document.getElementById('promote-form')?.reset();
        document.getElementById('demote-form')?.reset();
        document.getElementById('set-elo-form-new')?.reset();
        // Hide info boxes
        document.getElementById('promote-player-info').style.display = 'none';
        document.getElementById('demote-player-info').style.display = 'none';
        document.getElementById('setelo-player-info').style.display = 'none';
    };
    
    if (closeBtn) {
        closeBtn.addEventListener('click', closeModal);
    }
    
    // Close on outside click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });
    
    // Tab switching with player reload
    const tabButtons = modal.querySelectorAll('.tab-button');
    const tabPanels = modal.querySelectorAll('.tab-panel');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.dataset.tab;
            
            // Update active states
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabPanels.forEach(panel => panel.classList.remove('active'));
            
            button.classList.add('active');
            const targetPanel = modal.querySelector(`[data-panel="${targetTab}"]`);
            if (targetPanel) {
                targetPanel.classList.add('active');
            }
            
            // Load players for the switched tab
            if (targetTab === 'promote') {
                setTimeout(() => reloadPromotePlayers(), 50);
            } else if (targetTab === 'demote') {
                setTimeout(() => reloadDemotePlayers(), 50);
            } else if (targetTab === 'set-elo') {
                setTimeout(() => reloadSetEloPlayers(), 50);
            }
        });
    });
    
    // Setup cancel buttons
    document.getElementById('cancel-promote')?.addEventListener('click', closeModal);
    document.getElementById('cancel-demote')?.addEventListener('click', closeModal);
    document.getElementById('cancel-setelo')?.addEventListener('click', closeModal);
}

// Helper function to get rank thresholds based on ladder
function getRankThresholds(ladder) {
    if (ladder === 'D1') {
        return [
            { name: 'Unranked', min: 0, max: 199 },
            { name: 'Bronze', min: 200, max: 499 },
            { name: 'Silver', min: 500, max: 699 },
            { name: 'Gold', min: 700, max: 999 },
            { name: 'Emerald', min: 1000, max: Infinity }
        ];
    } else {
        // D2, D3, FFA use standard thresholds
        return [
            { name: 'Unranked', min: 0, max: 1399 },
            { name: 'Bronze', min: 1400, max: 1599 },
            { name: 'Silver', min: 1600, max: 1799 },
            { name: 'Gold', min: 1800, max: 1999 },
            { name: 'Emerald', min: 2000, max: Infinity }
        ];
    }
}

// Helper to determine rank from ELO
function getRankFromEloValue(elo, ladder) {
    const thresholds = getRankThresholds(ladder);
    for (const threshold of thresholds) {
        if (elo >= threshold.min && elo <= threshold.max) {
            return threshold.name;
        }
    }
    return 'Unranked';
}

// Helper to fetch player data
async function fetchPlayerData(username, ladder) {
    try {
        const { players: collectionName } = getCollectionNames(ladder);
        const playersRef = collection(db, collectionName);
        const q = query(playersRef, where('username', '==', username));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            return null;
        }
        
        const playerDoc = querySnapshot.docs[0];
        return {
            id: playerDoc.id,
            data: playerDoc.data()
        };
    } catch (error) {
        console.error('Error fetching player:', error);
        throw error;
    }
}

// Helper function to load players for a dropdown
async function loadPlayersForDropdown(ladder, dropdownId) {
    console.log(`Loading players for dropdown ${dropdownId} with ladder ${ladder}`);
    const dropdown = document.getElementById(dropdownId);
    
    if (!dropdown) {
        console.error(`Dropdown element not found: ${dropdownId}`);
        console.log('Available elements:', document.querySelectorAll('select[id*="username"]'));
        return;
    }
    
    console.log('Dropdown element found:', dropdown);
    console.log('Dropdown current HTML before:', dropdown.innerHTML);
    
    try {
        dropdown.innerHTML = '<option value="">Loading players...</option>';
        
        const { players: collectionName } = getCollectionNames(ladder);
        console.log(`Using collection: ${collectionName}`);
        
        const playersRef = collection(db, collectionName);
        const querySnapshot = await getDocs(playersRef);
        
        console.log(`Found ${querySnapshot.size} players in ${collectionName}`);
        
        if (querySnapshot.empty) {
            dropdown.innerHTML = '<option value="">No players found</option>';
            return;
        }
        
        // Build array and sort client-side
        const players = [];
        querySnapshot.forEach(doc => {
            const data = doc.data();
            if (data.username) {
                const elo = data.eloRating || 0;
                const rank = getRankFromEloValue(elo, ladder);
                players.push({
                    username: data.username,
                    elo: elo,
                    rank: rank
                });
            }
        });
        
        console.log(`Processed ${players.length} valid players`);
        
        // Sort alphabetically
        players.sort((a, b) => a.username.localeCompare(b.username));
        
        // Build options
        const options = ['<option value="">-- Select a player --</option>'];
        players.forEach(player => {
            options.push(`<option value="${player.username}">${player.username} (${player.rank} - ${player.elo} ELO)</option>`);
        });
        
        const htmlContent = options.join('');
        console.log('Setting dropdown innerHTML, first 200 chars:', htmlContent.substring(0, 200));
        dropdown.innerHTML = htmlContent;
        console.log('Dropdown HTML after update:', dropdown.innerHTML.substring(0, 200));
        console.log(`Successfully loaded ${players.length} players into ${dropdownId}`);
    } catch (error) {
        console.error('Error loading players:', error);
        dropdown.innerHTML = `<option value="">Error: ${error.message}</option>`;
        showNotification(`Failed to load players: ${error.message}`, 'error');
    }
}

// Setup Promote Tab
function setupPromoteTab() {
    const form = document.getElementById('promote-form');
    const usernameSelect = document.getElementById('promote-username');
    const ladderSelect = document.getElementById('promote-ladder');
    const infoBox = document.getElementById('promote-player-info');
    
    if (!form) return () => {};
    
    // Load players on ladder change
    const loadPlayers = () => loadPlayersForDropdown(ladderSelect.value, 'promote-username');
    ladderSelect.addEventListener('change', loadPlayers);
    
    // Update player info when selection changes
    usernameSelect.addEventListener('change', async () => {
        const username = usernameSelect.value;
        const ladder = ladderSelect.value;
        
        if (!username) {
            infoBox.style.display = 'none';
            return;
        }
        
        try {
            const player = await fetchPlayerData(username, ladder);
            if (player) {
                const currentElo = player.data.eloRating || 0;
                const currentRank = getRankFromEloValue(currentElo, ladder);
                const thresholds = getRankThresholds(ladder);
                
                // Find next rank threshold
                let nextElo = currentElo;
                let newRank = currentRank;
                for (const threshold of thresholds) {
                    if (currentElo < threshold.min) {
                        nextElo = threshold.min;
                        newRank = threshold.name;
                        break;
                    }
                }
                
                // Update display
                document.getElementById('promote-current-elo').textContent = currentElo;
                document.getElementById('promote-current-rank').textContent = currentRank;
                document.getElementById('promote-current-rank').className = `value rank-badge ${currentRank}`;
                document.getElementById('promote-new-elo').textContent = nextElo;
                document.getElementById('promote-new-rank').textContent = newRank;
                document.getElementById('promote-new-rank').className = `value rank-badge highlight ${newRank}`;
                
                infoBox.style.display = 'block';
            } else {
                infoBox.style.display = 'none';
            }
        } catch (error) {
            console.error('Error looking up player:', error);
        }
    });
    
    // Form submission
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = usernameSelect.value;
        const ladder = ladderSelect.value;
        
        if (!username) {
            showNotification('Please select a player', 'error');
            return;
        }
        
        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Promoting...';
        
        try {
            await promotePlayer(username, ladder);
            showNotification(`Successfully promoted ${username}`, 'success');
            form.reset();
            infoBox.style.display = 'none';
            await loadPlayers(); // Reload the list
        } catch (error) {
            showNotification(error.message, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-arrow-up"></i> Promote Player';
        }
    });
    
    return loadPlayers;
}

// Setup Demote Tab
function setupDemoteTab() {
    const form = document.getElementById('demote-form');
    const usernameSelect = document.getElementById('demote-username');
    const ladderSelect = document.getElementById('demote-ladder');
    const infoBox = document.getElementById('demote-player-info');
    
    if (!form) return () => {};
    
    // Load players on ladder change
    const loadPlayers = () => loadPlayersForDropdown(ladderSelect.value, 'demote-username');
    ladderSelect.addEventListener('change', loadPlayers);
    
    // Update player info when selection changes
    usernameSelect.addEventListener('change', async () => {
        const username = usernameSelect.value;
        const ladder = ladderSelect.value;
        
        if (!username) {
            infoBox.style.display = 'none';
            return;
        }
        
        try {
            const player = await fetchPlayerData(username, ladder);
            if (player) {
                const currentElo = player.data.eloRating || 0;
                const currentRank = getRankFromEloValue(currentElo, ladder);
                const thresholds = getRankThresholds(ladder);
                
                // Find previous rank threshold
                let nextElo = currentElo;
                let newRank = currentRank;
                for (let i = thresholds.length - 1; i >= 0; i--) {
                    if (currentElo > thresholds[i].max) {
                        nextElo = thresholds[i].max;
                        newRank = thresholds[i].name;
                        break;
                    }
                }
                
                // Update display
                document.getElementById('demote-current-elo').textContent = currentElo;
                document.getElementById('demote-current-rank').textContent = currentRank;
                document.getElementById('demote-current-rank').className = `value rank-badge ${currentRank}`;
                document.getElementById('demote-new-elo').textContent = nextElo;
                document.getElementById('demote-new-rank').textContent = newRank;
                document.getElementById('demote-new-rank').className = `value rank-badge highlight ${newRank}`;
                
                infoBox.style.display = 'block';
            } else {
                infoBox.style.display = 'none';
            }
        } catch (error) {
            console.error('Error looking up player:', error);
        }
    });
    
    // Form submission
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = usernameSelect.value;
        const ladder = ladderSelect.value;
        
        if (!username) {
            showNotification('Please select a player', 'error');
            return;
        }
        
        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Demoting...';
        
        try {
            await demotePlayer(username, ladder);
            showNotification(`Successfully demoted ${username}`, 'success');
            form.reset();
            infoBox.style.display = 'none';
            await loadPlayers(); // Reload the list
        } catch (error) {
            showNotification(error.message, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-arrow-down"></i> Demote Player';
        }
    });
    
    return loadPlayers;
}

// Setup Set ELO Tab
function setupSetEloTab() {
    const form = document.getElementById('set-elo-form-new');
    const usernameSelect = document.getElementById('setelo-username');
    const ladderSelect = document.getElementById('setelo-ladder');
    const eloInput = document.getElementById('setelo-value');
    const infoBox = document.getElementById('setelo-player-info');
    
    if (!form) return () => {};
    
    // Load players on ladder change
    const loadPlayers = () => loadPlayersForDropdown(ladderSelect.value, 'setelo-username');
    ladderSelect.addEventListener('change', loadPlayers);
    
    // Update player info when selection or ELO changes
    const updatePlayerInfo = async () => {
        const username = usernameSelect.value;
        const ladder = ladderSelect.value;
        const newElo = parseInt(eloInput.value);
        
        if (!username) {
            infoBox.style.display = 'none';
            return;
        }
        
        try {
            const player = await fetchPlayerData(username, ladder);
            if (player) {
                const currentElo = player.data.eloRating || 0;
                const currentRank = getRankFromEloValue(currentElo, ladder);
                const newRank = !isNaN(newElo) ? getRankFromEloValue(newElo, ladder) : '-';
                
                // Update display
                document.getElementById('setelo-current-elo').textContent = currentElo;
                document.getElementById('setelo-current-rank').textContent = currentRank;
                document.getElementById('setelo-current-rank').className = `value rank-badge ${currentRank}`;
                document.getElementById('setelo-new-rank').textContent = newRank;
                document.getElementById('setelo-new-rank').className = `value rank-badge highlight ${newRank}`;
                
                infoBox.style.display = 'block';
            } else {
                infoBox.style.display = 'none';
            }
        } catch (error) {
            console.error('Error looking up player:', error);
        }
    };
    
    usernameSelect.addEventListener('change', updatePlayerInfo);
    eloInput.addEventListener('input', updatePlayerInfo);
    
    // Form submission
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = usernameSelect.value;
        const ladder = ladderSelect.value;
        const elo = parseInt(eloInput.value);
        
        if (!username || isNaN(elo)) {
            showNotification('Please select a player and enter valid ELO', 'error');
            return;
        }
        
        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Setting ELO...';
        
        try {
            await setCustomElo(username, elo, ladder);
            showNotification(`Successfully set ${username}'s ELO to ${elo}`, 'success');
            form.reset();
            infoBox.style.display = 'none';
            await loadPlayers(); // Reload the list
        } catch (error) {
            showNotification(error.message, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-save"></i> Set Custom ELO';
        }
    });
    
    return loadPlayers;
}

// Consolidated function for both promotion and demotion
async function changePlayerRank(username, ladder, direction = 'promote') {
    const isPromotion = direction === 'promote';
    const actionName = isPromotion ? 'promote' : 'demote';
    const actionPastTense = isPromotion ? 'promoted' : 'demoted';
    
    try {
        console.log(`Attempting to ${actionName} ${username} in ${ladder} ladder`);
        
        // Check if current user is admin
        const user = auth.currentUser;
        if (!user) {
            throw new Error('You must be logged in to perform this action');
        }
        
        // Determine which collection to use
        const { players: collectionName, eloHistory: historyCollection } = getCollectionNames(ladder);
        
        // Get player data
        console.log(`Searching for player in ${collectionName}`);
        const playersRef = collection(db, collectionName);
        const q = query(playersRef, where('username', '==', username));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            throw new Error(`Player not found in ${ladder} ladder`);
        }

        const playerDoc = querySnapshot.docs[0];
        const playerData = playerDoc.data();
        const currentElo = playerData.eloRating || (ladder === 'D1' ? 0 : 1200);
        const playerId = playerDoc.id;
        
        console.log(`Found player with current ELO: ${currentElo}`);

        // Get ladder-specific thresholds
        const allThresholds = getRankThresholds(ladder);
        
        // Define ELO thresholds (ordered for promotion, find logic differs for demotion)
        const thresholds = isPromotion 
            ? allThresholds.filter(t => t.min > currentElo).map(t => ({ name: t.name, elo: t.min }))
            : allThresholds.filter(t => t.max < currentElo).reverse().map(t => ({ name: t.name, elo: t.max }));

        // Find target threshold based on direction
        const targetThreshold = thresholds[0];
        
        if (!targetThreshold) {
            const limitRank = isPromotion ? 'maximum rank (Emerald)' : 'minimum rank (Unranked)';
            throw new Error(`Player is already at ${limitRank} in ${ladder} ladder`);
        }
        
        console.log(`${isPromotion ? 'Promoting' : 'Demoting'} player to ${targetThreshold.name} (${targetThreshold.elo})`);
        
        // Update player document with direction-specific fields
        const updateFields = {
            eloRating: targetThreshold.elo,
            [isPromotion ? 'lastPromotedAt' : 'lastDemotedAt']: serverTimestamp(),
            [isPromotion ? 'promotedBy' : 'demotedBy']: user.email || 'admin'
        };
        await updateDoc(doc(db, collectionName, playerDoc.id), updateFields);

        // Add history entry
        const historyEntry = {
            player: username,
            previousElo: currentElo,
            newElo: targetThreshold.elo,
            timestamp: serverTimestamp(),
            type: isPromotion ? 'promotion' : 'demotion',
            rankAchieved: targetThreshold.name,
            [isPromotion ? 'promotedBy' : 'demotedBy']: user.email || 'admin',
            gameMode: ladder
        };
        await addDoc(collection(db, historyCollection), historyEntry);

        // Send Discord notification
        try {
            const { promotionManager } = await import('./promotions.js');
            const oldRank = getRankFromEloValue(currentElo, ladder);
            const newRank = targetThreshold.name;
            
            await promotionManager.sendPromotionNotification(
                playerId,
                username,
                currentElo,
                targetThreshold.elo,
                oldRank,
                newRank,
                isPromotion ? 'promotion' : 'demotion',
                {
                    displayName: username,
                    source: 'admin',
                    adminUser: user.email,
                    ladder: ladder
                }
            );
            console.log(`${isPromotion ? 'Promotion' : 'Demotion'} notification sent to Discord bot`);
        } catch (notificationError) {
            console.error('Failed to send Discord notification:', notificationError);
        }

        showNotification(`Successfully ${actionPastTense} ${username} to ${targetThreshold.name} (${targetThreshold.elo})`, 'success');
        
        if (typeof currentLadder !== 'undefined' && currentLadder === ladder) {
            if (typeof loadPlayersData === 'function') loadPlayersData();
            if (typeof loadEloHistory === 'function') loadEloHistory(1);
        }

        return true;
    } catch (error) {
        console.error(`Error ${actionName.replace('e', '')}ing player:`, error);
        throw error;
    }
}

// Wrapper functions for backward compatibility
const promotePlayer = (username, ladder) => changePlayerRank(username, ladder, 'promote');
const demotePlayer = (username, ladder) => changePlayerRank(username, ladder, 'demote');

async function setCustomElo(username, elo, ladder) {
    try {
        // Check if current user is admin
        const user = auth.currentUser;
        if (!user || !(await isAdminWithRoles(user))) {
            throw new Error('Unauthorized: Admin access required');
        }

        // Determine which collection to use
        const { players: collectionName, eloHistory: historyCollection } = getCollectionNames(ladder);

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

// Update setUserRole function to only update userProfiles collection

async function setUserRole(username, roleName, roleColor) {
    try {
        const user = auth.currentUser;
        if (!user || !(await isAdminWithRoles(user))) {
            throw new Error('Unauthorized: Admin access required');
        }

        // Normalize inputs
        const finalRoleName = roleName ? roleName.trim() : null;
        const finalRoleColor = finalRoleName ? (roleColor || '#808080') : null;

        // First, find the userId from player collections
        let userId = null;
        
        const collections = ['players', 'playersD2', 'playersD3', 'playersFFA', 'nonParticipants'];
        
        for (const collectionName of collections) {
            const snapshot = await getDocs(
                query(collection(db, collectionName), where('username', '==', username), limit(1))
            );
            
            if (!snapshot.empty) {
                userId = snapshot.docs[0].id;
                console.log(`Found userId ${userId} for ${username} in ${collectionName}`);
                break;
            }
        }

        // If not found in player collections, try userProfiles as fallback
        if (!userId) {
            const profileSnapshot = await getDocs(
                query(collection(db, 'userProfiles'), where('username', '==', username), limit(1))
            );
            
            if (!profileSnapshot.empty) {
                userId = profileSnapshot.docs[0].id;
                console.log(`Found userId ${userId} for ${username} in userProfiles`);
            }
        }

        if (!userId) {
            throw new Error(`User "${username}" not found in any collection. Cannot assign role.`);
        }

        // Now update the userProfiles document using the userId
        const profileRef = doc(db, 'userProfiles', userId);
        
        // Check if profile exists, create if it doesn't
        const profileDoc = await getDoc(profileRef);
        
        if (!profileDoc.exists()) {
            // Create a basic profile if it doesn't exist
            await setDoc(profileRef, {
                username: username,
                createdAt: serverTimestamp()
            });
            console.log(`Created new profile for ${username} (${userId})`);
        }
        
        console.log(`Updating role for ${username} in userProfiles (${userId})`);
        
        // Update only the userProfiles collection
        if (!finalRoleName) {
            await updateDoc(profileRef, {
                roleName: deleteField(),
                roleColor: deleteField(),
                roleAssignedBy: deleteField(),
                roleAssignedAt: deleteField()
            });
        } else {
            await updateDoc(profileRef, {
                roleName: finalRoleName,
                roleColor: finalRoleColor,
                roleAssignedBy: user.email,
                roleAssignedAt: serverTimestamp()
            });
        }

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
    
    // Set up form submission handler
    const roleForm = document.getElementById('set-role-form');
    if (roleForm) {
        roleForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const username = document.getElementById('role-username').value;
            const roleName = document.getElementById('role-name').value.trim();
            const roleColor = document.getElementById('role-color').value;
            
            if (!username) {
                showNotification('Username is required', 'error');
                return;
            }
            
            try {
                await setUserRole(username, roleName || null, roleColor);
                closeModalHandler();
                await loadUsersWithRoles(); // Refresh the table
            } catch (error) {
                console.error('Error in form submission:', error);
                // Error notification already shown by setUserRole
            }
        });
    }
}

// Function to load users with roles
async function loadUsersWithRoles() {
    const tableBody = document.getElementById('users-table-body');
    if (!tableBody) return;
    
    setTableState('users-table-body', 'loading', 5, 'Loading users...');
    
    try {
        // Get all users from various collections to show who exists
        const [d1Players, d2Players, d3Players, ffaPlayers, nonParticipants, userProfiles] = await Promise.all([
            getDocs(collection(db, 'players')),
            getDocs(collection(db, 'playersD2')),
            getDocs(collection(db, 'playersD3')),
            getDocs(collection(db, 'playersFFA')),
            getDocs(collection(db, 'nonParticipants')),
            getDocs(collection(db, 'userProfiles'))
        ]);
        
        // Build a map of userId -> userProfile for role lookups
        const profileRolesMap = new Map();
        userProfiles.forEach(doc => {
            const data = doc.data();
            if (data.roleName) {
                profileRolesMap.set(doc.id, {
                    roleName: data.roleName,
                    roleColor: data.roleColor,
                    roleAssignedBy: data.roleAssignedBy,
                    roleAssignedAt: data.roleAssignedAt
                });
            }
        });
        
        // Consolidate users into a map with username as key
        const usersMap = new Map();
        
        // Function to process documents and add to map
        function processDocuments(snapshot, source) {
            snapshot.forEach(doc => {
                const data = doc.data();
                const userId = doc.id;
                if (!data.username) return;

                if (!usersMap.has(data.username)) {
                    usersMap.set(data.username, {
                        username: data.username,
                        userId: userId,
                        roleName: null,
                        roleColor: null,
                        roleAssignedBy: null,
                        roleAssignedAt: null,
                        sources: [source]
                    });
                } else {
                    const user = usersMap.get(data.username);
                    // Store first found userId if not set
                    if (!user.userId) {
                        user.userId = userId;
                    }
                    if (!user.sources.includes(source)) {
                        user.sources.push(source);
                    }
                }
            });
        }

        // Process all collections to get list of users
        processDocuments(d1Players, 'D1');
        processDocuments(d2Players, 'D2');
        processDocuments(d3Players, 'D3');
        processDocuments(ffaPlayers, 'FFA');
        processDocuments(nonParticipants, 'Non-Participant');
        processDocuments(userProfiles, 'Profile');
        
        // Now apply roles from userProfiles ONLY
        usersMap.forEach(user => {
            if (user.userId && profileRolesMap.has(user.userId)) {
                const roleData = profileRolesMap.get(user.userId);
                user.roleName = roleData.roleName;
                user.roleColor = roleData.roleColor;
                user.roleAssignedBy = roleData.roleAssignedBy;
                user.roleAssignedAt = roleData.roleAssignedAt;
            }
        });
        
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
                            <i class="fas fa-times"></i>
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
    console.log('Attempting to open role edit modal for:', username);
    const modal = document.getElementById('set-role-modal');
    const usernameInput = document.getElementById('role-username');
    const roleNameInput = document.getElementById('role-name');
    const roleColorInput = document.getElementById('role-color');

    if (!modal) {
        console.error('CRITICAL: Role modal element (#set-role-modal) not found in the DOM!');
        alert('Error: Could not find the role editing dialog.');
        return;
    }
    console.log('Modal element found:', modal);

    // Pre-fill the username
    if (usernameInput) {
        usernameInput.value = username;
        console.log(`Username input set to: ${username}`);
    } else {
        console.warn('Username input field (#role-username) not found in modal.');
    }

    // Find current role from table row data attributes
    const userRow = document.querySelector(`#users-table-body tr[data-username="${username}"]`);
    if (userRow) {
        const currentRoleName = userRow.dataset.roleName || '';
        const currentRoleColor = userRow.dataset.roleColor || '#808080';
        
        if (roleNameInput) {
            roleNameInput.value = currentRoleName;
            console.log(`Role name input set to: ${currentRoleName}`);
        }
        
        if (roleColorInput) {
            roleColorInput.value = currentRoleColor;
            console.log(`Role color input set to: ${currentRoleColor}`);
        }
    } else {
        console.warn(`Table row for user ${username} not found.`);
        if (roleNameInput) roleNameInput.value = '';
        if (roleColorInput) roleColorInput.value = '#808080';
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
    
    setTableState('articles-table-body', 'loading', 4, 'Loading articles...');
    
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
    
    // Reset to editor tab
    switchArticleTab('editor');
    
    // Setup character counters
    setupCharacterCounters();
    
    // Setup live preview
    setupLivePreview();
    
    // Setup tab switching
    setupArticleTabs();
    
    if (articleId) {
        // Edit existing article
        titleElement.textContent = 'Edit Article';
        idInput.value = articleId;
        
        // Load article data
        loadArticleData(articleId);
    } else {
        // Create new article
        titleElement.textContent = 'Create Article';
        
        // Don't pre-fill author - let them enter their own username
        
        // Update character counters
        updateCharacterCounters();
    }
    
    // Show modal
    modal.classList.add('active');
}

// Setup article tab switching
function setupArticleTabs() {
    const tabButtons = document.querySelectorAll('.article-tab-button');
    
    // Remove any existing listeners by cloning
    tabButtons.forEach(button => {
        const newButton = button.cloneNode(true);
        button.parentNode.replaceChild(newButton, button);
    });
    
    // Add new listeners
    document.querySelectorAll('.article-tab-button').forEach(button => {
        button.addEventListener('click', () => {
            const tabName = button.dataset.tab;
            switchArticleTab(tabName);
            
            // Update preview when switching to preview tab
            if (tabName === 'preview') {
                updateArticlePreview();
            }
        });
    });
}

// Switch between editor and preview tabs
function switchArticleTab(tabName) {
    // Update buttons
    document.querySelectorAll('.article-tab-button').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.tab === tabName) {
            btn.classList.add('active');
        }
    });
    
    // Update content
    document.querySelectorAll('.article-tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    const activeTab = document.getElementById(`${tabName}-tab`);
    if (activeTab) {
        activeTab.classList.add('active');
    }
}

// Setup character counters
function setupCharacterCounters() {
    const titleInput = document.getElementById('article-title');
    const contentTextarea = document.getElementById('article-content');
    
    if (titleInput) {
        // Remove existing listeners by cloning
        const newTitleInput = titleInput.cloneNode(true);
        titleInput.parentNode.replaceChild(newTitleInput, titleInput);
        
        newTitleInput.addEventListener('input', updateCharacterCounters);
    }
    
    if (contentTextarea) {
        // Remove existing listeners by cloning
        const newContentTextarea = contentTextarea.cloneNode(true);
        contentTextarea.parentNode.replaceChild(newContentTextarea, contentTextarea);
        
        newContentTextarea.addEventListener('input', updateCharacterCounters);
    }
}

// Update character counters
function updateCharacterCounters() {
    const titleInput = document.getElementById('article-title');
    const contentTextarea = document.getElementById('article-content');
    const titleCounter = document.getElementById('title-char-count');
    const contentCounter = document.getElementById('content-char-count');
    
    if (titleInput && titleCounter) {
        titleCounter.textContent = titleInput.value.length;
    }
    
    if (contentTextarea && contentCounter) {
        contentCounter.textContent = contentTextarea.value.length;
    }
}

// Setup live preview updates
function setupLivePreview() {
    const titleInput = document.getElementById('article-title');
    const authorInput = document.getElementById('article-author');
    const imageInput = document.getElementById('article-image-url');
    const contentTextarea = document.getElementById('article-content');
    const categorySelect = document.getElementById('article-category');
    
    const inputs = [titleInput, authorInput, imageInput, contentTextarea, categorySelect];
    
    inputs.forEach(input => {
        if (input) {
            // Remove existing listeners by cloning
            const newInput = input.cloneNode(true);
            input.parentNode.replaceChild(newInput, input);
            
            // Add input listener
            newInput.addEventListener('input', () => {
                // Only update if preview tab is active
                const previewTab = document.getElementById('preview-tab');
                if (previewTab && previewTab.classList.contains('active')) {
                    updateArticlePreview();
                }
            });
        }
    });
}

// Update the article preview
function updateArticlePreview() {
    const title = document.getElementById('article-title').value.trim();
    const author = document.getElementById('article-author').value.trim();
    const imageUrl = document.getElementById('article-image-url').value.trim();
    const content = document.getElementById('article-content').value.trim();
    const category = document.getElementById('article-category').value;
    
    // Update preview title
    const previewTitle = document.getElementById('preview-title');
    if (previewTitle) {
        previewTitle.textContent = title || 'Untitled Article';
    }
    
    // Update preview author
    const previewAuthor = document.getElementById('preview-author');
    if (previewAuthor) {
        previewAuthor.textContent = author || 'Unknown Author';
    }
    
    // Update preview category
    const previewCategory = document.querySelector('.preview-category');
    if (previewCategory) {
        const categoryNames = {
            'news': 'News & Announcements',
            'guide': 'Guides & Tips',
            'tournament': 'Tournament Reports',
            'community': 'Community Spotlight',
            'update': 'Update Notes'
        };
        previewCategory.textContent = categoryNames[category] || 'News';
    }
    
    // Update preview date
    const previewDate = document.querySelector('.preview-date');
    if (previewDate) {
        const now = new Date();
        previewDate.textContent = now.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });
    }
    
    // Update preview image
    const previewImageContainer = document.getElementById('preview-image-container');
    const previewImage = document.getElementById('preview-image');
    if (imageUrl && previewImageContainer && previewImage) {
        previewImage.src = imageUrl;
        previewImageContainer.style.display = 'block';
        
        // Handle image load errors
        previewImage.onerror = () => {
            previewImageContainer.style.display = 'none';
        };
    } else if (previewImageContainer) {
        previewImageContainer.style.display = 'none';
    }
    
    // Update preview content
    const previewContent = document.getElementById('preview-content');
    if (previewContent) {
        if (content) {
            // Basic sanitization - allow common HTML tags
            const sanitizedContent = content
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/&lt;p&gt;/g, '<p>')
                .replace(/&lt;\/p&gt;/g, '</p>')
                .replace(/&lt;strong&gt;/g, '<strong>')
                .replace(/&lt;\/strong&gt;/g, '</strong>')
                .replace(/&lt;em&gt;/g, '<em>')
                .replace(/&lt;\/em&gt;/g, '</em>')
                .replace(/&lt;h3&gt;/g, '<h3>')
                .replace(/&lt;\/h3&gt;/g, '</h3>')
                .replace(/&lt;ul&gt;/g, '<ul>')
                .replace(/&lt;\/ul&gt;/g, '</ul>')
                .replace(/&lt;ol&gt;/g, '<ol>')
                .replace(/&lt;\/ol&gt;/g, '</ol>')
                .replace(/&lt;li&gt;/g, '<li>')
                .replace(/&lt;\/li&gt;/g, '</li>')
                .replace(/&lt;br&gt;/g, '<br>')
                .replace(/&lt;br\/&gt;/g, '<br/>')
                .replace(/&lt;a href="([^"]+)"&gt;/g, '<a href="$1">')
                .replace(/&lt;\/a&gt;/g, '</a>');
            
            previewContent.innerHTML = sanitizedContent;
        } else {
            previewContent.innerHTML = '<p class="preview-placeholder">Your article content will appear here...</p>';
        }
    }
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
        
        // Set category if it exists, otherwise default to 'news'
        const categorySelect = document.getElementById('article-category');
        if (categorySelect && article.category) {
            categorySelect.value = article.category;
        } else if (categorySelect) {
            categorySelect.value = 'news';
        }
        
        // Update character counters after loading data
        updateCharacterCounters();
        
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
        const category = document.getElementById('article-category').value;
        
        if (!title || !content) {
            showNotification('Title and content are required', 'error');
            return;
        }
        
        if (!author) {
            showNotification('Author name is required', 'error');
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
            category: category || 'news',
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
    
    setTableState('trophies-table-body', 'loading', 5, 'Loading trophies...');
    
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
        
        // Search for player across all collections
        let playerDoc = null;
        let userId = null;
        let playerData = null;
        
        if (ladder === 'non-participant') {
            // Search in non-participants collection
            const nonParticipantsRef = collection(db, 'nonParticipants');
            const q = query(nonParticipantsRef, where('username', '==', username));
            const querySnapshot = await getDocs(q);
            
            if (!querySnapshot.empty) {
                playerDoc = querySnapshot.docs[0];
                userId = playerDoc.id;
                playerData = playerDoc.data();
            }
        } else {
            // Search in ladder collections
            const collectionName = ladder === 'D1' ? 'players' : 
                                 ladder === 'D2' ? 'playersD2' : 'playersD3';
            const playersRef = collection(db, collectionName);
            const q = query(playersRef, where('username', '==', username));
            const querySnapshot = await getDocs(q);
            
            if (!querySnapshot.empty) {
                playerDoc = querySnapshot.docs[0];
                userId = playerDoc.id;
                playerData = playerDoc.data();
            }
        }
        
        if (!playerDoc) {
            showNotification(`Player "${username}" not found in ${ladder === 'non-participant' ? 'non-participants' : ladder + ' ladder'}`, 'error');
            return;
        }
        
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

    setTableState('inactive-players-table-body', 'loading', 7, 'Loading inactive players...');

    try {
        // Get minimum days threshold from filter if it exists
        const daysFilter = document.getElementById('inactive-days-filter');
        const minInactiveDays = daysFilter ? parseInt(daysFilter.value) || 0 : 0;
        
        // Fetch all players from the current ladder
        const { players: playersCollectionName, approvedMatches: matchesCollection } = getCollectionNames();
        const playersRef = collection(db, playersCollectionName);
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

        // Fetch ALL matches at once (more efficient than querying per player)
        const matchesRef = collection(db, matchesCollection);
        const matchesQuery = query(matchesRef, orderBy('approvedAt', 'desc'));
        const matchesSnapshot = await getDocs(matchesQuery);
        
        console.log(`Fetched ${matchesSnapshot.size} total matches from ${matchesCollection}`);
        
        // Build a map of username -> last match
        const lastMatchMap = new Map();
        
        matchesSnapshot.forEach(doc => {
            const match = doc.data();
            const winner = match.winnerUsername;
            const loser = match.loserUsername;
            
            // Process winner's match if not already recorded
            if (winner && !lastMatchMap.has(winner)) {
                const matchDate = match.approvedAt ? new Date(match.approvedAt.seconds * 1000) : null;
                const now = new Date();
                const daysSinceMatch = matchDate ? 
                    Math.floor((now - matchDate) / (1000 * 60 * 60 * 24)) : null;
                
                lastMatchMap.set(winner, {
                    date: matchDate ? matchDate.toLocaleDateString() : 'N/A',
                    opponent: loser || 'Unknown',
                    result: 'Won',
                    timestamp: matchDate || new Date(0),
                    daysSinceMatch: daysSinceMatch !== null ? daysSinceMatch : Number.MAX_SAFE_INTEGER
                });
            }
            
            // Process loser's match if not already recorded
            if (loser && !lastMatchMap.has(loser)) {
                const matchDate = match.approvedAt ? new Date(match.approvedAt.seconds * 1000) : null;
                const now = new Date();
                const daysSinceMatch = matchDate ? 
                    Math.floor((now - matchDate) / (1000 * 60 * 60 * 24)) : null;
                
                lastMatchMap.set(loser, {
                    date: matchDate ? matchDate.toLocaleDateString() : 'N/A',
                    opponent: winner || 'Unknown',
                    result: 'Lost',
                    timestamp: matchDate || new Date(0),
                    daysSinceMatch: daysSinceMatch !== null ? daysSinceMatch : Number.MAX_SAFE_INTEGER
                });
            }
        });
        
        // Combine player data with match data
        let playersWithLastMatch = players.map(player => {
            const lastMatch = lastMatchMap.get(player.username);
            
            if (lastMatch) {
                return { ...player, lastMatch };
            } else {
                // Player has never played
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
        });
        
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
    
    tableBody.innerHTML = `
        <tr>
            <td colspan="6" class="loading-cell">
                <i class="fas fa-spinner fa-spin"></i> Loading highlights...
            </td>
        </tr>
    `;
    
    try {
        const q = query(collection(db, 'highlights'), orderBy('createdAt', 'desc'));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="6" class="empty-state">
                        <i class="fas fa-inbox"></i>
                        <div>No highlights found</div>
                    </td>
                </tr>
            `;
            return;
        }
        
        tableBody.innerHTML = '';
        
        querySnapshot.forEach(doc => {
            const data = doc.data();
            const row = document.createElement('tr');
            
            const createdDate = data.createdAt ? 
                new Date(data.createdAt.seconds * 1000).toLocaleDateString() : 'N/A';
                
            // Format type for display with emojis
            let typeDisplay = 'Unknown';
            let typeClass = '';
            
            switch(data.type) {
                case 'match':
                    typeDisplay = '🎮 Match';
                    typeClass = 'match-type';
                    break;
                case 'creator':
                    typeDisplay = '🗺️ Creator';
                    typeClass = 'creator-type';
                    break;
                case 'achievement':
                    typeDisplay = '🏆 Achievement';
                    typeClass = 'achievement-type';
                    break;
            }
            
            row.innerHTML = `
                <td>${data.title || 'Untitled'}</td>
                <td><span class="highlight-type-badge ${typeClass}">${typeDisplay}</span></td>
                <td>${createdDate}</td>
                <td>${data.submittedBy || 'Unknown'}</td>
                <td class="video-status">${data.videoId ? '<i class="fas fa-video" style="color: #4CAF50;"></i> Yes' : '<i class="fas fa-times" style="color: #999;"></i> No'}</td>
                <td class="actions">
                    <button class="edit-highlight-btn action-btn edit-btn" data-id="${doc.id}" title="Edit Highlight">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="delete-highlight-btn action-btn delete-btn" data-id="${doc.id}" title="Delete Highlight">
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
        
        showNotification(`Loaded ${querySnapshot.size} highlights`, 'success');
        
    } catch (error) {
        console.error("Error loading highlights:", error);
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" class="error-state">
                    <i class="fas fa-exclamation-triangle"></i>
                    <div>Error loading highlights: ${error.message}</div>
                </td>
            </tr>
        `;
        showNotification(`Failed to load highlights: ${error.message}`, 'error');
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

// Update setupManageMatchesSection to include resimulate functionality
// Add this to your existing setupManageMatchesSection function:
function setupManageMatchesSection() {
    console.log('Setting up Manage Matches section');
    
    // Existing pagination buttons
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
    
    // Existing filter buttons
    const applyFiltersBtn = document.getElementById('apply-matches-filters');
    const resetFiltersBtn = document.getElementById('reset-matches-filters');
    
    if (applyFiltersBtn) {
        applyFiltersBtn.addEventListener('click', applyMatchesFilters);
    }
    
    if (resetFiltersBtn) {
        resetFiltersBtn.addEventListener('click', resetMatchesFilters);
    }
    
    // Existing search functionality
    const matchesSearch = document.getElementById('matches-search');
    if (matchesSearch) {
        matchesSearch.addEventListener('input', debounce(filterMatchesTable, 300));
    }
    
    // ADD NEW: Resimulate match button
    const resimulateBtn = document.getElementById('resimulate-match-btn');
    if (resimulateBtn) {
        resimulateBtn.addEventListener('click', openResimulateModal);
    }
    
    // ADD NEW: Resimulate modal event handlers
    const resimulateModal = document.getElementById('resimulate-modal');
    if (resimulateModal) {
        // Close button
        const closeBtn = resimulateModal.querySelector('.close');
        if (closeBtn) {
            closeBtn.addEventListener('click', closeResimulateModal);
        }
        
        // Background click to close
        resimulateModal.addEventListener('click', (e) => {
            if (e.target === resimulateModal) {
                closeResimulateModal();
            }
        });
    }
    
    // Existing create test match setup
    setupCreateTestMatchButton();
    setupCreateTestMatchModal();
    
    console.log('Manage Matches section initialized with resimulate functionality');
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



async function loadMatchesData(page = 1) {
    const tableBody = document.getElementById('matches-table-body');
    if (!tableBody) return;
    
    // Show loading state with icon
    tableBody.innerHTML = `
        <tr>
            <td colspan="7" class="loading-cell">
                <i class="fas fa-spinner fa-spin"></i> Loading matches...
            </td>
        </tr>
    `;
    
    try {
        const { approvedMatches: matchesCollection } = getCollectionNames();
        const isFFA = currentLadder === 'FFA';
        const ladderPrefix = currentLadder.toLowerCase();
        
        const matchesRef = collection(db, matchesCollection);
        
        let q;
        if (page > matchesPagination[ladderPrefix].page && matchesPagination[ladderPrefix].lastVisible) {
            q = query(
                matchesRef,
                orderBy('approvedAt', 'desc'),
                startAfter(matchesPagination[ladderPrefix].lastVisible),
                limit(PAGE_SIZE)
            );
        } else if (page < matchesPagination[ladderPrefix].page && matchesPagination[ladderPrefix].firstVisible) {
            q = query(
                matchesRef,
                orderBy('approvedAt', 'desc'),
                endBefore(matchesPagination[ladderPrefix].firstVisible),
                limitToLast(PAGE_SIZE)
            );
        } else {
            q = query(
                matchesRef,
                orderBy('approvedAt', 'desc'),
                limit(PAGE_SIZE)
            );
        }
        
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="empty-state">
                        <i class="fas fa-inbox"></i>
                        <div>No matches found for ${currentLadder}</div>
                    </td>
                </tr>
            `;
            return;
        }
        
        matchesPagination[ladderPrefix].page = page;
        matchesPagination[ladderPrefix].firstVisible = querySnapshot.docs[0];
        matchesPagination[ladderPrefix].lastVisible = querySnapshot.docs[querySnapshot.docs.length - 1];
        
        // Update pagination controls
        const prevBtn = document.getElementById('matches-prev-page');
        const nextBtn = document.getElementById('matches-next-page');
        const pageIndicator = document.getElementById('matches-page-indicator');
        
        if (prevBtn) prevBtn.disabled = page === 1;
        if (nextBtn) nextBtn.disabled = querySnapshot.docs.length < PAGE_SIZE;
        if (pageIndicator) pageIndicator.textContent = `Page ${page}`;
        
        tableBody.innerHTML = '';
        
        querySnapshot.forEach(doc => {
            const match = doc.data();
            const row = document.createElement('tr');
            
            // Add ladder as data attribute to the row
            row.setAttribute('data-ladder', currentLadder);
            
            const date = match.approvedAt?.toDate?.() 
                ? match.approvedAt.toDate().toLocaleDateString() 
                : 'N/A';
            
            if (isFFA) {
                // FFA match display
                const participants = match.players || match.participants || [];
                const winner = participants.find(p => p.placement === 1);
                
                row.innerHTML = `
                    <td>${date}</td>
                    <td>${winner?.username || 'N/A'}</td>
                    <td colspan="2">FFA - ${participants.length} Players</td>
                    <td>${match.mapPlayed || 'Unknown'}</td>
                    <td>${currentLadder}</td>
                    <td class="actions">
                        <button class="edit-match-btn" data-id="${doc.id}" title="Edit match">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="delete-match-btn" data-id="${doc.id}" title="Delete match">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                `;
            } else {
                // Regular 1v1 match display
                const winnerScore = match.winnerScore || match.winner_score || 0;
                const loserScore = match.loserScore || match.loser_score || 0;
                
                row.innerHTML = `
                    <td>${date}</td>
                    <td>${match.winnerUsername || match.winner || 'Unknown'}</td>
                    <td>${match.loserUsername || match.loser || 'Unknown'}</td>
                    <td>${winnerScore} - ${loserScore}</td>
                    <td>${match.mapPlayed || 'Unknown'}</td>
                    <td>${currentLadder}</td>
                    <td class="actions">
                        <button class="edit-match-btn" data-id="${doc.id}" title="Edit match">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="delete-match-btn" data-id="${doc.id}" title="Delete match">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                `;
            }
            
            tableBody.appendChild(row);
        });
        
        setupMatchesActionButtons();
        showNotification(`Loaded ${querySnapshot.size} matches for ${currentLadder}`, 'success');
        
    } catch (error) {
        console.error("Error loading matches:", error);
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="error-state">
                    <i class="fas fa-exclamation-triangle"></i>
                    <div>Error loading matches: ${error.message}</div>
                </td>
            </tr>
        `;
        showNotification(`Failed to load matches: ${error.message}`, 'error');
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
        const { approvedMatches: matchesCollection } = getCollectionNames(ladder);
        
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
        // Skip special state rows
        const firstCell = row.querySelector('td');
        if (!firstCell || firstCell.classList.contains('loading-cell') || 
            firstCell.classList.contains('empty-state') || 
            firstCell.classList.contains('error-state')) {
            return;
        }
        
        const cells = Array.from(row.cells);
        const searchableText = cells.slice(0, 5).map(cell => cell.textContent.toLowerCase()).join(' ');
        
        if (searchableText.includes(searchTerm)) {
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
            noResultsRow.innerHTML = `
                <td colspan="7">
                    <i class="fas fa-search"></i>
                    No matches found matching "${searchTerm}"
                </td>
            `;
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
    
    // Clear no-results message
    const noResultsRow = document.querySelector('.no-results');
    if (noResultsRow) {
        noResultsRow.remove();
    }
    
    // Reset pagination
    const ladderPrefix = currentLadder.toLowerCase();
    matchesPagination[ladderPrefix] = { page: 1, lastVisible: null, firstVisible: null };
    
    // Reload matches
    loadMatchesData(1);
    showNotification('Filters cleared', 'info');
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
        
        // Setup close button
        const closeBtn = modal.querySelector('.close-btn');
        if (closeBtn) {
            closeBtn.onclick = closeEditMatchModal;
        }
        
        // Close on background click
        modal.onclick = function(e) {
            if (e.target === modal) {
                closeEditMatchModal();
            }
        };
        
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
        const { approvedMatches: matchesCollection } = getCollectionNames(ladder);
        
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
        const { approvedMatches: matchesCollection } = getCollectionNames(ladder);
        
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
        const { approvedMatches: matchesCollection } = getCollectionNames(ladder);
        
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

// Add this after your existing match management functions

async function resimulateMatch() {
    try {
        const matchId = document.getElementById('resimulate-match-id').value;
        
        if (!matchId) {
            showNotification('Match ID is required', 'error');
            return;
        }
        
        // Check authorization
        const user = auth.currentUser;
        if (!user) {
            showNotification('You must be logged in to resimulate matches', 'error');
            return;
        }
        
        // Determine collection based on current ladder
        const { approvedMatches: matchesCollection } = getCollectionNames();
        
        // Validate match exists in approved matches
        const matchRef = doc(db, matchesCollection, matchId);
        const matchDoc = await getDoc(matchRef);
        
        if (!matchDoc.exists()) {
            showNotification('Match not found in approved matches', 'error');
            return;
        }
        
        const matchData = matchDoc.data();
        
        // Show match details for confirmation
        const matchDate = matchData.approvedAt ? 
            matchData.approvedAt.toDate().toLocaleString() : 
            matchData.matchDate ? 
                (matchData.matchDate.toDate ? matchData.matchDate.toDate().toLocaleString() : new Date(matchData.matchDate).toLocaleString()) : 
                'Unknown';
        
        const confirmationDetails = `
            <div class="match-details">
                <h4>Match Details:</h4>
                <p><strong>Winner:</strong> ${matchData.winnerUsername}</p>
                <p><strong>Loser:</strong> ${matchData.loserUsername}</p>
                <p><strong>Score:</strong> ${matchData.winnerScore}-${matchData.loserScore}</p>
                <p><strong>Map:</strong> ${matchData.mapPlayed || matchData.mapName || 'Unknown'}</p>
                <p><strong>Match Date:</strong> ${matchDate}</p>
                <p><strong>Match ID:</strong> ${matchId}</p>
                <p><strong>Ladder:</strong> ${currentLadder}</p>
                <hr>
                <p><em>This will create accurate ELO history entries based on the players' ELO ratings at the time this match was played.</em></p>
            </div>
        `;
        
        document.getElementById('match-details-container').innerHTML = confirmationDetails;
        document.getElementById('match-details-container').style.display = 'block';
        document.getElementById('confirm-resimulate-btn').style.display = 'block';
        
        // Store match data for confirmation
        window.pendingResimulateData = { matchId, matchData, ladder: currentLadder };
        
        showNotification('Match found - please review details and confirm resimulation', 'info');
        
    } catch (error) {
        console.error("Error finding match:", error);
        showNotification(`Failed to find match: ${error.message}`, 'error');
    }
}


// Replace the confirmResimulateMatch function with this accurate version:

// Replace the confirmResimulateMatch function with this complete version:

async function confirmResimulateMatch() {
    try {
        const { matchId, matchData, ladder } = window.pendingResimulateData;
        
        if (!matchId || !matchData) {
            showNotification('No match data found for resimulation', 'error');
            return;
        }
        
        // Determine collections based on ladder
        const playersCollection = 
            ladder === 'D1' ? 'players' : 
            ladder === 'D2' ? 'playersD2' : 'playersD3';
            
        const eloHistoryCollection = 
            ladder === 'D1' ? 'eloHistory' : 
            ladder === 'D2' ? 'eloHistoryD2' : 'eloHistoryD3';
        
        // Find player documents
        const [winnerDocs, loserDocs] = await Promise.all([
            getDocs(query(collection(db, playersCollection), where('username', '==', matchData.winnerUsername))),
            getDocs(query(collection(db, playersCollection), where('username', '==', matchData.loserUsername)))
        ]);

        if (winnerDocs.empty || loserDocs.empty) {
            showNotification('Could not find player documents', 'error');
            return;
        }

        const winnerId = winnerDocs.docs[0].id;
        const loserId = loserDocs.docs[0].id;
        const winnerData = winnerDocs.docs[0].data();
        const loserData = loserDocs.docs[0].data();
        
        // Check if ELO history entries already exist
        const [winnerHistoryQuery, loserHistoryQuery] = await Promise.all([
            getDocs(query(
                collection(db, eloHistoryCollection),
                where('playerId', '==', winnerId),
                where('matchId', '==', matchId)
            )),
            getDocs(query(
                collection(db, eloHistoryCollection),
                where('playerId', '==', loserId),
                where('matchId', '==', matchId)
            ))
        ]);
        
        const winnerHasHistory = !winnerHistoryQuery.empty;
        const loserHasHistory = !loserHistoryQuery.empty;
        
        // Show validation results
        const validationResults = `
            <div class="validation-results">
                <h4>Validation Results:</h4>
                <p><strong>Winner ELO History:</strong> ${winnerHasHistory ? '✅ Exists' : '❌ Missing'}</p>
                <p><strong>Loser ELO History:</strong> ${loserHasHistory ? '✅ Exists' : '❌ Missing'}</p>
                <p><strong>Current Winner ELO:</strong> ${winnerData.eloRating || 'Unknown'}</p>
                <p><strong>Current Loser ELO:</strong> ${loserData.eloRating || 'Unknown'}</p>
                <p><strong>Current Winner Position:</strong> ${winnerData.position || 'Unknown'}</p>
                <p><strong>Current Loser Position:</strong> ${loserData.position || 'Unknown'}</p>
                <hr>
                <p><strong style="color: #ff9800;">⚠️ RESIMULATION WILL:</strong></p>
                <ul>
                    <li>Recalculate ELO ratings based on pre-match values</li>
                    <li>Update current player ELO ratings</li>
                    <li>Recalculate and update player positions</li>
                    <li>Create missing ELO history entries</li>
                    <li>Handle position swaps if winner was lower ranked</li>
                </ul>
            </div>
        `;
        
        document.getElementById('validation-results-container').innerHTML = validationResults;
        document.getElementById('validation-results-container').style.display = 'block';
        
        if (winnerHasHistory && loserHasHistory) {
            showNotification('Both players already have ELO history for this match. No resimulation needed.', 'warning');
            return;
        }
        
        // Proceed with COMPLETE resimulation
        showNotification('Starting complete match resimulation...', 'info');
        
        // Get the exact match timestamp from the approved match
        const matchTimestamp = matchData.approvedAt || matchData.matchDate || serverTimestamp();
        
        // Find ELO ratings at the time of this match by looking at ELO history BEFORE this match
        const [winnerPreMatchElo, loserPreMatchElo] = await Promise.all([
            getPlayerEloAtTime(winnerId, matchTimestamp, eloHistoryCollection),
            getPlayerEloAtTime(loserId, matchTimestamp, eloHistoryCollection)
        ]);
        
        // Import the calculateElo function
        const { calculateElo } = await import('./ladderalgorithm.js');
        
        // Calculate what the ELOs should be after this specific match
        const { newWinnerRating, newLoserRating } = calculateElo(
            winnerPreMatchElo, 
            loserPreMatchElo
        );
        
        // Get current positions for position swap logic
        const currentWinnerPosition = winnerData.position || Number.MAX_SAFE_INTEGER;
        const currentLoserPosition = loserData.position || Number.MAX_SAFE_INTEGER;
        
        // Calculate what positions should be after this match
        let newWinnerPosition = currentWinnerPosition;
        let newLoserPosition = currentLoserPosition;
        
        // If winner was lower ranked (higher position number), they should move up
        if (currentWinnerPosition > currentLoserPosition) {
            newWinnerPosition = currentLoserPosition;
            newLoserPosition = currentLoserPosition + 1;
        }
        
        // Start batch operations
        const batch = writeBatch(db);
        
        // Update winner's ELO and position
        const winnerRef = doc(db, playersCollection, winnerId);
        batch.update(winnerRef, {
            eloRating: newWinnerRating,
            position: newWinnerPosition,
            lastUpdated: serverTimestamp(),
            resimulated: true,
            resimulatedAt: serverTimestamp(),
            resimulatedBy: auth.currentUser.uid
        });
        
        // Update loser's ELO and position
        const loserRef = doc(db, playersCollection, loserId);
        batch.update(loserRef, {
            eloRating: newLoserRating,
            position: newLoserPosition,
            lastUpdated: serverTimestamp(),
            resimulated: true,
            resimulatedAt: serverTimestamp(),
            resimulatedBy: auth.currentUser.uid
        });
        
        // If positions changed, update other players' positions
        if (currentWinnerPosition > currentLoserPosition) {
            // Get all players between the old positions and move them down
            const playersToUpdate = await getDocs(query(
                collection(db, playersCollection),
                where('position', '>', currentLoserPosition),
                where('position', '<', currentWinnerPosition)
            ));
            
            playersToUpdate.forEach(playerDoc => {
                const playerRef = doc(db, playersCollection, playerDoc.id);
                const currentPos = playerDoc.data().position;
                batch.update(playerRef, {
                    position: currentPos + 1,
                    lastUpdated: serverTimestamp(),
                    positionAdjustedBy: 'resimulation',
                    positionAdjustedAt: serverTimestamp()
                });
            });
        }
        
        // Create missing ELO history entries
        if (!winnerHasHistory) {
            const winnerHistoryRef = doc(collection(db, eloHistoryCollection));
            batch.set(winnerHistoryRef, {
                playerId: winnerId,
                player: matchData.winnerUsername,
                previousElo: winnerPreMatchElo,
                newElo: newWinnerRating,
                eloChange: newWinnerRating - winnerPreMatchElo,
                opponentId: loserId,
                opponent: matchData.loserUsername,
                matchResult: 'win',
                previousPosition: currentWinnerPosition,
                newPosition: newWinnerPosition,
                positionChange: newWinnerPosition - currentWinnerPosition,
                matchId: matchId,
                timestamp: matchTimestamp,
                resimulated: true,
                resimulatedAt: serverTimestamp(),
                resimulatedBy: auth.currentUser.uid,
                gameMode: ladder,
                matchScore: `${matchData.winnerScore}-${matchData.loserScore}`,
                mapPlayed: matchData.mapPlayed || matchData.mapName || 'Unknown',
                note: 'Resimulated entry - ELO and positions calculated from actual pre-match data'
            });
        }
        
        if (!loserHasHistory) {
            const loserHistoryRef = doc(collection(db, eloHistoryCollection));
            batch.set(loserHistoryRef, {
                playerId: loserId,
                player: matchData.loserUsername,
                previousElo: loserPreMatchElo,
                newElo: newLoserRating,
                eloChange: newLoserRating - loserPreMatchElo,
                opponentId: winnerId,
                opponent: matchData.winnerUsername,
                matchResult: 'loss',
                previousPosition: currentLoserPosition,
                newPosition: newLoserPosition,
                positionChange: newLoserPosition - currentLoserPosition,
                matchId: matchId,
                timestamp: matchTimestamp,
                resimulated: true,
                resimulatedAt: serverTimestamp(),
                resimulatedBy: auth.currentUser.uid,
                gameMode: ladder,
                matchScore: `${matchData.winnerScore}-${matchData.loserScore}`,
                mapPlayed: matchData.mapPlayed || matchData.mapName || 'Unknown',
                note: 'Resimulated entry - ELO and positions calculated from actual pre-match data'
            });
        }
        
        // Update match record to indicate resimulation
        const { approvedMatches: matchesCollection } = getCollectionNames(ladder);
            
        const matchRef = doc(db, matchesCollection, matchId);
        batch.update(matchRef, {
            resimulated: true,
            resimulatedAt: serverTimestamp(),
            resimulatedBy: auth.currentUser.uid,
            resimulatedReason: 'Complete resimulation - ELO ratings and positions recalculated',
            originalWinnerElo: winnerData.eloRating,
            originalLoserElo: loserData.eloRating,
            originalWinnerPosition: currentWinnerPosition,
            originalLoserPosition: currentLoserPosition,
            resimulatedWinnerElo: newWinnerRating,
            resimulatedLoserElo: newLoserRating,
            resimulatedWinnerPosition: newWinnerPosition,
            resimulatedLoserPosition: newLoserPosition
        });
        
        // Execute all batch operations
        await batch.commit();
        
        const historyEntriesCreated = (!winnerHasHistory ? 1 : 0) + (!loserHasHistory ? 1 : 0);
        const positionChanges = currentWinnerPosition !== newWinnerPosition || currentLoserPosition !== newLoserPosition;
        
        showNotification(
            `Match resimulated successfully! ` +
            `Created ${historyEntriesCreated} ELO history entries. ` +
            `Updated ELO ratings: Winner ${winnerPreMatchElo}→${newWinnerRating} (+${newWinnerRating - winnerPreMatchElo}), ` +
            `Loser ${loserPreMatchElo}→${newLoserRating} (${newLoserRating - loserPreMatchElo}). ` +
            `${positionChanges ? `Positions updated: Winner ${currentWinnerPosition}→${newWinnerPosition}, Loser ${currentLoserPosition}→${newLoserPosition}` : 'No position changes needed.'}`,
            'success'
        );
        
        // Clear the form
        closeResimulateModal();
        
        // Optionally refresh the current view if we're on the manage players page
        if (document.querySelector('#players.content-section.active')) {
            loadPlayersData();
        }
        
    } catch (error) {
        console.error("Error resimulating match:", error);
        showNotification(`Failed to resimulate match: ${error.message}`, 'error');
    }
}

// Add this new function to get a player's ELO at a specific point in time
async function getPlayerEloAtTime(playerId, targetTimestamp, eloHistoryCollection) {
    try {
        // Convert timestamp to Date if needed
        const targetDate = targetTimestamp.toDate ? targetTimestamp.toDate() : new Date(targetTimestamp);
        
        // Query for all ELO history entries for this player BEFORE the target time
        const historyQuery = query(
            collection(db, eloHistoryCollection),
            where('playerId', '==', playerId),
            where('timestamp', '<', targetTimestamp),
            orderBy('timestamp', 'desc'),
            limit(1)
        );
        
        const historySnapshot = await getDocs(historyQuery);
        
        if (!historySnapshot.empty) {
            // Found the most recent ELO entry before this match
            const lastEntry = historySnapshot.docs[0].data();
            console.log(`Found ELO history for player ${playerId} before match: ${lastEntry.newElo}`);
            return lastEntry.newElo;
        } else {
            // No history found before this match - player was at starting ELO
            console.log(`No ELO history found for player ${playerId} before match - using starting ELO 1200`);
            return 1200; // Starting ELO
        }
        
    } catch (error) {
        console.error(`Error getting ELO at time for player ${playerId}:`, error);
        // Fallback to starting ELO if there's an error
        return 1200;
    }
}

// Replace your openResimulateModal function with this debugging version:
function openResimulateModal() {
    console.log('openResimulateModal called!'); // Add this debug line
    
    const modal = document.getElementById('resimulate-modal');
    console.log('Modal element found:', modal); // Debug line
    
    if (!modal) {
        console.error('Modal element not found!');
        return;
    }
    
    // Try multiple approaches to show the modal
    modal.style.display = 'block';
    modal.style.visibility = 'visible';
    modal.style.opacity = '1';
    modal.classList.add('active');
    
    console.log('Modal should now be visible'); // Debug line
    console.log('Modal computed styles:', window.getComputedStyle(modal).display); // Debug line
    
    // Clear previous data
    const matchDetailsContainer = document.getElementById('match-details-container');
    const validationContainer = document.getElementById('validation-results-container');
    const confirmBtn = document.getElementById('confirm-resimulate-btn');
    const matchIdInput = document.getElementById('resimulate-match-id');
    
    if (matchDetailsContainer) matchDetailsContainer.innerHTML = '';
    if (validationContainer) validationContainer.innerHTML = '';
    if (confirmBtn) confirmBtn.style.display = 'none';
    if (matchIdInput) matchIdInput.value = '';
    
    console.log('Modal setup complete');
}

function closeResimulateModal() {
    document.getElementById('resimulate-modal').style.display = 'none';
    window.pendingResimulateData = null;
}

// Make functions globally available
window.resimulateMatch = resimulateMatch;
window.confirmResimulateMatch = confirmResimulateMatch;
window.openResimulateModal = openResimulateModal;
window.closeResimulateModal = closeResimulateModal;

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
    
    setTableState('points-history-table-body', 'loading', 6, 'Loading history...');
    
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

        // Add bulk award points button
    const bulkAwardPointsBtn = document.getElementById('bulk-award-points-btn');
    if (bulkAwardPointsBtn) {
        bulkAwardPointsBtn.addEventListener('click', async () => {
            if (confirm('This will award points for all approved matches based on their subgame types. Continue?')) {
                bulkAwardPointsBtn.disabled = true;
                bulkAwardPointsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
                await bulkAwardMatchPoints();
                bulkAwardPointsBtn.disabled = false;
                bulkAwardPointsBtn.innerHTML = '<i class="fas fa-coins"></i> Award Points for All Matches';
            }
        });
    }

        // Add award points to all pilots button
    const awardAllPilotsBtn = document.getElementById('award-all-pilots-btn');
    if (awardAllPilotsBtn) {
        awardAllPilotsBtn.addEventListener('click', awardPointsToAllPilots);
    }

async function bulkAwardMatchPoints() {
    try {
        showNotification('Starting bulk points award process for ALL game types...', 'info');
        
        // Points chart copied from points-service.js
        const POINTS_CHART = {
            '': 10, // Standard match
            'Standard': 10,
            'Fusion Match': 25,
            '≥6 Missiles': 10,
            'Weapon Imbalance': 30,
            'Blind Match': 75,
            'Rematch': 20,
            'Disorientation': 50,
            'Ratting': 35,
            'Altered Powerups': 35,
            'Mega Match': 40,
            'Dogfight': 50,
            'Gauss and Mercs': 25,
            'Misc': 30
        };
        
        // Stats to track progress
        let processedD1 = 0;
        let processedD2 = 0;
        let processedD3 = 0;
        let pointsAwarded = 0;
        let errors = 0;
        let alreadyAwarded = 0;
        
        // Store processed match IDs to avoid duplicate awards
        const processedMatches = new Set();
        
        // Keep track of which matches have already had points awarded
        const pointsHistoryRef = collection(db, 'pointsHistory');
        const historyQuery = query(pointsHistoryRef, 
            where('reason', '>=', 'Bulk award:'), 
            where('reason', '<=', 'Bulk award:\uf8ff')
        );
        const historySnapshot = await getDocs(historyQuery);
        
        // Extract match IDs from existing point awards
        historySnapshot.forEach(doc => {
            const data = doc.data();
            const reason = data.reason || '';
            const matchIdMatch = reason.match(/Match ID: ([a-zA-Z0-9]+)/);
            if (matchIdMatch && matchIdMatch[1]) {
                processedMatches.add(matchIdMatch[1]);
            }
        });
        
        console.log(`Found ${processedMatches.size} matches that already have had points awarded`);
        
        // Get all matches from all three collections
        const [d1Snapshot, d2Snapshot, d3Snapshot] = await Promise.all([
            getDocs(collection(db, 'approvedMatches')),
            getDocs(collection(db, 'approvedMatchesD2')),
            getDocs(collection(db, 'approvedMatchesD3'))
        ]);
        
        const totalMatches = d1Snapshot.size + d2Snapshot.size + d3Snapshot.size;
        showNotification(`Found ${totalMatches} total matches across all ladders`, 'info');
        
            const processMatches = async (snapshot, gameType) => {
                // Process each match
                let batch = writeBatch(db); // Changed from const to let
                const batchHistory = [];
                let batchCount = 0;
                
                for (const matchDoc of snapshot.docs) {
                    try {
                        // Skip if this match has already been processed
                        if (processedMatches.has(matchDoc.id)) {
                            if (gameType === 'D1') alreadyAwarded++;
                            if (gameType === 'D2') alreadyAwarded++;
                            if (gameType === 'D3') alreadyAwarded++;
                            continue;
                        }
                    
                        const match = matchDoc.data();
                        const subgameType = match.subgameType || 'Standard';
                        const pointsToAward = POINTS_CHART[subgameType] || 10;
                        
                        // Find winner user ID
                        let winnerUserId = match.winnerId;
                        if (!winnerUserId && match.winnerUsername) {
                            // Try to find user ID by username across all player collections
                            const [d1Winners, d2Winners, d3Winners] = await Promise.all([
                                getDocs(query(collection(db, 'players'), where('username', '==', match.winnerUsername))),
                                getDocs(query(collection(db, 'playersD2'), where('username', '==', match.winnerUsername))),
                                getDocs(query(collection(db, 'playersD3'), where('username', '==', match.winnerUsername)))
                            ]);
                            
                            if (!d1Winners.empty) winnerUserId = d1Winners.docs[0].id;
                            else if (!d2Winners.empty) winnerUserId = d2Winners.docs[0].id;
                            else if (!d3Winners.empty) winnerUserId = d3Winners.docs[0].id;
                        }
                        
                        // Find loser user ID
                        let loserUserId = match.loserId;
                        if (!loserUserId && match.loserUsername) {
                            // Try to find user ID by username across all player collections
                            const [d1Losers, d2Losers, d3Losers] = await Promise.all([
                                getDocs(query(collection(db, 'players'), where('username', '==', match.loserUsername))),
                                getDocs(query(collection(db, 'playersD2'), where('username', '==', match.loserUsername))),
                                getDocs(query(collection(db, 'playersD3'), where('username', '==', match.loserUsername)))
                            ]);
                            
                            if (!d1Losers.empty) loserUserId = d1Losers.docs[0].id;
                            else if (!d2Losers.empty) loserUserId = d2Losers.docs[0].id;
                            else if (!d3Losers.empty) loserUserId = d3Losers.docs[0].id;
                        }
                        
                        if (winnerUserId && loserUserId) {
                            // Find user profiles
                            const winnerRef = doc(db, 'userProfiles', winnerUserId);
                            const loserRef = doc(db, 'userProfiles', loserUserId);
                            
                            // Get current profile data for both users
                            const [winnerSnap, loserSnap] = await Promise.all([
                                getDoc(winnerRef),
                                getDoc(loserRef)
                            ]);
                            
                            if (winnerSnap.exists()) {
                                const winnerData = winnerSnap.data();
                                const currentPoints = winnerData.points || 0;
                                batch.update(winnerRef, {
                                    points: currentPoints + pointsToAward,
                                    lastPointsModified: serverTimestamp()
                                });
                                
                                // Add to history batch
                                batchHistory.push({
                                    userId: winnerUserId,
                                    userEmail: winnerData.email || 'unknown',
                                    displayName: winnerData.displayName || match.winnerUsername || 'Unknown User',
                                    action: 'add',
                                    amount: pointsToAward,
                                    previousPoints: currentPoints,
                                    newPoints: currentPoints + pointsToAward,
                                    reason: `Bulk award: ${subgameType} match (Winner) - Match ID: ${matchDoc.id} - ${gameType}`,
                                    adminEmail: auth.currentUser.email,
                                    timestamp: serverTimestamp()
                                });
                            }
                            
                            if (loserSnap.exists()) {
                                const loserData = loserSnap.data();
                                const currentPoints = loserData.points || 0;
                                batch.update(loserRef, {
                                    points: currentPoints + pointsToAward,
                                    lastPointsModified: serverTimestamp()
                                });
                                
                                // Add to history batch
                                batchHistory.push({
                                    userId: loserUserId,
                                    userEmail: loserData.email || 'unknown',
                                    displayName: loserData.displayName || match.loserUsername || 'Unknown User',
                                    action: 'add',
                                    amount: pointsToAward,
                                    previousPoints: currentPoints,
                                    newPoints: currentPoints + pointsToAward,
                                    reason: `Bulk award: ${subgameType} match (Participant) - Match ID: ${matchDoc.id} - ${gameType}`,
                                    adminEmail: auth.currentUser.email,
                                    timestamp: serverTimestamp()
                                });
                            }
                            
                            pointsAwarded += (pointsToAward * 2); // Both winner and loser
                            batchCount += 2;
                            
                            // Add this match to processed set
                            processedMatches.add(matchDoc.id);
                            
                            // Commit batch when it reaches size limit
                            if (batchCount >= 400) { // Firestore batch limit is 500
                                await batch.commit();
                                
                                // Create history entries
                                for (const historyEntry of batchHistory) {
                                    await addDoc(collection(db, 'pointsHistory'), historyEntry);
                                }
                                
                                // Create a NEW batch object
                                batch = writeBatch(db); // Create a new batch
                                batchCount = 0;
                                batchHistory.length = 0;
                            }
                        }
                    } catch (error) {
                        console.error(`Error processing ${gameType} match ${matchDoc.id}:`, error);
                        errors++;
                    }
                }
                
                // Commit any remaining batch operations
                if (batchCount > 0) {
                    await batch.commit();
                    
                    // Create history entries
                    for (const historyEntry of batchHistory) {
                        await addDoc(collection(db, 'pointsHistory'), historyEntry);
                    }
                }
                
                return { processed: gameType === 'D1' ? processedD1 : gameType === 'D2' ? processedD2 : processedD3 };
            };
        
        // Process each collection
        await processMatches(d1Snapshot, 'D1');
        await processMatches(d2Snapshot, 'D2');
        await processMatches(d3Snapshot, 'D3');
        
        showNotification(
            `Completed! Processed ${processedD1} D1 matches, ${processedD2} D2 matches, ${processedD3} D3 matches. ` +
            `Awarded ${pointsAwarded} points. Skipped ${alreadyAwarded} already processed matches. Errors: ${errors}`, 
            'success'
        );
        
        // Refresh points overview if it's visible
        if (document.getElementById('points-overview-table-body')) {
            loadPointsOverview();
        }
        
    } catch (error) {
        console.error('Error in bulk award points:', error);
        showNotification(`Error in bulk award process: ${error.message}`, 'error');
    }
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

        // Change username button
        const changeUsernameBtn = document.getElementById('change-username-btn');
        if (changeUsernameBtn) {
            changeUsernameBtn.addEventListener('click', () => {
                openChangeUsernameModal();
            });
        }
        
        // Change username modal events
        const changeUsernameModal = document.getElementById('change-username-modal');
        if (changeUsernameModal) {
            // Close button
            const closeBtn = changeUsernameModal.querySelector('.close-btn');
            if (closeBtn) {
                closeBtn.addEventListener('click', closeChangeUsernameModal);
            }
            
            // Cancel button
            const cancelBtn = document.getElementById('cancel-change-username-btn');
            if (cancelBtn) {
                cancelBtn.addEventListener('click', closeChangeUsernameModal);
            }
            
            // Form submission
            const changeUsernameForm = document.getElementById('change-username-form');
            if (changeUsernameForm) {
                changeUsernameForm.addEventListener('submit', handleChangeUsername);
            }
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

async function awardPointsToAllPilots() {
    try {
        // Prompt for points amount
        const pointsAmount = parseInt(prompt("Enter points amount to award to ALL pilots:", "10"));
        
        if (!pointsAmount || isNaN(pointsAmount)) {
            showNotification('Invalid points amount', 'error');
            return;
        }
        
        if (!confirm(`This will award ${pointsAmount} points to ALL pilots in ALL ladders (D1, D2, and D3). Continue?`)) {
            return;
        }
        
        showNotification('Starting points award process...', 'info');
        
        // Get all pilots from all ladders
        const [d1Pilots, d2Pilots, d3Pilots] = await Promise.all([
            getDocs(collection(db, 'players')),
            getDocs(collection(db, 'playersD2')),
            getDocs(collection(db, 'playersD3'))
        ]);
        
        console.log(`Found ${d1Pilots.size} D1 pilots, ${d2Pilots.size} D2 pilots, ${d3Pilots.size} D3 pilots`);
        const totalPilots = d1Pilots.size + d2Pilots.size + d3Pilots.size;
        
        // Collect all pilot IDs from all ladders
        const pilotMap = new Map(); // userId -> {username, ladder}
        
        // Process D1 pilots
        d1Pilots.forEach(doc => {
            const data = doc.data();
            pilotMap.set(doc.id, {
                username: data.username,
                ladder: 'D1'
            });
        });
        
        // Process D2 pilots
        d2Pilots.forEach(doc => {
            const data = doc.data();
            pilotMap.set(doc.id, {
                username: data.username,
                ladder: 'D2'
            });
        });
        
        // Process D3 pilots
        d3Pilots.forEach(doc => {
            const data = doc.data();
            pilotMap.set(doc.id, {
                username: data.username,
                ladder: 'D3'
            });
        });
        
        console.log(`Found ${pilotMap.size} unique pilots across all ladders`);
        
        // Process in batches
        let processed = 0;
        let pointsAwarded = 0;
        let errors = 0;
        
        // Process pilots in batches of 400
        const pilotIds = Array.from(pilotMap.keys());
        const BATCH_SIZE = 400;
        
        for (let i = 0; i < pilotIds.length; i += BATCH_SIZE) {
            const batch = writeBatch(db);
            const batchHistory = [];
            const batchPilots = pilotIds.slice(i, i + BATCH_SIZE);
            
            // Get user profiles for this batch
            const profileDocs = await Promise.all(
                batchPilots.map(pilotId => getDoc(doc(db, 'userProfiles', pilotId)))
            );
            
            for (let j = 0; j < batchPilots.length; j++) {
                try {
                    const pilotId = batchPilots[j];
                    const pilotInfo = pilotMap.get(pilotId);
                    const profileDoc = profileDocs[j];
                    
                    if (profileDoc.exists()) {
                        const profileData = profileDoc.data();
                        const currentPoints = profileData.points || 0;
                        const newPoints = currentPoints + pointsAmount;
                        
                        // Update user profile
                        batch.update(doc(db, 'userProfiles', pilotId), {
                            points: newPoints,
                            lastPointsModified: serverTimestamp()
                        });
                        
                        // Add history entry
                        batchHistory.push({
                            userId: pilotId,
                            userEmail: profileData.email || 'unknown',
                            displayName: profileData.displayName || pilotInfo.username || 'Unknown User',
                            action: 'add',
                            amount: pointsAmount,
                            previousPoints: currentPoints,
                            newPoints: newPoints,
                            reason: `Bulk award to all pilots (${pilotInfo.ladder})`,
                            adminEmail: auth.currentUser.email,
                            timestamp: serverTimestamp()
                        });
                        
                        pointsAwarded += pointsAmount;
                        processed++;
                    } else {
                        errors++;
                        console.warn(`No user profile found for pilot ${pilotInfo.username} (${pilotId})`);
                    }
                } catch (error) {
                    errors++;
                    console.error(`Error processing pilot ${pilotInfo?.username}:`, error);
                }
            }
            
            // Commit batch
            await batch.commit();
            
            // Add history entries
            for (const historyEntry of batchHistory) {
                await addDoc(collection(db, 'pointsHistory'), historyEntry);
            }
            
            // Update progress
            showNotification(`Processed ${processed}/${totalPilots} pilots...`, 'info');
        }
        
        showNotification(
            `Complete! Awarded ${pointsAwarded} points to ${processed} pilots. Errors: ${errors}`,
            'success'
        );
        
        // Refresh points overview if it's visible
        if (document.getElementById('points-overview-table-body')) {
            loadPointsOverview();
        }
        
    } catch (error) {
        console.error('Error in award points to all pilots:', error);
        showNotification(`Error: ${error.message}`, 'error');
    }
}

// Open change username modal
function openChangeUsernameModal() {
    const modal = document.getElementById('change-username-modal');
    if (!modal) {
        console.error('Change username modal not found');
        return;
    }
    
    // Clear form
    const form = document.getElementById('change-username-form');
    if (form) {
        form.reset();
    }
    
    // Clear results
    document.getElementById('username-search-results').innerHTML = '';
    document.getElementById('username-change-summary').style.display = 'none';
    
    // Show modal
    modal.classList.add('active');
}

// Close change username modal
function closeChangeUsernameModal() {
    const modal = document.getElementById('change-username-modal');
    if (modal) {
        modal.classList.remove('active');
    }
}

// Search for username across all collections
async function searchUsername() {
    const searchUsername = document.getElementById('search-username').value.trim();
    const resultsContainer = document.getElementById('username-search-results');
    
    if (!searchUsername) {
        showNotification('Please enter a username to search', 'error');
        return;
    }
    
    resultsContainer.innerHTML = '<div class="loading">Searching all collections...</div>';
    
    try {
        // Collections to search
        const collections = [
            { name: 'players', displayName: 'D1 Players' },
            { name: 'playersD2', displayName: 'D2 Players' },
            { name: 'playersD3', displayName: 'D3 Players' },
            { name: 'nonParticipants', displayName: 'Non-Participants' },
            { name: 'userProfiles', displayName: 'User Profiles' }
        ];
        
        const foundIn = [];
        
        // Search each collection
        for (const collectionInfo of collections) {
            const q = query(
                collection(db, collectionInfo.name),
                where('username', '==', searchUsername)
            );
            const snapshot = await getDocs(q);
            
            if (!snapshot.empty) {
                snapshot.forEach(doc => {
                    foundIn.push({
                        collection: collectionInfo.name,
                        displayName: collectionInfo.displayName,
                        docId: doc.id,
                        data: doc.data()
                    });
                });
            }
        }
        
        // Also search in match collections
        const matchCollections = [
            { name: 'approvedMatches', displayName: 'D1 Approved Matches' },
            { name: 'approvedMatchesD2', displayName: 'D2 Approved Matches' },
            { name: 'approvedMatchesD3', displayName: 'D3 Approved Matches' },
            { name: 'pendingMatches', displayName: 'D1 Pending Matches' },
            { name: 'pendingMatchesD2', displayName: 'D2 Pending Matches' },
            { name: 'pendingMatchesD3', displayName: 'D3 Pending Matches' }
        ];
        
        let matchCount = 0;
        for (const matchCollection of matchCollections) {
            const winnerQuery = query(
                collection(db, matchCollection.name),
                where('winnerUsername', '==', searchUsername)
            );
            const loserQuery = query(
                collection(db, matchCollection.name),
                where('loserUsername', '==', searchUsername)
            );
            
            const [winnerSnap, loserSnap] = await Promise.all([
                getDocs(winnerQuery),
                getDocs(loserQuery)
            ]);
            
            const totalMatches = winnerSnap.size + loserSnap.size;
            if (totalMatches > 0) {
                foundIn.push({
                    collection: matchCollection.name,
                    displayName: matchCollection.displayName,
                    matchCount: totalMatches,
                    isMatches: true
                });
                matchCount += totalMatches;
            }
        }
        
        // Display results
        if (foundIn.length === 0) {
            resultsContainer.innerHTML = `
                <div class="no-results">
                    <i class="fas fa-search"></i>
                    <p>Username "${searchUsername}" not found in any collection</p>
                </div>
            `;
            return;
        }
        
        resultsContainer.innerHTML = `
            <div class="search-results-header">
                <h4>Found "${searchUsername}" in ${foundIn.length} location(s)</h4>
            </div>
            <div class="results-list">
                ${foundIn.map(result => `
                    <div class="result-item ${result.isMatches ? 'matches-result' : ''}">
                        <i class="fas ${result.isMatches ? 'fa-trophy' : 'fa-user'}"></i>
                        <div class="result-info">
                            <strong>${result.displayName}</strong>
                            ${result.isMatches ? 
                                `<span class="match-count">${result.matchCount} matches</span>` : 
                                `<span class="doc-id">ID: ${result.docId}</span>`
                            }
                        </div>
                        <i class="fas fa-check-circle found-icon"></i>
                    </div>
                `).join('')}
            </div>
            <div class="results-summary">
                <p><strong>Total matches found:</strong> ${matchCount}</p>
            </div>
        `;
        
        // Store results for the change operation
        window.usernameSearchResults = {
            username: searchUsername,
            foundIn: foundIn,
            matchCount: matchCount
        };
        
        showNotification(`Found username in ${foundIn.length} locations`, 'success');
        
    } catch (error) {
        console.error('Error searching username:', error);
        resultsContainer.innerHTML = `
            <div class="error-state">
                Error searching: ${error.message}
            </div>
        `;
        showNotification('Error searching username', 'error');
    }
}

// Handle change username form submission
async function handleChangeUsername(e) {
    e.preventDefault();
    
    const oldUsername = document.getElementById('search-username').value.trim();
    const newUsername = document.getElementById('new-username').value.trim();
    
    if (!oldUsername || !newUsername) {
        showNotification('Please enter both old and new usernames', 'error');
        return;
    }
    
    if (oldUsername === newUsername) {
        showNotification('New username must be different from old username', 'error');
        return;
    }
    
    // Check if search was performed
    if (!window.usernameSearchResults || window.usernameSearchResults.username !== oldUsername) {
        showNotification('Please search for the username first', 'error');
        return;
    }
    
    // Confirm the change
    const foundIn = window.usernameSearchResults.foundIn.length;
    const matchCount = window.usernameSearchResults.matchCount;
    
    if (!confirm(
        `This will change username "${oldUsername}" to "${newUsername}" in:\n\n` +
        `- ${foundIn} collection(s)\n` +
        `- ${matchCount} match(es)\n\n` +
        `This action cannot be easily undone. Continue?`
    )) {
        return;
    }
    
    // Show progress
    const summaryDiv = document.getElementById('username-change-summary');
    summaryDiv.style.display = 'block';
    summaryDiv.innerHTML = '<div class="loading">Changing username...</div>';
    
    try {
        const results = await changeUsernameInWorkspace(oldUsername, newUsername);
        
        // Display success summary
        summaryDiv.innerHTML = `
            <div class="success-summary">
                <i class="fas fa-check-circle"></i>
                <h4>Username Changed Successfully!</h4>
                <div class="change-stats">
                    <div class="stat-item">
                        <span class="stat-value">${results.playersUpdated}</span>
                        <span class="stat-label">Player Records</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-value">${results.matchesUpdated}</span>
                        <span class="stat-label">Matches</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-value">${results.historyUpdated}</span>
                        <span class="stat-label">History Entries</span>
                    </div>
                </div>
                <p class="success-note">All references to "${oldUsername}" have been updated to "${newUsername}"</p>
            </div>
        `;
        
        showNotification('Username changed successfully across all collections', 'success');
        
        // Refresh player data if on that tab
        if (document.getElementById('manage-players').style.display !== 'none') {
            setTimeout(() => {
                loadPlayersData();
            }, 2000);
        }
        
    } catch (error) {
        console.error('Error changing username:', error);
        summaryDiv.innerHTML = `
            <div class="error-summary">
                <i class="fas fa-exclamation-circle"></i>
                <h4>Error Changing Username</h4>
                <p>${error.message}</p>
            </div>
        `;
        showNotification('Failed to change username: ' + error.message, 'error');
    }
}

// Change username across all collections
async function changeUsernameInWorkspace(oldUsername, newUsername) {
    const user = auth.currentUser;
    if (!user) {
        throw new Error('You must be logged in');
    }
    
    let playersUpdated = 0;
    let matchesUpdated = 0;
    let historyUpdated = 0;
    
    // Update player collections
    const playerCollections = ['players', 'playersD2', 'playersD3', 'nonParticipants', 'userProfiles'];
    
    for (const collectionName of playerCollections) {
        const q = query(collection(db, collectionName), where('username', '==', oldUsername));
        const snapshot = await getDocs(q);
        
        for (const docSnapshot of snapshot.docs) {
            await updateDoc(doc(db, collectionName, docSnapshot.id), {
                username: newUsername,
                usernameChangedAt: serverTimestamp(),
                usernameChangedBy: user.email,
                previousUsername: oldUsername
            });
            playersUpdated++;
        }
    }
    
    // Update match collections
    const matchCollections = [
        'approvedMatches', 'approvedMatchesD2', 'approvedMatchesD3',
        'pendingMatches', 'pendingMatchesD2', 'pendingMatchesD3',
        'RejectedD1', 'RejectedD2', 'RejectedD3'
    ];
    
    for (const collectionName of matchCollections) {
        // Update winner username
        const winnerQuery = query(collection(db, collectionName), where('winnerUsername', '==', oldUsername));
        const winnerSnapshot = await getDocs(winnerQuery);
        
        for (const docSnapshot of winnerSnapshot.docs) {
            await updateDoc(doc(db, collectionName, docSnapshot.id), {
                winnerUsername: newUsername,
                usernameChangedAt: serverTimestamp(),
                usernameChangedBy: user.email
            });
            matchesUpdated++;
        }
        
        // Update loser username
        const loserQuery = query(collection(db, collectionName), where('loserUsername', '==', oldUsername));
        const loserSnapshot = await getDocs(loserQuery);
        
        for (const docSnapshot of loserSnapshot.docs) {
            await updateDoc(doc(db, collectionName, docSnapshot.id), {
                loserUsername: newUsername,
                usernameChangedAt: serverTimestamp(),
                usernameChangedBy: user.email
            });
            matchesUpdated++;
        }
    }
    
    // Update ELO history collections
    const historyCollections = ['eloHistory', 'eloHistoryD2', 'eloHistoryD3'];
    
    for (const collectionName of historyCollections) {
        const q = query(collection(db, collectionName), where('player', '==', oldUsername));
        const snapshot = await getDocs(q);
        
        for (const docSnapshot of snapshot.docs) {
            await updateDoc(doc(db, collectionName, docSnapshot.id), {
                player: newUsername,
                usernameChangedAt: serverTimestamp(),
                usernameChangedBy: user.email
            });
            historyUpdated++;
        }
        
        // Also update opponent field
        const opponentQuery = query(collection(db, collectionName), where('opponent', '==', oldUsername));
        const opponentSnapshot = await getDocs(opponentQuery);
        
        for (const docSnapshot of opponentSnapshot.docs) {
            await updateDoc(doc(db, collectionName, docSnapshot.id), {
                opponent: newUsername,
                usernameChangedAt: serverTimestamp(),
                usernameChangedBy: user.email
            });
            historyUpdated++;
        }
    }
    
    // Log the username change
    await addDoc(collection(db, 'usernameChangeLog'), {
        oldUsername: oldUsername,
        newUsername: newUsername,
        changedBy: user.email,
        changedAt: serverTimestamp(),
        playersUpdated: playersUpdated,
        matchesUpdated: matchesUpdated,
        historyUpdated: historyUpdated
    });
    
    return {
        playersUpdated,
        matchesUpdated,
        historyUpdated
    };
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

    setupTopRankScanButton();

    console.log('Manage Ribbons section initialized');
}

// Add this function after the setupManageRibbonsSection function (around line 7600)

// Scan all ladders for top players in each rank and award ribbons
async function scanAndAwardTopRankRibbons() {
    const scanBtn = document.getElementById('scan-top-ranks-btn');
    if (!scanBtn) return;
    
    const originalText = scanBtn.innerHTML;
    scanBtn.disabled = true;
    scanBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Scanning...';
    
    try {
        const results = {
            scanned: 0,
            awarded: 0,
            skipped: 0,
            errors: [],
            details: []
        };
        
        // Define ladders and their player collections
        const ladders = [
            { name: 'D1', collection: 'players', ribbonCollection: 'playerRibbons' },
            { name: 'D2', collection: 'playersD2', ribbonCollection: 'playerRibbonsD2' },
            { name: 'D3', collection: 'playersD3', ribbonCollection: 'playerRibbonsD3' }
        ];
        
        // Define rank tiers with ELO thresholds - MUST match ranks.js
        // Thresholds: Bronze=200, Silver=500, Gold=700, Emerald=1000
        // Emerald requires: winRate >= 80% AND matchCount >= 20
        // Same thresholds apply to ALL ladders (D1, D2, D3)
        const getRankTier = (elo, matchCount, winRate) => {
            // Unranked if no matches played
            if (!matchCount || matchCount === 0) {
                return { tier: 0, name: 'Unranked' };
            }
            
            // Standard tier checks based on ELO
            if (elo < 200) return { tier: 0, name: 'Unranked' };
            if (elo < 500) return { tier: 1, name: 'Bronze' };
            if (elo < 700) return { tier: 2, name: 'Silver' };
            if (elo < 1000) return { tier: 3, name: 'Gold' };
            
            // Emerald tier: 1000+ ELO, requires 80% win rate AND 20+ matches
            if (elo >= 1000 && winRate >= 80 && matchCount >= 20) {
                return { tier: 4, name: 'Emerald' };
            }
            
            // Default to Gold if 1000+ ELO but Emerald requirements not met
            return { tier: 3, name: 'Gold' };
        };
        
        // Get list of players on hiatus
        const hiatusSnapshot = await getDocs(collection(db, 'playerHiatus'));
        const hiatusPlayers = new Map();
        hiatusSnapshot.forEach(doc => {
            const data = doc.data();
            if (data.username && data.fromLadder) {
                const key = `${data.username}-${data.fromLadder}`;
                hiatusPlayers.set(key, true);
            }
        });
        
        console.log(`📋 Found ${hiatusPlayers.size} players on hiatus`);
        
        for (const ladder of ladders) {
            console.log(`\n🔍 Scanning ${ladder.name} ladder...`);
            
            // Get all active players from this ladder
            const playersSnapshot = await getDocs(collection(db, ladder.collection));
            const players = [];
            
            playersSnapshot.forEach(doc => {
                const data = doc.data();
                const username = data.username;
                const elo = data.eloRating || 0;
                const matchCount = data.matchesPlayed || 0;
                const winRate = data.winPercentage || 0;
                
                // Check if player is on hiatus for this ladder
                const hiatusKey = `${username}-${ladder.name}`;
                const isOnHiatus = hiatusPlayers.has(hiatusKey);
                
                if (!isOnHiatus && username) {
                    const rankInfo = getRankTier(elo, matchCount, winRate);
                    players.push({
                        username,
                        elo,
                        matchCount,
                        winRate,
                        tier: rankInfo.tier,
                        tierName: rankInfo.name
                    });
                }
            });
            
            console.log(`  Found ${players.length} active players`);
            results.scanned += players.length;
            
            // Group players by rank tier
            const tierGroups = {
                1: [], // Bronze
                2: [], // Silver
                3: [], // Gold
                4: []  // Emerald
            };
            
            players.forEach(player => {
                if (player.tier >= 1 && player.tier <= 4) {
                    tierGroups[player.tier].push(player);
                }
            });
            
            // Find top player in each tier and award ribbon
            for (const [tierNum, tierPlayers] of Object.entries(tierGroups)) {
                if (tierPlayers.length === 0) continue;
                
                // Sort by ELO descending to find the top player
                tierPlayers.sort((a, b) => b.elo - a.elo);
                const topPlayer = tierPlayers[0];
                const tierName = topPlayer.tierName;
                const ribbonName = `Top ${tierName} Pilot`;
                
                console.log(`  ${tierName}: ${tierPlayers.length} players, Top: ${topPlayer.username} (${topPlayer.elo} ELO, ${topPlayer.winRate}% WR, ${topPlayer.matchCount} matches)`);
                
                // Check if player already has this ribbon
                const ribbonRef = doc(db, ladder.ribbonCollection, topPlayer.username);
                const ribbonDoc = await getDoc(ribbonRef);
                const currentRibbons = ribbonDoc.exists() ? (ribbonDoc.data().ribbons || {}) : {};
                
                if (currentRibbons[ribbonName]) {
                    console.log(`    ✅ ${topPlayer.username} already has ${ribbonName}`);
                    results.skipped++;
                    results.details.push({
                        ladder: ladder.name,
                        username: topPlayer.username,
                        ribbon: ribbonName,
                        status: 'already_has'
                    });
                } else {
                    // Award the ribbon
                    currentRibbons[ribbonName] = {
                        level: 1,
                        awardedAt: serverTimestamp(),
                        rank: tierName,
                        achievedAt: serverTimestamp(),
                        permanent: true,
                        awardedBy: 'admin_scan'
                    };
                    
                    await setDoc(ribbonRef, {
                        username: topPlayer.username,
                        ladder: ladder.name,
                        ribbons: currentRibbons,
                        lastUpdated: serverTimestamp()
                    }, { merge: true });
                    
                    console.log(`    🏆 Awarded ${ribbonName} to ${topPlayer.username}`);
                    results.awarded++;
                    results.details.push({
                        ladder: ladder.name,
                        username: topPlayer.username,
                        ribbon: ribbonName,
                        elo: topPlayer.elo,
                        status: 'awarded'
                    });
                }
            }
        }
        
        // Show results modal
        showTopRankScanResults(results);
        
    } catch (error) {
        console.error('Error scanning top ranks:', error);
        showNotification('Error scanning top ranks: ' + error.message, 'error');
    } finally {
        scanBtn.disabled = false;
        scanBtn.innerHTML = originalText;
    }
}

// Display scan results in a modal or notification
function showTopRankScanResults(results) {
    const awardedDetails = results.details
        .filter(d => d.status === 'awarded')
        .map(d => `• ${d.username} → ${d.ribbon} (${d.ladder}, ${d.elo} ELO)`)
        .join('\n');
    
    const skippedDetails = results.details
        .filter(d => d.status === 'already_has')
        .map(d => `• ${d.username} already has ${d.ribbon} (${d.ladder})`)
        .join('\n');
    
    let message = `Top Rank Scan Complete!\n\n`;
    message += `📊 Players Scanned: ${results.scanned}\n`;
    message += `🏆 Ribbons Awarded: ${results.awarded}\n`;
    message += `⏭️ Already Had Ribbon: ${results.skipped}\n`;
    
    if (results.awarded > 0) {
        message += `\n🆕 Newly Awarded:\n${awardedDetails}`;
    }
    
    if (results.errors.length > 0) {
        message += `\n\n❌ Errors: ${results.errors.length}`;
    }
    
    // Create a styled modal for results
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'top-rank-results-modal';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 600px; max-height: 80vh; overflow-y: auto;">
            <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                <h2 style="margin: 0;"><i class="fas fa-crown" style="color: gold;"></i> Top Rank Scan Results</h2>
                <button class="close-modal" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: #888;">&times;</button>
            </div>
            
            <div class="scan-stats" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 1.5rem;">
                <div style="background: #2a2a2a; padding: 1rem; border-radius: 8px; text-align: center;">
                    <div style="font-size: 2rem; font-weight: bold; color: #4CAF50;">${results.scanned}</div>
                    <div style="color: #888; font-size: 0.9rem;">Players Scanned</div>
                </div>
                <div style="background: #2a2a2a; padding: 1rem; border-radius: 8px; text-align: center;">
                    <div style="font-size: 2rem; font-weight: bold; color: #FFD700;">${results.awarded}</div>
                    <div style="color: #888; font-size: 0.9rem;">Ribbons Awarded</div>
                </div>
                <div style="background: #2a2a2a; padding: 1rem; border-radius: 8px; text-align: center;">
                    <div style="font-size: 2rem; font-weight: bold; color: #888;">${results.skipped}</div>
                    <div style="color: #888; font-size: 0.9rem;">Already Had</div>
                </div>
            </div>
            
            ${results.awarded > 0 ? `
                <div style="margin-bottom: 1rem;">
                    <h3 style="color: #4CAF50; margin-bottom: 0.5rem;"><i class="fas fa-trophy"></i> Newly Awarded</h3>
                    <div style="background: #1a1a1a; padding: 1rem; border-radius: 8px; max-height: 200px; overflow-y: auto;">
                        ${results.details
                            .filter(d => d.status === 'awarded')
                            .map(d => `
                                <div style="padding: 0.5rem; border-bottom: 1px solid #333; display: flex; justify-content: space-between;">
                                    <span><strong>${d.username}</strong></span>
                                    <span style="color: #FFD700;">${d.ribbon}</span>
                                    <span style="color: #888;">${d.ladder} • ${d.elo} ELO</span>
                                </div>
                            `).join('')}
                    </div>
                </div>
            ` : ''}
            
            ${results.skipped > 0 ? `
                <div style="margin-bottom: 1rem;">
                    <h3 style="color: #888; margin-bottom: 0.5rem;"><i class="fas fa-check-circle"></i> Already Had Ribbon</h3>
                    <div style="background: #1a1a1a; padding: 1rem; border-radius: 8px; max-height: 150px; overflow-y: auto; font-size: 0.9rem;">
                        ${results.details
                            .filter(d => d.status === 'already_has')
                            .map(d => `
                                <div style="padding: 0.3rem; color: #666;">
                                    ${d.username} - ${d.ribbon} (${d.ladder})
                                </div>
                            `).join('')}
                    </div>
                </div>
            ` : ''}
            
            <div class="modal-buttons" style="text-align: center; margin-top: 1rem;">
                <button class="btn btn-primary close-results-btn" style="padding: 0.75rem 2rem;">
                    <i class="fas fa-check"></i> Done
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Close handlers
    modal.querySelector('.close-modal').addEventListener('click', () => modal.remove());
    modal.querySelector('.close-results-btn').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
    
    // Refresh ribbons data
    loadRibbonsData();
}

// Add to setupManageRibbonsSection or call separately
function setupTopRankScanButton() {
    const scanBtn = document.getElementById('scan-top-ranks-btn');
    if (scanBtn) {
        scanBtn.addEventListener('click', scanAndAwardTopRankRibbons);
    }
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
    
    setTableState('points-overview-table-body', 'loading', 5, 'Loading user points...');
    
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
    
    setTableState('ribbons-overview-table-body', 'loading', 5, 'Loading ribbons data...');
    
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
    
    console.log(`Attempting to remove ribbon: ${ribbonName} from ${username} on ${ladder}`);
    
    if (!username) {
        showNotification('Please enter a username first', 'error');
        return;
    }
    
    if (!confirm(`Remove ${ribbonName} from ${username}?`)) return;
    
    try {
        const collectionName = `playerRibbons${ladder === 'D1' ? '' : ladder}`;
        console.log(`Using collection: ${collectionName}`);
        const ribbonRef = doc(db, collectionName, username);
        
        // Get current ribbons
        const ribbonDoc = await getDoc(ribbonRef);
        if (!ribbonDoc.exists()) {
            showNotification(`No ribbon data found for ${username}`, 'error');
            return;
        }
        
        const currentRibbons = ribbonDoc.data().ribbons || {};
        console.log('Current ribbons:', Object.keys(currentRibbons));
        
        if (!currentRibbons[ribbonName]) {
            showNotification(`${ribbonName} not found on ${username}`, 'warning');
            return;
        }
        
        // Remove ribbon
        delete currentRibbons[ribbonName];
        console.log('Ribbons after removal:', Object.keys(currentRibbons));
        
        // Save updated ribbons
        await setDoc(ribbonRef, {
            username: username,
            ladder: ladder,
            ribbons: currentRibbons,
            lastUpdated: serverTimestamp()
        }, { merge: true });
        
        console.log(`Successfully removed ${ribbonName}`);
        showNotification(`Removed ${ribbonName} from ${username}`, 'success');
        displayCurrentRibbons(currentRibbons);
        
        // CRITICAL: Invalidate the ribbon cache so it gets re-evaluated with correct logic
        try {
            // Clear localStorage cache
            const cacheKey = `ribbon_cache_${username}_${ladder}`;
            localStorage.removeItem(cacheKey);
            console.log(`Cleared ribbon cache for ${username}`);
            
            // Force re-evaluation on next profile load
            const evalMessage = `Ribbon cache cleared. Profile will re-evaluate on next load with current logic.`;
            console.log(evalMessage);
        } catch (cacheError) {
            console.warn('Could not clear ribbon cache:', cacheError);
        }
        
    } catch (error) {
        console.error('Error removing ribbon:', error);
        showNotification('Error removing ribbon', 'error');
    }
}

// Add this after the Ribbons management section (around line 7800)

// ============================================================================
// STORE INVENTORY MANAGEMENT
// ============================================================================

// Theme and Token definitions (matching redeem.js)
const STORE_THEMES = {
    'default': { name: 'Classic RDL', price: 0 },
    'contrast': { name: 'Nightlight', price: 0 },
    'purple': { name: 'Purple', price: 150 },
    'ocean': { name: 'Blue', price: 300 },
    'cyberpunk': { name: 'Yellow Orange', price: 400 },
    'volcanic': { name: 'Red', price: 500 },
    'gold': { name: 'Gold', price: 800 },
    'emerald': { name: 'Emerald', price: 1000 },
    'cockpit': { name: 'Cockpit', price: 1200 },
    'christmas': { name: 'Christmas', price: 0 }
};

const STORE_TOKENS = {
    'pwr01': { name: 'Energy', price: 100 },
    'pwr02': { name: 'Shield', price: 100 },
    'pwr03': { name: 'Laser', price: 100 },
    'concussion': { name: 'Concussion Missile', price: 150 },
    'homing': { name: 'Homing Missile', price: 200 },
    'proxbomb': { name: 'Proximity Bomb', price: 200 },
    'smartbomb': { name: 'Smart Bomb', price: 250 },
    'megamissile': { name: 'Mega Missile', price: 300 },
    'spreadfire': { name: 'Spreadfire Cannon', price: 300 },
    'vulcan': { name: 'Vulcan Cannon', price: 300 },
    'fusion': { name: 'Fusion Cannon', price: 350 },
    'lock': { name: 'Lock', price: 450 },
    'blob01': { name: 'Blob Token 1', price: 500 },
    'plasma': { name: 'Plasma Cannon', price: 500 },
    'cloak': { name: 'Cloaking Device', price: 500 },
    'quadlaser': { name: 'Quad Laser', price: 600 },
    'smartmine': { name: 'Smart Mine', price: 650 },
    'gauss': { name: 'Gauss Cannon', price: 700 },
    'helix': { name: 'Helix Cannon', price: 750 },
    'earthshaker': { name: 'Earthshaker Missile', price: 850 },
    'hostage': { name: 'Hostage', price: 900 },
    'phoenix': { name: 'Phoenix Cannon', price: 950 },
    'blob02': { name: 'Blob Token 2', price: 1000 },
    'invuln': { name: 'Invulnerability', price: 1500 },
    'blob03': { name: 'Blob Token 3', price: 2000 },
    'reactor': { name: 'Reactor', price: 2000 },
    'pyro': { name: 'Pyro', price: 3000 },
    'architect': { name: 'Architect', price: -1 }
};

// Setup Store Inventory Management Section
function setupManageStoreInventorySection() {
    console.log('Setting up Store Inventory Management section');
    
    // Search button
    const searchBtn = document.getElementById('search-store-inventory-user-btn');
    if (searchBtn) {
        searchBtn.addEventListener('click', searchStoreInventoryUser);
    }
    
    // Search on Enter key
    const searchInput = document.getElementById('store-inventory-user-search');
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                searchStoreInventoryUser();
            }
        });
    }
    
    // Scan discrepancies button
    const scanBtn = document.getElementById('scan-store-discrepancies-btn');
    if (scanBtn) {
        scanBtn.addEventListener('click', scanStoreDiscrepancies);
    }
    
    // Close discrepancies button
    const closeBtn = document.getElementById('close-discrepancies-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeDiscrepanciesResults);
    }
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                searchStoreInventoryUser();
            }
        });
    }
    
    // Item type selector
    const itemTypeSelect = document.getElementById('store-item-type');
    if (itemTypeSelect) {
        itemTypeSelect.addEventListener('change', updateStoreItemOptions);
    }
    
    // Add item form
    const addItemForm = document.getElementById('add-store-item-form');
    if (addItemForm) {
        addItemForm.addEventListener('submit', addStoreItemToUser);
    }
    
    // Category filter buttons
    document.querySelectorAll('.category-filter-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.category-filter-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            const filter = this.dataset.filter;
            filterCurrentStoreItems(filter);
        });
    });
}

// Search for user by username
async function searchStoreInventoryUser() {
    const searchInput = document.getElementById('store-inventory-user-search');
    const username = searchInput.value.trim();
    
    if (!username) {
        showNotification('Please enter a username', 'warning');
        return;
    }
    
    try {
        // Search in userProfiles
        const profilesRef = collection(db, 'userProfiles');
        const q = query(profilesRef, where('username', '==', username));
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
            showNotification(`User "${username}" not found`, 'error');
            return;
        }
        
        const userDoc = snapshot.docs[0];
        const userData = userDoc.data();
        const userId = userDoc.id;
        
        // Display user's store inventory
        await displayUserStoreInventory(userId, username, userData);
        
    } catch (error) {
        console.error('Error searching for user:', error);
        showNotification('Error searching for user: ' + error.message, 'error');
    }
}

// Display user's store inventory
async function displayUserStoreInventory(userId, username, userData) {
    const managementContainer = document.getElementById('user-store-inventory-management');
    const usernameDisplay = document.getElementById('current-store-inventory-user');
    const pointsDisplay = document.getElementById('store-user-points-display');
    const userIdInput = document.getElementById('store-target-user-id');
    
    // Show management container
    managementContainer.style.display = 'block';
    usernameDisplay.textContent = username;
    pointsDisplay.textContent = (userData.points || 0).toLocaleString();
    userIdInput.value = userId;
    
    // Get user's inventory
    const inventory = userData.inventory || [];
    const equippedToken = userData.equippedToken || null;
    
    // Get user's tokens from userTokens collection
    let userTokens = [];
    try {
        const userTokensRef = doc(db, 'userTokens', userId);
        const userTokensDoc = await getDoc(userTokensRef);
        if (userTokensDoc.exists()) {
            userTokens = userTokensDoc.data().tokens || [];
        }
    } catch (error) {
        console.warn('Error loading userTokens:', error);
    }
    
    // Display items
    displayCurrentStoreItems(inventory, userTokens, equippedToken);
}

// Display current store items
function displayCurrentStoreItems(inventory, userTokens, equippedToken) {
    const listContainer = document.getElementById('current-store-items-list');
    
    if (!listContainer) return;
    
    if (inventory.length === 0 && userTokens.length === 0) {
        listContainer.innerHTML = `
            <div class="empty-items-state">
                <i class="fas fa-shopping-cart"></i>
                <p>No items in inventory</p>
            </div>
        `;
        return;
    }
    
    let itemsHtml = '';
    
    // Parse inventory items (format: "theme_id" or "token_id")
    inventory.forEach(item => {
        const [type, itemId] = item.split('_');
        let itemName = itemId;
        let itemPrice = 0;
        
        if (type === 'theme' && STORE_THEMES[itemId]) {
            itemName = STORE_THEMES[itemId].name;
            itemPrice = STORE_THEMES[itemId].price;
        } else if (type === 'token' && STORE_TOKENS[itemId]) {
            itemName = STORE_TOKENS[itemId].name;
            itemPrice = STORE_TOKENS[itemId].price;
        }
        
        const isEquipped = type === 'token' && equippedToken === itemId;
        const equippedBadge = isEquipped ? '<span class="store-item-equipped-badge"><i class="fas fa-check"></i> Equipped</span>' : '';
        
        itemsHtml += `
            <div class="store-item-entry" data-item-type="${type}" data-item-id="${itemId}">
                <div class="store-item-info">
                    <div class="store-item-icon ${type}-icon">
                        <i class="fas fa-${type === 'theme' ? 'palette' : 'coins'}"></i>
                    </div>
                    <div class="store-item-details">
                        <div class="store-item-name">${itemName}${equippedBadge}</div>
                        <div class="store-item-type">${type === 'theme' ? 'Theme' : 'Token'} • ${itemPrice} points</div>
                    </div>
                </div>
                <button class="store-item-remove-btn" onclick="removeStoreItemFromUser('${type}', '${itemId}')">
                    <i class="fas fa-trash"></i> Remove
                </button>
            </div>
        `;
    });
    
    listContainer.innerHTML = itemsHtml;
}

// Update store item options based on type
function updateStoreItemOptions() {
    const typeSelect = document.getElementById('store-item-type');
    const itemSelect = document.getElementById('store-item-id');
    
    if (!typeSelect || !itemSelect) return;
    
    const selectedType = typeSelect.value;
    
    if (!selectedType) {
        itemSelect.disabled = true;
        itemSelect.innerHTML = '<option value="">Select item type first...</option>';
        return;
    }
    
    itemSelect.disabled = false;
    itemSelect.innerHTML = '<option value="">Select an item...</option>';
    
    if (selectedType === 'theme') {
        Object.entries(STORE_THEMES).forEach(([id, theme]) => {
            const option = document.createElement('option');
            option.value = id;
            option.textContent = `${theme.name} (${theme.price} pts)`;
            itemSelect.appendChild(option);
        });
    } else if (selectedType === 'token') {
        Object.entries(STORE_TOKENS).forEach(([id, token]) => {
            const option = document.createElement('option');
            option.value = id;
            option.textContent = `${token.name} (${token.price} pts)`;
            itemSelect.appendChild(option);
        });
    }
}

// Add store item to user
async function addStoreItemToUser(event) {
    event.preventDefault();
    
    const userId = document.getElementById('store-target-user-id').value;
    const itemType = document.getElementById('store-item-type').value;
    const itemId = document.getElementById('store-item-id').value;
    const reason = document.getElementById('store-item-reason').value.trim();
    
    if (!userId || !itemType || !itemId) {
        showNotification('Please select an item to add', 'warning');
        return;
    }
    
    try {
        const userRef = doc(db, 'userProfiles', userId);
        const userDoc = await getDoc(userRef);
        
        if (!userDoc.exists()) {
            showNotification('User not found', 'error');
            return;
        }
        
        const userData = userDoc.data();
        const currentInventory = userData.inventory || [];
        const itemKey = `${itemType}_${itemId}`;
        
        // Check if user already has this item
        if (currentInventory.includes(itemKey)) {
            showNotification('User already owns this item', 'warning');
            return;
        }
        
        // Add to inventory
        const newInventory = [...currentInventory, itemKey];
        
        await updateDoc(userRef, {
            inventory: newInventory
        });
        
        // If it's a token, also add to userTokens collection
        if (itemType === 'token') {
            const tokenData = STORE_TOKENS[itemId];
            const userTokensRef = doc(db, 'userTokens', userId);
            const userTokensDoc = await getDoc(userTokensRef);
            
            let tokens = [];
            if (userTokensDoc.exists()) {
                tokens = userTokensDoc.data().tokens || [];
            }
            
            tokens.push({
                tokenId: itemId,
                tokenName: tokenData.name,
                category: 'admin-awarded',
                purchasedAt: new Date(),
                price: tokenData.price,
                equipped: false
            });
            
            await setDoc(userTokensRef, {
                userId: userId,
                username: userData.username,
                tokens: tokens,
                lastUpdated: serverTimestamp()
            }, { merge: true });
        }
        
        // Log transaction
        await addDoc(collection(db, 'transactions'), {
            userId: userId,
            userEmail: userData.email || 'N/A',
            itemId: itemKey,
            itemTitle: itemType === 'theme' ? STORE_THEMES[itemId].name : STORE_TOKENS[itemId].name,
            type: 'admin-award',
            category: itemType,
            reason: reason || 'Admin awarded',
            adminEmail: auth.currentUser.email,
            timestamp: serverTimestamp()
        });
        
        showNotification(`Successfully added ${itemType} to user's inventory`, 'success');
        
        // Reload display
        await displayUserStoreInventory(userId, userData.username, {
            ...userData,
            inventory: newInventory
        });
        
        // Reset form
        document.getElementById('add-store-item-form').reset();
        document.getElementById('store-item-id').disabled = true;
        
    } catch (error) {
        console.error('Error adding store item:', error);
        showNotification('Failed to add item: ' + error.message, 'error');
    }
}

// Remove store item from user
window.removeStoreItemFromUser = async function(itemType, itemId) {
    const userId = document.getElementById('store-target-user-id').value;
    const itemKey = `${itemType}_${itemId}`;
    const itemName = itemType === 'theme' ? STORE_THEMES[itemId]?.name : STORE_TOKENS[itemId]?.name;
    
    if (!confirm(`Are you sure you want to remove "${itemName}" from this user's inventory?`)) {
        return;
    }
    
    try {
        const userRef = doc(db, 'userProfiles', userId);
        const userDoc = await getDoc(userRef);
        
        if (!userDoc.exists()) {
            showNotification('User not found', 'error');
            return;
        }
        
        const userData = userDoc.data();
        const currentInventory = userData.inventory || [];
        
        // Remove from inventory
        const newInventory = currentInventory.filter(item => item !== itemKey);
        
        const updateData = { inventory: newInventory };
        
        // If removing equipped token, unequip it
        if (itemType === 'token' && userData.equippedToken === itemId) {
            updateData.equippedToken = null;
        }
        
        await updateDoc(userRef, updateData);
        
        // If it's a token, also remove from userTokens collection
        if (itemType === 'token') {
            const userTokensRef = doc(db, 'userTokens', userId);
            const userTokensDoc = await getDoc(userTokensRef);
            
            if (userTokensDoc.exists()) {
                const tokens = userTokensDoc.data().tokens || [];
                const updatedTokens = tokens.filter(t => t.tokenId !== itemId);
                
                await updateDoc(userTokensRef, {
                    tokens: updatedTokens,
                    lastUpdated: serverTimestamp()
                });
            }
        }
        
        // Log transaction
        await addDoc(collection(db, 'transactions'), {
            userId: userId,
            userEmail: userData.email || 'N/A',
            itemId: itemKey,
            itemTitle: itemName,
            type: 'admin-removal',
            category: itemType,
            reason: 'Admin removed item',
            adminEmail: auth.currentUser.email,
            timestamp: serverTimestamp()
        });
        
        showNotification(`Successfully removed ${itemType} from user's inventory`, 'success');
        
        // Reload display
        await displayUserStoreInventory(userId, userData.username, {
            ...userData,
            inventory: newInventory,
            equippedToken: updateData.equippedToken !== undefined ? updateData.equippedToken : userData.equippedToken
        });
        
    } catch (error) {
        console.error('Error removing store item:', error);
        showNotification('Failed to remove item: ' + error.message, 'error');
    }
};

// Filter current store items
function filterCurrentStoreItems(filter) {
    const items = document.querySelectorAll('.store-item-entry');
    
    items.forEach(item => {
        const itemType = item.dataset.itemType;
        
        if (filter === 'all' || itemType === filter) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}

// Load store inventory data (overview of all users)
async function loadStoreInventoryData() {
    console.log('Loading store inventory overview...');
    showNotification('Store inventory overview feature coming soon!', 'info');
}

// ============================================================================
// STORE DISCREPANCIES SCANNING
// ============================================================================

// Scan for inventory discrepancies
async function scanStoreDiscrepancies() {
    console.log('Scanning for store inventory discrepancies...');
    
    const resultsContainer = document.getElementById('store-discrepancies-results');
    const contentContainer = document.getElementById('discrepancies-content');
    const userManagementSection = document.getElementById('user-store-inventory-management');
    
    // Hide user management section and show results
    if (userManagementSection) {
        userManagementSection.style.display = 'none';
    }
    resultsContainer.style.display = 'block';
    
    // Show loading state
    contentContainer.innerHTML = `
        <div class="discrepancy-loading">
            <i class="fas fa-spinner"></i>
            <p>Scanning all user inventories...</p>
            <p style="font-size: 0.85rem; margin-top: 8px;">This may take a moment</p>
        </div>
    `;
    
    try {
        // Get all users with inventory
        const usersSnapshot = await getDocs(collection(db, 'userProfiles'));
        const discrepancies = [];
        let totalScanned = 0;
        let totalWithInventory = 0;
        
        for (const userDoc of usersSnapshot.docs) {
            totalScanned++;
            const userData = userDoc.data();
            const userId = userDoc.id;
            const username = userData.username || userData.displayName || 'Unknown';
            const inventory = userData.inventory || [];
            
            if (inventory.length === 0) continue;
            
            totalWithInventory++;
            
            // Get all transactions for this user
            const transactionsQuery = query(
                collection(db, 'transactions'),
                where('userId', '==', userId)
            );
            const transactionsSnapshot = await getDocs(transactionsQuery);
            const transactionItems = new Set();
            
            transactionsSnapshot.forEach(doc => {
                const txData = doc.data();
                if (txData.itemId) {
                    transactionItems.add(txData.itemId);
                }
            });
            
            // Find items in inventory without transactions
            const itemsWithoutTransactions = [];
            
            inventory.forEach(item => {
                if (!transactionItems.has(item)) {
                    const [type, itemId] = item.split('_');
                    let itemName = itemId;
                    
                    if (type === 'theme' && STORE_THEMES[itemId]) {
                        itemName = STORE_THEMES[itemId].name;
                    } else if (type === 'token' && STORE_TOKENS[itemId]) {
                        itemName = STORE_TOKENS[itemId].name;
                    }
                    
                    itemsWithoutTransactions.push({
                        fullId: item,
                        type: type,
                        itemId: itemId,
                        name: itemName
                    });
                }
            });
            
            if (itemsWithoutTransactions.length > 0) {
                discrepancies.push({
                    userId: userId,
                    username: username,
                    email: userData.email || 'N/A',
                    items: itemsWithoutTransactions,
                    totalItems: inventory.length,
                    transactionCount: transactionsSnapshot.size
                });
            }
        }
        
        // Display results
        displayDiscrepancyResults(discrepancies, totalScanned, totalWithInventory);
        
    } catch (error) {
        console.error('Error scanning for discrepancies:', error);
        contentContainer.innerHTML = `
            <div class="discrepancy-no-results">
                <i class="fas fa-exclamation-circle" style="color: var(--danger);"></i>
                <p>Error scanning for discrepancies</p>
                <p style="font-size: 0.85rem; margin-top: 8px; color: var(--text-muted);">${error.message}</p>
            </div>
        `;
    }
}

// Display discrepancy results
function displayDiscrepancyResults(discrepancies, totalScanned, totalWithInventory) {
    const contentContainer = document.getElementById('discrepancies-content');
    
    if (discrepancies.length === 0) {
        contentContainer.innerHTML = `
            <div class="discrepancy-no-results">
                <i class="fas fa-check-circle"></i>
                <p>No discrepancies found!</p>
                <p style="font-size: 0.85rem; margin-top: 8px; color: var(--text-muted);">
                    Scanned ${totalScanned} users, ${totalWithInventory} with inventory
                </p>
            </div>
        `;
        return;
    }
    
    // Calculate total items without transactions
    const totalDiscrepantItems = discrepancies.reduce((sum, d) => sum + d.items.length, 0);
    
    let html = `
        <div class="discrepancies-summary">
            <div class="discrepancy-stat">
                <div class="discrepancy-stat-value">${discrepancies.length}</div>
                <div class="discrepancy-stat-label">Users with Issues</div>
            </div>
            <div class="discrepancy-stat">
                <div class="discrepancy-stat-value">${totalDiscrepantItems}</div>
                <div class="discrepancy-stat-label">Items w/o Transactions</div>
            </div>
            <div class="discrepancy-stat">
                <div class="discrepancy-stat-value">${totalScanned}</div>
                <div class="discrepancy-stat-label">Users Scanned</div>
            </div>
        </div>
        
        <div class="discrepancies-list">
    `;
    
    discrepancies.forEach(discrepancy => {
        html += `
            <div class="discrepancy-entry">
                <div class="discrepancy-user-header">
                    <div class="discrepancy-username">
                        <i class="fas fa-exclamation-triangle"></i>
                        ${discrepancy.username}
                    </div>
                    <button class="discrepancy-view-btn" onclick="viewUserFromDiscrepancy('${discrepancy.userId}', '${discrepancy.username}')">
                        <i class="fas fa-eye"></i> View Inventory
                    </button>
                </div>
                <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 12px;">
                    ${discrepancy.items.length} item(s) without transaction • ${discrepancy.transactionCount} total transactions • ${discrepancy.totalItems} total items
                </div>
                <div class="discrepancy-items-list">
        `;
        
        discrepancy.items.forEach(item => {
            const icon = item.type === 'theme' ? 'palette' : 'coins';
            html += `
                <div class="discrepancy-item-badge">
                    <i class="fas fa-${icon}"></i>
                    <span class="discrepancy-item-name">${item.name}</span>
                </div>
            `;
        });
        
        html += `
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    
    contentContainer.innerHTML = html;
}

// View user from discrepancy results
window.viewUserFromDiscrepancy = async function(userId, username) {
    // Hide discrepancies results
    const resultsContainer = document.getElementById('store-discrepancies-results');
    resultsContainer.style.display = 'none';
    
    // Load user data
    try {
        const userRef = doc(db, 'userProfiles', userId);
        const userDoc = await getDoc(userRef);
        
        if (!userDoc.exists()) {
            showNotification('User not found', 'error');
            return;
        }
        
        const userData = userDoc.data();
        
        // Set the search input
        const searchInput = document.getElementById('store-inventory-user-search');
        if (searchInput) {
            searchInput.value = username;
        }
        
        // Display user's store inventory
        await displayUserStoreInventory(userId, username, userData);
        
    } catch (error) {
        console.error('Error loading user:', error);
        showNotification('Error loading user: ' + error.message, 'error');
    }
};

// Close discrepancies results
function closeDiscrepanciesResults() {
    const resultsContainer = document.getElementById('store-discrepancies-results');
    resultsContainer.style.display = 'none';
}

// ============================================================================
// END STORE DISCREPANCIES SCANNING
// ============================================================================

// ============================================================================
// END STORE INVENTORY MANAGEMENT
// ============================================================================

// Edit user ribbons (called from table)
function editUserRibbons(username, ladder) {
    document.getElementById('ribbon-user-search').value = username;
    searchRibbonUser();
}
