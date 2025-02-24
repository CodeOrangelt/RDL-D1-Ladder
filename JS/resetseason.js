import { db } from './firebase-config.js';
import { 
    collection, 
    getDocs, 
    setDoc,
    doc,
    query,
    orderBy 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

async function archiveSeason0() {
    try {
        // Get all players
        const playersSnapshot = await getDocs(collection(db, 'players'));
        
        // Archive each player's data
        for (const playerDoc of playersSnapshot.docs) {
            const playerData = playerDoc.data();
            
            // Create a document in season0 collection with the same data
            await setDoc(
                doc(db, 'season0', playerDoc.id), 
                {
                    ...playerData,
                    archivedAt: new Date(),
                    originalId: playerDoc.id
                }
            );
        }
        
        console.log('Successfully archived players to season0');
        return true;
    } catch (error) {
        console.error('Error archiving season:', error);
        throw error;
    }
}

async function archiveRecords() {
    try {
        const recordsRef = collection(db, 'records');
        const q = query(recordsRef, orderBy('wins', 'desc'));
        const recordsSnapshot = await getDocs(q);
        
        const recordsArray = [];
        recordsSnapshot.forEach(doc => {
            const data = doc.data();
            recordsArray.push({
                username: data.username,
                wins: data.wins || 0,
                losses: data.losses || 0,
                winRate: data.winRate || 0,
                timestamp: new Date()
            });
        });

        // Store in season0records collection
        await setDoc(
            doc(db, 'season0records', 'snapshot'), 
            {
                records: recordsArray,
                archivedAt: new Date()
            }
        );
        
        console.log('Successfully archived records');
        return true;
    } catch (error) {
        console.error('Error archiving records:', error);
        throw error;
    }
}

export { archiveSeason0, archiveRecords };

