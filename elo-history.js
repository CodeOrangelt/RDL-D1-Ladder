import { 
    collection, 
    addDoc, 
    serverTimestamp, 
    query, 
    orderBy, 
    getDocs,
    limit,
    startAfter
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from './firebase-config.js';

export async function recordEloChange(player, oldElo, newElo, opponent, matchResult) {
    try {
        const eloHistoryRef = collection(db, 'eloHistory');
        await addDoc(eloHistoryRef, {
            timestamp: serverTimestamp(),
            player: player,
            previousElo: oldElo,
            newElo: newElo,
            change: newElo - oldElo,
            opponent: opponent,
            matchResult: matchResult
        });
    } catch (error) {
        console.error("Error recording ELO history:", error);
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
                timestamp: data.timestamp,
                player: data.player,
                previousElo: data.previousElo,
                newElo: data.newElo,
                change: data.newElo - data.previousElo,
                opponent: data.opponent,
                matchResult: data.matchResult
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