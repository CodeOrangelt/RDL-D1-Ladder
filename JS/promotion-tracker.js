import { db } from './firebase-config.js';
import { collection, query, orderBy, limit, onSnapshot, where, doc, getDoc, addDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

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
    
    try {
        // Get user data first
        const userRef = doc(db, 'players', userId);
        const userSnap = await getDoc(userRef);
        
        if (!userSnap.exists()) {
            console.error('User not found:', userId);
            return null;
        }

        const userData = userSnap.data();
        console.log('Found user data:', userData);

        // Find rank crossed
        const ranks = [
            { threshold: 1400, name: 'Bronze' },
            { threshold: 1600, name: 'Silver' },
            { threshold: 1800, name: 'Gold' },
            { threshold: 2000, name: 'Emerald' }
        ];

        const rankCrossed = ranks.find(rank => oldElo < rank.threshold && newElo >= rank.threshold);
        if (!rankCrossed) {
            console.log('No rank threshold crossed');
            return null;
        }

        // Create detailed promotion history record
        const promotionHistoryData = {
            username: userData.username,
            userId: userId,
            previousElo: oldElo,
            newElo: newElo,
            previousRank: getRankName(oldElo),
            newRank: rankCrossed.name,
            timestamp: serverTimestamp(),
            type: 'promotion',
            promotedBy: 'System' // Add this field to track automatic promotions
        };

        // Write to both collections using Promise.all
        try {
            const [promotionHistoryRef, eloHistoryRef] = await Promise.all([
                // Write to promotionHistory
                addDoc(collection(db, 'promotionHistory'), promotionHistoryData),
                // Write to eloHistory
                addDoc(collection(db, 'eloHistory'), {
                    player: userData.username,
                    type: 'promotion',
                    rankAchieved: rankCrossed.name,
                    timestamp: serverTimestamp(),
                    previousElo: oldElo,
                    newElo: newElo
                })
            ]);

            console.log('Successfully recorded promotion:', {
                promotionId: promotionHistoryRef.id,
                eloHistoryId: eloHistoryRef.id,
                username: userData.username,
                newRank: rankCrossed.name
            });

            return rankCrossed.name;

        } catch (writeError) {
            console.error('Error writing promotion records:', writeError);
            throw writeError;
        }

    } catch (error) {
        console.error('Error in promotion process:', error);
        return null;
    }
}

// Helper function to get rank name from ELO
export function getRankName(elo) {
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