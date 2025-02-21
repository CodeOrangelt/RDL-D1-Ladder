import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, collection, query, where, getDocs, orderBy } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

class ProfileViewer {
    constructor() {
        this.init();
        this.setupEventListeners();
    }

    setupEventListeners() {
        const editBtn = document.getElementById('edit-profile');
        const cancelBtn = document.querySelector('.cancel-btn');
        const profileForm = document.getElementById('profile-form');

        editBtn?.addEventListener('click', () => this.toggleEditMode(true));
        cancelBtn?.addEventListener('click', () => this.toggleEditMode(false));
        profileForm?.addEventListener('submit', (e) => this.handleSubmit(e));
    }

    async init() {
        try {
            console.log('Starting profile initialization...');
            const urlParams = new URLSearchParams(window.location.search);
            let username = urlParams.get('username');
            console.log('URL username parameter:', username);

            if (!username) {
                username = localStorage.getItem('nickname');
                console.log('Using nickname from localStorage:', username);
            }

            if (!username) {
                console.log('No username found');
                this.showError('Profile not found - No username provided');
                return;
            }

            // Load player stats first
            await this.loadPlayerStats(username);

            if (!username) {
                const currentUser = auth.currentUser;
                console.log('No username in URL, checking current user:', currentUser);
                
                if (currentUser) {
                    // Get current user's profile
                    console.log('Getting current user document for ID:', currentUser.uid);
                    const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
                    if (userDoc.exists()) {
                        console.log('User document found:', userDoc.data());
                        username = userDoc.data().username;
                    } else {
                        console.log('No user document found for current user');
                    }
                } else {
                    console.log('No current user and no username provided');
                    this.showError('Profile not found - No username provided');
                    return;
                }
            }

            // Query players collection by username
            console.log('Querying players collection for username:', username);
            const playersRef = collection(db, 'players');
            const q = query(playersRef, where('username', '==', username));
            const playerSnapshot = await getDocs(q);

            console.log('Player query results:', {
                empty: playerSnapshot.empty,
                size: playerSnapshot.size
            });

            if (playerSnapshot.empty) {
                console.log('No player found with username:', username);
                this.showError('User not found');
                return;
            }

            // Get the player document
            const playerDoc = playerSnapshot.docs[0];
            const userId = playerDoc.id;
            const playerData = playerDoc.data();
            console.log('Player data found:', {
                userId: userId,
                playerData: playerData
            });

            // Get profile data
            console.log('Fetching profile data for userId:', userId);
            const profileDoc = await getDoc(doc(db, 'userProfiles', userId));
            const profileData = profileDoc.exists() ? profileDoc.data() : {};
            console.log('Profile data:', profileData);

            // Display the combined profile data
            const combinedData = {
                ...profileData,
                ...playerData,
                username: playerData.username,
                userId: userId
            };
            console.log('Combined profile data:', combinedData);
            this.displayProfile(combinedData);
            
            // Call displayMatchHistory only once
            await this.displayMatchHistory(username);

            // Show edit controls if viewing own profile
            const currentUser = auth.currentUser;
            console.log('Checking edit permissions:', {
                currentUser: currentUser?.uid,
                profileUserId: userId,
                canEdit: currentUser && currentUser.uid === userId
            });

            if (currentUser && currentUser.uid === userId) {
                document.getElementById('edit-profile').style.display = 'block';
                const uploadBtn = document.querySelector('.upload-btn');
                if (uploadBtn) uploadBtn.style.display = 'inline-block';
            }

        } catch (error) {
            console.error('Profile initialization error:', error);
            console.error('Error stack:', error.stack);
            this.showError(`Error loading profile: ${error.message}`);
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
            const profileData = {
                motto: document.getElementById('motto-edit').value,
                favoriteMap: document.getElementById('favorite-map-edit').value,
                favoriteWeapon: document.getElementById('favorite-weapon-edit').value,
                lastUpdated: new Date().toISOString()
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

        // Always use default profile picture
        const profilePreview = document.getElementById('profile-preview');
        if (profilePreview) {
            profilePreview.src = 'images/shieldorb.png';
        }

        // ...existing code...
        document.getElementById('nickname').textContent = data.username;
        document.getElementById('motto-view').textContent = data.motto || 'No motto set';
        // ...rest of the display logic...

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

    async displayMatchHistory(username) {
        try {
            // Create containers first
            const matchHistoryContainer = document.createElement('div');
            matchHistoryContainer.className = 'match-history-container';
            
            // Add loading state
            matchHistoryContainer.innerHTML = '<p class="loading-text">Loading match history...</p>';
            const profileContainer = document.querySelector('.profile-container');
            profileContainer.parentNode.insertBefore(matchHistoryContainer, profileContainer.nextSibling);

            // Fetch matches
            const approvedMatchesRef = collection(db, 'approvedMatches');
            const matchesQuery = query(
                approvedMatchesRef,
                where('winnerUsername', '==', username),
                orderBy('createdAt', 'desc')
            );

            const loserMatchesQuery = query(
                approvedMatchesRef,
                where('loserUsername', '==', username),
                orderBy('createdAt', 'desc')
            );

            // Get both winner and loser matches
            const [winnerMatches, loserMatches] = await Promise.all([
                getDocs(matchesQuery),
                getDocs(loserMatchesQuery)
            ]);

            // Combine and sort matches
            const matches = [...winnerMatches.docs, ...loserMatches.docs]
                .map(doc => ({
                    ...doc.data(),
                    id: doc.id
                }))
                .sort((a, b) => b.createdAt.seconds - a.createdAt.seconds);

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

            // After matches are loaded, display statistics
            if (matches.length > 0) {
                await this.displayMatchStats(username, matches);
                await this.displayPlayerMatchups(username, matches);
            }

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
        // Create container first
        const statsContainer = document.createElement('div');
        statsContainer.className = 'match-history-container';
        
        // Get current season number
        const seasonCountDoc = await getDoc(doc(db, 'metadata', 'seasonCount'));
        const currentSeason = seasonCountDoc.exists() ? seasonCountDoc.data().count : 1;
        
        // Insert container into DOM before adding content
        const profileContainer = document.querySelector('.profile-container');
        if (profileContainer) {
            profileContainer.parentNode.insertBefore(statsContainer, profileContainer.nextSibling);
        }
        
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
        }
    }

    async displayPlayerMatchups(username, matches) {
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

        // Create and insert container
        const matchupsContainer = document.createElement('div');
        matchupsContainer.className = 'match-history-container';
        
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

        // Insert after stats container
        const statsContainer = document.querySelector('.match-history-container');
        if (statsContainer) {
            statsContainer.parentNode.insertBefore(matchupsContainer, statsContainer.nextSibling);
        }
    }

    // Helper method to get player data
    async getPlayerData(username) {
        const playersRef = collection(db, 'players');
        const q = query(playersRef, where('username', '==', username));
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs[0]?.data();
    }

    async loadPlayerStats(username) {
        if (!username) return;
    
        try {
            console.log('Loading stats for user:', username);
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
    
            // Update stats display
            const elements = {
                'stats-matches': stats.totalMatches,
                'stats-wins': stats.wins,
                'stats-losses': stats.losses,
                'stats-kda': stats.kda,
                'stats-winrate': `${stats.winRate}%`
            };

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
            'stats-kda': '0.00',
            'stats-winrate': '0%'
        };

        for (const [id, value] of Object.entries(defaultStats)) {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = value;
            }
        }
    }
}

// Remove the separate DOMContentLoaded event listener
// since we're handling initialization in the constructor
new ProfileViewer();