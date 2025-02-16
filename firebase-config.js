// For Firebase JS SDK v7.20.0 and later, measurementId is optional
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
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
} else {
  firebase.app(); // if already initialized, use that one
}
const db = firebase.firestore();
const auth = firebase.auth();