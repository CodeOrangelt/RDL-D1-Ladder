import { getAuth, signOut } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js';

export function initializeLogout() {
    const auth = getAuth();
    document.getElementById('logout-button').addEventListener('click', () => {
        signOut(auth).then(() => {
            console.log('User signed out.');
            window.location.href = 'login.html';
        }).catch((error) => {
            console.error('Error signing out:', error);
        });
    });
}