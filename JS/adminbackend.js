import { 
    collection, getDocs, query, orderBy, addDoc, deleteDoc, where, doc, getDoc,
    serverTimestamp, setDoc, updateDoc, writeBatch, limit, startAfter, endBefore,
    limitToLast, onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { auth, db } from './firebase-config.js';
import { getRankStyle } from './ranks.js';
import { isAdmin } from './admin-check.js';

// Initialize charts container
const charts = {};
let currentLadder = 'D1'; // Default ladder mode
let eloHistoryPagination = { d1: { page: 1, lastVisible: null, firstVisible: null }, d2: { page: 1, lastVisible: null, firstVisible: null } };
const PAGE_SIZE = 15; // Items per page for history tables

document.addEventListener('DOMContentLoaded', () => {
    auth.onAuthStateChanged(async (user) => {
        if (!user) {
            window.location.href = 'login.html';
            return;
        }
        
        if (isAdmin(user.email)) {
            initializeAdminDashboard();
        } else {
            window.location.href = 'index.html';
        }
    });
});

function initializeAdminDashboard() {
    // Initialize sidebar navigation
    setupSidebarNavigation();
    
    // Initialize ladder selector
    setupLadderSelector();
    
    // Initialize dashboard overview
    loadDashboardOverview();
    
    // Initialize player management
    setupManagePlayersSection();
    
    // Initialize elo history
    setupEloHistorySection();
    
    // Initialize promote/demote controls
    setupRankControls();
}

function setupSidebarNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const sections = document.querySelectorAll('.admin-section');
    
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            // Update active nav item
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            
            // Show selected section, hide others
            const targetSection = item.dataset.section;
            sections.forEach(section => {
                section.style.display = section.id === targetSection ? 'block' : 'none';
            });
            
            // Load section data if needed
            loadSectionData(targetSection);
        });
    });
}

function setupLadderSelector() {
    const ladderSwitches = document.querySelectorAll('.ladder-switch input');
    
    ladderSwitches.forEach(switchInput => {
        switchInput.addEventListener('change', () => {
            currentLadder = switchInput.value;
            document.body.setAttribute('data-ladder', currentLadder);
            
            // Refresh active section data
            const activeSection = document.querySelector('.admin-section[style="display: block;"]');
            if (activeSection) {
                loadSectionData(activeSection.id);
            }
        });
    });
}

function loadSectionData(sectionId) {
    switch(sectionId) {
        case 'dashboard':
            loadDashboardOverview();
            break;
        case 'players':
            loadPlayersData();
            break;
        case 'elo-history':
            loadEloHistory();
            break;
        case 'manage-ranks':
            // Nothing to preload
            break;
    }
}

async function loadDashboardOverview() {
    try {
        // Show loading states
        document.querySelectorAll('.stat-card .stat-value').forEach(el => {
            el.innerHTML = '<span class="loading-spinner"></span>';
        });

        // Get collection names based on current ladder
        const playerCollection = currentLadder === 'D1' ? 'players' : 'playersD2';
        const matchesCollection = currentLadder === 'D1' ? 'approvedMatches' : 'approvedMatchesD2';
        
        // Get player count
        const playersSnapshot = await getDocs(collection(db, playerCollection));
        const playerCount = playersSnapshot.size;
        
        // Get match count
        const matchesSnapshot = await getDocs(collection(db, matchesCollection));
        const matchCount = matchesSnapshot.size;
        
        // Get pending matches count
        const pendingCollection = currentLadder === 'D1' ? 'pendingMatches' : 'pendingMatchesD2';
        const pendingSnapshot = await getDocs(collection(db, pendingCollection));
        const pendingCount = pendingSnapshot.size;
        
        // Get rejected matches count
        const rejectedCollection = currentLadder === 'D1' ? 'RejectedD1' : 'RejectedD2';
        const rejectedSnapshot = await getDocs(collection(db, rejectedCollection));
        const rejectedCount = rejectedSnapshot.size;
        
        // Update stat cards
        document.getElementById('player-count').textContent = playerCount;
        document.getElementById('match-count').textContent = matchCount;
        document.getElementById('pending-count').textContent = pendingCount;
        document.getElementById('rejected-count').textContent = rejectedCount;
        
        // Create dashboard charts
        createRankDistributionChart();
        createActivityChart();
        
    } catch (error) {
        console.error("Error loading dashboard data:", error);
        showNotification('Failed to load dashboard overview', 'error');
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
            
            row.innerHTML = `
                <td class="timestamp">${timestamp}</td>
                <td class="player">${history.player || 'N/A'}</td>
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
        if (row.classList.contains('loading-cell') || row.classList.contains('empty-state') || row.classList.contains('error-state')) {
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
            
            row.innerHTML = `
                <td class="timestamp">${timestamp}</td>
                <td class="player">${history.player || 'N/A'}</td>
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

        console.log(`Promoting player to ${nextThreshold.name} (${nextThreshold.elo} ELO)`);
        
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

        // Show success message
        alert(`Successfully promoted ${username} to ${nextThreshold.name} (${nextThreshold.elo} ELO)`);
        
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

        console.log(`Demoting player to ${prevThreshold.name} (${prevThreshold.elo} ELO)`);
        
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

        // Show success message
        alert(`Successfully demoted ${username} to ${prevThreshold.name} (${prevThreshold.elo} ELO)`);
        
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
        const playersRef = collection(db, collectionName);
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

export { promotePlayer, demotePlayer };