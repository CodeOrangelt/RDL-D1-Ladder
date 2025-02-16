// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";

const firebaseConfig = {
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
export const db = getFirestore(app); // Export the db object
export { app };
