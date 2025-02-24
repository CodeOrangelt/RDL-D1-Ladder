import { db } from './firebase-config.js';
import { collection, query, orderBy, limit, onSnapshot, where, doc, getDoc, addDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

// Add rank color mapping
const RANK_COLORS = {
    'Emerald': '#50C878',
    'Gold': '#FFD700',
    'Silver': '#C0C0C0',
    'Bronze': '#CD7F32',
    'Unranked': '#808080'
};

export async function checkAndRecordPromotion(userId, newElo, oldElo) {
    console.log('Starting promotion check:', { userId, newElo, oldElo });
    
    const ranks = [
        { threshold: 1400, name: 'Bronze' },
        { threshold: 1600, name: 'Silver' },
        { threshold: 1800, name: 'Gold' },
        { threshold: 2000, name: 'Emerald' }
    ];

    // Find the rank crossed (if any)
    const rankCrossed = ranks.find(rank => oldElo < rank.threshold && newElo >= rank.threshold);
    
    if (!rankCrossed) {
        console.log('No rank threshold crossed');
        return null;
    }

    try {
        // Get user data
        const userRef = doc(db, 'players', userId);
        const userSnap = await getDoc(userRef);
        
        if (!userSnap.exists()) {
            console.error('User not found:', userId);
            return null;
        }

        const userData = userSnap.data();
        
        // Create promotion record
        const promotionData = {
            playerName: userData.username || 'Unknown Player',
            newRank: rankCrossed.name,
            previousRank: getRankName(oldElo),
            promotionDate: new Date().toISOString(),
            previousElo: oldElo,
            newElo: newElo,
            userId: userId,
            timestamp: new Date(),
            type: 'promotion'
        };

        console.log('Creating promotion record:', promotionData);

        // Use addDoc instead of setDoc
        const docRef = await addDoc(collection(db, 'promotionHistory'), promotionData);
        console.log('Successfully created promotion record:', docRef.id);

        // Also create eloHistory record
        await addDoc(collection(db, 'eloHistory'), {
            player: userData.username,
            type: 'promotion',
            rankAchieved: rankCrossed.name,
            timestamp: new Date(),
            promotedBy: 'System'
        });

        return rankCrossed.name;

    } catch (error) {
        console.error('Failed to record promotion:', error);
        return null;
    }
}

// Helper function to get rank name from ELO
function getRankName(elo) {
    if (elo >= 2000) return 'Emerald';
    if (elo >= 1800) return 'Gold';
    if (elo >= 1600) return 'Silver';
    if (elo >= 1400) return 'Bronze';
    return 'Unranked';
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