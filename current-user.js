// current-user.js
document.addEventListener('DOMContentLoaded', () => {
    // Check if user is signed in
    firebase.auth().onAuthStateChanged(function(user) {
        const currentUserSpan = document.getElementById('current-user');
        const signOutLink = document.getElementById('sign-out');
        const loginRegisterLink = document.getElementById('login-register');

        if (user) {
            // User is signed in.
            currentUserSpan.textContent = user.displayName || user.email;
            currentUserSpan.classList.remove('hidden');
            signOutLink.classList.remove('hidden');
            loginRegisterLink.classList.add('hidden');
        } else {
            // No user is signed in.
            currentUserSpan.textContent = '';
            currentUserSpan.classList.add('hidden');
            signOutLink.classList.add('hidden');
            loginRegisterLink.classList.remove('hidden');
        }
    });
});