// login.js

// Register Form Submission
document.getElementById('register-form').addEventListener('submit', function (e) {
    e.preventDefault();

    const username = document.getElementById('register-username').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const registerErrorDiv = document.getElementById('register-error');

    auth.createUserWithEmailAndPassword(email, password)
        .then(userCredential => {
            const user = userCredential.user;
            console.log("User registered:", user);
            return db.collection('players').doc(user.uid).set({
                username: username,
                email: email,
                points: 0
            });
        })
        .then(() => {
            console.log("User data saved to Firestore");
            alert('Registration successful! You can now log in.');
            document.getElementById('register-form').reset();
        })
        .catch(error => {
            console.error("Error registering user:", error);
            registerErrorDiv.innerHTML = error.message;
        });
});

// login.js

// Login Form Submission
document.getElementById('login-form').addEventListener('submit', function (e) {
    e.preventDefault();

    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const loginErrorDiv = document.getElementById('login-error');

    console.log("Attempting login with email:", email);  // Debugging log

    auth.signInWithEmailAndPassword(email, password)
        .then(() => {
            console.log("Login successful for email:", email);  // Debugging log
            alert('Login successful!');
            window.location.href = 'index.html';
        })
        .catch(error => {
            console.error("Error logging in user:", error);
            loginErrorDiv.innerHTML = error.message;
        });
});

