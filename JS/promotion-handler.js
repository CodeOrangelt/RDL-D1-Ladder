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

export class PromotionHandler {
    static getRankName(elo) {
        if (elo >= 2000) return 'Emerald';
        if (elo >= 1800) return 'Gold';
        if (elo >= 1600) return 'Silver';
        if (elo >= 1400) return 'Bronze';
        return 'Unranked';
    }

    static async checkPromotion(userId, newElo, oldElo) {
        const ranks = [
            { threshold: 1400, name: 'Bronze' },
            { threshold: 1600, name: 'Silver' },
            { threshold: 1800, name: 'Gold' },
            { threshold: 2000, name: 'Emerald' }
        ];

        // Check if crossed a threshold
        for (const rank of ranks) {
            if (oldElo < rank.threshold && newElo >= rank.threshold) {
                // Check if promotion was already shown
                const userDoc = await getDoc(doc(db, 'players', userId));
                const lastShownRank = userDoc.data().lastShownPromotion || 0;

                if (rank.threshold > lastShownRank) {
                    // Update last shown promotion
                    await setDoc(doc(db, 'players', userId), {
                        ...userDoc.data(),
                        lastShownPromotion: rank.threshold
                    });

                    // Show promotion modal
                    this.showPromotionModal(rank.name);
                    return;
                }
            }
        }
    }

    static showPromotionModal(rankName) {
        // Create modal if it doesn't exist
        let modal = document.getElementById('promotionModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'promotionModal';
            modal.className = 'promotion-modal';
            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <div class="promotion-content">
                <h2 class="promotion-title">Rank Up!</h2>
                <p>Congratulations! You've been promoted to</p>
                <h3>${rankName}</h3>
                <button class="promotion-button" onclick="document.getElementById('promotionModal').style.display='none'">
                    Acknowledged
                </button>
            </div>
        `;

        modal.style.display = 'flex';
    }
}

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