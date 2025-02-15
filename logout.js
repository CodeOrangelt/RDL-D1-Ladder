// logout.js

function initializeLogout() {
    const signOutLink = document.getElementById('sign-out');

    if (signOutLink) {
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
        console.error('Sign-out link not found.');
    }
}
</body>
