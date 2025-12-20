import { 
    collection, 
    addDoc, 
    serverTimestamp, 
    query, 
    orderBy, 
    getDocs,
    limit,
    startAfter,
    doc,
    setDoc,
    getDoc,
    where
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from '../firebase-config.js';

// FFA ELO thresholds for display purposes (no tiers, just for reference)
const ELO_MILESTONES_FFA = [
    { name: 'Legend', elo: 2000 },
    { name: 'Expert', elo: 1500 },
    { name: 'Veteran', elo: 1200 },
    { name: 'Regular', elo: 1000 },
    { name: 'Newcomer', elo: 800 }
];

// Track pagination for FFA
let lastVisibleFFA = null;

async function getUsernameByIdFFA(userId) {
    try {
        const playerDoc = await getDoc(doc(db, 'playersFFA', userId));
        if (playerDoc.exists()) {
            return playerDoc.data().username;
        }
        
        const profileDoc = await getDoc(doc(db, 'userProfiles', userId));
        if (profileDoc.exists()) {
            return profileDoc.data().username;
        }
        
        return null;
    } catch (error) {
        console.error('Error getting username for FFA:', error);
        return null;
    }
}

/**
 * Record an ELO change for FFA
 */
export async function recordEloChangeFFA({
    playerId,
    previousElo,
    newElo,
    matchId,
    placement,
    totalPlayers,
    opponentsSummary = ''
}) {
    try {
        const username = await getUsernameByIdFFA(playerId);
        
        const historyEntry = {
            player: playerId,
            username: username,
            previousElo: previousElo,
            newElo: newElo,
            change: newElo - previousElo,
            matchId: matchId,
            matchType: 'FFA',
            placement: placement,
            totalPlayers: totalPlayers,
            opponentsSummary: opponentsSummary,
            timestamp: serverTimestamp()
        };

        // Check for milestone crossing
        const crossedMilestone = checkMilestoneCrossing(previousElo, newElo);
        if (crossedMilestone) {
            historyEntry.milestone = crossedMilestone;
        }

        await addDoc(collection(db, 'eloHistoryFFA'), historyEntry);
        
        console.log(`FFA ELO recorded for ${username}: ${previousElo} → ${newElo} (${newElo - previousElo > 0 ? '+' : ''}${newElo - previousElo})`);
        
        return historyEntry;
    } catch (error) {
        console.error('Error recording FFA ELO change:', error);
        throw error;
    }
}

/**
 * Check if a milestone was crossed
 */
function checkMilestoneCrossing(oldElo, newElo) {
    for (const milestone of ELO_MILESTONES_FFA) {
        // Check for crossing upward
        if (oldElo < milestone.elo && newElo >= milestone.elo) {
            return { name: milestone.name, direction: 'up', elo: milestone.elo };
        }
        // Check for crossing downward
        if (oldElo >= milestone.elo && newElo < milestone.elo) {
            return { name: milestone.name, direction: 'down', elo: milestone.elo };
        }
    }
    return null;
}

/**
 * Get ELO history for a player in FFA
 */
export async function getPlayerEloHistoryFFA(playerId, limitCount = 50) {
    try {
        const historyRef = collection(db, 'eloHistoryFFA');
        const q = query(
            historyRef,
            where('player', '==', playerId),
            orderBy('timestamp', 'desc'),
            limit(limitCount)
        );
        
        const snapshot = await getDocs(q);
        const history = [];
        
        snapshot.forEach(doc => {
            history.push({
                id: doc.id,
                ...doc.data()
            });
        });
        
        return history;
    } catch (error) {
        console.error('Error getting FFA ELO history:', error);
        return [];
    }
}

/**
 * Get recent ELO history for all FFA players (paginated)
 */
export async function getRecentEloHistoryFFA(pageSize = 20, startAfterDoc = null) {
    try {
        const historyRef = collection(db, 'eloHistoryFFA');
        let q;
        
        if (startAfterDoc) {
            q = query(
                historyRef,
                orderBy('timestamp', 'desc'),
                startAfter(startAfterDoc),
                limit(pageSize)
            );
        } else {
            q = query(
                historyRef,
                orderBy('timestamp', 'desc'),
                limit(pageSize)
            );
        }
        
        const snapshot = await getDocs(q);
        const history = [];
        
        snapshot.forEach(doc => {
            history.push({
                id: doc.id,
                ...doc.data()
            });
        });
        
        // Track last visible for pagination
        if (snapshot.docs.length > 0) {
            lastVisibleFFA = snapshot.docs[snapshot.docs.length - 1];
        }
        
        return {
            entries: history,
            hasMore: snapshot.docs.length === pageSize,
            lastDoc: lastVisibleFFA
        };
    } catch (error) {
        console.error('Error getting recent FFA ELO history:', error);
        return { entries: [], hasMore: false, lastDoc: null };
    }
}

export { ELO_MILESTONES_FFA };