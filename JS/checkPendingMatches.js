import { 
    collection, query, where, getDocs, doc, getDoc 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db, auth } from './firebase-config.js';

// Global variables for performance optimization
let lastCheckTime = 0;
const CHECK_INTERVAL = 10000; // 10 seconds between checks (increased from 5)
const NOTIFICATION_CACHE_KEY = 'pendingMatchesCache';
const CACHE_EXPIRY = 60000; // 1 minute cache expiry

// Function to check for pending matches awaiting approval
export async function checkPendingMatches(forceCheck = false) {
    const now = Date.now();
    
    // Check cache first for quick response
    const cachedResult = checkNotificationCache();
    if (cachedResult !== null && !forceCheck) {
        updateNotificationDot(cachedResult);
        
        // If cache is valid and not a forced check, we can exit early
        if (now - lastCheckTime < CHECK_INTERVAL) {
            return;
        }
    }
    
    lastCheckTime = now;
    
    const user = auth.currentUser;
    if (!user) {
        updateNotificationDot(false);
        updateNotificationCache(false);
        return;
    }
    
    try {
        // ✅ ADD FFA to the parallel queries
        const [pendingD1, pendingD2, pendingD3, pendingFFA] = await Promise.all([
            checkForPendingMatchesInCollection(user, 'pendingMatches'),
            checkForPendingMatchesInCollection(user, 'pendingMatchesD2'),
            checkForPendingMatchesInCollection(user, 'pendingMatchesD3'),
            checkForPendingFFAMatches(user) // ✅ NEW: Check FFA matches
        ]);
        
        // ✅ UPDATED: Include FFA in the check
        const hasPendingMatches = pendingD1 || pendingD2 || pendingD3 || pendingFFA;
        
        // Update UI and cache the result
        updateNotificationDot(hasPendingMatches);
        updateNotificationCache(hasPendingMatches);
        
    } catch (error) {
        console.error("Error checking pending matches:", error);
    }
}

// Check for pending matches in a specific collection using all available methods
async function checkForPendingMatchesInCollection(user, collectionName) {
    // Get all possible identifiers for the user
    const userId = user.uid;
    const email = user.email;
    
    // First try the most efficient query - by user ID
    const byIdQuery = query(
        collection(db, collectionName),
        where('winnerId', '==', userId),
        where('approved', '==', false)
    );
    
    const idResults = await getDocs(byIdQuery);
    if (!idResults.empty) {
        return true;
    }
    
    // If ID check fails, try by email
    if (email) {
        const byEmailQuery = query(
            collection(db, collectionName),
            where('winnerEmail', '==', email),
            where('approved', '==', false)
        );
        
        const emailResults = await getDocs(byEmailQuery);
        if (!emailResults.empty) {
            return true;
        }
    }
    
    // Only fetch username if previous checks failed
    let username = await getUsernameFromAllSources(user);
    
    // If we have a username, check by that as last resort
    if (username) {
        const byNameQuery = query(
            collection(db, collectionName),
            where('winnerUsername', '==', username),
            where('approved', '==', false)
        );
        
        const nameResults = await getDocs(byNameQuery);
        if (!nameResults.empty) {
            return true;
        }
    }
    
    return false;
}

// Helper function to get username from all possible sources
async function getUsernameFromAllSources(user) {
    // Try to get from localStorage first (fastest)
    const cachedUsername = localStorage.getItem('currentUsername');
    if (cachedUsername) {
        return cachedUsername;
    }
    
    // Try players collections (D1, D2 & D3)
    try {
        const [d1Snapshot, d2Snapshot, d3Snapshot] = await Promise.all([
            getDocs(query(collection(db, 'players'), where('userId', '==', user.uid))),
            getDocs(query(collection(db, 'playersD2'), where('userId', '==', user.uid))),
            getDocs(query(collection(db, 'playersD3'), where('userId', '==', user.uid)))
        ]);
        
        if (!d1Snapshot.empty) {
            const username = d1Snapshot.docs[0].data().username;
            localStorage.setItem('currentUsername', username);
            return username;
        } 
        
        if (!d2Snapshot.empty) {
            const username = d2Snapshot.docs[0].data().username;
            localStorage.setItem('currentUsername', username);
            return username;
        }
        
        if (!d3Snapshot.empty) {
            const username = d3Snapshot.docs[0].data().username;
            localStorage.setItem('currentUsername', username);
            return username;
        }
        
        // Try users collection
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists() && userDoc.data().username) {
            const username = userDoc.data().username;
            localStorage.setItem('currentUsername', username);
            return username;
        }
    } catch (error) {
        console.error("Error fetching username:", error);
    }
    
    // Use email prefix as last resort
    if (user.email) {
        return user.email.split('@')[0];
    }
    
    return null;
}

// Cache notification state to reduce database reads
function updateNotificationCache(hasPendingMatches) {
    const cacheData = {
        status: hasPendingMatches,
        timestamp: Date.now()
    };
    localStorage.setItem(NOTIFICATION_CACHE_KEY, JSON.stringify(cacheData));
}

// Check if we have a valid cached notification state
function checkNotificationCache() {
    const cachedData = localStorage.getItem(NOTIFICATION_CACHE_KEY);
    if (!cachedData) return null;
    
    try {
        const { status, timestamp } = JSON.parse(cachedData);
        const now = Date.now();
        
        // Return cached value if it's less than the expiry time
        if (now - timestamp < CACHE_EXPIRY) {
            return status;
        }
    } catch (e) {
        // Invalid cache data
    }
    
    return null;
}

// Helper function to update notification dot visibility (optimized)
export function updateNotificationDot(show) {
    // Instead of multiple timeouts, use a single MutationObserver
    const observer = new MutationObserver((mutations, obs) => {
        const mainDot = document.getElementById('report-match-notification');
        if (mainDot) {
            updateDotStyle(mainDot, show);
            obs.disconnect();
        }
    });
    
    // Start observing the document for changes
    observer.observe(document.body, { 
        childList: true,
        subtree: true
    });
    
    // Immediately try to update any dots that exist
    const mainDot = document.getElementById('report-match-notification');
    if (mainDot) {
        updateDotStyle(mainDot, show);
        observer.disconnect();
    }
    
    // Add a timeout to clean up the observer if it never finds the dot
    setTimeout(() => observer.disconnect(), 5000);
}

// Apply styling to a notification dot (unchanged)
function updateDotStyle(element, show) {
    if (show) {
        element.style.display = 'block';
        element.style.backgroundColor = '#ff3b30';
        element.style.width = '10px';
        element.style.height = '10px';
        element.style.position = 'absolute';
        element.style.top = '-5px';
        element.style.right = '-8px';
        element.style.borderRadius = '50%';
        element.style.border = '2px solid white';
        element.style.zIndex = '999';
    } else {
        element.style.display = 'none';
    }
}

// Function for other parts of the app to trigger notification checks
export function updatePendingMatchNotification() {
    // Force a new check immediately
    checkPendingMatches(true);
}

// Initialize notification system only once
document.addEventListener('DOMContentLoaded', () => {
    // Check immediately with a small delay to let the DOM load
    setTimeout(() => checkPendingMatches(), 500);
    
    // Check on auth state changes
    auth.onAuthStateChanged(() => {
        // Clear username cache on auth change
        localStorage.removeItem('currentUsername');
        setTimeout(() => checkPendingMatches(true), 500);
    });
    
    // Check periodically but less frequently (1 minute)
    setInterval(() => checkPendingMatches(), 60000);
});

async function checkForPendingFFAMatches(user) {
    try {
        // First, get the current user's FFA username
        const userFFADoc = await getDoc(doc(db, 'playersFFA', user.uid));
        let ffaUsername = null;
        
        if (userFFADoc.exists()) {
            ffaUsername = userFFADoc.data().username;
        }
        
        if (!ffaUsername) {
            // User is not registered in FFA ladder
            return false;
        }
        
        const pendingFFARef = collection(db, 'pendingMatchesFFA');
        const snapshot = await getDocs(pendingFFARef);
        
        // Check if user has any unconfirmed FFA matches
        for (const docSnap of snapshot.docs) {
            const data = docSnap.data();
            const players = data.players || [];
            const reporterUID = data.submittedByUID || data.reporterId;
            
            // Skip if user is the reporter (they already "confirmed" by submitting)
            if (reporterUID === user.uid) {
                continue;
            }
            
            // Check if current user is a participant who hasn't confirmed
            const userIsParticipant = players.some(p => 
                p.username === ffaUsername || p.odl_Id === user.uid
            );
            
            // Check confirmation status
            const confirmedBy = data.confirmedBy || [];
            const userHasConfirmed = confirmedBy.includes(user.uid) || confirmedBy.includes(ffaUsername);
            
            if (userIsParticipant && !userHasConfirmed) {
                console.log('Found pending FFA match requiring confirmation:', docSnap.id);
                return true;
            }
        }
        
        return false;
    } catch (error) {
        console.error('Error checking pending FFA matches:', error);
        return false;
    }
}