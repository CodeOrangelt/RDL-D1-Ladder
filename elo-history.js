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

let lastVisible = null;
const ENTRIES_PER_PAGE = 10;

export async function getEloHistory(nextPage = false) {
    try {
        const eloHistoryRef = collection(db, 'eloHistory');
        let q;

        if (nextPage && lastVisible) {
            q = query(
                eloHistoryRef,
                orderBy('timestamp', 'desc'),
                startAfter(lastVisible),
                limit(ENTRIES_PER_PAGE)
            );
        } else {
            q = query(
                eloHistoryRef,
                orderBy('timestamp', 'desc'),
                limit(ENTRIES_PER_PAGE)
            );
        }

        const snapshot = await getDocs(q);
        
        if (!snapshot.empty) {
            lastVisible = snapshot.docs[snapshot.docs.length - 1];
        }

        const hasMore = snapshot.docs.length === ENTRIES_PER_PAGE;

        return {
            entries: snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })),
            hasMore
        };
    } catch (error) {
        console.error("Error getting ELO history:", error);
        return { entries: [], hasMore: false };
    }
}

export function resetPagination() {
    lastVisible = null;
}