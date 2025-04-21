import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    getFirestore, doc, getDoc, setDoc, collection, 
    query, where, getDocs, orderBy, limit 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { firebaseConfig } from './firebase-config.js';

// Initialize Firebase once
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Cache for player data to reduce redundant queries
const playerDataCache = new Map();
const containerReferences = {};

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
        this.init();
    }
    
    init() {
        // Get username and optional ladder from URL
        const urlParams = new URLSearchParams(window.location.search);
        const username = urlParams.get('username');
        const ladder = urlParams.get('ladder');
        
        // Set initial ladder from URL if present
        if (ladder && ladder.toUpperCase() === 'D2') {
            this.currentLadder = 'D2';
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
        
        if (d1Button && d2Button) {
            // Set initial active state
            if (this.currentLadder === 'D1') {
                d1Button.classList.add('active');
                d2Button.classList.remove('active');
            } else {
                d2Button.classList.add('active');
                d1Button.classList.remove('active');
            }
            
            // Add click handlers
            d1Button.addEventListener('click', () => {
                if (this.currentLadder !== 'D1') {
                    this.currentLadder = 'D1';
                    d1Button.classList.add('active');
                    d2Button.classList.remove('active');
                    
                    // Get current username
                    const username = this.currentProfileData?.username;
                    if (username) {
                        this.loadProfile(username);
                    }
                }
            });
            
            d2Button.addEventListener('click', () => {
                if (this.currentLadder !== 'D2') {
                    this.currentLadder = 'D2';
                    d2Button.classList.add('active');
                    d1Button.classList.remove('active');
                    
                    // Get current username
                    const username = this.currentProfileData?.username;
                    if (username) {
                        this.loadProfile(username);
                    }
                }
            });
        }
    }
    
    async loadProfile(username) {
        console.log(`Loading profile for ${username} in ${this.currentLadder} ladder`);
        try {
            // Check which ladders the player is registered in
            const { inD1, inD2 } = await this.checkDualLadderStatus(username);
            
            // If not found in current ladder but found in other, switch ladders
            if ((this.currentLadder === 'D1' && !inD1 && inD2) || 
                (this.currentLadder === 'D2' && !inD2 && inD1)) {
                this.currentLadder = this.currentLadder === 'D1' ? 'D2' : 'D1';
                this.setupToggleButtons(); // Update active button
            }
            
            // Load player data
            await this.loadPlayerData(username);
            
            // Initialize containers in the correct order
            this.createContainers(['rank-history', 'match-stats', 'player-matchups', 'match-history']);
            
            // Get matches - do this once so we don't repeat the same query
            const matches = await this.getPlayerMatches(username);
            
            // Display sections in parallel for better performance
            await Promise.all([
                this.displayTrophyCase(username), // Add this line to display trophies
                this.displayPromotionHistory(username),
                this.displayMatchStats(username, matches),
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
        console.log(`Loading player data for ${username} in ${this.currentLadder} ladder`);
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
            const playersCollection = this.currentLadder === 'D1' ? 'players' : 'playersD2';
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
                
                // Check other ladder
                const otherLadder = this.currentLadder === 'D1' ? 'D2' : 'D1';
                const otherPlayersRef = collection(db, otherLadder === 'D1' ? 'players' : 'playersD2');
                const otherQuery = query(otherPlayersRef, where('username', '==', username));
                const otherSnapshot = await getDocs(otherQuery);
                
                if (otherSnapshot.empty) {
                    // Not found in any ladder or as non-participant - AUTO REGISTER AS NON-PARTICIPANT
                    console.log(`User ${username} not found in any ladder, registering as non-participant`);

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
                                console.log(`Found user by email prefix match, actual username: ${correctUsername}`);
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

                    console.log(`Registering as non-participant with username: ${correctUsername}, userId: ${userId}`);

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
                } else {
                    // Found in other ladder, suggest switching
                    throw new Error(`Player not found in ${this.currentLadder} ladder. Try selecting the ${otherLadder} ladder.`);
                }
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
            console.log(`Found profile data for user ${userId} in userProfiles`);
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
            const playersCollection = this.currentLadder === 'D1' ? 'players' : 'playersD2';
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
    
    displayProfile(data) {
        this.currentProfileData = data;
        
        // Apply ELO rating styles
        const container = document.querySelector('.profile-content');
        if (!container) return;
        
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
        if (!isNonParticipant) { // Skip for non-participants
            if (eloRating >= 2000) {
                eloClass = 'elo-emerald';
            } else if (eloRating >= 1800) {
                eloClass = 'elo-gold';
            } else if (eloRating >= 1600) {
                eloClass = 'elo-silver';
            } else if (eloRating >= 1400) {
                eloClass = 'elo-bronze';
            } else {
                eloClass = 'elo-unranked';
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
        
        // Rest of your existing code...
    }
    
    async getPlayerMatches(username) {
        try {
            const matchesCollection = this.currentLadder === 'D1' ? 'approvedMatches' : 'approvedMatchesD2';
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
            const playersCollection = this.currentLadder === 'D1' ? 'players' : 'playersD2';
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
            const eloHistoryCollection = this.currentLadder === 'D1' ? 'eloHistory' : 'eloHistoryD2';
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
        console.log(`Loading stats for ${username} in ${this.currentLadder} ladder`);

        try {
            // Direct Firebase query for player data - bypass cache
            const playersCollection = this.currentLadder === 'D1' ? 'players' : 'playersD2';
            const playersRef = collection(db, playersCollection);
            const q = query(playersRef, where('username', '==', username));
            const querySnapshot = await getDocs(q);
            
            if (querySnapshot.empty) {
                console.warn(`No player found for ${username} in ${playersCollection}`);
                this.setDefaultStats();
                return;
            }
            
            const playerData = querySnapshot.docs[0].data();
            console.log(`Found player data for ${username}:`, playerData);
            
            // Rest of your existing code for matches...
            const matchesCollection = this.currentLadder === 'D1' ? 'approvedMatches' : 'approvedMatchesD2';
            const approvedMatchesRef = collection(db, matchesCollection);
            
            const [winnerMatches, loserMatches] = await Promise.all([
                getDocs(query(approvedMatchesRef, where('winnerUsername', '==', username))),
                getDocs(query(approvedMatchesRef, where('loserUsername', '==', username)))
            ]);
            
            // Calculate stats
            const stats = {
                wins: winnerMatches.size,
                losses: loserMatches.size,
                totalKills: 0,
                totalDeaths: 0,
                totalMatches: winnerMatches.size + loserMatches.size
            };
            
            // Process winner matches
            winnerMatches.forEach(doc => {
                const match = doc.data();
                stats.totalKills += parseInt(match.winnerScore) || 0;
                stats.totalDeaths += parseInt(match.loserScore) || 0;
            });
            
            // Process loser matches
            loserMatches.forEach(doc => {
                const match = doc.data();
                stats.totalKills += parseInt(match.loserScore) || 0;
                stats.totalDeaths += parseInt(match.winnerScore) || 0;
            });
            
            // Calculate derived stats
            stats.kda = stats.totalDeaths > 0 ? 
                (stats.totalKills / stats.totalDeaths).toFixed(2) : 
                stats.totalKills.toFixed(2);
            
            stats.winRate = stats.totalMatches > 0 ? 
                ((stats.wins / stats.totalMatches) * 100).toFixed(1) : 0;
            
            // Update DOM elements
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
        } catch (error) {
            console.error('Error loading player stats:', error);
            this.setDefaultStats();
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
                'motto-edit': this.currentProfileData.motto || '',
                'favorite-map-edit': this.currentProfileData.favoriteMap || '',
                'favorite-weapon-edit': this.currentProfileData.favoriteWeapon || '',
                'home-level-1': this.currentProfileData.homeLevel1 || '',
                'home-level-2': this.currentProfileData.homeLevel2 || '',
                'home-level-3': this.currentProfileData.homeLevel3 || ''
            };
            
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
        // First, get ALL existing profile data
        let existingData = {};
        const userProfileDoc = await getDoc(doc(db, 'userProfiles', user.uid));
        if (userProfileDoc.exists()) {
            existingData = userProfileDoc.data();
        }
        
        // Get current username - either from Firebase Auth or existing data
        const username = user.displayName || existingData.username || this.currentProfileData?.username || 'Anonymous';
        
        // Get form data and merge with existing data
        const profileData = {
            ...existingData, // Preserve ALL existing fields
            username: username, // Add username to profile document
            motto: document.getElementById('motto-edit').value,
            favoriteMap: document.getElementById('favorite-map-edit').value,
            favoriteWeapon: document.getElementById('favorite-weapon-edit').value,
            lastUpdated: new Date().toISOString(),
            timezone: document.getElementById('timezone-edit').value,
            division: document.getElementById('division-edit').value,
            homeLevel1: document.getElementById('home-level-1').value.trim(),
            homeLevel2: document.getElementById('home-level-2').value.trim(),
            homeLevel3: document.getElementById('home-level-3').value.trim()
        };

        // Save to Firestore - ONLY to userProfiles
        await setDoc(doc(db, 'userProfiles', user.uid), profileData);
        
        // Update cache
        if (username && playerDataCache.has(username)) {
            const cachedData = playerDataCache.get(username);
            playerDataCache.set(username, { ...cachedData, ...profileData });
        }
        
        // Update display
        this.toggleEditMode(false);
        this.displayProfile({
            ...this.currentProfileData,
            ...profileData,
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
            // Check if player exists in both ladders
            const [d1Snapshot, d2Snapshot] = await Promise.all([
                getDocs(query(collection(db, 'players'), where('username', '==', username), limit(1))),
                getDocs(query(collection(db, 'playersD2'), where('username', '==', username), limit(1)))
            ]);
            
            const inD1 = !d1Snapshot.empty;
            const inD2 = !d2Snapshot.empty;
            
            // Update toggle button visibility based on registration
            const d1Button = document.getElementById('profile-d1-toggle');
            const d2Button = document.getElementById('profile-d2-toggle');
            
            if (d1Button && d2Button) {
                d1Button.style.display = inD1 ? 'block' : 'none';
                d2Button.style.display = inD2 ? 'block' : 'none';
                
                // If only registered in one ladder, hide toggle completely
                const toggleContainer = document.querySelector('.profile-ladder-toggle');
                if (toggleContainer) {
                    toggleContainer.style.display = (inD1 && inD2) ? 'flex' : 'none';
                }
            }
            
            return { inD1, inD2 };
        } catch (error) {
            console.error('Error checking dual ladder status:', error);
            return { inD1: true, inD2: false }; // Default to D1 only on error
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
             console.log("ProfileViewer already initialized.");
        }
    });
});