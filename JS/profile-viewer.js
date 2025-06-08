import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    getFirestore, doc, getDoc, setDoc, collection, 
    query, where, getDocs, orderBy, limit, startAfter, addDoc 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { firebaseConfig } from './firebase-config.js';
import { evaluatePlayerRibbons, getRibbonHTML, RIBBON_CSS } from './ribbons.js';

// Initialize Firebase once
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Cache for player data to reduce redundant queries
const playerDataCache = new Map();
const containerReferences = {};

// Define constants at the file level (outside the class)
const DEFAULT_PROFILE_IMAGE = "../images/shieldorb.png"; // Path to your blue circular image

// Add this helper function within the file or import if shared
function getContrastColor(hexColor) {
    if (!hexColor) return '#ffffff';
    hexColor = hexColor.replace('#', '');
    if (hexColor.length === 3) {
        hexColor = hexColor.split('').map(char => char + char).join('');
    }
    if (hexColor.length !== 6) return '#ffffff';

    const r = parseInt(hexColor.substring(0, 2), 16);
    const g = parseInt(hexColor.substring(2, 4), 16);
    const b = parseInt(hexColor.substring(4, 6), 16);
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return (yiq >= 128) ? '#000000' : '#ffffff';
}

class ProfileViewer {
    constructor() {
        this.currentProfileData = null;
        this.currentLadder = 'D1';
        this.eloHistoryPagination = { 
            d1: { page: 1, lastVisible: null, firstVisible: null }, 
            d2: { page: 1, lastVisible: null, firstVisible: null },
            d3: { page: 1, lastVisible: null, firstVisible: null }
        };
        this.PAGE_SIZE = 10;
        
        // Add caching for ELO history and username resolution
        this.eloHistoryCache = new Map();
        this.usernameCache = new Map();
        this.playerEloCache = new Map();
        
        this.init();
    }
    
    // Make sure D3 URL parameter is properly handled in the init() function
    init() {
    // Get username and optional ladder from URL
    const urlParams = new URLSearchParams(window.location.search);
    const username = urlParams.get('username');
    const ladder = urlParams.get('ladder');
    
    // Set initial ladder from URL if present
    if (ladder && ladder.toUpperCase() === 'D2') {
        this.currentLadder = 'D2';
    } else if (ladder && ladder.toUpperCase() === 'D3') {
        this.currentLadder = 'D3';
    }
    
    // Create toggle buttons if they don't exist
    const toggleContainer = document.querySelector('.profile-ladder-toggle');
    if (!toggleContainer) {
        // Create the container
        const newToggleContainer = document.createElement('div');
        newToggleContainer.className = 'profile-ladder-toggle';
        
        // Create the buttons
        const buttons = [
            { id: 'profile-d1-toggle', text: 'D1' },
            { id: 'profile-d2-toggle', text: 'D2' },
            { id: 'profile-d3-toggle', text: 'D3' }
        ];
        
        buttons.forEach(btn => {
            const button = document.createElement('button');
            button.id = btn.id;
            button.className = 'ladder-toggle-btn';
            button.textContent = btn.text;
            newToggleContainer.appendChild(button);
        });
        
        // Insert after the profile header
        const profileHeader = document.querySelector('.profile-header');
        if (profileHeader && profileHeader.parentNode) {
            profileHeader.parentNode.insertBefore(newToggleContainer, profileHeader.nextSibling);
        } else {
            // Fallback - insert at the start of content
            const content = document.querySelector('.content');
            if (content) {
                content.insertBefore(newToggleContainer, content.firstChild);
            }
        }
    }
    
    if (username) {
        this.setupToggleButtons();
        this.loadProfile(username);
    } else {
        const container = document.querySelector('.content');
        if (container) {
            container.innerHTML = '<div class="error-message">No username specified.</div>';
        }
    }
}

async displayRibbons(username) {
    try {
        // Check for non-participant
        if (this.currentProfileData?.isNonParticipant) {
            return; // Skip ribbons for non-participants
        }

        // Add ribbon CSS if not already present
        if (!document.getElementById('ribbon-styles')) {
            const styleEl = document.createElement('style');
            styleEl.id = 'ribbon-styles';
            styleEl.textContent = RIBBON_CSS;
            document.head.appendChild(styleEl);
        }

        // Evaluate player ribbons with timeout
        let playerRibbons;
        try {
            playerRibbons = await Promise.race([
                evaluatePlayerRibbons(username, this.currentLadder),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Ribbon evaluation timeout')), 15000)
                )
            ]);
        } catch (timeoutError) {
            console.error('Ribbon evaluation timed out:', timeoutError);
            return; // Skip ribbons on timeout
        }

        // Find or create the stats grid to add ribbons to
        let statsGrid = document.querySelector('.stats-grid');
        if (!statsGrid) {
            // If no stats grid exists, create one
            const profileContent = document.querySelector('.profile-content');
            if (profileContent) {
                statsGrid = document.createElement('div');
                statsGrid.className = 'stats-grid';
                profileContent.appendChild(statsGrid);
            } else {
                return; // Can't find where to put ribbons
            }
        }

        // Remove any existing ribbon section from stats grid
        const existingRibbonSection = statsGrid.querySelector('.ribbon-section');
        if (existingRibbonSection) {
            existingRibbonSection.remove();
        }

        const ribbonCount = Object.keys(playerRibbons).length;

        // Create ribbon section within the stats grid
        const ribbonSection = document.createElement('div');
        ribbonSection.className = 'ribbon-section';

        // Update the ribbon section creation in displayRibbons method
        if (ribbonCount === 0) {
            ribbonSection.innerHTML = `
                <div class="stat-item ribbon-stat-item full-width">
                    <div class="stat-label">RIBBONS</div>
                    <div class="ribbon-rack-empty-inline">
                        <div class="empty-rack-text">No ribbons earned yet</div>
                    </div>
                </div>
            `;
        } else {
            // Sort ribbons by award date (newest first)
            const sortedRibbons = Object.entries(playerRibbons).sort((a, b) => {
                const dateA = a[1].awardedAt ? (a[1].awardedAt.seconds || new Date(a[1].awardedAt).getTime() / 1000) : 0;
                const dateB = b[1].awardedAt ? (b[1].awardedAt.seconds || new Date(b[1].awardedAt).getTime() / 1000) : 0;
                return dateB - dateA;
            });

            // Organize ribbons into rows (3 ribbons per row for military appearance)
            const ribbonsPerRow = 3;
            const ribbonRows = [];
            
            for (let i = 0; i < sortedRibbons.length; i += ribbonsPerRow) {
                const rowRibbons = sortedRibbons.slice(i, i + ribbonsPerRow);
                const rowHTML = rowRibbons
                    .map(([name, data]) => {
                        return getRibbonHTML(name, data);
                    })
                    .join('');
                
                ribbonRows.push(`<div class="ribbon-row">${rowHTML}</div>`);
            }

            // Create the ribbon section as part of stats
            ribbonSection.innerHTML = `
                <div class="stat-item ribbon-stat-item full-width">
                    <div class="stat-label">RIBBONS (${ribbonCount})</div>
                    <div class="ribbon-rack-inline">
                        ${ribbonRows.join('')}
                    </div>
                </div>
            `;
        }

        // Add the ribbon section to the stats grid
        statsGrid.appendChild(ribbonSection);
        
    } catch (error) {
        console.error('Error displaying ribbons:', error);
        // Don't show error, just skip ribbons
    }
}
    
    setupToggleButtons() {
        const d1Button = document.getElementById('profile-d1-toggle');
        const d2Button = document.getElementById('profile-d2-toggle');
        const d3Button = document.getElementById('profile-d3-toggle');
        
        if (d1Button && d2Button && d3Button) {
            // Set initial active state
            if (this.currentLadder === 'D1') {
                d1Button.classList.add('active');
                d2Button.classList.remove('active');
                d3Button.classList.remove('active');
            } else if (this.currentLadder === 'D2') {
                d2Button.classList.add('active');
                d1Button.classList.remove('active');
                d3Button.classList.remove('active');
            } else {
                d3Button.classList.add('active');
                d1Button.classList.remove('active');
                d2Button.classList.remove('active');
            }
            
            // Add click handlers
            d1Button.addEventListener('click', () => {
                this.switchLadder('D1');
            });
            
            d2Button.addEventListener('click', () => {
                this.switchLadder('D2');
            });

            d3Button.addEventListener('click', () => {
                this.switchLadder('D3');
            });
        }
    }
    
    async switchLadder(ladder) {
    // If it's already the current ladder, do nothing
    if (this.currentLadder === ladder) return;
    
    // Set the new ladder
    this.currentLadder = ladder;
    
    // Update active classes on ladder buttons
    document.querySelectorAll('.ladder-toggle-btn').forEach(btn => {
        btn.classList.remove('active');
        
        // Check button ID to determine which ladder it represents
        if ((btn.id === 'profile-d1-toggle' && ladder === 'D1') ||
            (btn.id === 'profile-d2-toggle' && ladder === 'D2') ||
            (btn.id === 'profile-d3-toggle' && ladder === 'D3')) {
            btn.classList.add('active');
        }
    });
    
    // Clear existing stats - important to prevent duplication
    document.querySelectorAll('.stats-grid').forEach(grid => grid.remove());
    
    // Get the current username from the URL
    const urlParams = new URLSearchParams(window.location.search);
    const username = urlParams.get('username');
    
    if (username) {
        // Clear the cache for this username to force fresh data
        const cacheKey = `${username}_${ladder}`;
        playerDataCache.delete(cacheKey);
        
        // Load the user's profile for the selected ladder - use loadProfile, not loadPlayerData
        await this.loadProfile(username);
    } else {
        this.showError('No username provided');
    }
}
    
async loadProfile(username, ladder) {
    // Stop watching previous player
    if (this.currentWatchedPlayer) {
        ribbonSystem.stopWatchingPlayer(this.currentWatchedPlayer.username, this.currentWatchedPlayer.ladder);
    }
    
    try {
        // Check which ladders the player is registered in
        const { inD1, inD2, inD3 } = await this.checkDualLadderStatus(username);
        
        // If not found in current ladder but found in other, switch ladders
        if ((this.currentLadder === 'D1' && !inD1 && (inD2 || inD3)) || 
            (this.currentLadder === 'D2' && !inD2 && (inD1 || inD3)) ||
            (this.currentLadder === 'D3' && !inD3 && (inD1 || inD2))) {
            this.currentLadder = inD1 ? 'D1' : (inD2 ? 'D2' : 'D3');
            this.setupToggleButtons(); // Update active button
        }
        
        // Load player data
        await this.loadPlayerData(username);
        
        // Create containers WITHOUT ribbons (ribbons will be part of stats)
        this.createContainers(['rank-history', 'match-stats', 'player-matchups', 'match-history']);
        
        // Get matches - do this once so we don't repeat the same query
        const matches = await this.getPlayerMatches(username);
        
        // Display sections in parallel for better performance
        await Promise.all([
            this.displayPromotionHistory(username),
            this.displayMatchStats(username, matches),
            this.displayPlayerMatchups(username, matches),
            this.displayMatchHistory(username, matches),
            this.displayRibbons(username) // Add ribbons to stats after stats are loaded
        ]);
        
        // Set up edit functionality
        this.setupEditProfile();
    } catch (error) {
        console.error('Error loading profile:', error);
        this.showError(`Failed to load profile: ${error.message}`);
    }
}
    createContainers(sections) {
        const contentContainer = document.querySelector('.content');
        if (!contentContainer) return;
        
        const profileContainer = document.querySelector('.profile-container');
        if (!profileContainer) return;
        
        // Remove any existing containers
        document.querySelectorAll('.match-history-container').forEach(el => el.remove());
        
        // Create all containers at once using fragment for better performance
        const fragment = document.createDocumentFragment();
        let previousContainer = null;
        
        sections.forEach(section => {
            const container = document.createElement('div');
            container.className = `match-history-container ${section}-container`;
            container.innerHTML = '<p class="loading-text">Loading data...</p>';
            fragment.appendChild(container);
            
            // Store references for later use
            containerReferences[section] = container;
            
            if (previousContainer) {
                previousContainer.insertAdjacentElement('afterend', container);
            } else {
                profileContainer.insertAdjacentElement('afterend', container);
            }
            previousContainer = container;
        });
        
        contentContainer.appendChild(fragment);
    }
    
    async loadPlayerData(username) {
        try {
            // Get cache key that includes ladder
            const cacheKey = `${username}_${this.currentLadder}`;
            
            // Check cache first
            if (playerDataCache.has(cacheKey)) {
                const cachedData = playerDataCache.get(cacheKey);
                this.displayProfile(cachedData);
                await this.loadPlayerStats(username);
                return cachedData;
            }
            
            // Get player details from the appropriate collection
            const playersCollection = this.currentLadder === 'D1' ? 'players' : (this.currentLadder === 'D2' ? 'playersD2' : 'playersD3');
            const playersRef = collection(db, playersCollection);
            const q = query(playersRef, where('username', '==', username));
            const querySnapshot = await getDocs(q);
            
            // Check if player is active in current ladder
            if (querySnapshot.empty) {
                // Check if player is a registered non-participant
                const nonParticipantQuery = query(
                    collection(db, 'nonParticipants'),
                    where('username', '==', username)
                );
                const nonParticipantSnapshot = await getDocs(nonParticipantQuery);
                
                if (!nonParticipantSnapshot.empty) {
                    // This is a non-participant
                    const nonParticipantData = nonParticipantSnapshot.docs[0].data();
                    const userId = nonParticipantData.userId || nonParticipantSnapshot.docs[0].id;
                    
                    // Get their profile data
                    const profileData = await this.getProfileData(userId);
                    
                    const data = {
                        ...nonParticipantData,
                        ...profileData,
                        username,
                        userId,
                        ladder: this.currentLadder,
                        isNonParticipant: true,
                        eloRating: 'N/A'
                    };
                    
                    // Cache and display
                    playerDataCache.set(cacheKey, data);
                    this.displayProfile(data);
                    return data;
                }
                
                // Check for archived data from previous seasons
                const archivedData = await this.checkArchivedData(username);
                if (archivedData) {
                    const data = {
                        ...archivedData,
                        username,
                        ladder: this.currentLadder,
                        isFormerPlayer: true
                    };
                    
                    // Cache and display
                    playerDataCache.set(cacheKey, data);
                    this.displayProfile(data);
                    await this.loadPlayerStats(username);
                    return data;
                }
                
                // Check other ladders
                const otherLadders = ['D1', 'D2', 'D3'].filter(ladder => ladder !== this.currentLadder);
                for (const otherLadder of otherLadders) {
                    const otherPlayersRef = collection(db, otherLadder === 'D1' ? 'players' : (otherLadder === 'D2' ? 'playersD2' : 'playersD3'));
                    const otherQuery = query(otherPlayersRef, where('username', '==', username));
                    const otherSnapshot = await getDocs(otherQuery);
                    
                    if (!otherSnapshot.empty) {
                        // Found in other ladder, suggest switching
                        throw new Error(`Player not found in ${this.currentLadder} ladder. Try selecting the ${otherLadder} ladder.`);
                    }
                }
                
                // Not found in any ladder or as non-participant - AUTO REGISTER AS NON-PARTICIPANT
                // First try to find the user in different collections to get correct username
                let correctUsername = username;
                let userId = null;

                // Try to find user by username in pending registrations first
                const pendingQuery = query(collection(db, 'pendingRegistrations'), where('username', '==', username));
                const pendingSnapshot = await getDocs(pendingQuery);

                if (!pendingSnapshot.empty) {
                    // Found in pending registrations
                    userId = pendingSnapshot.docs[0].id;
                    correctUsername = pendingSnapshot.docs[0].data().username || username;
                } else {
                    // Try to find in users collection
                    const usersQuery = query(collection(db, 'users'), where('username', '==', username));
                    const usersSnapshot = await getDocs(usersQuery);
                    
                    if (!usersSnapshot.empty) {
                        userId = usersSnapshot.docs[0].id;
                        correctUsername = usersSnapshot.docs[0].data().username || username;
                    } else {
                        // Try to find by checking if this is an email-derived username
                        const emailDerivedQuery = query(collection(db, 'users'), where('email', '!=', null));
                        const emailUsers = await getDocs(emailDerivedQuery);
                        
                        // Check if any user's email prefix matches this username
                        const matchingUser = emailUsers.docs.find(doc => {
                            const email = doc.data().email;
                            if (!email) return false;
                            const emailPrefix = email.split('@')[0];
                            return emailPrefix === username;
                        });
                        
                        if (matchingUser) {
                            // Found the user by email prefix match
                            userId = matchingUser.id;
                            correctUsername = matchingUser.data().username || username;
                        } else {
                            // Generate placeholder ID
                            userId = `auto_${username.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
                        }
                    }
                }

                // Create a non-participant record with the correct username
                const nonParticipantData = {
                    username: correctUsername, // Use the correct username!
                    userId: userId,
                    isNonParticipant: true,
                    autoRegistered: true,
                    createdAt: new Date(),
                    lastSeen: new Date()
                };

                // Add to nonParticipants collection
                await setDoc(doc(db, 'nonParticipants', userId), nonParticipantData);

                // Display as non-participant
                const data = {
                    ...nonParticipantData,
                    ladder: this.currentLadder,
                    eloRating: 'N/A'
                };

                // Cache and display
                playerDataCache.set(cacheKey, data);
                this.displayProfile(data);
                return data;
            }
            
            // Regular active player - continue with existing logic
            const playerData = querySnapshot.docs[0].data();
            const userId = playerData.userId || querySnapshot.docs[0].id;
            
            // Get profile data
            const profileData = await this.getProfileData(userId);
            
            // Combine all data
            const data = {
                ...playerData,
                ...profileData,
                username,
                userId,
                ladder: this.currentLadder,
                isActive: true
            };
            
            // Cache for future use
            playerDataCache.set(cacheKey, data);
            
            // Display profile
            this.displayProfile(data);
            await this.loadPlayerStats(username);
            
            return data;
        } catch (error) {
            console.error('Error loading player data:', error);
            this.showError(`Error: ${error.message}`);
            return null;
        }
    }

    // When READING profiles - only reads from userProfiles collection
async getProfileData(userId) {
    let profileData = {};
    
    try {
        // Only read from userProfiles collection
        const userProfileDoc = await getDoc(doc(db, 'userProfiles', userId));
        
        if (userProfileDoc.exists()) {
            profileData = userProfileDoc.data();
        } else {
            console.log(`No profile data found for user ${userId} in userProfiles`);
        }
    } catch (profileError) {
        console.warn('Error fetching profile data:', profileError);
    }
    
    return profileData;
}

    async checkArchivedData(username) {
        try {
            // Check season0records or other archive collections
            const seasonRef = collection(db, 'season0');
            const archivedQuery = query(seasonRef, where('username', '==', username));
            const archivedSnapshot = await getDocs(archivedQuery);
            
            if (!archivedSnapshot.empty) {
                return archivedSnapshot.docs[0].data();
            }
            
            return null;
        } catch (error) {
            console.warn('Error checking archived data:', error);
            return null;
        }
    }
    
    async getPlayerData(username) {
        try {
            // Get cache key that includes ladder
            const cacheKey = `${username}_${this.currentLadder}`;
            
            // Check cache first
            if (playerDataCache.has(cacheKey)) {
                return playerDataCache.get(cacheKey);
            }
            
            // Get player details from the appropriate collection
            const playersCollection = this.currentLadder === 'D1' ? 'players' : (this.currentLadder === 'D2' ? 'playersD2' : 'playersD3');
            const playersRef = collection(db, playersCollection);
            const q = query(playersRef, where('username', '==', username));
            const querySnapshot = await getDocs(q);
            
            if (querySnapshot.empty) {
                console.warn(`Player ${username} not found in ${this.currentLadder} ladder`);
                return null;
            }
            
            const playerData = querySnapshot.docs[0].data();
            const userId = playerData.userId || querySnapshot.docs[0].id;
            
            // Get profile data from userProfiles only
            let profileData = {};
            
            try {
                const userProfileDoc = await getDoc(doc(db, 'userProfiles', userId));
                
                if (userProfileDoc.exists()) {
                    profileData = userProfileDoc.data();
                }
            } catch (profileError) {
                console.warn('Error fetching profile data:', profileError);
                // Continue with player data only
            }
            
            // Combine all data
            const data = {
                ...playerData,
                ...profileData,
                username,
                userId,
                ladder: this.currentLadder
            };
            
            // Cache for future use
            playerDataCache.set(cacheKey, data);
            
            return data;
        } catch (error) {
            console.error(`Error getting player data for ${username}:`, error);
            return null;
        }
    }

// Update the displayProfile method to include the next rank info directly in the main stats bar

displayProfile(data) {
    this.currentProfileData = data;
    
    // Apply ELO rating styles
    const container = document.querySelector('.profile-content');
    if (!container) return;
    
    // Use custom profile image URL or default
    const profileImageUrl = data.profileImageUrl || DEFAULT_PROFILE_IMAGE;
    
    // Check if using default image to apply special class
    const isUsingDefaultImage = !data.profileImageUrl || data.profileImageUrl === DEFAULT_PROFILE_IMAGE;
    
    // OPTION 1: Modern design - update the new profile image
    const profileHeaderSection = document.querySelector('.profile-header') || document.createElement('div');
    profileHeaderSection.className = 'profile-header';
    
    // Add country flag if available
    const countryFlag = data.country ? `<img src="../images/flags/${data.country}.png" alt="${data.country}" class="profile-country-flag">` : '';
    
    profileHeaderSection.innerHTML = `
        <div class="profile-image-container ${isUsingDefaultImage ? 'default-image' : ''}">
            <img src="${profileImageUrl}" alt="Profile Image" 
                 class="profile-image" 
                 onerror="this.src='${DEFAULT_PROFILE_IMAGE}'; this.parentElement.classList.add('default-image');">
            ${countryFlag}
        </div>
    `;
    
    // Insert at the beginning of the container if not already there
    if (!document.querySelector('.profile-header')) {
        container.insertBefore(profileHeaderSection, container.firstChild);
    }
    
    // OPTION 2: Hide the legacy profile image section completely
    const legacyProfileSection = document.querySelector('.profile-image-section');
    if (legacyProfileSection) {
        legacyProfileSection.style.display = 'none';
    }
        
    // Check if this is a non-participant or former player
    const isNonParticipant = data.isNonParticipant === true;
    const isFormerPlayer = data.isFormerPlayer === true;
    
    // Check for user roles
    const userRole = data.role; // 'admin', 'moderator', 'owner', 'helper', 'staff', etc.

    // Read custom role data
    const roleName = data.roleName;
    const roleColor = data.roleColor;
    
    // Role container (separate from status for styling purposes)
    let roleContainer = document.querySelector('.role-container');
    if (!roleContainer && (userRole || roleName)) {
        roleContainer = document.createElement('div');
        roleContainer.className = 'role-container';
    }
    
    // Handle role badges if present
    if (roleName && roleContainer) {
        // Use custom name and color
        roleContainer.innerHTML = `
            <div class="role-badge" style="background-color: ${roleColor || '#808080'}; color: ${getContrastColor(roleColor || '#808080')};">
                ${roleName}
            </div>
        `;
        if (!document.querySelector('.role-container')) {
            container.insertBefore(roleContainer, container.firstChild);
        }
    } else if (userRole && roleContainer) {
        // Format role name for display (capitalize first letter)
        const displayRole = userRole.charAt(0).toUpperCase() + userRole.slice(1).toLowerCase();
        
        roleContainer.innerHTML = `
            <div class="role-badge ${userRole.toLowerCase()}">${displayRole}</div>
        `;
        
        // Insert role container at the top of the profile content
        if (!document.querySelector('.role-container')) {
            container.insertBefore(roleContainer, container.firstChild);
        }
    } else if (roleContainer) {
        // Remove role container if no role is present
        roleContainer.remove();
    }
    
    // Continue with existing non-participant or former player handling
    if (isNonParticipant) {
        const statusContainer = document.querySelector('.profile-status') || document.createElement('div');
        statusContainer.className = 'profile-status';
        statusContainer.innerHTML = `
            <div class="status-badge non-participant">NON-PARTICIPANT</div>
            <p class="status-message">
                ${data.autoRegistered ? 
                'This player has an account but has not joined any ladder.' : 
                'This player is registered but not participating in the ladder.'}
            </p>
        `;
        container.classList.add('non-participant-profile');
        container.insertBefore(statusContainer, roleContainer && roleContainer.parentNode ? roleContainer.nextSibling : container.firstChild);
    } else if (isFormerPlayer) {
        const statusContainer = document.querySelector('.profile-status') || document.createElement('div');
        statusContainer.className = 'profile-status';
        statusContainer.innerHTML = `
            <div class="status-badge former-player">FORMER PLAYER</div>
            <p class="status-message">This player was previously on the ladder. Showing historical data.</p>
        `;
        container.classList.add('former-player-profile');
        container.insertBefore(statusContainer, roleContainer && roleContainer.parentNode ? roleContainer.nextSibling : container.firstChild);
    } else {
        // Remove status indicator if player is active
        if (document.querySelector('.profile-status')) {
            document.querySelector('.profile-status').remove();
        }
        container.classList.remove('non-participant-profile', 'former-player-profile');
    }
    
    // Handle ELO styling
    const eloRating = parseInt(data.eloRating) || 0;
    
    // Remove existing classes
    container.classList.remove('elo-unranked', 'elo-bronze', 'elo-silver', 'elo-gold', 'elo-emerald');
    
    // Add appropriate class
    let eloClass;
    let nextRank = '';
    let eloNeeded = 0;
    
    if (!isNonParticipant) { // Skip for non-participants
        if (eloRating >= 2000) {
            eloClass = 'elo-emerald';
            nextRank = 'Emerald';
            eloNeeded = 0;
        } else if (eloRating >= 1800) {
            eloClass = 'elo-gold';
            nextRank = 'Emerald';
            eloNeeded = 2000 - eloRating;
        } else if (eloRating >= 1600) {
            eloClass = 'elo-silver';
            nextRank = 'Gold';
            eloNeeded = 1800 - eloRating;
        } else if (eloRating >= 1400) {
            eloClass = 'elo-bronze';
            nextRank = 'Silver';
            eloNeeded = 1600 - eloRating;
        } else {
            eloClass = 'elo-unranked';
            nextRank = 'Bronze';
            eloNeeded = 1400 - eloRating;
        }
        container.classList.add(eloClass);
    }
    
    // Format home levels for display
    let homeLevelsDisplay = 'Not set';
    const homeLevels = [data.homeLevel1, data.homeLevel2, data.homeLevel3]
        .filter(level => level && level.trim() !== '');
    
    if (homeLevels.length > 0) {
        homeLevelsDisplay = `Homes: ${homeLevels.join(', ')}`;
    }
    
    // Update profile elements
    const elements = {
        'nickname': data.username,
        'motto-view': data.motto || 'No motto set',
        'favorite-map-view': data.favoriteMap || 'Not set',
        'favorite-weapon-view': data.favoriteWeapon || 'Not set',
        'favorite-subgame-view': data.favoriteSubgame || 'Not set', 
        'timezone-view': data.timezone || 'Not set',
        'division-view': data.division || 'Not set',
        'home-levels-view': homeLevelsDisplay,
        'stats-elo': isNonParticipant ? 'N/A' : (data.eloRating || 'N/A')
    };
    
    for (const [id, value] of Object.entries(elements)) {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    }

    // Create or update the Next Rank element directly in the main stats row
    if (!isNonParticipant && eloRating > 0) {
        // First, check if we need to create a main stats row
        let mainStatsRow = document.querySelector('.stats-row');
        if (!mainStatsRow) {
            // Create main stats row if it doesn't exist
            mainStatsRow = document.createElement('div');
            mainStatsRow.className = 'stats-row';
            container.appendChild(mainStatsRow);
        }

        // Look for existing Next Rank element or create it
        let nextRankElement = document.getElementById('next-rank-col');
        if (!nextRankElement) {
            nextRankElement = document.createElement('div');
            nextRankElement.id = 'next-rank-col';
            nextRankElement.className = 'stats-column';
            
            // Add to the main stats row
            mainStatsRow.appendChild(nextRankElement);
        }

        // Update Next Rank content
        if (eloRating >= 2000) {
            nextRankElement.innerHTML = `
                <div class="stats-label">CURRENT RANK</div>
                <div id="next-rank-value" class="stats-value ${eloClass}">${nextRank}</div>
            `;
        } else {
            nextRankElement.innerHTML = `
                <div class="stats-label">NEXT RANK</div>
                <div id="next-rank-value" class="stats-value ${eloClass}">${nextRank}</div>
                <div class="stats-progress ${eloClass}">${eloNeeded} ELO needed</div>
            `;
        }
    }

    
    
    // Check if this is another user's profile (not the current user's)
    const currentUser = auth.currentUser;
    const isOtherUser = currentUser && this.currentProfileData && 
                       currentUser.uid !== this.currentProfileData.userId;
    
    if (isOtherUser && (data.homeLevel1 || data.homeLevel2 || data.homeLevel3 || data.favoriteSubgame)) {
        this.addInvitationSection(data);
    }
}

    async getPlayerMatches(username) {
        try {
            const matchesCollection = this.currentLadder === 'D1' ? 'approvedMatches' : (this.currentLadder === 'D2' ? 'approvedMatchesD2' : 'approvedMatchesD3');
            const approvedMatchesRef = collection(db, matchesCollection);
            
            // Use separate queries to avoid index requirements
            const [winnerMatches, loserMatches] = await Promise.all([
                getDocs(query(approvedMatchesRef, where('winnerUsername', '==', username), orderBy('createdAt', 'desc'))),
                getDocs(query(approvedMatchesRef, where('loserUsername', '==', username), orderBy('createdAt', 'desc')))
            ]);
            
            // Combine results efficiently
            const matchIds = new Set();
            const matches = [];
            
            const processMatches = (snapshot) => {
                snapshot.forEach(doc => {
                    if (!matchIds.has(doc.id)) {
                        matchIds.add(doc.id);
                        matches.push({
                            id: doc.id,
                            ...doc.data()
                        });
                    }
                });
            };
            
            processMatches(winnerMatches);
            processMatches(loserMatches);
            
            // Sort by date
            return matches.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        } catch (error) {
            console.error('Error fetching matches:', error);
            return [];
        }
    }
    
    // Optimized getPlayerEloData with better caching
    async getPlayerEloData(username) {
        // Use ladder-specific cache key
        const cacheKey = `${username}_${this.currentLadder}_elo`;
        
        if (this.playerEloCache.has(cacheKey)) {
            return this.playerEloCache.get(cacheKey);
        }
        
        try {
            const playersCollection = this.currentLadder === 'D1' ? 'players' : 
                                    (this.currentLadder === 'D2' ? 'playersD2' : 'playersD3');
            const playersRef = collection(db, playersCollection);
            const q = query(playersRef, where('username', '==', username), limit(1)); // Add limit for efficiency
            const querySnapshot = await getDocs(q);
            const playerData = querySnapshot.docs[0]?.data() || {};
            const eloRating = playerData.eloRating || 0;
            
            // Cache the result with TTL
            this.playerEloCache.set(cacheKey, eloRating);
            
            return eloRating;
        } catch (error) {
            console.error(`Error fetching ELO for ${username}:`, error);
            return 0;
        }
    }
    
async displayMatchHistory(username, matches) {
    try {
        const matchHistoryContainer = containerReferences['match-history'];
        if (!matchHistoryContainer) return;
        
        // Check for non-participant
        if (this.currentProfileData?.isNonParticipant) {
            matchHistoryContainer.innerHTML = `
                <h2>Match History</h2>
                <div class="non-participant-notice">
                    <p>This player is not participating in the ladder.</p>
                    <p>No match history is available.</p>
                </div>
            `;
            return;
        }
        
        // Get all player ELOs at once to avoid multiple queries
        const uniquePlayers = new Set();
        matches.forEach(match => {
            uniquePlayers.add(match.winnerUsername);
            uniquePlayers.add(match.loserUsername);
        });
        
        const playerElos = {};
        await Promise.all([...uniquePlayers].map(async (player) => {
            playerElos[player] = await this.getPlayerEloData(player);
        }));
        
        // Get ELO history for this player - use the SAME logic as the working ELO history
        const eloHistoryCollection = this.currentLadder === 'D1' ? 'eloHistory' : 
                                   (this.currentLadder === 'D2' ? 'eloHistoryD2' : 'eloHistoryD3');
        
        const eloHistoryRef = collection(db, eloHistoryCollection);
        
        // Use the same search logic as the working ELO history container
        const playerId = this.currentProfileData?.userId;
        const searchTerms = [username];
        
        if (playerId) {
            searchTerms.push(playerId);
        }
        
        let eloHistoryMap = new Map();
        try {
            // Get ALL ELO history records for this player to match with games
            const eloHistoryQuery = query(
                eloHistoryRef,
                where('player', 'in', searchTerms),
                orderBy('timestamp', 'desc'),
                limit(200) // Increased limit to get more records for better matching
            );
            
            const eloHistorySnapshot = await getDocs(eloHistoryQuery);
            
            // Create a map of match IDs to ELO changes AND also by timestamp proximity
            const eloRecords = [];
            eloHistorySnapshot.forEach(doc => {
                const data = doc.data();
                eloRecords.push({
                    ...data,
                    timestamp: data.timestamp ? data.timestamp.seconds : 0,
                    docId: doc.id
                });
                
                // FALLBACK 1: If there's a matchId, add it to the map
                if (data.matchId) {
                    eloHistoryMap.set(data.matchId, {
                        previousElo: data.previousElo,
                        newElo: data.newElo,
                        change: data.change || (data.newElo - data.previousElo),
                        source: 'matchId'
                    });
                }
                
                // FALLBACK 2: Also try to match by various match ID formats
                if (data.gameId) {
                    eloHistoryMap.set(data.gameId, {
                        previousElo: data.previousElo,
                        newElo: data.newElo,
                        change: data.change || (data.newElo - data.previousElo),
                        source: 'gameId'
                    });
                }
            });
            
            // FALLBACK 3: Match by timestamp proximity (within 10 minutes)
            matches.forEach(match => {
                if (!eloHistoryMap.has(match.id) && match.createdAt) {
                    const matchTimestamp = match.createdAt.seconds;
                    
                    // Find ELO record within 10 minutes of match time (increased from 5)
                    const closeRecord = eloRecords.find(record => 
                        Math.abs(record.timestamp - matchTimestamp) < 600 // 10 minutes
                    );
                    
                    if (closeRecord) {
                        eloHistoryMap.set(match.id, {
                            previousElo: closeRecord.previousElo,
                            newElo: closeRecord.newElo,
                            change: closeRecord.change || (closeRecord.newElo - closeRecord.previousElo),
                            source: 'timestamp'
                        });
                    }
                }
            });
            
            // FALLBACK 4: Sequential matching - match matches to ELO records in chronological order
            const unmatchedMatches = matches.filter(match => !eloHistoryMap.has(match.id));
            const unmatchedRecords = eloRecords.filter(record => 
                !Array.from(eloHistoryMap.values()).some(mapped => 
                    mapped.previousElo === record.previousElo && 
                    mapped.newElo === record.newElo &&
                    Math.abs(mapped.timestamp - record.timestamp) < 60
                )
            ).sort((a, b) => b.timestamp - a.timestamp); // Sort by newest first
            
            // Try to match unmatched items by order and proximity
            unmatchedMatches.forEach((match, index) => {
                if (index < unmatchedRecords.length && !eloHistoryMap.has(match.id)) {
                    const record = unmatchedRecords[index];
                    if (match.createdAt && record.timestamp) {
                        const timeDiff = Math.abs(match.createdAt.seconds - record.timestamp);
                        // If within 30 minutes, consider it a match
                        if (timeDiff < 1800) {
                            eloHistoryMap.set(match.id, {
                                previousElo: record.previousElo,
                                newElo: record.newElo,
                                change: record.change || (record.newElo - record.previousElo),
                                source: 'sequential'
                            });
                        }
                    }
                }
            });
            
            // FALLBACK 5: Score-based matching for remaining unmatched items
            const stillUnmatched = matches.filter(match => !eloHistoryMap.has(match.id));
            const stillUnmatchedRecords = eloRecords.filter(record => 
                !Array.from(eloHistoryMap.values()).some(mapped => 
                    mapped.previousElo === record.previousElo && 
                    mapped.newElo === record.newElo
                )
            );
            
            stillUnmatched.forEach(match => {
                if (eloHistoryMap.has(match.id)) return;
                
                const isWin = match.winnerUsername === username;
                const expectedChange = isWin ? 'positive' : 'negative';
                
                // Find ELO record that matches the expected outcome
                const matchingRecord = stillUnmatchedRecords.find(record => {
                    const actualChange = record.newElo - record.previousElo;
                    const matchesExpectation = (expectedChange === 'positive' && actualChange > 0) || 
                                             (expectedChange === 'negative' && actualChange < 0);
                    
                    // Also check if timestamp is reasonably close (within 24 hours)
                    const timeDiff = match.createdAt ? 
                        Math.abs(match.createdAt.seconds - record.timestamp) : Infinity;
                    
                    return matchesExpectation && timeDiff < 86400; // 24 hours
                });
                
                if (matchingRecord) {
                    eloHistoryMap.set(match.id, {
                        previousElo: matchingRecord.previousElo,
                        newElo: matchingRecord.newElo,
                        change: matchingRecord.change || (matchingRecord.newElo - matchingRecord.previousElo),
                        source: 'outcome'
                    });
                    
                    // Remove from unmatchedRecords to avoid duplicate matching
                    const recordIndex = stillUnmatchedRecords.indexOf(matchingRecord);
                    if (recordIndex > -1) {
                        stillUnmatchedRecords.splice(recordIndex, 1);
                    }
                }
            });
            
        } catch (error) {
            console.warn('Could not load ELO history for match details:', error);
        }
        
        // Helper function
        const getEloClass = (elo) => {
            if (elo >= 2000) return 'elo-emerald';
            if (elo >= 1800) return 'elo-gold';
            if (elo >= 1600) return 'elo-silver';
            if (elo >= 1400) return 'elo-bronze';
            return 'elo-unranked';
        };
        
        // PAGINATION: Split matches into recent (10) and older
        const recentMatches = matches.slice(0, 10);
        const olderMatches = matches.slice(10);
        const totalMatches = matches.length;
        
        // Build match history HTML with pagination
        matchHistoryContainer.innerHTML = `
            <h2>Match History</h2>
            ${totalMatches === 0 ? 
                '<p class="no-matches">No matches found</p>' : 
                `
                <div class="match-history-stats">
                    <p>Showing ${Math.min(10, totalMatches)} of ${totalMatches} matches</p>
                </div>
                <table class="match-history-table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Winner</th>
                            <th>Loser</th>
                            <th>Score</th>
                            <th>Map</th>
                            <th>ELO Change</th>
                        </tr>
                    </thead>
                    <tbody class="recent-matches">
                        ${this.renderMatchRows(recentMatches, username, playerElos, eloHistoryMap, getEloClass)}
                    </tbody>
                    ${olderMatches.length > 0 ? `
                    <tbody class="older-matches" style="display: none;">
                        ${this.renderMatchRows(olderMatches, username, playerElos, eloHistoryMap, getEloClass)}
                    </tbody>
                    ` : ''}

                </table>
                ${olderMatches.length > 0 ? `
                <div class="match-history-pagination">
                    <button class="show-more-matches-btn" onclick="this.style.display='none'; document.querySelector('.older-matches').style.display='table-row-group'; document.querySelector('.show-less-matches-btn').style.display='inline-block';">
                        Show More Matches (${olderMatches.length})
                    </button>
                    <button class="show-less-matches-btn" style="display: none;" onclick="this.style.display='none'; document.querySelector('.older-matches').style.display='none'; document.querySelector('.show-more-matches-btn').style.display='inline-block';">
                        Show Less
                    </button>
                </div>
                ` : ''}

                <div class="match-history-footer">
                    <p class="footer-note">Match data is updated regularly. ELO changes may take time to reflect.</p>
                </div>
                `
            }
        `;
        
        // Add CSS for pagination styling if not already present
        if (!document.getElementById('match-history-pagination-styles')) {
            const styleEl = document.createElement('style');
            styleEl.id = 'match-history-pagination-styles';
            styleEl.textContent = `
                .match-history-stats {
                    margin-bottom: 1rem;
                    color: #aaa;
                    font-size: 0.9rem;
                }
                
                .match-history-pagination {
                    text-align: center;
                    margin-top: 1rem;
                    padding-top: 1rem;
                    border-top: 1px solid #333;
                }
                
                .show-more-matches-btn, .show-less-matches-btn {
                    background: #333;
                    border: 1px solid #555;
                    color: white;
                    padding: 0.75rem 1.5rem;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 0.9rem;
                    transition: all 0.3s ease;
                }
                
                .show-more-matches-btn:hover, .show-less-matches-btn:hover {
                    background: #444;
                    border-color: #666;
                    transform: translateY(-1px);
                }
                
                .no-matches {
                    text-align: center;
                    color: #666;
                    font-style: italic;
                    padding: 2rem;
                }
                
                .elo-change-positive {
                    color: #4CAF50;
                    font-weight: bold;
                }
                .elo-change-negative {
                    color: #F44336;
                    font-weight: bold;
                }
                .elo-change-neutral {
                    color: #888;
                }
                .estimated-change {
                    opacity: 0.8;
                    font-style: italic;
                }
                .match-history-table th:last-child,
                .match-history-table td:last-child {
                    text-align: center;
                    min-width: 120px;
                }
            `;
            document.head.appendChild(styleEl);
        }
    } catch (error) {
        console.error('Error displaying match history:', error);
        this.showErrorInContainer('match-history', 'Failed to load match history');
    }
}

renderMatchRows(matches, username, playerElos, eloHistoryMap, getEloClass) {
    return matches.map(match => {
        const date = match.createdAt ? 
            new Date(match.createdAt.seconds * 1000).toLocaleDateString() : 
            'N/A';
        const isWinner = match.winnerUsername === username;
        const winnerEloClass = getEloClass(playerElos[match.winnerUsername]);
        const loserEloClass = getEloClass(playerElos[match.loserUsername]);
        
        // Get ELO change data for this match
        const eloData = eloHistoryMap.get(match.id);
        let eloChangeDisplay = 'N/A';
        
        if (eloData && eloData.previousElo !== undefined && eloData.newElo !== undefined) {
            const change = eloData.change;
            const changeClass = change > 0 ? 'elo-change-positive' : 
                              change < 0 ? 'elo-change-negative' : 'elo-change-neutral';
            const changeSign = change > 0 ? '+' : '';
            eloChangeDisplay = `
                <span class="${changeClass}" title="Matched via: ${eloData.source}">
                    ${eloData.previousElo} → ${eloData.newElo} (${changeSign}${change})
                </span>
            `;
        } else {
            // FALLBACK 6: Estimate ELO change based on typical patterns
            const isWin = match.winnerUsername === username;
            const currentElo = playerElos[username] || 1500;
            const opponentName = isWin ? match.loserUsername : match.winnerUsername;
            const opponentElo = playerElos[opponentName] || 1500;
            
            // Simple ELO estimation (K-factor of 32)
            const expectedScore = 1 / (1 + Math.pow(10, (opponentElo - currentElo) / 400));
            const actualScore = isWin ? 1 : 0;
            const estimatedChange = Math.round(32 * (actualScore - expectedScore));
            
            if (Math.abs(estimatedChange) > 0) {
                const changeClass = estimatedChange > 0 ? 'elo-change-positive' : 'elo-change-negative';
                const changeSign = estimatedChange > 0 ? '+' : '';
                eloChangeDisplay = `
                    <span class="${changeClass} estimated-change" title="Estimated change">
                        ~${changeSign}${estimatedChange} (est.)
                    </span>
                `;
            } else {
                // Final fallback - show win/loss indicator
                const resultClass = isWin ? 'elo-change-positive' : 'elo-change-negative';
                const resultText = isWin ? 'WIN' : 'LOSS';
                eloChangeDisplay = `
                    <span class="${resultClass}">
                        ${resultText}
                    </span>
                `;
            }
        }
        
        return `
            <tr class="${isWinner ? 'match-won' : 'match-lost'}">
                <td>${date}</td>
                <td>
                    <a href="profile.html?username=${encodeURIComponent(match.winnerUsername)}"
                       class="player-link ${winnerEloClass}">
                        ${match.winnerUsername}
                    </a>
                </td>
                <td>
                    <a href="profile.html?username=${encodeURIComponent(match.loserUsername)}"
                       class="player-link ${loserEloClass}">
                        ${match.loserUsername}
                    </a>
                </td>
                <td>${match.winnerScore} - ${match.loserScore}</td>
                <td>${match.mapPlayed || 'N/A'}</td>
                <td>${eloChangeDisplay}</td>
            </tr>
        `;
    }).join('');
}
    
    async displayMatchStats(username, matches) {
        try {
            const statsContainer = containerReferences['match-stats'];
            if (!statsContainer) return;
            
            // Check for non-participant
            if (this.currentProfileData?.isNonParticipant) {
                statsContainer.innerHTML = `
                    <h2>Match Statistics</h2>
                    <div class="non-participant-notice">
                        <p>This player is not participating in the ladder.</p>
                        <p>No match statistics are available.</p>
                    </div>
                `;
                return;
            }
            
            // Get season number - reused in multiple places
            const seasonCountDoc = await getDoc(doc(db, 'metadata', 'seasonCount'));
            const currentSeason = seasonCountDoc.exists() ? seasonCountDoc.data().count : 1;
            
            statsContainer.innerHTML = `
                <div class="season-label">S${currentSeason}</div>
                <h2>Match Statistics</h2>
                <div class="stats-content">
                    <canvas id="eloChart"></canvas>
                </div>
            `;
            
            // Process match data for chart
            const matchData = matches.map(match => ({
                date: new Date(match.createdAt.seconds * 1000),
                isWinner: match.winnerUsername === username,
                score: match.winnerUsername === username ? match.winnerScore : match.loserScore
            })).sort((a, b) => a.date - b.date);
            
            // Create chart if there's data
            const ctx = document.getElementById('eloChart')?.getContext('2d');
            if (ctx) {
                try {
                    new Chart(ctx, {
                        type: 'line',
                        data: {
                            labels: matchData.map(match => match.date.toLocaleDateString()),
                            datasets: [{
                                label: 'Score History',
                                data: matchData.map(match => match.score),
                                borderColor: 'rgb(75, 192, 192)',
                                tension: 0.1,
                                fill: false
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                                legend: {
                                    labels: { color: 'white' }
                                }
                            },
                            scales: {
                                y: {
                                    beginAtZero: true,
                                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                                    ticks: { color: 'white' }
                                },
                                x: {
                                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                                    ticks: { color: 'white' }
                                }
                            }
                        }
                    });
                } catch (chartError) {
                    console.error('Error creating chart:', chartError);
                    statsContainer.innerHTML += '<p class="error-message">Error displaying chart</p>';
                }
            }
        } catch (error) {
            console.error('Error displaying match stats:', error);
            this.showErrorInContainer('match-stats', 'Failed to load match statistics');
        }
    }
    
    async displayPlayerMatchups(username, matches) {
        try {
            const matchupsContainer = containerReferences['player-matchups'];
            if (!matchupsContainer) return;
            
            // Check for non-participant
            if (this.currentProfileData?.isNonParticipant) {
                matchupsContainer.innerHTML = `
                    <h2>Player Matchups</h2>
                    <div class="non-participant-notice">
                        <p>This player is not participating in the ladder.</p>
                        <p>No player matchups are available.</p>
                    </div>
                `;
                return;
            }
            
            // Calculate matchups in one pass through the data
            const matchups = matches.reduce((acc, match) => {
                const opponent = match.winnerUsername === username ? match.loserUsername : match.winnerUsername;
                const isWin = match.winnerUsername === username;
                
                if (!acc[opponent]) {
                    acc[opponent] = { wins: 0, losses: 0, total: 0 };
                }
                
                acc[opponent].total++;
                acc[opponent][isWin ? 'wins' : 'losses']++;
                
                return acc;
            }, {});
            
            // Sort by most played
            const sortedMatchups = Object.entries(matchups)
                .sort((a, b) => b[1].total - a[1].total);
            
            // Get season information
            const seasonCountDoc = await getDoc(doc(db, 'metadata', 'seasonCount'));
            const currentSeason = seasonCountDoc.exists() ? seasonCountDoc.data().count : 1;
            
            // Build the matchups table
            matchupsContainer.innerHTML = `
                <div class="season-label">S${currentSeason}</div>
                <h2>Player Matchups</h2>
                <table class="match-history-table">
                    <thead>
                        <tr>
                            <th>Opponent</th>
                            <th>Games Played</th>
                            <th>Wins</th>
                            <th>Losses</th>
                            <th>Win Rate</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${sortedMatchups.length === 0 ?
                            '<tr><td colspan="5">No matchups found</td></tr>' :
                            sortedMatchups.map(([opponent, stats]) => {
                                const winRate = ((stats.wins / stats.total) * 100).toFixed(1);
                                return `
                                    <tr>
                                        <td>
                                            <a href="profile.html?username=${encodeURIComponent(opponent)}"
                                               class="player-link">
                                                ${opponent}
                                            </a>
                                        </td>
                                        <td>${stats.total}</td>
                                        <td class="wins">${stats.wins}</td>
                                        <td class="losses">${stats.losses}</td>
                                        <td>${winRate}%</td>
                                    </tr>
                                `;
                            }).join('')
                        }
                    </tbody>
                </table>
            `;
        } catch (error) {
            console.error('Error displaying player matchups:', error);
            this.showErrorInContainer('player-matchups', 'Failed to load player matchups');
        }
    }
    
    async displayPromotionHistory(username) {
        try {
            const promotionContainer = containerReferences['rank-history'];
            if (!promotionContainer) {
                console.error('Promotion history container not found');
                return;
            }
            
            // Check for non-participant
            if (this.currentProfileData?.isNonParticipant) {
                promotionContainer.innerHTML = `
                    <h2>Rank History</h2>
                    <div class="non-participant-notice">
                        <p>This player is not participating in the ladder.</p>
                        <p>No rank history is available.</p>
                    </div>
                `;
                return;
            }
            
            // Update to use ladder-specific collections
            const eloHistoryCollection = this.currentLadder === 'D1' ? 'eloHistory' : (this.currentLadder === 'D2' ? 'eloHistoryD2' : 'eloHistoryD3');
            const eloHistoryRef = collection(db, eloHistoryCollection);
            const q = query(
                eloHistoryRef,
                where('player', '==', username),
                where('type', 'in', ['promotion', 'demotion']),
                orderBy('timestamp', 'desc')
            );
            
            const snapshot = await getDocs(q);
            
            // Handle no records case
            if (snapshot.empty) {
                promotionContainer.innerHTML = `
                    <h2>Rank History</h2>
                    <p class="no-data">No promotion or demotion history available.</p>
                `;
                return;
            }
            
            // Process the data
            const promotionRecords = snapshot.docs.map(doc => ({
                ...doc.data(),
                id: doc.id,
                date: doc.data().timestamp ? new Date(doc.data().timestamp.seconds * 1000) : new Date()
            }));
            
            // Get season information
            const seasonCountDoc = await getDoc(doc(db, 'metadata', 'seasonCount'));
            const currentSeason = seasonCountDoc.exists() ? seasonCountDoc.data().count : 1;
            
            // Split records: first 3 and the rest
            const initialRecords = promotionRecords.slice(0, 3);
            const additionalRecords = promotionRecords.slice(3);
            const hasMoreRecords = additionalRecords.length > 0;
            
            // Build the promotion history table
            promotionContainer.innerHTML = `
                <div class="season-label">S${currentSeason}</div>
                <h2>Rank History</h2>
                <table class="match-history-table promotion-table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Event</th>
                            <th>Rank Achieved</th>
                            <th>Previous ELO</th>
                            <th>New ELO</th>
                            <th>Change</th>
                        </tr>
                    </thead>
                    <tbody class="initial-records">
                        ${initialRecords.map(record => {
                            const dateDisplay = record.date.toLocaleDateString();
                            const isPromotion = record.type === 'promotion';
                            const changeValue = record.newElo - record.previousElo;
                            
                            return `
                                <tr class="${isPromotion ? 'promotion-row' : 'demotion-row'}">
                                    <td>${dateDisplay}</td>
                                    <td class="event-type">
                                        <span class="event-badge ${isPromotion ? 'promotion' : 'demotion'}">
                                            ${isPromotion ? 'PROMOTION' : 'DEMOTION'}
                                        </span>
                                    </td>
                                    <td>
                                        <span class="rank-name ${record.rankAchieved.toLowerCase()}">
                                            ${record.rankAchieved}
                                        </span>
                                    </td>
                                    <td>${record.previousElo}</td>
                                    <td>${record.newElo}</td>
                                    <td class="${isPromotion ? 'positive-change' : 'negative-change'}">
                                        ${isPromotion ? '+' : ''}${changeValue}
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                    ${hasMoreRecords ? `
                    <tbody class="additional-records" style="display: none;">
                        ${additionalRecords.map(record => {
                            const dateDisplay = record.date.toLocaleDateString();
                            const isPromotion = record.type === 'promotion';
                            const changeValue = record.newElo - record.previousElo;
                            
                            return `
                                <tr class="${isPromotion ? 'promotion-row' : 'demotion-row'}">
                                    <td>${dateDisplay}</td>
                                    <td class="event-type">
                                        <span class="event-badge ${isPromotion ? 'promotion' : 'demotion'}">
                                            ${isPromotion ? 'PROMOTION' : 'DEMOTION'}
                                        </span>
                                    </td>
                                    <td>
                                        <span class="rank-name ${record.rankAchieved.toLowerCase()}">
                                            ${record.rankAchieved}
                                        </span>
                                    </td>
                                    <td>${record.previousElo}</td>
                                    <td>${record.newElo}</td>
                                    <td class="${isPromotion ? 'positive-change' : 'negative-change'}">
                                        ${isPromotion ? '+' : ''}${changeValue}
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                    ` : ''}
                </table>
                ${hasMoreRecords ? `
                <div class="show-more-container">
                    <button class="show-more-btn">Show More (${additionalRecords.length})</button>
                    <button class="show-less-btn" style="display: none;">Show Less</button>
                </div>
                ` : ''}
            `;
            
            // Add toggle functionality if there are additional records
            if (hasMoreRecords) {
                const showMoreBtn = promotionContainer.querySelector('.show-more-btn');
                const showLessBtn = promotionContainer.querySelector('.show-less-btn');
                const additionalRecordsEl = promotionContainer.querySelector('.additional-records');
                
                showMoreBtn.addEventListener('click', () => {
                    additionalRecordsEl.style.display = 'table-row-group';
                    showMoreBtn.style.display = 'none';
                    showLessBtn.style.display = 'inline-block';
                });
                
                showLessBtn.addEventListener('click', () => {
                    additionalRecordsEl.style.display = 'none';
                    showMoreBtn.style.display = 'inline-block';
                    showLessBtn.style.display = 'none';
                });
            }
            
            // Add styles if not already present
            if (!document.getElementById('promotion-styles')) {
                const styleEl = document.createElement('style');
                styleEl.id = 'promotion-styles';
                styleEl.textContent = `
                    .promotion-table .event-badge {
                        display: inline-block;
                        padding: 2px 8px;
                        border-radius: 4px;
                        font-size: 12px;
                        font-weight: bold;
                    }
                    .promotion-table .event-badge.promotion {
                        background-color: #4CAF50;
                        color: white;
                    }
                    .promotion-table .event-badge.demotion {
                        background-color: #F44336;
                        color: white;
                    }
                    .promotion-table .rank-name {
                        font-weight: bold;
                        font-size: 0.85em;
                    }
                    .promotion-table .rank-name.bronze {
                        color: #CD7F32;
                    }
                    .promotion-table .rank-name.silver {
                        color: #C0C0C0;
                    }
                    .promotion-table .rank-name.gold {
                        color: #FFD700;
                    }
                    .promotion-table .rank-name.emerald {
                        color: #50C878;
                    }
                    .promotion-table .positive-change {
                        color: #4CAF50;
                        font-weight: bold;
                    }
                    .promotion-table .negative-change {
                        color: #F44336;
                        font-weight: bold;
                    }
                    .show-more-container {
                        text-align: center;
                        margin-top: 10px;
                    }
                    .show-more-btn, .show-less-btn {
                        background-color: #333;
                        border: 1px solid #666;
                        color: white;
                        padding: 5px 15px;
                        border-radius: 4px;
                        cursor: pointer;
                        transition: background-color 0.2s;
                    }
                    .show-more-btn:hover, .show-less-btn:hover {
                        background-color: #444;
                    }
                `;
                document.head.appendChild(styleEl);
            }
        } catch (error) {
            console.error('Error loading promotion history:', error);
            this.showErrorInContainer('rank-history', `Failed to load ${this.currentLadder} rank history`);
        }
    }
    
    async loadPlayerStats(username) {
        if (!username) return;
        try {
            // Direct Firebase query for player data - bypass cache
            const playersCollection = this.currentLadder === 'D1' ? 'players' : (this.currentLadder === 'D2' ? 'playersD2' : 'playersD3');
            const playersRef = collection(db, playersCollection);
            const q = query(playersRef, where('username', '==', username));
            const querySnapshot = await getDocs(q);
            
            if (querySnapshot.empty) {
                this.setDefaultStats();
                return;
            }
            
            const playerData = querySnapshot.docs[0].data();
            
            // Get matches for this player
            const matches = await this.getPlayerMatches(username);
            
            // Calculate stats
            const stats = {
                wins: 0,
                losses: 0,
                totalKills: 0,
                totalDeaths: 0,
                totalMatches: matches.length
            };
            
            // Process match data
            matches.forEach(match => {
                const isWinner = match.winnerUsername === username;
                if (isWinner) {
                    stats.wins++;
                    stats.totalKills += parseInt(match.winnerScore) || 0;
                    stats.totalDeaths += parseInt(match.loserScore) || 0;
                } else {
                    stats.losses++;
                    stats.totalKills += parseInt(match.loserScore) || 0;
                    stats.totalDeaths += parseInt(match.winnerScore) || 0;
                }
            });
            
            // Calculate derived stats
            stats.kda = stats.totalDeaths > 0 ? 
                (stats.totalKills / stats.totalDeaths).toFixed(2) : 
                stats.totalKills.toFixed(2);
            
            stats.winRate = stats.totalMatches > 0 ? 
                ((stats.wins / stats.totalMatches) * 100).toFixed(1) : 0;
            
            // Add next rank calculation
            const eloRating = parseInt(playerData.eloRating) || 0;
            let nextRank = '';
            let eloNeeded = 0;
            let eloClass = '';
            
            if (eloRating >= 2000) {
                nextRank = 'Emerald';
                eloNeeded = 0;
                eloClass = 'elo-emerald';
            } else if (eloRating >= 1800) {
                nextRank = 'Emerald';
                eloNeeded = 2000 - eloRating;
                eloClass = 'elo-gold';
            } else if (eloRating >= 1600) {
                nextRank = 'Gold';
                eloNeeded = 1800 - eloRating;
                eloClass = 'elo-silver';
            } else if (eloRating >= 1400) {
                nextRank = 'Silver';
                eloNeeded = 1600 - eloRating;
                eloClass = 'elo-bronze';
            } else {
                nextRank = 'Bronze';
                eloNeeded = 1400 - eloRating;
                eloClass = 'elo-unranked';
            }
            
            // IMPORTANT: Check if we already have stats at the bottom of the page
            // and remove them if they exist to prevent duplication
            const existingBottomStatsGrid = document.querySelector('.profile-content > .stats-grid:last-child');
            if (existingBottomStatsGrid) {
                existingBottomStatsGrid.remove();
            }
            
            // Update the existing stats if they exist
            const updateExistingStats = () => {
                const elements = {
                    'stats-matches': stats.totalMatches,
                    'stats-wins': stats.wins,
                    'stats-losses': stats.losses,
                    'stats-kd': stats.kda,
                    'stats-winrate': `${stats.winRate}%`,
                    'stats-elo': playerData.eloRating || 'N/A'
                };
                
                // Update all elements at once
                for (const [id, value] of Object.entries(elements)) {
                    const element = document.getElementById(id);
                    if (element) {
                        element.textContent = value;
                    }
                }
                
                // Update or add the next rank item
                const statsGrid = document.querySelector('.stats-grid');
                if (statsGrid) {
                    let nextRankItem = statsGrid.querySelector('.next-rank');
                    if (!nextRankItem) {
                        nextRankItem = document.createElement('div');
                        nextRankItem.className = 'stat-item next-rank';
                        statsGrid.appendChild(nextRankItem);
                    }
                    
                    // Set the content for next rank
                    if (eloRating >= 2000) {
                        nextRankItem.innerHTML = `
                            <div class="stat-label">CURRENT RANK</div>
                            <div class="stat-value ${eloClass}">${nextRank}</div>
                        `;
                    } else {
                        nextRankItem.innerHTML = `
                            <div class="stat-label">NEXT RANK</div>
                            <div class="stat-value ${eloClass}">${nextRank}</div>
                            <div class="stat-progress ${eloClass}">${eloNeeded} ELO needed</div>
                        `;
                    }
                }
            };
            
            // If we have existing stats (top row), just update them
            if (document.getElementById('stats-matches')) {
                updateExistingStats();
            } else {
                // Create a new stats grid with all stats
                this.createStatsGrid(stats, playerData.eloRating, nextRank, eloNeeded, eloClass);
            }
        } catch (error) {
            this.setDefaultStats();
        }
    }

    // New helper method to create stats grid
    createStatsGrid(stats, eloRating, nextRank, eloNeeded, eloClass) {
        // Create the stats grid
        const statsGrid = document.createElement('div');
        statsGrid.className = 'stats-grid';
        
        // Create the standard stat items
        const statItems = [
            { id: 'stats-matches', label: 'MATCHES', value: stats.totalMatches },
            { id: 'stats-wins', label: 'WINS', value: stats.wins },
            { id: 'stats-losses', label: 'LOSSES', value: stats.losses },
            { id: 'stats-kd', label: 'K/D', value: stats.kda },
            { id: 'stats-winrate', label: 'WIN RATE', value: `${stats.winRate}%` },
            { id: 'stats-elo', label: 'ELO RATING', value: eloRating || 'N/A' }
        ];
        
        // Add all stat items to the grid
        statItems.forEach(item => {
            const statItem = document.createElement('div');
            statItem.className = 'stat-item';
            statItem.innerHTML = `
                <div class="stat-label">${item.label}</div>
                <div id="${item.id}" class="stat-value">${item.value}</div>
            `;
            statsGrid.appendChild(statItem);
        });
        
        // Add the next rank item
        const nextRankItem = document.createElement('div');
        nextRankItem.className = 'stat-item next-rank';
        
        if (eloRating >= 2000) {
            nextRankItem.innerHTML = `
                <div class="stat-label">CURRENT RANK</div>
                <div class="stat-value ${eloClass}">${nextRank}</div>
            `;
        } else {
            nextRankItem.innerHTML = `
                <div class="stat-label">NEXT RANK</div>
                <div class="stat-value ${eloClass}">${nextRank}</div>
                <div class="stat-progress ${eloClass}">${eloNeeded} ELO needed</div>
            `;
        }
        
        // Append the new stats grid to the profile content
        const contentContainer = document.querySelector('.profile-content');
        if (contentContainer) {
            contentContainer.appendChild(statsGrid);
        }
    }
    
    setDefaultStats() {
        const defaultStats = {
            'stats-matches': '0',
            'stats-wins': '0',
            'stats-losses': '0',
            'stats-kd': '0.00',
            'stats-winrate': '0%',
            'stats-elo': 'N/A'
        };

        for (const [id, value] of Object.entries(defaultStats)) {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = value;
            }
        }
    }
    
    showError(message) {
        const container = document.querySelector('.content');
        if (container) {
            container.innerHTML = `<div class="error-message">${message}</div>`;
        }
    }
    
    showErrorInContainer(containerKey, message) {
        const container = containerReferences[containerKey];
        if (container) {
            container.innerHTML = `
                <h2>${containerKey.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}</h2>
                <div class="error-message">${message}</div>
            `;
        }
    }
    
    toggleEditMode(isEditing) {
        const viewMode = document.querySelector('.view-mode');
        const editMode = document.querySelector('.edit-mode');
        
        if (!viewMode || !editMode) return;
        
        if (isEditing && this.currentProfileData) {
            // Update form fields
            const editFields = {
                'profile-image-url': this.currentProfileData.profileImageUrl || '',
                'motto-edit': this.currentProfileData.motto || '',
                'favorite-map-edit': this.currentProfileData.favoriteMap || '',
                'favorite-weapon-edit': this.currentProfileData.favoriteWeapon || '',
                'favorite-subgame-edit': this.currentProfileData.favoriteSubgame || '',
                'home-level-1': this.currentProfileData.homeLevel1 || '',
                'home-level-2': this.currentProfileData.homeLevel2 || '',
                'home-level-3': this.currentProfileData.homeLevel3 || '',
                'country-selector': this.currentProfileData.country || ''
            };
            
            // Fill form fields
            for (const [id, value] of Object.entries(editFields)) {
                const element = document.getElementById(id);
                if (element) element.value = value;
            }
            
            // Show edit mode
            viewMode.style.display = 'none';
            editMode.style.display = 'block';
        } else {
            // Show view mode
            viewMode.style.display = 'block';
            editMode.style.display = 'none';
        }
    }

    // When SAVING profiles - preserves all existing data in userProfiles
async handleSubmit(event) {
    event.preventDefault();
    const user = auth.currentUser;
    
    if (!user) {
        this.showError('You must be logged in to edit your profile');
        return;
    }

    try {
        // Get form values
        const profileImageUrl = document.getElementById('profile-image-url').value.trim();
        const motto = document.getElementById('motto-edit').value.trim();
        const favoriteMap = document.getElementById('favorite-map-edit').value.trim();
        const favoriteWeapon = document.getElementById('favorite-weapon-edit').value.trim();
        const favoriteSubgame = document.getElementById('favorite-subgame-edit').value.trim(); 
        const homeLevel1 = document.getElementById('home-level-1').value.trim();
        const homeLevel2 = document.getElementById('home-level-2').value.trim();
        const homeLevel3 = document.getElementById('home-level-3').value.trim();
        // Get country selection
        const country = document.getElementById('country-selector').value.trim();
        // Add these missing fields
        const division = document.getElementById('division-edit').value.trim();
        const timezone = document.getElementById('timezone-edit').value.trim();

        // Update profile data
        const profileData = {
            profileImageUrl,
            motto,
            favoriteMap,
            favoriteWeapon,
            favoriteSubgame,
            homeLevel1,
            homeLevel2,
            homeLevel3,
            country,
            division,  // Add division (Favorite Descent)
            timezone,  // Add timezone
            updatedAt: new Date()
        };

        // First, get ALL existing profile data
        let existingData = {};
        const userProfileDoc = await getDoc(doc(db, 'userProfiles', user.uid));
        if (userProfileDoc.exists()) {
            existingData = userProfileDoc.data();
        }
        
        // Get current username - either from Firebase Auth or existing data
        const username = user.displayName || existingData.username || this.currentProfileData?.username || 'Anonymous';
        
        // Merge with existing data
        const updatedProfileData = {
            ...existingData, // Preserve ALL existing fields
            ...profileData, // Update with new data
            username: username // Add username to profile document
        };

        // Save to Firestore - ONLY to userProfiles
        await setDoc(doc(db, 'userProfiles', user.uid), updatedProfileData);
        
        // Update cache
        if (username && playerDataCache.has(username)) {
            const cachedData = playerDataCache.get(username);
            playerDataCache.set(username, { ...cachedData, ...updatedProfileData });
        }
        
        // Update display
        this.toggleEditMode(false);
        this.displayProfile({
            ...this.currentProfileData,
            ...updatedProfileData,
            username: username,
            userId: user.uid
        });
        
        // Show success message
        this.showSuccessMessage('Profile updated successfully');
    } catch (error) {
        console.error('Error saving profile:', error);
        this.showError('Failed to save profile changes');
    }
}

// Add this helper method for success messages
showSuccessMessage(message) {
    // You can implement this to show a green success notification
    const container = document.querySelector('.profile-container');
    if (container) {
        const notification = document.createElement('div');
        notification.className = 'success-message';
        notification.textContent = message;
        container.appendChild(notification);
        
        // Remove after 3 seconds
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }
}
    
    // Updated setupEditProfile method to fix cancel button functionality
setupEditProfile() {
    const editButton = document.getElementById('edit-profile');
    const cancelButton = document.querySelector('.cancel-btn');
    const profileForm = document.getElementById('profile-form');
    const viewMode = document.querySelector('.view-mode');
    const editMode = document.querySelector('.edit-mode');

    if (!editButton || !cancelButton || !profileForm || !viewMode || !editMode) {
        console.warn("Edit profile elements not found, skipping setup.");
        return;
    }

    // Check if the current user is viewing their own profile
    const currentUser = auth.currentUser;
    const isOwnProfile = currentUser && this.currentProfileData && 
                        currentUser.uid === this.currentProfileData.userId;

    if (isOwnProfile) {
        // Show the edit button only if it's the user's own profile
        editButton.style.display = 'inline-block';
        
        // Clear existing listeners 
        const newEditButton = editButton.cloneNode(false); // Clone without children
        newEditButton.textContent = editButton.textContent;
        editButton.parentNode.replaceChild(newEditButton, editButton);
        
        // Store reference to 'this' for event handlers
        const self = this;
        
        // Add click handler to edit button
        newEditButton.addEventListener('click', function() {
            self.toggleEditMode(true);
        });
        
        // Clear cancel button listeners and recreate
        const newCancelButton = cancelButton.cloneNode(false);
        newCancelButton.textContent = cancelButton.textContent;
        cancelButton.parentNode.replaceChild(newCancelButton, cancelButton);
        
        // Important: Add event listener with explicit preventDefault and 'this' binding
        newCancelButton.addEventListener('click', function(e) {
            e.preventDefault(); // Prevent form submission
            e.stopPropagation(); // Stop event bubbling
            self.toggleEditMode(false);
        });
        
        // Update form with new submit handler
        const newProfileForm = document.createElement('form');
        newProfileForm.id = 'profile-form';
        newProfileForm.className = profileForm.className;
        newProfileForm.innerHTML = profileForm.innerHTML;
        profileForm.parentNode.replaceChild(newProfileForm, profileForm);
        
        // Re-acquire the cancel button from the new form
        const newFormCancelBtn = newProfileForm.querySelector('.cancel-btn');
        if (newFormCancelBtn) {
            newFormCancelBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                self.toggleEditMode(false);
            });
        }
        
        // Add form submit handler
        newProfileForm.addEventListener('submit', function(e) {
            self.handleSubmit(e);
        });

        // Ensure view mode is visible initially, edit mode is hidden
        viewMode.style.display = 'block';
        editMode.style.display = 'none';
    } else {
        // Hide the edit button if it's not the user's own profile
        editButton.style.display = 'none';
        // Ensure edit mode is hidden
        editMode.style.display = 'none';
        // Ensure view mode is visible
        viewMode.style.display = 'block';
    }
}

    async checkDualLadderStatus(username) {
        try {
            // Check if player exists in all ladders
            const [d1Snapshot, d2Snapshot, d3Snapshot] = await Promise.all([
                getDocs(query(collection(db, 'players'), where('username', '==', username), limit(1))),
                getDocs(query(collection(db, 'playersD2'), where('username', '==', username), limit(1))),
                getDocs(query(collection(db, 'playersD3'), where('username', '==', username), limit(1)))
            ]);
            
            const inD1 = !d1Snapshot.empty;
            const inD2 = !d2Snapshot.empty;
            const inD3 = !d3Snapshot.empty;
            
            // Update toggle button visibility based on registration
            const d1Button = document.getElementById('profile-d1-toggle');
            const d2Button = document.getElementById('profile-d2-toggle');
            const d3Button = document.getElementById('profile-d3-toggle');
            
            if (d1Button && d2Button && d3Button) {
                // Use inline-block instead of block for better button styling
                d1Button.style.display = inD1 ? 'inline-block' : 'none';
                d2Button.style.display = inD2 ? 'inline-block' : 'none';
                d3Button.style.display = inD3 ? 'inline-block' : 'none';
                
                // Fix the toggle container visibility logic
                const toggleContainer = document.querySelector('.profile-ladder-toggle');
                if (toggleContainer) {
                    // Show container if player is in ANY ladder
                    const inAnyLadder = inD1 || inD2 || inD3;
                    // Only show multiple toggle buttons if in more than one ladder
                    toggleContainer.style.display = inAnyLadder ? 'flex' : 'none';
                }
                
                console.log(`Ladder registration - D1: ${inD1}, D2: ${inD2}, D3: ${inD3}`);
            }
            
            return { inD1, inD2, inD3 };
        } catch (error) {
            console.error('Error checking ladder status:', error);
            return { inD1: false, inD2: false, inD3: false };
        }
    }


addInvitationSection(profileData) {
    // Remove existing invitation section if it exists
    const existingSection = document.querySelector('.invitation-section');
    if (existingSection) {
        existingSection.remove();
    }
    
    const container = document.querySelector('.profile-container');
    if (!container) return;
    
    // Get available home levels and subgame
    const homeLevels = [profileData.homeLevel1, profileData.homeLevel2, profileData.homeLevel3]
        .filter(level => level && level.trim() !== '');
    const favoriteSubgame = profileData.favoriteSubgame;
    
    if (homeLevels.length === 0 && !favoriteSubgame) {
        return; // No homes or subgame to invite to
    }
    
    // Get user's rank for styling
    const eloRating = parseInt(profileData.eloRating) || 0;
    let rankClass = '';
    let rankName = '';
    
    if (eloRating >= 2000) {
        rankClass = 'elo-emerald';
        rankName = 'Emerald';
    } else if (eloRating >= 1800) {
        rankClass = 'elo-gold';
        rankName = 'Gold';
    } else if (eloRating >= 1600) {
        rankClass = 'elo-silver';
        rankName = 'Silver';
    } else if (eloRating >= 1400) {
        rankClass = 'elo-bronze';
        rankName = 'Bronze';
    } else {
        rankClass = 'elo-unranked';
        rankName = 'Unranked';
    }
    
    const invitationSection = document.createElement('div');
    invitationSection.className = `invitation-section ${rankClass}`;
    
    // Create consolidated button content
    const allInvites = [
        ...homeLevels.map(level => ({ type: 'home', value: level, icon: 'map', label: level })),
        ...(favoriteSubgame ? [{ type: 'subgame', value: favoriteSubgame, icon: 'gamepad', label: favoriteSubgame }] : [])
    ];
    
    invitationSection.innerHTML = `
        <div class="invitation-header">
            <div class="invitation-title">
                <i class="fas fa-paper-plane"></i>
                <span>Invite ${profileData.username}</span>
            </div>
            <p>Send an invitation for their preferred game settings</p>
        </div>
        <div class="invitation-grid">
            ${allInvites.map(invite => `
                <button class="invite-btn ${rankClass}" data-type="${invite.type}" data-value="${invite.value}">
                    <i class="fas fa-${invite.icon}"></i>
                    <span>${invite.label}</span>
                </button>
            `).join('')}
        </div>
    `;
    
    // Add CSS if not already present
    if (!document.getElementById('invitation-styles')) {
        const styleEl = document.createElement('style');
        styleEl.id = 'invitation-styles';
        styleEl.textContent = `
            .invitation-section {
                border-radius: 12px;
                padding: 1.25rem;
                margin-top: 1.5rem;
                position: relative;
                overflow: hidden;
                background: #1a1a1a;
                border: 2px solid #333;
                transition: all 0.3s ease;
            }
            
            /* Rank-based styling */
            .invitation-section.elo-emerald {
                border-color: #50C878;
                box-shadow: 0 0 20px rgba(80, 200, 120, 0.1);
            }
            
            .invitation-section.elo-gold {
                border-color: #FFD700;
                box-shadow: 0 0 20px rgba(255, 215, 0, 0.1);
            }
            
            .invitation-section.elo-silver {
                border-color: #C0C0C0;
                box-shadow: 0 0 20px rgba(192, 192, 192, 0.1);
            }
            
            .invitation-section.elo-bronze {
                border-color: #CD7F32;
                box-shadow: 0 0 20px rgba(205, 127, 50, 0.1);
            }
            
            .invitation-section.elo-unranked {
                border-color: #666;
                box-shadow: 0 0 20px rgba(102, 102, 102, 0.1);
            }
            
            .invitation-header {
                margin-bottom: 1rem;
                text-align: center;
            }
            
            .invitation-title {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 0.75rem;
                margin-bottom: 0.5rem;
                font-size: 1.1rem;
                font-weight: bold;
                color: white;
            }
            
            .invitation-title i {
                font-size: 1.2rem;
            }
            
            .rank-indicator {
                padding: 0.25rem 0.75rem;
                border-radius: 20px;
                font-size: 0.8rem;
                font-weight: bold;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            
            .rank-indicator.elo-emerald {
                background: rgba(80, 200, 120, 0.2);
                color: #50C878;
                border: 1px solid #50C878;
            }
            
            .rank-indicator.elo-gold {
                background: rgba(255, 215, 0, 0.2);
                color: #FFD700;
                border: 1px solid #FFD700;
            }
            
            .rank-indicator.elo-silver {
                background: rgba(192, 192, 192, 0.2);
                color: #C0C0C0;
                border: 1px solid #C0C0C0;
            }
            
            .rank-indicator.elo-bronze {
                background: rgba(205, 127, 50, 0.2);
                color: #CD7F32;
                border: 1px solid #CD7F32;
            }
            
            .rank-indicator.elo-unranked {
                background: rgba(102, 102, 102, 0.2);
                color: #666;
                border: 1px solid #666;
            }
            
            .invitation-header p {
                margin: 0;
                color: #aaa;
                font-size: 0.9rem;
            }
            
            .invitation-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
                gap: 0.75rem;
            }
            
            .invite-btn {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 0.5rem;
                padding: 1rem;
                background: #2a2a2a;
                color: white;
                border: 2px solid #444;
                border-radius: 8px;
                cursor: pointer;
                font-size: 0.9rem;
                transition: all 0.3s ease;
                position: relative;
                overflow: hidden;
            }
            
            .invite-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            }
            
            .invite-btn i {
                font-size: 1.5rem;
                margin-bottom: 0.25rem;
            }
            
            .invite-btn span {
                font-weight: 500;
                text-align: center;
                line-height: 1.2;
            }
            
            /* Rank-based button styling */
            .invite-btn.elo-emerald {
                border-color: #50C878;
            }
            
            .invite-btn.elo-emerald:hover {
                background: rgba(80, 200, 120, 0.1);
                border-color: #50C878;
                color: #50C878;
            }
            
            .invite-btn.elo-gold {
                border-color: #FFD700;
            }
            
            .invite-btn.elo-gold:hover {
                background: rgba(255, 215, 0, 0.1);
                border-color: #FFD700;
                color: #FFD700;
            }
            
            .invite-btn.elo-silver {
                border-color: #C0C0C0;
            }
            
            .invite-btn.elo-silver:hover {
                background: rgba(192, 192, 192, 0.1);
                border-color: #C0C0C0;
                color: #C0C0C0;
            }
            
            .invite-btn.elo-bronze {
                border-color: #CD7F32;
            }
            
            .invite-btn.elo-bronze:hover {
                background: rgba(205, 127, 50, 0.1);
                border-color: #CD7F32;
                color: #CD7F32;
            }
            
            .invite-btn.elo-unranked {
                border-color: #666;
            }
            
            .invite-btn.elo-unranked:hover {
                background: rgba(102, 102, 102, 0.1);
                border-color: #888;
                color: #888;
            }
            
            .invite-btn:disabled {
                background: #1a1a1a !important;
                border-color: #333 !important;
                color: #666 !important;
                cursor: not-allowed !important;
                transform: none !important;
                box-shadow: none !important;
            }
            
            /* Loading and success states */
            .invite-btn.loading {
                pointer-events: none;
            }
            
            .invite-btn.success {
                background: rgba(76, 175, 80, 0.2) !important;
                border-color: #4CAF50 !important;
                color: #4CAF50 !important;
            }
            
            .invite-btn.error {
                background: rgba(244, 67, 54, 0.2) !important;
                border-color: #F44336 !important;
                color: #F44336 !important;
            }
            
            @media (max-width: 768px) {
                .invitation-grid {
                    grid-template-columns: 1fr;
                }
                
                .invitation-title {
                    flex-direction: column;
                    gap: 0.5rem;
                }
                
                .invite-btn {
                    flex-direction: row;
                    justify-content: center;
                    gap: 0.75rem;
                }
                
                .invite-btn i {
                    font-size: 1.2rem;
                    margin-bottom: 0;
                }
            }
        `;
        document.head.appendChild(styleEl);
    }
    
    // Add event listeners for invitation buttons with enhanced feedback
    invitationSection.querySelectorAll('.invite-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const type = btn.dataset.type;
            const value = btn.dataset.value;
            const originalContent = btn.innerHTML;
            
            btn.disabled = true;
            btn.classList.add('loading');
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Sending...</span>';
            
            try {
                await this.sendInvitation(profileData.username, profileData.userId, type, value);
                
                btn.classList.remove('loading');
                btn.classList.add('success');
                btn.innerHTML = '<i class="fas fa-check"></i><span>Sent!</span>';
                
                setTimeout(() => {
                    btn.disabled = false;
                    btn.classList.remove('success');
                    btn.innerHTML = originalContent;
                }, 3000);
                
            } catch (error) {
                console.error('Error sending invitation:', error);
                
                btn.classList.remove('loading');
                btn.classList.add('error');
                btn.innerHTML = '<i class="fas fa-exclamation-triangle"></i><span>Error</span>';
                
                setTimeout(() => {
                    btn.disabled = false;
                    btn.classList.remove('error');
                    btn.innerHTML = originalContent;
                }, 3000);
            }
        });
    });
    
    // Insert after the profile content
    container.appendChild(invitationSection);
}
    async sendInvitation(toUsername, toUserId, type, value) {
        const currentUser = auth.currentUser;
        if (!currentUser) {
            throw new Error('You must be logged in to send invitations');
        }
        
        // Check if invitation already exists to prevent duplicates
        const existingInviteQuery = query(
            collection(db, 'gameInvitations'),
            where('fromUserId', '==', currentUser.uid),
            where('toUserId', '==', toUserId),
            where('type', '==', type),
            where('value', '==', value),
            where('status', '==', 'pending'),
            limit(1)
        );
        
        const existingSnapshot = await getDocs(existingInviteQuery);
        if (!existingSnapshot.empty) {
            throw new Error('You already have a pending invitation for this setting');
        }
        
        // Get current user's profile data efficiently
        let fromUsername = currentUser.displayName || currentUser.email.split('@')[0];
        
        // Try to get username from cache first
        if (this.currentProfileData && this.currentProfileData.userId === currentUser.uid) {
            fromUsername = this.currentProfileData.username || fromUsername;
        } else {
            // Only fetch if not cached
            const userProfileDoc = await getDoc(doc(db, 'userProfiles', currentUser.uid));
            if (userProfileDoc.exists()) {
                fromUsername = userProfileDoc.data().username || fromUsername;
            }
        }
        
        // Create invitation document with minimal data
        const invitationData = {
            fromUserId: currentUser.uid,
            fromUsername: fromUsername,
            toUserId: toUserId,
            toUsername: toUsername,
            type: type,
            value: value,
            status: 'pending',
            createdAt: new Date(),
            message: type === 'home' ? 
                `${fromUsername} invites you to play on ${value}` :
                `${fromUsername} invites you to play ${value}`
        };
        
        // Add to gameInvitations collection
        await addDoc(collection(db, 'gameInvitations'), invitationData);
    }
}

// Also update the preview function
function updateProfileImagePreview() {
    const imageUrl = document.getElementById('profile-image-url').value.trim();
    const previewImg = document.getElementById('profile-image-preview');
    
    if (previewImg) {
        if (imageUrl) {
            previewImg.src = imageUrl;
            previewImg.style.display = 'block';
        } else {
            previewImg.src = DEFAULT_PROFILE_IMAGE;
            previewImg.style.display = 'block';
        }
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    // Wait for Firebase Auth state to be ready before initializing
    auth.onAuthStateChanged(user => {
        console.log("Auth state changed, user:", user ? user.uid : 'none');
        // Initialize ProfileViewer regardless of login state,
        // the viewer logic will handle showing/hiding edit button.
        if (!window.profileViewerInstance) { // Prevent multiple initializations
             window.profileViewerInstance = new ProfileViewer();
        } else {
             // If already initialized, maybe reload profile if user logs in/out?
             // Or rely on page refresh. For now, just log.
        }
    });
});

// Clean up on page unload
window.addEventListener('beforeunload', () => {
    ribbonSystem.stopAllWatching();
});
