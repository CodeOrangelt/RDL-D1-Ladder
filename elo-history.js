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
        // Check for rank changes
        const oldRank = ELO_THRESHOLDS.find(t => oldElo >= t.elo);
        const newRank = ELO_THRESHOLDS.find(t => newElo >= t.elo);
        const isPromotion = newRank && oldRank && newRank.elo > oldRank.elo;

        const eloHistoryRef = collection(db, 'eloHistory');
        
        // Record match result
        await addDoc(eloHistoryRef, {
            timestamp: serverTimestamp(),
            player: player,
            previousElo: oldElo,
            newElo: newElo,
            change: newElo - oldElo,
            opponent: opponent,
            matchResult: matchResult,
            previousRank: oldRank?.name || 'Unranked',
            newRank: newRank?.name || 'Unranked',
            isPromotion: isPromotion,
            type: 'match'
        });

        // If promoted, create a separate promotion entry
        if (isPromotion) {
            await addDoc(eloHistoryRef, {
                timestamp: serverTimestamp(),
                player: player,
                previousElo: oldElo,
                newElo: newElo,
                type: 'promotion',
                rankAchieved: newRank.name,
                promotedBy: 'System (Match Result)',
                previousRank: oldRank.name,
                promotionType: 'threshold',
                matchId: opponent ? `${player}_vs_${opponent}` : null,
                description: `Promoted to ${newRank.name} after match against ${opponent}`
            });
        }

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