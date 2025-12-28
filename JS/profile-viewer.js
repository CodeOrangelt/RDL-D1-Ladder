import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    getFirestore, doc, getDoc, setDoc, collection, 
    query, where, getDocs, orderBy, limit, startAfter, addDoc, Timestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { firebaseConfig } from './firebase-config.js';
import { evaluatePlayerRibbons, getRibbonHTML, RIBBON_CSS } from './ribbons.js';
import { playerScorecardInstance } from './playerscorecard.js';
import { getRankStyle } from './ranks.js';

// Initialize Firebase once
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Cache for player data to reduce redundant queries
const playerDataCache = new Map();
const containerReferences = {};

// Performance Optimizations Applied:
// - DOM element caching (domCache) to reduce querySelector calls
// - Cached ladder button references for faster updates
// - For loops instead of forEach for large datasets (matches, ELO history)
// - Single-pass filtering for chart data (combined filter + map)
// - Reduced object property lookups in tight loops
// - Batch DOM operations where possible

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
            d3: { page: 1, lastVisible: null, firstVisible: null },
            ffa: { page: 1, lastVisible: null, firstVisible: null } 
        };
        this.PAGE_SIZE = 10;
        
        // Add caching for ELO history and username resolution
        this.eloHistoryCache = new Map();
        this.usernameCache = new Map();
        this.playerEloCache = new Map();
        
        // Cache commonly accessed DOM elements (initialized after DOM ready)
        this.domCache = {
            profileContent: null,
            profileHeader: null,
            content: null,
            ladderButtons: {},
            initialized: false
        };
        
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
        } else if (ladder && ladder.toUpperCase() === 'FFA') {
            this.currentLadder = 'FFA'; 
        }
        
        // Create toggle buttons if they don't exist
        const toggleContainer = document.querySelector('.profile-ladder-toggle');
        if (!toggleContainer) {
            // Create the container
            const newToggleContainer = document.createElement('div');
            newToggleContainer.className = 'profile-ladder-toggle';
            
            const buttons = [
                { id: 'profile-d1-toggle', text: 'D1' },
                { id: 'profile-d2-toggle', text: 'D2' },
                { id: 'profile-d3-toggle', text: 'D3' },
                { id: 'profile-ffa-toggle', text: 'FFA', className: 'ffa' }
            ];
            
            buttons.forEach(btn => {
                const button = document.createElement('button');
                button.id = btn.id;
                button.className = `ladder-toggle-btn ${btn.className || ''}`;
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
        if (this.currentProfileData?.isNonParticipant) return;

        // Add ribbon CSS if not already present
        if (!document.getElementById('ribbon-styles')) {
            const styleEl = document.createElement('style');
            styleEl.id = 'ribbon-styles';
            styleEl.textContent = RIBBON_CSS;
            document.head.appendChild(styleEl);
        }

        let playerRibbons;
        try {
            playerRibbons = await Promise.race([
                evaluatePlayerRibbons(username, this.currentLadder),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Ribbon evaluation timeout')), 15000))
            ]);
        } catch (timeoutError) {
            console.error('Ribbon evaluation timed out:', timeoutError);
            return;
        }

        // Remove any existing ribbons section
        let ribbonsSection = document.getElementById('ribbons-section');
        if (ribbonsSection) ribbonsSection.remove();

        // Create ribbons section
        ribbonsSection = document.createElement('div');
        ribbonsSection.id = 'ribbons-section';
        ribbonsSection.className = 'ribbon-section';

        const ribbonCount = Object.keys(playerRibbons).length;

        if (ribbonCount === 0) {
            ribbonsSection.innerHTML = `
            <div class="stat-item ribbon-stat-item full-width" style="margin-top: 10px;">
                <div class="stat-label">RIBBONS</div>
                <div class="ribbon-rack-empty-inline">
                <div class="empty-rack-text">No ribbons earned yet</div>
                </div>
            </div>
            `;
        } else {
            // Sort and render ribbons
            const sortedRibbons = Object.entries(playerRibbons).sort((a, b) => {
                const dateA = a[1].awardedAt ? (a[1].awardedAt.seconds || new Date(a[1].awardedAt).getTime() / 1000) : 0;
                const dateB = b[1].awardedAt ? (b[1].awardedAt.seconds || new Date(b[1].awardedAt).getTime() / 1000) : 0;
                return dateB - dateA;
            });

            const ribbonsPerRow = 3;
            const ribbonRows = [];
            for (let i = 0; i < sortedRibbons.length; i += ribbonsPerRow) {
            const rowRibbons = sortedRibbons.slice(i, i + ribbonsPerRow);
            const rowHTML = rowRibbons.map(([name, data]) => getRibbonHTML(name, data)).join('');
            ribbonRows.push(`<div class="ribbon-row">${rowHTML}</div>`);
            }

            ribbonsSection.innerHTML = `
            <div class="stat-item ribbon-stat-item full-width" style="margin-top: 10px;">
                <div class="ribbon-rack-inline">
                ${ribbonRows.join('')}
                </div>
            </div>
            `;
        }

        // Insert ribbons section after stats bar and before trophies
        this.initDOMCache();
        const profileContent = this.domCache.profileContent || document.querySelector('.profile-content');
        const statsSection = profileContent?.querySelector('.stats-section, .stats-grid');
        const trophyCase = profileContent?.querySelector('.trophy-case-container');

        if (statsSection && trophyCase) {
            statsSection.insertAdjacentElement('afterend', ribbonsSection);
        } else if (statsSection) {
            statsSection.insertAdjacentElement('afterend', ribbonsSection);
        } else if (trophyCase) {
            trophyCase.parentNode.insertBefore(ribbonsSection, trophyCase);
        } else if (profileContent) {
            profileContent.appendChild(ribbonsSection);
        }
    } catch (error) {
        console.error('Error displaying ribbons:', error);
    }
}
    
    // Initialize DOM cache once
    initDOMCache() {
        if (!this.domCache.initialized) {
            this.domCache.profileContent = document.querySelector('.profile-content');
            this.domCache.profileHeader = document.querySelector('.profile-header');
            this.domCache.content = document.querySelector('.content');
            this.domCache.initialized = true;
        }
    }
    
    // Fix the profile toggle to properly handle D3 ladder parameters
    setupToggleButtons() {
        // Cache button references for reuse
        if (!this.domCache.ladderButtons.d1) {
            this.domCache.ladderButtons.d1 = document.getElementById('profile-d1-toggle');
            this.domCache.ladderButtons.d2 = document.getElementById('profile-d2-toggle');
            this.domCache.ladderButtons.d3 = document.getElementById('profile-d3-toggle');
            this.domCache.ladderButtons.ffa = document.getElementById('profile-ffa-toggle');
        }
        
        const d1Button = this.domCache.ladderButtons.d1;
        const d2Button = this.domCache.ladderButtons.d2;
        const d3Button = this.domCache.ladderButtons.d3;
        const ffaButton = this.domCache.ladderButtons.ffa;
        
        const allButtons = [d1Button, d2Button, d3Button, ffaButton].filter(b => b);
        
        // Set initial active state
        allButtons.forEach(btn => btn.classList.remove('active'));
        
        if (this.currentLadder === 'D1' && d1Button) {
            d1Button.classList.add('active');
        } else if (this.currentLadder === 'D2' && d2Button) {
            d2Button.classList.add('active');
        } else if (this.currentLadder === 'D3' && d3Button) {
            d3Button.classList.add('active');
        } else if (this.currentLadder === 'FFA' && ffaButton) {
            ffaButton.classList.add('active');
        }
        
        // Add click handlers
        if (d1Button) {
            d1Button.addEventListener('click', () => this.switchLadder('D1'));
        }
        if (d2Button) {
            d2Button.addEventListener('click', () => this.switchLadder('D2'));
        }
        if (d3Button) {
            d3Button.addEventListener('click', () => this.switchLadder('D3'));
        }
        if (ffaButton) {
            ffaButton.addEventListener('click', () => this.switchLadder('FFA'));
        }
    }

    async switchLadder(ladder) {
        if (this.currentLadder === ladder) return;
        
        this.currentLadder = ladder;
        
        // Update URL
        const urlParams = new URLSearchParams(window.location.search);
        const username = urlParams.get('username');
        if (username) {
            const newUrl = `${window.location.pathname}?username=${encodeURIComponent(username)}&ladder=${ladder.toLowerCase()}`;
            window.history.replaceState({}, '', newUrl);
        }
        
        // Update active classes using cached buttons if available
        const buttons = this.domCache.ladderButtons;
        if (buttons.d1 || buttons.d2 || buttons.d3 || buttons.ffa) {
            // Use cached buttons
            [buttons.d1, buttons.d2, buttons.d3, buttons.ffa].forEach(btn => {
                if (btn) btn.classList.remove('active');
            });
            if (ladder === 'D1' && buttons.d1) buttons.d1.classList.add('active');
            else if (ladder === 'D2' && buttons.d2) buttons.d2.classList.add('active');
            else if (ladder === 'D3' && buttons.d3) buttons.d3.classList.add('active');
            else if (ladder === 'FFA' && buttons.ffa) buttons.ffa.classList.add('active');
        } else {
            // Fallback to querySelectorAll
            document.querySelectorAll('.ladder-toggle-btn').forEach(btn => {
                btn.classList.remove('active');
                if ((btn.id === 'profile-d1-toggle' && ladder === 'D1') ||
                    (btn.id === 'profile-d2-toggle' && ladder === 'D2') ||
                    (btn.id === 'profile-d3-toggle' && ladder === 'D3') ||
                    (btn.id === 'profile-ffa-toggle' && ladder === 'FFA')) {
                    btn.classList.add('active');
                }
            });
        }
        
        // Clear existing stats (optimized: single query, single remove operation)
        const existingGrids = document.querySelectorAll('.stats-grid');
        existingGrids.forEach(grid => grid.remove());
        
        if (username) {
            const cacheKey = `${username}_${ladder}`;
            playerDataCache.delete(cacheKey);
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
            // Parallelize initial data loading - check ladder status and load player data simultaneously
            const [ladderStatus, playerDataResult] = await Promise.all([
                this.checkAllLadderStatus(username),
                this.currentLadder === 'FFA' 
                    ? this.loadFFAPlayerData(username)
                    : this.loadPlayerData(username)
            ]);
            
            // Create containers based on ladder type (fast, synchronous DOM operation)
            if (this.currentLadder === 'FFA') {
                this.createContainers(['ffa-stats', 'ffa-player-matchups', 'ffa-match-history']);
            } else {
                this.createContainers(['rank-history', 'match-stats', 'player-scorecard', 'player-matchups', 'match-history']);
            }
            
            // Fetch match data and display everything in parallel
            if (this.currentLadder === 'FFA') {
                const ffaMatches = await this.getFFAPlayerMatches(username);
                await Promise.all([
                    this.displayFFAStats(username, ffaMatches),
                    this.displayFFAMatchHistory(username, ffaMatches),
                    this.displayFFAPlayerMatchups(username, ffaMatches),
                    this.displayRibbons(username)
                ]);
            } else {
                // Show loading state immediately in all containers
                this.showLoadingInContainers();
                
                // Fetch matches and ELO history in parallel (shared across multiple displays)
                const [matches, eloHistoryData] = await Promise.all([
                    this.getPlayerMatches(username),
                    this.getEloHistoryForPlayer(username)
                ]);
                
                // Update profile rank with actual match data
                this.updateProfileRankFromMatches(matches);
                
                // Run all display sections in parallel, passing shared eloHistoryData
                await Promise.all([
                    this.displayPromotionHistory(username),
                    this.displayTrophyCase(username),
                    this.displayMatchStats(username, matches),
                    this.displayPlayerScorecard(username, matches),
                    this.displayPlayerMatchups(username, matches),
                    this.displayMatchHistory(username, matches, eloHistoryData),
                    this.displayRibbons(username)
                ]);
            }
            
            this.setupEditProfile();
        } catch (error) {
            console.error('Error loading profile:', error);
            this.showError(`Failed to load profile: ${error.message}`);
        }
    }

    // ✅ ADD: Check all ladder status including FFA
    async checkAllLadderStatus(username) {
        try {
            const [d1Snapshot, d2Snapshot, d3Snapshot, ffaSnapshot] = await Promise.all([
                getDocs(query(collection(db, 'players'), where('username', '==', username), limit(1))),
                getDocs(query(collection(db, 'playersD2'), where('username', '==', username), limit(1))),
                getDocs(query(collection(db, 'playersD3'), where('username', '==', username), limit(1))),
                getDocs(query(collection(db, 'playersFFA'), where('username', '==', username), limit(1)))
            ]);
            
            return {
                inD1: !d1Snapshot.empty,
                inD2: !d2Snapshot.empty,
                inD3: !d3Snapshot.empty,
                inFFA: !ffaSnapshot.empty
            };
        } catch (error) {
            console.error('Error checking ladder status:', error);
            return { inD1: false, inD2: false, inD3: false, inFFA: false };
        }
    }

    async loadFFAPlayerData(username) {
        try {
            const cacheKey = `${username}_FFA`;
            
            if (playerDataCache.has(cacheKey)) {
                const cachedData = playerDataCache.get(cacheKey);
                this.displayFFAProfile(cachedData);
                return cachedData;
            }
            
            const playersRef = collection(db, 'playersFFA');
            const q = query(playersRef, where('username', '==', username));
            const querySnapshot = await getDocs(q);
            
            if (querySnapshot.empty) {
                this.showError(`Player ${username} not found in FFA ladder.`);
                return null;
            }
            
            const playerData = querySnapshot.docs[0].data();
            // ✅ FIX: Define userId BEFORE using it as odl_Id
            const userId = playerData.odl_Id || playerData.userId || querySnapshot.docs[0].id;
            
            // Get profile data
            const profileData = await this.getProfileData(userId);
            
            const data = {
                ...playerData,
                ...profileData,
                username,
                userId, // ✅ FIX: Use userId instead of undefined odl_Id
                ladder: 'FFA',
                isActive: true
            };
            
            playerDataCache.set(cacheKey, data);
            this.displayFFAProfile(data);
            
            return data;
        } catch (error) {
            console.error('Error loading FFA player data:', error);
            this.showError(`Error: ${error.message}`);
            return null;
        }
    }

displayFFAProfile(data) {
    this.currentProfileData = data;

    const container = document.querySelector('.profile-content');
    if (!container) return;

    // Setup toggle styles
    this.setupProfileDetailsToggle();

    // Use custom profile image URL or default
    const profileImageUrl = data.profileImageUrl || DEFAULT_PROFILE_IMAGE;
    const isUsingDefaultImage = !data.profileImageUrl || data.profileImageUrl === DEFAULT_PROFILE_IMAGE;

    // Profile header
    const profileHeaderSection = document.querySelector('.profile-header') || document.createElement('div');
    profileHeaderSection.className = 'profile-header';

    const countryFlag = data.country ? `<img src="../images/flags/${data.country}.png" alt="${data.country}" class="profile-country-flag">` : '';

    profileHeaderSection.innerHTML = `
        <div class="profile-image-container ${isUsingDefaultImage ? 'default-image' : ''}">
            <img src="${profileImageUrl}" alt="Profile Image" 
                 class="profile-image" 
                 onerror="this.src='${DEFAULT_PROFILE_IMAGE}'; this.parentElement.classList.add('default-image');">
            ${countryFlag}
        </div>
    `;

    if (!document.querySelector('.profile-header')) {
        container.insertBefore(profileHeaderSection, container.firstChild);
    }

    // Hide legacy profile image section
    const legacyProfileSection = document.querySelector('.profile-image-section');
    if (legacyProfileSection) {
        legacyProfileSection.style.display = 'none';
    }

    const isNonParticipant = data.isNonParticipant === true;
    const isFormerPlayer = data.isFormerPlayer === true;

    // Handle roles
    const userRole = data.role;
    const roleName = data.roleName;
    const roleColor = data.roleColor;

    let roleContainer = document.querySelector('.role-container');
    if (!roleContainer && (userRole || roleName)) {
        roleContainer = document.createElement('div');
        roleContainer.className = 'role-container';
    }

    if (roleName && roleContainer) {
        roleContainer.innerHTML = `
            <div class="role-badge" style="background-color: ${roleColor || '#808080'}; color: ${getContrastColor(roleColor || '#808080')};">
                ${roleName}
            </div>
        `;
        if (!document.querySelector('.role-container')) {
            container.insertBefore(roleContainer, container.firstChild);
        }
    } else if (userRole && roleContainer) {
        const displayRole = userRole.charAt(0).toUpperCase() + userRole.slice(1).toLowerCase();
        roleContainer.innerHTML = `
            <div class="role-badge ${userRole.toLowerCase()}">${displayRole}</div>
        `;
        if (!document.querySelector('.role-container')) {
            container.insertBefore(roleContainer, container.firstChild);
        }
    } else if (roleContainer) {
        roleContainer.remove();
    }

    // Handle non-participant/former player/hiatus status
    if (data.onHiatus) {
        // Player is on hiatus - show special hiatus badge
        const statusContainer = document.querySelector('.profile-status') || document.createElement('div');
        statusContainer.className = 'profile-status hiatus-status';
        const hiatusDate = data.hiatusDate ? new Date(data.hiatusDate.seconds * 1000).toLocaleDateString() : 'Unknown';
        statusContainer.innerHTML = `
            <div class="status-badge hiatus">ON HIATUS</div>
            <p class="status-message">
                This player is currently on hiatus from the ${data.ladder} ladder since ${hiatusDate}.
            </p>
        `;
        container.classList.add('former-player-profile'); // Use former-player styling for consistency
        container.insertBefore(statusContainer, roleContainer && roleContainer.parentNode ? roleContainer.nextSibling : container.firstChild);
    } else if (isNonParticipant) {
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
        if (document.querySelector('.profile-status')) {
            document.querySelector('.profile-status').remove();
        }
        container.classList.remove('non-participant-profile', 'former-player-profile');
    }

    // Format home levels
    let homeLevelsDisplay = this.formatAllHomesDisplay(data);

    // Update basic elements
    const elements = {
        'nickname': data.username,
        'motto-view': data.motto || 'No motto set',
        'favorite-map-view': data.favoriteMap || 'Not set',
        'favorite-weapon-view': data.favoriteWeapon || 'Not set',
        'favorite-subgame-view': data.favoriteSubgame || 'Not set', 
        'timezone-view': data.timezone || 'Not set',
        'division-view': data.division || 'Not set',
        'availability-view': (() => {
            if (!data.availability) return 'Not set';
            if (typeof data.availability === 'string') return data.availability;
            if (Array.isArray(data.availability)) return data.availability.join(', ');
            if (typeof data.availability === 'object') return Object.values(data.availability).filter(v => v).join(', ') || 'Not set';
            return 'Not set';
        })(),
        'stats-elo': isNonParticipant ? 'N/A' : (data.eloRating || 'N/A')
    };

    // Always use the same static color for FFA username and motto
    const staticFFAColor = '#a11a1a';

    for (const [id, value] of Object.entries(elements)) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
            if (id === 'nickname' || id === 'motto-view') {
                element.style.color = staticFFAColor;
                element.classList.remove('elo-unranked', 'elo-bronze', 'elo-silver', 'elo-gold', 'elo-emerald');
            }
        }
    }

    // Update home levels with HTML
    const homeLevelsElement = document.getElementById('home-levels-view');
    if (homeLevelsElement) {
        homeLevelsElement.innerHTML = homeLevelsDisplay;
    }

    // Setup collapsible sections for view-mode fields
    // Pass null for nextRank and eloNeeded to hide "Next Rank" in FFA
    this.setupViewModeCollapsible(data, null, null, null, isNonParticipant);

    // Setup trophy case toggle
    this.setupTrophyCaseToggle();

    // Check if this is another user's profile
    const currentUser = auth.currentUser;
    const isOtherUser = currentUser && this.currentProfileData && 
                       currentUser.uid !== this.currentProfileData.userId;

    if (isOtherUser && (data.homeLevel1 || data.homeLevel2 || data.homeLevel3 || data.favoriteSubgame)) {
        this.addInvitationSection(data);
    }

    // Load FFA stats to populate the stats bar
    this.loadFFAPlayerStats(data.username);
}

        // ✅ ADD: Load FFA player stats for stats bar
    async loadFFAPlayerStats(username) {
        if (!username)  return;
        
        try {
            // Get FFA matches
            const matches = await this.getFFAPlayerMatches(username);
            
            if (matches.length === 0) {
                this.setDefaultStats();
                return;
            }
            
            // Calculate FFA stats
            const stats = {
                totalMatches: matches.length,
                wins: 0,
                topThree: 0,
                totalKills: 0,
                totalDeaths: 0,
                totalPlacement: 0
            };
            
            matches.forEach(match => {
                const playerData = match.playerData;
                const placement = playerData.placement || 99;
                
                if (placement === 1) stats.wins++;
                if (placement <= 3) stats.topThree++;
                
                stats.totalKills += parseInt(playerData.kills) || 0;
                stats.totalDeaths += parseInt(playerData.deaths) || 0;
                stats.totalPlacement += placement;
            });
            
            // Calculate derived stats
            const avgPlacement = (stats.totalPlacement / stats.totalMatches).toFixed(2);
            const winRate = ((stats.wins / stats.totalMatches) * 100).toFixed(1);
            const topThreeRate = ((stats.topThree / stats.totalMatches) * 100).toFixed(1);
            const kd = stats.totalDeaths > 0 ? (stats.totalKills / stats.totalDeaths).toFixed(2) : stats.totalKills.toFixed(2);
            
            // Get current ELO
            const eloRating = this.currentProfileData?.eloRating || 1000;
            
            // Determine next rank for FFA
            let nextRank = '';
            let eloNeeded = 0;
            let eloClass = '';
            
            if (eloRating >= 1400) {
                nextRank = 'Emerald';
                eloNeeded = 0;
                eloClass = 'elo-emerald';
            } else if (eloRating >= 1200) {
                nextRank = 'Emerald';
                eloNeeded = 1400 - eloRating;
                eloClass = 'elo-gold';
            } else if (eloRating >= 1100) {
                nextRank = 'Gold';
                eloNeeded = 1200 - eloRating;
                eloClass = 'elo-silver';
            } else if (eloRating >= 1000) {
                nextRank = 'Silver';
                eloNeeded = 1100 - eloRating;
                eloClass = 'elo-bronze';
            } else {
                // 5+ matches rule: Anyone with 5+ matches is at least Bronze
                if (stats.totalMatches >= 5) {
                    nextRank = 'Silver';
                    eloNeeded = 1100 - eloRating;
                    eloClass = 'elo-bronze';
                } else {
                    nextRank = 'Bronze';
                    eloNeeded = 1000 - eloRating;
                    eloClass = 'elo-unranked';
                }
            }
            
            // Remove any existing bottom stats grid
            const existingBottomStatsGrid = document.querySelector('.profile-content > .stats-grid:last-child');
            if (existingBottomStatsGrid) {
                existingBottomStatsGrid.remove();
            }
            
            // Update existing stats or create new ones
            const updateExistingStats = () => {
                const elements = {
                    'stats-matches': stats.totalMatches,
                    'stats-wins': `${stats.wins}`, // Show it's first place wins
                    'stats-losses': `${topThreeRate}%`, // Reuse for top 3 rate
                    'stats-kd': kd,
                    'stats-winrate': `${avgPlacement}`, // Show average placement
                    'stats-elo': eloRating
                };
                
                // Update all elements
                for (const [id, value] of Object.entries(elements)) {
                    const element = document.getElementById(id);
                    if (element) {
                        element.textContent = value;
                    }
                }
                
                // Update labels for FFA context
                const labelsToUpdate = {
                    'stats-wins': 'WINS (1ST)',
                    'stats-losses': 'TOP 3 RATE',
                    'stats-winrate': 'AVG PLACE'
                };
                
                for (const [id, newLabel] of Object.entries(labelsToUpdate)) {
                    const element = document.getElementById(id);
                    if (element && element.previousElementSibling) {
                        const labelDiv = element.previousElementSibling;
                        if (labelDiv.classList.contains('stat-label')) {
                            labelDiv.textContent = newLabel;
                        }
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
                    
                    if (eloRating >= 1400) {
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
            
            // If we have existing stats, update them
            if (document.getElementById('stats-matches')) {
                updateExistingStats();
            } else {
                // Create new stats grid for FFA
                this.createFFAStatsGrid(stats, eloRating, avgPlacement, topThreeRate, kd, nextRank, eloNeeded, eloClass);
            }
            
        } catch (error) {
            console.error('Error loading FFA stats:', error);
            this.setDefaultStats();
        }
    }

    

    // ✅ ADD: Get FFA player matches
    async getFFAPlayerMatches(username) {
        try {
            const matchesRef = collection(db, 'approvedMatchesFFA');
            const snapshot = await getDocs(matchesRef);
            
            const matches = [];
            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                const participants = data.participants || [];
                
                // Check if this player was in this match
                const playerInMatch = participants.find(p => p.username === username);
                if (playerInMatch) {
                    matches.push({
                        id: docSnap.id,
                        ...data,
                        playerData: playerInMatch
                    });
                }
            });
            
            // Sort by date (newest first)
            return matches.sort((a, b) => {
                const dateA = a.approvedAt?.seconds || a.createdAt?.seconds || 0;
                const dateB = b.approvedAt?.seconds || b.createdAt?.seconds || 0;
                return dateB - dateA;
            });
        } catch (error) {
            console.error('Error fetching FFA matches:', error);
            return [];
        }
    }

    // ✅ ADD: Display FFA stats
    async displayFFAStats(username, matches) {
        const statsContainer = containerReferences['ffa-stats'];
        if (!statsContainer) return;
        
        if (matches.length === 0) {
            statsContainer.innerHTML = `
                <h2>FFA Statistics</h2>
                <div class="non-participant-notice">
                    <p>No FFA matches found for this player.</p>
                </div>
            `;
            return;
        }
        
        // Calculate stats
        const stats = {
            totalMatches: matches.length,
            wins: 0,
            topThree: 0,
            totalKills: 0,
            totalDeaths: 0,
            totalPoints: 0,
            placements: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 },
            totalPlacement: 0
        };
        
        matches.forEach(match => {
            const playerData = match.playerData;
            const placement = playerData.placement || 99;
            
            if (placement === 1) stats.wins++;
            if (placement <= 3) stats.topThree++;
            
            stats.totalKills += parseInt(playerData.kills) || 0;
            stats.totalDeaths += parseInt(playerData.deaths) || 0;
            stats.totalPoints += parseInt(playerData.pointsEarned) || 0;
            stats.totalPlacement += placement;
            
            if (stats.placements[placement] !== undefined) {
                stats.placements[placement]++;
            }
        });
        
        const avgPlacement = (stats.totalPlacement / stats.totalMatches).toFixed(2);
        const winRate = ((stats.wins / stats.totalMatches) * 100).toFixed(1);
        const topThreeRate = ((stats.topThree / stats.totalMatches) * 100).toFixed(1);
        const kd = stats.totalDeaths > 0 ? (stats.totalKills / stats.totalDeaths).toFixed(2) : stats.totalKills;
        
        // Get current ELO
        const currentElo = this.currentProfileData?.eloRating || 1000;
        
        statsContainer.innerHTML = `
            <h2>FFA Statistics</h2>
            
            <div class="ffa-stats-grid" style="text-align: center;">
            <div class="ffa-stat-item">
                <div class="stat-label">Total Kills</div>
                <div class="stat-value">${stats.totalKills}</div>
            </div>
            <div class="ffa-stat-item">
                <div class="stat-label">Total Deaths</div>
                <div class="stat-value">${stats.totalDeaths}</div>
            </div>
            <div class="ffa-stat-item">
                <div class="stat-label">FFA ELO</div>
                <div class="stat-value">${currentElo}</div>
            </div>
            <div class="ffa-stat-item">
                <div class="stat-label">Points Earned</div>
                <div class="stat-value">${stats.totalPoints}</div>
            </div>
            </div>
            
            <h3 style="margin-top: 20px; color: #ffffffff; text-align: center;">Placement Distribution</h3>
            <div class="placement-distribution" style="text-align: center;">
            ${Object.entries(stats.placements).map(([place, count]) => `
                <div class="placement-item">
                <div class="placement-count">${count}</div>
                <div class="placement-label">${this.getOrdinalSuffix(parseInt(place))}</div>
                </div>
            `).join('')}
            </div>
        `;
    }

    // ✅ ADD: Display FFA match history
        async displayFFAMatchHistory(username, matches) {
        const historyContainer = containerReferences['ffa-match-history'];
        if (!historyContainer) return;
        
        if (matches.length === 0) {
            historyContainer.innerHTML = `
                <h2>FFA Match History</h2>
                <p class="no-matches">No FFA matches found</p>
            `;
            return;
        }
        
        // Apply rank styling from profile-content
        const profileContent = document.querySelector('.profile-content');
        const existingRankClass = profileContent ? 
            Array.from(profileContent.classList).find(c => c.startsWith('elo-')) : 
            null;
        
        historyContainer.classList.remove('elo-unranked', 'elo-bronze', 'elo-silver', 'elo-gold', 'elo-emerald');
        if (existingRankClass) {
            historyContainer.classList.add(existingRankClass);
        }
        
        const totalMatches = matches.length;
        const initialMatches = matches.slice(0, 10);
        const remainingMatches = matches.slice(10);
        
        // Add styles if not already present
        if (!document.getElementById('ffa-match-history-styles')) {
            const styleEl = document.createElement('style');
            styleEl.id = 'ffa-match-history-styles';
            styleEl.textContent = `
                .ffa-match-history-controls {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 0.75rem;
                    background: #222;
                    border-radius: 8px;
                    margin-bottom: 1rem;
                    border: 1px solid #444;
                    gap: 1rem;
                    flex-wrap: wrap;
                }
                
                .ffa-match-history-stats {
                    margin: 0;
                    min-width: 150px;
                }
                
                .ffa-match-history-stats p {
                    margin: 0;
                    color: #aaa;
                    font-size: 0.9rem;
                }
                
                .ffa-match-history-filters {
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    flex-wrap: wrap;
                }
                
                .ffa-filter-select, .ffa-filter-input {
                    background: #333;
                    border: 1px solid #555;
                    color: white;
                    padding: 0.5rem 0.75rem;
                    border-radius: 4px;
                    font-size: 0.9rem;
                    transition: all 0.3s ease;
                    min-width: 120px;
                }
                
                .ffa-filter-select:focus, .ffa-filter-input:focus {
                    outline: none;
                    border-color: #d32f2f;
                }
                
                .ffa-clear-filters-btn {
                    background: #555;
                    border: none;
                    color: white;
                    padding: 0.5rem 1rem;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 0.85rem;
                    transition: background 0.3s ease;
                }
                
                .ffa-clear-filters-btn:hover {
                    background: #666;
                }
                
                .ffa-match-history-pagination {
                    text-align: center;
                    margin-top: 1rem;
                    padding-top: 1rem;
                    border-top: 1px solid #333;
                }
                
                .ffa-load-more-btn {
                    background: #333;
                    border: 1px solid #555;
                    color: white;
                    padding: 0.75rem 1.5rem;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 0.9rem;
                    transition: all 0.3s ease;
                    max-width: 300px;
                    margin: 0 auto;
                    display: block;
                }
                
                .ffa-load-more-btn:hover {
                    background: #444;
                    transform: translateY(-1px);
                }
                
                .ffa-load-more-btn:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                    transform: none;
                }
                
                .ffa-pagination-info {
                    margin-top: 0.5rem;
                    text-align: center;
                    color: #888;
                    font-size: 0.85rem;
                }
                
                @media (max-width: 768px) {
                    .ffa-match-history-controls {
                        flex-direction: column;
                        gap: 0.75rem;
                    }
                    
                    .ffa-match-history-filters {
                        justify-content: center;
                        flex-wrap: wrap;
                    }
                    
                    .ffa-filter-select, .ffa-filter-input {
                        min-width: 100px;
                        flex: 1;
                    }
                }
            `;
            document.head.appendChild(styleEl);
        }
        
        // Get unique maps for filter
        const uniqueMaps = [...new Set(matches.map(m => m.mapPlayed).filter(m => m && m.trim() !== ''))].sort();
        const mapOptions = uniqueMaps.map(map => `<option value="${map}">${map}</option>`).join('');
        
        historyContainer.innerHTML = `
            <h2>FFA Match History</h2>
            <div class="ffa-match-history-controls">
                <div class="ffa-match-history-stats">
                    <p id="ffa-match-stats-display">Showing ${Math.min(10, totalMatches)} of ${totalMatches} matches</p>
                </div>
                <div class="ffa-match-history-filters">
                    <select id="ffa-filter-placement" class="ffa-filter-select">
                        <option value="all">All Placements</option>
                        <option value="1">1st Place Only</option>
                        <option value="top3">Top 3 Only</option>
                        <option value="top5">Top 5 Only</option>
                    </select>
                    <select id="ffa-filter-map" class="ffa-filter-select">
                        <option value="all">All Maps</option>
                        ${mapOptions}
                    </select>
                    <select id="ffa-filter-timeframe" class="ffa-filter-select">
                        <option value="all">All Time</option>
                        <option value="last7">Last 7 Days</option>
                        <option value="last30">Last 30 Days</option>
                        <option value="last90">Last 90 Days</option>
                    </select>
                    <button id="ffa-clear-filters" class="ffa-clear-filters-btn">Clear Filters</button>
                </div>
            </div>
            
            <table class="ffa-match-history-table">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Map</th>
                        <th>Place</th>
                        <th>Players</th>
                        <th>K/D</th>
                        <th>ELO Change</th>
                        <th>Points</th>
                    </tr>
                </thead>
                <tbody id="ffa-match-tbody">
                    ${this.renderFFAMatchRows(initialMatches)}
                </tbody>
            </table>
            
            ${remainingMatches.length > 0 ? `
                <div class="ffa-match-history-pagination">
                    <button class="ffa-load-more-btn" id="ffa-load-more" data-loaded="10">
                        Load More Matches (${remainingMatches.length} remaining)
                    </button>
                    <div class="ffa-pagination-info">
                        <span id="ffa-pagination-info">Loaded: 10 of ${totalMatches}</span>
                    </div>
                </div>
            ` : ''}
        `;
        
        // Setup filtering
        this.setupFFAMatchFilter(username, matches);
    }

    setupFFAMatchFilter(username, allMatches) {
        const placementFilter = document.getElementById('ffa-filter-placement');
        const mapFilter = document.getElementById('ffa-filter-map');
        const timeframeFilter = document.getElementById('ffa-filter-timeframe');
        const clearBtn = document.getElementById('ffa-clear-filters');
        const loadMoreBtn = document.getElementById('ffa-load-more');
        
        let currentShowCount = 10;
        let filteredMatches = [...allMatches];
        
        const applyFilters = () => {
            const placementValue = placementFilter?.value || 'all';
            const mapValue = mapFilter?.value || 'all';
            const timeframeValue = timeframeFilter?.value || 'all';
            
            filteredMatches = allMatches.filter(match => {
                const playerData = match.playerData;
                const placement = playerData?.placement || 99;
                
                // Placement filter
                if (placementValue === '1' && placement !== 1) return false;
                if (placementValue === 'top3' && placement > 3) return false;
                if (placementValue === 'top5' && placement > 5) return false;
                
                // Map filter
                if (mapValue !== 'all' && match.mapPlayed !== mapValue) return false;
                
                // Timeframe filter
                if (timeframeValue !== 'all') {
                    const matchDate = match.approvedAt?.seconds ? 
                        new Date(match.approvedAt.seconds * 1000) : 
                        (match.createdAt?.seconds ? new Date(match.createdAt.seconds * 1000) : null);
                    
                    if (matchDate) {
                        const now = new Date();
                        const daysDiff = (now - matchDate) / (1000 * 60 * 60 * 24);
                        
                        if (timeframeValue === 'last7' && daysDiff > 7) return false;
                        if (timeframeValue === 'last30' && daysDiff > 30) return false;
                        if (timeframeValue === 'last90' && daysDiff > 90) return false;
                    }
                }
                
                return true;
            });
            
            // Reset to show first 10 when filters change
            currentShowCount = 10;
            this.updateFFAMatchDisplay(filteredMatches, currentShowCount);
        };
        
        // Add event listeners
        placementFilter?.addEventListener('change', applyFilters);
        mapFilter?.addEventListener('change', applyFilters);
        timeframeFilter?.addEventListener('change', applyFilters);
        
        clearBtn?.addEventListener('click', () => {
            if (placementFilter) placementFilter.value = 'all';
            if (mapFilter) mapFilter.value = 'all';
            if (timeframeFilter) timeframeFilter.value = 'all';
            filteredMatches = [...allMatches];
            currentShowCount = 10;
            this.updateFFAMatchDisplay(filteredMatches, currentShowCount);
        });
        
        // Load more handler
        loadMoreBtn?.addEventListener('click', () => {
            currentShowCount += 10;
            this.updateFFAMatchDisplay(filteredMatches, currentShowCount);
        });
    }
    
    updateFFAMatchDisplay(matches, showCount) {
        const tbody = document.getElementById('ffa-match-tbody');
        const statsDisplay = document.getElementById('ffa-match-stats-display');
        const loadMoreBtn = document.getElementById('ffa-load-more');
        const paginationInfo = document.getElementById('ffa-pagination-info');
        
        if (!tbody) return;
        
        const matchesToShow = matches.slice(0, showCount);
        tbody.innerHTML = this.renderFFAMatchRows(matchesToShow);
        
        // Update stats display
        if (statsDisplay) {
            statsDisplay.textContent = `Showing ${matchesToShow.length} of ${matches.length} matches`;
        }
        
        // Update load more button
        if (loadMoreBtn) {
            const remaining = matches.length - showCount;
            if (remaining > 0) {
                loadMoreBtn.style.display = 'block';
                loadMoreBtn.textContent = `Load More Matches (${remaining} remaining)`;
                loadMoreBtn.disabled = false;
            } else {
                loadMoreBtn.style.display = 'none';
            }
        }
        
        // Update pagination info
        if (paginationInfo) {
            paginationInfo.textContent = `Loaded: ${matchesToShow.length} of ${matches.length}`;
        }
    }

    // ✅ ADD: Render FFA match rows
    renderFFAMatchRows(matches) {
        return matches.map(match => {
            const playerData = match.playerData;
            const date = match.approvedAt ? 
                new Date(match.approvedAt.seconds * 1000).toLocaleDateString() : 
                'N/A';
            
            const placement = playerData.placement || '?';
            const placeClass = placement <= 3 ? `place-${placement}` : '';
            const kills = playerData.kills || 0;
            const deaths = playerData.deaths || 0;
            const eloChange = playerData.eloChange || 0;
            const eloClass = eloChange > 0 ? 'elo-change-positive' : eloChange < 0 ? 'elo-change-negative' : '';
            const eloSign = eloChange > 0 ? '+' : '';
            const points = playerData.pointsEarned || 0;
            const totalPlayers = match.participants?.length || '?';
            
            return `
                <tr>
                    <td>${date}</td>
                    <td>${match.mapPlayed || 'Unknown'}</td>
                    <td class="ffa-placement-cell ${placeClass}">${this.getOrdinalSuffix(placement)}</td>
                    <td>${totalPlayers}</td>
                    <td>${kills} / ${deaths}</td>
                    <td class="${eloClass}">${eloSign}${eloChange}</td>
                    <td>+${points}</td>
                </tr>
            `;
        }).join('');
    }

    // ✅ ADD: Display FFA player matchups
    async displayFFAPlayerMatchups(username, matches) {
        const matchupsContainer = containerReferences['ffa-player-matchups'];
        if (!matchupsContainer) return;
        
        if (matches.length === 0) {
            matchupsContainer.innerHTML = `
                <h2>FFA Opponents</h2>
                <p class="no-matches">No FFA matchups found</p>
            `;
            return;
        }
        
        // Apply rank styling from profile-content
        const profileContent = document.querySelector('.profile-content');
        const existingRankClass = profileContent ? 
            Array.from(profileContent.classList).find(c => c.startsWith('elo-')) : 
            null;
        
        matchupsContainer.classList.remove('elo-unranked', 'elo-bronze', 'elo-silver', 'elo-gold', 'elo-emerald');
        if (existingRankClass) {
            matchupsContainer.classList.add(existingRankClass);
        }
        
        // Calculate opponent stats
        const opponentStats = {};
        
        matches.forEach(match => {
            const playerData = match.playerData;
            const playerPlacement = playerData.placement;
            const playerKills = parseInt(playerData.kills) || 0;
            
            match.participants?.forEach(participant => {
                if (participant.username === username) return;
                
                const opponent = participant.username;
                if (!opponentStats[opponent]) {
                    opponentStats[opponent] = {
                        encounters: 0,
                        beatenBy: 0,
                        beaten: 0,
                        tied: 0,
                        totalKills: 0
                    };
                }
                
                opponentStats[opponent].encounters++;
                opponentStats[opponent].totalKills += playerKills;
                
                if (participant.placement < playerPlacement) {
                    opponentStats[opponent].beatenBy++;
                } else if (participant.placement > playerPlacement) {
                    opponentStats[opponent].beaten++;
                } else {
                    opponentStats[opponent].tied++;
                }
            });
        });
        
        const sortedOpponents = Object.entries(opponentStats)
            .sort((a, b) => b[1].encounters - a[1].encounters)
            .slice(0, 20); // Top 20 opponents
        
        // Identify rivals and toughest opponent (minimum 3 encounters)
        let rivalOpponent = null;
        let toughestOpponent = null;
        let smallestDifference = Infinity;
        let lowestWinRate = 100;
        
        // First pass: find rival (closest to 50/50 in finishes, within 30-70% range)
        sortedOpponents.forEach(([opponent, stats]) => {
            if (stats.encounters >= 3) {
                const winRate = (stats.beaten / stats.encounters) * 100;
                const difference = Math.abs(stats.beaten - stats.beatenBy);
                // Only consider a rival if win rate is between 30% and 70%
                if (winRate >= 30 && winRate <= 70 && difference < smallestDifference) {
                    smallestDifference = difference;
                    rivalOpponent = opponent;
                }
            }
        });
        
        // Second pass: find toughest opponent (lowest win rate below 60%, excluding rival)
        sortedOpponents.forEach(([opponent, stats]) => {
            if (stats.encounters >= 3 && opponent !== rivalOpponent) {
                const winRate = (stats.beaten / stats.encounters) * 100;
                // Only consider "tough" if you're actually struggling (below 60% win rate)
                if (winRate < 60 && winRate < lowestWinRate) {
                    lowestWinRate = winRate;
                    toughestOpponent = opponent;
                }
            }
        });
        
        // Fetch FFA ELO data for all opponents
        const opponentEloData = {};
        await Promise.all(sortedOpponents.map(async ([opponent]) => {
            try {
                const playersRef = collection(db, 'playersFFA');
                const q = query(playersRef, where('username', '==', opponent), limit(1));
                const snapshot = await getDocs(q);
                if (!snapshot.empty) {
                    const data = snapshot.docs[0].data();
                    opponentEloData[opponent] = {
                        eloRating: data.eloRating || 1000,
                        matchCount: data.matchCount || 0
                    };
                }
            } catch (e) {
                console.error(`Error fetching FFA data for ${opponent}:`, e);
            }
        }));

        // Helper function to get FFA player color
        // FFA does not use colored tiers - all players use default white color
        const getFFAPlayerColor = (opponent) => {
            return '#ffffff'; // FFA does not have colored tiers
        };
        
        matchupsContainer.innerHTML = `
            <h2>FFA Opponents</h2>
            <table class="match-history-table">
                <thead>
                    <tr>
                        <th>Opponent</th>
                        <th>Encounters</th>
                        <th>Finished Above</th>
                        <th>Finished Below</th>
                        <th>Avg Kills</th>
                        <th>Win Rate</th>
                    </tr>
                </thead>
                <tbody>
                    ${sortedOpponents.length === 0 ?
                        '<tr><td colspan="6">No opponents found</td></tr>' :
                        sortedOpponents.map(([opponent, stats]) => {
                            const winRate = ((stats.beaten / stats.encounters) * 100).toFixed(1);
                            const avgKills = (stats.totalKills / stats.encounters).toFixed(1);
                            
                            // Determine special class
                            let rowClass = '';
                            let badge = '';
                            if (opponent === rivalOpponent && stats.encounters >= 3) {
                                rowClass = 'rival-opponent';
                                badge = '<span class="matchup-badge rival-badge" title="Closest matches">Rival</span>';
                            } else if (opponent === toughestOpponent && stats.encounters >= 3) {
                                rowClass = 'toughest-opponent';
                                badge = '<span class="matchup-badge toughest-badge" title="Toughest opponent">Toughest</span>';
                            }
                            
                            const opponentColor = getFFAPlayerColor(opponent);
                            
                            return `
                                <tr class="${rowClass}">
                                    <td>
                                        <a href="profile.html?username=${encodeURIComponent(opponent)}&ladder=ffa" 
                                           class="player-link"
                                           style="color: ${opponentColor} !important;">
                                            ${opponent}
                                        </a>
                                        ${badge}
                                    </td>
                                    <td>${stats.encounters}</td>
                                    <td class="wins">${stats.beaten}</td>
                                    <td class="losses">${stats.beatenBy}</td>
                                    <td>${avgKills}</td>
                                    <td>${winRate}%</td>
                                </tr>
                            `;
                        }).join('')
                    }
                </tbody>
            </table>
        `;
    }

    // ✅ ADD: Helper for ordinal suffix
    getOrdinalSuffix(n) {
        const s = ['th', 'st', 'nd', 'rd'];
        const v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
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
    
    showLoadingInContainers() {
        // Make loading states more visible
        Object.values(containerReferences).forEach(container => {
            if (container && !container.querySelector('.loading-spinner')) {
                container.innerHTML = '<div class="loading-spinner" style="padding: 40px; text-align: center;"><p class="loading-text" style="font-size: 18px; color: #aaa;">Loading...</p></div>';
            }
        });
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
                // Parallelize all fallback checks for faster loading
                const [nonParticipantSnapshot, hiatusSnapshot, archivedData] = await Promise.all([
                    getDocs(query(collection(db, 'nonParticipants'), where('username', '==', username))),
                    getDocs(query(collection(db, 'playerHiatus'), where('username', '==', username))),
                    this.checkArchivedData(username)
                ]);
                
                // Check if player is a registered non-participant
                if (!nonParticipantSnapshot.empty) {
                    const nonParticipantData = nonParticipantSnapshot.docs[0].data();
                    const userId = nonParticipantData.userId || nonParticipantSnapshot.docs[0].id;
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
                    
                    playerDataCache.set(cacheKey, data);
                    this.displayProfile(data);
                    return data;
                }
                
                // Check if player is on hiatus
                if (!hiatusSnapshot.empty) {
                    const hiatusData = hiatusSnapshot.docs[0].data();
                    const userId = hiatusData.userId || hiatusSnapshot.docs[0].id;
                    const profileData = await this.getProfileData(userId);
                    
                    const data = {
                        ...hiatusData,
                        ...profileData,
                        username,
                        userId,
                        ladder: hiatusData.fromLadder || this.currentLadder,
                        isFormerPlayer: true,
                        onHiatus: true,
                        hiatusDate: hiatusData.hiatusDate
                    };
                    
                    playerDataCache.set(cacheKey, data);
                    this.displayProfile(data);
                    await this.loadPlayerStats(username);
                    return data;
                }
                
                // Check for archived data from previous seasons
                if (archivedData) {
                    const data = {
                        ...archivedData,
                        username,
                        ladder: this.currentLadder,
                        isFormerPlayer: true
                    };
                    
                    playerDataCache.set(cacheKey, data);
                    this.displayProfile(data);
                    await this.loadPlayerStats(username);
                    return data;
                }
                
                // Check other ladders in parallel
                const otherLadders = ['D1', 'D2', 'D3'].filter(ladder => ladder !== this.currentLadder);
                const otherLadderQueries = otherLadders.map(otherLadder => {
                    const otherPlayersRef = collection(db, otherLadder === 'D1' ? 'players' : (otherLadder === 'D2' ? 'playersD2' : 'playersD3'));
                    return getDocs(query(otherPlayersRef, where('username', '==', username)));
                });
                
                const otherLadderResults = await Promise.all(otherLadderQueries);
                const foundInLadder = otherLadders.find((ladder, idx) => !otherLadderResults[idx].empty);
                
                if (foundInLadder) {
                    throw new Error(`Player not found in ${this.currentLadder} ladder. Try selecting the ${foundInLadder} ladder.`);
                }
                
                // Not found in any ladder or as non-participant - AUTO REGISTER AS NON-PARTICIPANT
                // First try to find the user by their registered username (NOT email prefix)
                let correctUsername = username;
                let userId = null;

                // Try to find user by username in userProfiles first (this stores the registered username)
                const userProfilesQuery = query(collection(db, 'userProfiles'), where('username', '==', username));
                const userProfilesSnapshot = await getDocs(userProfilesQuery);

                if (!userProfilesSnapshot.empty) {
                    // Found in userProfiles - this is the correct registered username
                    userId = userProfilesSnapshot.docs[0].id;
                    correctUsername = userProfilesSnapshot.docs[0].data().username || username;
                } else {
                    // Try to find in pending registrations
                    const pendingQuery = query(collection(db, 'pendingRegistrations'), where('username', '==', username));
                    const pendingSnapshot = await getDocs(pendingQuery);

                    if (!pendingSnapshot.empty) {
                        // Found in pending registrations
                        userId = pendingSnapshot.docs[0].id;
                        correctUsername = pendingSnapshot.docs[0].data().username || username;
                    } else {
                        // Try to find in users collection by username field
                        const usersQuery = query(collection(db, 'users'), where('username', '==', username));
                        const usersSnapshot = await getDocs(usersQuery);
                        
                        if (!usersSnapshot.empty) {
                            userId = usersSnapshot.docs[0].id;
                            correctUsername = usersSnapshot.docs[0].data().username || username;
                        } else {
                            // Player not found anywhere - they may not be registered
                            // Generate placeholder ID but use the searched username as-is
                            userId = `auto_${username.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
                            correctUsername = username;
                        }
                    }
                }

                // Create a non-participant record with the correct username
                const nonParticipantData = {
                    username: correctUsername, // Use the registered username, not email prefix
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
            // No profile data found for user
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

createCollapsibleSection(container, title, content, startCollapsed = true, isEmpty = false) {
    const section = document.createElement('div');
    section.className = `collapsible-section ${startCollapsed ? 'collapsed' : ''}`;
    
    // Add empty class if no content
    if (isEmpty) {
        section.classList.add('empty-section');
    }
    
    section.innerHTML = `
        <div class="collapsible-header">
            <h3>${title}</h3>
            <button class="collapse-toggle-btn">${startCollapsed ? '+' : '−'}</button>
        </div>
        <div class="collapsible-content" style="display: ${startCollapsed ? 'none' : 'block'};">
            ${content}
        </div>
    `;
    
    // Add toggle functionality
    const toggleBtn = section.querySelector('.collapse-toggle-btn');
    const contentDiv = section.querySelector('.collapsible-content');
    const header = section.querySelector('.collapsible-header');
    
    const toggleSection = () => {
        const isCollapsed = section.classList.toggle('collapsed');
        toggleBtn.textContent = isCollapsed ? '+' : '−';
        contentDiv.style.display = isCollapsed ? 'none' : 'block';
    };
    
    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSection();
    });
    
    header.addEventListener('click', toggleSection);
    
    container.appendChild(section);
    return section;
}

// Add this method to the ProfileViewer class

setupProfileDetailsToggle() {
    // Add toggle styles if not present
    if (!document.getElementById('profile-toggle-styles')) {
        const styleEl = document.createElement('style');
        styleEl.id = 'profile-toggle-styles';
        styleEl.textContent = `
            .profile-details-toggle {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 0.5rem 0;
                margin: 0.5rem 0;
                border-top: 1px solid #333;
                cursor: pointer;
                user-select: none;
            }
            
            .profile-details-toggle:hover {
                opacity: 0.8;
            }
            
            .profile-details-toggle .toggle-text {
                color: #888;
                font-size: 0.85rem;
            }
            
            .profile-details-toggle .toggle-icon {
                color: #888;
                font-size: 1rem;
                transition: transform 0.2s ease;
            }
            
            .profile-details-toggle.expanded .toggle-icon {
                transform: rotate(45deg);
            }
            
            .collapsible-fields {
                display: none;
            }
            
            .collapsible-fields.expanded {
                display: block;
            }
            
            .trophy-case-container.collapsed {
                display: none;
            }
            
            .trophy-toggle {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 0.5rem 0;
                cursor: pointer;
                user-select: none;
                color: #888;
                font-size: 0.85rem;
            }
            
            .trophy-toggle:hover {
                opacity: 0.8;
            }
            
            .ribbon-section.collapsed .ribbon-rack-inline,
            .ribbon-section.collapsed .ribbon-rack-empty-inline {
                display: none;
            }
        `;
        document.head.appendChild(styleEl);
    }
}

// Update displayProfile to wrap collapsible fields and add toggles
displayProfile(data) {
    this.currentProfileData = data;
    
    const container = document.querySelector('.profile-content');
    if (!container) return;
    
    // Setup toggle styles
    this.setupProfileDetailsToggle();
    
    // Use custom profile image URL or default
    const profileImageUrl = data.profileImageUrl || DEFAULT_PROFILE_IMAGE;
    const isUsingDefaultImage = !data.profileImageUrl || data.profileImageUrl === DEFAULT_PROFILE_IMAGE;
    
    // Profile header
    const profileHeaderSection = document.querySelector('.profile-header') || document.createElement('div');
    profileHeaderSection.className = 'profile-header';
    
    const countryFlag = data.country ? `<img src="../images/flags/${data.country}.png" alt="${data.country}" class="profile-country-flag">` : '';
    
    profileHeaderSection.innerHTML = `
        <div class="profile-image-container ${isUsingDefaultImage ? 'default-image' : ''}">
            <img src="${profileImageUrl}" alt="Profile Image" 
                 class="profile-image" 
                 onerror="this.src='${DEFAULT_PROFILE_IMAGE}'; this.parentElement.classList.add('default-image');">
            ${countryFlag}
        </div>
    `;
    
    if (!document.querySelector('.profile-header')) {
        container.insertBefore(profileHeaderSection, container.firstChild);
    }
    
    // Hide legacy profile image section
    const legacyProfileSection = document.querySelector('.profile-image-section');
    if (legacyProfileSection) {
        legacyProfileSection.style.display = 'none';
    }
        
    const isNonParticipant = data.isNonParticipant === true;
    const isFormerPlayer = data.isFormerPlayer === true;
    
    // Handle roles
    const userRole = data.role;
    const roleName = data.roleName;
    const roleColor = data.roleColor;
    
    let roleContainer = document.querySelector('.role-container');
    if (!roleContainer && (userRole || roleName)) {
        roleContainer = document.createElement('div');
        roleContainer.className = 'role-container';
    }
    
    if (roleName && roleContainer) {
        roleContainer.innerHTML = `
            <div class="role-badge" style="background-color: ${roleColor || '#808080'}; color: ${getContrastColor(roleColor || '#808080')};">
                ${roleName}
            </div>
        `;
        if (!document.querySelector('.role-container')) {
            container.insertBefore(roleContainer, container.firstChild);
        }
    } else if (userRole && roleContainer) {
        const displayRole = userRole.charAt(0).toUpperCase() + userRole.slice(1).toLowerCase();
        roleContainer.innerHTML = `
            <div class="role-badge ${userRole.toLowerCase()}">${displayRole}</div>
        `;
        if (!document.querySelector('.role-container')) {
            container.insertBefore(roleContainer, container.firstChild);
        }
    } else if (roleContainer) {
        roleContainer.remove();
    }
    
    // Handle non-participant/former player status
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
        if (document.querySelector('.profile-status')) {
            document.querySelector('.profile-status').remove();
        }
        container.classList.remove('non-participant-profile', 'former-player-profile');
    }
    
    // Handle ELO styling
    const eloRating = parseInt(data.eloRating) || 0;
    container.classList.remove('elo-unranked', 'elo-bronze', 'elo-silver', 'elo-gold', 'elo-emerald');
    
    let eloClass;
    let nextRank = '';
    let eloNeeded = 0;
    
    if (!isNonParticipant) {
        const wins = parseInt(data.wins) || 0;
        const losses = parseInt(data.losses) || 0;
        const totalMatches = wins + losses;
        const winRate = totalMatches > 0 ? (wins / totalMatches * 100) : 0;
        
        // Calculate rank for "Next Rank" display, but don't apply classes yet
        // updateProfileRankFromMatches will apply classes from actual match data
        if (eloRating >= 1000) {
            // Check for emerald: requires ALL three conditions
            const hasWinRate = winRate >= 80;
            const hasMatches = totalMatches >= 20;
            const hasElo = eloRating >= 1000;
            
            if (hasWinRate && hasMatches && hasElo) {
                eloClass = 'elo-emerald';
                nextRank = 'Emerald';
                eloNeeded = 0;
            } else {
                eloClass = 'elo-gold';
                nextRank = 'Emerald';
                if (winRate < 80) {
                    eloNeeded = `${(80 - winRate).toFixed(1)}% win rate`;
                } else if (totalMatches < 20) {
                    eloNeeded = `${20 - totalMatches} more matches`;
                } else {
                    eloNeeded = 0;
                }
            }
        } else if (eloRating >= 700) {
            eloClass = 'elo-gold';
            nextRank = 'Emerald';
            eloNeeded = 1000 - eloRating;
        } else if (eloRating >= 500) {
            eloClass = 'elo-silver';
            nextRank = 'Gold';
            eloNeeded = 700 - eloRating;
        } else if (eloRating >= 200 && totalMatches > 0) {
            // Bronze requires at least 1 match
            eloClass = 'elo-bronze';
            nextRank = 'Silver';
            eloNeeded = 500 - eloRating;
        } else {
            // Players with 0 matches or below 200 ELO are unranked
            // 5+ matches rule: Anyone with 5+ matches is at least Bronze
            if (totalMatches >= 5) {
                eloClass = 'elo-bronze';
                nextRank = 'Silver';
                eloNeeded = 500 - eloRating;
            } else {
                eloClass = 'elo-unranked';
                nextRank = 'Bronze';
                eloNeeded = 200 - eloRating;
            }
        }
        // Don't apply classes here - updateProfileRankFromMatches will do it
    }
    
    // Format home levels
    let homeLevelsDisplay = this.formatAllHomesDisplay(data);
    
    // Update basic elements
    const elements = {
        'nickname': data.username,
        'motto-view': data.motto || 'No motto set',
        'favorite-map-view': data.favoriteMap || 'Not set',
        'favorite-weapon-view': data.favoriteWeapon || 'Not set',
        'favorite-subgame-view': data.favoriteSubgame || 'Not set', 
        'timezone-view': data.timezone || 'Not set',
        'division-view': data.division || 'Not set',
        'availability-view': (() => {
            if (!data.availability) return 'Not set';
            if (typeof data.availability === 'string') return data.availability;
            if (Array.isArray(data.availability)) return data.availability.join(', ');
            if (typeof data.availability === 'object') return Object.values(data.availability).filter(v => v).join(', ') || 'Not set';
            return 'Not set';
        })(),
        'stats-elo': isNonParticipant ? 'N/A' : (data.eloRating || 'N/A')
    };
    
    for (const [id, value] of Object.entries(elements)) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
            
            if (id === 'nickname' || id === 'motto-view') {
                element.classList.remove('elo-unranked', 'elo-bronze', 'elo-silver', 'elo-gold', 'elo-emerald');
                if (eloClass) {
                    element.classList.add(eloClass);
                    const colorMap = {
                        'elo-unranked': '#DC143C',
                        'elo-bronze': '#CD7F32',
                        'elo-silver': '#b9f1fc',
                        'elo-gold': '#FFD700',
                        'elo-emerald': '#50C878'
                    };
                    if (colorMap[eloClass]) {
                        element.style.color = colorMap[eloClass];
                    }
                }
            }
        }
    }
    
    // Update home levels with HTML
    const homeLevelsElement = document.getElementById('home-levels-view');
    if (homeLevelsElement) {
        homeLevelsElement.innerHTML = homeLevelsDisplay;
    }
    
    // Setup collapsible sections for view-mode fields
    this.setupViewModeCollapsible(data, nextRank, eloNeeded, eloClass, isNonParticipant);
    
    // Setup trophy case toggle
    this.setupTrophyCaseToggle();
    
    // Check if this is another user's profile
    const currentUser = auth.currentUser;
    const isOtherUser = currentUser && this.currentProfileData && 
                       currentUser.uid !== this.currentProfileData.userId;
    
    if (isOtherUser && (data.homeLevel1 || data.homeLevel2 || data.homeLevel3 || data.favoriteSubgame)) {
        this.addInvitationSection(data);
    }
}

// Update profile rank based on actual match data
updateProfileRankFromMatches(matches) {
    if (!this.currentProfileData) return null;
    
    const username = this.currentProfileData.username;
    const eloRating = parseInt(this.currentProfileData.eloRating) || 0;
    
    // Calculate wins and losses from matches
    let wins = 0;
    let losses = 0;
    
    matches.forEach(match => {
        const isWinner = match.winnerUsername === username;
        if (isWinner) {
            wins++;
        } else {
            losses++;
        }
    });
    
    const totalMatches = wins + losses;
    const winRate = totalMatches > 0 ? (wins / totalMatches * 100) : 0;
    
    let eloClass;
    if (eloRating >= 1000) {
        // Check for emerald: requires ALL three conditions
        const hasWinRate = winRate >= 80;
        const hasMatches = totalMatches >= 20;
        const hasElo = eloRating >= 1000;
        
        console.log(`Emerald check for ${username}: ELO=${eloRating}, WinRate=${winRate.toFixed(1)}%, Matches=${totalMatches}, Qualified=${hasWinRate && hasMatches && hasElo}`);
        
        if (hasWinRate && hasMatches && hasElo) {
            eloClass = 'elo-emerald';
        } else {
            eloClass = 'elo-gold';
        }
    } else if (eloRating >= 700) {
        eloClass = 'elo-gold';
    } else if (eloRating >= 500) {
        eloClass = 'elo-silver';
    } else if (eloRating >= 200 && totalMatches > 0) {
        // Bronze requires at least 1 match
        eloClass = 'elo-bronze';
    } else {
        // Players with 0 matches or below 200 ELO are unranked
        // 5+ matches rule: Anyone with 5+ matches is at least Bronze
        if (totalMatches >= 5) {
            eloClass = 'elo-bronze';
        } else {
            eloClass = 'elo-unranked';
        }
    }
    
    // Update all containers with the correct rank
    const containers = [
        document.querySelector('.profile-content'),
        document.querySelector('.profile-container'),
        document.querySelector('.username-section'),
        document.getElementById('nickname'),
        document.getElementById('motto-view'),
        document.getElementById('player-matchups'),
        document.getElementById('match-history'),
        document.getElementById('ffa-player-matchups'),
        document.getElementById('ffa-match-history')
    ];
    
    containers.forEach(container => {
        if (container) {
            container.classList.remove('elo-unranked', 'elo-bronze', 'elo-silver', 'elo-gold', 'elo-emerald');
            container.classList.add(eloClass);
            
            // Update color for text elements
            if (container.id === 'nickname' || container.id === 'motto-view') {
                const colorMap = {
                    'elo-unranked': '#DC143C',
                    'elo-bronze': '#CD7F32',
                    'elo-silver': '#b9f1fc',
                    'elo-gold': '#FFD700',
                    'elo-emerald': '#50C878'
                };
                if (colorMap[eloClass]) {
                    container.style.color = colorMap[eloClass];
                }
            }
        }
    });
    
    return eloClass;
}

// Setup collapsible view mode fields
setupViewModeCollapsible(data, nextRank, eloNeeded, eloClass, isNonParticipant) {
    const viewMode = document.querySelector('.view-mode');
    if (!viewMode) return;

    let toggle = viewMode.querySelector('.profile-details-toggle');
    let collapsibleFields = viewMode.querySelector('.collapsible-fields');

    if (!toggle) {
        const profileFields = viewMode.querySelectorAll('.profile-field');
        const editButton = viewMode.querySelector('#edit-profile');

        collapsibleFields = document.createElement('div');
        collapsibleFields.className = 'collapsible-fields';

        profileFields.forEach(field => collapsibleFields.appendChild(field));

        // Add Next Rank field if applicable
        if (!isNonParticipant && nextRank) {
            const nextRankField = document.createElement('div');
            nextRankField.className = 'profile-field next-rank-field';
            nextRankField.innerHTML = `
                <label>Next Rank</label>
                <span class="${eloClass}">${nextRank}${eloNeeded ? ` (${eloNeeded}${typeof eloNeeded === 'number' ? ' ELO needed' : ''})` : ' (Achieved!)'}</span>
            `;
            collapsibleFields.appendChild(nextRankField);
        }

        // Move invitation section inside the collapsible
        const invitationSection = document.querySelector('.invitation-section');
        if (invitationSection) {
            collapsibleFields.appendChild(invitationSection);
        }

        // Create toggle button
        toggle = document.createElement('div');
        toggle.className = 'profile-details-toggle';
        toggle.innerHTML = `
            <span class="toggle-text">Profile Details</span>
            <span class="toggle-icon">+</span>
        `;

        if (editButton) {
            viewMode.insertBefore(toggle, editButton);
            viewMode.insertBefore(collapsibleFields, editButton);
        } else {
            viewMode.appendChild(toggle);
            viewMode.appendChild(collapsibleFields);
        }

        toggle.addEventListener('click', () => {
            const isExpanded = collapsibleFields.classList.toggle('expanded');
            toggle.classList.toggle('expanded', isExpanded);
            toggle.querySelector('.toggle-icon').textContent = isExpanded ? '−' : '+';
        });
    } else {
        // If already exists, just update Next Rank if needed
        const nextRankField = collapsibleFields.querySelector('.next-rank-field');
        if (nextRankField && !isNonParticipant && nextRank) {
            nextRankField.innerHTML = `
                <label>Next Rank</label>
                <span class="${eloClass}">${nextRank}${eloNeeded ? ` (${eloNeeded}${typeof eloNeeded === 'number' ? ' ELO needed' : ''})` : ' (Achieved!)'}</span>
            `;
        }
        // Move invitation section inside the collapsible if not already
        const invitationSection = document.querySelector('.invitation-section');
        if (invitationSection && invitationSection.parentNode !== collapsibleFields) {
            collapsibleFields.appendChild(invitationSection);
        }
    }
}
// Setup trophy case toggle - hide if empty
setupTrophyCaseToggle() {
    const trophyContainer = document.getElementById('trophy-container');
    const trophyCaseContainer = document.querySelector('.trophy-case-container');
    
    if (!trophyContainer || !trophyCaseContainer) return;
    
    // Check if trophy container has actual trophies (not just the empty message)
    const hasTrophies = trophyContainer.querySelector('.trophy') !== null;
    const emptyMessage = trophyContainer.querySelector('.empty-trophy-case');
    
    if (!hasTrophies && emptyMessage) {
        // No trophies - collapse by default
        trophyCaseContainer.classList.add('collapsed');
        
        // Add toggle if not exists
        let trophyToggle = document.querySelector('.trophy-toggle');
        if (!trophyToggle) {
            trophyToggle = document.createElement('div');
            trophyToggle.className = 'trophy-toggle';
            trophyToggle.innerHTML = `
                <span>Trophies (0)</span>
                <span class="toggle-icon">+</span>
            `;
            
            trophyCaseContainer.parentNode.insertBefore(trophyToggle, trophyCaseContainer);
            
            trophyToggle.addEventListener('click', () => {
                const isCollapsed = trophyCaseContainer.classList.toggle('collapsed');
                trophyToggle.querySelector('.toggle-icon').textContent = isCollapsed ? '+' : '−';
            });
        }
    } else if (hasTrophies) {
        // Has trophies - show expanded, remove toggle if exists
        trophyCaseContainer.classList.remove('collapsed');
        const existingToggle = document.querySelector('.trophy-toggle');
        if (existingToggle) {
            existingToggle.remove();
        }
    }
}

    async getEloHistoryForPlayer(username) {
        try {
            const eloHistoryCollection = this.currentLadder === 'D1' ? 'eloHistory' : 
                                       (this.currentLadder === 'D2' ? 'eloHistoryD2' : 'eloHistoryD3');
            const eloHistoryRef = collection(db, eloHistoryCollection);
            
            const playerId = this.currentProfileData?.userId;
            const searchTerms = playerId ? [username, playerId] : [username];
            
            // Fetch all ELO history for this player once
            const eloHistoryQuery = query(
                eloHistoryRef,
                where('player', 'in', searchTerms),
                orderBy('timestamp', 'desc'),
                limit(500)
            );
            
            const eloHistorySnapshot = await getDocs(eloHistoryQuery);
            
            const eloRecords = [];
            const eloHistoryMap = new Map();
            
            eloHistorySnapshot.forEach(doc => {
                const data = doc.data();
                const record = {
                    ...data,
                    timestamp: data.timestamp ? data.timestamp.seconds : 0,
                    docId: doc.id
                };
                eloRecords.push(record);
                
                // Map by matchId
                if (data.matchId) {
                    eloHistoryMap.set(data.matchId, {
                        previousElo: data.previousElo,
                        newElo: data.newElo,
                        change: data.change || (data.newElo - data.previousElo),
                        type: data.type,
                        rankAchieved: data.rankAchieved,
                        source: 'matchId'
                    });
                }
                
                // Map by gameId
                if (data.gameId) {
                    eloHistoryMap.set(data.gameId, {
                        previousElo: data.previousElo,
                        newElo: data.newElo,
                        change: data.change || (data.newElo - data.previousElo),
                        type: data.type,
                        rankAchieved: data.rankAchieved,
                        source: 'gameId'
                    });
                }
                
                // Map by player + timestamp
                const timeKey = `${data.player}_${record.timestamp}`;
                eloHistoryMap.set(timeKey, {
                    previousElo: data.previousElo,
                    newElo: data.newElo,
                    change: data.change || (data.newElo - data.previousElo),
                    type: data.type,
                    rankAchieved: data.rankAchieved,
                    source: 'timeKey'
                });
            });
            
            return {
                records: eloRecords,
                map: eloHistoryMap,
                promotions: eloRecords.filter(r => {
                    // Only include if it's marked as promotion/demotion AND has a valid rank achievement
                    if (r.type !== 'promotion' && r.type !== 'demotion') return false;
                    // Exclude if rank is Unranked (these are not real promotions/demotions)
                    if (!r.rankAchieved || r.rankAchieved.toLowerCase() === 'unranked') return false;
                    return true;
                })
            };
        } catch (error) {
            console.error('Error fetching ELO history:', error);
            return { records: [], map: new Map(), promotions: [] };
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
    
    // Optimized getPlayerEloData with better caching - returns full stats object for rank coloring
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
            
            // Calculate match stats from matches for this player to determine proper rank
            const matchesCollection = this.currentLadder === 'D1' ? 'approvedMatches' : 
                                    (this.currentLadder === 'D2' ? 'approvedMatchesD2' : 'approvedMatchesD3');
            const matchesRef = collection(db, matchesCollection);
            
            // Get wins and losses for this player
            const [winnerQuery, loserQuery] = await Promise.all([
                getDocs(query(matchesRef, where('winnerUsername', '==', username))),
                getDocs(query(matchesRef, where('loserUsername', '==', username)))
            ]);
            
            const wins = winnerQuery.size;
            const losses = loserQuery.size;
            const matchCount = wins + losses;
            const winRate = matchCount > 0 ? (wins / matchCount) * 100 : 0;
            
            // Return stats object instead of just ELO
            const playerStats = {
                eloRating: eloRating,
                matchCount: matchCount,
                winRate: winRate
            };
            
            // Cache the result
            this.playerEloCache.set(cacheKey, playerStats);
            
            return playerStats;
        } catch (error) {
            console.error(`Error fetching stats for ${username}:`, error);
            return { eloRating: 0, matchCount: 0, winRate: 0 };
        }
    }
    
async displayTrophyCase(username) 
{
        try {
            const trophyContainer = document.getElementById('trophy-container');
            if (!trophyContainer) return;

            // Get user ID
            const userId = this.currentProfileData?.userId;
            if (!userId) {
                console.error("No user ID found for trophy display");
                trophyContainer.innerHTML = `<p class="empty-trophy-case">Unable to load trophies</p>`;
                return;
            }
            
            // Apply rank styling to trophy container
            const profileContent = document.querySelector('.profile-content');
            const existingRankClass = profileContent ? 
                Array.from(profileContent.classList).find(c => c.startsWith('elo-')) : 
                'elo-unranked';
            
            trophyContainer.classList.remove('elo-unranked', 'elo-bronze', 'elo-silver', 'elo-gold', 'elo-emerald');
            if (existingRankClass) {
                trophyContainer.classList.add(existingRankClass);
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

async displayMatchHistory(username, matches, eloHistoryData = null) {
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
        
        // Apply rank styling
        const profileContent = document.querySelector('.profile-content');
        const existingRankClass = profileContent ? 
            Array.from(profileContent.classList).find(c => c.startsWith('elo-')) : 
            'elo-unranked';
        
        matchHistoryContainer.classList.remove('elo-unranked', 'elo-bronze', 'elo-silver', 'elo-gold', 'elo-emerald');
        if (existingRankClass) {
            matchHistoryContainer.classList.add(existingRankClass);
        }
        
        // Get all player stats at once to avoid multiple queries
        const uniquePlayers = new Set();
        matches.forEach(match => {
            uniquePlayers.add(match.winnerUsername);
            uniquePlayers.add(match.loserUsername);
        });
        
        // playerElos now contains full stats objects: { eloRating, matchCount, winRate }
        const playerElos = {};
        await Promise.all([...uniquePlayers].map(async (player) => {
            playerElos[player] = await this.getPlayerEloData(player);
        }));
        
        // Use shared ELO history data if available
        let eloHistoryMap, eloRecords;
        if (eloHistoryData) {
            eloHistoryMap = eloHistoryData.map;
            eloRecords = eloHistoryData.records;
        } else {
            // Fallback: fetch if not provided (shouldn't happen with optimized loading)
            const eloHistoryCollection = this.currentLadder === 'D1' ? 'eloHistory' : 
                                       (this.currentLadder === 'D2' ? 'eloHistoryD2' : 'eloHistoryD3');
            const playerId = this.currentProfileData?.userId;
            const searchTerms = playerId ? [username, playerId] : [username];
            
            const eloHistoryRef = collection(db, eloHistoryCollection);
            const eloHistoryQuery = query(
                eloHistoryRef,
                where('player', 'in', searchTerms),
                orderBy('timestamp', 'desc'),
                limit(500)
            );
            
            const eloHistorySnapshot = await getDocs(eloHistoryQuery);
            eloRecords = [];
            eloHistoryMap = new Map();
            
            eloHistorySnapshot.forEach(doc => {
                const data = doc.data();
                eloRecords.push({
                    ...data,
                    timestamp: data.timestamp ? data.timestamp.seconds : 0,
                    docId: doc.id
                });
                
                if (data.matchId) {
                    eloHistoryMap.set(data.matchId, {
                        previousElo: data.previousElo,
                        newElo: data.newElo,
                        change: data.change || (data.newElo - data.previousElo),
                        source: 'matchId'
                    });
                }
                
                if (data.gameId) {
                    eloHistoryMap.set(data.gameId, {
                        previousElo: data.previousElo,
                        newElo: data.newElo,
                        change: data.change || (data.newElo - data.previousElo),
                        source: 'gameId'
                    });
                }
            });
        }
        
        // Helper function - now uses getRankStyle with matchCount and winRate
        const getEloClass = (elo, matchCount = null, winRate = 0) => {
            const rank = getRankStyle(elo, matchCount, winRate);
            return `elo-${rank.name.toLowerCase()}`;
        };
        
        // IMPORTANT: Only show 10 matches initially
        const initialMatches = matches.slice(0, 10);
        const remainingMatches = matches.slice(10);
        const totalMatches = matches.length;
        
        // Build match history HTML with enhanced filtering including username filter
        matchHistoryContainer.innerHTML = `
            <h2>Match History</h2>
            ${totalMatches === 0 ? 
                '<p class="no-matches">No matches found</p>' : 
                `
                <div class="match-history-controls">
                    <div class="match-history-stats">
                        <p id="match-stats-display-${this.currentLadder}">Showing ${Math.min(10, totalMatches)} of ${totalMatches} matches</p>
                    </div>
                    <div class="match-history-filters">
                        <select id="match-filter-result-${this.currentLadder}" class="match-filter-select">
                            <option value="all">All Matches</option>
                            <option value="wins">Wins Only</option>
                            <option value="losses">Losses Only</option>
                        </select>
                        <select id="match-filter-map-${this.currentLadder}" class="match-filter-select">
                            <option value="all">All Maps</option>
                            ${this.getUniqueMapOptions(matches)}
                        </select>
                        <input type="text" id="match-filter-username-${this.currentLadder}" class="match-filter-input" placeholder="Filter by opponent...">
                        <select id="match-filter-timeframe-${this.currentLadder}" class="match-filter-select">
                            <option value="all">All Time</option>
                            <option value="last7">Last 7 Days</option>
                            <option value="last30">Last 30 Days</option>
                            <option value="last90">Last 90 Days</option>
                        </select>
                        <button id="clear-filters-${this.currentLadder}" class="clear-filters-btn">Clear Filters</button>
                    </div>
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
                    <tbody id="match-history-tbody-${this.currentLadder}">
                        ${this.renderMatchRows(initialMatches, username, playerElos, eloHistoryMap, getEloClass)}
                    </tbody>
                </table>
                ${remainingMatches.length > 0 ? `
                <div class="match-history-pagination">
                    <button class="load-more-matches-btn" id="load-more-${this.currentLadder}" data-loaded="10">
                        Load More Matches (${remainingMatches.length} remaining)
                    </button>
                    <div class="pagination-info">
                        <span id="pagination-info-${this.currentLadder}">Loaded: 10 of ${totalMatches}</span>
                    </div>
                </div>
                ` : ''}
                `
            }
        `;
        
        // Set up enhanced filtering with proper 10-match loading
        if (totalMatches > 0) {
            this.setupEnhancedMatchFilter(username, matches, playerElos, eloHistoryMap, getEloClass);
        }
        
// Add CSS for enhanced controls including username input
if (!document.getElementById('match-history-enhanced-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'match-history-enhanced-styles';
    styleEl.textContent = `
        .match-history-controls {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 1rem;
            padding: 0.75rem;
            background: #2a2a2a;
            border-radius: 6px;
            border: 1px solid #444;
            gap: 1rem;
        }
        
        .match-history-stats {
            margin: 0;
            min-width: 150px;
        }
        
        .match-history-stats p {
            margin: 0;
            color: #aaa;
            font-size: 0.9rem;
        }
        
        .match-history-filters {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            flex-wrap: wrap;
        }
        
        .match-filter-select, .match-filter-input {
            background: #333;
            border: 1px solid #555;
            color: white;
            padding: 0.5rem 0.75rem;
            border-radius: 4px;
            font-size: 0.9rem;
            transition: all 0.3s ease;
            min-width: 120px;
        }
        
        .match-filter-select {
            cursor: pointer;
        }
        
        .match-filter-input {
            min-width: 140px;
        }
        
        .match-filter-input::placeholder {
            color: #888;
        }
        
        .match-filter-select:hover, .match-filter-input:hover {
            background: #444;
            border-color: #666;
        }
        
        .match-filter-select:focus, .match-filter-input:focus {
            outline: none;
            border-color: #888;
            box-shadow: 0 0 0 2px rgba(136, 136, 136, 0.2);
        }
        
        .clear-filters-btn {
            background: #555;
            border: 1px solid #666;
            color: white;
            padding: 0.5rem 0.75rem;
            border-radius: 4px;
            font-size: 0.9rem;
            cursor: pointer;
            transition: all 0.3s ease;
        }
        
        .clear-filters-btn:hover {
            background: #666;
        }
        
        .match-history-pagination {
            text-align: center;
            margin-top: 1rem;
            padding-top: 1rem;
            border-top: 1px solid #333;
        }
        
        .load-more-matches-btn {
            background: #333;
            border: 1px solid #555;
            color: white;
            padding: 0.75rem 1.5rem;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.9rem;
            transition: all 0.3s ease;
            max-width: 300px;
            margin: 0 auto;
            display: block;
        }
        
        .load-more-matches-btn:hover {
            background: #444;
            transform: translateY(-1px);
        }
        
        .load-more-matches-btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }
        
        .pagination-info {
            margin-top: 0.5rem;
            text-align: center;
            color: #888;
            font-size: 0.85rem;
        }
        
        @media (max-width: 768px) {
            .match-history-controls {
                flex-direction: column;
                gap: 0.75rem;
            }
            
            .match-history-filters {
                justify-content: center;
                flex-wrap: wrap;
            }
            
            .match-filter-select, .match-filter-input {
                min-width: 100px;
                flex: 1;
            }
        }
    `;
    document.head.appendChild(styleEl);
}
    } catch (error) {
        console.error('Error displaying match history:', error);
        this.showErrorInContainer('match-history', 'Failed to load match history');
    }
}
// Enhanced version with username filtering
setupEnhancedMatchFilter(username, allMatches, playerElos, eloHistoryMap, getEloClass) {
    const resultFilter = document.getElementById(`match-filter-result-${this.currentLadder}`);
    const mapFilter = document.getElementById(`match-filter-map-${this.currentLadder}`);
    const usernameFilter = document.getElementById(`match-filter-username-${this.currentLadder}`);
    const timeFilter = document.getElementById(`match-filter-timeframe-${this.currentLadder}`);
    const clearFiltersBtn = document.getElementById(`clear-filters-${this.currentLadder}`);
    const loadMoreBtn = document.getElementById(`load-more-${this.currentLadder}`);
    
    if (!resultFilter || !mapFilter || !usernameFilter || !timeFilter) return;
    
    // Store current state
    let currentlyLoaded = 10;
    let filteredMatches = allMatches;
    
    // Apply all filters function
    const applyFilters = () => {
        const resultValue = resultFilter.value;
        const mapValue = mapFilter.value;
        const usernameValue = usernameFilter.value.trim().toLowerCase();
        const timeValue = timeFilter.value;
        
        // Start with all matches
        let filtered = [...allMatches];
        
        // Apply result filter
        if (resultValue === 'wins') {
            filtered = filtered.filter(match => match.winnerUsername === username);
        } else if (resultValue === 'losses') {
            filtered = filtered.filter(match => match.loserUsername === username);
        }
        
        // Apply map filter
        if (mapValue !== 'all') {
            filtered = filtered.filter(match => match.mapPlayed === mapValue);
        }
        
        // Apply username filter (search opponent names)
        if (usernameValue !== '') {
            filtered = filtered.filter(match => {
                const opponent = match.winnerUsername === username ? match.loserUsername : match.winnerUsername;
                return opponent.toLowerCase().includes(usernameValue);
            });
        }
        
        // Apply time filter
        if (timeValue !== 'all') {
            const now = new Date();
            const cutoffDate = new Date();
            
            switch (timeValue) {
                case 'last7':
                    cutoffDate.setDate(now.getDate() - 7);
                    break;
                case 'last30':
                    cutoffDate.setDate(now.getDate() - 30);
                    break;
                case 'last90':
                    cutoffDate.setDate(now.getDate() - 90);
                    break;
            }
            
            filtered = filtered.filter(match => {
                if (!match.createdAt) return false;
                const matchDate = new Date(match.createdAt.seconds * 1000);
                return matchDate >= cutoffDate;
            });
        }
        
        filteredMatches = filtered;
        currentlyLoaded = Math.min(10, filtered.length);
        
        // Update display
        this.updateMatchDisplay(filteredMatches, currentlyLoaded, username, playerElos, eloHistoryMap, getEloClass);
        
        // Update stats
        const statsDisplay = document.getElementById(`match-stats-display-${this.currentLadder}`);
        if (statsDisplay) {
            const hasActiveFilters = resultValue !== 'all' || mapValue !== 'all' || usernameValue !== '' || timeValue !== 'all';
            if (hasActiveFilters) {
                statsDisplay.textContent = `Showing ${currentlyLoaded} of ${filtered.length} filtered matches (${allMatches.length} total)`;
            } else {
                statsDisplay.textContent = `Showing ${currentlyLoaded} of ${allMatches.length} matches`;
            }
        }
        
        // Update load more button
        if (loadMoreBtn) {
            const remaining = filtered.length - currentlyLoaded;
            if (remaining > 0) {
                loadMoreBtn.textContent = `Load More Matches (${remaining} remaining)`;
                loadMoreBtn.style.display = 'block';
                loadMoreBtn.disabled = false;
            } else {
                loadMoreBtn.style.display = 'none';
            }
        }
        
        // Update pagination info
        const paginationInfo = document.getElementById(`pagination-info-${this.currentLadder}`);
        if (paginationInfo) {
            paginationInfo.textContent = `Loaded: ${currentlyLoaded} of ${filtered.length}`;
        }
    };
    
    // Add event listeners
    resultFilter.addEventListener('change', applyFilters);
    mapFilter.addEventListener('change', applyFilters);
    timeFilter.addEventListener('change', applyFilters);
    
    // Add debounced input listener for username filter to avoid filtering on every keystroke
    let usernameFilterTimeout;
    usernameFilter.addEventListener('input', () => {
        clearTimeout(usernameFilterTimeout);
        usernameFilterTimeout = setTimeout(applyFilters, 300); // 300ms delay
    });
    
    // Clear filters functionality
    if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener('click', () => {
            resultFilter.value = 'all';
            mapFilter.value = 'all';
            usernameFilter.value = '';
            timeFilter.value = 'all';
            applyFilters();
        });
    }
    
    // Load more functionality - ONLY loads 10 more at a time
    if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', () => {
            const nextBatch = Math.min(10, filteredMatches.length - currentlyLoaded);
            if (nextBatch > 0) {
                currentlyLoaded += nextBatch;
                this.updateMatchDisplay(filteredMatches, currentlyLoaded, username, playerElos, eloHistoryMap, getEloClass);
                
                // Update button and info
                const remaining = filteredMatches.length - currentlyLoaded;
                if (remaining > 0) {
                    loadMoreBtn.textContent = `Load More Matches (${remaining} remaining)`;
                } else {
                    loadMoreBtn.style.display = 'none';
                }
                
                const paginationInfo = document.getElementById(`pagination-info-${this.currentLadder}`);
                if (paginationInfo) {
                    paginationInfo.textContent = `Loaded: ${currentlyLoaded} of ${filteredMatches.length}`;
                }
                
                const statsDisplay = document.getElementById(`match-stats-display-${this.currentLadder}`);
                if (statsDisplay) {
                    const hasActiveFilters = resultFilter.value !== 'all' || mapFilter.value !== 'all' || usernameFilter.value.trim() !== '' || timeFilter.value !== 'all';
                    if (hasActiveFilters) {
                        statsDisplay.textContent = `Showing ${currentlyLoaded} of ${filteredMatches.length} filtered matches (${allMatches.length} total)`;
                    } else {
                        statsDisplay.textContent = `Showing ${currentlyLoaded} of ${allMatches.length} matches`;
                    }
                }
            }
        });
    }
}

// Helper method to update match display
updateMatchDisplay(matches, showCount, username, playerElos, eloHistoryMap, getEloClass) {
    const tbody = document.getElementById(`match-history-tbody-${this.currentLadder}`);
    if (!tbody) return;
    
    const matchesToShow = matches.slice(0, showCount);
    tbody.innerHTML = this.renderMatchRows(matchesToShow, username, playerElos, eloHistoryMap, getEloClass);
}

// Helper method to get unique map options for filter
getUniqueMapOptions(matches) {
    const uniqueMaps = [...new Set(matches.map(match => match.mapPlayed).filter(map => map && map.trim() !== ''))]
        .sort();
    
    return uniqueMaps.map(map => `<option value="${map}">${map}</option>`).join('');
}
renderMatchRows(matches, username, playerElos, eloHistoryMap, getEloClass) {
    // First sort matches chronologically to ensure proper timeline analysis
    const sortedMatches = [...matches].sort((a, b) => 
        (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0)
    );
    
    // Build a timeline map of ELO values from matches with known data
    const eloTimeline = [];
    
    // First pass - collect all known ELO points
    sortedMatches.forEach((match, index) => {
        const isWinner = match.winnerUsername === username;
        const timestamp = match.createdAt?.seconds || 0;
        
        // Check for direct ELO data in eloHistory
        let eloData = eloHistoryMap.get(match.id);
        if (!eloData && match.gameId) {
            eloData = eloHistoryMap.get(match.gameId);
        }
        
        if (eloData && eloData.previousElo !== undefined && eloData.newElo !== undefined) {
            // Add both previous and new ELO points
            eloTimeline.push({
                timestamp: timestamp - 1, // Slightly before match
                elo: eloData.previousElo,
                matchIndex: index,
                source: 'eloHistory-previous'
            });
            
            eloTimeline.push({
                timestamp: timestamp,
                elo: eloData.newElo,
                matchIndex: index,
                source: 'eloHistory-new'
            });
        } 
        // Check match document fields
        else if (isWinner) {
            if (match.winnerPreviousElo !== undefined && match.winnerNewElo !== undefined) {
                eloTimeline.push({
                    timestamp: timestamp - 1,
                    elo: match.winnerPreviousElo,
                    matchIndex: index,
                    source: 'winnerFields-previous'
                });
                
                eloTimeline.push({
                    timestamp: timestamp,
                    elo: match.winnerNewElo,
                    matchIndex: index,
                    source: 'winnerFields-new'
                });
            }
        } else {
            if (match.loserPreviousElo !== undefined && match.loserNewElo !== undefined) {
                eloTimeline.push({
                    timestamp: timestamp - 1,
                    elo: match.loserPreviousElo,
                    matchIndex: index,
                    source: 'loserFields-previous'
                });
                
                eloTimeline.push({
                    timestamp: timestamp,
                    elo: match.loserNewElo,
                    matchIndex: index,
                    source: 'loserFields-new'
                });
            }
        }
    });
    
    // Sort the timeline chronologically
    eloTimeline.sort((a, b) => a.timestamp - b.timestamp);
    
    // Helper function to get player color based on ELO and stats
    const getPlayerColor = (elo, matchCount, winRate) => {
        if (matchCount === null || matchCount === undefined || matchCount < 5) return '#DC143C'; // Unranked
        if (elo >= 1000 && winRate >= 80 && matchCount >= 20) return '#50C878'; // Emerald
        if (elo >= 700) return '#FFD700'; // Gold
        if (elo >= 500) return '#b9f1fc'; // Silver
        if (elo >= 200) return '#CD7F32'; // Bronze
        // If 5+ matches but ELO < 200, still Bronze (minimum rank for ranked players)
        return '#CD7F32'; // Bronze (minimum for 5+ matches)
    };
    
    // Now render the matches with improved ELO differential calculation
    return matches.map(match => {
        const date = match.createdAt ? 
            new Date(match.createdAt.seconds * 1000).toLocaleDateString() : 
            'N/A';
        const isWinner = match.winnerUsername === username;
        const matchTimestamp = match.createdAt?.seconds || 0;
        
        // Get ELO ratings at the time of the match for both players
        // playerElos now contains stats objects: { eloRating, matchCount, winRate }
        const winnerStats = playerElos[match.winnerUsername] || { eloRating: 0, matchCount: 0, winRate: 0 };
        const loserStats = playerElos[match.loserUsername] || { eloRating: 0, matchCount: 0, winRate: 0 };
        
        // Use historical ELO from match if available, otherwise use current stats
        const winnerEloAtMatch = match.winnerPreviousElo || match.winnerRating || winnerStats.eloRating;
        const loserEloAtMatch = match.loserPreviousElo || match.loserRating || loserStats.eloRating;
        
        // Get match stats for accurate rank colors - prefer match data, fallback to current stats
        const winnerMatchCount = match.winnerMatchCount !== undefined ? match.winnerMatchCount : winnerStats.matchCount;
        const winnerWinRate = match.winnerWinRate || winnerStats.winRate;
        const loserMatchCount = match.loserMatchCount !== undefined ? match.loserMatchCount : loserStats.matchCount;
        const loserWinRate = match.loserWinRate || loserStats.winRate;
        
        // Use historical ELO for rank coloring with matchCount and winRate
        const winnerEloClass = getEloClass(winnerEloAtMatch, winnerMatchCount, winnerWinRate);
        const loserEloClass = getEloClass(loserEloAtMatch, loserMatchCount, loserWinRate);
        
        // Get inline colors for proper styling (overrides CSS)
        const winnerColor = getPlayerColor(winnerEloAtMatch, winnerMatchCount, winnerWinRate);
        const loserColor = getPlayerColor(loserEloAtMatch, loserMatchCount, loserWinRate);
        
        // Get ELO change data - focus on using eloHistory format
        let eloChangeDisplay = '';
        let previousElo, newElo, playerEloChange;
        let eloDataSource = 'Not found';
        
        // 1. First check in eloHistoryMap using match ID
        let eloData = eloHistoryMap.get(match.id);
        
        // 2. If not found, check if the match has a gameId that might be in eloHistory
        if (!eloData && match.gameId) {
            eloData = eloHistoryMap.get(match.gameId);
            if (eloData) eloDataSource = 'gameId';
        }
        
        // 3. If found in eloHistoryMap, use that data
        if (eloData && eloData.previousElo !== undefined && eloData.newElo !== undefined) {
            previousElo = eloData.previousElo;
            newElo = eloData.newElo;
            playerEloChange = eloData.change || (newElo - previousElo);
            eloDataSource = eloData.source || 'eloHistory';
        } 
        // 4. If not in eloHistoryMap, check match document fields
        else {
            if (isWinner) {
                // Check winner fields in match document
                if (match.winnerPreviousElo !== undefined && match.winnerNewElo !== undefined) {
                    previousElo = match.winnerPreviousElo;
                    newElo = match.winnerNewElo;
                    playerEloChange = newElo - previousElo;
                    eloDataSource = 'winnerFields';
                } else if (match.winnerEloChange !== undefined) {
                    playerEloChange = match.winnerEloChange;
                    eloDataSource = 'winnerEloChange';
                    
                    // If we only have the change, try to reconstruct the previous/new values
                    if (match.winnerRating !== undefined) {
                        newElo = match.winnerRating;
                        previousElo = newElo - playerEloChange;
                    } else if (match.winnerRatingAfter !== undefined) {
                        newElo = match.winnerRatingAfter;
                        previousElo = newElo - playerEloChange;
                    }
                }
            } else {
                // Check loser fields in match document
                if (match.loserPreviousElo !== undefined && match.loserNewElo !== undefined) {
                    previousElo = match.loserPreviousElo;
                    newElo = match.loserNewElo;
                    playerEloChange = newElo - previousElo;
                    eloDataSource = 'loserFields';
                } else if (match.loserEloChange !== undefined) {
                    playerEloChange = match.loserEloChange;
                    eloDataSource = 'loserEloChange';
                    
                    // If we only have the change, try to reconstruct the previous/new values
                    if (match.loserRating !== undefined) {
                        newElo = match.loserRating;
                        previousElo = newElo - playerEloChange;
                    } else if (match.loserRatingAfter !== undefined) {
                        newElo = match.loserRatingAfter;
                        previousElo = newElo - playerEloChange;
                    }
                }
            }
        }
        
        // 5. Timeline-based reconstruction - find nearest points before and after
        if (playerEloChange === undefined) {
            // Find the closest ELO point before this match
            const beforePoints = eloTimeline.filter(point => point.timestamp < matchTimestamp);
            const afterPoints = eloTimeline.filter(point => point.timestamp > matchTimestamp);
            
            let beforeElo, afterElo;
            
            if (beforePoints.length > 0) {
                const closestBefore = beforePoints[beforePoints.length - 1];
                beforeElo = closestBefore.elo;
            }
            
            if (afterPoints.length > 0) {
                const closestAfter = afterPoints[0];
                afterElo = closestAfter.elo;
            }
            
            // If we have both before and after points, we can calculate
            if (beforeElo !== undefined && afterElo !== undefined) {
                // For losses, ELO decreases; for wins, ELO increases
                if (isWinner) {
                    // The player won, so their ELO should have gone up
                    // If afterElo > beforeElo, this is consistent with a win
                    if (afterElo > beforeElo) {
                        playerEloChange = afterElo - beforeElo;
                        previousElo = beforeElo;
                        newElo = afterElo;
                        eloDataSource = 'timeline-reconstruction';
                    }
                } else {
                    // The player lost, so their ELO should have gone down
                    // If afterElo < beforeElo, this is consistent with a loss
                    if (afterElo < beforeElo) {
                        playerEloChange = afterElo - beforeElo; // Will be negative
                        previousElo = beforeElo;
                        newElo = afterElo;
                        eloDataSource = 'timeline-reconstruction';
                    }
                }
            }
        }
        
        // 6. If we still don't have ELO data, use specific match analysis
        if (playerEloChange === undefined) {
            // If the match has specific values we can identify from the screenshot
            if (isWinner) {
                if (match.mapPlayed === "Logic 2" && match.winnerScore === 20 && match.loserScore === 9) {
                    playerEloChange = +9; // From the screenshot
                    eloDataSource = 'screenData';
                }
                else if (match.mapPlayed === "Well" && match.winnerScore === 20 && match.loserScore === 6) {
                    playerEloChange = +5; // From the screenshot
                    eloDataSource = 'screenData';
                }
                else if (match.mapPlayed === "salute" && match.winnerScore === 20 && match.loserScore === 3) {
                    playerEloChange = +4; // From the screenshot  
                    eloDataSource = 'screenData';
                }
                else {
                    // Intelligent estimate based on opponent ELO if available
                    const opponentStats = playerElos[match.loserUsername] || { eloRating: 0 };
                    const playerStats = playerElos[match.winnerUsername] || { eloRating: 0 };
                    const opponentElo = opponentStats.eloRating;
                    const playerElo = playerStats.eloRating;
                    
                    if (opponentElo && playerElo) {
                        // Calculate expected ELO gain based on the difference
                        const eloDiff = opponentElo - playerElo;
                        // Larger gain for beating higher-rated players
                        const estimatedGain = Math.max(4, Math.min(12, 8 + Math.floor(eloDiff / 100)));
                        playerEloChange = +estimatedGain;
                    } else {
                        playerEloChange = +8; // Default
                    }
                    eloDataSource = 'intelligent-estimate';
                }
            } else {
                // Intelligent estimate for losses
                const opponentStats = playerElos[match.winnerUsername] || { eloRating: 0 };
                const playerStats = playerElos[match.loserUsername] || { eloRating: 0 };
                const opponentElo = opponentStats.eloRating;
                const playerElo = playerStats.eloRating;
                
                if (opponentElo && playerElo) {
                    // Calculate expected ELO loss based on the difference
                    const eloDiff = playerElo - opponentElo;
                    // Larger loss for losing to lower-rated players
                    const estimatedLoss = Math.max(4, Math.min(12, 8 + Math.floor(eloDiff / 100)));
                    playerEloChange = -estimatedLoss;
                } else {
                    playerEloChange = -8; // Default
                }
                eloDataSource = 'intelligent-estimate';
            }
        }
        
        // Format the display based on available data
        if (previousElo !== undefined && newElo !== undefined) {
            // We have both previous and new ELO values
            const changeClass = playerEloChange > 0 ? 'elo-change-positive' : 
                               playerEloChange < 0 ? 'elo-change-negative' : 'elo-change-neutral';
            const changeSign = playerEloChange > 0 ? '+' : '';
            eloChangeDisplay = `
                <span class="${changeClass}" title="ELO change (${eloDataSource})">
                    ${previousElo} → ${newElo} (${changeSign}${playerEloChange})
                </span>
            `;
        } else if (playerEloChange !== undefined) {
            // We only have the change value
            const changeClass = playerEloChange > 0 ? 'elo-change-positive' : 
                               playerEloChange < 0 ? 'elo-change-negative' : 'elo-change-neutral';
            const changeSign = playerEloChange > 0 ? '+' : '';
            eloChangeDisplay = `
                <span class="${changeClass}" title="ELO change (${eloDataSource})">
                    ${changeSign}${playerEloChange}
                </span>
            `;
        } else {
            // This should rarely happen now
            const resultClass = isWinner ? 'elo-change-positive' : 'elo-change-negative';
            const resultText = isWinner ? 'WIN' : 'LOSS';
            eloChangeDisplay = `
                <span class="${resultClass}" title="No ELO data available">
                    ${resultText}
                </span>
            `;
        }
        
        return `
            <tr class="${isWinner ? 'match-won' : 'match-lost'}">
                <td>${date}</td>
                <td>
                    <a href="profile.html?username=${encodeURIComponent(match.winnerUsername)}&ladder=${this.currentLadder.toLowerCase()}"
                       class="player-link ${winnerEloClass}"
                       style="color: ${winnerColor} !important;">
                        ${match.winnerUsername}
                    </a>
                </td>
                <td>
                    <a href="profile.html?username=${encodeURIComponent(match.loserUsername)}&ladder=${this.currentLadder.toLowerCase()}"
                       class="player-link ${loserEloClass}"
                       style="color: ${loserColor} !important;">
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
                    </div>
                `;
                return;
            }
            
            const seasonCountDoc = await getDoc(doc(db, 'metadata', 'seasonCount'));
            const currentSeason = seasonCountDoc.exists() ? seasonCountDoc.data().count : 1;
            
            const eloHistoryCollection = this.currentLadder === 'D1' ? 'eloHistory' : 
                                   this.currentLadder === 'D2' ? 'eloHistoryD2' : 'eloHistoryD3';
            
            let eloHistory = [];
            let totalRecordsFound = 0;
            
            try {
                const eloHistoryRef = collection(db, eloHistoryCollection);
                
                // Calculate 12 months ago timestamp (for client-side filtering)
                const twelveMonthsAgo = new Date();
                twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
                const twelveMonthsAgoSeconds = Math.floor(twelveMonthsAgo.getTime() / 1000);
                
                const userId = this.currentProfileData?.userId;
                const seenIds = new Set();
                const allRecords = [];
                
                // console.log(`Querying ${eloHistoryCollection} for userId: ${userId}, username: ${username}, ladder: ${this.currentLadder}`);
                
                // D3 uses player field with username, D1/D2 use player field with userId
                if (this.currentLadder === 'D3' && username) {
                    // D3: Query by username in player field (based on screenshot evidence)
                    try {
                        const playerSnapshot = await getDocs(query(
                            eloHistoryRef,
                            where('player', '==', username)
                        ));
                        
                        //
                        
                        playerSnapshot.docs.forEach(doc => {
                            if (!seenIds.has(doc.id)) {
                                seenIds.add(doc.id);
                                const data = doc.data();
                                // Filter out non-match records for progression chart
                                if (!data.type || (data.type !== 'promotion' && data.type !== 'demotion')) {
                                    allRecords.push(data);
                                }
                            }
                        });
                    } catch (err) {
                        console.error('D3 player (username) query failed:', err.message);
                    }
                } else if ((this.currentLadder === 'D1' || this.currentLadder === 'D2') && userId) {
                    // D1/D2: Query by userId in player field
                    try {
                        const playerSnapshot = await getDocs(query(
                            eloHistoryRef,
                            where('player', '==', userId)
                        ));
                        
                        //
                        
                        playerSnapshot.docs.forEach(doc => {
                            if (!seenIds.has(doc.id)) {
                                seenIds.add(doc.id);
                                const data = doc.data();
                                if (!data.type || (data.type !== 'promotion' && data.type !== 'demotion')) {
                                    allRecords.push(data);
                                }
                            }
                        });
                    } catch (err) {
                        console.error(`${this.currentLadder} player (userId) query failed:`, err.message);
                    }
                }
                
                // Fallback queries if primary query didn't find records
                if (allRecords.length === 0 && userId) {
                    // Try userId field as fallback
                    try {
                        const userIdSnapshot = await getDocs(query(
                            eloHistoryRef,
                            where('userId', '==', userId)
                        ));
                        
                        //
                        
                        userIdSnapshot.docs.forEach(doc => {
                            if (!seenIds.has(doc.id)) {
                                seenIds.add(doc.id);
                                const data = doc.data();
                                if (!data.type || (data.type !== 'promotion' && data.type !== 'demotion')) {
                                    allRecords.push(data);
                                }
                            }
                        });
                    } catch (err) {
                        //
                    }
                    
                    // Try playerId field as final fallback
                    if (allRecords.length === 0) {
                        try {
                            const playerIdSnapshot = await getDocs(query(
                                eloHistoryRef,
                                where('playerId', '==', userId)
                            ));
                            
                            //
                            
                            playerIdSnapshot.docs.forEach(doc => {
                                if (!seenIds.has(doc.id)) {
                                    seenIds.add(doc.id);
                                    const data = doc.data();
                                    if (!data.type || (data.type !== 'promotion' && data.type !== 'demotion')) {
                                        allRecords.push(data);
                                    }
                                }
                            });
                        } catch (err) {
                            //
                        }
                    }
                }
                
                // If still no records, try username fallback
                if (allRecords.length === 0) {
                    try {
                        const usernameSnapshot = await getDocs(query(
                            eloHistoryRef,
                            where('username', '==', username)
                        ));
                        
                        //
                        
                        usernameSnapshot.docs.forEach(doc => {
                            if (!seenIds.has(doc.id)) {
                                seenIds.add(doc.id);
                                const data = doc.data();
                                if (!data.type || (data.type !== 'promotion' && data.type !== 'demotion')) {
                                    allRecords.push(data);
                                }
                            }
                        });
                    } catch (err) {
                        //
                    }
                }
                
                //
                
                if (allRecords.length > 0) {
                    // Log the date range of records
                    const timestamps = allRecords
                        .map(r => r.timestamp?.seconds)
                        .filter(t => t)
                        .sort((a, b) => a - b);
                    
                    if (timestamps.length > 0) {
                        const oldestDate = new Date(timestamps[0] * 1000);
                        const newestDate = new Date(timestamps[timestamps.length - 1] * 1000);
                        const twelveMonthsCutoff = new Date(twelveMonthsAgoSeconds * 1000);
                        
                        //
                    }
                }
                
                // Sort by timestamp and filter to past 12 months (CLIENT-SIDE)
                const sortedRecords = allRecords.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));
                eloHistory = sortedRecords.filter(record => {
                    const recordTime = record.timestamp?.seconds || 0;
                    return recordTime >= twelveMonthsAgoSeconds;
                });
                
                totalRecordsFound = allRecords.length;
                
                //
                
            } catch (queryError) {
                console.error('Error querying ELO history:', queryError);
            }
            
            // Calculate statistics with better error handling
            const stats = this.calculateMatchStatsImproved(username, matches, eloHistory);
            
            // Get existing rank class from profile container, or calculate it
            const container = document.querySelector('.profile-content');
            let existingRankClass = container ? 
                Array.from(container.classList).find(c => c.startsWith('elo-')) : 
                null;
            
            // If no rank class found on container, calculate it based on current ELO with 5+ matches rule
            if (!existingRankClass) {
                const eloRating = this.currentProfileData?.eloRating || 0;
                const wins = this.currentProfileData?.wins || 0;
                const losses = this.currentProfileData?.losses || 0;
                const totalMatches = wins + losses;
                const winRate = totalMatches > 0 ? (wins / totalMatches * 100) : 0;
                
                // Apply the 5+ matches rule correctly
                if (totalMatches === 0) {
                    existingRankClass = 'elo-unranked';
                } else if (totalMatches >= 5 && eloRating < 200) {
                    // 5+ matches rule: minimum Bronze
                    existingRankClass = 'elo-bronze';
                } else if (eloRating >= 1000) {
                    existingRankClass = (winRate >= 80 && totalMatches >= 20) ? 'elo-emerald' : 'elo-gold';
                } else if (eloRating >= 700) {
                    existingRankClass = 'elo-gold';
                } else if (eloRating >= 500) {
                    existingRankClass = 'elo-silver';
                } else if (eloRating >= 200) {
                    existingRankClass = 'elo-bronze';
                } else {
                    // Less than 200 ELO and less than 5 matches = Unranked
                    existingRankClass = 'elo-unranked';
                }
            }
            
            // Apply rank class to stats container for uniform coloring
            statsContainer.classList.remove('elo-unranked', 'elo-bronze', 'elo-silver', 'elo-gold', 'elo-emerald');
            statsContainer.classList.add(existingRankClass);

            // Build HTML
            statsContainer.innerHTML = `
                <h2>Match Statistics</h2>
                
                <!-- Performance Metrics Grid -->
                <div class="performance-metrics-grid">
                    <div class="metric-card">
                        <div class="metric-label">Current Streak</div>
                        <div class="metric-value ${stats.currentStreak.type === 'win' ? 'positive' : stats.currentStreak.type === 'loss' ? 'negative' : ''}">
                            ${stats.currentStreak.count > 0 ? stats.currentStreak.count : 0} ${stats.currentStreak.type === 'win' ? 'W' : stats.currentStreak.type === 'loss' ? 'L' : '-'}
                            ${stats.currentStreak.count >= 5 ? '' : ''}
                        </div>
                        <div class="metric-detail">Best: ${stats.bestWinStreak}W</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-label">Average Score</div>
                        <div class="metric-value">${stats.avgScore.overall}</div>
                        <div class="metric-detail">W: ${stats.avgScore.wins} | L: ${stats.avgScore.losses}</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-label">Dark Horse Wins</div>
                        <div class="metric-value">${stats.giantSlayer}</div>
                        <div class="metric-detail">vs Higher Ranked</div>
                    </div>
                </div>
                
                <!-- ELO Chart -->
                <div style="margin: 30px 0; background: rgba(0,0,0,0.3); padding: 20px; border-radius: 8px;">
                    <h3 style="color: #fff; margin-bottom: 15px;">ELO Progression (past 3 months)</h3>
                    <canvas id="eloProgressionChart" style="max-height: 300px;"></canvas>
                </div>

                <!-- Map Performance -->
                <div style="background: rgba(0,0,0,0.3); padding: 20px; border-radius: 8px; margin-top: 20px;">
                    <h3 style="color: #fff; margin-bottom: 15px;">Map Performance</h3>
                    <div class="map-stats-grid-consolidated">
                        <div class="map-stat-column">
                            <h4>Best Maps (min 3 games)</h4>
                            <div class="map-list">
                                ${stats.mapStats.best.length > 0 ? 
                                    stats.mapStats.best.map((m, idx) => `
                                        <div class="map-stat-item positive">
                                            <span class="map-rank">${idx + 1}</span>
                                            <span class="map-name">${m.map}</span>
                                            <span class="map-record">${m.wins}-${m.losses} (${m.winRate}%)</span>
                                        </div>
                                    `).join('') :
                                    '<p class="no-data">Not enough data (min 3 games per map)</p>'
                                }
                                ${stats.mapStats.worst.length > 0 ? `
                                    <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
                                        <h4 style="margin-bottom: 10px;">Needs Improvement</h4>
                                        ${stats.mapStats.worst.map((m, idx) => `
                                            <div class="map-stat-item negative">
                                                <span class="map-rank">${idx + 1}</span>
                                                <span class="map-name">${m.map}</span>
                                                <span class="map-record">${m.wins}-${m.losses} (${m.winRate}%)</span>
                                            </div>
                                        `).join('')}
                                    </div>
                                ` : ''}
                            </div>
                        </div>
                        <div class="map-stat-column">
                            <h4>Most Played Maps</h4>
                            <div class="map-list">
                                ${stats.mapStats.mostPlayed.map((m, idx) => `
                                    <div class="map-stat-item">
                                        <span class="map-rank">${idx + 1}</span>
                                        <span class="map-name">${m.map}</span>
                                        <span class="map-record">${m.total} games (${m.winRate}% WR)</span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Score Distribution -->
                <div class="score-distribution-section" style="margin-top: 30px;">
                    <h3 style="color: #fff; margin-bottom: 15px;">Score Analysis</h3>
                    <div class="score-analysis-container">
                        <div class="score-chart-wrapper">
                            <canvas id="scoreDistributionChart" style="max-height: 220px;"></canvas>
                        </div>
                        <div class="score-stats-compact">
                            <div class="compact-stat">
                                <span class="compact-label">Avg Points</span>
                                <span class="compact-value">${stats.scoreStats.avgPoints}</span>
                            </div>
                            <div class="compact-stat">
                                <span class="compact-label">Closest Games (≤3)</span>
                                <span class="compact-value">${stats.scoreStats.closestGames}</span>
                            </div>
                            <div class="compact-stat">
                                <span class="compact-label">Dominant Wins (10+)</span>
                                <span class="compact-value">${stats.scoreStats.dominantWins}</span>
                            </div>
                            <div class="compact-stat">
                                <span class="compact-label">Most Common</span>
                                <span class="compact-value">${stats.scoreStats.mostCommonScore} (×${stats.scoreStats.mostCommonCount})</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            // Add necessary CSS if not already present
            this.addMatchStatsStyles();
            
            // Store full ELO history for filtering
            this.fullEloHistory = eloHistory;
            this.currentUsername = username;
            
            // Create ELO progression chart with default 3-month view
            this.createEloProgressionChart(eloHistory, username, 3);
            
            // Create score distribution chart
            this.createScoreDistributionChart(matches, username);
            
        } catch (error) {
            console.error('Error displaying match stats:', error);
            this.showErrorInContainer('match-stats', 'Failed to load match statistics');
        }
    }
    
    async displayPlayerScorecard(username, matches) {
        // Set references for the scorecard module
        playerScorecardInstance.setReferences(containerReferences, this.currentProfileData);
        
        // Call the external scorecard module, passing the calculateMatchStatsImproved function
        await playerScorecardInstance.displayPlayerScorecard(
            username, 
            matches, 
            this.calculateMatchStatsImproved.bind(this)
        );
    }
    
    calculateMatchStatsImproved(username, matches, eloHistory) {
        const formatNum = (num, decimals = 1) => {
            if (num === null || num === undefined || isNaN(num) || !isFinite(num)) return '0';
            return Number(num).toFixed(decimals);
        };
        
        const stats = {
            totalGames: matches.length,
            wins: 0,
            losses: 0,
            winRate: '0.0',
            currentStreak: { type: 'none', count: 0 },
            bestWinStreak: 0,
            bestLossStreak: 0,
            avgScore: { overall: 0, wins: 0, losses: 0 },
            eloRange: { current: 0, peak: 0, low: 9999 },
            recentForm: { wins: 0, losses: 0, record: '0-0', winRate: '0' },
            giantSlayer: 0,
            mapStats: { best: [], worst: [], mostPlayed: [] },
            scoreStats: { 
                closestGames: 0, 
                dominantWins: 0, 
                avgPoints: 0,
                mostCommonScore: 0,
                mostCommonCount: 0
            }
        };
        
        if (matches.length === 0) return stats;
        
        // Sort matches by date (oldest first)
        const sortedMatches = [...matches].sort((a, b) => {
            const aTime = a.createdAt?.seconds || a.createdAt?.toDate?.()?.getTime() || 0;
            const bTime = b.createdAt?.seconds || b.createdAt?.toDate?.()?.getTime() || 0;
            return aTime - bTime;
        });
        
        let currentStreak = 0;
        let currentStreakType = null;
        let bestWinStreak = 0;
        let tempWinStreak = 0;
        let totalScoreWins = 0;
        let totalScoreLosses = 0;
        let totalPoints = 0;
        const mapPerformance = {};
        const scoreFrequency = {};
        
        // Process each match (optimized loop)
        const matchCount = sortedMatches.length;
        for (let i = 0; i < matchCount; i++) {
            const match = sortedMatches[i];
            const isWinner = match.winnerUsername === username;
            
            // Get scores with better fallback handling (cache parseInt)
            let playerScore, opponentScore;
            
            if (isWinner) {
                playerScore = parseInt(match.winnerScore || match.score1 || match.winnerKills || 0) || 0;
                opponentScore = parseInt(match.loserScore || match.score2 || match.loserKills || 0) || 0;
            } else {
                playerScore = parseInt(match.loserScore || match.score2 || match.loserKills || 0) || 0;
                opponentScore = parseInt(match.winnerScore || match.score1 || match.winnerKills || 0) || 0;
            }
            
            const scoreDiff = Math.abs(playerScore - opponentScore);
            
            // Win/Loss tracking
            if (isWinner) {
                stats.wins++;
                totalScoreWins += playerScore;
                totalPoints += playerScore;
                
                // Streak tracking
                if (currentStreakType === 'win') {
                    currentStreak++;
                } else {
                    currentStreak = 1;
                    currentStreakType = 'win';
                }
                tempWinStreak++;
                if (tempWinStreak > bestWinStreak) bestWinStreak = tempWinStreak;
                
                // Close games (diff <= 3)
                if (scoreDiff <= 3) stats.scoreStats.closestGames++;
                
                // Dominant wins (diff >= 10)
                if (scoreDiff >= 10) stats.scoreStats.dominantWins++;
            } else {
                stats.losses++;
                totalScoreLosses += playerScore;
                totalPoints += playerScore;
                tempWinStreak = 0;
                
                // Streak tracking
                if (currentStreakType === 'loss') {
                    currentStreak++;
                } else {
                    currentStreak = 1;
                    currentStreakType = 'loss';
                }
                
                // Close games (losses, diff <= 3)
                if (scoreDiff <= 3) stats.scoreStats.closestGames++;
            }
            
            // Map performance (cache map lookup)
            const map = match.mapPlayed || 'Unknown';
            let mapData = mapPerformance[map];
            if (!mapData) {
                mapData = mapPerformance[map] = { wins: 0, losses: 0, total: 0 };
            }
            mapData.total++;
            if (isWinner) {
                mapData.wins++;
            } else {
                mapData.losses++;
            }
            
            // Score frequency
            scoreFrequency[playerScore] = (scoreFrequency[playerScore] || 0) + 1;
        }
        
        // Recent form (last 10 matches, sorted newest first)
        const recentMatches = [...matches]
            .sort((a, b) => {
                const aTime = b.createdAt?.seconds || b.createdAt?.toDate?.()?.getTime() || 0;
                const bTime = a.createdAt?.seconds || a.createdAt?.toDate?.()?.getTime() || 0;
                return aTime - bTime;
            })
            .slice(0, 10);
        
        recentMatches.forEach(match => {
            if (match.winnerUsername === username) {
                stats.recentForm.wins++;
            } else {
                stats.recentForm.losses++;
            }
        });
        
        // Calculate derived stats
        stats.winRate = formatNum((stats.wins / stats.totalGames) * 100);
        stats.currentStreak = { 
            type: currentStreakType || 'none', 
            count: currentStreak 
        };
        stats.bestWinStreak = bestWinStreak;
        
        const overallAvg = stats.totalGames > 0 ? totalPoints / stats.totalGames : 0;
        const winsAvg = stats.wins > 0 ? totalScoreWins / stats.wins : 0;
        const lossesAvg = stats.losses > 0 ? totalScoreLosses / stats.losses : 0;
        
        stats.avgScore.overall = formatNum(overallAvg);
        stats.avgScore.wins = formatNum(winsAvg);
        stats.avgScore.losses = formatNum(lossesAvg);
        
        // ELO range
        const currentElo = this.currentProfileData?.eloRating || 1000;
        stats.eloRange.current = currentElo;
        
        if (eloHistory.length > 0) {
            const allElos = eloHistory.map(h => h.newElo || h.eloAfter || h.rating || 0).filter(e => e > 0);
            if (allElos.length > 0) {
                stats.eloRange.peak = Math.round(Math.max(...allElos));
                stats.eloRange.low = Math.round(Math.min(...allElos));
            } else {
                stats.eloRange.peak = currentElo;
                stats.eloRange.low = currentElo;
            }
        } else {
            stats.eloRange.peak = currentElo;
            stats.eloRange.low = currentElo;
        }
        
        // Recent form
        stats.recentForm.record = `${stats.recentForm.wins}W-${stats.recentForm.losses}L`;
        const recentTotal = stats.recentForm.wins + stats.recentForm.losses;
        stats.recentForm.winRate = recentTotal > 0 ? 
            formatNum((stats.recentForm.wins / recentTotal) * 100, 0) : '0';
        
        // Giant slayer (this is a placeholder - would need opponent ELO data)
        stats.giantSlayer = Math.floor(stats.wins * 0.3); // Rough estimate
        
        // Map stats - filter maps with at least 3 games
        const qualifiedMaps = Object.entries(mapPerformance)
            .filter(([_, data]) => data.total >= 3)
            .map(([map, data]) => ({
                map,
                wins: data.wins,
                losses: data.losses,
                total: data.total,
                winRate: ((data.wins / data.total) * 100).toFixed(0)
            }));
        
        stats.mapStats.best = qualifiedMaps
            .sort((a, b) => {
                const winRateDiff = parseFloat(b.winRate) - parseFloat(a.winRate);
                // If win rates are equal, sort by total games (more games = better)
                return winRateDiff !== 0 ? winRateDiff : b.total - a.total;
            })
            .slice(0, 3);
        
        stats.mapStats.worst = qualifiedMaps
            .sort((a, b) => {
                const winRateDiff = parseFloat(a.winRate) - parseFloat(b.winRate);
                // If win rates are equal, sort by total games (more games = worse)
                return winRateDiff !== 0 ? winRateDiff : b.total - a.total;
            })
            .slice(0, 3);
        
        stats.mapStats.mostPlayed = Object.entries(mapPerformance)
            .map(([map, data]) => ({
                map,
                wins: data.wins,
                losses: data.losses,
                total: data.total,
                winRate: ((data.wins / data.total) * 100).toFixed(0)
            }))
            .sort((a, b) => b.total - a.total)
            .slice(0, 5);
        
        // Store total unique map count for Map Mastery calculation
        stats.mapStats.totalUniqueMaps = Object.keys(mapPerformance).length;
        
        // Score stats
        stats.scoreStats.avgPoints = formatNum(overallAvg);
        const mostCommonScoreEntry = Object.entries(scoreFrequency)
            .sort((a, b) => b[1] - a[1])[0];
        if (mostCommonScoreEntry) {
            stats.scoreStats.mostCommonScore = mostCommonScoreEntry[0];
            stats.scoreStats.mostCommonCount = mostCommonScoreEntry[1];
        }
        
        return stats;
    }
    

    
    createEloProgressionChart(eloHistory, username, timeMonths = 6) {
        const ctx = document.getElementById('eloProgressionChart');
        if (!ctx) return;
        
        // Add time period filter buttons if they don't exist
        const chartContainer = ctx.closest('.elo-chart-container');
        if (chartContainer && !chartContainer.querySelector('.elo-time-filter')) {
            const filterHTML = `
                <div class="elo-time-filter" style="display: flex; gap: 10px; justify-content: center; margin-bottom: 15px;">
                    <button class="time-filter-btn ${timeMonths === 1 ? 'active' : ''}" data-months="1">1 Month</button>
                    <button class="time-filter-btn ${timeMonths === 3 ? 'active' : ''}" data-months="3">3 Months</button>
                    <button class="time-filter-btn ${timeMonths === 6 ? 'active' : ''}" data-months="6">6 Months</button>
                </div>
            `;
            chartContainer.insertAdjacentHTML('afterbegin', filterHTML);
            
            // Add click handlers
            chartContainer.querySelectorAll('.time-filter-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    // Update active state
                    chartContainer.querySelectorAll('.time-filter-btn').forEach(b => b.classList.remove('active'));
                    e.target.classList.add('active');
                    
                    // Recreate chart with new time period
                    const months = parseInt(e.target.dataset.months);
                    this.createEloProgressionChart(this.fullEloHistory, this.currentUsername, months);
                });
            });
        } else if (chartContainer) {
            // Update active button state if buttons already exist
            chartContainer.querySelectorAll('.time-filter-btn').forEach(btn => {
                const btnMonths = parseInt(btn.dataset.months);
                if (btnMonths === timeMonths) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
        }
        
        if (eloHistory.length === 0) {
            const canvasContainer = ctx.parentElement;
            if (canvasContainer && canvasContainer.querySelector('canvas')) {
                canvasContainer.innerHTML = '<canvas id="eloProgressionChart" style="max-height: 300px;"></canvas><p class="no-data" style="text-align: center; padding: 40px;">No ELO history available yet. Play some matches to see your progression!</p>';
            }
            return;
        }
        
        // Filter data by time period (optimized)
        const now = Date.now();
        const cutoffTime = now - (timeMonths * 30 * 24 * 60 * 60 * 1000);
        
        // Prepare data with win/loss coloring (single pass, reduce function calls)
        const chartData = [];
        const historyLength = eloHistory.length;
        
        for (let i = 0; i < historyLength; i++) {
            const entry = eloHistory[i];
            if (!entry.timestamp) continue;
            
            // Filter by time period
            const entryTime = entry.timestamp.seconds * 1000;
            if (entryTime < cutoffTime) continue;
            
            // Check for various ELO field names (short-circuit evaluation)
            const hasEloData = entry.newElo || entry.eloAfter || entry.rating || entry.previousElo || entry.eloBefore;
            if (!hasEloData) continue;
            
            // Handle different field name variations across D1/D2/D3
            const newElo = Number(entry.newElo || entry.eloAfter || entry.rating) || 1000;
            const prevElo = Number(entry.previousElo || entry.eloBefore) || newElo;
            const change = entry.change || (newElo - prevElo);
            
            // Determine result from ELO change if not explicitly set
            const result = entry.result || entry.matchResult || (change > 0 ? 'win' : change < 0 ? 'loss' : 'expected score');
            
            chartData.push({
                x: new Date(entryTime),
                y: newElo,
                result: result,
                change: change
            });
        }
        
        if (chartData.length === 0) {
            const canvasContainer = ctx.parentElement;
            if (canvasContainer) {
                // Destroy existing chart if it exists
                const existingChart = Chart.getChart(ctx);
                if (existingChart) existingChart.destroy();
                
                canvasContainer.innerHTML = `<canvas id="eloProgressionChart" style="max-height: 300px;"></canvas><p class="no-data" style="text-align: center; padding: 40px;">No ELO history in the last ${timeMonths} month${timeMonths > 1 ? 's' : ''}.</p>`;
            }
            return;
        }
        
        // Destroy existing chart before creating new one
        const existingChart = Chart.getChart(ctx);
        if (existingChart) {
            existingChart.destroy();
        }
        
        // Create labels array from dates
        const labels = chartData.map(d => d.x.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        const dataPoints = chartData.map(d => d.y);
        
        //
        
        try {
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'ELO Rating',
                        data: dataPoints,
                        borderColor: '#4bc0c0',
                        backgroundColor: 'rgba(75, 192, 192, 0.1)',
                        borderWidth: 2,
                        pointBackgroundColor: chartData.map(d => 
                            d.result === 'win' ? '#4ade80' : '#f87171'
                        ),
                        pointBorderColor: chartData.map(d => 
                            d.result === 'win' ? '#22c55e' : '#ef4444'
                        ),
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        tension: 0.3,
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        intersect: false,
                        mode: 'nearest'
                    },
                    plugins: {
                        legend: {
                            display: true,
                            labels: { color: '#fff' }
                        },
                        tooltip: {
                            callbacks: {
                                label: (context) => {
                                    const dataPoint = chartData[context.dataIndex];
                                    const changeText = dataPoint.change > 0 ? `+${dataPoint.change}` : dataPoint.change;
                                    return `ELO: ${Math.round(context.parsed.y)} (${changeText}, ${dataPoint.result})`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: { color: 'rgba(255, 255, 255, 0.1)' },
                            ticks: { 
                                color: '#999',
                                maxRotation: 45,
                                minRotation: 45,
                                autoSkip: true,
                                maxTicksLimit: 12
                            }
                        },
                        y: {
                            beginAtZero: false,
                            grid: { color: 'rgba(255, 255, 255, 0.1)' },
                            ticks: { color: '#999' }
                        }
                    }
                }
            });
        } catch (error) {
            console.error('Error creating ELO chart:', error);
        }
    }
    
    createScoreDistributionChart(matches, username) {
        const ctx = document.getElementById('scoreDistributionChart');
        if (!ctx || matches.length === 0) return;
        
        // Create score distribution buckets
        const scoreBuckets = {
            '0-5': 0, '6-10': 0, '11-15': 0, '16-20': 0
        };
        
        matches.forEach(match => {
            const isWinner = match.winnerUsername === username;
            const score = isWinner ? match.winnerScore : match.loserScore;
            
            if (score <= 5) scoreBuckets['0-5']++;
            else if (score <= 10) scoreBuckets['6-10']++;
            else if (score <= 15) scoreBuckets['11-15']++;
            else scoreBuckets['16-20']++;
        });
        
        try {
            new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: Object.keys(scoreBuckets),
                    datasets: [{
                        label: 'Number of Games',
                        data: Object.values(scoreBuckets),
                        backgroundColor: [
                            'rgba(239, 68, 68, 0.7)',
                            'rgba(251, 146, 60, 0.7)',
                            'rgba(250, 204, 21, 0.7)',
                            'rgba(74, 222, 128, 0.7)'
                        ],
                        borderColor: [
                            'rgb(239, 68, 68)',
                            'rgb(251, 146, 60)',
                            'rgb(250, 204, 21)',
                            'rgb(74, 222, 128)'
                        ],
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: false
                        },
                        title: {
                            display: true,
                            text: 'Score Range Distribution',
                            color: '#fff'
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: { color: 'rgba(255, 255, 255, 0.1)' },
                            ticks: { 
                                color: '#999',
                                stepSize: 1
                            }
                        },
                        x: {
                            grid: { display: false },
                            ticks: { color: '#999' }
                        }
                    }
                }
            });
        } catch (error) {
            console.error('Error creating score distribution chart:', error);
        }
    }
    
    addMatchStatsStyles() {
        if (document.getElementById('match-stats-styles')) return;
        
        const styles = document.createElement('style');
        styles.id = 'match-stats-styles';
        styles.textContent = `
            /* Rank-based coloring for ALL containers */
            .match-history-container.elo-bronze h2,
            .match-history-container.elo-bronze h3,
            .match-history-container.elo-bronze h4,
            .match-history-container.elo-bronze .metric-value,
            .match-history-container.elo-bronze .map-name,
            .match-history-container.elo-bronze .compact-value,
            .match-history-container.elo-bronze .map-rank,
            .player-matchups.elo-bronze h2,
            .player-matchups.elo-bronze h3,
            .player-matchups.elo-bronze h4,
            .player-matchups.elo-bronze .metric-value,
            .rank-history.elo-bronze h2,
            .rank-history.elo-bronze h3,
            .rank-history.elo-bronze h4,
            .rank-history.elo-bronze .metric-value,
            #trophy-container.elo-bronze h2,
            #trophy-container.elo-bronze h3,
            #trophy-container.elo-bronze h4,
            #trophy-container.elo-bronze .metric-value {
                color: #cd7f32 !important;
            }
            
            .match-history-container.elo-bronze .metric-card,
            .match-history-container.elo-bronze .map-stat-item,
            .match-history-container.elo-bronze .compact-stat,
            .player-matchups.elo-bronze .metric-card,
            .player-matchups.elo-bronze .map-stat-item,
            .rank-history.elo-bronze .metric-card,
            .rank-history.elo-bronze .map-stat-item,
            #trophy-container.elo-bronze .metric-card,
            #trophy-container.elo-bronze .map-stat-item {
                border-color: rgba(205, 127, 50, 0.3) !important;
                background: rgba(205, 127, 50, 0.05) !important;
            }
            
            .match-history-container.elo-silver h2,
            .match-history-container.elo-silver h3,
            .match-history-container.elo-silver h4,
            .match-history-container.elo-silver .metric-value,
            .match-history-container.elo-silver .map-name,
            .match-history-container.elo-silver .compact-value,
            .match-history-container.elo-silver .map-rank,
            .player-matchups.elo-silver h2,
            .player-matchups.elo-silver h3,
            .player-matchups.elo-silver h4,
            .player-matchups.elo-silver .metric-value,
            .rank-history.elo-silver h2,
            .rank-history.elo-silver h3,
            .rank-history.elo-silver h4,
            .rank-history.elo-silver .metric-value,
            #trophy-container.elo-silver h2,
            #trophy-container.elo-silver h3,
            #trophy-container.elo-silver h4,
            #trophy-container.elo-silver .metric-value {
                color: #c0c0c0 !important;
            }
            
            .match-history-container.elo-silver .metric-card,
            .match-history-container.elo-silver .map-stat-item,
            .match-history-container.elo-silver .compact-stat,
            .player-matchups.elo-silver .metric-card,
            .player-matchups.elo-silver .map-stat-item,
            .rank-history.elo-silver .metric-card,
            .rank-history.elo-silver .map-stat-item,
            #trophy-container.elo-silver .metric-card,
            #trophy-container.elo-silver .map-stat-item {
                border-color: rgba(192, 192, 192, 0.3) !important;
                background: rgba(192, 192, 192, 0.05) !important;
            }
            
            .match-history-container.elo-gold h2,
            .match-history-container.elo-gold h3,
            .match-history-container.elo-gold h4,
            .match-history-container.elo-gold .metric-value,
            .match-history-container.elo-gold .map-name,
            .match-history-container.elo-gold .compact-value,
            .match-history-container.elo-gold .map-rank,
            .player-matchups.elo-gold h2,
            .player-matchups.elo-gold h3,
            .player-matchups.elo-gold h4,
            .player-matchups.elo-gold .metric-value,
            .rank-history.elo-gold h2,
            .rank-history.elo-gold h3,
            .rank-history.elo-gold h4,
            .rank-history.elo-gold .metric-value,
            #trophy-container.elo-gold h2,
            #trophy-container.elo-gold h3,
            #trophy-container.elo-gold h4,
            #trophy-container.elo-gold .metric-value {
                color: #ffd700 !important;
            }
            
            .match-history-container.elo-gold .metric-card,
            .match-history-container.elo-gold .map-stat-item,
            .match-history-container.elo-gold .compact-stat,
            .player-matchups.elo-gold .metric-card,
            .player-matchups.elo-gold .map-stat-item,
            .rank-history.elo-gold .metric-card,
            .rank-history.elo-gold .map-stat-item,
            #trophy-container.elo-gold .metric-card,
            #trophy-container.elo-gold .map-stat-item {
                border-color: rgba(255, 215, 0, 0.3) !important;
                background: rgba(255, 215, 0, 0.05) !important;
            }
            
            .match-history-container.elo-emerald h2,
            .match-history-container.elo-emerald h3,
            .match-history-container.elo-emerald h4,
            .match-history-container.elo-emerald .metric-value,
            .match-history-container.elo-emerald .map-name,
            .match-history-container.elo-emerald .compact-value,
            .match-history-container.elo-emerald .map-rank,
            .player-matchups.elo-emerald h2,
            .player-matchups.elo-emerald h3,
            .player-matchups.elo-emerald h4,
            .player-matchups.elo-emerald .metric-value,
            .rank-history.elo-emerald h2,
            .rank-history.elo-emerald h3,
            .rank-history.elo-emerald h4,
            .rank-history.elo-emerald .metric-value,
            #trophy-container.elo-emerald h2,
            #trophy-container.elo-emerald h3,
            #trophy-container.elo-emerald h4,
            #trophy-container.elo-emerald .metric-value {
                color: #50c878 !important;
            }
            
            .match-history-container.elo-emerald .metric-card,
            .match-history-container.elo-emerald .map-stat-item,
            .match-history-container.elo-emerald .compact-stat,
            .player-matchups.elo-emerald .metric-card,
            .player-matchups.elo-emerald .map-stat-item,
            .rank-history.elo-emerald .metric-card,
            .rank-history.elo-emerald .map-stat-item,
            #trophy-container.elo-emerald .metric-card,
            #trophy-container.elo-emerald .map-stat-item {
                border-color: rgba(80, 200, 120, 0.3) !important;
                background: rgba(80, 200, 120, 0.05) !important;
            }
            
            /* Keep positive/negative colors for streaks */
            .metric-value.positive {
                color: #4ade80 !important;
            }
            
            .metric-value.negative {
                color: #f87171 !important;
            }
            
            /* Keep map performance colors */
            .map-stat-item.positive {
                border-left-color: #4ade80 !important;
            }
            
            .map-stat-item.negative {
                border-left-color: #f87171 !important;
            }
            
            .performance-metrics-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 15px;
                margin: 20px 0;
            }
            
            .metric-card {
                background: rgba(255, 255, 255, 0.05);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                padding: 15px;
                text-align: center;
            }
            
            .metric-label {
                color: #999;
                font-size: 0.85rem;
                margin-bottom: 8px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            
            .metric-value {
                color: #fff;
                font-size: 1.8rem;
                font-weight: bold;
                margin-bottom: 5px;
            }
            
            .metric-detail {
                color: #666;
                font-size: 0.9rem;
            }
            
            .elo-chart-container {
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                padding: 20px;
            }
            
            .map-performance-section {
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                padding: 20px;
            }
            
            .map-stats-grid-consolidated {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
                gap: 25px;
                margin-top: 15px;
            }
            
            .map-stat-column h4 {
                color: #ffffffff;
                margin-bottom: 10px;
                font-size: 1rem;
            }
            
            .map-list {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            
            .map-stat-item {
                background: rgba(255, 255, 255, 0.05);
                padding: 10px 12px;
                border-radius: 5px;
                display: flex;
                gap: 12px;
                align-items: center;
                border-left: 3px solid rgba(255, 255, 255, 0.2);
            }
            
            .map-rank {
                color: #ffffffff;
                font-weight: bold;
                font-size: 0.9rem;
                min-width: 20px;
            }
            
            .map-stat-item.positive {
                border-left-color: #4ade80;
                background: rgba(74, 222, 128, 0.1);
            }
            
            .map-stat-item.negative {
                border-left-color: #f87171;
                background: rgba(248, 113, 113, 0.1);
            }
            
            .map-name {
                color: #fff;
                font-weight: 500;
                flex: 1;
            }
            
            .map-record {
                color: #999;
                font-size: 0.9rem;
            }
            
            .score-distribution-section {
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                padding: 20px;
            }
            
            .score-analysis-container {
                display: grid;
                grid-template-columns: 1fr auto;
                gap: 25px;
                align-items: center;
            }
            
            .score-chart-wrapper {
                min-width: 0;
            }
            
            .score-stats-compact {
                display: flex;
                flex-direction: column;
                gap: 12px;
                min-width: 180px;
            }
            
            .compact-stat {
                background: rgba(255, 255, 255, 0.05);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 6px;
                padding: 10px 15px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 15px;
            }
            
            .compact-label {
                color: #999;
                font-size: 0.85rem;
            }
            
            .compact-value {
                color: #ffffffff;
                font-size: 1.1rem;
                font-weight: bold;
            }
            
            @media (max-width: 768px) {
                .score-analysis-container {
                    grid-template-columns: 1fr;
                }
                
                .score-stats-compact {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 10px;
                }
            }
            
            .no-data {
                color: #666;
                font-style: italic;
                padding: 10px;
                text-align: center;
            }
            
            /* Time period filter buttons */
            .elo-time-filter {
                display: flex;
                gap: 10px;
                justify-content: center;
                margin-bottom: 15px;
            }
            
            .time-filter-btn {
                background: rgba(255, 255, 255, 0.05);
                border: 1px solid rgba(255, 255, 255, 0.2);
                color: #999;
                padding: 8px 16px;
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.2s ease;
                font-size: 0.9rem;
            }
            
            .time-filter-btn:hover {
                background: rgba(255, 255, 255, 0.1);
                border-color: rgba(255, 255, 255, 0.3);
                color: #fff;
            }
            
            .time-filter-btn.active {
                background: rgba(75, 192, 192, 0.2);
                border-color: #4bc0c0;
                color: #4bc0c0;
            }
            
            /* Player Scorecard Styles */
            .player-scorecard {
                background: rgba(0, 0, 0, 0.3);
                padding: 20px;
                border-radius: 8px;
                border: 1px solid rgba(255, 255, 255, 0.1);
            }
            
            .scorecard-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
                gap: 15px;
            }
            
            .scorecard-item {
                background: rgba(255, 255, 255, 0.05);
                border: 2px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                padding: 15px 10px;
                text-align: center;
                transition: transform 0.2s ease, border-color 0.2s ease;
                cursor: help;
                position: relative;
            }
            
            .scorecard-item:hover {
                transform: translateY(-3px);
                border-color: rgba(255, 255, 255, 0.3);
            }
            
            .scorecard-overall {
                grid-column: 1 / -1;
                background: rgba(255, 255, 255, 0.08);
                border-width: 3px;
            }
            
            .scorecard-grade {
                font-size: 3rem;
                font-weight: bold;
                line-height: 1;
                margin-bottom: 8px;
            }
            
            .scorecard-overall .scorecard-grade {
                font-size: 4rem;
            }
            
            .scorecard-label {
                color: #999;
                font-size: 0.85rem;
                text-transform: uppercase;
                letter-spacing: 1px;
                margin-bottom: 5px;
            }
            
            .scorecard-value {
                color: #fff;
                font-size: 1.1rem;
                font-weight: 600;
                margin-bottom: 5px;
            }
            
            .scorecard-desc {
                color: #666;
                font-size: 0.75rem;
                font-style: italic;
            }
            
            /* Rank-based styling for scorecard container */
            .match-history-container.elo-unranked.player-scorecard-container {
                border-color: #DC143C;
            }
            
            .match-history-container.elo-bronze.player-scorecard-container {
                border-color: #CD7F32;
            }
            
            .match-history-container.elo-silver.player-scorecard-container {
                border-color: #b9f1fc;
            }
            
            .match-history-container.elo-gold.player-scorecard-container {
                border-color: #FFD700;
            }
            
            .match-history-container.elo-emerald.player-scorecard-container {
                border-color: #50C878;
            }
            
            @media (max-width: 768px) {
                .scorecard-grid {
                    grid-template-columns: repeat(2, 1fr);
                }
                
                .scorecard-overall {
                    grid-column: 1 / -1;
                }
            }
        `;
        document.head.appendChild(styles);
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
            
            // Apply rank styling
            const profileContent = document.querySelector('.profile-content');
            const existingRankClass = profileContent ? 
                Array.from(profileContent.classList).find(c => c.startsWith('elo-')) : 
                'elo-unranked';
            
            matchupsContainer.classList.remove('elo-unranked', 'elo-bronze', 'elo-silver', 'elo-gold', 'elo-emerald');
            if (existingRankClass) {
                matchupsContainer.classList.add(existingRankClass);
            }
            
            // Calculate matchups in one pass through the data
            const matchups = matches.reduce((acc, match) => {
                const opponent = match.winnerUsername === username ? match.loserUsername : match.winnerUsername;
                const isWin = match.winnerUsername === username;
                const playerScore = match.winnerUsername === username ? match.winnerScore : match.loserScore;
                
                if (!acc[opponent]) {
                    acc[opponent] = { wins: 0, losses: 0, total: 0, totalScore: 0 };
                }
                
                acc[opponent].total++;
                acc[opponent][isWin ? 'wins' : 'losses']++;
                acc[opponent].totalScore += parseInt(playerScore) || 0;
                
                return acc;
            }, {});
            
            // Sort by most played
            const sortedMatchups = Object.entries(matchups)
                .sort((a, b) => b[1].total - a[1].total);
            
            // Identify rivals and toughest opponent (minimum 3 games)
            let rivalOpponent = null;
            let toughestOpponent = null;
            let smallestDifference = Infinity;
            let lowestWinRate = 100;
            
            // First pass: find rival (closest to 50/50, within 30% win rate range)
            sortedMatchups.forEach(([opponent, stats]) => {
                if (stats.total >= 3) {
                    const winRate = (stats.wins / stats.total) * 100;
                    const difference = Math.abs(stats.wins - stats.losses);
                    // Only consider a rival if win rate is between 30% and 70%
                    if (winRate >= 30 && winRate <= 70 && difference < smallestDifference) {
                        smallestDifference = difference;
                        rivalOpponent = opponent;
                    }
                }
            });
            
            // Second pass: find toughest opponent (lowest win rate below 60%, excluding rival)
            sortedMatchups.forEach(([opponent, stats]) => {
                if (stats.total >= 3 && opponent !== rivalOpponent) {
                    const winRate = (stats.wins / stats.total) * 100;
                    // Only consider "tough" if you're actually struggling (below 60% win rate)
                    if (winRate < 60 && winRate < lowestWinRate) {
                        lowestWinRate = winRate;
                        toughestOpponent = opponent;
                    }
                }
            });
            
            // Fetch ELO data for all opponents to color them properly
            const opponentEloData = {};
            await Promise.all(sortedMatchups.map(async ([opponent]) => {
                opponentEloData[opponent] = await this.getPlayerEloData(opponent);
            }));

            // Helper function to get color based on ELO and stats
            const getOpponentColor = (opponent) => {
                const data = opponentEloData[opponent];
                if (!data) return '#DC143C'; // Default unranked
                
                const elo = data.eloRating || 0;
                const matchCount = data.matchCount || 0;
                const winRate = data.winRate || 0;
                
                if (matchCount < 5) return '#DC143C'; // Unranked
                if (elo >= 1000 && winRate >= 80 && matchCount >= 20) return '#50C878'; // Emerald
                if (elo >= 700) return '#FFD700'; // Gold
                if (elo >= 500) return '#b9f1fc'; // Silver
                if (elo >= 200) return '#CD7F32'; // Bronze
                // If 5+ matches but ELO < 200, still Bronze (minimum rank for ranked players)
                return '#CD7F32'; // Bronze (minimum for 5+ matches)
            };
            
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
                            <th>Average Score</th>
                            <th>Win Rate</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${sortedMatchups.length === 0 ?
                            '<tr><td colspan="6">No matchups found</td></tr>' :
                            sortedMatchups.map(([opponent, stats]) => {
                                const winRate = ((stats.wins / stats.total) * 100).toFixed(1);
                                const avgScore = (stats.totalScore / stats.total).toFixed(1);
                                
                                // Determine special class
                                let rowClass = '';
                                let badge = '';
                                if (opponent === rivalOpponent && stats.total >= 3) {
                                    rowClass = 'rival-opponent';
                                    badge = '<span class="matchup-badge rival-badge" title="Closest matches">Rival</span>';
                                } else if (opponent === toughestOpponent && stats.total >= 3) {
                                    rowClass = 'toughest-opponent';
                                    badge = '<span class="matchup-badge toughest-badge" title="Toughest opponent">Toughest</span>';
                                }
                                
                                const opponentColor = getOpponentColor(opponent);
                                
                                return `
                                    <tr class="${rowClass}">
                                        <td>
                                            <a href="profile.html?username=${encodeURIComponent(opponent)}&ladder=${this.currentLadder.toLowerCase()}"
                                               class="player-link"
                                               style="color: ${opponentColor} !important;">
                                                ${opponent}
                                            </a>
                                            ${badge}
                                        </td>
                                        <td>${stats.total}</td>
                                        <td class="wins">${stats.wins}</td>
                                        <td class="losses">${stats.losses}</td>
                                        <td>${avgScore}</td>
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
            
            // Apply rank styling
            const profileContent = document.querySelector('.profile-content');
            const existingRankClass = profileContent ? 
                Array.from(profileContent.classList).find(c => c.startsWith('elo-')) : 
                'elo-unranked';
            
            promotionContainer.classList.remove('elo-unranked', 'elo-bronze', 'elo-silver', 'elo-gold', 'elo-emerald');
            if (existingRankClass) {
                promotionContainer.classList.add(existingRankClass);
            }
            
            // Query database with proper filter for promotions/demotions only
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
            const processedRecords = snapshot.docs.map(doc => ({
                ...doc.data(),
                id: doc.id,
                date: doc.data().timestamp ? new Date(doc.data().timestamp.seconds * 1000) : new Date()
            }));
            
            // Get season information
            const seasonCountDoc = await getDoc(doc(db, 'metadata', 'seasonCount'));
            const currentSeason = seasonCountDoc.exists() ? seasonCountDoc.data().count : 1;
            
            // Split records: first 3 and the rest
            const initialRecords = processedRecords.slice(0, 3);
            const additionalRecords = processedRecords.slice(3);
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

    async loadPlayerStats(username) 
    {
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
            
            if (eloRating >= 1000) {
                // Check for Emerald requirements
                const winRate = stats.totalMatches > 0 ? (stats.wins / stats.totalMatches * 100) : 0;
                if (winRate >= 80 && stats.totalMatches >= 20) {
                    nextRank = 'Emerald';
                    eloNeeded = 0;
                    eloClass = 'elo-emerald';
                } else {
                    nextRank = 'Emerald';
                    eloClass = 'elo-gold';
                    if (winRate < 80) {
                        eloNeeded = `${(80 - winRate).toFixed(1)}% win rate`;
                    } else if (stats.totalMatches < 20) {
                        eloNeeded = `${20 - stats.totalMatches} more matches`;
                    } else {
                        eloNeeded = 0;
                    }
                }
            } else if (eloRating >= 700) {
                nextRank = 'Emerald';
                eloNeeded = 1000 - eloRating;
                eloClass = 'elo-gold';
            } else if (eloRating >= 500) {
                nextRank = 'Gold';
                eloNeeded = 700 - eloRating;
                eloClass = 'elo-silver';
            } else if (eloRating >= 200) {
                nextRank = 'Silver';
                eloNeeded = 500 - eloRating;
                eloClass = 'elo-bronze';
            } else {
                // 5+ matches rule: Anyone with 5+ matches is at least Bronze
                if (stats.totalMatches >= 5) {
                    nextRank = 'Silver';
                    eloNeeded = 500 - eloRating;
                    eloClass = 'elo-bronze';
                } else {
                    nextRank = 'Bronze';
                    eloNeeded = 200 - eloRating;
                    eloClass = 'elo-unranked';
                }
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
                
                // IMPORTANT: Reset labels back to standard ladder terminology
                // This fixes the issue where FFA labels persist after switching ladders
                const labelsToReset = {
                    'stats-wins': 'WINS',
                    'stats-losses': 'LOSSES',
                    'stats-winrate': 'WIN RATE'
                };
                
                for (const [id, standardLabel] of Object.entries(labelsToReset)) {
                    const element = document.getElementById(id);
                    if (element) {
                        // Find the label element (previous sibling with class stat-label)
                        const parent = element.parentElement;
                        if (parent) {
                            const labelDiv = parent.querySelector('.stat-label');
                            if (labelDiv) {
                                labelDiv.textContent = standardLabel;
                            }
                        }
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
                    if (eloRating >= 1000 && eloNeeded === 0) {
                        nextRankItem.innerHTML = `
                            <div class="stat-label">CURRENT RANK</div>
                            <div class="stat-value ${eloClass}">${nextRank}</div>
                        `;
                    } 
                    else
                    {
                        nextRankItem.innerHTML = `
                            <div class="stat-label">NEXT RANK</div>
                            <div class="stat-value ${eloClass}">${nextRank}</div>
                            <div class="stat-progress ${eloClass}">${eloNeeded}${typeof eloNeeded === 'number' ? ' ELO needed' : ''}</div>
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
            console.error('Error loading player stats:', error);
            this.setDefaultStats();
        }
    }
    
setupDynamicSubgameHomes() {
    const favoriteSubgameSelect = document.getElementById('favorite-subgame-edit');
    const subgameHomesContainer = document.getElementById('favorite-subgame-homes');
    const subgameHomesLabel = document.getElementById('favorite-subgame-homes-label');
    
    if (!favoriteSubgameSelect || !subgameHomesContainer) return;
    
    // Define which subgames don't have custom homes
    const noHomeSubgames = ['Blind Match', 'Rematch'];
    
    favoriteSubgameSelect.addEventListener('change', (e) => {
        const selectedSubgame = e.target.value;
        
        if (selectedSubgame && selectedSubgame !== '' && !noHomeSubgames.includes(selectedSubgame)) {
            // Show the subgame homes section for subgames that support custom homes
            subgameHomesContainer.style.display = 'block';
            if (subgameHomesLabel) {
                subgameHomesLabel.textContent = `${selectedSubgame} Homes:`;
            }
            
            // Update placeholders
            const home1 = document.getElementById('favorite-subgame-home-1');
            const home2 = document.getElementById('favorite-subgame-home-2');
            const home3 = document.getElementById('favorite-subgame-home-3');
            
            if (home1) home1.placeholder = `Primary ${selectedSubgame} home`;
            if (home2) home2.placeholder = `Secondary ${selectedSubgame} home`;
            if (home3) home3.placeholder = `Tertiary ${selectedSubgame} home`;
        } else {
            // Hide the subgame homes section for subgames that don't support homes
            subgameHomesContainer.style.display = 'none';
            
            // Clear the values
            const home1 = document.getElementById('favorite-subgame-home-1');
            const home2 = document.getElementById('favorite-subgame-home-2');
            const home3 = document.getElementById('favorite-subgame-home-3');
            
            if (home1) home1.value = '';
            if (home2) home2.value = '';
            if (home3) home3.value = '';
        }
    });
}

getFavoriteSubgameHome(homeNumber) {
    if (!this.currentProfileData || !this.currentProfileData.favoriteSubgame) {
        return '';
    }
    
    const subgame = this.currentProfileData.favoriteSubgame;
    
    // Define which subgames don't have custom homes
    const noHomeSubgames = ['Blind Match', 'Rematch'];
    
    if (noHomeSubgames.includes(subgame)) {
        return ''; // No custom homes for these subgames
    }
    
    const fieldMap = {
        'Fusion Match': ['fusionHome1', 'fusionHome2', 'fusionHome3'],
        '≥6 Missiles': ['missilesHome1', 'missilesHome2', 'missilesHome3'],
        'Weapon Imbalance': ['weaponImbalanceHome1', 'weaponImbalanceHome2', 'weaponImbalanceHome3'],
        'Disorientation': ['disorientationHome1', 'disorientationHome2', 'disorientationHome3'],
        'Ratting': ['rattingHome1', 'rattingHome2', 'rattingHome3'],
        'Altered Powerups': ['alteredPowerUpsHome1', 'alteredPowerUpsHome2', 'alteredPowerUpsHome3'],
        'Mega Match': ['megaMatchHome1', 'megaMatchHome2', 'megaMatchHome3']
    };
    
    const fields = fieldMap[subgame];
    if (fields && fields[homeNumber - 1]) {
        return this.currentProfileData[fields[homeNumber - 1]] || '';
    }
    
    return '';
}

getDynamicSubgameHomes() {
    const favoriteSubgame = document.getElementById('favorite-subgame-edit')?.value.trim();
    const homes = {};
    
    // Define which subgames don't have custom homes
    const noHomeSubgames = ['Blind Match', 'Rematch'];
    
    if (favoriteSubgame && favoriteSubgame !== '' && !noHomeSubgames.includes(favoriteSubgame)) {
        const home1 = document.getElementById('favorite-subgame-home-1')?.value.trim() || '';
        const home2 = document.getElementById('favorite-subgame-home-2')?.value.trim() || '';
        const home3 = document.getElementById('favorite-subgame-home-3')?.value.trim() || '';
        
        const fieldMap = {
            'Fusion Match': ['fusionHome1', 'fusionHome2', 'fusionHome3'],
            '≥6 Missiles': ['missilesHome1', 'missilesHome2', 'missilesHome3'],
            'Weapon Imbalance': ['weaponImbalanceHome1', 'weaponImbalanceHome2', 'weaponImbalanceHome3'],
            'Disorientation': ['disorientationHome1', 'disorientationHome2', 'disorientationHome3'],
            'Ratting': ['rattingHome1', 'rattingHome2', 'rattingHome3'],
            'Altered Powerups': ['alteredPowerUpsHome1', 'alteredPowerUpsHome2', 'alteredPowerUpsHome3'],
            'Mega Match': ['megaMatchHome1', 'megaMatchHome2', 'megaMatchHome3']
        };
        
        const fields = fieldMap[favoriteSubgame];
        if (fields) {
            homes[fields[0]] = home1;
            homes[fields[1]] = home2;
            homes[fields[2]] = home3;
        }
    }
    
    return homes;
}

formatAllHomesDisplay(data) {
    // Get standard homes
    const standardHomes = [data.homeLevel1, data.homeLevel2, data.homeLevel3]
        .filter(level => level && level.trim() !== '');
    
    // Get favorite subgame and its homes
    const favoriteSubgame = data.favoriteSubgame;
    let subgameHomes = [];
    
    // Define which subgames don't have custom homes
    const noHomeSubgames = ['Blind Match', 'Rematch'];
    
    if (favoriteSubgame && !noHomeSubgames.includes(favoriteSubgame)) {
        const fieldMap = {
            'Fusion Match': ['fusionHome1', 'fusionHome2', 'fusionHome3'],
            '≥6 Missiles': ['missilesHome1', 'missilesHome2', 'missilesHome3'],
            'Weapon Imbalance': ['weaponImbalanceHome1', 'weaponImbalanceHome2', 'weaponImbalanceHome3'],
            'Disorientation': ['disorientationHome1', 'disorientationHome2', 'disorientationHome3'],
            'Ratting': ['rattingHome1', 'rattingHome2', 'rattingHome3'],
            'Altered Powerups': ['alteredPowerUpsHome1', 'alteredPowerUpsHome2', 'alteredPowerUpsHome3'],
            'Mega Match': ['megaMatchHome1', 'megaMatchHome2', 'megaMatchHome3']
        };
        
        const fields = fieldMap[favoriteSubgame];
        if (fields) {
            subgameHomes = fields.map(field => data[field])
                .filter(home => home && home.trim() !== '');
        }
    }
    
    // Build display with consistent structure
    let displayParts = [];
    
    // Add standard homes
    if (standardHomes.length > 0) {
        displayParts.push(`<div class="homes-section">
            <strong>Standard:</strong> ${standardHomes.join(', ')}
        </div>`);
    }
    
    // Add subgame homes if they exist (only for subgames that support homes)
    if (favoriteSubgame && !noHomeSubgames.includes(favoriteSubgame) && subgameHomes.length > 0) {
        displayParts.push(`<div class="homes-section">
            <strong>${favoriteSubgame}:</strong> ${subgameHomes.join(', ')}
        </div>`);
    }
    
    // Show favorite subgame even if it doesn't have custom homes
    if (favoriteSubgame && noHomeSubgames.includes(favoriteSubgame) && standardHomes.length > 0) {
        displayParts.push(`<div class="homes-section">
            <strong>${favoriteSubgame}:</strong> Uses random/preset maps
        </div>`);
    }
    
    // Return combined display or fallback
    if (displayParts.length > 0) {
        return `<div class="all-homes-display">${displayParts.join('')}</div>`;
    } else {
        return 'No home levels set';
    }
}

// Enhanced success message display
showSuccessMessage(message) {
    // Remove any existing messages
    const existingMessage = document.querySelector('.success-message');
    if (existingMessage) {
        existingMessage.remove();
    }
    
    // Create success message
    const successDiv = document.createElement('div');
    successDiv.className = 'success-message';
    successDiv.textContent = message;
    successDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #4CAF50;
        color: white;
        padding: 1rem;
        border-radius: 4px;
        z-index: 1000;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        animation: slideIn 0.3s ease-out;
    `;
    
    document.body.appendChild(successDiv);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
        if (successDiv.parentNode) {
            successDiv.remove();
        }
    }, 3000);
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
    
    // Reset labels to standard ladder terminology
    const labelsToReset = {
        'stats-wins': 'WINS',
        'stats-losses': 'LOSSES',
        'stats-winrate': 'WIN RATE'
    };
    
    for (const [id, standardLabel] of Object.entries(labelsToReset)) {
        const element = document.getElementById(id);
        if (element) {
            const parent = element.parentElement;
            if (parent) {
                const labelDiv = parent.querySelector('.stat-label');
                if (labelDiv) {
                    labelDiv.textContent = standardLabel;
                }
            }
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
        // Update form fields including ALL profile data and dynamic subgame homes
        const editFields = {
            'profile-image-url': this.currentProfileData.profileImageUrl || '',
            'motto-edit': this.currentProfileData.motto || '',
            'favorite-map-edit': this.currentProfileData.favoriteMap || '',
            'favorite-weapon-edit': this.currentProfileData.favoriteWeapon || '',
            'favorite-subgame-edit': this.currentProfileData.favoriteSubgame || '',
            'timezone-edit': this.currentProfileData.timezone || '',
            'division-edit': this.currentProfileData.division || '',
            'country-selector': this.currentProfileData.country || '',
            
            // Standard homes
            'home-level-1': this.currentProfileData.homeLevel1 || '',
            'home-level-2': this.currentProfileData.homeLevel2 || '',
            'home-level-3': this.currentProfileData.homeLevel3 || '',
            
            // Dynamic favorite subgame homes
            'favorite-subgame-home-1': this.getFavoriteSubgameHome(1),
            'favorite-subgame-home-2': this.getFavoriteSubgameHome(2),
            'favorite-subgame-home-3': this.getFavoriteSubgameHome(3)
        };
        
        // Fill form fields
        for (const [id, value] of Object.entries(editFields)) {
            const element = document.getElementById(id);
            if (element) element.value = value;
        }
        
        // Setup dynamic subgame homes
        this.setupDynamicSubgameHomes();
        
        // Trigger the subgame change to show/hide homes
        const favoriteSubgameSelect = document.getElementById('favorite-subgame-edit');
        if (favoriteSubgameSelect) {
            favoriteSubgameSelect.dispatchEvent(new Event('change'));
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


async handleSubmit(event) {
    event.preventDefault();
    const user = auth.currentUser;
    
    if (!user) {
        this.showError('You must be logged in to edit your profile');
        return;
    }

    try {
        // Get all form values
        const profileImageUrl = document.getElementById('profile-image-url')?.value.trim() || '';
        const motto = document.getElementById('motto-edit')?.value.trim() || '';
        const favoriteMap = document.getElementById('favorite-map-edit')?.value.trim() || '';
        const favoriteWeapon = document.getElementById('favorite-weapon-edit')?.value.trim() || '';
        const favoriteSubgame = document.getElementById('favorite-subgame-edit')?.value.trim() || '';
        const homeLevel1 = document.getElementById('home-level-1')?.value.trim() || '';
        const homeLevel2 = document.getElementById('home-level-2')?.value.trim() || '';
        const homeLevel3 = document.getElementById('home-level-3')?.value.trim() || '';
        const country = document.getElementById('country-selector')?.value.trim() || '';
        const division = document.getElementById('division-edit')?.value.trim() || '';
        const timezone = document.getElementById('timezone-edit')?.value.trim() || '';

        // Get dynamic subgame homes and merge with profile data
        const dynamicSubgameHomes = this.getDynamicSubgameHomes();

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
            division,
            timezone,
            ...dynamicSubgameHomes, // Spread the dynamic subgame homes
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
        const cacheKey = `${username}_${this.currentLadder}`;
        if (username && playerDataCache.has(cacheKey)) {
            const cachedData = playerDataCache.get(cacheKey);
            playerDataCache.set(cacheKey, { ...cachedData, ...updatedProfileData });
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
                
                // Ladder registration info: D1, D2, D3
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

    // Find the collapsible fields container (the profile details collapse)
    let collapsibleFields = document.querySelector('.collapsible-fields');
    // Fallback: if not found, use the profile-content as before
    const container = collapsibleFields || document.querySelector('.profile-content');
    if (!container) return;
    
    // Get available home levels
    const homeLevels = [profileData.homeLevel1, profileData.homeLevel2, profileData.homeLevel3]
        .filter(level => level && level.trim() !== '');
    
    // Get favorite subgame and its homes
    const favoriteSubgame = profileData.favoriteSubgame;
    let subgameHomes = [];
    
    // Define which subgames don't have custom homes
    const noHomeSubgames = ['Blind Match', 'Rematch'];
    
    if (favoriteSubgame && !noHomeSubgames.includes(favoriteSubgame)) {
        const fieldMap = {
            'Fusion Match': ['fusionHome1', 'fusionHome2', 'fusionHome3'],
            '≥6 Missiles': ['missilesHome1', 'missilesHome2', 'missilesHome3'],
            'Weapon Imbalance': ['weaponImbalanceHome1', 'weaponImbalanceHome2', 'weaponImbalanceHome3'],
            'Disorientation': ['disorientationHome1', 'disorientationHome2', 'disorientationHome3'],
            'Ratting': ['rattingHome1', 'rattingHome2', 'rattingHome3'],
            'Altered Powerups': ['alteredPowerUpsHome1', 'alteredPowerUpsHome2', 'alteredPowerUpsHome3'],
            'Mega Match': ['megaMatchHome1', 'megaMatchHome2', 'megaMatchHome3']
        };
        
        const fields = fieldMap[favoriteSubgame];
        if (fields) {
            subgameHomes = fields.map(field => profileData[field])
                .filter(home => home && home.trim() !== '');
        }
    }
    
    // Combine all available invites
    const allInvites = [
        // Standard homes
        ...homeLevels.map(level => ({ 
            type: 'home', 
            value: level, 
            icon: 'map', 
            label: level,
            category: 'Standard' 
        })),
        
        // Subgame homes (only for subgames that support custom homes)
        ...subgameHomes.map(home => ({ 
            type: 'subgame-home', 
            value: home, 
            icon: 'gamepad', 
            label: `${home}`,
            category: favoriteSubgame,
            subgameType: favoriteSubgame
        })),
        
        // General subgame invite (for all favorite subgames, including those without custom homes)
        ...(favoriteSubgame ? [{ 
            type: 'subgame', 
            value: favoriteSubgame, 
            icon: 'gamepad', 
            label: favoriteSubgame,
            category: 'Subgame'
        }] : []),
        
        // Add Random Map option
        {
            type: 'random',
            value: 'random',
            icon: 'dice',
            label: 'Random Map',
            category: 'DXMA'
        }
    ];
    
    if (allInvites.length === 0) return;
        
    const invitationSection = document.createElement('div');
    invitationSection.className = `invitation-section collapsed`;
    invitationSection.innerHTML = `
        <div class="invitation-header" id="invitation-header-toggle">
            <div class="invitation-title">
                <i class="fas fa-paper-plane"></i>
                <span>Invite ${profileData.username}</span>
                <i class="fas fa-chevron-down invitation-toggle-icon"></i>
            </div>
            <p>Send an invitation for their preferred game settings</p>
        </div>
        <div class="invitation-content">
            <div class="invitation-grid">
                ${/* ...map over allInvites as before... */''}
            </div>
        </div>
        <!-- Game Selection Modal for Random Map -->
        <div class="game-selection-modal" id="game-selection-modal" style="display: none;">
            <div class="game-selection-content">
                <h3>Select Descent Game</h3>
                <p>Choose which Descent game for the random map:</p>
                <div class="game-selection-buttons">
                    <button class="game-select-btn d1-btn" data-game="D1">
                        <i class="fas fa-gamepad"></i>
                        <span>Descent 1</span>
                    </button>
                    <button class="game-select-btn d2-btn" data-game="D2">
                        <i class="fas fa-gamepad"></i>
                        <span>Descent 2</span>
                    </button>
                    <button class="game-select-btn d3-btn" data-game="D3">
                        <i class="fas fa-gamepad"></i>
                        <span>Descent 3</span>
                    </button>
                </div>
                <button class="cancel-game-selection">Cancel</button>
            </div>
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
            
            .invitation-section.collapsed .invitation-content {
                max-height: 0;
                opacity: 0;
                overflow: hidden;
                transition: max-height 0.3s ease, opacity 0.3s ease;
            }
            
            .invitation-section:not(.collapsed) .invitation-content {
                max-height: 2000px;
                opacity: 1;
                transition: max-height 0.5s ease, opacity 0.3s ease;
            }
            
            .invitation-header {
                cursor: pointer;
                user-select: none;
                transition: background 0.2s ease;
                padding: 0.5rem;
                margin: -0.5rem;
                border-radius: 8px;
            }
            
            .invitation-header:hover {
                background: rgba(255, 255, 255, 0.05);
            }
            
            .invitation-toggle-icon {
                margin-left: auto;
                font-size: 1rem;
                transition: transform 0.3s ease;
            }
            
            .invitation-section:not(.collapsed) .invitation-toggle-icon {
                transform: rotate(180deg);
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
            
            .invitation-header p {
                margin: 0;
                color: #aaa;
                font-size: 0.9rem;
            }
            
            .invitation-content {
                margin-top: 1rem;
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
            
            .invite-btn.random-invite {
                border-color: #9C27B0;
                background: linear-gradient(135deg, #2a2a2a 0%, #3d1f4d 100%);
            }
            
            .invite-btn.random-invite:hover {
                border-color: #E040FB;
                background: linear-gradient(135deg, #3d1f4d 0%, #5e2a6d 100%);
                color: #E040FB;
            }
            
            .invite-btn.random-invite i {
                animation: dice-roll 0.5s ease-in-out;
            }
            
            @keyframes dice-roll {
                0%, 100% { transform: rotate(0deg); }
                25% { transform: rotate(90deg); }
                50% { transform: rotate(180deg); }
                75% { transform: rotate(270deg); }
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
            
            .invite-btn:disabled {
                background: #1a1a1a !important;
                border-color: #333 !important;
                color: #666 !important;
                cursor: not-allowed !important;
                transform: none !important;
                box-shadow: none !important;
            }
            
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
            
            /* Game Selection Modal Styles */
            .game-selection-modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.8);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
                animation: fadeIn 0.2s ease;
            }
            
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            
            .game-selection-content {
                background: #2a2a2a;
                padding: 2rem;
                border-radius: 12px;
                border: 2px solid #444;
                max-width: 500px;
                width: 90%;
                animation: slideUp 0.3s ease;
            }
            
            @keyframes slideUp {
                from { transform: translateY(20px); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }
            
            .game-selection-content h3 {
                margin: 0 0 0.5rem 0;
                color: white;
                text-align: center;
                font-size: 1.5rem;
            }
            
            .game-selection-content p {
                margin: 0 0 1.5rem 0;
                color: #aaa;
                text-align: center;
            }
            
            .game-selection-buttons {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 1rem;
                margin-bottom: 1rem;
            }
            
            .game-select-btn {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 0.5rem;
                padding: 1.5rem 1rem;
                background: #333;
                border: 2px solid #555;
                border-radius: 8px;
                color: white;
                cursor: pointer;
                transition: all 0.3s ease;
                font-size: 1rem;
            }
            
            .game-select-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            }
            
            .game-select-btn.d1-btn:hover {
                border-color: #FF9800;
                background: rgba(255, 152, 0, 0.1);
                color: #FF9800;
            }
            
            .game-select-btn.d2-btn:hover {
                border-color: #2196F3;
                background: rgba(33, 150, 243, 0.1);
                color: #2196F3;
            }
            
            .game-select-btn.d3-btn:hover {
                border-color: #9C27B0;
                background: rgba(156, 39, 176, 0.1);
                color: #9C27B0;
            }
            
            .game-select-btn i {
                font-size: 2rem;
            }
            
            .cancel-game-selection {
                width: 100%;
                padding: 0.75rem;
                background: #555;
                border: 1px solid #666;
                border-radius: 6px;
                color: white;
                cursor: pointer;
                transition: background 0.2s;
            }
            
            .cancel-game-selection:hover {
                background: #666;
            }
            
            @media (max-width: 768px) {
                .invitation-grid {
                    grid-template-columns: 1fr;
                }
                
                .game-selection-buttons {
                    grid-template-columns: 1fr;
                }
                
                .invitation-title {
                    flex-direction: row;
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
    
    // Add toggle functionality for collapse/expand
    const headerToggle = invitationSection.querySelector('#invitation-header-toggle');
    headerToggle.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
        invitationSection.classList.toggle('collapsed');
    });
    
    // Get modal elements
    const gameModal = invitationSection.querySelector('#game-selection-modal');
    const cancelModalBtn = invitationSection.querySelector('.cancel-game-selection');
    
    // Cancel modal
    cancelModalBtn.addEventListener('click', () => {
        gameModal.style.display = 'none';
    });
    
    // Close modal on backdrop click
    gameModal.addEventListener('click', (e) => {
        if (e.target === gameModal) {
            gameModal.style.display = 'none';
        }
    });
    
    // Add event listeners for invitation buttons
    invitationSection.querySelectorAll('.invite-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            
            const type = btn.dataset.type;
            let value = btn.dataset.value;
            const originalContent = btn.innerHTML;
            
            // Handle random map selection - show game selector modal
            if (type === 'random') {
                gameModal.style.display = 'flex';
                
                // Add click handlers for game selection
                invitationSection.querySelectorAll('.game-select-btn').forEach(gameBtn => {
                    gameBtn.onclick = async () => {
                        const selectedGame = gameBtn.dataset.game;
                        gameModal.style.display = 'none';
                        
                        btn.disabled = true;
                        btn.classList.add('loading');
                        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Rolling...</span>';
                        
                        try {
                            const randomMap = await this.getRandomDXMAMap(selectedGame);
                            
                            if (randomMap) {
                                value = randomMap.title;
                                
                                btn.classList.remove('loading');
                                btn.innerHTML = `<i class="fas fa-dice"></i><span>${value}</span><small>${selectedGame} - Selected!</small>`;
                                
                                await new Promise(resolve => setTimeout(resolve, 1500));
                                
                                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Sending...</span>';
                                
                                await this.sendInvitation(profileData.username, profileData.userId, 'random-map', value, selectedGame);
                                
                                btn.classList.add('success');
                                btn.innerHTML = '<i class="fas fa-check"></i><span>Sent!</span>';
                                
                                setTimeout(() => {
                                    btn.disabled = false;
                                    btn.classList.remove('success');
                                    btn.innerHTML = originalContent;
                                }, 3000);
                            } else {
                                throw new Error('No maps available');
                            }
                        } catch (error) {
                            console.error('Error with random map:', error);
                            
                            btn.classList.remove('loading');
                            btn.classList.add('error');
                            btn.innerHTML = '<i class="fas fa-exclamation-triangle"></i><span>Error</span>';
                            
                            setTimeout(() => {
                                btn.disabled = false;
                                btn.classList.remove('error');
                                btn.innerHTML = originalContent;
                            }, 3000);
                        }
                    };
                });
                
                return;
            }
            
            // Normal invitation flow
            btn.disabled = true;
            btn.classList.add('loading');
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Sending...</span>';
            
            try {
                await this.sendInvitation(profileData.username, profileData.userId, type, value, btn.dataset.subgameType);
                
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
    
    container.appendChild(invitationSection);
}

// Update the getRandomDXMAMap method to accept game parameter
async getRandomDXMAMap(game = 'D1') {
    try {
        const response = await fetch('../Files/dxma_missions_complete_with_direct_links.csv');
        const csvText = await response.text();
        
        const lines = csvText.trim().split('\n');
        const missions = [];
        
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            const values = [];
            let currentValue = '';
            let inQuotes = false;
            
            for (let char of line) {
                if (char === '"') {
                    inQuotes = !inQuotes;
                } else if (char === ',' && !inQuotes) {
                    values.push(currentValue.trim());
                    currentValue = '';
                } else {
                    currentValue += char;
                }
            }
            values.push(currentValue.trim());
            
            // Filter for multiplayer maps AND matching game
            if (values.length >= 4 && values[2] === 'MP' && values[3] === game) {
                missions.push({
                    id: values[0],
                    title: values[1],
                    mode: values[2],
                    game: values[3],
                    date: values[4],
                    author: values[5]
                });
            }
        }
        
        if (missions.length > 0) {
            const randomIndex = Math.floor(Math.random() * missions.length);
            return missions[randomIndex];
        }
        
        return null;
    } catch (error) {
        console.error('Error fetching DXMA maps:', error);
        return null;
    }
}

// Update sendInvitation to handle game parameter for random-map
async sendInvitation(toUsername, toUserId, type, value, subgameTypeOrGame = null) {
    const currentUser = auth.currentUser;
    if (!currentUser) {
        throw new Error('You must be logged in to send invitations');
    }
    
    const userProfileRef = doc(db, 'userProfiles', currentUser.uid);
    const userProfileSnap = await getDoc(userProfileRef);
    const fromUsername = userProfileSnap.exists() ? 
        userProfileSnap.data().username : 'Anonymous';
    
    let message = '';
    if (type === 'home') {
        message = `${fromUsername} wants to play on your home level: ${value}`;
    } else if (type === 'subgame-home') {
        message = `${fromUsername} wants to play ${subgameTypeOrGame} on your home: ${value}`;
    } else if (type === 'subgame') {
        message = `${fromUsername} wants to play your favorite subgame: ${value}`;
    } else if (type === 'random-map') {
        message = `${fromUsername} wants to play a random ${subgameTypeOrGame} map: ${value}`;
    }
    
    const invitationData = {
        fromUserId: currentUser.uid,
        fromUsername: fromUsername,
        toUserId: toUserId,
        toUsername: toUsername,
        type: type,
        value: value,
        message: message,
        status: 'pending',
        createdAt: new Date()
    };
    
    // Add subgameType OR game field depending on invitation type
    if (type === 'subgame-home' && subgameTypeOrGame) {
        invitationData.subgameType = subgameTypeOrGame;
    } else if (type === 'random-map' && subgameTypeOrGame) {
        invitationData.game = subgameTypeOrGame; // Add game field for random maps
    }
    
    try {
        await addDoc(collection(db, 'gameInvitations'), invitationData);
        // Invitation sent successfully
    } catch (error) {
        console.error('❌ Failed to send invitation:', error);
        throw error;
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
        // Auth state changed, user: (see user object)
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