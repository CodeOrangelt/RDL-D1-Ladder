// Re-export wrapped Firestore functions
export { rdlFirestore } from './firestore-wrapper.js';

// Re-export Firebase modules
export { auth, db } from './firebase-config.js';

// Initialize idle timeout
import { initIdleTimeout } from './idle-timeout.js';
initIdleTimeout();

console.log('RDL imports initialized');