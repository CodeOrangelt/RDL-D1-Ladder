import { 
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth, db } from './firebase-config.js';

// Register Form Submission
document.getElementById('register-form').addEventListener('submit', function (e) {
    e.preventDefault();

    const username = document.getElementById('register-username').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const registerErrorDiv = document.getElementById('register-error');

    console.log("Register form submitted");
    console.log("Username:", username);
    console.log("Email:", email);
    console.log("Password:", password);

    // Check if the username is already taken
    db.collection('players')
        .where('username', '==', username)
        .get()
        .then(querySnapshot => {
            console.log("Query snapshot:", querySnapshot);
            if (!querySnapshot.empty) {
                // Username is already taken
                registerErrorDiv.textContent = 'This username is already taken. Please choose a different one.';
            } else {
                // Username is available, proceed with registration
                auth.createUserWithEmailAndPassword(email, password)
                    .then(userCredential => {
                        const user = userCredential.user;
                        console.log("User registered:", user);
                        // Add user data to the 'players' collection in Firestore
                        return db.collection('players').doc(user.uid).set({
                            username: username,
                            email: email,
                            points: 0,
                            eloRating: 1200, // Default ELO rating
                            position: 0 // Default position
                        });
                    })
                    .then(() => {
                        console.log("User data saved to Firestore");
                        alert('Registration successful! You can now log in.');
                        document.getElementById('register-form').reset();
                    })
                    .catch(error => {
                        console.error("Error registering user:", error);
                        registerErrorDiv.textContent = error.message; // Use textContent to prevent XSS
                    });
            }
        })
        .catch(error => {
            console.error("Error checking username:", error);
            registerErrorDiv.textContent = 'Error checking username. Please try again.';
        });
});

// Login Form Submission
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    try {
        await signInWithEmailAndPassword(auth, email, password);
        window.location.href = 'index.html'; // Redirect after successful login
    } catch (error) {
        document.getElementById('login-error').textContent = error.message;
    }
});
