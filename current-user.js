// current-user.js
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";
import { app } from './login.js'; // Import the Firebase app instance

const auth = getAuth(app);
const db = getFirestore(app);

document.addEventListener('DOMContentLoaded', () => {
    // Check if user is signed in
    onAuthStateChanged(auth, function(user) {
        const currentUserSpan = document.getElementById('current-user');
        const signOutLink = document.getElementById('sign-out');
        const loginRegisterLink = document.getElementById('login-register');

        if (user) {
            // User is signed in.
            getDoc(doc(db, 'players', user.uid))
                .then(docSnapshot => {
                    if (docSnapshot.exists()) {
                        const username = docSnapshot.data().username;
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
            // No user is signed in.
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