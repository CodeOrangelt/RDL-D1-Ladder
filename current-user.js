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
            signOutLink.style.display = 'inline'; // Make sure sign-out link is visible
            loginRegisterLink.style.display = 'none'; // Hide login/register

            // Add event listener to sign out
            signOutLink.addEventListener('click', function(e) {
                e.preventDefault();
                firebase.auth().signOut().then(function() {
                    // Sign-out successful.
                    console.log('User signed out.');
                    window.location.href = 'index.html'; // Redirect to home page
                }).catch(function(error) {
                    // An error happened.
                    console.error('Sign-out error:', error);
                });
            });
        } else {
            // No user is signed in.
            currentUserSpan.textContent = ''; // Clear the username
            currentUserSpan.style.display = 'none'; // Hide the username
            signOutLink.style.display = 'none'; // Hide the sign-out link
            loginRegisterLink.style.display = 'inline'; // Show login/register
        }
    });
});