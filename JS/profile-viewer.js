import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, collection, query, where, getDocs, orderBy } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

class ProfileViewer {
    // Fix the constructor to properly get the username from URL
    constructor() {
        // Get username from URL
        const urlParams = new URLSearchParams(window.location.search);
        const username = urlParams.get('username');
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Initialize with username if available
        if (username) {
            this.init(username);
        } else {
            // Display message if no username is provided
            const container = document.querySelector('.content');
            if (container) {
                container.innerHTML = '<div class="error-message">No username specified.</div>';
            }
        }
    }

    setupEventListeners() {
        const editBtn = document.getElementById('edit-profile');
        const cancelBtn = document.querySelector('.cancel-btn');
        const profileForm = document.getElementById('profile-form');

        editBtn?.addEventListener('click', () => this.toggleEditMode(true));
        cancelBtn?.addEventListener('click', () => this.toggleEditMode(false));
        profileForm?.addEventListener('submit', (e) => this.handleSubmit(e));
    }

    // Fix the init method to properly load and display data
    async init(username) {
        if (!username) return;
        
        try {
            // Load player data first
            await this.loadPlayerData(username);
            
            // Get matches for this player
            const matches = await this.getPlayerMatches(username);
            console.log('Retrieved matches:', matches.length); // Debug output
            
            // Create all containers FIRST to ensure proper DOM structure
            const mainContainer = document.querySelector('.content');
            
            // Create all containers with loading states
            this.createContainers(['rank-history', 'match-stats', 'player-matchups', 'match-history']);
            
            // Now populate them with data - they already exist in the DOM
            await this.displayPromotionHistory(username); 
            await this.displayMatchStats(username, matches);
            await this.displayPlayerMatchups(username, matches);
            await this.displayMatchHistory(username, matches);
            
            // Initialize other profile functionality
            this.setupEditProfile();
            
        } catch (error) {
            console.error('Error initializing profile:', error);
        }
    }

    // Fix the createContainers method
    createContainers(sections) {
        const contentContainer = document.querySelector('.content');
        if (!contentContainer) return;
        
        // Find the profile container
        const profileContainer = document.querySelector('.profile-container');
        if (!profileContainer) return;
        
        // Clear any existing containers first
        document.querySelectorAll('.match-history-container').forEach(el => el.remove());
        
        // Insert all containers after the profile container in the specified order
        let previousContainer = profileContainer;
        
        sections.forEach(section => {
            const container = document.createElement('div');
            container.className = `match-history-container ${section}-container`;
            container.innerHTML = '<p class="loading-text">Loading data...</p>';
            
            // Always insert after the previous container
            contentContainer.insertBefore(container, previousContainer.nextSibling);
            previousContainer = container;
        });
    }

    async handleSubmit(event) {
        event.preventDefault();
        const user = auth.currentUser;
        
        if (!user) {
            this.showError('You must be logged in to edit your profile');
            return;
        }

        try {
            const profileData = {
                motto: document.getElementById('motto-edit').value,
                favoriteMap: document.getElementById('favorite-map-edit').value,
                favoriteWeapon: document.getElementById('favorite-weapon-edit').value,
                lastUpdated: new Date().toISOString(),
                timezone: document.getElementById('timezone-edit').value,
                division: document.getElementById('division-edit').value
            };

            // Save to userProfiles collection
            await setDoc(doc(db, 'userProfiles', user.uid), profileData, { merge: true });
            
            this.toggleEditMode(false);
            this.displayProfile({
                ...profileData,
                username: user.displayName || 'Anonymous',
                userId: user.uid
            });

        } catch (error) {
            console.error('Error saving profile:', error);
            this.showError('Failed to save profile changes');
        }
    }

    // Also modify the displayProfile method to store the data
    displayProfile(data) {
        this.currentProfileData = data;
        
        // Set ELO rating class
        const container = document.querySelector('.profile-content');
        const eloRating = data.eloRating || 0;
        
        // Remove any existing elo classes
        container.classList.remove('elo-unranked', 'elo-bronze', 'elo-silver', 'elo-gold', 'elo-emerald');
        
        // Add appropriate elo class based on rating
        if (eloRating >= 2000) {
            container.classList.add('elo-emerald');
        } else if (eloRating >= 1800) {
            container.classList.add('elo-gold');
        } else if (eloRating >= 1600) {
            container.classList.add('elo-silver');
        } else if (eloRating >= 1400) {
            container.classList.add('elo-bronze');
        } else {
            container.classList.add('elo-unranked');
        }

        // Update all profile fields
        document.getElementById('nickname').textContent = data.username;
        document.getElementById('motto-view').textContent = data.motto || 'No motto set';
        document.getElementById('favorite-map-view').textContent = data.favoriteMap || 'Not set';
        document.getElementById('favorite-weapon-view').textContent = data.favoriteWeapon || 'Not set';
        document.getElementById('timezone-view').textContent = data.timezone || 'Not set';
        document.getElementById('division-view').textContent = data.division || 'Not set';

        // Update profile image
        const profilePreview = document.getElementById('profile-preview');
        if (profilePreview) {
            profilePreview.src = '../images/shieldorb.png'; // Fixed path
            // If you want to keep using shieldorb.png:
            // profilePreview.src = '../images/shieldorb.png';
        }

        // Check if current user is the profile owner
        const currentUser = auth.currentUser;
        const isOwner = currentUser && currentUser.uid === data.userId;

        // Show/hide edit controls based on ownership
        const editBtn = document.getElementById('edit-profile');
        const imageUploadControls = document.querySelector('.image-upload-controls');
        
        if (editBtn) editBtn.style.display = isOwner ? 'block' : 'none';
        if (imageUploadControls) imageUploadControls.style.display = isOwner ? 'block' : 'none';

        // Only populate edit fields if user is the owner
        if (isOwner) {
            const mottoEdit = document.getElementById('motto-edit');
            const mapEdit = document.getElementById('favorite-map-edit');
            const weaponEdit = document.getElementById('favorite-weapon-edit');

            if (mottoEdit) mottoEdit.value = data.motto || '';
            if (mapEdit) mapEdit.value = data.favoriteMap || '';
            if (weaponEdit) weaponEdit.value = data.favoriteWeapon || '';
        }
    }

    // Modify the toggleEditMode method to populate form fields
    toggleEditMode(isEditing) {
        const viewMode = document.querySelector('.view-mode');
        const editMode = document.querySelector('.edit-mode');
        
        if (isEditing && this.currentProfileData) {
            // Populate edit fields
            document.getElementById('motto-edit').value = this.currentProfileData.motto || '';
            document.getElementById('favorite-map-edit').value = this.currentProfileData.favoriteMap || '';
            document.getElementById('favorite-weapon-edit').value = this.currentProfileData.favoriteWeapon || '';
            
            viewMode.style.display = 'none';
            editMode.style.display = 'block';
        } else {
            viewMode.style.display = 'block';
            editMode.style.display = 'none';
        }
    }

    showError(message) {
        const container = document.querySelector('.profile-content');
        container.innerHTML = `<div class="error-message" style="color: white; text-align: center; padding: 20px;">${message}</div>`;
    }

    async displayMatchHistory(username, matches) {
        try {
            // Use existing container
            const matchHistoryContainer = document.querySelector('.match-history-container');
            if (!matchHistoryContainer) return;

            // Get ELO ratings for all players
            const playerElos = {};
            for (const match of matches) {
                if (!playerElos[match.winnerUsername]) {
                    const playerDoc = await this.getPlayerData(match.winnerUsername);
                    playerElos[match.winnerUsername] = playerDoc?.eloRating || 0;
                }
                if (!playerElos[match.loserUsername]) {
                    const playerDoc = await this.getPlayerData(match.loserUsername);
                    playerElos[match.loserUsername] = playerDoc?.eloRating || 0;
                }
            }

            // Helper function for ELO class
            const getEloClass = (elo) => {
                if (elo >= 2000) return 'elo-emerald';
                if (elo >= 1800) return 'elo-gold';
                if (elo >= 1600) return 'elo-silver';
                if (elo >= 1400) return 'elo-bronze';
                return 'elo-unranked';
            };

            // Update match history display
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
            console.error('Error loading match history:', error);
            const matchHistoryContainer = document.querySelector('.match-history-container');
            if (matchHistoryContainer) {
                matchHistoryContainer.innerHTML = `
                    <div class="error-message">
                        Error loading match history. Please try refreshing the page.
                        ${error.message}
                    </div>
                `;
            }
        }
    }

    async displayMatchStats(username, matches) {
        // Use existing container 
        const statsContainer = document.querySelector('.match-stats-container');
        if (!statsContainer) return;
        
        // Get current season number
        const seasonCountDoc = await getDoc(doc(db, 'metadata', 'seasonCount'));
        const currentSeason = seasonCountDoc.exists() ? seasonCountDoc.data().count : 1;
        
        statsContainer.innerHTML = `
            <div class="season-label">S${currentSeason}</div>
            <h2>Match Statistics</h2>
            <div class="stats-content">
                <canvas id="eloChart"></canvas>
            </div>
        `;

        // Process match data after container is in DOM
        const matchData = matches.map(match => ({
            date: new Date(match.createdAt.seconds * 1000),
            isWinner: match.winnerUsername === username,
            score: match.winnerUsername === username ? match.winnerScore : match.loserScore
        })).sort((a, b) => a.date - b.date);

        // Get context after canvas is in DOM
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
                                labels: {
                                    color: 'white'
                                }
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                grid: {
                                    color: 'rgba(255, 255, 255, 0.1)'
                                },
                                ticks: {
                                    color: 'white'
                                }
                            },
                            x: {
                                grid: {
                                    color: 'rgba(255, 255, 255, 0.1)'
                                },
                                ticks: {
                                    color: 'white'
                                }
                            }
                        }
                    }
                });
            } catch (error) {
                console.error('Error creating chart:', error);
                statsContainer.innerHTML += '<p class="error-message">Error displaying chart</p>';
            }
        }
    }

    async displayPlayerMatchups(username, matches) {
        // Use existing container 
        const matchupsContainer = document.querySelector('.player-matchups-container');
        if (!matchupsContainer) return;

        // Get matchups data first
        const matchups = matches.reduce((acc, match) => {
            const opponent = match.winnerUsername === username ? match.loserUsername : match.winnerUsername;
            const isWin = match.winnerUsername === username;
            
            if (!acc[opponent]) {
                acc[opponent] = { wins: 0, losses: 0, total: 0 };
            }
            
            acc[opponent].total++;
            if (isWin) {
                acc[opponent].wins++;
            } else {
                acc[opponent].losses++;
            }
            
            return acc;
        }, {});

        // Sort matchups
        const sortedMatchups = Object.entries(matchups)
            .sort((a, b) => b[1].total - a[1].total);

        // Get current season number
        const seasonCountDoc = await getDoc(doc(db, 'metadata', 'seasonCount'));
        const currentSeason = seasonCountDoc.exists() ? seasonCountDoc.data().count : 1;

        // Generate HTML with sorted matchups
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
                    ${sortedMatchups.map(([opponent, stats]) => {
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
                    }).join('')}
                </tbody>
            </table>
        `;
    }

    // Helper method to get player data
    async getPlayerData(username) {
        const playersRef = collection(db, 'players');
        const q = query(playersRef, where('username', '==', username));
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs[0]?.data();
    }

    // Fix the getPlayerMatches method
    async getPlayerMatches(username) {
        try {
            console.log('Fetching matches for:', username);
            
            const approvedMatchesRef = collection(db, 'approvedMatches');
            
            // Use separate queries instead of compound query with array-contains + orderBy
            const legacyQuery1 = query(
                approvedMatchesRef,
                where('winnerUsername', '==', username),
                orderBy('createdAt', 'desc')
            );
            
            const legacyQuery2 = query(
                approvedMatchesRef,
                where('loserUsername', '==', username),
                orderBy('createdAt', 'desc')
            );
            
            const [legacySnapshot1, legacySnapshot2] = await Promise.all([
                getDocs(legacyQuery1),
                getDocs(legacyQuery2)
            ]);
            
            console.log('Match counts:', {
                winnerMatches: legacySnapshot1.size,
                loserMatches: legacySnapshot2.size
            });
            
            // Combine results, removing duplicates
            const matchIds = new Set();
            const matches = [];
            
            const processSnapshot = (snapshot) => {
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
            
            processSnapshot(legacySnapshot1);
            processSnapshot(legacySnapshot2);
            
            // Sort by date descending
            return matches.sort((a, b) => 
                (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)
            );
        } catch (error) {
            console.error('Error getting player matches:', error);
            return [];
        }
    }

    async loadPlayerStats(username) {
        if (!username) return;

        try {
            console.log('Loading stats for user:', username);
            
            // First get the player data to access ELO rating
            const playersRef = collection(db, 'players');
            const playerQuery = query(playersRef, where('username', '==', username));
            const playerSnapshot = await getDocs(playerQuery);
            const playerData = playerSnapshot.docs[0]?.data() || {};
            
            // Get match data
            const approvedMatchesRef = collection(db, 'approvedMatches');
            const [winnerMatches, loserMatches] = await Promise.all([
                getDocs(query(approvedMatchesRef, where('winnerUsername', '==', username))),
                getDocs(query(approvedMatchesRef, where('loserUsername', '==', username)))
            ]);

            console.log('Matches found:', {
                winnerMatches: winnerMatches.size,
                loserMatches: loserMatches.size
            });

            let stats = {
                wins: winnerMatches.size,
                losses: loserMatches.size,
                totalKills: 0,
                totalDeaths: 0,
                totalMatches: winnerMatches.size + loserMatches.size,
                kda: 0,
                winRate: 0
            };
    
            // Calculate kills and deaths
            winnerMatches.forEach(doc => {
                const match = doc.data();
                stats.totalKills += parseInt(match.winnerScore) || 0;
                stats.totalDeaths += parseInt(match.loserScore) || 0;
            });
    
            loserMatches.forEach(doc => {
                const match = doc.data();
                stats.totalKills += parseInt(match.loserScore) || 0;
                stats.totalDeaths += parseInt(match.winnerScore) || 0;
            });
    
            console.log('Calculated stats:', stats);

            // Calculate KDA and win rate
            stats.kda = stats.totalDeaths > 0 ? 
                (stats.totalKills / stats.totalDeaths).toFixed(2) : 
                stats.totalKills.toFixed(2);
    
            stats.winRate = stats.totalMatches > 0 ? 
                ((stats.wins / stats.totalMatches) * 100).toFixed(1) : 0;
    
            // Update elements object to include ELO
            const elements = {
                'stats-matches': stats.totalMatches,
                'stats-wins': stats.wins,
                'stats-losses': stats.losses,
                'stats-kd': stats.kda,
                'stats-winrate': `${stats.winRate}%`,
                'stats-elo': playerData.eloRating || 'N/A'  // Add ELO rating
            };
            
            // Update the UI
            for (const [id, value] of Object.entries(elements)) {
                const element = document.getElementById(id);
                if (element) {
                    element.textContent = value;
                    console.log(`Updated ${id} with value:`, value);
                } else {
                    console.warn(`Element with id ${id} not found`);
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
            'stats-kd': '0.00',  // Changed from stats-kda to stats-kd
            'stats-winrate': '0%'
        };

        for (const [id, value] of Object.entries(defaultStats)) {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = value;
            }
        }
    }

    async displayPromotionHistory(username) {
        try {
            // Use correct container selector with both classes
            const promotionContainer = document.querySelector('.match-history-container.rank-history-container');
            if (!promotionContainer) {
                console.error('Promotion history container not found');
                return;
            }
            
            // Add loading state
            promotionContainer.innerHTML = '<p class="loading-text">Loading promotion history...</p>';

            // Fetch promotion history
            const eloHistoryRef = collection(db, 'eloHistory');
            const q = query(
                eloHistoryRef,
                where('player', '==', username),
                where('type', 'in', ['promotion', 'demotion']),
                orderBy('timestamp', 'desc')
            );
            
            const snapshot = await getDocs(q);
            
            // Check if we have any promotion records
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
            
            // Get current season number
            const seasonCountDoc = await getDoc(doc(db, 'metadata', 'seasonCount'));
            const currentSeason = seasonCountDoc.exists() ? seasonCountDoc.data().count : 1;
            
            // Build the HTML
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
                    <tbody>
                        ${promotionRecords.map(record => {
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
                </table>
            `;
            
            // Add CSS styles for the new elements
            const styleEl = document.createElement('style');
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
                    font-size: 0.85em; // Add this line to make the font smaller
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
            `;
            document.head.appendChild(styleEl);
            
        } catch (error) {
            console.error('Error loading promotion history:', error);
            const container = document.querySelector('.promotion-history-container');
            if (container) {
                container.innerHTML = `
                    <h2>Rank History</h2>
                    <div class="error-message">
                        Error loading promotion history. Please try refreshing the page.
                    </div>
                `;
            }
        }
    }

    // Add this method if it's missing
    async loadPlayerData(username) {
        try {
            // Get player details from players collection
            const playersRef = collection(db, 'players');
            const q = query(playersRef, where('username', '==', username));
            const querySnapshot = await getDocs(q);
            
            if (querySnapshot.empty) {
                throw new Error('Player not found');
            }
            
            const playerData = querySnapshot.docs[0].data();
            const userId = playerData.userId || querySnapshot.docs[0].id;
            
            // Try to get profile data from both collections
            let profileData = {};
            
            // First try userProfiles collection
            const userProfileRef = doc(db, 'userProfiles', userId);
            const userProfileDoc = await getDoc(userProfileRef);
            if (userProfileDoc.exists()) {
                profileData = userProfileDoc.data();
            }
            
            // Also try the profiles collection used by profile.js
            const oldProfileRef = doc(db, 'profiles', userId);
            const oldProfileDoc = await getDoc(oldProfileRef);
            if (oldProfileDoc.exists()) {
                // Merge data, preferring newer data
                profileData = { ...oldProfileDoc.data(), ...profileData };
            }
            
            // Combine all data
            const data = {
                ...playerData,
                ...profileData,
                username: username,
                userId: userId
            };
            
            // Display the profile data
            this.displayProfile(data);
            
            // Load stats
            await this.loadPlayerStats(username);
            
            return data;
        } catch (error) {
            console.error('Error loading player data:', error);
            this.showError(`Error: ${error.message}`);
            return null;
        }
    }

    // Add this method to the ProfileViewer class
    setupEditProfile() {
        // Get edit controls
        const editBtn = document.getElementById('edit-profile');
        const cancelBtn = document.querySelector('.cancel-btn');
        const profileForm = document.getElementById('profile-form');

        // Remove any existing event listeners
        if (editBtn) {
            const newEditBtn = editBtn.cloneNode(true);
            editBtn.parentNode.replaceChild(newEditBtn, editBtn);
            newEditBtn.addEventListener('click', () => this.toggleEditMode(true));
        }

        if (cancelBtn) {
            const newCancelBtn = cancelBtn.cloneNode(true);
            cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
            newCancelBtn.addEventListener('click', () => this.toggleEditMode(false));
        }

        if (profileForm) {
            const newProfileForm = profileForm.cloneNode(true);
            profileForm.parentNode.replaceChild(newProfileForm, profileForm);
            newProfileForm.addEventListener('submit', (e) => this.handleSubmit(e));
        }
    }
}

// Remove the separate DOMContentLoaded event listener
// since we're handling initialization in the constructor
new ProfileViewer();