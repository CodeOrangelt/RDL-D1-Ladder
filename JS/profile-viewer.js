import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    getFirestore, doc, getDoc, setDoc, collection, 
    query, where, getDocs, orderBy 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { firebaseConfig } from './firebase-config.js';

// Initialize Firebase once
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Cache for player data to reduce redundant queries
const playerDataCache = new Map();
const containerReferences = {};

class ProfileViewer {
    constructor() {
        this.currentProfileData = null;
        this.init();
    }
    
    init() {
        // Get username from URL
        const urlParams = new URLSearchParams(window.location.search);
        const username = urlParams.get('username');
        
        if (username) {
            this.loadProfile(username);
        } else {
            const container = document.querySelector('.content');
            if (container) {
                container.innerHTML = '<div class="error-message">No username specified.</div>';
            }
        }
    }
    
    async loadProfile(username) {
        try {
            // Load player data
            await this.loadPlayerData(username);
            
            // Initialize containers in the correct order
            this.createContainers(['rank-history', 'match-stats', 'player-matchups', 'match-history']);
            
            // Get matches - do this once so we don't repeat the same query
            const matches = await this.getPlayerMatches(username);
            
            // Display sections in parallel for better performance
            await Promise.all([
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
        try {
            // Check cache first
            if (playerDataCache.has(username)) {
                const cachedData = playerDataCache.get(username);
                this.displayProfile(cachedData);
                await this.loadPlayerStats(username);
                return cachedData;
            }
            
            // Get player details
            const playersRef = collection(db, 'players');
            const q = query(playersRef, where('username', '==', username));
            const querySnapshot = await getDocs(q);
            
            if (querySnapshot.empty) {
                throw new Error('Player not found');
            }
            
            const playerData = querySnapshot.docs[0].data();
            const userId = playerData.userId || querySnapshot.docs[0].id;
            
            // Get profile data from both collections in parallel
            let profileData = {};
            
            try {
                const [userProfileDoc, oldProfileDoc] = await Promise.all([
                    getDoc(doc(db, 'userProfiles', userId)),
                    getDoc(doc(db, 'profiles', userId))
                ]);
                
                if (userProfileDoc.exists()) {
                    profileData = userProfileDoc.data();
                }
                
                if (oldProfileDoc.exists()) {
                    profileData = { ...oldProfileDoc.data(), ...profileData };
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
                userId
            };
            
            // Cache for future use
            playerDataCache.set(username, data);
            
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
    
    displayProfile(data) {
        this.currentProfileData = data;
        
        // Apply ELO rating styles
        const container = document.querySelector('.profile-content');
        if (!container) return;
        
        const eloRating = parseInt(data.eloRating) || 0;
        
        // Remove existing classes
        container.classList.remove('elo-unranked', 'elo-bronze', 'elo-silver', 'elo-gold', 'elo-emerald');
        
        // Add appropriate class
        let eloClass;
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
        
        // Update profile elements - all at once to avoid layout thrashing
        const elements = {
            'nickname': data.username,
            'motto-view': data.motto || 'No motto set',
            'favorite-map-view': data.favoriteMap || 'Not set',
            'favorite-weapon-view': data.favoriteWeapon || 'Not set',
            'timezone-view': data.timezone || 'Not set',
            'division-view': data.division || 'Not set'
        };
        
        for (const [id, value] of Object.entries(elements)) {
            const element = document.getElementById(id);
            if (element) element.textContent = value;
        }
        
        // Update profile image
        const profilePreview = document.getElementById('profile-preview');
        if (profilePreview) {
            profilePreview.src = '../images/shieldorb.png';
        }
        
        // Handle edit controls visibility
        const currentUser = auth.currentUser;
        const isOwner = currentUser && currentUser.uid === data.userId;
        
        const editBtn = document.getElementById('edit-profile');
        const imageUploadControls = document.querySelector('.image-upload-controls');
        
        if (editBtn) editBtn.style.display = isOwner ? 'block' : 'none';
        if (imageUploadControls) imageUploadControls.style.display = isOwner ? 'block' : 'none';
        
        // Populate edit fields if owner
        if (isOwner) {
            const editFields = {
                'motto-edit': data.motto || '',
                'favorite-map-edit': data.favoriteMap || '',
                'favorite-weapon-edit': data.favoriteWeapon || ''
            };
            
            for (const [id, value] of Object.entries(editFields)) {
                const element = document.getElementById(id);
                if (element) element.value = value;
            }
        }
    }
    
    async getPlayerMatches(username) {
        try {
            const approvedMatchesRef = collection(db, 'approvedMatches');
            
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
        // Check cache first
        if (playerDataCache.has(username)) {
            return playerDataCache.get(username).eloRating || 0;
        }
        
        try {
            const playersRef = collection(db, 'players');
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
            
            // Fetch promotion/demotion history
            const eloHistoryRef = collection(db, 'eloHistory');
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
            this.showErrorInContainer('rank-history', 'Failed to load rank history');
        }
    }
    
    async loadPlayerStats(username) {
        if (!username) return;

        try {
            // Get player data for ELO
            const playerData = playerDataCache.has(username) ? 
                playerDataCache.get(username) : 
                await this.getPlayerData(username);
            
            // Fetch match data
            const approvedMatchesRef = collection(db, 'approvedMatches');
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
                'favorite-weapon-edit': this.currentProfileData.favoriteWeapon || ''
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
    
    async handleSubmit(event) {
        event.preventDefault();
        const user = auth.currentUser;
        
        if (!user) {
            this.showError('You must be logged in to edit your profile');
            return;
        }

        try {
            // Get form data
            const profileData = {
                motto: document.getElementById('motto-edit').value,
                favoriteMap: document.getElementById('favorite-map-edit').value,
                favoriteWeapon: document.getElementById('favorite-weapon-edit').value,
                lastUpdated: new Date().toISOString(),
                timezone: document.getElementById('timezone-edit').value,
                division: document.getElementById('division-edit').value
            };

            // Save to Firestore
            await setDoc(doc(db, 'userProfiles', user.uid), profileData, { merge: true });
            
            // Update cache
            if (user.displayName && playerDataCache.has(user.displayName)) {
                const cachedData = playerDataCache.get(user.displayName);
                playerDataCache.set(user.displayName, { ...cachedData, ...profileData });
            }
            
            // Update display
            this.toggleEditMode(false);
            this.displayProfile({
                ...this.currentProfileData,
                ...profileData,
                username: user.displayName || 'Anonymous',
                userId: user.uid
            });
        } catch (error) {
            console.error('Error saving profile:', error);
            this.showError('Failed to save profile changes');
        }
    }
    
    setupEditProfile() {
        // Get references to edit controls
        const elements = {
            'edit-profile': element => element.addEventListener('click', () => this.toggleEditMode(true)),
            'cancel-btn': element => element.addEventListener('click', () => this.toggleEditMode(false)),
            'profile-form': element => element.addEventListener('submit', e => this.handleSubmit(e))
        };
        
        // Add event listeners
        for (const [id, handler] of Object.entries(elements)) {
            const element = document.getElementById(id) || document.querySelector(`.${id}`);
            if (element) {
                // Remove old listeners by cloning
                const newElement = element.cloneNode(true);
                element.parentNode.replaceChild(newElement, element);
                handler(newElement);
            }
        }
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    new ProfileViewer();
});