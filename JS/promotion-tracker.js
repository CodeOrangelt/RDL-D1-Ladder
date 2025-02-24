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
        console.error('Promotion elements not found:', {
            banner: promotionBanner,
            details: promotionDetails
        });
        return;
    }
    
    console.log('Initializing promotion tracker');

    const historyRef = collection(db, 'eloHistory');
    const q = query(
        historyRef,
        orderBy('timestamp', 'desc'),
        limit(1)
    );

    let currentTimeout;

    onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                const data = change.doc.data();
                console.log('New promotion data:', data);  // Debug log

                if (data.type === 'promotion') {
                    // Clear any existing timeout
                    if (currentTimeout) clearTimeout(currentTimeout);

                    // Set the rank attribute for styling
                    promotionBanner.setAttribute('data-rank', data.rankAchieved);
                    
                    // Create promotion text with rank color
                    const rankColor = getRankStyle(data.rankAchieved);
                    const promotionText = `
                        <strong>${data.player}</strong> was promoted to 
                        <span style="color: ${rankColor}; font-weight: bold;">
                            ${data.rankAchieved}
                        </span>
                    `;
                    
                    promotionDetails.innerHTML = promotionText;
                    promotionBanner.classList.add('active');
                    
                    // Remove after 5 seconds
                    currentTimeout = setTimeout(() => {
                        promotionBanner.classList.remove('active');
                    }, 5000);
                }
            }
        });
    });
}