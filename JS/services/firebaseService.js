import { db } from '../firebase-config.js';
import { 
    collection, 
    doc, 
    getDoc, 
    getDocs, 
    query, 
    limit, 
    startAfter, 
    where, 
    onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// In-memory cache
const cache = {
  userProfiles: new Map(),
  ladderPlayers: new Map(),
  matchResults: new Map(),
  eloHistory: new Map(),
};

// Cache expiration times (in milliseconds)
const CACHE_EXPIRY = {
  userProfiles: 5 * 60 * 1000, // 5 minutes
  ladderPlayers: 2 * 60 * 1000, // 2 minutes
  matchResults: 1 * 60 * 1000,  // 1 minute
  eloHistory: 3 * 60 * 1000,    // 3 minutes
};

// Unified user profile collection
export const userProfilesRef = collection(db, 'userProfiles');

// Paginated data fetching
export async function fetchPaginatedData(collectionRef, pageSize = 10, lastDoc = null) {
  let q = query(collectionRef, limit(pageSize));
  
  if (lastDoc) {
    q = query(q, startAfter(lastDoc));
  }
  
  const snapshot = await getDocs(q);
  const lastVisible = snapshot.docs[snapshot.docs.length - 1];
  
  return {
    data: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
    lastVisible,
    hasMore: snapshot.docs.length === pageSize
  };
}

// User profile management
export async function getUserProfile(userId) {
  const cachedUser = cache.userProfiles.get(userId);
  
  if (cachedUser && (Date.now() - cachedUser.timestamp) < CACHE_EXPIRY.userProfiles) {
    return cachedUser.data;
  }
  
  const userDoc = await getDoc(doc(userProfilesRef, userId));
  if (userDoc.exists()) {
    const userData = userDoc.data();
    cache.userProfiles.set(userId, {
      data: userData,
      timestamp: Date.now()
    });
    return userData;
  }
  
  return null;
}

// Efficient ladder data loading
export async function getLadderData(division = 1) {
  const cacheKey = `division_${division}`;
  const cachedData = cache.ladderPlayers.get(cacheKey);
  
  if (cachedData && (Date.now() - cachedData.timestamp) < CACHE_EXPIRY.ladderPlayers) {
    return cachedData.data;
  }
  
  const collectionName = division === 1 ? 'players' : `playersD${division}`;
  const playersRef = collection(db, collectionName);
  
  const playersSnapshot = await getDocs(query(playersRef, limit(100)));
  const players = playersSnapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));
  
  cache.ladderPlayers.set(cacheKey, {
    data: players,
    timestamp: Date.now()
  });
  
  return players;
}

// Efficient batch ELO history fetching
export async function getEloHistoryBatch(userIds, division = 1) {
  const collectionName = division === 1 ? 'eloHistory' : `eloHistoryD${division}`;
  const historyRef = collection(db, collectionName);
  
  const results = {};
  const uncachedIds = [];
  
  // Check cache first
  userIds.forEach(userId => {
    const cacheKey = `${userId}_${division}`;
    const cachedHistory = cache.eloHistory.get(cacheKey);
    
    if (cachedHistory && (Date.now() - cachedHistory.timestamp) < CACHE_EXPIRY.eloHistory) {
      results[userId] = cachedHistory.data;
    } else {
      uncachedIds.push(userId);
    }
  });
  
  // Batch fetch only what's needed (in chunks of 10 to avoid Firestore limitations)
  const batchSize = 10;
  for (let i = 0; i < uncachedIds.length; i += batchSize) {
    const batchIds = uncachedIds.slice(i, i + batchSize);
    if (batchIds.length > 0) {
      try {
        const q = query(historyRef, where('playerId', 'in', batchIds), limit(100));
        const snapshot = await getDocs(q);
        
        snapshot.docs.forEach(doc => {
          const data = doc.data();
          const userId = data.playerId;
          
          if (!results[userId]) results[userId] = [];
          results[userId].push(data);
          
          // Update cache
          const cacheKey = `${userId}_${division}`;
          cache.eloHistory.set(cacheKey, {
            data: results[userId],
            timestamp: Date.now()
          });
        });
      } catch (error) {
        console.error('Error fetching batch ELO history:', error);
      }
    }
  }
  
  return results;
}

// Username cache
let usernameCache = new Map();
let usernameCacheTimestamp = Date.now();

// Efficient real-time listener with unsubscribe capability
export function setupEfficientListener(collectionPath, queryConstraints = [], callback) {
  const collectionRef = collection(db, collectionPath);
  const q = query(collectionRef, ...queryConstraints);
  
  const unsubscribe = onSnapshot(q, (snapshot) => {
    const changes = snapshot.docChanges().map(change => ({
      type: change.type,
      id: change.doc.id,
      data: change.doc.data()
    }));
    
    // Only trigger callback if there are actual changes
    if (changes.length > 0) {
      callback(changes, snapshot.docs);
    }
  });
  
  return unsubscribe;
}

/**
 * Resolves multiple usernames efficiently
 * @param {Array<string>} userIds - Array of user IDs to resolve
 * @returns {Promise<Map<string, string>>} Map of userId to username
 */
export async function bulkResolveUsernames(userIds) {
    const usernameMap = new Map();
    
    if (!userIds || userIds.length === 0) return usernameMap;
    
    // Check all player collections
    const collections = ['players', 'playersD2', 'playersD3', 'nonParticipants'];
    
    for (const collectionName of collections) {
        const playersRef = collection(db, collectionName);
        const snapshot = await getDocs(playersRef);
        
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.username && userIds.includes(doc.id)) {
                usernameMap.set(doc.id, data.username);
            }
        });
    }
    
    return usernameMap;
}