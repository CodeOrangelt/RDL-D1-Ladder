import {
    collection as firestoreCollection,
    doc as firestoreDoc,
    getDoc as firestoreGetDoc,
    getDocs as firestoreGetDocs,
    query as firestoreQuery,
    where as firestoreWhere,
    orderBy as firestoreOrderBy,
    limit as firestoreLimit,
    startAfter as firestoreStartAfter,
    addDoc as firestoreAddDoc,
    updateDoc as firestoreUpdateDoc,
    deleteDoc as firestoreDeleteDoc,
    writeBatch as firestoreWriteBatch,
    serverTimestamp as firestoreServerTimestamp,
    Timestamp as firestoreTimestamp,
    getCountFromServer as firestoreGetCountFromServer,
    setDoc as firestoreSetDoc,
    enableNetwork,
    disableNetwork
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from './firebase-config.js';
import { handleNetworkError } from './idle-timeout.js';

// Check if session is suspended before performing Firestore operations
function checkSessionStatus() {
    if (window.RDL_SESSION_SUSPENDED) {
        console.warn('Firestore operation blocked - session suspended');
        const error = new Error('Session suspended due to inactivity. Please resume your session.');
        error.code = 'session-suspended';
        throw error;
    }
    
    if (window.RDL_NETWORK_ERROR) {
        console.warn('Firestore operation blocked - network error');
        const error = new Error('Network connection error. Please check your internet connection.');
        error.code = 'network-error';
        throw error;
    }
}

// Handle network error
async function handleFirestoreError(error) {
    console.error('Firestore operation failed:', error);
    
    if (error && (
        error.code === 'unavailable' || 
        error.code === 'resource-exhausted' ||
        (error.message && error.message.includes('network')) ||
        (error.code && error.code.includes('network'))
    )) {
        console.warn('Network-related error detected, suspending operations');
        handleNetworkError();
        return true;
    }
    
    return false;
}

// Firestore wrapper with session checks and network error handling
export const rdlFirestore = {
    // Collection reference - fixed to handle multiple argument patterns
    collection: function() {
        // Handle different argument patterns
        if (arguments.length === 1) {
            // Case: collection('collectionName')
            if (typeof arguments[0] === 'string') {
                return firestoreCollection(db, arguments[0]);
            } 
            // Case: collection(collectionRef)
            return arguments[0];
        } 
        // Case: collection(db, 'collectionName')
        else if (arguments.length === 2 && arguments[0] === db && typeof arguments[1] === 'string') {
            return firestoreCollection(db, arguments[1]);
        }
        // Fallback: pass all arguments through
        return firestoreCollection.apply(null, arguments);
    },
    
    // Document reference - fixed to handle multiple argument patterns
    doc: function() {
        if (arguments.length === 2) {
            // Case: doc('collectionName', 'docId')
            if (typeof arguments[0] === 'string' && typeof arguments[1] === 'string') {
                return firestoreDoc(db, arguments[0], arguments[1]);
            }
            // Case: doc(collectionRef, 'docId')
            return firestoreDoc.apply(null, arguments);
        }
        else if (arguments.length === 3 && arguments[0] === db) {
            // Case: doc(db, 'collectionName', 'docId')
            return firestoreDoc.apply(null, arguments);
        }
        // Fallback: pass all arguments through
        return firestoreDoc.apply(null, arguments);
    },
    
    // Query functions
    query: function() {
        return firestoreQuery.apply(null, arguments);
    },
    
    where: function() {
        return firestoreWhere.apply(null, arguments);
    },
    
    orderBy: function() {
        return firestoreOrderBy.apply(null, arguments);
    },
    
    limit: function(n) {
        return firestoreLimit(n);
    },
    
    startAfter: function(docSnapshot) {
        return firestoreStartAfter(docSnapshot);
    },
    
    // Read operations with error handling
    getDoc: async function(docRef) {
        try {
            checkSessionStatus();
            return await firestoreGetDoc(docRef);
        } catch (error) {
            const isNetworkError = await handleFirestoreError(error);
            if (isNetworkError) {
                error.code = 'network-error';
            }
            throw error;
        }
    },
    
    getDocs: async function(queryRef) {
        try {
            checkSessionStatus();
            return await firestoreGetDocs(queryRef);
        } catch (error) {
            const isNetworkError = await handleFirestoreError(error);
            if (isNetworkError) {
                error.code = 'network-error';
            }
            throw error;
        }
    },
    
    getCountFromServer: async function(queryRef) {
        try {
            checkSessionStatus();
            return await firestoreGetCountFromServer(queryRef);
        } catch (error) {
            const isNetworkError = await handleFirestoreError(error);
            if (isNetworkError) {
                error.code = 'network-error';
            }
            throw error;
        }
    },
    
    // Write operations with error handling
    addDoc: async function(collectionRef, data) {
        try {
            checkSessionStatus();
            return await firestoreAddDoc(collectionRef, data);
        } catch (error) {
            const isNetworkError = await handleFirestoreError(error);
            if (isNetworkError) {
                error.code = 'network-error';
            }
            throw error;
        }
    },
    
    setDoc: async function(docRef, data, options) {
        try {
            checkSessionStatus();
            return await firestoreSetDoc(docRef, data, options);
        } catch (error) {
            const isNetworkError = await handleFirestoreError(error);
            if (isNetworkError) {
                error.code = 'network-error';
            }
            throw error;
        }
    },
    
    updateDoc: async function(docRef, data) {
        try {
            checkSessionStatus();
            return await firestoreUpdateDoc(docRef, data);
        } catch (error) {
            const isNetworkError = await handleFirestoreError(error);
            if (isNetworkError) {
                error.code = 'network-error';
            }
            throw error;
        }
    },
    
    deleteDoc: async function(docRef) {
        try {
            checkSessionStatus();
            return await firestoreDeleteDoc(docRef);
        } catch (error) {
            const isNetworkError = await handleFirestoreError(error);
            if (isNetworkError) {
                error.code = 'network-error';
            }
            throw error;
        }
    },
    
    // Batch operations with error handling
    writeBatch: function() {
        checkSessionStatus();
        const batch = firestoreWriteBatch(db);
        
        // Create a wrapper around the batch to check session status before commit
        const originalCommit = batch.commit.bind(batch);
        batch.commit = async function() {
            try {
                checkSessionStatus();
                return await originalCommit();
            } catch (error) {
                const isNetworkError = await handleFirestoreError(error);
                if (isNetworkError) {
                    error.code = 'network-error';
                }
                throw error;
            }
        };
        
        return batch;
    },
    
    // Timestamp functions
    serverTimestamp: function() {
        return firestoreServerTimestamp();
    },
    
    Timestamp: {
        now: function() {
            return firestoreTimestamp.now();
        },
        fromDate: function(date) {
            return firestoreTimestamp.fromDate(date);
        }
    },
    
    // Network controls
    enableNetwork: async function() {
        try {
            return await enableNetwork(db);
        } catch (error) {
            console.error('Failed to enable network:', error);
            throw error;
        }
    },
    
    disableNetwork: async function() {
        try {
            return await disableNetwork(db);
        } catch (error) {
            console.error('Failed to disable network:', error);
            throw error;
        }
    }
};

// Add global error handler for uncaught session suspension errors
window.addEventListener('error', function(event) {
    if (event.error) {
        if (event.error.code === 'session-suspended') {
            // Prevent the default error handler
            event.preventDefault();
            console.log('Caught session suspended error:', event.error.message);
        } 
        else if (
            event.error.code === 'unavailable' || 
            event.error.code === 'resource-exhausted' ||
            (event.error.message && event.error.message.includes('network')) ||
            (event.error.code && event.error.code.includes('network'))
        ) {
            // Handle network errors
            event.preventDefault();
            console.log('Caught network error:', event.error.message);
            handleNetworkError();
        }
    }
});

// Add to window so other scripts can access
window.rdlFirestore = rdlFirestore;

console.log('Firestore wrapper initialized with session checking and network error handling');