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
    updateDoc,
    deleteDoc,
    orderBy,
    limit,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { auth, db } from './firebase-config.js';

// Check username availability (pending + active)
async function isUsernameAvailable(username) {
    if (!username || typeof username !== 'string' || username.trim().length < 3) {
        document.getElementById('register-error').textContent = 
            'Username must be at least 3 characters long';
        return false;
    }
    const trimmedUsername = username.trim();
    try {
        const validUsernameRegex = /^[a-zA-Z0-9_-]{3,20}$/;
        if (!validUsernameRegex.test(trimmedUsername)) {
            document.getElementById('register-error').textContent = 
                'Username can only contain letters, numbers, underscores and hyphens';
            return false;
        }
        const [playersSnapshot, pendingSnapshot] = await Promise.all([
            getDocs(query(collection(db, "players"), where("username", "==", trimmedUsername))),
            getDocs(query(collection(db, "pendingRegistrations"), where("username", "==", trimmedUsername)))
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

// Handle registration submission
async function handleRegister(e) {
    e.preventDefault();
    const errorElement = document.getElementById('register-error');
    errorElement.textContent = '';

    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const username = document.getElementById('register-username').value;
    const verificationAnswer = document.getElementById('verification-answer').value.toLowerCase();

    // Get gameMode and non-participant flag
    const gameMode = document.getElementById('register-mode').value;
    const nonParticipant = document.getElementById('non-participant')?.checked || false;

    // Since the registration form now prevents both inputs,
    // also add a sanity check:
    if (nonParticipant && gameMode !== "") {
        errorElement.textContent = "Please unselect a game mode if you choose Non-Participant.";
        return;
    }
    if (!nonParticipant && gameMode === "") {
        errorElement.textContent = "Please select a game mode or check Non-Participant.";
        return;
    }

    try {
        const validAnswers = ['purple', 'magenta'];
        if (!validAnswers.includes(verificationAnswer)) {
            errorElement.textContent = 'Incorrect answer to verification question';
            return;
        }
        const isAvailable = await isUsernameAvailable(username);
        if (!isAvailable) return;

        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        await sendEmailVerification(user);

        await setDoc(doc(db, "pendingRegistrations", user.uid), {
            username: username.trim(),
            email: email,
            gameMode: gameMode,
            nonParticipant: nonParticipant,
            createdAt: new Date(),
            verified: false
        });

        errorElement.innerHTML = `
            <div class="success-message">
                Registration pending! Please check your email to verify your account.
                <br><br>
                <button onclick="resendVerificationEmail('${email}')" class="resend-button">
                    Resend Verification Email
                </button>
            </div>`;

        await signOut(auth);
    } catch (error) {
        console.error('Registration error:', error);
        errorElement.textContent = error.code === 'auth/email-already-in-use' 
            ? 'Email address is already registered'
            : 'Registration failed. Please try again later.';
    }
}

// Handle login submission
async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const errorElement = document.getElementById('login-error');

    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        const userDocRef = doc(db, "players", user.uid);
        const userDoc = await getDoc(userDocRef);

        if (!userDoc.exists()) {
            const pendingRef = doc(db, "pendingRegistrations", user.uid);
            const pendingDoc = await getDoc(pendingRef);

            if (pendingDoc.exists()) {
                const pendingData = pendingDoc.data();
                if (pendingData.nonParticipant) {
                    await setDoc(doc(db, "nonParticipants", user.uid), {
                        username: pendingData.username,
                        email: user.email,
                        createdAt: serverTimestamp(),
                        isNonParticipant: true
                    });
                    console.log(`User ${pendingData.username} added to nonParticipants collection`);
                } else if (pendingData.gameMode === "D1") {
                    const playersRef = collection(db, "players");
                    const playersQuery = query(playersRef, orderBy("position", "desc"), limit(1));
                    const playersSnapshot = await getDocs(playersQuery);
                    const nextPosition = playersSnapshot.empty ? 1 : playersSnapshot.docs[0].data().position + 1;
                    await setDoc(userDocRef, {
                        username: pendingData.username,
                        email: user.email,
                        eloRating: 1200,
                        position: nextPosition,
                        createdAt: serverTimestamp(),
                        isAdmin: false,
                        matches: 0,
                        wins: 0,
                        losses: 0
                    });
                    console.log(`New player ${pendingData.username} added to ladder at position ${nextPosition}`);
                } else {
                    console.log(`User registered with game mode "${pendingData.gameMode}" and not marked as nonParticipant, not added to ladder.`);
                }
                await deleteDoc(pendingRef);
            }
        }

        window.location.href = 'index.html';
    } catch (error) {
        console.error('Login error:', error);
        errorElement.textContent = 'Login failed: ' + error.message;
    }
}

// Resend verification email function
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
window.resendVerificationEmail = resendVerificationEmail;

// Setup event listeners when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Toggle game mode select based on Non-Participant status
    const nonParticipantCheckbox = document.getElementById('non-participant');
    const registerModeSelect = document.getElementById('register-mode');
    nonParticipantCheckbox.addEventListener('change', function() {
        if (this.checked) {
            registerModeSelect.disabled = true;
            registerModeSelect.value = "";
        } else {
            registerModeSelect.disabled = false;
        }
    });

    document.getElementById('register-form').addEventListener('submit', handleRegister);
    document.getElementById('login-form').addEventListener('submit', handleLogin);

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
