import { auth, db } from './firebase-config.js';
import { handleNetworkError } from './idle-timeout.js';
import { 
    getDoc, getDocs, collection, doc, query, where, orderBy, limit, 
    startAfter, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
    getCountFromServer, writeBatch, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

/**
 * Firebase Idle Wrapper - Prevents operations during idle state to save read/write quota
 */
class FirebaseIdleWrapper {
    constructor() {
        this.activeListeners = new Map(); // stores all active listeners
        this.pendingOperations = new Map(); // stores operations that were attempted during idle
        this.pendingTimeout = null;
        this.blockedOperations = 0; // NEW: Track blocked operations
        this.debug = false; // NEW: Debug mode flag
    }
    
    /**
     * Check if current session is active before performing Firebase operations
     * @returns {boolean} - Whether session is active
     */
    checkSessionActive() {
        // Check for session suspended flag (from idle-timeout.js)
        if (window.RDL_SESSION_SUSPENDED === true) {
            console.log('[FirebaseIdle] Operation blocked - session idle');
            
            // NEW: Track metrics
            this.blockedOperations = (this.blockedOperations || 0) + 1;
            if (this.blockedOperations % 10 === 0) {
                console.warn(`[FirebaseIdle] Blocked ${this.blockedOperations} operations during idle state`);
            }
            return false;
        }
        
        // Check for network error flag
        if (window.RDL_NETWORK_ERROR === true) {
            console.log('[FirebaseIdle] Operation blocked - network error');
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
     * Suspend all active Firebase listeners
     */
    suspendAllListeners() {
        console.log('[FirebaseIdle] Suspending all active listeners:', this.activeListeners.size);
        
        // Store current listeners for resumption later
        this._suspendedListeners = new Map(this.activeListeners);
        
        // Unsubscribe each listener
        this.activeListeners.forEach((unsubscribe, key) => {
            console.log('[FirebaseIdle] Suspending listener:', key);
            // Call the unsubscribe function returned by onSnapshot
            if (typeof unsubscribe === 'function') {
                try {
                    unsubscribe();
                    console.log('[FirebaseIdle] Successfully suspended listener:', key);
                } catch (error) {
                    console.error('[FirebaseIdle] Error suspending listener:', key, error);
                }
            }
        });
        
        // Clear the active listeners map
        this.activeListeners.clear();
        
        // Add visual indicator if in debug mode
        if (this.debug) {
            const indicator = document.createElement('div');
            indicator.id = 'firebase-suspend-indicator';
            indicator.style.cssText = `
                position: fixed;
                bottom: 10px;
                right: 10px;
                background-color: #333;
                color: #ff5555;
                padding: 5px 10px;
                border-radius: 4px;
                font-size: 12px;
                z-index: 9999;
            `;
            indicator.textContent = 'Firebase: Suspended';
            document.body.appendChild(indicator);
        }
        
        console.log('[FirebaseIdle] All listeners suspended');
    }
    
    /**
     * Resume all previously suspended listeners
     */
    resumeAllListeners() {
        if (!this._suspendedListeners || this._suspendedListeners.size === 0) {
            console.log('[FirebaseIdle] No listeners to resume');
            return;
        }
        
        console.log('[FirebaseIdle] Resuming listeners:', this._suspendedListeners.size);
        
        // We'll need to reestablish all previous listeners
        this._suspendedListeners.forEach((listenerConfig, key) => {
            console.log('[FirebaseIdle] Resuming listener:', key);
            
            try {
                // If it's already a function, it's the old way and we just store it back
                if (typeof listenerConfig === 'function') {
                    // Can't actually resume this way, need to recreate via the query
                    console.warn('[FirebaseIdle] Cannot resume listener directly:', key);
                    return;
                }
                
                // With new format we have the query and callback stored
                const { query, callback, options } = listenerConfig;
                if (query && callback) {
                    // Re-establish the listener
                    const newUnsubscribe = onSnapshot(query, callback, options || {});
                    this.activeListeners.set(key, newUnsubscribe);
                    console.log('[FirebaseIdle] Successfully resumed listener:', key);
                }
            } catch (error) {
                console.error('[FirebaseIdle] Error resuming listener:', key, error);
            }
        });
        
        // Clear suspended listeners
        this._suspendedListeners.clear();
        
        // Remove visual indicator
        const indicator = document.getElementById('firebase-suspend-indicator');
        if (indicator) {
            indicator.remove();
        }
        
        console.log('[FirebaseIdle] Listeners resumed');
    }
    
    /**
     * Create a real-time listener with idle checking
     * @param {object} query - Firestore query to listen to
     * @param {Function} callback - Callback to execute on changes
     * @param {object} options - onSnapshot options
     * @param {string} name - Optional name for this listener
     * @returns {Function} - Unsubscribe function
     */
    createListener(query, callback, options = {}, name = null) {
        // Generate a unique ID for this listener if name not provided
        const listenerId = name || `listener_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        if (this.debug) {
            console.log(`[FirebaseIdle] Creating listener: ${listenerId}`);
        }
        
        if (!this.checkSessionActive()) {
            console.log(`[FirebaseIdle] Session suspended, not creating listener: ${listenerId}`);
            // Return a dummy unsubscribe function
            return () => {};
        }
        
        try {
            // Create the real listener
            const unsubscribe = onSnapshot(query, callback, options);
            
            // Store both the unsubscribe function AND the original query & callback
            // so we can recreate it later if needed
            this.activeListeners.set(listenerId, {
                unsubscribe,
                query,
                callback,
                options
            });
            
            if (this.debug) {
                console.log(`[FirebaseIdle] Listener created: ${listenerId}`);
                console.log(`[FirebaseIdle] Active listeners: ${this.activeListeners.size}`);
            }
            
            // Return a special unsubscribe function that also removes from our tracking
            return () => {
                if (this.debug) {
                    console.log(`[FirebaseIdle] Manually unsubscribing listener: ${listenerId}`);
                }
                
                try {
                    // Call the real unsubscribe
                    unsubscribe();
                    
                    // Remove from our map
                    this.activeListeners.delete(listenerId);
                    
                    if (this.debug) {
                        console.log(`[FirebaseIdle] Listener removed: ${listenerId}`);
                        console.log(`[FirebaseIdle] Active listeners: ${this.activeListeners.size}`);
                    }
                } catch (error) {
                    console.error(`[FirebaseIdle] Error unsubscribing listener ${listenerId}:`, error);
                }
            };
        } catch (error) {
            console.error(`[FirebaseIdle] Error creating listener ${listenerId}:`, error);
            return () => {}; // Return dummy function
        }
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
    
    /**
     * Enable or disable debug mode
     * @param {boolean} enable - Whether to enable debug mode
     */
    enableDebug(enable = true) {
        this.debug = enable;
        console.log(`[FirebaseIdle] Debug mode ${enable ? 'enabled' : 'disabled'}`);
        
        if (enable) {
            // Force test suspension
            const originalStatus = window.RDL_SESSION_SUSPENDED;
            window.RDL_SESSION_SUSPENDED = true;
            console.log('[FirebaseIdle] Testing suspension - attempting read...');
            
            // Try a sample read operation
            this.getDocument(doc(db, 'system', 'test'))
                .then(result => {
                    console.log('[FirebaseIdle] TEST FAILED - read succeeded during suspension', result);
                })
                .catch(err => {
                    console.log('[FirebaseIdle] Error during test (expected):', err);
                })
                .finally(() => {
                    console.log('[FirebaseIdle] Suspension test complete');
                    window.RDL_SESSION_SUSPENDED = originalStatus;
                });
        }
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