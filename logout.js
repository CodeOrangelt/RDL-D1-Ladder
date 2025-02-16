// logout.js
import { signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth } from './firebase-config.js';

function initializeLogout() {
    const signOutLink = document.getElementById('sign-out');
    if (signOutLink) {
        signOutLink.addEventListener('click', async function(e) {
            e.preventDefault();
            try {
                await signOut(auth);
                console.log('User signed out.');
                window.location.href = 'index.html';
            } catch (error) {
                console.error('Sign-out error:', error);
            }
        });
    } else {
        console.error('Sign-out link not found.');
    }
}

export { initializeLogout };

