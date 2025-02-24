import { db, auth } from './firebase-config.js';
import { 
    collection, 
    query, 
    orderBy, 
    getDocs, 
    doc, 
    getDoc,
    enableIndexedDbPersistence 
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { getRankStyle } from './ranks.js';

// Enable offline persistence
enableIndexedDbPersistence(db).catch((err) => {
    if (err.code == 'failed-precondition') {
        console.warn('Multiple tabs open, persistence can only be enabled in one tab at a time.');
    } else if (err.code == 'unimplemented') {
        console.warn('The current browser does not support persistence.');
    }
});

// Initialize data loading state
let isLoadingData = false;

document.addEventListener('DOMContentLoaded', () => {
    auth.onAuthStateChanged(async user => {
        if (user) {
            await initializeDataLoading();
        } else {
            console.log('User not authenticated');
            // Optionally redirect to login page
            // window.location.href = 'login.html';
        }
    });
});

async function initializeDataLoading() {
    if (isLoadingData) return;
    isLoadingData = true;

    try {
        setupStatsButton();
        setupSeasonButton('season0');
        await loadInitialData();
    } catch (error) {
        console.error('Error initializing data:', error);
    } finally {
        isLoadingData = false;
    }
}

async function loadInitialData() {
    // Pre-fetch initial data
    const seasonRef = collection(db, 'season0');
    const q = query(seasonRef, orderBy('eloRating', 'desc'));
    await getDocs(q);
}

function setupSeasonButton(seasonId) {
    const button = document.getElementById(`${seasonId}-btn`);
    const ladder = document.getElementById(`${seasonId}-ladder`);
    
    if (!button || !ladder) {
        console.error(`Missing elements for ${seasonId}`);
        return;
    }

    button.addEventListener('click', () => {
        const isHidden = ladder.style.display === 'none' || !ladder.style.display;
        ladder.style.display = isHidden ? 'block' : 'none';
        
        if (isHidden) {
            loadSeasonLadder(seasonId);
        }
    });
}

function setupStatsButton() {
    const statsBtn = document.getElementById('season0-stats-btn');
    const statsSection = document.getElementById('season0-stats');
    
    if (!statsBtn || !statsSection) {
        console.error('Missing stats elements');
        return;
    }

    statsBtn.addEventListener('click', () => {
        const isHidden = statsSection.style.display === 'none' || !statsSection.style.display;
        statsSection.style.display = isHidden ? 'block' : 'none';
        
        if (isHidden) {
            loadSeasonStats();
        }
    });
}

async function loadSeasonLadder(seasonId) {
    try {
        const seasonRef = collection(db, seasonId);
        const q = query(seasonRef, orderBy('eloRating', 'desc'));
        const snapshot = await getDocs(q);

        const tbody = document.querySelector(`#${seasonId}-table tbody`);
        tbody.innerHTML = '';

        let position = 1;
        snapshot.forEach((doc) => {
            const data = doc.data();
            const tr = document.createElement('tr');
            
            const rankStyle = getRankStyle(data.eloRating);
            tr.style.backgroundColor = rankStyle.backgroundColor;
            tr.style.color = rankStyle.color;

            tr.innerHTML = `
                <td>${position}</td>
                <td>${data.username || 'Unknown'}</td>
                <td>${Math.round(data.eloRating)}</td>
            `;
            tbody.appendChild(tr);
            position++;
        });
    } catch (error) {
        console.error(`Error loading ${seasonId} ladder:`, error);
    }
}

async function loadSeasonStats() {
    try {
        const statsRef = doc(db, 'season0records', 'snapshot');
        const statsDoc = await getDoc(statsRef);
        
        if (!statsDoc.exists()) {
            console.log('No stats found for season 0');
            document.getElementById('season0-stats').innerHTML = '<p>No statistics available for this season.</p>';
            return;
        }

        const records = statsDoc.data().records;
        const recordStats = calculateRecordStats(records);
        displayRecordStats(recordStats);
        displayDetailedStats(records);
    } catch (error) {
        console.error('Error loading season stats:', error);
        document.getElementById('season0-stats').innerHTML = '<p class="error-message">Error loading statistics. Please try again later.</p>';
    }
}

function calculateRecordStats(records) {
    let stats = {
        mostWins: { player: 'None', value: 0 },
        bestWinRate: { player: 'None', value: 0 },
        bestKDRatio: { player: 'None', value: 0 },
        longestTopStreak: { player: 'None', value: 0 },
        mostMatches: { player: 'None', value: 0 },
        bestScoreDiff: { player: 'None', value: 0 },
        mostLosses: { player: 'None', value: 0 },
        leastSuicides: { player: 'None', value: Number.MAX_VALUE },
        leastLosses: { player: 'None', value: Number.MAX_VALUE }
    };

    records.forEach(record => {
        const totalMatches = (record.wins || 0) + (record.losses || 0);
        const winRate = totalMatches > 0 ? (record.wins / totalMatches) * 100 : 0;
        const scoreDiff = (record.scoreFor || 0) - (record.scoreAgainst || 0);

        // Update records
        if (record.wins > stats.mostWins.value) {
            stats.mostWins = { player: record.username, value: record.wins };
        }
        
        if (winRate > stats.bestWinRate.value && totalMatches >= 5) {
            stats.bestWinRate = { player: record.username, value: winRate };
        }

        if (totalMatches > stats.mostMatches.value) {
            stats.mostMatches = { player: record.username, value: totalMatches };
        }

        if (scoreDiff > stats.bestScoreDiff.value) {
            stats.bestScoreDiff = { player: record.username, value: scoreDiff };
        }

        if (record.losses > stats.mostLosses.value) {
            stats.mostLosses = { player: record.username, value: record.losses };
        }

        if (record.losses < stats.leastLosses.value && totalMatches >= 5) {
            stats.leastLosses = { player: record.username, value: record.losses };
        }
    });

    return stats;
}

function displayRecordStats(stats) {
    const statsContainer = document.getElementById('season0-stats');
    statsContainer.innerHTML = `
        <div class="records-container">
            <h3>Season Records</h3>
            <div class="record-grid">
                <div class="record-item">
                    <span class="record-title">Most Wins</span>
                    <span class="record-player">${stats.mostWins.player}</span>
                    <span class="record-value">${stats.mostWins.value}</span>
                </div>
                <div class="record-item">
                    <span class="record-title">Best Win Rate</span>
                    <span class="record-player">${stats.bestWinRate.player}</span>
                    <span class="record-value">${stats.bestWinRate.value.toFixed(1)}%</span>
                </div>
                <div class="record-item">
                    <span class="record-title">Most Matches</span>
                    <span class="record-player">${stats.mostMatches.player}</span>
                    <span class="record-value">${stats.mostMatches.value}</span>
                </div>
                <div class="record-item">
                    <span class="record-title">Best Score Differential</span>
                    <span class="record-player">${stats.bestScoreDiff.player}</span>
                    <span class="record-value">${stats.bestScoreDiff.value}</span>
                </div>
                <div class="record-item">
                    <span class="record-title">Most Losses</span>
                    <span class="record-player">${stats.mostLosses.player}</span>
                    <span class="record-value">${stats.mostLosses.value}</span>
                </div>
                <div class="record-item">
                    <span class="record-title">Least Losses</span>
                    <span class="record-player">${stats.leastLosses.player}</span>
                    <span class="record-value">${stats.leastLosses.value}</span>
                </div>
            </div>
        </div>
        <table id="season0-stats-table">...</table>
    `;
}