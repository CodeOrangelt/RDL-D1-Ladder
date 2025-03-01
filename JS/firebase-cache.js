// Add this to a new file: JS/firestore-cache.js
const cache = {
  data: {},
  timestamp: {},
  TTL: 5 * 60 * 1000, // 5 minutes cache TTL
};

export async function cachedQuery(queryFn, cacheKey, ttl = null) {
  const now = Date.now();
  const cacheTime = cache.timestamp[cacheKey] || 0;
  const cacheTTL = ttl || cache.TTL;
  
  // Use cache if it's still valid
  if (cache.data[cacheKey] && (now - cacheTime < cacheTTL)) {
    console.log(`Using cached data for: ${cacheKey}`);
    return cache.data[cacheKey];
  }
  
  // Execute query and store in cache
  console.log(`Fetching fresh data for: ${cacheKey}`);
  const result = await queryFn();
  cache.data[cacheKey] = result;
  cache.timestamp[cacheKey] = now;
  
  return result;
}

// Function to get players with caching
export async function getCachedPlayers(collectionName = 'players', orderByField = 'username') {
  return cachedQuery(async () => {
    const playersRef = collection(db, collectionName);
    const q = query(playersRef, orderBy(orderByField));
    const snapshot = await getDocs(q);
    
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  }, `${collectionName}_${orderByField}`);
}

// Function to clear specific cache entries or all cache
export function clearCache(cacheKey = null) {
  if (cacheKey) {
    delete cache.data[cacheKey];
    delete cache.timestamp[cacheKey];
  } else {
    cache.data = {};
    cache.timestamp = {};
  }
}