import { db } from './firebase-config.js';
import { doc, getDoc, updateDoc, addDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Points chart matching your requirements
const POINTS_CHART = {
    '': 10, // Standard match
    'Standard': 10,
    'Standard Match': 10,
    'Fusion Match': 25,
    '≥6 Missiles': 10,
    'Weapon Imbalance': 30,
    'No Energy': 15,
    'No Shields': 15,
    'Pilot Assist Only': 20,
    'Classic Robots': 15,
    'Enhanced CTF': 25,
    'CTF Hybrids': 30,
    'Custom Weapon Load': 25,
    'Tracker/Merc': 20,
    'Bomb/Bomb': 15,
    'Zoom/Zoom': 15,
    'Stock Ships Only': 20,
    'Expert AI Match': 35,
    'Challenge Match': 40,
    'Tournament Match': 50
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
            console.log(`User profile not found for ${userId}, skipping points award`);
            return;
        }
        
        const userData = userDoc.data();
        const currentPoints = userData.points || 0;
        const newPoints = currentPoints + amount;
        
        // Update user points
        await updateDoc(userRef, {
            points: newPoints,
            lastPointsModified: serverTimestamp()
        });
        
        // Log the points change
        await addDoc(collection(db, 'pointsHistory'), {
            userId: userId,
            userEmail: userData.email || 'unknown',
            displayName: userData.displayName || userData.username || 'Unknown User',
            action: 'add',
            amount: amount,
            previousPoints: currentPoints,
            newPoints: newPoints,
            reason: reason,
            adminEmail: 'system-match-award',
            timestamp: serverTimestamp()
        });
        
        console.log(`Added ${amount} points to user ${userId}. New total: ${newPoints}`);
    } catch (error) {
        console.error('Error adding points to user:', error);
        throw error;
    }
}