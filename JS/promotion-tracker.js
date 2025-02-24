import { db } from './firebase-config.js';
import { collection, query, orderBy, limit, onSnapshot, where, doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

// Add rank color mapping
const RANK_COLORS = {
    'Emerald': '#50C878',
    'Gold': '#FFD700',
    'Silver': '#C0C0C0',
    'Bronze': '#CD7F32',
    'Unranked': '#808080'
};

export async function checkAndRecordPromotion(userId, newElo, oldElo) {
    const ranks = [
        { threshold: 1400, name: 'Bronze' },
        { threshold: 1600, name: 'Silver' },
        { threshold: 1800, name: 'Gold' },
        { threshold: 2000, name: 'Emerald' }
    ];

    // Check if crossed a threshold
    for (const rank of ranks) {
        if (oldElo < rank.threshold && newElo >= rank.threshold) {
            try {
                const userDoc = await getDoc(doc(db, 'players', userId));
                if (!userDoc.exists()) {
                    console.error('User document not found');
                    return;
                }

                const userData = userDoc.data();
                const promotionData = {
                    playerName: userData.username,
                    newRank: rank.name,
                    promotionDate: new Date().toISOString(),
                    previousElo: oldElo,
                    newElo: newElo,
                    userId: userId,
                    timestamp: new Date()
                };

                // Create promotion history document
                const historyRef = doc(collection(db, 'promotionHistory'));
                await setDoc(historyRef, promotionData);

                // Update player's last shown promotion
                await setDoc(doc(db, 'players', userId), {
                    ...userData,
                    lastShownPromotion: rank.threshold
                });

                return rank.name; // Return rank name for UI updates
            } catch (error) {
                console.error('Error recording promotion:', error);
            }
        }
    }
    return null;
}

function getRankStyle(rankName) {
    return RANK_COLORS[rankName] || '#FFFFFF';
}

export function initializePromotionTracker() {
    const bannerContainer = document.getElementById('promotion-banner-container');
    if (!bannerContainer) {
        console.error('Banner container not found');
        return;
    }

    const historyRef = collection(db, 'eloHistory');
    const q = query(
        historyRef,
        where('type', 'in', ['promotion', 'demotion']),
        orderBy('timestamp', 'desc'),
        limit(1)
    );

    onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                const data = change.doc.data();
                
                // Create banner element
                const banner = document.createElement('div');
                banner.className = 'promotion-banner';
                banner.setAttribute('data-rank', data.rankAchieved);

                // Create details element
                const details = document.createElement('div');
                details.className = 'promotion-details';
                
                // Set content with proper formatting
                const actionText = data.type === 'promotion' ? 'promoted to' : 'demoted to';
                details.innerHTML = `${data.player} was ${actionText} <span class="rank-text">${data.rankAchieved}</span> by ${data.promotedBy || 'Admin'}`;
                
                // Add to DOM
                banner.appendChild(details);
                bannerContainer.innerHTML = ''; // Clear existing banners
                bannerContainer.appendChild(banner);
                
                // Auto-remove after 5 seconds
                setTimeout(() => {
                    banner.remove();
                }, 5000);
            }
        });
    });
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initializePromotionTracker);