// logout.js
import { signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth } from './firebase-config.js';

export function initializeLogout() {
    const signOutLink = document.getElementById('sign-out');
    if (!signOutLink) {
        console.error('Sign-out link not found.');
        return;
    }

    signOutLink.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
            await auth.signOut();
            window.location.href = '/index.html'; // Redirect to home page
        } catch (error) {
            console.error('Error signing out:', error);
        }
    });
}

