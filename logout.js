// logout.js

// Sign Out Functionality
document.getElementById('sign-out').addEventListener('click', function (e) {
    e.preventDefault();
    auth.signOut().then(() => {
        alert('You have successfully signed out.');
        window.location.href = 'login.html';  // Redirect to login page after sign out
    }).catch(error => {
        console.error("Error signing out:", error);
    });
});
