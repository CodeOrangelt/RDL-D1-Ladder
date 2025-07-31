const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// Aggregated member data updater
exports.updateMembersList = functions.firestore
    .document('{collection}/{docId}')
    .onWrite(async (change, context) => {
        const collection = context.params.collection;
        const docId = context.params.docId;
        
        // Only trigger for relevant collections
        if (!['players', 'playersD2', 'playersD3', 'userProfiles', 'nonParticipants'].includes(collection)) {
            return null;
        }
                
        try {
            await rebuildMembersList();
            console.log('Successfully updated aggregated members list');
        } catch (error) {
            console.error('Error updating members list:', error);
        }
    });

// Rebuild the entire members list (called by trigger or manually)
async function rebuildMembersList() {
    const batch = db.batch();
    
    // Fetch all collections in parallel
    const [userProfilesSnap, d1Snap, d2Snap, d3Snap, nonParticipantsSnap] = await Promise.all([
        db.collection('userProfiles').get(),
        db.collection('players').get(),
        db.collection('playersD2').get(),
        db.collection('playersD3').get(),
        db.collection('nonParticipants').get()
    ]);
    
    // Create profiles map
    const profilesMap = new Map();
    userProfilesSnap.forEach(doc => {
        profilesMap.set(doc.id, doc.data());
    });
    
    // Process all player data
    const membersMap = new Map();
    
    // Helper function to process ladder players
    const processLadder = (snapshot, ladderName) => {
        snapshot.forEach(doc => {
            const playerData = doc.data();
            const userId = doc.id;
            
            if (!membersMap.has(userId)) {
                membersMap.set(userId, {
                    userId,
                    username: playerData.username || 'Unknown',
                    ladders: [],
                    isNonParticipant: false
                });
            }
            
            const member = membersMap.get(userId);
            member.ladders.push({
                ladder: ladderName,
                elo: playerData.eloRating || 1200,
                active: playerData.active !== false
            });
        });
    };
    
    // Process each ladder
    processLadder(d1Snap, 'D1');
    processLadder(d2Snap, 'D2');
    processLadder(d3Snap, 'D3');
    
    // Process non-participants
    nonParticipantsSnap.forEach(doc => {
        const userData = doc.data();
        const userId = doc.id;
        
        if (!membersMap.has(userId) && userData.username) {
            membersMap.set(userId, {
                userId,
                username: userData.username,
                ladders: [],
                isNonParticipant: true
            });
        }
    });
    
    // Combine with profiles and create final aggregated data
    const aggregatedMembers = [];
    
    membersMap.forEach((member, userId) => {
        const profile = profilesMap.get(userId) || {};
        
        // Calculate highest ELO and primary ladder
        let highestElo = 0;
        let primaryLadder = null;
        
        if (member.ladders.length > 0) {
            const sortedLadders = member.ladders.sort((a, b) => b.elo - a.elo);
            highestElo = sortedLadders[0].elo;
            primaryLadder = sortedLadders[0].ladder;
        }
        
        const aggregatedMember = {
            userId,
            username: member.username,
            profileImageUrl: profile.profileImageUrl || null,
            country: profile.country || null,
            motto: profile.motto || null,
            favoriteMap: profile.favoriteMap || null,
            favoriteWeapon: profile.favoriteWeapon || null,
            isNonParticipant: member.isNonParticipant,
            ladders: member.ladders,
            primaryLadder,
            highestElo,
            rank: getPlayerRank(highestElo),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        };
        
        aggregatedMembers.push(aggregatedMember);
    });
    
    // Clear existing aggregated collection and write new data
    const aggregatedRef = db.collection('aggregatedMembers');
    
    // Delete existing documents in batches
    const existingDocs = await aggregatedRef.get();
    const deletePromises = [];
    
    existingDocs.forEach(doc => {
        deletePromises.push(doc.ref.delete());
    });
    
    await Promise.all(deletePromises);
    
    // Write new aggregated data in batches
    const batchSize = 500;
    const batches = [];
    
    for (let i = 0; i < aggregatedMembers.length; i += batchSize) {
        const batch = db.batch();
        const batchMembers = aggregatedMembers.slice(i, i + batchSize);
        
        batchMembers.forEach(member => {
            const docRef = aggregatedRef.doc(member.userId);
            batch.set(docRef, member);
        });
        
        batches.push(batch.commit());
    }
    
    await Promise.all(batches);

}

function getPlayerRank(elo) {
    if (elo >= 2000) return 'emerald';
    if (elo >= 1800) return 'gold';
    if (elo >= 1600) return 'silver';
    if (elo >= 1400) return 'bronze';
    return 'unranked';
}

// Manual trigger function for initial setup
exports.rebuildMembersListManual = functions.https.onRequest(async (req, res) => {
    try {
        await rebuildMembersList();
        res.status(200).send('Members list rebuilt successfully');
    } catch (error) {
        console.error('Error rebuilding members list:', error);
        res.status(500).send('Error rebuilding members list');
    }
});