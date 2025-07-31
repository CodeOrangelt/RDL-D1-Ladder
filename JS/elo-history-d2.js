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
    getDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from './firebase-config.js';

// Add these threshold constants at the top of the file
const ELO_THRESHOLDS_D2 = [
    { name: 'Gold', elo: 1800 },
    { name: 'Silver', elo: 1600 },
    { name: 'Bronze', elo: 1400 },
    { name: 'Unranked', elo: 1200 }
];

// Track pagination for D2
let lastVisibleD2 = null;

async function getUsernameByIdD2(userId) {
    try {
        if (!userId) return 'Unknown Player';
        
        // Try checking in playersD2 collection
        const userDoc = await getDoc(doc(db, 'playersD2', userId));
        if (userDoc.exists()) {
            return userDoc.data().username || 'Unknown Player';
        }
        
        // If not found, try to get from matches
        const winnerMatches = await getDocs(
            query(
                collection(db, 'approvedMatchesD2'), 
                where('winnerId', '==', userId), 
                limit(1)
            )
        );
        
        if (!winnerMatches.empty) {
            return winnerMatches.docs[0].data().winnerUsername || 'Unknown Player';
        }
        
        const loserMatches = await getDocs(
            query(
                collection(db, 'approvedMatchesD2'), 
                where('loserId', '==', userId), 
                limit(1)
            )
        );
        
        if (!loserMatches.empty) {
            return loserMatches.docs[0].data().loserUsername || 'Unknown Player';
        }
        
        return 'Unknown Player';
    } catch (error) {
        console.error('Error getting username:', error);
        return 'Unknown Player';
    }
}

export async function recordEloChangeD2({
    playerId,
    previousElo,
    newElo,
    opponentId,
    matchResult,
    previousPosition,
    newPosition,
    isPromotion = false,
    isDemotion = false,
    matchId,
    timestamp
}) {
    try {
        const historyRef = doc(collection(db, 'eloHistoryD2'));
        
        // Determine the type and rank
        let type = 'match';
        if (isPromotion) type = 'promotion';
        if (isDemotion) type = 'demotion';
        
        // Calculate rank based on new ELO
        let rankAchieved = 'Unranked';
        if (newElo >= 2100) rankAchieved = 'Emerald';
        else if (newElo >= 1800) rankAchieved = 'Gold';
        else if (newElo >= 1600) rankAchieved = 'Silver';
        else if (newElo >= 1400) rankAchieved = 'Bronze';

        await setDoc(historyRef, {
            type,
            player: playerId,
            opponent: opponentId,
            previousElo,
            newElo,
            change: newElo - previousElo,
            matchResult,
            previousPosition,
            newPosition,
            rankAchieved,
            matchId,
            timestamp
        });

        console.log(`D2 ELO history recorded for ${playerId}`);
        return true;
    } catch (error) {
        console.error('Error recording D2 ELO history:', error);
        throw error;
    }
}

export async function getEloHistoryD2(pageSize = 20) {
    try {
        const eloHistoryRef = collection(db, 'eloHistoryD2');
        let q;
        
        if (lastVisibleD2) {
            q = query(
                eloHistoryRef, 
                orderBy('timestamp', 'desc'),
                startAfter(lastVisibleD2),
                limit(pageSize)
            );
        } else {
            q = query(
                eloHistoryRef, 
                orderBy('timestamp', 'desc'),
                limit(pageSize)
            );
        }
        
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            return { entries: [], hasMore: false };
        }
        
        lastVisibleD2 = querySnapshot.docs[querySnapshot.docs.length - 1];
        
        // Use Promise.all to fetch all usernames concurrently
        const entryPromises = querySnapshot.docs.map(async doc => {
            const data = doc.data();
            const [playerUsername, opponentUsername] = await Promise.all([
                getUsernameByIdD2(data.player),
                getUsernameByIdD2(data.opponent)
            ]);

            return {
                ...data,
                playerUsername,
                opponentUsername,
                change: data.newElo - data.previousElo,
                timestamp: data.timestamp
            };
        });

        const resolvedEntries = await Promise.all(entryPromises);
        return { entries: resolvedEntries, hasMore: querySnapshot.size === pageSize };

    } catch (error) {
        console.error("Error fetching D2 ELO history:", error);
        throw error;
    }
}

export function resetPaginationD2() {
    lastVisibleD2 = null;
}