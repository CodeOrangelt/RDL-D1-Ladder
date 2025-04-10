import { 
    collection, 
    doc,
    query, 
    where, 
    orderBy, 
    limit, 
    getDocs,
    addDoc,
    getDoc,
    serverTimestamp,
    writeBatch
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { auth, db } from './firebase-config.js';

/**
 * PromotionManager - Handles all promotion-related functionality with reduced Firebase load
 */
class PromotionManager {
    constructor() {
        // Configuration
        this.DISPLAY_HOURS = 24; // Hours to wait before showing the same promotion again
        this.RANKS = [
            { threshold: 1400, name: 'Bronze', color: '#CD7F32' },
            { threshold: 1600, name: 'Silver', color: '#C0C0C0' },
            { threshold: 1800, name: 'Gold', color: '#FFD700' },
            { threshold: 2100, name: 'Emerald', color: '#50C878' }
        ];
        
        // State
        this.bannerContainer = null;
        this.lastFetchTime = 0;
        this.fetchInterval = 60000; // 1 minute between fetches
        this.pollingInterval = null;
        
        // Cache for username resolution
        this.usernameCache = {};
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
        
        // Initial fetch of promotions
        this.fetchRecentPromotions();
        
        // Set up polling instead of real-time listener
        this.pollingInterval = setInterval(() => {
            this.fetchRecentPromotions();
        }, this.fetchInterval);
        
        // Clean up on page unload
        window.addEventListener('beforeunload', () => {
            if (this.pollingInterval) {
                clearInterval(this.pollingInterval);
            }
        });
    }
    
    /**
     * Setup the banner container
     */
    setupBannerContainer() {
        this.bannerContainer.innerHTML = '';
        this.bannerContainer.style.display = 'none';
    }
    
    /**
     * Fetch recent promotions - replaces the real-time listener
     */
    async fetchRecentPromotions() {
        try {
            const now = Date.now();
            
            // Don't fetch too often
            if (now - this.lastFetchTime < this.fetchInterval) {
                return;
            }
            
            this.lastFetchTime = now;
            
            const historyRef = collection(db, 'eloHistory');
            const q = query(
                historyRef, 
                where('type', 'in', ['promotion', 'demotion']),
                orderBy('timestamp', 'desc'), 
                limit(5)
            );
            
            const snapshot = await getDocs(q);
            await this.processRankChanges(snapshot);
        } catch (error) {
            console.error('Error fetching promotions:', error);
        }
    }
    
    /**
     * Process snapshot of rank changes
     */
    async processRankChanges(snapshot) {
        const rankChanges = [];
        
        snapshot.forEach(doc => {
            rankChanges.push({ id: doc.id, ...doc.data() });
        });
        
        if (rankChanges.length === 0) {
            return;
        }
        
        // Sort by timestamp (newest first)
        rankChanges.sort((a, b) => {
            // Handle missing timestamps
            const aTime = a.timestamp?.toMillis?.() || 0;
            const bTime = b.timestamp?.toMillis?.() || 0;
            return bTime - aTime;
        });
        
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
                // Check if we should show this promotion based on localStorage
                if (this.shouldShowPromotion(rankChange.id)) {
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
     * Check if promotion should be shown (based on localStorage)
     */
    shouldShowPromotion(promotionId) {
        try {
            const storageKey = `promotion_${promotionId}`;
            const storedData = localStorage.getItem(storageKey);
            
            if (storedData) {
                const data = JSON.parse(storedData);
                
                // Check if permanently ignored
                if (data.ignored) {
                    return false;
                }
                
                // Check if within time window
                const now = Date.now();
                if (now - data.timestamp < this.DISPLAY_HOURS * 60 * 60 * 1000) {
                    // Only prevent showing if the user explicitly dismissed it
                    if (data.userDismissed) {
                        return false;
                    }
                }
            }
            
            // IMPORTANT: Don't set timestamp here - we'll set it when actually showing the banner
            return true;
        } catch (error) {
            console.error('Error checking promotion visibility:', error);
            return false;
        }
    }
    
    /**
     * Mark a promotion as permanently ignored
     */
    ignorePromotion(promotionId) {
        try {
            const storageKey = `promotion_${promotionId}`;
            localStorage.setItem(storageKey, JSON.stringify({
                timestamp: Date.now(),
                ignored: true
            }));
        } catch (error) {
            console.error('Error saving promotion preference:', error);
        }
    }
    
    /**
     * Display rank change banner
     */
    showRankChangeBanner(data) {
        // Resolve user ID to username if needed
        this.resolveUserId(data)
            .then(resolvedData => {
                // Record that we're showing this banner now
                const storageKey = `promotion_${data.id}`;
                localStorage.setItem(storageKey, JSON.stringify({
                    timestamp: Date.now(),
                    ignored: false,
                    userDismissed: false
                }));
                
                // Ensure we never exceed 3 banners
                while (this.bannerContainer.children.length >= 3) {
                    this.bannerContainer.removeChild(this.bannerContainer.firstChild);
                }
                
                const bannerDiv = document.createElement('div');
                bannerDiv.className = 'promotion-banner';
                bannerDiv.setAttribute('data-rank', resolvedData.rankAchieved);
                bannerDiv.setAttribute('data-id', resolvedData.id);
                
                const details = document.createElement('div');
                details.className = 'promotion-details';
                
                // Use the resolved player name
                const playerName = resolvedData.resolvedName || resolvedData.player || resolvedData.username || 
                                  resolvedData.playerUsername || resolvedData.displayName || 'A player';
                
                // Format based on promotion type
                const message = resolvedData.type === 'promotion' 
                    ? `${playerName} was promoted to` 
                    : `${playerName} was demoted to`;
                    
                details.innerHTML = `${message} <span class="rank-text">${resolvedData.rankAchieved}</span>`;
                
                // Close button only - no ignore option
                const actions = document.createElement('div');
                actions.className = 'banner-actions';
                
                const dismissBtn = document.createElement('button');
                dismissBtn.className = 'dismiss-btn';
                dismissBtn.innerHTML = '&times;';
                dismissBtn.title = 'Dismiss';
                
                actions.appendChild(dismissBtn);
                
                bannerDiv.appendChild(details);
                bannerDiv.appendChild(actions);
                this.bannerContainer.appendChild(bannerDiv);
                this.bannerContainer.style.display = 'block';
                
                // Dismiss button handler - ALWAYS mark as user-dismissed
                dismissBtn.addEventListener('click', () => {
                    // Any manual dismissal means "don't show for 24 hours"
                    localStorage.setItem(storageKey, JSON.stringify({
                        timestamp: Date.now(),
                        ignored: false,
                        userDismissed: true
                    }));
                    
                    bannerDiv.classList.add('dismissing');
                    setTimeout(() => {
                        bannerDiv.remove();
                        if (this.bannerContainer.children.length === 0) {
                            this.bannerContainer.style.display = 'none';
                        }
                    }, 300);
                });
                
                // Auto-dismiss should NOT update the timestamp
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
            });
    }

    /**
     * Helper method to resolve user IDs to usernames
     * This is a critical fix for the promotions system
     */
    async resolveUserId(data) {
        // Clone data to avoid modifying original
        const resolvedData = {...data};
        
        // If we already have a non-ID username, return immediately
        const possibleUsernames = [data.player, data.username, data.playerUsername, data.displayName];
        const hasValidUsername = possibleUsernames.some(name => 
            name && typeof name === 'string' && 
            !name.includes('ID:') && 
            !(/^[a-zA-Z0-9]{20,}$/.test(name)) // Not likely a Firebase ID
        );
        
        if (hasValidUsername) {
            return resolvedData;
        }
        
        // Extract possible user ID
        let userId = null;
        
        // Check all possible ID fields
        if (data.userId) {
            userId = data.userId;
        } else if (data.player && /^[A-Za-z0-9]{20,}$/.test(data.player)) {
            userId = data.player;
        }
        
        if (!userId) {
            return resolvedData;
        }
                
        try {
            // Step 1: Check players collection first (most reliable)
            const userDoc = await getDoc(doc(db, 'players', userId));
            if (userDoc.exists()) {
                const userData = userDoc.data();
                if (userData.username) {
                    resolvedData.resolvedName = userData.username;
                    return resolvedData;
                }
            }
            
            // Step 2: Check recent matches for this user ID
            const winnerMatches = await getDocs(
                query(collection(db, 'approvedMatches'), 
                      where('winnerId', '==', userId),
                      orderBy('date', 'desc'),
                      limit(1))
            );
            
            if (!winnerMatches.empty) {
                const winnerData = winnerMatches.docs[0].data();
                if (winnerData.winnerUsername) {
                    resolvedData.resolvedName = winnerData.winnerUsername;
                    return resolvedData;
                }
            }
            
            // Step 3: Check as loser
            const loserMatches = await getDocs(
                query(collection(db, 'approvedMatches'), 
                      where('loserId', '==', userId),
                      orderBy('date', 'desc'),
                      limit(1))
            );
            
            if (!loserMatches.empty) {
                const loserData = loserMatches.docs[0].data();
                if (loserData.loserUsername) {
                    resolvedData.resolvedName = loserData.loserUsername;
                    console.log(`Resolved ${userId} to ${loserData.loserUsername} (loser)`);
                    return resolvedData;
                }
            }
        } catch (error) {
            console.error('Error resolving user ID:', error);
        }
        
        console.warn(`Failed to resolve user ID: ${userId}`);
        return resolvedData;
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
     * Check if a player has been promoted or demoted based on ELO change
     * This should be called after any ELO changes
     */
    async checkAndRecordPromotion(userId, newElo, oldElo, options = {}) {
        try {
            // Don't process if ELO hasn't changed or user ID is missing
            if (newElo === oldElo || !userId) {
                return null;
            }

            // Default options
            const source = options.source || 'automatic';
            const matchId = options.matchId || null;
            const adminUser = options.adminUser || null;
            
            console.log(`Processing potential rank change: ${oldElo} → ${newElo} (source: ${source})`);

            // Enhanced username resolution - CRITICAL FOR DISPLAYING CORRECT NAME
            let username = null;
            let displayName = null;
            
            try {
                // First try: Get from players collection (most accurate)
                const userDoc = await getDoc(doc(db, 'players', userId));
                if (userDoc.exists()) {
                    const userData = userDoc.data();
                    username = userData.username || userData.displayName || null;
                    displayName = userData.displayName || userData.username || null;
                }
                
                // Second try: Check if username was provided in options
                if (!username && options.username) {
                    username = options.username;
                    displayName = options.username;
                }
                
                // Third try: Use auth.currentUser as fallback
                if (!username && auth.currentUser) {
                    username = auth.currentUser.displayName || auth.currentUser.email.split('@')[0];
                    displayName = auth.currentUser.displayName || null;
                }
                
                // Last resort: Try to find in match history
                if (!username) {
                    // Try checking matches for this userId
                    const matchesQuery = query(
                        collection(db, 'approvedMatches'),
                        where('winnerId', '==', userId),
                        limit(1)
                    );
                    
                    const matchDocs = await getDocs(matchesQuery);
                    if (!matchDocs.empty) {
                        username = matchDocs.docs[0].data().winnerUsername || 'Unknown Player';
                        displayName = username;
                    } else {
                        // Try as loser
                        const loserQuery = query(
                            collection(db, 'approvedMatches'),
                            where('loserId', '==', userId),
                            limit(1)
                        );
                        
                        const loserDocs = await getDocs(loserQuery);
                        if (!loserDocs.empty) {
                            username = loserDocs[0].data().loserUsername || 'Unknown Player';
                            displayName = username;
                        }
                    }
                }
            } catch (error) {
                console.error('Error resolving username:', error);
            }

            // If we still don't have a username, use a placeholder
            if (!username) {
                console.warn('Could not resolve username for userId:', userId);
                username = 'A player';
                displayName = 'Unknown Player';
            }
            
            // Get old and new ranks
            const oldRank = this.getRankName(oldElo);
            const newRank = this.getRankName(newElo);
            
            // Only create promotion/demotion if the rank changed
            if (oldRank !== newRank) {
                const isPromotion = newElo > oldElo;
                const type = isPromotion ? 'promotion' : 'demotion';
                const rankAchieved = newRank;
                
                console.log(`Recording ${type} for ${username}: ${oldElo} (${oldRank}) → ${newElo} (${newRank})`);
                
                try {
                    // Common fields using CONSISTENT NAMING for player identity
                    const commonFields = {
                        // Use ALL possible fields to ensure compatibility
                        player: username,           // Primary field for display
                        playerUsername: username,    // For compatibility
                        username: username,          // For compatibility
                        displayName: displayName,    // For auth integration
                        userId: userId,              // Keep userId for reference
                        type: type,
                        rankAchieved: rankAchieved,
                        timestamp: serverTimestamp(),
                        previousElo: oldElo,
                        newElo: newElo,
                        change: newElo - oldElo,
                        previousRank: oldRank,
                        newRank: newRank,
                        source: source
                    };
                    
                    // Add match-specific or admin-specific fields
                    if (source === 'match' && matchId) {
                        commonFields.matchId = matchId;
                    } else if (source === 'admin' && adminUser) {
                        commonFields.modifiedBy = adminUser;
                        commonFields.isAutomatic = false;
                    } else {
                        commonFields.isAutomatic = true;
                    }
                    
                    // Use batch write
                    const batch = writeBatch(db);
                    
                    // Create records in both collections
                    const eloHistoryRef = doc(collection(db, 'eloHistory'));
                    const promotionHistoryRef = doc(collection(db, 'promotionHistory'));
                    
                    batch.set(eloHistoryRef, commonFields);
                    batch.set(promotionHistoryRef, commonFields);
                    
                    await batch.commit();
                    
                    console.log(`Successfully recorded ${type} for ${username} to ${rankAchieved}`);
                    return rankAchieved;
                } catch (error) {
                    console.error('Error writing promotion records:', error);
                    
                    // Fallback to individual write if batch fails
                    try {
                        await addDoc(collection(db, 'eloHistory'), {
                            player: username,
                            playerUsername: username,
                            username: username,
                            displayName: displayName,
                            userId: userId,
                            type: type,
                            rankAchieved: rankAchieved,
                            timestamp: serverTimestamp(),
                            previousElo: oldElo,
                            newElo: newElo,
                            change: newElo - oldElo,
                            previousRank: oldRank,
                            source: source,
                            isAutomatic: source !== 'admin'
                        });
                        
                        return rankAchieved;
                    } catch (fallbackError) {
                        console.error('Fallback write failed:', fallbackError);
                        return null;
                    }
                }
            }
            
            return null;
        } catch (error) {
            console.error('Error in promotion/demotion recording:', error);
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
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
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
export const checkAndRecordPromotion = (userId, newElo, oldElo, options) => 
    promotionManager.checkAndRecordPromotion(userId, newElo, oldElo, options);
export const getRankName = (elo) => promotionManager.getRankName(elo);