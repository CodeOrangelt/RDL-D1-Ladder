import { db } from './firebase-config.js';
import { collection, query, orderBy, limit, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

export function initializePromotionTracker() {
    const promotionDetails = document.getElementById('promotion-details');
    
    // Listen for changes in eloHistory
    const historyRef = collection(db, 'eloHistory');
    const q = query(
        historyRef, 
        orderBy('timestamp', 'desc'),
        limit(1)
    );

    onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                const data = change.doc.data();
                if (data.type === 'promotion') {
                    const promotionText = `${data.player} promoted to ${data.rankAchieved} by ${data.promotedBy}`;
                    promotionDetails.textContent = promotionText;
                }
            }
        });
    });
}