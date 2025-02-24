// logout.js
import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

function initializeLogout() {
    // Use event delegation since the sign-out link is dynamically added
    document.addEventListener('click', async (e) => {
        if (e.target && e.target.id === 'sign-out-link') {
            e.preventDefault();
            try {
                const auth = getAuth();
                await signOut(auth);
                console.log('User signed out successfully');
                window.location.href = '../index.html';
            } catch (error) {
                console.error('Error signing out:', error);
            }
        }
    });
}

// Initialize logout functionality when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeLogout);

export { initializeLogout };

