import { 
    collection, 
    doc, 
    query, 
    where, 
    orderBy, 
    limit, 
    getDoc, 
    setDoc,
    addDoc,
    onSnapshot,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { auth, db } from './firebase-config.js';

/**
 * PromotionManager - Handles all promotion-related functionality in one place
 */
class PromotionManager {
    constructor() {
        // Configuration
        this.MAX_VIEWS = 2; // User will only see each promotion twice
        this.RANKS = [
            { threshold: 1400, name: 'Bronze', color: '#CD7F32' },
            { threshold: 1600, name: 'Silver', color: '#C0C0C0' },
            { threshold: 1800, name: 'Gold', color: '#FFD700' },
            { threshold: 2100, name: 'Emerald', color: '#50C878' }
        ];
        
        // State
        this.bannerContainer = null;
        this.unsubscribe = null;
    }
    
    /**
     * Initialize the promotion system
     */
    initialize() {
        this.bannerContainer = document.getElementById('promotion-banner-container');
        if (!this.bannerContainer) {
            console.error('Promotion banner container not found');
            return;
        }
        
        console.log('Promotion manager initializing...');
        this.setupBannerContainer();
        this.setupRankChangeListener();
    }
    
    /**
     * Setup the banner container
     */
    setupBannerContainer() {
        this.bannerContainer.innerHTML = '';
        this.bannerContainer.style.display = 'none';
    }
    
    /**
     * Setup listener for rank changes
     */
    setupRankChangeListener() {
        const historyRef = collection(db, 'eloHistory');
        const q = query(
            historyRef, 
            where('type', 'in', ['promotion', 'demotion']),
            orderBy('timestamp', 'desc'), 
            limit(5)
        );
        
        this.unsubscribe = onSnapshot(q, async (snapshot) => {
            console.log('Checking for new rank changes...');
            await this.processRankChanges(snapshot);
        }, (error) => {
            console.error('Error listening for rank changes:', error);
        });
    }
    
    /**
     * Process snapshot of rank changes
     */
    async processRankChanges(snapshot) {
        const rankChanges = [];
        
        for (const change of snapshot.docChanges()) {
            if (change.type === "added") {
                rankChanges.push({ id: change.doc.id, ...change.doc.data() });
            }
        }
        
        if (rankChanges.length === 0) {
            return;
        }
        
        // Sort by timestamp (newest first)
        rankChanges.sort((a, b) => b.timestamp.toMillis() - a.timestamp.toMillis());
        
        // Determine how many slots are available for new banners
        const currentBannerCount = this.bannerContainer.children.length;
        const availableSlots = 3 - currentBannerCount;
        
        if (availableSlots <= 0) {
            return;
        }
        
        // Process only the newest changes that fit within available slots
        const changesToShow = rankChanges.slice(0, availableSlots);
        
        for (let i = 0; i < changesToShow.length; i++) {
            const rankChange = changesToShow[i];
            const currentUser = auth.currentUser;
            
            try {
                const shouldShow = await this.shouldShowPromotion(rankChange.id, rankChange.player);
                
                if (shouldShow) {
                    // Stagger banners by 1 second each
                    setTimeout(() => {
                        this.showRankChangeBanner(rankChange);
                    }, i * 1000);
                    
                    // Show lightbox for current user's promotions
                    if (currentUser && rankChange.player === currentUser.displayName) {
                        this.showRankChangeLightbox(rankChange.type, rankChange.rankAchieved);
                    }
                }
            } catch (error) {
                console.error('Error processing rank change:', error);
            }
        }
    }
    
    /**
     * Check if promotion should be shown (based on view count)
     */
    async shouldShowPromotion(promotionId, playerName) {
        if (!promotionId || !playerName) {
            return true; // Default to showing if missing data
        }
        
        try {
            const docId = `promotion_${promotionId}_${playerName}`;
            const viewsRef = doc(db, 'promotionViews', docId);
            const viewsDoc = await getDoc(viewsRef);
            
            if (!viewsDoc.exists()) {
                // First view - create document
                await setDoc(viewsRef, { 
                    promotionId,
                    playerName,
                    views: 1,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                });
                console.log(`First view for promotion ${promotionId}`);
                return true;
            }
            
            const data = viewsDoc.data();
            const currentViews = data.views || 0;
            
            // Check if max views reached
            if (currentViews >= this.MAX_VIEWS) {
                console.log(`Max views (${this.MAX_VIEWS}) reached for promotion ${promotionId}`);
                return false;
            }
            
            // Increment view count
            await setDoc(viewsRef, {
                promotionId,
                playerName,
                views: currentViews + 1,
                updatedAt: serverTimestamp(),
                createdAt: data.createdAt
            }, { merge: true });
            
            console.log(`View ${currentViews + 1}/${this.MAX_VIEWS} for promotion ${promotionId}`);
            return true;
        } catch (error) {
            console.error('Error checking promotion views:', error);
            return true; // Default to showing if error
        }
    }
    
    /**
     * Display rank change banner
     */
    showRankChangeBanner(data) {
        // Ensure we never exceed 3 banners
        while (this.bannerContainer.children.length >= 3) {
            this.bannerContainer.removeChild(this.bannerContainer.firstChild);
        }
        
        const bannerDiv = document.createElement('div');
        bannerDiv.className = 'promotion-banner clickable';
        bannerDiv.setAttribute('data-rank', data.rankAchieved);
        
        const details = document.createElement('div');
        details.className = 'promotion-details';
        
        // Format based on promotion type
        const message = data.type === 'promotion' 
            ? `${data.player} was promoted to` 
            : `${data.player} was demoted to`;
            
        details.innerHTML = `${message} <span class="rank-text">${data.rankAchieved}</span>`;
        
        bannerDiv.appendChild(details);
        this.bannerContainer.appendChild(bannerDiv);
        this.bannerContainer.style.display = 'block';
        
        // Make banner clickable to dismiss
        bannerDiv.addEventListener('click', () => {
            bannerDiv.classList.add('dismissing');
            setTimeout(() => {
                bannerDiv.remove();
                if (this.bannerContainer.children.length === 0) {
                    this.bannerContainer.style.display = 'none';
                }
            }, 300);
        });
        
        // Animation and auto-dismiss timing
        setTimeout(() => {
            bannerDiv.classList.add('new-rank-change');
            
            // Auto-dismiss after 10 seconds
            setTimeout(() => {
                bannerDiv.classList.remove('new-rank-change');
                setTimeout(() => {
                    if (bannerDiv.parentNode) {
                        bannerDiv.remove();
                        if (this.bannerContainer.children.length === 0) {
                            this.bannerContainer.style.display = 'none';
                        }
                    }
                }, 5000);
            }, 10000);
        }, 100);
    }
    
    /**
     * Display rank change lightbox for personal promotions
     */
    showRankChangeLightbox(type, rankName) {
        let modal = document.getElementById('rankChangeModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'rankChangeModal';
            modal.className = `rank-change-modal ${type}`;
            document.body.appendChild(modal);
        }
        
        const title = type === 'promotion' ? 'Congratulations!' : 'Rank Update';
        const message = type === 'promotion' ? "You've been promoted to" : "You've been demoted to";
        
        modal.innerHTML = `
            <div class="rank-change-content">
                <h2 class="rank-change-title">${title}</h2>
                <p>${message}</p>
                <h3 class="rank-name">${rankName}</h3>
                <button class="rank-change-button" id="rank-change-ok-btn">
                    Got it!
                </button>
            </div>
        `;
        
        modal.style.display = 'flex';
        
        // Add close button handler
        document.getElementById('rank-change-ok-btn').addEventListener('click', () => {
            modal.style.display = 'none';
        });
        
        // Close when clicking outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
    }
    
    /**
     * Check if a player has been promoted based on ELO change
     */
    async checkAndRecordPromotion(userId, newElo, oldElo) {
        try {
            // Find which rank threshold was crossed
            const rankCrossed = this.RANKS.find(rank => 
                oldElo < rank.threshold && newElo >= rank.threshold
            );
            
            if (!rankCrossed) return null;
            
            // Get user data
            const userDoc = await getDoc(doc(db, 'players', userId));
            if (!userDoc.exists()) {
                console.error('User document not found');
                return null;
            }
            
            const userData = userDoc.data();
            const username = userData.username || 'Unknown Player';
            
            // Record in eloHistory (for banner display)
            await addDoc(collection(db, 'eloHistory'), {
                player: username,
                type: 'promotion',
                rankAchieved: rankCrossed.name,
                timestamp: serverTimestamp(),
                previousElo: oldElo,
                newElo: newElo
            });
            
            // Record in promotionHistory (for historical tracking)
            await addDoc(collection(db, 'promotionHistory'), {
                username: username,
                rank: rankCrossed.name,
                timestamp: serverTimestamp(),
                userId: userId,
                previousElo: oldElo,
                newElo: newElo,
                type: 'promotion'
            });
            
            console.log(`Recorded promotion for ${username} to ${rankCrossed.name}`);
            return rankCrossed.name;
        } catch (error) {
            console.error('Error in promotion recording:', error);
            return null;
        }
    }
    
    /**
     * Get rank name from ELO rating
     */
    getRankName(elo) {
        for (let i = this.RANKS.length - 1; i >= 0; i--) {
            if (elo >= this.RANKS[i].threshold) {
                return this.RANKS[i].name;
            }
        }
        return 'Unranked';
    }
    
    /**
     * Clean up resources
     */
    cleanup() {
        if (this.unsubscribe) {
            this.unsubscribe();
        }
    }
}

// Create and export a singleton instance
export const promotionManager = new PromotionManager();

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    promotionManager.initialize();
});

// For backwards compatibility
export const initializePromotionTracker = () => promotionManager.initialize();
export const checkAndRecordPromotion = (userId, newElo, oldElo) => 
    promotionManager.checkAndRecordPromotion(userId, newElo, oldElo);
export const getRankName = (elo) => promotionManager.getRankName(elo);