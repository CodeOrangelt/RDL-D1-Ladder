import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    getFirestore, doc, getDoc, setDoc, collection, 
    query, where, getDocs, orderBy, limit, startAfter 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { firebaseConfig } from './firebase-config.js';

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
        this.currentLadder = 'D1'; // Default to D1
        this.eloHistoryPagination = { 
            d1: { page: 1, lastVisible: null, firstVisible: null }, 
            d2: { page: 1, lastVisible: null, firstVisible: null },
            d3: { page: 1, lastVisible: null, firstVisible: null }
        };
        this.PAGE_SIZE = 10;
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
    
    async loadProfile(username) {
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
            
            // Initialize containers in the correct order - Move elo-history before player-matchups
            this.createContainers(['rank-history', 'match-stats', 'elo-history', 'player-matchups', 'match-history']);
            
            // Get matches - do this once so we don't repeat the same query
            const matches = await this.getPlayerMatches(username);
            
            // Display sections in parallel for better performance
            await Promise.all([
                this.displayTrophyCase(username),
                this.displayPromotionHistory(username),
                this.displayMatchStats(username, matches),
                this.displayEloHistory(username), // Moved up in the visual order
                this.displayPlayerMatchups(username, matches),
                this.displayMatchHistory(username, matches)
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
    
    async getPlayerEloData(username) {
        // Update cache key to include ladder
        const cacheKey = `${username}_${this.currentLadder}`;
        
        if (playerDataCache.has(cacheKey)) {
            return playerDataCache.get(cacheKey).eloRating || 0;
        }
        
        try {
            const playersCollection = this.currentLadder === 'D1' ? 'players' : (this.currentLadder === 'D2' ? 'playersD2' : 'playersD3');
            const playersRef = collection(db, playersCollection);
            const q = query(playersRef, where('username', '==', username));
            const querySnapshot = await getDocs(q);
            const playerData = querySnapshot.docs[0]?.data() || {};
            return playerData.eloRating || 0;
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
            
            // Helper function
            const getEloClass = (elo) => {
                if (elo >= 2000) return 'elo-emerald';
                if (elo >= 1800) return 'elo-gold';
                if (elo >= 1600) return 'elo-silver';
                if (elo >= 1400) return 'elo-bronze';
                return 'elo-unranked';
            };
            
            // Build match history HTML
            matchHistoryContainer.innerHTML = `
                <h2>Match History</h2>
                <table class="match-history-table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Winner</th>
                            <th>Loser</th>
                            <th>Score</th>
                            <th>Map</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${matches.length === 0 ? 
                            '<tr><td colspan="5">No matches found</td></tr>' :
                            matches.map(match => {
                                const date = match.createdAt ? 
                                    new Date(match.createdAt.seconds * 1000).toLocaleDateString() : 
                                    'N/A';
                                const isWinner = match.winnerUsername === username;
                                const winnerEloClass = getEloClass(playerElos[match.winnerUsername]);
                                const loserEloClass = getEloClass(playerElos[match.loserUsername]);
                                
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
                                    </tr>
                                `;
                            }).join('')
                        }
                    </tbody>
                </table>
            `;
        } catch (error) {
            console.error('Error displaying match history:', error);
            this.showErrorInContainer('match-history', 'Failed to load match history');
        }
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
        
        statsGrid.appendChild(nextRankItem);
        
        // Find where to insert the stats grid - at the end of the profile content
        const content = document.querySelector('.profile-content');
        if (content) {
            content.appendChild(statsGrid);
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
                'timezone-edit': this.currentProfileData.timezone || '',
                'division-edit': this.currentProfileData.division || '',
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
            favoriteSubgame: document.getElementById('favorite-subgame-edit').value.trim(),
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

    async displayTrophyCase(username) {
        try {
            const trophyContainer = document.getElementById('trophy-container');
            if (!trophyContainer) return;

            // Check if user is non-participant
            if (this.currentProfileData?.isNonParticipant) {
                trophyContainer.innerHTML = `
                    <p class="empty-trophy-case">No trophies awarded yet</p>
                `;
                return;
            }

            // Get user ID
            const userId = this.currentProfileData?.userId;
            if (!userId) {
                console.error("No user ID found for trophy display");
                trophyContainer.innerHTML = `<p class="empty-trophy-case">Unable to load trophies</p>`;
                return;
            }

            // Query for user trophies
            const trophiesRef = collection(db, "userTrophies");
            const q = query(trophiesRef, where("userId", "==", userId), orderBy("awardedAt", "desc"));
            const trophiesSnapshot = await getDocs(q);

            if (trophiesSnapshot.empty) {
                trophyContainer.innerHTML = `
                    <p class="empty-trophy-case">No trophies awarded yet</p>
                `;
                return;
            }

            // Get all trophy definitions to have their details
            const trophyDefsRef = collection(db, "trophyDefinitions");
            const trophyDefsSnapshot = await getDocs(trophyDefsRef);
            
            // Create a map of trophy definitions for easy lookup
            const trophyDefs = {};
            trophyDefsSnapshot.forEach(doc => {
                trophyDefs[doc.id] = { id: doc.id, ...doc.data() };
            });

            // Render trophies
            let trophiesHTML = '';
            
            trophiesSnapshot.forEach(doc => {
                const trophyData = doc.data();
                const trophyId = trophyData.trophyId;
                const trophyDef = trophyDefs[trophyId] || {
                    name: "Unknown Trophy",
                    image: "../images/default-trophy.png",
                    description: "Trophy details not found",
                    rarity: "common"
                };
                
                const awardDate = trophyData.awardedAt ? 
                    new Date(trophyData.awardedAt.seconds * 1000).toLocaleDateString() : 
                    'Unknown Date';
                
                trophiesHTML += `
                    <div class="trophy ${trophyDef.rarity || 'common'}">
                        <div class="trophy-tooltip">${trophyDef.description || "No description available"}</div>
                        <img src="${trophyDef.image}" alt="${trophyDef.name}" class="trophy-image">
                        <p class="trophy-name">${trophyDef.name}</p>
                        <p class="trophy-date">Awarded: ${awardDate}</p>
                    </div>
                `;
            });

            trophyContainer.innerHTML = trophiesHTML;

        } catch (error) {
            console.error('Error displaying trophy case:', error);
            const trophyContainer = document.getElementById('trophy-container');
            if (trophyContainer) {
                trophyContainer.innerHTML = `
                    <p class="empty-trophy-case">Error loading trophies</p>
                `;
            }
        }
    }

    // Update the displayEloHistory method to display the 5 most recent entries from eloHistory collections
async displayEloHistory(username) {
    try {
        // Get the container reference
        const eloHistoryContainer = containerReferences['elo-history'];
        if (!eloHistoryContainer) return;
        
        // Get season information
        const seasonCountDoc = await getDoc(doc(db, 'metadata', 'seasonCount'));
        const currentSeason = seasonCountDoc.exists() ? seasonCountDoc.data().count : 1;
        
        // Check for non-participant
        if (this.currentProfileData?.isNonParticipant) {
            eloHistoryContainer.innerHTML = `
                <div class="season-label">S${currentSeason}</div>
                <h2>ELO History</h2>
                <div class="non-participant-notice">
                    <p>This player is not participating in the ladder.</p>
                    <p>No ELO history is available.</p>
                </div>
            `;
            return;
        }
        
        // Create initial structure with a more compact layout
        eloHistoryContainer.innerHTML = `
            <div class="season-label">S${currentSeason}</div>
            <h2>ELO History</h2>
            <div class="elo-history-content">
                <div class="elo-history-table-container">
                    <table class="elo-history-table">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Change</th>
                                <th>From</th>
                                <th>To</th>
                                <th>Type</th>
                            </tr>
                        </thead>
                        <tbody id="elo-history-table-body">
                            <tr><td colspan="5" class="loading-cell">Loading ELO history...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        
        // Initial load of ELO history
        await this.loadEloHistory(username);
        
    } catch (error) {
        console.error('Error setting up ELO history:', error);
        this.showErrorInContainer('elo-history', 'Failed to load ELO history');
    }
}

// Update loadEloHistory to use a single query per ladder (updated)
async loadEloHistory(username) {
    const tableBody = document.getElementById('elo-history-table-body');
    if (!tableBody) return;
    
    tableBody.innerHTML = '<tr><td colspan="5" class="loading-cell">Loading ELO history...</td></tr>';
    
    try {
        // First get the player ID from the current profile data
        const playerId = this.currentProfileData?.userId;
        
        if (!playerId) {
            console.log(`No player ID found for ${username}, using username directly`);
        }
                
        // Collection name based on ladder
        const eloHistoryCollection = 
            this.currentLadder === 'D1' ? 'eloHistory' : 
            this.currentLadder === 'D2' ? 'eloHistoryD2' : 'eloHistoryD3';
        
        const eloHistoryRef = collection(db, eloHistoryCollection);
        
        // Use a single composite query with OR condition (in operator)
        let querySnapshot;
        
        // Build search terms array with all possible identifier fields
        const searchTerms = [username]; // Always include username
        
        if (playerId) {
            searchTerms.push(playerId); // Include user ID if available
        }
        
        // Make a single query using 'in' operator on the 'player' field
        // This field is the most commonly used identifier across your database
        querySnapshot = await getDocs(query(
            eloHistoryRef,
            where('player', 'in', searchTerms),
            orderBy('timestamp', 'desc'),
            limit(30) // Limit to reasonable number to avoid excessive reads
        ));
                
        // If no results from the main query, we don't need to query again
        if (querySnapshot.empty) {
            tableBody.innerHTML = '<tr><td colspan="5" class="empty-state">No ELO history found</td></tr>';
            return;
        }
        
        // Process the results - all docs from the query
        const allRecords = querySnapshot.docs.map(doc => doc.data());
        
        // Log types of entries found
        const typeCounts = {};
        allRecords.forEach(record => {
            const type = record.type || 'unknown';
            typeCounts[type] = (typeCounts[type] || 0) + 1;
        });        
        // Split into initial (5 most recent) and additional entries (older ones)
        const initialEntries = allRecords.slice(0, 5);
        const additionalEntries = allRecords.slice(5);
        const hasMoreEntries = additionalEntries.length > 0;
                
        // Create cache for username lookups to avoid repeated queries
        const usernameCache = new Map();
        
        // Function to resolve usernames from IDs
        const resolveUsername = async (userId) => {
            if (typeof userId !== 'string' || !userId || userId.length < 2) {
                return 'Unknown';
            }
            
            if (usernameCache.has(userId)) {
                return usernameCache.get(userId);
            }
            
            try {
                // Use a direct query to users collection for efficiency
                const userDoc = await getDoc(doc(db, 'users', userId));
                if (userDoc.exists()) {
                    const username = userDoc.data().username || userDoc.data().displayName;
                    if (username) {
                        usernameCache.set(userId, username);
                        return username;
                    }
                }
                
                // If not in users, check players collection
                const playerDoc = await getDoc(doc(db, this.currentLadder === 'D1' ? 'players' : 
                    (this.currentLadder === 'D2' ? 'playersD2' : 'playersD3'), userId));
                    
                if (playerDoc.exists()) {
                    const username = playerDoc.data().username;
                    if (username) {
                        usernameCache.set(userId, username);
                        return username;
                    }
                }
                
                // If we can't resolve it, just return the ID
                return userId;
            } catch (error) {
                console.warn(`Error resolving username for ${userId}:`, error);
                return userId;
            }
        };
        
        // Helper function to format history type
        const formatHistoryType = (type) => {
            if (!type) return 'Match';
            
            // Format the type for display
            switch (type.toLowerCase()) {
                case 'match':
                case 'match_win':
                case 'match_loss':
                case 'match_result': return 'Match';
                case 'admin_modification': return 'Admin';
                case 'initial_placement': return 'Initial';
                case 'promotion': return 'Promotion';
                case 'demotion': return 'Demotion';
                default: return type.charAt(0).toUpperCase() + type.slice(1);
            }
        };
        
        // Process initial entries (5 most recent)
        const initialRowsHTML = await Promise.all(initialEntries.map(async (record) => {
            // Format timestamp - more compact date format
            const timestamp = record.timestamp ? 
                new Date(record.timestamp.seconds * 1000).toLocaleDateString(undefined, {
                    month: 'short', 
                    day: 'numeric'
                }) : 'N/A';
            
            // Calculate ELO change and style it
            const eloChange = record.newElo - record.previousElo;
            const changeClass = eloChange > 0 ? 'elo-change-positive' : 
                              eloChange < 0 ? 'elo-change-negative' : 'elo-change-neutral';
            const changeDisplay = eloChange > 0 ? `+${eloChange}` : eloChange.toString();
            
            // Format type and get opponent
            const typeDisplay = formatHistoryType(record.type);
            let opponentDisplay = '';
            
            // Check both opponentId and opponent fields for backwards compatibility
            const opponentId = record.opponentId || record.opponent;
            
            if (opponentId) {
                const opponentName = await resolveUsername(opponentId);
                if (opponentName) {
                    opponentDisplay = ` vs. ${opponentName}`;
                }
            }
            
            return `
                <tr>
                    <td>${timestamp}</td>
                    <td class="${changeClass}">${changeDisplay}</td>
                    <td>${record.previousElo}</td>
                    <td>${record.newElo}</td>
                    <td><span class="elo-event event-${record.type || 'match'}">${typeDisplay}${opponentDisplay}</span></td>
                </tr>
            `;
        }));
        
        // Add initial entries and "Show More" button if needed
        tableBody.innerHTML = initialRowsHTML.join('');
        
        // Add Show More button if there are additional entries
        if (hasMoreEntries) {
            const showMoreRow = document.createElement('tr');
            showMoreRow.id = 'show-more-elo-row';
            showMoreRow.className = 'show-more-row';
            showMoreRow.innerHTML = `
                <td colspan="5" class="show-more-cell">
                    <button id="show-more-elo-btn" class="show-more-btn">
                        Show More (${additionalEntries.length})
                    </button>
                </td>
            `;
            tableBody.appendChild(showMoreRow);
            
            // Add click handler for "Show More" button
            const showMoreBtn = document.getElementById('show-more-elo-btn');
            if (showMoreBtn) {
                showMoreBtn.addEventListener('click', async () => {
                    showMoreBtn.textContent = 'Loading...';
                    showMoreBtn.disabled = true;
                    
                    try {
                        // Process and render additional entries
                        const additionalRowsHTML = await Promise.all(additionalEntries.map(async (record) => {
                            const timestamp = record.timestamp ? 
                                new Date(record.timestamp.seconds * 1000).toLocaleDateString(undefined, {
                                    month: 'short', 
                                    day: 'numeric'
                                }) : 'N/A';
                            
                            const eloChange = record.newElo - record.previousElo;
                            const changeClass = eloChange > 0 ? 'elo-change-positive' : 
                                              eloChange < 0 ? 'elo-change-negative' : 'elo-change-neutral';
                            const changeDisplay = eloChange > 0 ? `+${eloChange}` : eloChange.toString();
                            
                            const typeDisplay = formatHistoryType(record.type);
                            let opponentDisplay = '';
                            
                            const opponentId = record.opponentId || record.opponent;
                            
                            if (opponentId) {
                                const opponentName = await resolveUsername(opponentId);
                                if (opponentName) {
                                    opponentDisplay = ` vs. ${opponentName}`;
                                }
                            }
                            
                            return `
                                <tr>
                                    <td>${timestamp}</td>
                                    <td class="${changeClass}">${changeDisplay}</td>
                                    <td>${record.previousElo}</td>
                                    <td>${record.newElo}</td>
                                    <td><span class="elo-event event-${record.type || 'match'}">${typeDisplay}${opponentDisplay}</span></td>
                                </tr>
                            `;
                        }));
                        
                        // Replace "Show More" row with additional entries
                        showMoreRow.remove();
                        tableBody.insertAdjacentHTML('beforeend', additionalRowsHTML.join(''));
                    } catch (error) {
                        console.error('Error loading additional entries:', error);
                        showMoreBtn.textContent = `Show More (${additionalEntries.length})`;
                        showMoreBtn.disabled = false;
                    }
                });
            }
        }
        
    } catch (error) {
        console.error('Error loading ELO history:', error);
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="error-state">
                    Error loading ELO history: ${error.message}
                </td>
            </tr>
        `;
    }
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