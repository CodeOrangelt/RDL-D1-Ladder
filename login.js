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
    if (!username || typeof username !== 'string') {
        return false;
    }

    try {
        // Check active players
        const playersRef = collection(db, "players");
        const playersQuery = query(playersRef, where("username", "==", username.trim()));
        const playersSnapshot = await getDocs(playersQuery);
        
        if (!playersSnapshot.empty) {
            return false;
        }

        // Check pending registrations
        const pendingRef = collection(db, "pendingRegistrations");
        const pendingQuery = query(pendingRef, where("username", "==", username.trim()));
        const pendingSnapshot = await getDocs(pendingQuery);
        
        return pendingSnapshot.empty;
    } catch (error) {
        console.error("Error checking username:", error);
        // Return false on error to prevent registration with potentially duplicate username
        return false;
    }
}

// Modify the handleRegister function
async function handleRegister(e) {
    e.preventDefault();
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const username = document.getElementById('register-username').value;
    const verificationAnswer = document.getElementById('verification-answer').value.toLowerCase();

    // Check the verification answer
    const validAnswers = ['purple', 'magenta'];
    if (!validAnswers.includes(verificationAnswer)) {
        document.getElementById('register-error').textContent = 'Incorrect answer to verification question';
        return;
    }

    try {
        // Check if username is available
        const usernameAvailable = await isUsernameAvailable(username);
        if (!usernameAvailable) {
            document.getElementById('register-error').textContent = 'Username is already taken. Please choose another.';
            return;
        }

        // Create user
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Send verification email
        await sendEmailVerification(user);

        // Store pending registration in a separate collection
        const pendingDocRef = doc(db, "pendingRegistrations", user.uid);
        await setDoc(pendingDocRef, {
            username: username,
            email: email,
            createdAt: new Date(),
            verified: false
        });

        // Show success message
        document.getElementById('register-error').innerHTML = `
            <div class="success-message">
                Registration pending! Please check your email to verify your account.
                Your account will be activated after verification.
                <br><br>
                <button onclick="resendVerificationEmail('${email}')" class="resend-button">
                    Resend Verification Email
                </button>
            </div>`;

        // Sign out the user until they verify their email
        await signOut(auth);

    } catch (error) {
        document.getElementById('register-error').textContent = error.message;
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
