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
            currentUserSpan.style.display = 'inline'; // Show the username
            signOutLink.style.display = 'inline'; // Show the sign-out link
        } else {
            // No user is signed in.
            currentUserSpan.textContent = '';
            currentUserSpan.style.display = 'none'; // Hide the username
            signOutLink.style.display = 'none'; // Hide the sign-out link
            loginRegisterLink.style.display = 'inline-block'; // Show login/register
        }
    });
});