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
import { getRankStyle } from './ranks.js';

async function getUsernameById(userId) {
    try {
        if (!userId) return 'Unknown Player';
        
        const playerDoc = await getDoc(doc(db, 'players', userId));
        return playerDoc.exists() ? playerDoc.data().username : 'Unknown Player';
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
    matchId,
    timestamp
}) {
    try {
        const historyRef = doc(collection(db, 'eloHistory'));
        
        // Fetch username to store alongside userId for faster lookups
        const username = await getUsernameById(playerId);
        const opponentUsername = opponentId ? await getUsernameById(opponentId) : null;
        
        // Determine the type and rank
        let type = 'match';
        if (isPromotion) type = 'promotion';
        if (isDemotion) type = 'demotion';
        
        // Calculate rank based on new ELO using universal thresholds
        // Note: We don't have match count/win rate here, so Emerald won't be granted in history
        const rank = getRankStyle(newElo, 0, 0);
        const rankAchieved = rank.name;

        await setDoc(historyRef, {
            type,
            player: playerId,
            username: username,              // ✅ NEW: Direct username for fast lookups
            playerUsername: username,        // ✅ NEW: Compatibility field
            opponent: opponentId,
            opponentUsername: opponentUsername, // ✅ NEW: Opponent username
            previousElo,
            newElo,
            change: newElo - previousElo,
            matchResult,
            previousPosition,
            newPosition,
            rankAchieved,
            gameMode: 'D1',                 // ✅ NEW: Ladder identifier
            matchId: matchId,               // ✅ NEW: Link to match document
            timestamp
        });

        console.log(`ELO history recorded for ${username} (${playerId})`);
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
                change: data.newElo - data.previousElo,
                timestamp: data.timestamp
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