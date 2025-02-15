// current-user.js
document.addEventListener('DOMContentLoaded', () => {
    // Check if user is signed in
    firebase.auth().onAuthStateChanged(function(user) {
        const currentUserSpan = document.getElementById('current-user');
        const signOutLink = document.getElementById('sign-out');
        const loginRegisterLink = document.getElementById('login-register');

        if (user) {
            // User is signed in.
            db.collection('players').doc(user.uid).get()
                .then(doc => {
                    if (doc.exists) {
                        const username = doc.data().username;
                        currentUserSpan.textContent = username; // Display the username
                    } else {
                        currentUserSpan.textContent = user.displayName || user.email; // Fallback to display name or email
                        console.log("No such document!");
                    }
                }).catch(error => {
                    console.log("Error getting document:", error);
                    currentUserSpan.textContent = user.displayName || user.email; // Fallback to display name or email
                });
            currentUserSpan.style.display = 'inline'; // Show the username
            signOutLink.style.display = 'inline'; // Show the sign-out link
            loginRegisterLink.style.display = 'none'; // Hide login/register
        } else {
            // No user is signed in.
            currentUserSpan.textContent = '';
            currentUserSpan.style.display = 'none'; // Hide the username
            signOutLink.style.display = 'none'; // Hide the sign-out link
            loginRegisterLink.style.display = 'inline-block'; // Show login/register
        }
    });
});