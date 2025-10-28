// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, initializeFirestore, enableIndexedDbPersistence, CACHE_SIZE_UNLIMITED } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Import idle timeout functionality
import { initIdleTimeout } from './idle-timeout.js';

export const firebaseConfig = {
  apiKey: "AIzaSyDMF-bq4tpLoZvUYep_G-igmHbK2h-e-Zs",
  authDomain: "rdladder.firebaseapp.com",
  projectId: "rdladder",
  storageBucket: "rdladder.firebasestorage.app",
  messagingSenderId: "152922774046",
  appId: "1:152922774046:web:c14bd25f07ad1aa0366c0f",
  measurementId: "G-MXVPNC0TVJ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Set persistence to local (survives page refresh)
setPersistence(auth, browserLocalPersistence).catch((error) => {
    console.error('Error setting auth persistence:', error);
});

// Initialize Firestore with settings for reduced network usage
const firestoreSettings = {
  cacheSizeBytes: CACHE_SIZE_UNLIMITED,
  ignoreUndefinedProperties: true,
};

// Then initialize Firestore with optimized settings
initializeFirestore(app, firestoreSettings);

// Enable offline persistence (careful with quota)
enableIndexedDbPersistence(db)
  .catch((err) => {
    if (err.code === 'failed-precondition') {
      console.warn('Persistence failed - multiple tabs open');
    } else if (err.code === 'unimplemented') {
      console.warn('Persistence not available in this browser');
    }
  });

// Export the optimized db instance
export { app, db, auth, firebaseConfig };

//debug lines for connection ping
console.log('Firebase initialized:', !!app);
console.log('Firestore initialized:', !!db);

// Initialize idle timeout when firebase config is loaded
document.addEventListener('DOMContentLoaded', () => {
    initIdleTimeout();
});