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
    setDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from './firebase-config.js';

// Add these threshold constants at the top of the file
const ELO_THRESHOLDS = [
    { name: 'Gold', elo: 1800 },
    { name: 'Silver', elo: 1600 },
    { name: 'Bronze', elo: 1400 },
    { name: 'Unranked', elo: 1200 }
];

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

        const entries = [];
        querySnapshot.forEach(doc => {
            const data = doc.data();
            entries.push({
                ...data,
                timestamp: data.timestamp,
                player: data.player,
                previousElo: data.previousElo,
                newElo: data.newElo,
                change: data.newElo - data.previousElo,
                opponent: data.opponent,
                matchResult: data.matchResult,
                isPromotion: data.isPromotion || false,
                previousRank: data.previousRank,
                newRank: data.newRank,
                type: data.type || 'match'
            });
        });

        return { entries };
    } catch (error) {
        console.error("Error fetching ELO history:", error);
        throw error;
    }
}

export function resetPagination() {
    lastVisible = null;
}