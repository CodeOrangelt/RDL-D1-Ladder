import { db } from './firebase-config.js';
import { 
    collection, 
    getDocs, 
    setDoc,
    doc 
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

// Export the function to be used elsewhere
export { archiveSeason0 };