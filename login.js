import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword,
    sendEmailVerification,
    signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    doc, 
    setDoc,
    collection,
    getDocs,
    query,
    where,
    getDoc,
    updateDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { auth, db } from './firebase-config.js';

// Modify isUsernameAvailable to check both pending and active players
async function isUsernameAvailable(username) {
    if (!username || typeof username !== 'string' || username.trim().length < 3) {
        document.getElementById('register-error').textContent = 
            'Username must be at least 3 characters long';
        return false;
    }

    const trimmedUsername = username.trim();

    try {
        // Check format first
        const validUsernameRegex = /^[a-zA-Z0-9_-]{3,20}$/;
        if (!validUsernameRegex.test(trimmedUsername)) {
            document.getElementById('register-error').textContent = 
                'Username can only contain letters, numbers, underscores and hyphens';
            return false;
        }

        // Check existing players
        const [playersSnapshot, pendingSnapshot] = await Promise.all([
            getDocs(query(collection(db, "players"), 
                where("username", "==", trimmedUsername))),
            getDocs(query(collection(db, "pendingRegistrations"), 
                where("username", "==", trimmedUsername)))
        ]);

        if (!playersSnapshot.empty || !pendingSnapshot.empty) {
            document.getElementById('register-error').textContent = 
                'Username is already taken';
            return false;
        }

        return true;
    } catch (error) {
        console.error("Error checking username:", error);
        document.getElementById('register-error').textContent = 
            'Unable to verify username availability. Please try again later.';
        return false;
    }
}

// Modify the handleRegister function
async function handleRegister(e) {
    e.preventDefault();

    const errorElement = document.getElementById('register-error');
    errorElement.textContent = '';

    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const username = document.getElementById('register-username').value;
    const verificationAnswer = document.getElementById('verification-answer').value.toLowerCase();

    try {
        // Verify answer first
        const validAnswers = ['purple', 'magenta'];
        if (!validAnswers.includes(verificationAnswer)) {
            errorElement.textContent = 'Incorrect answer to verification question';
            return;
        }

        // Check username availability
        const isAvailable = await isUsernameAvailable(username);
        if (!isAvailable) {
            return; // Error message already set by isUsernameAvailable
        }

        // Create user account
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Send verification email
        await sendEmailVerification(user);

        // Create pending registration
        await setDoc(doc(db, "pendingRegistrations", user.uid), {
            username: username.trim(),
            email: email,
            createdAt: new Date(),
            verified: false
        });

        // Show success message
        errorElement.innerHTML = `
            <div class="success-message">
                Registration pending! Please check your email to verify your account.
                <br><br>
                <button onclick="resendVerificationEmail('${email}')" class="resend-button">
                    Resend Verification Email
                </button>
            </div>`;

        // Sign out until email is verified
        await signOut(auth);

    } catch (error) {
        console.error('Registration error:', error);
        errorElement.textContent = error.code === 'auth/email-already-in-use' 
            ? 'Email address is already registered'
            : 'Registration failed. Please try again later.';
    }
}

// Modify handleLogin function
async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        if (!user.emailVerified) {
            await signOut(auth);
            document.getElementById('login-error').innerHTML = `
                <div class="error-message">
                    Please verify your email before logging in.
                    <br><br>
                    <button onclick="resendVerificationEmail()" class="resend-button">
                        Resend Verification Email
                    </button>
                </div>`;
            return;
        }

        // Check if user is already in players collection
        const userDocRef = doc(db, "players", user.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (!userDoc.exists()) {
            // Check pending registration
            const pendingRef = doc(db, "pendingRegistrations", user.uid);
            const pendingDoc = await getDoc(pendingRef);
            
            if (pendingDoc.exists() && !pendingDoc.data().verified) {
                // Get all players to determine next position
                const playersRef = collection(db, "players");
                const playersSnapshot = await getDocs(playersRef);
                let maxPosition = 0;

                playersSnapshot.forEach((doc) => {
                    const playerData = doc.data();
                    if (playerData.position && playerData.position > maxPosition) {
                        maxPosition = playerData.position;
                    }
                });

                // Do one final username check before creating player
                const isStillAvailable = await isUsernameAvailable(pendingDoc.data().username);
                if (!isStillAvailable) {
                    await signOut(auth);
                    document.getElementById('login-error').textContent = 
                        'Username is no longer available. Please contact an administrator.';
                    return;
                }

                // Create the verified player document
                await setDoc(userDocRef, {
                    username: pendingDoc.data().username,
                    email: pendingDoc.data().email,
                    eloRating: 1200,
                    position: maxPosition + 1,
                    createdAt: new Date()
                });

                // Update pending registration
                await updateDoc(pendingRef, { verified: true });
            }
        }

        window.location.href = 'index.html';
    } catch (error) {
        document.getElementById('login-error').textContent = error.message;
    }
}

// Function to resend verification email
async function resendVerificationEmail(email) {
    try {
        const user = auth.currentUser;
        if (user) {
            await sendEmailVerification(user);
            document.getElementById('login-error').innerHTML = `
                <div class="success-message">
                    Verification email has been resent. Please check your inbox.
                </div>`;
        }
    } catch (error) {
        document.getElementById('login-error').textContent = error.message;
    }
}

// Make resendVerificationEmail available globally
window.resendVerificationEmail = resendVerificationEmail;

// Register Form Submission
document.getElementById('register-form').addEventListener('submit', handleRegister);

// Login Form Submission
document.getElementById('login-form').addEventListener('submit', handleLogin);

document.addEventListener('DOMContentLoaded', () => {
    // Add form switching handlers
    document.getElementById('show-register').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('login-container').style.display = 'none';
        document.getElementById('register-container').style.display = 'block';
    });

    document.getElementById('show-login').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('register-container').style.display = 'none';
        document.getElementById('login-container').style.display = 'block';
    });
});
