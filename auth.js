// auth.js
document.getElementById('register').addEventListener('submit', function (e) {
    e.preventDefault();

    const username = document.getElementById('username').value;
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const errorDiv = document.getElementById('register-error');

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
            window.location.reload();
        })
        .catch(error => {
            console.error("Error registering user:", error);
            errorDiv.innerHTML = error.message;
        });
});
