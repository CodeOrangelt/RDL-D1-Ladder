import { db } from '../firebase-config.js';
import { collection, doc, getDoc, getDocs, writeBatch, setDoc } from 'firebase/firestore';

// This utility consolidates user data from multiple collections into the unified userProfiles collection
export async function migrateUserData() {
  const collections = ['players', 'playersD2', 'playersD3', 'nonParticipants', 'userProfiles'];
  const batches = [];
  let currentBatch = writeBatch(db);
  let operationCount = 0;
  const userProfilesRef = collection(db, 'userProfiles');
  const processedUsers = new Map();
  
  // Function to update profiles in batches of max 500 operations
  const addToBatch = (userId, userData) => {
    if (operationCount >= 500) {
      batches.push(currentBatch);
      currentBatch = writeBatch(db);
      operationCount = 0;
    }
    
    const userRef = doc(userProfilesRef, userId);
    currentBatch.set(userRef, userData);
    operationCount++;
  };
  
  // Process each collection
  for (const collectionName of collections) {
    const collectionRef = collection(db, collectionName);
    const snapshot = await getDocs(collectionRef);
    
    snapshot.docs.forEach(userDoc => {
      const userId = userDoc.id;
      const userData = userDoc.data();
      
      if (!processedUsers.has(userId)) {
        processedUsers.set(userId, {
          username: userData.username || userData.name || userId,
          email: userData.email || null,
          discord: userData.discord || null,
          createdAt: userData.createdAt || new Date().toISOString(),
          divisions: []
        });
      }
      
      // Add division participation data
      const profile = processedUsers.get(userId);
      if (collectionName === 'players') {
        profile.divisions.push({
          id: 1,
          elo: userData.elo || 1500,
          isActive: userData.active !== false
        });
      } else if (collectionName === 'playersD2') {
        profile.divisions.push({
          id: 2,
          elo: userData.elo || 1500,
          isActive: userData.active !== false
        });
      } else if (collectionName === 'playersD3') {
        profile.divisions.push({
          id: 3,
          elo: userData.elo || 1500,
          isActive: userData.active !== false
        });
      }
    });
  }
  
  // Convert map to batch operations
  for (const [userId, userData] of processedUsers.entries()) {
    addToBatch(userId, userData);
  }
  
  // Add the last batch if it has operations
  if (operationCount > 0) {
    batches.push(currentBatch);
  }
  
  // Execute all batches
  const results = [];
  for (const batch of batches) {
    try {
      await batch.commit();
      results.push({ success: true });
    } catch (error) {
      results.push({ success: false, error });
    }
  }
  
  return {
    usersProcessed: processedUsers.size,
    batchesExecuted: results.length,
    success: results.every(r => r.success)
  };
}

// Update all match documents to use the new structure
export async function updateMatchReferences() {
  const matchesCollections = ['matches', 'matchesD2', 'matchesD3'];
  let updatedCount = 0;
  
  for (const collectionName of matchesCollections) {
    const matchesRef = collection(db, collectionName);
    const snapshot = await getDocs(matchesRef);
    
    const batchSize = 500;
    let batch = writeBatch(db);
    let batchCount = 0;
    
    for (const matchDoc of snapshot.docs) {
      const matchData = matchDoc.data();
      const matchRef = doc(db, collectionName, matchDoc.id);
      
      // Update the document to reference userProfiles instead of the old collections
      batch.update(matchRef, {
        isMigrated: true,
        lastModified: new Date().toISOString()
      });
      
      batchCount++;
      updatedCount++;
      
      if (batchCount >= batchSize) {
        await batch.commit();
        batch = writeBatch(db);
        batchCount = 0;
      }
    }
    
    if (batchCount > 0) {
      await batch.commit();
    }
  }
  
  return { updatedCount };
}