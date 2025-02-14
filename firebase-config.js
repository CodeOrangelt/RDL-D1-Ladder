// firebase-config.js
const firebaseConfig = {
    apiKey: "AIzaSyDMF-bq4tpLoZvUYep_G-igmHbK2h-e-Zs",
    authDomain: "RDLadder.firebaseapp.com",
    projectId: "rdladder",
    storageBucket: "RDladder.appspot.com",
    messagingSenderId: "152922774046",
    appId: "1:152922774046:web:c14bd25f07ad1aa0366c0f"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
