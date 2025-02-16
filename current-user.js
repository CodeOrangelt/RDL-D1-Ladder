import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js';
import { firebaseConfig } from './firebase-config.js';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

document.addEventListener('DOMContentLoaded', function () {
    onAuthStateChanged(auth, user => {
        if (user) {
            console.log('User is signed in:', user);
            // Perform actions when the user is signed in
        } else {
            console.log('No user is signed in.');
            // Perform actions when no user is signed in
        }
    });
});