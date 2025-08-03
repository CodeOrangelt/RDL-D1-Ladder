import { db } from './firebase-config.js';
import { doc, getDoc, updateDoc, addDoc, collection, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Points chart matching your requirements
const POINTS_CHART = {
        '': 10, // Standard match
        'Standard': 10,
        'Fusion Match': 25,
        '≥6 Missiles': 10,
        'Weapon Imbalance': 30,
        'Blind Match': 75,
        'Rematch': 20,
        'Disorientation': 50,
        'Ratting': 35,
        'Altered Powerups': 35,
        'Mega Match': 40,
        'Dogfight': 50,
        'Gauss and Mercs': 25,
        'Misc': 30
};

// Safe wrapper that doesn't break if adminbackend isn't available
let adminModifyUserPoints = null;

// Try to import the admin function dynamically
try {
    const adminModule = await import('./adminbackend.js');
    if (adminModule.modifyUserPoints) {
        adminModifyUserPoints = adminModule.modifyUserPoints;
        console.log('Admin points service connected');
    }
} catch (error) {
    console.log('Admin backend not available, using fallback points service');
}

export async function awardMatchPoints(winnerUserId, loserUserId, subgameType) {
    try {
        const pointsToAward = POINTS_CHART[subgameType] || 10;
        
        if (adminModifyUserPoints) {
            // Use admin backend if available
            await Promise.all([
                adminModifyUserPoints(winnerUserId, 'add', pointsToAward, `Match points: ${subgameType || 'Standard'} match (Winner)`),
                adminModifyUserPoints(loserUserId, 'add', pointsToAward, `Match points: ${subgameType || 'Standard'} match (Participant)`)
            ]);
        } else {
            // Use fallback method
            await Promise.all([
                addPointsFallback(winnerUserId, pointsToAward, `Match points: ${subgameType || 'Standard'} match (Winner)`),
                addPointsFallback(loserUserId, pointsToAward, `Match points: ${subgameType || 'Standard'} match (Participant)`)
            ]);
        }
        
        console.log(`Awarded ${pointsToAward} points to both players for ${subgameType || 'Standard'} match`);
        return true;
    } catch (error) {
        console.error('Error awarding match points:', error);
        return false;
    }
}

// Fallback points method
async function addPointsFallback(userId, amount, reason = '') {
    try {
        const userRef = doc(db, 'userProfiles', userId);
        const userDoc = await getDoc(userRef);
        
        if (!userDoc.exists()) {
            console.log(`User profile not found for ${userId}, creating new profile with points`);
            
            // Create new user profile with initial points
            await setDoc(userRef, {
                points: amount,
                inventory: [],
                equippedToken: null,
                createdAt: serverTimestamp(),
                username: 'Unknown User', // Will be updated when they visit redeem store
                lastPointsModified: serverTimestamp()
            });
            
            console.log(`Created new profile for ${userId} with ${amount} points`);
        } else {
            const userData = userDoc.data();
            const currentPoints = userData.points || 0;
            const newPoints = currentPoints + amount;
            
            // Update user points
            await updateDoc(userRef, {
                points: newPoints,
                lastPointsModified: serverTimestamp()
            });
            
            console.log(`Updated ${userId}: ${currentPoints} + ${amount} = ${newPoints} points`);
        }
        
        // Log the points change (if possible)
        try {
            await addDoc(collection(db, 'pointsHistory'), {
                userId: userId,
                userEmail: 'unknown',
                displayName: 'Match Award',
                action: 'add',
                amount: amount,
                previousPoints: userDoc.exists() ? (userDoc.data().points || 0) : 0,
                newPoints: (userDoc.exists() ? (userDoc.data().points || 0) : 0) + amount,
                reason: reason,
                adminEmail: 'system-match-award',
                timestamp: serverTimestamp()
            });
        } catch (logError) {
            console.warn('Could not log points transaction:', logError);
            // Don't fail the points award for logging issues
        }
        
        console.log(`✅ Successfully awarded ${amount} points to ${userId} for: ${reason}`);
        return true;
        
    } catch (error) {
        console.error(`❌ Error awarding points to ${userId}:`, error);
        return false;
    }
}