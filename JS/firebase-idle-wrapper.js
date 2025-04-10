import { auth, db } from './firebase-config.js';
import { handleNetworkError } from './idle-timeout.js';
import { 
    getDoc, getDocs, collection, doc, query, where, orderBy, limit, 
    startAfter, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
    getCountFromServer, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

/**
 * Firebase Idle Wrapper - Prevents operations during idle state to save read/write quota
 */
class FirebaseIdleWrapper {
    constructor() {
        this.activeListeners = new Map(); // stores all active listeners
        this.pendingOperations = new Map(); // stores operations that were attempted during idle
        this.pendingTimeout = null;
    }
    
    /**
     * Check if current session is active before performing Firebase operations
     * @returns {boolean} - Whether session is active
     */
    checkSessionActive() {
        // Check for session suspended flag (from idle-timeout.js)
        if (window.RDL_SESSION_SUSPENDED === true) {
            console.log('Firebase operation blocked - session idle');
            return false;
        }
        
        // Check for network error flag
        if (window.RDL_NETWORK_ERROR === true) {
            console.log('Firebase operation blocked - network error');
            return false;
        }
        
        return true;
    }
    
    /**
     * Safely execute Firebase operation with idle check
     * @param {Function} operation - Firebase operation to execute
     * @param {string} operationType - Type of operation for logging
     * @param {Array} args - Arguments to pass to operation
     * @returns {Promise} - Result of operation or null if session idle
     */
    async safeOperation(operation, operationType, ...args) {
        if (!this.checkSessionActive()) {
            // Store operation for potential later execution if needed
            const opKey = `${operationType}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
            this.pendingOperations.set(opKey, { operation, operationType, args });
            
            // Auto-clear pending operations after 5 minutes to prevent memory leaks
            if (!this.pendingTimeout) {
                this.pendingTimeout = setTimeout(() => {
                    this.pendingOperations.clear();
                    this.pendingTimeout = null;
                }, 5 * 60 * 1000);
            }
            
            return null;
        }
        
        try {
            return await operation(...args);
        } catch (error) {
            // Handle network-related errors
            if (error.code === 'unavailable' || 
                error.code === 'resource-exhausted' ||
                (error.message && error.message.includes('network'))) {
                handleNetworkError();
                return null;
            }
            throw error; // Re-throw other errors
        }
    }
    
    /**
     * Safe wrapper for getDoc
     * @param {DocumentReference} docRef - Document reference
     * @returns {Promise<DocumentSnapshot|null>} - Document snapshot or null if session idle
     */
    async getDocument(docRef) {
        return this.safeOperation(getDoc, 'get', docRef);
    }
    
    /**
     * Safe wrapper for getDocs
     * @param {Query|CollectionReference} query - Query or collection reference
     * @returns {Promise<QuerySnapshot|null>} - Query snapshot or null if session idle
     */
    async getDocuments(queryRef) {
        return this.safeOperation(getDocs, 'query', queryRef);
    }
    
    /**
     * Safe wrapper for addDoc
     * @param {CollectionReference} collectionRef - Collection reference
     * @param {Object} data - Document data
     * @returns {Promise<DocumentReference|null>} - Document reference or null if session idle
     */
    async addDocument(collectionRef, data) {
        return this.safeOperation(addDoc, 'add', collectionRef, data);
    }
    
    /**
     * Safe wrapper for setDoc
     * @param {DocumentReference} docRef - Document reference
     * @param {Object} data - Document data
     * @param {Object} options - Options
     * @returns {Promise<void|null>} - Promise or null if session idle
     */
    async setDocument(docRef, data, options = {}) {
        return this.safeOperation(setDoc, 'set', docRef, data, options);
    }
    
    /**
     * Safe wrapper for updateDoc
     * @param {DocumentReference} docRef - Document reference
     * @param {Object} data - Document data
     * @returns {Promise<void|null>} - Promise or null if session idle
     */
    async updateDocument(docRef, data) {
        return this.safeOperation(updateDoc, 'update', docRef, data);
    }
    
    /**
     * Safe wrapper for deleteDoc
     * @param {DocumentReference} docRef - Document reference
     * @returns {Promise<void|null>} - Promise or null if session idle
     */
    async deleteDocument(docRef) {
        return this.safeOperation(deleteDoc, 'delete', docRef);
    }
    
    /**
     * Safe wrapper for onSnapshot with automatic suspension
     * @param {Query|DocumentReference} ref - Query or document reference
     * @param {Function} callback - Callback function
     * @returns {Function} - Unsubscribe function
     */
    onSnapshotWithIdleHandling(ref, callback) {
        const refPath = ref.path || 'query';
        
        // Create a listener that can be paused
        let unsubscribe = null;
        let isSuspended = false;
        
        // Function to start/resume listening
        const startListening = () => {
            if (!isSuspended && this.checkSessionActive()) {
                unsubscribe = onSnapshot(ref, snapshot => {
                    callback(snapshot);
                }, error => {
                    console.error('Snapshot listener error:', error);
                    if (error.code === 'unavailable' || error.code.includes('network')) {
                        handleNetworkError();
                        suspendListener();
                    }
                });
            }
        };
        
        // Function to suspend listening
        const suspendListener = () => {
            if (unsubscribe) {
                unsubscribe();
                unsubscribe = null;
                isSuspended = true;
            }
        };
        
        // Create combined controller
        const controller = {
            path: refPath,
            suspend: suspendListener,
            resume: () => {
                isSuspended = false;
                startListening();
            },
            unsubscribe: () => {
                if (unsubscribe) unsubscribe();
                this.activeListeners.delete(refPath);
            }
        };
        
        // Store in active listeners map
        this.activeListeners.set(refPath, controller);
        
        // Start listening immediately if session is active
        startListening();
        
        // Return unsubscribe function
        return controller.unsubscribe;
    }
    
    /**
     * Suspend all active listeners when session becomes idle
     */
    suspendAllListeners() {
        console.log(`Suspending ${this.activeListeners.size} active Firebase listeners`);
        this.activeListeners.forEach(listener => {
            listener.suspend();
        });
    }
    
    /**
     * Resume all listeners when session is resumed
     */
    resumeAllListeners() {
        console.log(`Resuming ${this.activeListeners.size} Firebase listeners`);
        this.activeListeners.forEach(listener => {
            listener.resume();
        });
    }
    
    /**
     * Execute pending operations (optional, for critical operations)
     * @param {string} type - Type of operations to execute, or 'all'
     */
    executePendingOperations(type = 'all') {
        console.log(`Executing pending ${type} operations: ${this.pendingOperations.size} total operations`);
        
        // Create a copy to avoid modification during iteration
        const pendingOps = new Map(this.pendingOperations);
        this.pendingOperations.clear();
        
        pendingOps.forEach((op, key) => {
            if (type === 'all' || op.operationType === type) {
                console.log(`Executing delayed ${op.operationType} operation`);
                this.safeOperation(op.operation, op.operationType, ...op.args)
                    .catch(error => console.error('Error executing pending operation:', error));
            } else {
                // Put it back if we're only executing specific types
                this.pendingOperations.set(key, op);
            }
        });
    }
}

// Create singleton instance
const firebaseIdle = new FirebaseIdleWrapper();

// Modify idle-timeout.js functions to integrate with this wrapper
export function enhanceIdleTimeout() {
    // Original functions from idle-timeout.js
    const originalSuspendSession = window.suspendSession || function() {};
    const originalResumeSession = window.resumeSession || function() {};
    
    // Replace or enhance the suspendSession function
    window.suspendSession = function() {
        // Call original function
        originalSuspendSession();
        
        // Additionally suspend all Firebase listeners
        firebaseIdle.suspendAllListeners();
    };
    
    // Replace or enhance the resumeSession function
    window.resumeSession = function() {
        // Call original function
        originalResumeSession();
        
        // Additionally resume all Firebase listeners
        firebaseIdle.resumeAllListeners();
        
        // Optional: Execute only critical pending operations
        // firebaseIdle.executePendingOperations('critical');
    };
}

export default firebaseIdle;