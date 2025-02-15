// current-user.js
document.addEventListener('DOMContentLoaded', () => {
    // Check if user is signed in
    auth.onAuthStateChanged(function(user) {
        const signOutContainer = document.getElementById('sign-out-container');
        const loginRegister = document.getElementById('login-register');

        // Check if the elements exist before running any code
        if (signOutContainer || loginRegister) {
            if (user) {
                fetchUsername(user.uid);  // Fetch the username
                if (signOutContainer) {
                    signOutContainer.style.display = 'block';
                } else {
                    console.error('Element with ID "sign-out-container" not found.');
                }

                if (loginRegister) {
                    loginRegister.style.display = 'none';  // Hide Login/Register
                } else {
                    console.error('Element with ID "login-register" not found.');
                }
            } else {
                if (signOutContainer) {
                    signOutContainer.style.display = 'none';
                } else {
                    console.error('Element with ID "sign-out-container" not found.');
                }

                if (loginRegister) {
                    loginRegister.style.display = 'block';  // Show Login/Register
                } else {
                    console.error('Element with ID "login-register" not found.');
                }
            }
        } else {
            console.warn('Elements with IDs "sign-out-container" and "login-register" not found on this page.');
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
});