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

// Updated ribbon definitions - Remove levels from Top Rank ribbons
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
        description: 'Amass at least 80% overall win rate percentage (minimum 50 matches)',
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
        description: 'Play over 50 subgame matches',
        image: '../images/ribbons/Subgamer.png',
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
        description: 'Beat a pilot ranked higher than you',
        image: '../images/ribbons/Underdog.png',
        color: '#FF9500',
        levels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    },
    'Domination Ribbon': {
        description: 'Beat 5 unique pilots in a rank (including your own)',
        image: '../images/ribbons/Domination.png',
        color: '#8E44AD',
        levels: [1, 2, 3, 4, 5] // Level = number of ranks dominated
    },
    'Top Bronze Pilot': {
        description: 'Claimed the highest spot on the ladder for Bronze rank',
        image: '../images/ribbons/toprank.png',
        color: '#CD7F32'
        // No levels array - single achievement
    },
    'Top Silver Pilot': {
        description: 'Claimed the highest spot on the ladder for Silver rank',
        image: '../images/ribbons/toprank.png',
        color: '#C0C0C0'
        // No levels array - single achievement
    },
    'Top Gold Pilot': {
        description: 'Claimed the highest spot on the ladder for Gold rank',
        image: '../images/ribbons/toprank.png',
        color: '#FFD700'
        // No levels array - single achievement
    },
    'Top Emerald Pilot': {
        description: 'Claimed the highest spot on the ladder for Emerald rank',
        image: '../images/ribbons/toprank.png',
        color: '#50C878'
        // No levels array - single achievement
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
        this.CACHE_DURATION = 60 * 60 * 1000; // 1 hour (longer)
        this.CACHE_KEY_PREFIX = 'ribbon_cache_';
        this.lastCleanup = Date.now();
        this.CLEANUP_INTERVAL = 30 * 60 * 1000; // 30 minutes
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
                // Cache hit (memory) for ${username}
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
                    // Cache hit (localStorage) for ${username}
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

    // Smart invalidation based on match count changes
    shouldRefreshCache(username, ladder, currentMatchCount) {
        const cacheKey = this.getCacheKey(username, ladder);
        
        // Check memory cache first
        if (this.memoryCache.has(cacheKey)) {
            const cached = this.memoryCache.get(cacheKey);
            return cached.matchCount !== currentMatchCount;
        }
        
        // Check localStorage
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

    // Only clear cache when player gets new matches
    invalidatePlayerCache(username, ladder) {
        const cacheKey = this.getCacheKey(username, ladder);
        this.memoryCache.delete(cacheKey);
        localStorage.removeItem(cacheKey);
        // Invalidated cache for ${username} (${ladder}) - new match detected
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
            // Cache hit (matches) for ${username}
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
        this.playerDataCache = new Map(); // Cache player data for underdog calculations
    }

    // Optimized: Bulk load all player data for underdog calculations
    async bulkLoadPlayerData(usernames, ladder) {
        const playersCollection = ladder === 'D1' ? 'players' : 
                                 ladder === 'D2' ? 'playersD2' : 'playersD3';
        
        const playersRef = collection(db, playersCollection);
        const snapshot = await getDocs(playersRef);
        
        const playerMap = new Map();
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.username) {
                // Map eloRating to rating for consistency
                if (data.eloRating !== undefined) {
                    data.rating = data.eloRating;
                }
                playerMap.set(data.username, data);
            }
        });
        
        // Bulk loaded ${playerMap.size} players from ${playersCollection}
        return playerMap;
    }

    // MUCH faster underdog calculation - bulk loads all player data once
    async evaluateAllRibbonsFromData(matches, playerData, currentRibbons, ladder) {
        const newRibbons = {};
        const playerUsername = playerData.username;
        
        const stats = {
            totalMatches: matches.length,
            wins: 0,
            rematchWins: 0,
            subgameMatches: 0,
            uniqueMaps: new Set(),
            uniqueOpponents: new Set(),
            underdogWins: 0,
            dominatedRanks: new Set() // Track which ranks have been dominated
        };
        
        // Get all unique opponent usernames for bulk loading
        const opponents = new Set();
        matches.forEach(match => {
            const isWinner = match.winnerUsername === playerUsername;
            const opponent = isWinner ? match.loserUsername : match.winnerUsername;
            if (opponent) opponents.add(opponent);
        });
        
        // Bulk load ALL player data once instead of individual lookups
        // Bulk loading ${opponents.size} player records for underdog calculations...
        const allPlayerData = await this.bulkLoadPlayerData([...opponents, playerUsername], ladder);
        const currentPlayerData = allPlayerData.get(playerUsername);
        
        if (!currentPlayerData) {
            // No current player data found for ${playerUsername}
        }
        
        // Track victories by rank tier for domination calculation
        const victoriesByRank = {
            0: new Set(), // Unranked
            1: new Set(), // Bronze
            2: new Set(), // Silver
            3: new Set(), // Gold
            4: new Set()  // Emerald
        };
        
        // Now process all matches with cached data (MUCH faster)
        matches.forEach(match => {
            const isWinner = match.winnerUsername === playerUsername;
            const opponent = isWinner ? match.loserUsername : match.winnerUsername;
            
            if (isWinner) {
                stats.wins++;
                if (match.subgameType === 'Rematch') {
                    stats.rematchWins++;
                }
                
                // Fast underdog check using cached data
                if (this.isUnderdogVictoryFast(match, playerUsername, currentPlayerData, allPlayerData)) {
                    stats.underdogWins++;
                }
                
                // Track victories by opponent's rank for domination
                const opponentData = allPlayerData.get(opponent);
                if (opponentData) {
                    const opponentRating = opponentData.eloRating || 0;
                    const opponentTier = getPlayerRankTier(opponentRating);
                    victoriesByRank[opponentTier].add(opponent);
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

        // Calculate domination: count ranks where player beat 5+ unique opponents
        Object.keys(victoriesByRank).forEach(rankTier => {
            if (victoriesByRank[rankTier].size >= 5) {
                stats.dominatedRanks.add(parseInt(rankTier));
            }
        });

        // Found ${stats.underdogWins} underdog victories for ${playerUsername}
        // Dominated ${stats.dominatedRanks.size} ranks: [${Array.from(stats.dominatedRanks).map(tier => getRankTierName(tier)).join(', ')}]

        const winRate = stats.totalMatches > 0 ? (stats.wins / stats.totalMatches) * 100 : 0;

        const evaluations = [
            ['Overachiever Ribbon', this.evaluateOverachieverRibbonFromCount(stats.totalMatches, currentRibbons)],
            ['Rematch Ribbon', this.evaluateRematchRibbonFromCount(stats.rematchWins, currentRibbons)],
            ['Sub-Gamer Ribbon', this.evaluateSubGamerRibbonFromCount(stats.subgameMatches, currentRibbons)],
            ['Explorer Ribbon', this.evaluateExplorerRibbonFromCount(stats.uniqueMaps.size, currentRibbons)],
            ['Socialite Ribbon', this.evaluateSocialiteRibbonFromCount(stats.uniqueOpponents.size, currentRibbons)],
            ['Brick Wall', this.evaluateBrickWallRibbonFromWinRate(winRate, currentRibbons, stats.totalMatches)],
            ['Underdog Ribbon', this.evaluateUnderdogRibbonFromCount(stats.underdogWins, currentRibbons)],
            ['Domination Ribbon', this.evaluateDominationRibbonFromRanks(stats.dominatedRanks.size, currentRibbons)]
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

    // New method: Evaluate Domination Ribbon based on number of ranks dominated
    evaluateDominationRibbonFromRanks(dominatedRankCount, currentRibbons) {
        if (dominatedRankCount === 0) return null;
        
        const current = currentRibbons['Domination Ribbon'] || { level: 0 };
        
        // Level = number of ranks dominated (1-5: Unranked, Bronze, Silver, Gold, Emerald)
        if (dominatedRankCount > current.level) {
            const rankNames = [];
            for (let i = 0; i < dominatedRankCount; i++) {
                rankNames.push(getRankTierName(i));
            }
            
            // Domination Ribbon awarded: Level ${current.level} → ${dominatedRankCount} (Dominated: ${rankNames.join(', ')})
            return { 
                level: dominatedRankCount, 
                awardedAt: new Date(),
                dominatedRanks: rankNames
            };
        }
        return null;
    }

    // Check if player currently holds top position for their rank
    async checkTopRankStatus(playerUsername, ladder) {
        try {
            const playersCollection = ladder === 'D1' ? 'players' : 
                                     ladder === 'D2' ? 'playersD2' : 'playersD3';
            
            // Get player's current data
            const playerData = await this.getPlayerDataCached(playerUsername, ladder);
            if (!playerData || playerData.eloRating === undefined) {
                // No ELO rating data for ${playerUsername}
                return null;
            }
            
            const playerRating = playerData.eloRating;
            const playerMatchCount = playerData.matchesPlayed || 0;
            const playerWinRate = playerData.winPercentage || 0;
            
            // Get player's tier using proper thresholds with matchCount/winRate check
            const playerTier = getPlayerRankTier(playerRating, playerMatchCount, playerWinRate);
            const playerTierName = getRankTierName(playerTier);
            
            if (playerTierName === 'Unranked') {
                // ${playerUsername} is Unranked (${playerRating} ELO, ${playerMatchCount} matches)
                return null;
            }
            
            // Checking Top ${playerTierName} status for ${playerUsername} (${playerRating} ELO, ${playerWinRate}% WR, ${playerMatchCount} matches)
            
            // Get all players in the same rank tier
            const playersRef = collection(db, playersCollection);
            const allPlayersSnapshot = await getDocs(playersRef);
            
            let topPlayer = null;
            let highestRating = -1;
            let playersInTier = 0;
            
            allPlayersSnapshot.forEach(doc => {
                const data = doc.data();
                const rating = data.eloRating || 0;
                const matchCount = data.matchesPlayed || 0;
                const winRate = data.winPercentage || 0;
                
                // Use proper tier calculation with matchCount/winRate
                const tier = getPlayerRankTier(rating, matchCount, winRate);
                
                // Only consider players in the same rank tier
                if (tier === playerTier) {
                    playersInTier++;
                    if (rating > highestRating) {
                        highestRating = rating;
                        topPlayer = data.username;
                    }
                }
            });
            
            const isTopPlayer = topPlayer === playerUsername;
            // ${playerTierName} Tier: ${playersInTier} players, Top: ${topPlayer} (${highestRating} ELO), ${playerUsername} is #1: ${isTopPlayer}
            
            return isTopPlayer ? playerTierName : null;
            
        } catch (error) {
            console.error('Error checking top rank status:', error);
            return null;
        }
    }

    // Fixed Top Rank evaluation - Award permanently when player reaches #1
    // Once awarded, the ribbon is NEVER removed (historical achievement)
    async evaluateTopRankRibbon(playerUsername, ladder, currentRibbons) {
        const topRank = await this.checkTopRankStatus(playerUsername, ladder);
        const updates = {};
        
        // FIRST: Preserve ALL existing Top Rank ribbons (they are permanent achievements)
        Object.keys(currentRibbons).forEach(ribbonName => {
            if (ribbonName.startsWith('Top ') && ribbonName.endsWith(' Pilot')) {
                // Always preserve existing top rank ribbons - they're permanent
                updates[ribbonName] = currentRibbons[ribbonName];
                // Preserving permanent ${ribbonName} for ${playerUsername}
            }
        });
        
        // SECOND: If player currently holds #1 in their rank, award that ribbon if not already owned
        if (topRank) {
            const ribbonName = `Top ${topRank} Pilot`;
            if (RIBBON_DEFINITIONS[ribbonName]) {
                // Check if player already has this specific ribbon
                if (!currentRibbons[ribbonName] && !updates[ribbonName]) {
                    // First time achieving #1 in this rank - award the ribbon permanently
                    // NEW Top Rank Achievement: ${playerUsername} earned ${ribbonName}! (This is permanent)
                    
                    updates[ribbonName] = {
                        level: 1,
                        awardedAt: new Date(),
                        rank: topRank,
                        achievedAt: new Date(),
                        permanent: true // Mark as permanent achievement
                    };
                } else {
                    // ${playerUsername} already has ${ribbonName}
                }
            }
        }
        
        return updates;
    }

    // Update main evaluation to always check for top rank (but only award if currently #1)
    async evaluateAllRibbonsForPlayerOptimized(playerUsername, ladder = 'D1') {
        try {
            const cachedRibbons = ribbonCache.getCachedData(playerUsername, ladder);
            if (cachedRibbons) {
                // Always check for new top rank achievements, even with cache
                const topRankRibbons = await this.evaluateTopRankRibbon(playerUsername, ladder, cachedRibbons);
                if (Object.keys(topRankRibbons).length > 0) {
                    // New top rank achievements found for cached player ${playerUsername}
                    await this.savePlayerRibbonsOptimized(playerUsername, topRankRibbons, ladder);
                    const updatedRibbons = { ...cachedRibbons, ...topRankRibbons };
                    ribbonCache.setCachedData(playerUsername, ladder, updatedRibbons, 0);
                    return updatedRibbons;
                }
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
            
            // Always check for top rank ribbons regardless of cache status
            const topRankRibbons = await this.evaluateTopRankRibbon(playerUsername, ladder, currentRibbons);
            
            if (!ribbonCache.shouldRefreshCache(playerUsername, ladder, playerMatchCount)) {
                // Even if not refreshing, save any new top rank achievements
                if (Object.keys(topRankRibbons).length > 0) {
                    await this.savePlayerRibbonsOptimized(playerUsername, topRankRibbons, ladder);
                    const updatedRibbons = { ...currentRibbons, ...topRankRibbons };
                    ribbonCache.setCachedData(playerUsername, ladder, updatedRibbons, playerMatchCount);
                    return updatedRibbons;
                }
                ribbonCache.setCachedData(playerUsername, ladder, currentRibbons, playerMatchCount);
                return currentRibbons;
            }

            // Full evaluation including match-based ribbons
            const matches = await this.getPlayerMatchesOptimized(playerUsername, ladder);
            const newRibbons = await this.evaluateAllRibbonsFromData(matches, playerData, currentRibbons, ladder);
            
            // Merge top rank ribbons with other new ribbons
            Object.assign(newRibbons, topRankRibbons);

            if (Object.keys(newRibbons).length > 0) {
                // Saving ${Object.keys(newRibbons).length} new/updated ribbons for ${playerUsername}
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

    // Check if a victory qualifies as an underdog win based on current player ranks
    async isUnderdogVictory(match, playerUsername, ladder) {
        const isWinner = match.winnerUsername === playerUsername;
        if (!isWinner) return false;

        const opponent = match.loserUsername;
        
        // Get current rank data for both players
        const [playerData, opponentData] = await Promise.all([
            this.getPlayerDataCached(playerUsername, ladder),
            this.getPlayerDataCached(opponent, ladder)
        ]);

        if (!playerData || !opponentData) {
            // Missing player data for ${playerUsername} or ${opponent}
            return false;
        }

        // Use eloRating consistently
        const playerRating = playerData.eloRating || 0;
        const opponentRating = opponentData.eloRating || 0;
        
        const playerTier = getPlayerRankTier(playerRating);
        const opponentTier = getPlayerRankTier(opponentRating);
        
        // Checking underdog: Winner(${playerUsername}): ${playerRating} ELO (${getRankTierName(playerTier)}) vs Loser(${opponent}): ${opponentRating} ELO (${getRankTierName(opponentTier)})
        
        // For underdog victory, winner must be from a lower rank tier than loser
        if (opponentTier > playerTier) {
            // UNDERDOG VICTORY: ${getRankTierName(playerTier)} beat ${getRankTierName(opponentTier)}!
            return true;
        }
        
        // Not underdog: ${getRankTierName(playerTier)} vs ${getRankTierName(opponentTier)}
        return false;
    }

    // Fast underdog check using pre-loaded data (no async calls)
    isUnderdogVictoryFast(match, playerUsername, currentPlayerData, allPlayerData) {
        const isWinner = match.winnerUsername === playerUsername;
        if (!isWinner) return false;

        const opponent = match.loserUsername;
        const opponentData = allPlayerData.get(opponent);
        
        if (!currentPlayerData || !opponentData) {
            return false;
        }

        // Get current ratings and rank tiers
        const playerRating = currentPlayerData.eloRating || 0;
        const opponentRating = opponentData.eloRating || 0;
        
        const playerTier = getPlayerRankTier(playerRating);
        const opponentTier = getPlayerRankTier(opponentRating);
        
        // For underdog victory, winner must be from a lower rank tier than loser
        if (opponentTier > playerTier) {
            // UNDERDOG: ${getRankTierName(playerTier)}(${playerRating}) beat ${getRankTierName(opponentTier)}(${opponentRating})
            return true;
        }
        
        return false;
    }

    // Update evaluateAllRibbonsFromData to handle async isUnderdogVictory
    async evaluateAllRibbonsFromData(matches, playerData, currentRibbons, ladder) {
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
        
        // Get all unique opponent usernames for bulk loading
        const opponents = new Set();
        matches.forEach(match => {
            const isWinner = match.winnerUsername === playerUsername;
            const opponent = isWinner ? match.loserUsername : match.winnerUsername;
            if (opponent) opponents.add(opponent);
        });
        
        // Bulk load ALL player data once instead of individual lookups
        // Bulk loading ${opponents.size} player records for underdog calculations...
        const allPlayerData = await this.bulkLoadPlayerData([...opponents, playerUsername], ladder);
        const currentPlayerData = allPlayerData.get(playerUsername);
        
        if (!currentPlayerData) {
            // No current player data found for ${playerUsername}
        }
        
        // Now process all matches with cached data (MUCH faster)
        matches.forEach(match => {
            const isWinner = match.winnerUsername === playerUsername;
            const opponent = isWinner ? match.loserUsername : match.winnerUsername;
            
            if (isWinner) {
                stats.wins++;
                if (match.subgameType === 'Rematch') {
                    stats.rematchWins++;
                }
                
                // Fast underdog check using cached data
                if (this.isUnderdogVictoryFast(match, playerUsername, currentPlayerData, allPlayerData)) {
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

        // Found ${stats.underdogWins} underdog victories for ${playerUsername}

        const winRate = stats.totalMatches > 0 ? (stats.wins / stats.totalMatches) * 100 : 0;

        const evaluations = [
            ['Overachiever Ribbon', this.evaluateOverachieverRibbonFromCount(stats.totalMatches, currentRibbons)],
            ['Rematch Ribbon', this.evaluateRematchRibbonFromCount(stats.rematchWins, currentRibbons)],
            ['Sub-Gamer Ribbon', this.evaluateSubGamerRibbonFromCount(stats.subgameMatches, currentRibbons)],
            ['Explorer Ribbon', this.evaluateExplorerRibbonFromCount(stats.uniqueMaps.size, currentRibbons)],
            ['Socialite Ribbon', this.evaluateSocialiteRibbonFromCount(stats.uniqueOpponents.size, currentRibbons)],
            ['Brick Wall', this.evaluateBrickWallRibbonFromWinRate(winRate, currentRibbons, stats.totalMatches)],
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

    async getPlayerDataCached(playerUsername, ladder) {
        try {
            const playersCollection = ladder === 'D1' ? 'players' : 
                                     ladder === 'D2' ? 'playersD2' : 'playersD3';
            
            const playersRef = collection(db, playersCollection);
            const q = query(playersRef, where('username', '==', playerUsername), limit(1));
            const snapshot = await getDocs(q);
            
            if (snapshot.empty) {
                // Check hiatus collection (all ladders use same collection)
                const hiatusRef = collection(db, 'playerHiatus');
                const hiatusQuery = query(hiatusRef, where('username', '==', playerUsername), limit(1));
                const hiatusSnapshot = await getDocs(hiatusQuery);
                
                if (hiatusSnapshot.empty) {
                    // No player data found for ${playerUsername} in ${playersCollection} or playerHiatus
                    return null;
                }
                
                // Found in hiatus
                const playerData = hiatusSnapshot.docs[0].data();
                
                // Map eloRating to rating for consistency with ribbon system
                if (playerData.eloRating !== undefined) {
                    playerData.rating = playerData.eloRating;
                }
                
                // Found player data for ${playerUsername} in hiatus: ELO ${playerData.eloRating}, Position ${playerData.position}
                return playerData;
            }
            
            const playerData = snapshot.docs[0].data();
            
            // Map eloRating to rating for consistency with ribbon system
            if (playerData.eloRating !== undefined) {
                playerData.rating = playerData.eloRating;
            }
            
            // Found player data for ${playerUsername}: ELO ${playerData.eloRating}, Position ${playerData.position}
            return playerData;
        } catch (error) {
            console.error(`Error getting player data for ${playerUsername}:`, error);
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

    evaluateBrickWallRibbonFromWinRate(winRate, currentRibbons, totalMatches) {
        // Require at least 50 matches before awarding Brick Wall ribbon
        if (totalMatches < 50) {
            // Brick Wall ribbon requires 50+ matches (player has ${totalMatches})
            return null;
        }

        const current = currentRibbons['Brick Wall'] || { level: 0 };
        const levels = RIBBON_DEFINITIONS['Brick Wall'].levels;
        const newLevel = levels.findIndex(threshold => winRate < threshold);
        const targetLevel = newLevel === -1 ? levels.length : newLevel;

        if (targetLevel > current.level) {
            // Brick Wall ribbon awarded: ${winRate.toFixed(1)}% win rate over ${totalMatches} matches
            return { 
                level: targetLevel, 
                awardedAt: new Date(),
                winRate: winRate,
                matchesPlayed: totalMatches
            };
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
            // Underdog Ribbon upgrade: Level ${current.level} → ${targetLevel} (${underdogWins} underdog wins)
            return { level: targetLevel, awardedAt: new Date() };
        }
        return null;
    }
}

// Helper functions for rank tiers
// Thresholds MUST match ranks.js: Bronze=200, Silver=500, Gold=700, Emerald=1000
// Emerald requires: winRate >= 80% AND matchCount >= 20
function getPlayerRankTier(eloRating, matchCount = null, winRate = null) {
    if (eloRating === undefined || eloRating === null) {
        return 0; // Unranked
    }
    const elo = Number(eloRating);
    if (isNaN(elo)) {
        return 0;
    }

    // If matchCount is provided and is 0, player is Unranked
    if (matchCount !== null && matchCount === 0) {
        return 0; // Unranked
    }

    // 5+ matches rule: minimum Bronze tier
    if (matchCount !== null && matchCount >= 5 && elo < 200) {
        return 1; // Bronze
    }

    // Check tiers based on ELO thresholds from ranks.js
    if (elo < 200) return 0; // Unranked
    if (elo < 500) return 1; // Bronze
    if (elo < 700) return 2; // Silver
    if (elo < 1000) return 3; // Gold
    
    // Emerald tier: 1000+ ELO, but requires special conditions
    // If winRate/matchCount data available, check Emerald requirements
    if (winRate !== null && matchCount !== null) {
        if (winRate >= 80 && matchCount >= 20) {
            return 4; // Emerald - meets all requirements
        }
        return 3; // Gold - 1000+ ELO but doesn't meet Emerald requirements
    }
    
    // If no winRate/matchCount data, assume they meet requirements for simple tier lookup
    return 4; // Emerald
}

function getRankTierName(tier) {
    const names = ['Unranked', 'Bronze', 'Silver', 'Gold', 'Emerald'];
    return names[tier] || 'Unranked';
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

// Export function to check and award Top Rank ribbon immediately after a match
// This should be called from ladder algorithm when a player wins a match
export async function checkAndAwardTopRankRibbon(playerUsername, ladder = 'D1') {
    try {
        // Get current ribbons
        const currentRibbons = await ribbonSystem.getPlayerRibbonsCached(playerUsername, ladder);
        
        // Evaluate Top Rank status and get any updates
        const topRankUpdates = await ribbonSystem.evaluateTopRankRibbon(playerUsername, ladder, currentRibbons);
        
        // If there are new Top Rank ribbons to award, save them
        if (Object.keys(topRankUpdates).length > 0) {
            // Check if any are NEW ribbons (not just preserved ones)
            const newRibbons = {};
            for (const [ribbonName, ribbonData] of Object.entries(topRankUpdates)) {
                if (!currentRibbons[ribbonName]) {
                    newRibbons[ribbonName] = ribbonData;
                }
            }
            
            if (Object.keys(newRibbons).length > 0) {
                await ribbonSystem.savePlayerRibbonsOptimized(playerUsername, newRibbons, ladder);
                // Awarded Top Rank ribbon(s) to ${playerUsername}: ${Object.keys(newRibbons)}
                return newRibbons;
            }
        }
        
        return null;
    } catch (error) {
        console.error('Error checking/awarding Top Rank ribbon:', error);
        return null;
    }
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