// Check if user is signed in
auth.onAuthStateChanged(function(user) {
    if (user) {
        fetchUsername(user.uid);  // Fetch the username
        document.getElementById('sign-out-container').style.display = 'block';
        document.getElementById('login-register').style.display = 'none';  // Hide Login/Register
    } else {
        document.getElementById('sign-out-container').style.display = 'none';
        document.getElementById('login-register').style.display = 'block';  // Show Login/Register
    }
});

// Fetch the username and display it
function fetchUsername(uid) {
    db.collection('players').doc(uid).get().then(doc => {
        if (doc.exists) {
            const username = doc.data().username;
            document.getElementById('current-user').textContent = `(${username})`;  // Display current user's username
        } else {
            console.error("No such document!");
        }
    }).catch(error => {
        console.error("Error getting document:", error);
    });
}