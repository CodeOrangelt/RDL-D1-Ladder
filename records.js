import { 
    collection, 
    getDocs,
    query, 
    where 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from './firebase-config.js';

async function loadRecords() {
    try {
        // Get all players and their matches
        const playersRef = collection(db, 'players');
        const approvedMatchesRef = collection(db, 'approvedMatches');
        
        const playerStats = new Map(); // Store player stats

        // Get all players
        const playerSnapshot = await getDocs(playersRef);
        
        // Process each player
        for (const playerDoc of playerSnapshot.docs) {
            const player = playerDoc.data();
            const username = player.username;

            // Get player's matches as winner
            const winnerMatches = await getDocs(
                query(approvedMatchesRef, where('winnerUsername', '==', username))
            );

            // Get player's matches as loser
            const loserMatches = await getDocs(
                query(approvedMatchesRef, where('loserUsername', '==', username))
            );

            // Calculate stats
            const wins = winnerMatches.size;
            const losses = loserMatches.size;
            const totalMatches = wins + losses;
            let totalKills = 0;
            let totalDeaths = 0;

            // Process winner matches
            winnerMatches.forEach(match => {
                const data = match.data();
                totalKills += parseInt(data.winnerScore) || 0;
                totalDeaths += parseInt(data.loserScore) || 0;
            });

            // Process loser matches
            loserMatches.forEach(match => {
                const data = match.data();
                totalKills += parseInt(data.loserScore) || 0;
                totalDeaths += parseInt(data.winnerScore) || 0;
            });

            // Calculate final stats
            const kdRatio = totalDeaths > 0 ? (totalKills / totalDeaths).toFixed(2) : totalKills;
            const winRate = totalMatches > 0 ? ((wins / totalMatches) * 100).toFixed(1) : 0;
            
            // Calculate score differential
            let scoreDifferential = 0;
            winnerMatches.forEach(match => {
                const data = match.data();
                scoreDifferential += (parseInt(data.winnerScore) || 0) - (parseInt(data.loserScore) || 0);
            });
            loserMatches.forEach(match => {
                const data = match.data();
                scoreDifferential += (parseInt(data.loserScore) || 0) - (parseInt(data.winnerScore) || 0);
            });

            playerStats.set(username, {
                wins,
                losses,
                totalMatches,
                kdRatio,
                winRate,
                firstPlaceDate: player.firstPlaceDate,
                scoreDifferential,
                suicides: player.suicides || 0
            });
        }

        // Update record displays
        updateMostWins(playerStats);
        updateBestWinRate(playerStats);
        updateBestKD(playerStats);
        updateLongestStreak(playerStats);
        updateMostMatches(playerStats);
        updateBestScoreDifferential(playerStats);
        updateMostLosses(playerStats);
        updateLeastSuicides(playerStats);

    } catch (error) {
        console.error('Error loading records:', error);
        document.querySelectorAll('.record-value').forEach(el => {
            el.textContent = 'Error loading data';
        });
    }
}

function updateMostWins(playerStats) {
    let mostWins = { username: 'None', wins: 0 };
    for (const [username, stats] of playerStats) {
        if (stats.wins > mostWins.wins) {
            mostWins = { username, wins: stats.wins };
        }
    }
    document.getElementById('most-wins').textContent = 
        `${mostWins.username} (${mostWins.wins})`;
}

function updateBestWinRate(playerStats) {
    let bestWinRate = { username: 'None', rate: 0 };
    for (const [username, stats] of playerStats) {
        if (stats.totalMatches >= 10 && parseFloat(stats.winRate) > bestWinRate.rate) {
            bestWinRate = { username, rate: parseFloat(stats.winRate) };
        }
    }
    document.getElementById('best-winrate').textContent = 
        `${bestWinRate.username} (${bestWinRate.rate}%)`;
}

function updateBestKD(playerStats) {
    let bestKD = { username: 'None', kd: 0 };
    for (const [username, stats] of playerStats) {
        if (stats.totalMatches >= 10 && parseFloat(stats.kdRatio) > bestKD.kd) {
            bestKD = { username, kd: parseFloat(stats.kdRatio) };
        }
    }
    document.getElementById('best-kd').textContent = 
        `${bestKD.username} (${bestKD.kd})`;
}

function updateLongestStreak(playerStats) {
    let longestStreak = { username: 'None', days: 0 };
    for (const [username, stats] of playerStats) {
        if (stats.firstPlaceDate) {
            const streakDays = Math.floor(
                (new Date() - stats.firstPlaceDate.toDate()) / (1000 * 60 * 60 * 24)
            );
            if (streakDays > longestStreak.days) {
                longestStreak = { username, days: streakDays };
            }
        }
    }
    document.getElementById('longest-streak').textContent = 
        `${longestStreak.username} (${longestStreak.days} days)`;
}

function updateMostMatches(playerStats) {
    let mostMatches = { username: 'None', matches: 0 };
    for (const [username, stats] of playerStats) {
        if (stats.totalMatches > mostMatches.matches) {
            mostMatches = { username, matches: stats.totalMatches };
        }
    }
    document.getElementById('most-matches').textContent = 
        `${mostMatches.username} (${mostMatches.matches})`;
}

function updateBestScoreDifferential(playerStats) {
    let bestDiff = { username: 'None', diff: -Infinity };
    for (const [username, stats] of playerStats) {
        if (stats.totalMatches >= 10 && stats.scoreDifferential > bestDiff.diff) {
            bestDiff = { username, diff: stats.scoreDifferential };
        }
    }
    document.getElementById('best-differential').textContent = 
        `${bestDiff.username} (${bestDiff.diff > 0 ? '+' : ''}${bestDiff.diff})`;
}

function updateMostLosses(playerStats) {
    let mostLosses = { username: 'None', losses: 0 };
    for (const [username, stats] of playerStats) {
        if (stats.losses > mostLosses.losses) {
            mostLosses = { username, losses: stats.losses };
        }
    }
    document.getElementById('most-losses').textContent = 
        `${mostLosses.username} (${mostLosses.losses})`;
}

function updateLeastSuicides(playerStats) {
    let leastSuicides = { username: 'None', suicides: Infinity };
    for (const [username, stats] of playerStats) {
        if (stats.totalMatches >= 10 && stats.suicides < leastSuicides.suicides) {
            leastSuicides = { username, suicides: stats.suicides };
        }
    }
    document.getElementById('least-suicides').textContent = 
        `${leastSuicides.username} (${leastSuicides.suicides})`;
}

// Load records when the page loads
document.addEventListener('DOMContentLoaded', loadRecords);