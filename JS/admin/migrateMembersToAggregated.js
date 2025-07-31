import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
    getFirestore, 
    collection, 
    getDocs, 
    writeBatch, 
    doc 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { firebaseConfig } from "../firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function migrateToAggregatedMembers() {
    console.log("🔄 Starting migration to aggregated members...");
    
    try {
        // Fetch all data (this is the LAST time we'll do this!)
        console.log("📥 Fetching all collections...");
        const [userProfilesSnap, d1Snap, d2Snap, d3Snap, nonParticipantsSnap] = await Promise.all([
            getDocs(collection(db, 'userProfiles')),
            getDocs(collection(db, 'players')),
            getDocs(collection(db, 'playersD2')),
            getDocs(collection(db, 'playersD3')),
            getDocs(collection(db, 'nonParticipants'))
        ]);
        
        console.log(`✅ Data fetched: ${userProfilesSnap.size} profiles, ${d1Snap.size} D1, ${d2Snap.size} D2, ${d3Snap.size} D3, ${nonParticipantsSnap.size} non-participants`);
        
        // Process data
        const profilesMap = new Map();
        userProfilesSnap.forEach(doc => {
            profilesMap.set(doc.id, doc.data());
        });
        
        const membersMap = new Map();
        
        // Process each ladder
        const processLadder = (snapshot, ladderName) => {
            snapshot.forEach(doc => {
                const playerData = doc.data();
                const userId = doc.id;
                
                if (!membersMap.has(userId)) {
                    membersMap.set(userId, {
                        userId,
                        username: playerData.username || playerData.name || 'Unknown',
                        ladders: [],
                        isNonParticipant: false
                    });
                }
                
                const member = membersMap.get(userId);
                member.ladders.push({
                    ladder: ladderName,
                    elo: playerData.eloRating || playerData.elo || 1200,
                    active: playerData.active !== false
                });
            });
        };
        
        // Process all ladders
        processLadder(d1Snap, 'D1');
        processLadder(d2Snap, 'D2');
        processLadder(d3Snap, 'D3');
        
        // Process non-participants
        nonParticipantsSnap.forEach(doc => {
            const userData = doc.data();
            const userId = doc.id;
            
            if (!membersMap.has(userId) && (userData.username || userData.name)) {
                membersMap.set(userId, {
                    userId,
                    username: userData.username || userData.name,
                    ladders: [],
                    isNonParticipant: true
                });
            }
        });
        
        console.log(`⚙️ Processed ${membersMap.size} unique members`);
        
        // Create aggregated documents in batches
        console.log("💾 Writing aggregated data...");
        const batches = [];
        let currentBatch = writeBatch(db);
        let batchCount = 0;
        let totalCount = 0;
        
        membersMap.forEach((member, userId) => {
            const profile = profilesMap.get(userId) || {};
            
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
                lastUpdated: new Date(),
                migrationTimestamp: new Date().toISOString()
            };
            
            const docRef = doc(collection(db, 'aggregatedMembers'), userId);
            currentBatch.set(docRef, aggregatedMember);
            batchCount++;
            totalCount++;
            
            if (batchCount >= 450) { // Stay under 500 limit
                batches.push(currentBatch.commit());
                currentBatch = writeBatch(db);
                batchCount = 0;
                console.log(`📦 Prepared batch ${batches.length} (${totalCount} members processed)`);
            }
        });
        
        if (batchCount > 0) {
            batches.push(currentBatch.commit());
        }
        
        // Execute all batches
        console.log(`🚀 Executing ${batches.length} batches...`);
        await Promise.all(batches);
        
        console.log(`🎉 Successfully migrated ${membersMap.size} members to aggregated collection!`);
        console.log("💡 Refresh your members page to see the results!");
        
    } catch (error) {
        console.error("❌ Migration failed:", error);
        
        if (error.code === 'permission-denied') {
            console.error("🔒 Permission denied. Make sure you're signed in as an admin and security rules allow access to aggregatedMembers collection.");
        }
    }
}

function getPlayerRank(elo) {
    if (elo >= 2000) return 'emerald';
    if (elo >= 1800) return 'gold';
    if (elo >= 1600) return 'silver';
    if (elo >= 1400) return 'bronze';
    return 'unranked';
}

// Run the migration
migrateToAggregatedMembers();