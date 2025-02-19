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
const ELO_THRESHOLDS = [
    { name: 'Gold', elo: 1800 },
    { name: 'Silver', elo: 1600 },
    { name: 'Bronze', elo: 1400 },
    { name: 'Unranked', elo: 1200 }
];

async function getUsernameById(userId) {
    try {
        const playerDoc = await getDoc(doc(db, 'players', userId));
        if (playerDoc.exists()) {
            return playerDoc.data().username;
        }
        return 'Unknown Player';
    } catch (error) {
        console.error('Error fetching username:', error);
        return 'Unknown Player';
    }
}

export async function recordEloChange({
    playerId,
    previousElo,
    newElo,
    opponentId,
    matchResult,
    previousPosition,
    newPosition,
    isPromotion = false,
    isDemotion = false,
    timestamp
}) {
    try {
        const historyRef = doc(collection(db, 'eloHistory'));
        
        await setDoc(historyRef, {
            type: 'match',
            player: playerId,
            opponent: opponentId,
            previousElo,
            newElo,
            change: newElo - previousElo,
            matchResult,
            previousPosition,
            newPosition,
            isPromotion,
            isDemotion,
            timestamp
        });

        console.log(`ELO history recorded for ${playerId}`);
        return true;
    } catch (error) {
        console.error('Error recording ELO history:', error);
        throw error;
    }
}

export async function getEloHistory() {
    try {
        const eloHistoryRef = collection(db, 'eloHistory');
        const q = query(eloHistoryRef, orderBy('timestamp', 'desc'));
        const querySnapshot = await getDocs(q);
        
        // Use Promise.all to fetch all usernames concurrently
        const entryPromises = querySnapshot.docs.map(async doc => {
            const data = doc.data();
            const [playerUsername, opponentUsername] = await Promise.all([
                getUsernameById(data.player),
                getUsernameById(data.opponent)
            ]);

            return {
                ...data,
                playerUsername,
                opponentUsername,
                change: data.newElo - data.previousElo
            };
        });

        const resolvedEntries = await Promise.all(entryPromises);
        return { entries: resolvedEntries };

    } catch (error) {
        console.error("Error fetching ELO history:", error);
        throw error;
    }
}

export function resetPagination() {
    lastVisible = null;
}