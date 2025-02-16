// logout.js
import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

export function initializeLogout() {
    const signOutLink = document.getElementById('sign-out-link');
    if (signOutLink) {
        signOutLink.addEventListener('click', async (e) => {
            e.preventDefault();
            try {
                const auth = getAuth();
                await signOut(auth);
                console.log('User signed out successfully');
                // Redirect to index page after successful logout
                window.location.href = 'index.html';
            } catch (error) {
                console.error('Error signing out:', error);
            }
        });
    }
}

// Initialize logout functionality when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeLogout);

