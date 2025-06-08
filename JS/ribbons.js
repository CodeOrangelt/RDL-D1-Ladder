// Add the missing imports at the top
import { auth, db } from './firebase-config.js';
import { 
    doc, 
    getDoc, 
    setDoc, 
    collection, 
    query, 
    where, 
    getDocs,
    limit
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

// Ribbon definitions with correct image paths
const RIBBON_DEFINITIONS = {
    'Rematch Ribbon': {
        description: 'Beat a pilot with the "Rematch" subgame selected',
        image: '../images/ribbons/Rematch.png',
        color: '#FF6B6B'
    },
    'Overachiever Ribbon': {
        description: 'Played over 100 matches',
        image: '../images/ribbons/Overachiever.png',
        color: '#96CEB4',
        levels: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]
    },
    'Brick Wall': {
        description: 'Amass at least 80% overall win rate percentage',
        image: '../images/ribbons/BrickWall.png',
        color: '#F0932B',
        levels: [80, 85, 90, 95, 100]
    },
    'Collector Ribbon': {
        description: 'Hold more than 5 ribbons at a time',
        image: '../images/ribbons/Collector.png',
        color: '#6C5CE7',
        levels: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]
    },
    'Sub-Gamer Ribbon': {
        description: 'Play over 50 subgame matches in one season',
        image: '../images/ribbons/Rematch.png',
        color: '#A29BFE',
        levels: [50, 100, 150, 200, 250, 300, 350, 400, 450, 500]
    },
    'Explorer Ribbon': {
        description: 'Played at least 20 unique maps',
        image: '../images/ribbons/Explorer.png',
        color: '#55A3FF',
        levels: [20, 40, 60, 80, 100, 120, 140, 160, 180, 200]
    },
    'Socialite Ribbon': {
        description: 'Played at least 10 unique pilots',
        image: '../images/ribbons/Socialite.png',
        color: '#FF7675',
        levels: [10, 15, 20, 25, 30, 35, 40, 45, 50, 55]
    },
    'Underdog Ribbon': {
        description: 'Beat a pilot ranked significantly higher than you',
        image: '../images/ribbons/Underdog.png',
        color: '#FF9500',
        levels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] 
    }
};

export const RIBBON_CSS = `
/* Stats integration styles */
.ribbon-section {
    grid-column: 1 / -1;
    margin-top: 1rem;
}

.ribbon-stat-item.full-width {
    grid-column: 1 / -1;
    margin-bottom: 0;
}

/* Military Ribbon Rack Styling - NO OUTER CONTAINER */
.ribbon-rack-inline {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0;
    background: transparent;
    border: none;
    box-shadow: none;
    margin-top: 20px;
    max-width: 100%;
    align-items: flex-start;
}

.ribbon-rack-empty-inline {
    text-align: center;
    padding: 60px 40px;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 12px;
    border: 2px solid rgba(255, 255, 255, 0.1);
    margin-top: 20px;
}

.empty-rack-text {
    color: #888;
    font-style: italic;
    font-size: 1.2rem;
}

/* Ribbon Rows */
.ribbon-row {
    display: flex;
    gap: 6px;
    margin-bottom: 6px;
    justify-content: flex-start;
}

.ribbon-row:nth-child(even) {
    margin-left: 60px;
}

/* Individual Military Ribbon Styling - FIXED OVERFLOW FOR LEVEL INDICATOR */
.military-ribbon {
    position: relative;
    cursor: pointer;
    transition: transform 0.3s ease;
    flex-shrink: 0;
    width: 190px;
    height: 60px;
    border: 3px solid #333;
    border-radius: 4px;
    overflow: visible; /* Changed from hidden to visible */
    box-shadow: 0 4px 12px rgba(0,0,0,0.8);
    margin: 12px 12px 12px 0; /* Added margin to prevent clipping */
}

.military-ribbon:hover {
    transform: translateY(-4px);
    z-index: 10;
}

/* Ribbon image container to handle the actual overflow */
.ribbon-image-container {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: 1px;
}

.ribbon-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    image-rendering: crisp-edges;
}

.ribbon-fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    font-weight: bold;
    color: white;
    text-shadow: 0 2px 4px rgba(0,0,0,0.8);
    text-align: center;
    line-height: 1;
    position: absolute;
    top: 0;
    left: 0;
}

.ribbon-name {
    font-size: 14px;
    color: rgba(255, 255, 255, 0.9);
    text-align: center;
    line-height: 1.2;
    margin-top: 6px;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    position: absolute;
    bottom: -24px;
    left: 50%;
    transform: translateX(-50%);
    display: none;
    font-weight: 500;
}

.military-ribbon:hover .ribbon-name {
    display: block;
}

.ribbon-devices {
    position: absolute;
    top: 50%;
    right: 6px;
    transform: translateY(-50%);
    display: flex;
    gap: 3px;
    z-index: 5;
}

.ribbon-device {
    font-size: 14px;
    text-shadow: 0 0 4px rgba(0,0,0,0.9);
    filter: drop-shadow(0 2px 4px rgba(0,0,0,0.8));
}

.bronze-star {
    color: #CD7F32;
}

.silver-star {
    color: #C0C0C0;
}

.gold-star {
    color: #FFD700;
}

/* Level indicator - NOW FULLY VISIBLE */
.ribbon-level-indicator {
    position: absolute;
    top: -8px;
    right: -8px;
    background: #FFD700;
    color: #000;
    border-radius: 50%;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: bold;
    border: 3px solid #FFF;
    box-shadow: 0 4px 8px rgba(0,0,0,0.7);
    z-index: 6;
}

/* Custom tooltip - only this one will show */
.military-ribbon::before {
    content: attr(data-tooltip);
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0,0,0,0.95);
    color: white;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 12px;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s;
    z-index: 1000;
    text-align: center;
    margin-bottom: 8px;
    border: 1px solid rgba(255, 255, 255, 0.2);
}

.military-ribbon:hover::before {
    opacity: 1;
}

/* Responsive adjustments */
@media (max-width: 1024px) {
    .military-ribbon {
        width: 100px;
        height: 34px;
        margin: 8px 8px 8px 0;
    }
    
    .ribbon-device {
        font-size: 12px;
    }
    
    .ribbon-level-indicator {
        width: 20px;
        height: 20px;
        font-size: 10px;
        top: -6px;
        right: -6px;
    }
    
    .ribbon-row:nth-child(even) {
        margin-left: 52px;
    }
    
    .ribbon-name {
        font-size: 12px;
        bottom: -20px;
    }
}

@media (max-width: 768px) {
    .military-ribbon {
        width: 80px;
        height: 28px;
        margin: 6px 6px 6px 0;
    }
    
    .ribbon-device {
        font-size: 10px;
    }
    
    .ribbon-level-indicator {
        width: 18px;
        height: 18px;
        font-size: 9px;
        top: -5px;
        right: -5px;
    }
    
    .ribbon-row:nth-child(even) {
        margin-left: 42px;
    }
    
    .ribbon-name {
        font-size: 11px;
        bottom: -18px;
    }
    
    .ribbon-rack-inline {
        gap: 5px;
    }
}

@media (max-width: 480px) {
    .military-ribbon {
        width: 70px;
        height: 24px;
        margin: 5px 5px 5px 0;
    }
    
    .ribbon-row:nth-child(even) {
        margin-left: 36px;
    }
    
    .ribbon-rack-inline {
        gap: 4px;
    }
    
    .ribbon-level-indicator {
        width: 16px;
        height: 16px;
        font-size: 8px;
        top: -4px;
        right: -4px;
    }
}

.stats-grid .ribbon-section {
    background: transparent;
    border: none;
    padding: 0;
}

.stats-grid .ribbon-stat-item {
    background-color: rgba(0, 0, 0, 0.3);
    padding: 25px;
    border-radius: 10px;
    text-align: center;
}

.stats-grid .ribbon-stat-item .stat-label {
    font-size: 16px;
    text-transform: uppercase;
    opacity: 0.9;
    margin-bottom: 20px;
    color: rgba(255, 255, 255, 0.95);
    font-weight: bold;
}

.ribbon-level-indicator.level-1 { background: #808080; }
.ribbon-level-indicator.level-2 { background: #CD7F32; }
.ribbon-level-indicator.level-3 { background: #b9f1fc; }
.ribbon-level-indicator.level-4 { background: #FFD700; }
.ribbon-level-indicator.level-5-plus { background: #50C878; }
`;

// Enhanced caching system with additional optimizations
class RibbonCacheManager {
    constructor() {
        this.memoryCache = new Map();
        this.CACHE_DURATION = 30 * 60 * 1000; // 30 minutes
        this.CACHE_KEY_PREFIX = 'ribbon_cache_';
        this.lastCleanup = Date.now();
        this.CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
    }

    getCacheKey(username, ladder) {
        return `${this.CACHE_KEY_PREFIX}${username}_${ladder}`;
    }

    getCachedData(username, ladder) {
        this.autoCleanup();
        
        const cacheKey = this.getCacheKey(username, ladder);
        
        if (this.memoryCache.has(cacheKey)) {
            const cached = this.memoryCache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.CACHE_DURATION) {
                console.log(`🚀 Cache hit (memory) for ${username}`);
                return cached.data;
            }
            this.memoryCache.delete(cacheKey);
        }
        
        const localCached = localStorage.getItem(cacheKey);
        if (localCached) {
            try {
                const data = JSON.parse(localCached);
                if (Date.now() - data.timestamp < this.CACHE_DURATION) {
                    this.memoryCache.set(cacheKey, {
                        data: data.ribbons,
                        timestamp: data.timestamp,
                        matchCount: data.matchCount
                    });
                    console.log(`💾 Cache hit (localStorage) for ${username}`);
                    return data.ribbons;
                }
                localStorage.removeItem(cacheKey);
            } catch (e) {
                localStorage.removeItem(cacheKey);
            }
        }
        return null;
    }

    setCachedData(username, ladder, ribbons, matchCount) {
        const cacheKey = this.getCacheKey(username, ladder);
        const timestamp = Date.now();
        
        this.memoryCache.set(cacheKey, {
            data: ribbons,
            timestamp,
            matchCount
        });
        
        try {
            const data = {
                ribbons,
                matchCount,
                timestamp,
                version: 3
            };
            localStorage.setItem(cacheKey, JSON.stringify(data));
        } catch (e) {
            this.clearOldCache();
            try {
                localStorage.setItem(cacheKey, JSON.stringify(data));
            } catch (e2) {
                // Continue without localStorage cache
            }
        }
    }

    shouldRefreshCache(username, ladder, currentMatchCount) {
        const cacheKey = this.getCacheKey(username, ladder);
        
        if (this.memoryCache.has(cacheKey)) {
            const cached = this.memoryCache.get(cacheKey);
            return cached.matchCount !== currentMatchCount;
        }
        
        const localCached = localStorage.getItem(cacheKey);
        if (localCached) {
            try {
                const data = JSON.parse(localCached);
                return data.matchCount !== currentMatchCount;
            } catch (e) {
                return true;
            }
        }
        return true;
    }

    autoCleanup() {
        const now = Date.now();
        if (now - this.lastCleanup > this.CLEANUP_INTERVAL) {
            this.cleanup();
            this.lastCleanup = now;
        }
    }

    cleanup() {
        const now = Date.now();
        let cleanedMemory = 0;
        let cleanedStorage = 0;
        
        for (const [key, value] of this.memoryCache.entries()) {
            if (now - value.timestamp > this.CACHE_DURATION) {
                this.memoryCache.delete(key);
                cleanedMemory++;
            }
        }
        
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (key && key.startsWith(this.CACHE_KEY_PREFIX)) {
                try {
                    const data = JSON.parse(localStorage.getItem(key));
                    if (now - data.timestamp > this.CACHE_DURATION) {
                        localStorage.removeItem(key);
                        cleanedStorage++;
                    }
                } catch (e) {
                    localStorage.removeItem(key);
                    cleanedStorage++;
                }
            }
        }
    }

    clearOldCache() {
        const entries = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(this.CACHE_KEY_PREFIX)) {
                try {
                    const data = JSON.parse(localStorage.getItem(key));
                    entries.push({ key, timestamp: data.timestamp });
                } catch (e) {
                    localStorage.removeItem(key);
                }
            }
        }
        
        entries.sort((a, b) => a.timestamp - b.timestamp);
        const toRemove = Math.floor(entries.length / 2);
        for (let i = 0; i < toRemove; i++) {
            localStorage.removeItem(entries[i].key);
        }
    }

    getCacheStats() {
        return {
            memoryEntries: this.memoryCache.size,
            lastCleanup: new Date(this.lastCleanup).toLocaleTimeString()
        };
    }
}

class MatchCacheManager {
    constructor() {
        this.matchCache = new Map();
        this.CACHE_DURATION = 15 * 60 * 1000; // 15 minutes
        this.lastCleanup = Date.now();
    }

    getCachedMatches(username, ladder) {
        this.autoCleanup();
        
        const key = `${username}_${ladder}`;
        const cached = this.matchCache.get(key);
        
        if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
            console.log(`🎯 Cache hit (matches) for ${username}`);
            return cached.matches;
        }
        
        if (cached) {
            this.matchCache.delete(key);
        }
        return null;
    }

    setCachedMatches(username, ladder, matches) {
        const key = `${username}_${ladder}`;
        this.matchCache.set(key, {
            matches,
            timestamp: Date.now()
        });
    }

    autoCleanup() {
        const now = Date.now();
        if (now - this.lastCleanup > 5 * 60 * 1000) {
            let cleaned = 0;
            for (const [key, value] of this.matchCache.entries()) {
                if (now - value.timestamp > this.CACHE_DURATION) {
                    this.matchCache.delete(key);
                    cleaned++;
                }
            }
            this.lastCleanup = now;
        }
    }

    getCacheStats() {
        return {
            entries: this.matchCache.size,
            lastCleanup: new Date(this.lastCleanup).toLocaleTimeString()
        };
    }
}

class RibbonSystem {
    constructor() {
        this.pendingEvaluations = new Map();
        this.batchTimer = null;
        this.BATCH_DELAY = 50;
    }

    async evaluateAllRibbonsForPlayerOptimized(playerUsername, ladder = 'D1') {
        try {
            const cachedRibbons = ribbonCache.getCachedData(playerUsername, ladder);
            if (cachedRibbons) {
                return cachedRibbons;
            }

            const [playerData, currentRibbons] = await Promise.all([
                this.getPlayerDataCached(playerUsername, ladder),
                this.getPlayerRibbonsCached(playerUsername, ladder)
            ]);

            if (!playerData) {
                return {};
            }

            const playerMatchCount = playerData.matchesPlayed || 0;
            if (!ribbonCache.shouldRefreshCache(playerUsername, ladder, playerMatchCount)) {
                ribbonCache.setCachedData(playerUsername, ladder, currentRibbons, playerMatchCount);
                return currentRibbons;
            }

            const matches = await this.getPlayerMatchesOptimized(playerUsername, ladder);
            const newRibbons = this.evaluateAllRibbonsFromData(matches, playerData, currentRibbons);

            if (Object.keys(newRibbons).length > 0) {
                await this.savePlayerRibbonsOptimized(playerUsername, newRibbons, ladder);
            }

            const finalRibbons = { ...currentRibbons, ...newRibbons };
            ribbonCache.setCachedData(playerUsername, ladder, finalRibbons, matches.length);

            return finalRibbons;

        } catch (error) {
            console.error('❌ Error in ribbon evaluation:', error);
            return {};
        }
    }

    // Check if a victory qualifies as an underdog win
    isUnderdogVictory(match, playerUsername) {
        const isWinner = match.winnerUsername === playerUsername;
        if (!isWinner) return false;

        // Get ratings from match data
        const winnerRating = match.winnerRating || 0;
        const loserRating = match.loserRating || 0;
        
        // For underdog victory, winner's rating should be significantly lower than loser's
        // Threshold: at least 100 rating points difference
        const ratingDifference = loserRating - winnerRating;
        
        return ratingDifference >= 100;
    }

    async getPlayerMatchesOptimized(username, ladder) {
        const cachedMatches = matchCache.getCachedMatches(username, ladder);
        if (cachedMatches) {
            return cachedMatches;
        }

        try {
            const matchesCollection = ladder === 'D1' ? 'approvedMatches' : 
                                     ladder === 'D2' ? 'approvedMatchesD2' : 'approvedMatchesD3';
            
            const approvedMatchesRef = collection(db, matchesCollection);
            
            const [winnerSnapshot, loserSnapshot] = await Promise.all([
                getDocs(query(approvedMatchesRef, where('winnerUsername', '==', username))),
                getDocs(query(approvedMatchesRef, where('loserUsername', '==', username)))
            ]);
            
            const matchIds = new Set();
            const matches = [];
            
            winnerSnapshot.forEach(doc => {
                if (!matchIds.has(doc.id)) {
                    matchIds.add(doc.id);
                    const matchData = { id: doc.id, ...doc.data() };
                    
                    // Ensure we have rating data for underdog calculations
                    if (!matchData.winnerRating) matchData.winnerRating = 0;
                    if (!matchData.loserRating) matchData.loserRating = 0;
                    
                    matches.push(matchData);
                }
            });
            
            loserSnapshot.forEach(doc => {
                if (!matchIds.has(doc.id)) {
                    matchIds.add(doc.id);
                    const matchData = { id: doc.id, ...doc.data() };
                    
                    // Ensure we have rating data for underdog calculations
                    if (!matchData.winnerRating) matchData.winnerRating = 0;
                    if (!matchData.loserRating) matchData.loserRating = 0;
                    
                    matches.push(matchData);
                }
            });
            
            matchCache.setCachedMatches(username, ladder, matches);
            return matches;
        } catch (error) {
            console.error('❌ Error fetching matches:', error);
            return [];
        }
    }

    evaluateAllRibbonsFromData(matches, playerData, currentRibbons) {
        const newRibbons = {};
        const playerUsername = playerData.username;
        
        const stats = {
            totalMatches: matches.length,
            wins: 0,
            rematchWins: 0,
            subgameMatches: 0,
            uniqueMaps: new Set(),
            uniqueOpponents: new Set(),
            underdogWins: 0
        };
        
        matches.forEach(match => {
            const isWinner = match.winnerUsername === playerUsername;
            const opponent = isWinner ? match.loserUsername : match.winnerUsername;
            
            if (isWinner) {
                stats.wins++;
                if (match.subgameType === 'Rematch') {
                    stats.rematchWins++;
                }
                
                // Check for underdog victory
                if (this.isUnderdogVictory(match, playerUsername)) {
                    stats.underdogWins++;
                }
            }
            
            if (match.subgameType && match.subgameType !== 'Standard') {
                stats.subgameMatches++;
            }
            
            if (match.mapPlayed) {
                stats.uniqueMaps.add(match.mapPlayed);
            }
            
            if (opponent) {
                stats.uniqueOpponents.add(opponent);
            }
        });

        const winRate = stats.totalMatches > 0 ? (stats.wins / stats.totalMatches) * 100 : 0;

        const evaluations = [
            ['Overachiever Ribbon', this.evaluateOverachieverRibbonFromCount(stats.totalMatches, currentRibbons)],
            ['Rematch Ribbon', this.evaluateRematchRibbonFromCount(stats.rematchWins, currentRibbons)],
            ['Sub-Gamer Ribbon', this.evaluateSubGamerRibbonFromCount(stats.subgameMatches, currentRibbons)],
            ['Explorer Ribbon', this.evaluateExplorerRibbonFromCount(stats.uniqueMaps.size, currentRibbons)],
            ['Socialite Ribbon', this.evaluateSocialiteRibbonFromCount(stats.uniqueOpponents.size, currentRibbons)],
            ['Brick Wall', this.evaluateBrickWallRibbonFromWinRate(winRate, currentRibbons)],
            ['Underdog Ribbon', this.evaluateUnderdogRibbonFromCount(stats.underdogWins, currentRibbons)]
        ];
        
        evaluations.forEach(([ribbonName, result]) => {
            if (result) {
                newRibbons[ribbonName] = result;
            }
        });
        
        const totalRibbonsAfter = Object.keys(currentRibbons).length + Object.keys(newRibbons).length;
        const collectorResult = this.evaluateCollectorRibbonFromCount(totalRibbonsAfter, currentRibbons);
        if (collectorResult) {
            newRibbons['Collector Ribbon'] = collectorResult;
        }
        
        return newRibbons;
    }

    async getPlayerDataCached(playerUsername, ladder) {
        try {
            const playersCollection = ladder === 'D1' ? 'players' : 
                                     ladder === 'D2' ? 'playersD2' : 'playersD3';
            
            const playersRef = collection(db, playersCollection);
            const q = query(playersRef, where('username', '==', playerUsername), limit(1));
            const snapshot = await getDocs(q);
            
            return snapshot.empty ? null : snapshot.docs[0].data();
        } catch (error) {
            console.error('Error getting player data:', error);
            return null;
        }
    }

    async getPlayerRibbonsCached(playerUsername, ladder) {
        try {
            const ribbonsCollection = `playerRibbons${ladder === 'D1' ? '' : ladder}`;
            const ribbonsRef = doc(db, ribbonsCollection, playerUsername);
            const ribbonsDoc = await getDoc(ribbonsRef);
            
            return ribbonsDoc.exists() ? ribbonsDoc.data().ribbons || {} : {};
        } catch (error) {
            console.error('Error getting player ribbons:', error);
            return {};
        }
    }

    async savePlayerRibbonsOptimized(playerUsername, newRibbons, ladder) {
        try {
            const ribbonsCollection = `playerRibbons${ladder === 'D1' ? '' : ladder}`;
            const ribbonsRef = doc(db, ribbonsCollection, playerUsername);
            
            const currentRibbons = await this.getPlayerRibbonsCached(playerUsername, ladder);
            const updatedRibbons = { ...currentRibbons, ...newRibbons };
            
            await setDoc(ribbonsRef, {
                username: playerUsername,
                ladder: ladder,
                ribbons: updatedRibbons,
                lastUpdated: new Date()
            }, { merge: true });
            
        } catch (error) {
            console.error('Error saving ribbons:', error);
        }
    }

    evaluateOverachieverRibbonFromCount(totalMatches, currentRibbons) {
        const current = currentRibbons['Overachiever Ribbon'] || { level: 0 };
        const levels = RIBBON_DEFINITIONS['Overachiever Ribbon'].levels;
        const newLevel = levels.findIndex(threshold => totalMatches < threshold);
        const targetLevel = newLevel === -1 ? levels.length : newLevel;

        if (targetLevel > current.level) {
            return { level: targetLevel, awardedAt: new Date() };
        }
        return null;
    }

    evaluateRematchRibbonFromCount(rematchWins, currentRibbons) {
        if (rematchWins === 0) return null;
        const current = currentRibbons['Rematch Ribbon'] || { level: 0 };
        if (rematchWins > current.level) {
            return { level: rematchWins, awardedAt: new Date() };
        }
        return null;
    }

    evaluateSubGamerRibbonFromCount(subgameMatches, currentRibbons) {
        const current = currentRibbons['Sub-Gamer Ribbon'] || { level: 0 };
        const levels = RIBBON_DEFINITIONS['Sub-Gamer Ribbon'].levels;
        const newLevel = levels.findIndex(threshold => subgameMatches < threshold);
        const targetLevel = newLevel === -1 ? levels.length : newLevel;

        if (targetLevel > current.level) {
            return { level: targetLevel, awardedAt: new Date() };
        }
        return null;
    }

    evaluateExplorerRibbonFromCount(uniqueMapCount, currentRibbons) {
        const current = currentRibbons['Explorer Ribbon'] || { level: 0 };
        const levels = RIBBON_DEFINITIONS['Explorer Ribbon'].levels;
        const newLevel = levels.findIndex(threshold => uniqueMapCount < threshold);
        const targetLevel = newLevel === -1 ? levels.length : newLevel;

        if (targetLevel > current.level) {
            return { level: targetLevel, awardedAt: new Date() };
        }
        return null;
    }

    evaluateSocialiteRibbonFromCount(uniqueOpponentCount, currentRibbons) {
        const current = currentRibbons['Socialite Ribbon'] || { level: 0 };
        const levels = RIBBON_DEFINITIONS['Socialite Ribbon'].levels;
        const newLevel = levels.findIndex(threshold => uniqueOpponentCount < threshold);
        const targetLevel = newLevel === -1 ? levels.length : newLevel;

        if (targetLevel > current.level) {
            return { level: targetLevel, awardedAt: new Date() };
        }
        return null;
    }

    evaluateBrickWallRibbonFromWinRate(winRate, currentRibbons) {
        const current = currentRibbons['Brick Wall'] || { level: 0 };
        const levels = RIBBON_DEFINITIONS['Brick Wall'].levels;
        const newLevel = levels.findIndex(threshold => winRate < threshold);
        const targetLevel = newLevel === -1 ? levels.length : newLevel;

        if (targetLevel > current.level) {
            return { level: targetLevel, awardedAt: new Date() };
        }
        return null;
    }

    evaluateCollectorRibbonFromCount(totalRibbons, currentRibbons) {
        const current = currentRibbons['Collector Ribbon'] || { level: 0 };
        const levels = RIBBON_DEFINITIONS['Collector Ribbon'].levels;
        const newLevel = levels.findIndex(threshold => totalRibbons < threshold);
        const targetLevel = newLevel === -1 ? levels.length : newLevel;

        if (targetLevel > current.level) {
            return { level: targetLevel, awardedAt: new Date() };
        }
        return null;
    }

    evaluateUnderdogRibbonFromCount(underdogWins, currentRibbons) {
        if (underdogWins === 0) return null;
        
        const current = currentRibbons['Underdog Ribbon'] || { level: 0 };
        const levels = RIBBON_DEFINITIONS['Underdog Ribbon'].levels;
        
        // Find the highest level achieved
        let targetLevel = 0;
        for (let i = 0; i < levels.length; i++) {
            if (underdogWins >= levels[i]) {
                targetLevel = i + 1;
            } else {
                break;
            }
        }

        if (targetLevel > current.level) {
            return { level: targetLevel, awardedAt: new Date() };
        }
        return null;
    }
}

const ribbonSystem = new RibbonSystem();
const ribbonCache = new RibbonCacheManager();
const matchCache = new MatchCacheManager();

if (typeof window !== 'undefined') {
    window.getRibbonCacheStats = () => {
        return {
            ribbon: ribbonCache.getCacheStats(),
            match: matchCache.getCacheStats()
        };
    };
}

export async function evaluatePlayerRibbons(playerUsername, ladder = 'D1') {
    return await ribbonSystem.evaluateAllRibbonsForPlayerOptimized(playerUsername, ladder);
}

export function getRibbonHTML(ribbonName, ribbonData) {
    const definition = RIBBON_DEFINITIONS[ribbonName];
    if (!definition) {
        return '';
    }
    
    const level = ribbonData.level || 1;
    const shortName = ribbonName.replace(' Ribbon', '').replace(' Badge', '');
    
    const getLevelClass = (level) => {
        if (level <= 1) return 'level-1';
        if (level <= 2) return 'level-2';
        if (level <= 3) return 'level-3';
        if (level <= 4) return 'level-4';
        return 'level-5-plus';
    };
    
    const generateDevices = (level) => {
        if (level <= 1) return '';
        
        const devices = [];
        
        if (level >= 2 && level <= 4) {
            const bronzeStars = Math.min(level - 1, 3);
            for (let i = 0; i < bronzeStars; i++) {
                devices.push('<i class="fas fa-star ribbon-device bronze-star"></i>');
            }
        }
        
        if (level >= 5 && level <= 7) {
            devices.push('<i class="fas fa-star ribbon-device silver-star"></i>');
            const additionalBronze = Math.min(level - 5, 2);
            for (let i = 0; i < additionalBronze; i++) {
                devices.push('<i class="fas fa-star ribbon-device bronze-star"></i>');
            }
        }
        
        if (level >= 8) {
            devices.push('<i class="fas fa-star ribbon-device gold-star"></i>');
        }
        
        return devices.length > 0 ? `<div class="ribbon-devices">${devices.join('')}</div>` : '';
    };
    
    const tooltipText = `${definition.description} - Level ${level}`;
    
    return `
        <div class="military-ribbon" data-tooltip="${tooltipText}">
            <div class="ribbon-image-container">
                <img src="${definition.image}" 
                     alt="${ribbonName}" 
                     class="ribbon-image"
                     onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                <div class="ribbon-fallback" style="display: none; background: ${definition.color};">
                    ${shortName.substring(0, 6)}
                </div>
            </div>
            ${generateDevices(level)}
            <div class="ribbon-name">${shortName}</div>
            ${level > 1 ? `<div class="ribbon-level-indicator ${getLevelClass(level)}">${level}</div>` : ''}
        </div>
    `;
}