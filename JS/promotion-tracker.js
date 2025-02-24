import { db } from './firebase-config.js';
import { collection, query, orderBy, limit, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

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

export async function initializePromotionTracker() {
    const promotionBanner = document.getElementById('latest-promotion');
    const promotionDetails = document.getElementById('promotion-details');
    
    if (!promotionBanner || !promotionDetails) {
        console.error('Promotion elements not found');
        return;
    }
    
    // Add this to debug
    console.log('Initializing promotion tracker');
    
    // When showing a promotion
    promotionBanner.classList.add('active');

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
                    // Set the rank attribute for styling
                    bannerElement.setAttribute('data-rank', data.rankAchieved);
                    
                    // Create promotion text
                    const promotionText = `${data.player} was promoted to <span class="rank-text">${data.rankAchieved}</span> by Admin`;
                    
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