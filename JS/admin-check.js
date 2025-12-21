import { 
    doc, 
    getDoc, 
    collection, 
    query, 
    where, 
    getDocs 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from './firebase-config.js';

// Hardcoded admin emails for quick access
const ADMIN_EMAILS = ['admin@ladder.com', 'brian2af@outlook.com'];

// Admin roles that grant full access
const ADMIN_ROLES = ['council', 'creative lead', 'owner', 'admin'];

// Cache to avoid repeated database lookups
const adminCache = new Map();
const CACHE_DURATION = 300000; // 5 minutes

// Simple synchronous check for hardcoded admins
export function isAdmin(email) {
    return email && ADMIN_EMAILS.includes(email.toLowerCase());
}

// Comprehensive async check including database roles
export async function isAdminWithRoles(user) {
    if (!user) return false;
    
    // Check hardcoded emails first (fastest)
    if (user.email && isAdmin(user.email)) {
        return true;
    }
    
    // Check cache
    const cacheKey = user.uid || user.email;
    const cached = adminCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return cached.isAdmin;
    }
    
    try {
        const collections = ['players', 'playersD2', 'playersD3', 'nonParticipants', 'userProfiles'];
        
        // Check by UID first
        if (user.uid) {
            for (const collectionName of collections) {
                try {
                    const docRef = doc(db, collectionName, user.uid);
                    const docSnap = await getDoc(docRef);
                    
                    if (docSnap.exists()) {
                        const userData = docSnap.data();
                        const roleName = (userData.roleName || userData.role || '').toLowerCase();
                        
                        if (roleName && ADMIN_ROLES.includes(roleName)) {
                            adminCache.set(cacheKey, { isAdmin: true, timestamp: Date.now() });
                            return true;
                        }
                    }
                } catch (err) {
                    console.error(`Error checking ${collectionName}:`, err);
                }
            }
        }
        
        // Check by email if UID check didn't find anything
        if (user.email) {
            for (const collectionName of collections) {
                try {
                    const colRef = collection(db, collectionName);
                    let q = query(colRef, where('email', '==', user.email));
                    let snapshot = await getDocs(q);
                    
                    if (snapshot.empty) {
                        q = query(colRef, where('email', '==', user.email.toLowerCase()));
                        snapshot = await getDocs(q);
                    }
                    
                    if (!snapshot.empty) {
                        const userData = snapshot.docs[0].data();
                        const roleName = (userData.roleName || userData.role || '').toLowerCase();
                        
                        if (roleName && ADMIN_ROLES.includes(roleName)) {
                            adminCache.set(cacheKey, { isAdmin: true, timestamp: Date.now() });
                            return true;
                        }
                    }
                } catch (err) {
                    console.error(`Error checking ${collectionName}:`, err);
                }
            }
        }
        
        // Not an admin
        adminCache.set(cacheKey, { isAdmin: false, timestamp: Date.now() });
        return false;
        
    } catch (error) {
        console.error('Error in isAdminWithRoles:', error);
        return false;
    }
}