import { doc, getDoc, setDoc, collection } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from './firebase-config.js';

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
                // Get user document to access their username
                const userDoc = await getDoc(doc(db, 'players', userId));
                const userData = userDoc.data();
                const lastShownRank = userData.lastShownPromotion || 0;

                if (rank.threshold > lastShownRank) {
                    // Create promotion history document
                    const historyRef = doc(collection(db, 'promotionHistory'));
                    await setDoc(historyRef, {
                        playerName: userData.username,
                        newRank: rank.name,
                        promotionDate: new Date(),
                        previousElo: oldElo,
                        newElo: newElo
                    });

                    // Update last shown promotion
                    await setDoc(doc(db, 'players', userId), {
                        ...userData,
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