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
            const currentUserSpan = document.getElementById('current-user');
            const signOutLink = document.getElementById('sign-out');
            const loginRegisterLink = document.getElementById('login-register');

            db.collection('players').doc(user.uid).get()
                .then(doc => {
                    if (doc.exists) {
                        const username = doc.data().username;
                        if (currentUserSpan) {
                            currentUserSpan.textContent = username; // Display the username
                        }
                    } else {
                        if (currentUserSpan) {
                            currentUserSpan.textContent = user.displayName || user.email; // Fallback to display name or email
                        }
                        console.log("No such document!");
                    }
                }).catch(error => {
                    console.log("Error getting document:", error);
                    if (currentUserSpan) {
                        currentUserSpan.textContent = user.displayName || user.email; // Fallback to display name or email
                    }
                });
            if (currentUserSpan) {
                currentUserSpan.style.display = 'inline'; // Show the username
            }
            if (signOutLink) {
                signOutLink.style.display = 'inline'; // Show the sign-out link
            }
            if (loginRegisterLink) {
                loginRegisterLink.style.display = 'none'; // Hide login/register
            }
        } else {
            console.log('No user is signed in.');
            // Perform actions when no user is signed in
            const currentUserSpan = document.getElementById('current-user');
            const signOutLink = document.getElementById('sign-out');
            const loginRegisterLink = document.getElementById('login-register');

            if (currentUserSpan) {
                currentUserSpan.textContent = '';
                currentUserSpan.style.display = 'none'; // Hide the username
            }
            if (signOutLink) {
                signOutLink.style.display = 'none'; // Hide the sign-out link
            }
            if (loginRegisterLink) {
                loginRegisterLink.style.display = 'inline-block'; // Show login/register
            }
        }
    });
});