// logout.js
import { getAuth } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js";
import { app } from './login.js';

export function initializeLogout() {
    const auth = getAuth(app);
    const signOutLink = document.getElementById('sign-out');

    if (signOutLink) {
        signOutLink.addEventListener('click', function(e) {
            e.preventDefault();
            auth.signOut().then(function() {
                // Sign-out successful.
                console.log('User signed out.');
                window.location.href = 'index.html'; // Redirect to home page
            }).catch(function(error) {
                // An error happened.
                console.error('Sign-out error:', error);
            });
        });
    } else {
        console.error('Sign-out link not found.');
    }
}