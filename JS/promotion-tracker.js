import { db } from './firebase-config.js';
import { collection, query, orderBy, limit, onSnapshot, where } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

// Add rank color mapping
const RANK_COLORS = {
    'Emerald': '#50C878',
    'Gold': '#FFD700',
    'Silver': '#C0C0C0',
    'Bronze': '#CD7F32',
    'Unranked': '#808080'
};

function getRankStyle(rankName) {
    return RANK_COLORS[rankName] || '#FFFFFF';
}

export function initializePromotionTracker() {
    const promotionDetails = document.getElementById('promotion-details');
    const bannerElement = document.getElementById('latest-promotion');
    
    if (!promotionDetails || !bannerElement) {
        console.error('Promotion elements not found');
        return;
    }

    const historyRef = collection(db, 'eloHistory');
    const q = query(
        historyRef,
        where('type', 'in', ['promotion', 'demotion']), // Add demotion type
        orderBy('timestamp', 'desc'),
        limit(1)
    );

    onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                const data = change.doc.data();
                if (data.type === 'promotion' || data.type === 'demotion') {
                    // Set the rank attribute for styling
                    bannerElement.setAttribute('data-rank', data.rankAchieved);
                    
                    // Create rank change text based on type
                    const actionText = data.type === 'promotion' ? 'promoted to' : 'demoted to';
                    const promotionText = `${data.player} was ${actionText} <span class="rank-text">${data.rankAchieved}</span> by ${data.promotedBy || 'Admin'}`;
                    
                    promotionDetails.innerHTML = promotionText;
                    bannerElement.classList.add('new-promotion');
                    
                    setTimeout(() => {
                        bannerElement.classList.remove('new-promotion');
                    }, 3000);
                }
            }
        });
    });
}