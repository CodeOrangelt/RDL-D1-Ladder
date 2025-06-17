import { 
    collection, 
    getDocs, 
    doc, 
    updateDoc, 
    where, 
    query,
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from './firebase-config.js';

/**
 * Updates streak counters for all #1 players across all ladders
 * This should be called daily (could be triggered by a cloud function or manually)
 */
export async function updateDailyStreaks() {
    console.log('🏆 Starting daily streak update...');
    
    const ladders = [
        { collection: 'players', name: 'D1' },
        { collection: 'playersD2', name: 'D2' },
        { collection: 'playersD3', name: 'D3' }
    ];
    
    for (const ladder of ladders) {
        try {
            // Find the #1 player in this ladder
            const playersRef = collection(db, ladder.collection);
            const firstPlaceQuery = query(playersRef, where('position', '==', 1));
            const snapshot = await getDocs(firstPlaceQuery);
            
            if (!snapshot.empty) {
                const championDoc = snapshot.docs[0];
                const championData = championDoc.data();
                
                // Only update if they have an active streak (firstPlaceDate exists)
                if (championData.firstPlaceDate) {
                    const currentStreakDays = calculateStreakDays(championData.firstPlaceDate);
                    
                    await updateDoc(doc(db, ladder.collection, championDoc.id), {
                        streakDays: currentStreakDays,
                        lastStreakUpdate: serverTimestamp()
                    });
                    
                    console.log(`🏆 ${ladder.name}: ${championData.username} streak updated to ${currentStreakDays} days`);
                }
            }
        } catch (error) {
            console.error(`Error updating ${ladder.name} streak:`, error);
        }
    }
    
    console.log('✅ Daily streak update completed');
}

/**
 * Calculate current streak days from start date
 */
function calculateStreakDays(firstPlaceDate) {
    if (!firstPlaceDate) return 0;
    
    let startDate;
    if (firstPlaceDate.seconds) {
        // Firebase Timestamp
        startDate = new Date(firstPlaceDate.seconds * 1000);
    } else if (firstPlaceDate.toDate) {
        // Firebase Timestamp object
        startDate = firstPlaceDate.toDate();
    } else {
        // Regular Date or string
        startDate = new Date(firstPlaceDate);
    }
    
    const now = new Date();
    const diffTime = now.getTime() - startDate.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return Math.max(1, diffDays); // Minimum 1 day
}

/**
 * Manual trigger for updating streaks (can be called from admin panel)
 */
export async function manualStreakUpdate() {
    try {
        await updateDailyStreaks();
        return { success: true, message: 'Streaks updated successfully' };
    } catch (error) {
        console.error('Manual streak update failed:', error);
        return { success: false, message: error.message };
    }
}