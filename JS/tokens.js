import { 
    doc, 
    getDoc, 
    getDocs, 
    collection 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from './firebase-config.js';

// Cache for user tokens to avoid repeated Firebase calls
const tokenCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Get tokens owned by a specific user
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Array of token objects
 */
export async function getUserTokens(userId) {
    // Check cache first
    const cacheKey = `tokens_${userId}`;
    const cached = tokenCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
        return cached.tokens;
    }
    
    try {
        const userTokensRef = doc(db, 'userTokens', userId);
        const userTokensDoc = await getDoc(userTokensRef);
        
        let tokens = [];
        if (userTokensDoc.exists()) {
            tokens = userTokensDoc.data().tokens || [];
        }
        
        // Cache the result
        tokenCache.set(cacheKey, {
            tokens: tokens,
            timestamp: Date.now()
        });
        
        return tokens;
    } catch (error) {
        console.error('Error fetching user tokens:', error);
        return [];
    }
}

/**
 * Get tokens for multiple users efficiently
 * @param {Array<string>} userIds - Array of user IDs
 * @returns {Promise<Map>} Map of userId -> tokens array
 */
export async function getBulkUserTokens(userIds) {
    const tokensMap = new Map();
    const uncachedUserIds = [];
    
    // Check cache for each user
    userIds.forEach(userId => {
        const cacheKey = `tokens_${userId}`;
        const cached = tokenCache.get(cacheKey);
        
        if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
            tokensMap.set(userId, cached.tokens);
        } else {
            uncachedUserIds.push(userId);
        }
    });
    
    // Fetch uncached tokens
    if (uncachedUserIds.length > 0) {
        try {
            const tokenPromises = uncachedUserIds.map(async (userId) => {
                const userTokensRef = doc(db, 'userTokens', userId);
                const userTokensDoc = await getDoc(userTokensRef);
                
                let tokens = [];
                if (userTokensDoc.exists()) {
                    tokens = userTokensDoc.data().tokens || [];
                }
                
                // Cache the result
                const cacheKey = `tokens_${userId}`;
                tokenCache.set(cacheKey, {
                    tokens: tokens,
                    timestamp: Date.now()
                });
                
                return [userId, tokens];
            });
            
            const results = await Promise.all(tokenPromises);
            results.forEach(([userId, tokens]) => {
                tokensMap.set(userId, tokens);
            });
        } catch (error) {
            console.error('Error fetching bulk user tokens:', error);
        }
    }
    
    return tokensMap;
}

/**
 * Get tokens by username (for ladder display)
 * @param {Array<string>} usernames - Array of usernames
 * @returns {Promise<Map>} Map of username -> tokens array
 */
export async function getTokensByUsernames(usernames) {
    const tokensMap = new Map();
    
    try {
        // First, get user profiles to map usernames to user IDs
        const profilesRef = collection(db, 'userProfiles');
        const profilesSnapshot = await getDocs(profilesRef);
        
        const usernameToUserId = new Map();
        profilesSnapshot.forEach(doc => {
            const data = doc.data();
            if (data.username && usernames.includes(data.username)) {
                usernameToUserId.set(data.username, doc.id);
            }
        });
        
        // Get user IDs that we found
        const userIds = Array.from(usernameToUserId.values());
        
        if (userIds.length > 0) {
            const userTokensMap = await getBulkUserTokens(userIds);
            
            // Map back to usernames
            usernameToUserId.forEach((userId, username) => {
                const tokens = userTokensMap.get(userId) || [];
                tokensMap.set(username, tokens);
            });
        }
        
    } catch (error) {
        console.error('Error fetching tokens by usernames:', error);
    }
    
    return tokensMap;
}

/**
 * Clear token cache (useful when user purchases new tokens)
 * @param {string} userId - User ID to clear cache for (optional)
 */
export function clearTokenCache(userId = null) {
    if (userId) {
        const cacheKey = `tokens_${userId}`;
        tokenCache.delete(cacheKey);
        console.log(`🗑️ Cleared token cache for user: ${userId}`);
    } else {
        tokenCache.clear();
        console.log('🗑️ Cleared all token cache');
    }
}

/**
 * Force refresh token data for a specific user (bypasses cache)
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Array of token objects
 */
export async function forceRefreshUserTokens(userId) {
    // Clear cache first
    clearTokenCache(userId);
    
    // Fetch fresh data
    return await getUserTokens(userId);
}

/**
 * Get a user's primary display token (equipped token has priority)
 * @param {Array} tokens - Array of user's tokens
 * @returns {Object|null} Token object or null
 */
export function getPrimaryDisplayToken(tokens) {
    if (!tokens || tokens.length === 0) return null;
    
    // First, look for equipped token
    const equippedToken = tokens.find(token => token.equipped === true);
    if (equippedToken) {
        return equippedToken;
    }
    
    // If no equipped token, sort by purchase date (most recent first) and return the first one
    const sortedTokens = [...tokens].sort((a, b) => {
        let dateA, dateB;
        
        // Handle different timestamp formats
        if (a.purchasedAt) {
            if (a.purchasedAt.seconds) {
                // Firestore Timestamp
                dateA = a.purchasedAt.seconds;
            } else if (a.purchasedAt instanceof Date) {
                // JavaScript Date
                dateA = a.purchasedAt.getTime() / 1000;
            } else if (typeof a.purchasedAt === 'string') {
                // Date string
                dateA = new Date(a.purchasedAt).getTime() / 1000;
            } else {
                dateA = 0;
            }
        } else {
            dateA = 0;
        }
        
        if (b.purchasedAt) {
            if (b.purchasedAt.seconds) {
                // Firestore Timestamp
                dateB = b.purchasedAt.seconds;
            } else if (b.purchasedAt instanceof Date) {
                // JavaScript Date
                dateB = b.purchasedAt.getTime() / 1000;
            } else if (typeof b.purchasedAt === 'string') {
                // Date string
                dateB = new Date(b.purchasedAt).getTime() / 1000;
            } else {
                dateB = 0;
            }
        } else {
            dateB = 0;
        }
        
        return dateB - dateA; // Most recent first
    });
    
    return sortedTokens[0];
}
