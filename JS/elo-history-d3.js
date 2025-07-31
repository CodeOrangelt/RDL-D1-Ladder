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
import { db } from './firebase-config.js';

// Add these threshold constants at the top of the file
const ELO_THRESHOLDS_D3 = [
    { name: 'Emerald', elo: 2000 },
    { name: 'Gold', elo: 1800 },
    { name: 'Silver', elo: 1600 },
    { name: 'Bronze', elo: 1400 },
    { name: 'Unranked', elo: 1200 }
];

// Track pagination for D3
let lastVisibleD3 = null;

async function getUsernameByIdD3(userId) {
    try {
        if (!userId) return 'Unknown Player';
        
        // Try checking in playersD3 collection
        const userDoc = await getDoc(doc(db, 'playersD3', userId));
        if (userDoc.exists()) {
            return userDoc.data().username || 'Unknown Player';
        }
        
        // If not found, try to get from matches
        const winnerMatches = await getDocs(
            query(
                collection(db, 'approvedMatchesD3'), 
                where('winnerId', '==', userId), 
                limit(1)
            )
        );
        
        if (!winnerMatches.empty) {
            return winnerMatches.docs[0].data().winnerUsername || 'Unknown Player';
        }
        
        const loserMatches = await getDocs(
            query(
                collection(db, 'approvedMatchesD3'), 
                where('loserId', '==', userId), 
                limit(1)
            )
        );
        
        if (!loserMatches.empty) {
            return loserMatches.docs[0].data().loserUsername || 'Unknown Player';
        }
        
        return 'Unknown Player';
    } catch (error) {
        console.error('Error getting D3 username:', error);
        return 'Unknown Player';
    }
}

export async function recordEloChangeD3({
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
        const historyRef = doc(collection(db, 'eloHistoryD3'));
        
        // Determine the type and rank
        let type = 'match';
        if (isPromotion) type = 'promotion';
        if (isDemotion) type = 'demotion';
        
        // Calculate rank based on new ELO
        let rankAchieved = 'Unranked';
        if (newElo >= 2000) rankAchieved = 'Emerald';
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
            timestamp: timestamp || serverTimestamp(),
            gameMode: 'D3'
        });

        console.log(`D3 ELO history recorded for ${playerId}`);
        return true;
    } catch (error) {
        console.error('Error recording D3 ELO history:', error);
        throw error;
    }
}

export async function getEloHistoryD3(pageSize = 20) {
    try {
        const eloHistoryRef = collection(db, 'eloHistoryD3');
        let q;
        
        if (lastVisibleD3) {
            q = query(
                eloHistoryRef, 
                orderBy('timestamp', 'desc'),
                startAfter(lastVisibleD3),
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
        
        lastVisibleD3 = querySnapshot.docs[querySnapshot.docs.length - 1];
        
        // Use Promise.all to fetch all usernames concurrently
        const entryPromises = querySnapshot.docs.map(async doc => {
            const data = doc.data();
            const [playerUsername, opponentUsername] = await Promise.all([
                getUsernameByIdD3(data.player),
                getUsernameByIdD3(data.opponent)
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
        console.error("Error fetching D3 ELO history:", error);
        throw error;
    }
}

export function resetPaginationD3() {
    lastVisibleD3 = null;
}