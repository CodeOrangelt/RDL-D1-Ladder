// login.js

import { firebaseConfig } from './firebase-config.js'; // Import Firebase configuration

// Initialize Firebase
const app = firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Register Form Submission
document.getElementById('register-form').addEventListener('submit', function (e) {
    e.preventDefault();

    const username = document.getElementById('register-username').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const registerErrorDiv = document.getElementById('register-error');

    auth.createUserWithEmailAndPassword(email, password)
        .then(userCredential => {
            const user = userCredential.user;
            console.log("User registered:", user);
            return db.collection('players').doc(user.uid).set({
                username: username,
                email: email,
                points: 0,
                eloRating: 1200, // Default ELO rating
                position: 0 // Default position
            });
        })
        .then(() => {
            console.log("User data saved to Firestore");
            alert('Registration successful! You can now log in.');
            document.getElementById('register-form').reset();
        })
        .catch(error => {
            console.error("Error registering user:", error);
            registerErrorDiv.textContent = error.message; // Use textContent to prevent XSS
        });
});

// Login Form Submission
document.getElementById('login-form').addEventListener('submit', function (e) {
    e.preventDefault();

    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const loginErrorDiv = document.getElementById('login-error');

    auth.signInWithEmailAndPassword(email, password)
        .then(() => {
            console.log('Login successful!');
            alert('Login successful!');
            window.location.href = 'index.html';
        })
        .catch(error => {
            console.error("Error logging in user:", error);
            loginErrorDiv.textContent = error.message; // Use textContent to prevent XSS
        });
});

export { auth, app };