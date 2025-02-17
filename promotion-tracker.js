import { db } from './firebase-config.js';
import { collection, query, orderBy, limit, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

export function initializePromotionTracker() {
    const promotionDetails = document.getElementById('promotion-details');
    if (!promotionDetails) return;

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
                    let promotionText;
                    if (data.promotionType === 'threshold') {
                        promotionText = `${data.player} reached ${data.rankAchieved} rank through match performance!`;
                    } else {
                        promotionText = `${data.player} was promoted to ${data.rankAchieved} by ${data.promotedBy}`;
                    }

                    // Update banner text with animation
                    promotionDetails.style.opacity = '0';
                    setTimeout(() => {
                        promotionDetails.textContent = promotionText;
                        promotionDetails.style.opacity = '1';
                        promotionDetails.classList.add('new-promotion');
                        setTimeout(() => {
                            promotionDetails.classList.remove('new-promotion');
                        }, 3000);
                    }, 300);
                }
            }
        });
    });
}