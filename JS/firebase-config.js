// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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
export const auth = getAuth(app);
export const db = getFirestore(app);

//debug lines for connection ping
console.log('Firebase initialized:', !!app);
console.log('Firestore initialized:', !!db);