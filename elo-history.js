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

// Add these threshold constants at the top of the file
const ELO_THRESHOLDS = [
    { name: 'Gold', elo: 1800 },
    { name: 'Silver', elo: 1600 },
    { name: 'Bronze', elo: 1400 },
    { name: 'Unranked', elo: 1200 }
];

export async function recordEloChange(player, oldElo, newElo, opponent, matchResult) {
    try {
        // Ensure numeric values for ELO ratings
        const previousElo = Number(oldElo) || 1200;
        const currentElo = Number(newElo) || 1200;

        // Check for rank changes
        const oldRank = ELO_THRESHOLDS.find(t => previousElo >= t.elo) || ELO_THRESHOLDS[ELO_THRESHOLDS.length - 1];
        const newRank = ELO_THRESHOLDS.find(t => currentElo >= t.elo) || ELO_THRESHOLDS[ELO_THRESHOLDS.length - 1];
        
        // Explicitly calculate promotion/demotion status
        const isPromotion = Boolean(newRank.elo > oldRank.elo);
        const isDemotion = Boolean(newRank.elo < oldRank.elo);

        const eloHistoryRef = collection(db, 'eloHistory');
        
        // Create document with validated data
        const historyEntry = {
            timestamp: serverTimestamp(),
            player: String(player),
            previousElo: previousElo,
            newElo: currentElo,
            change: currentElo - previousElo,
            opponent: String(opponent),
            matchResult: String(matchResult),
            previousRank: oldRank.name,
            newRank: newRank.name,
            isPromotion: isPromotion,
            isDemotion: isDemotion,
            type: 'match'
        };

        // Add the document to Firestore
        await addDoc(eloHistoryRef, historyEntry);

    } catch (error) {
        console.error("Error recording ELO history:", error);
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