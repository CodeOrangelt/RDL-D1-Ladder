import { db } from './firebase-config.js';
import { collection, query, orderBy, limit, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

// Add rank color mapping
const RANK_COLORS = {
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
                    const rankColor = getRankStyle(data.rankAchieved);
                    const bannerElement = document.getElementById('latest-promotion');
                    const ladderContainer = document.querySelector('.table-container');
                    
                    // Match the width of the ladder container
                    if (ladderContainer) {
                        const containerWidth = ladderContainer.offsetWidth;
                        bannerElement.style.width = `${containerWidth}px`;
                        bannerElement.style.margin = '20px auto';  // Center the banner
                    }
                    
                    let promotionText;
                    
                    if (data.promotionType === 'threshold') {
                        promotionText = `${data.player} reached <span class="rank-text">${data.rankAchieved}</span> rank through match performance!`;
                    } else {
                        promotionText = `${data.player} was promoted to <span class="rank-text">${data.rankAchieved}</span> by RDL Admins`;
                    }

                    // Update banner text with animation and color
                    promotionDetails.style.opacity = '0';
                    
                    setTimeout(() => {
                        // Update text and colors
                        promotionDetails.innerHTML = promotionText;
                        bannerElement.style.borderColor = rankColor;
                        
                        // Style the rank text
                        const rankSpan = promotionDetails.querySelector('.rank-text');
                        if (rankSpan) {
                            rankSpan.style.color = rankColor;
                            rankSpan.style.fontWeight = 'bold';
                        }

                        promotionDetails.style.opacity = '1';
                        promotionDetails.classList.add('new-promotion');
                        
                        // Add rank-specific glow
                        bannerElement.style.boxShadow = `0 0 10px ${rankColor}40`;
                        
                        setTimeout(() => {
                            promotionDetails.classList.remove('new-promotion');
                        }, 3000);
                    }, 300);
                }
            }
        });
    });
}