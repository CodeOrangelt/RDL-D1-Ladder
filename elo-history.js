import { 
    collection, 
    addDoc, 
    serverTimestamp, 
    query, 
    orderBy, 
    getDocs 
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
    const eloHistoryRef = collection(db, 'eloHistory');
    const q = query(eloHistoryRef, orderBy('timestamp', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    }));
}