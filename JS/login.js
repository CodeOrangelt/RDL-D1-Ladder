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

// Add this function near the top of your file
function setupVerificationListener(email, password) {
    console.log("Setting up email verification listener for:", email);
    
    // Create an interval that checks verification status
    const intervalId = setInterval(async () => {
        try {
            console.log("Checking if email has been verified...");
            // Sign in to refresh user state
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;
            
            // Force token refresh to get latest emailVerified status
            await user.getIdToken(true);
            
            if (user.emailVerified) {
                console.log("Email has been verified! Redirecting to login page...");
                clearInterval(intervalId); // Stop checking
                
                // Show success message
                document.getElementById('register-error').innerHTML = `
                    <div class="success-message">
                        Email verified successfully! You can now log in.
                    </div>`;
                
                // Sign out the user
                await signOut(auth);
                
                // Switch to login form after a short delay
                setTimeout(() => {
                    document.getElementById('register-container').style.display = 'none';
                    document.getElementById('login-container').style.display = 'block';
                    document.getElementById('login-email').value = email;
                    document.getElementById('login-error').innerHTML = `
                        <div class="success-message">
                            Your account has been verified! You can now log in.
                        </div>`;
                }, 2000);
            } else {
                console.log("Email not yet verified, waiting...");
                // Sign out again to not keep user signed in
                await signOut(auth);
            }
        } catch (error) {
            console.error("Error checking verification status:", error);
            // Stop checking if there's an error
            clearInterval(intervalId);
        }
    }, 5000); // Check every 5 seconds
    
    // Store the interval ID in a global variable so we can clear it if needed
    window.verificationCheckInterval = intervalId;
    
    // Set a timeout to eventually stop checking (after 5 minutes)
    setTimeout(() => {
        if (window.verificationCheckInterval) {
            clearInterval(window.verificationCheckInterval);
            window.verificationCheckInterval = null;
            console.log("Stopped checking for email verification (timeout reached)");
        }
    }, 5 * 60 * 1000); // 5 minutes
}

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
        const [playersSnapshot, pendingSnapshot, nonParticipantsSnapshot] = await Promise.all([
            getDocs(query(collection(db, "players"), where("username", "==", trimmedUsername))),
            getDocs(query(collection(db, "pendingRegistrations"), where("username", "==", trimmedUsername))),
            getDocs(query(collection(db, "nonParticipants"), where("username", "==", trimmedUsername)))
        ]);
        if (!playersSnapshot.empty || !pendingSnapshot.empty || !nonParticipantsSnapshot.empty) {
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

    // Prevent both inputs from being provided
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

        // Start the verification listener
        setupVerificationListener(email, password);
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

    console.log("Login attempt started for:", email);
    errorElement.textContent = ''; // Clear any previous error

    try {
        console.log("Attempting Firebase signInWithEmailAndPassword...");
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        console.log("User signed in:", user.uid);

        // Check if the user exists in players or nonParticipants collection
        const userDocRef = doc(db, "players", user.uid);
        const nonParticipantDocRef = doc(db, "nonParticipants", user.uid);
        
        // Check both collections to see if user exists in either
        console.log("Checking if user exists in players or nonParticipants...");
        const [userDoc, nonParticipantDoc] = await Promise.all([
            getDoc(userDocRef),
            getDoc(nonParticipantDocRef)
        ]);
        
        // If user doesn't exist in either collection, check pending registration
        if (!userDoc.exists() && !nonParticipantDoc.exists()) {
            console.log("User not found in main collections, checking pending registration");
            const pendingRef = doc(db, "pendingRegistrations", user.uid);
            const pendingDoc = await getDoc(pendingRef);
            
            if (pendingDoc.exists()) {
                const pendingData = pendingDoc.data();
                console.log("Found pending registration:", pendingData);
                
                // Process the registration if the email is verified
                if (user.emailVerified) {
                    console.log("Email is verified, processing registration");
                    
                    // Show success message
                    errorElement.innerHTML = `
                        <div class="success-message">
                            Setting up your account...
                        </div>`;
                    
                    // Handle non-participant users
                    if (pendingData.nonParticipant) {
                        console.log("Processing non-participant registration");
                        await setDoc(doc(db, "nonParticipants", user.uid), {
                            username: pendingData.username,
                            email: user.email,
                            createdAt: serverTimestamp(),
                            isNonParticipant: true
                        });
                        console.log(`User ${pendingData.username} added to nonParticipants collection`);
                    } 
                    // Only D1 players are added to the main ladder
                    else if (pendingData.gameMode === "D1") {
                        console.log("Processing D1 player registration");
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
                    } 
                    else {
                        console.log(`User registered with game mode "${pendingData.gameMode}" not added to main ladder`);
                    }
                    
                    // Clean up pending registration
                    await deleteDoc(pendingRef);
                    
                    // Short delay to show success message before redirecting
                    setTimeout(() => {
                        window.location.href = '../HTML/index.html';
                    }, 2000);
                    return;
                } 
                else {
                    // Email not verified, show warning but still let them proceed to verify
                    errorElement.innerHTML = `
                        <div class="warning-message">
                            Please verify your email to complete your registration.
                            <br><br>
                            <button type="button" id="resend-button" class="resend-button">
                                Resend Verification Email
                            </button>
                        </div>`;
                    
                    // Add event listener for the resend button
                    document.getElementById('resend-button').addEventListener('click', () => {
                        resendVerificationEmail(email);
                    });
                    
                    // Sign out until email is verified
                    await signOut(auth);
                }
            }
        } else {
            // Existing user, redirect to index.html
            window.location.href = '../HTML/index.html';
        }
    } catch (error) {
        console.error('Login error:', error);
        errorElement.textContent = 'Login failed: ' + error.message;
    }
}

// Resend verification email function
async function resendVerificationEmail(email) {
    console.log("Attempting to resend verification email to:", email);
    try {
        // Need to sign in again to get the user object
        const password = document.getElementById('login-password')?.value;
        if (!password) {
            console.error("Password not available for resending verification");
            document.getElementById('login-error').textContent = 
                'Please enter your password to resend verification email';
            return;
        }
        
        // Sign in to get user object
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        console.log("User signed in for verification email:", user.uid);
        
        await sendEmailVerification(user);
        console.log("Verification email sent");
        
        document.getElementById('login-error').innerHTML = `
            <div class="success-message">
                Verification email has been resent to ${email}. Please check your inbox.
            </div>`;
        
        // Sign out again
        await signOut(auth);
    } catch (error) {
        console.error("Error resending verification email:", error);
        document.getElementById('login-error').textContent = 
            'Error sending verification email: ' + error.message;
    }
}

// Keep exposing the function, but with a proper function implementation
window.resendVerificationEmail = function(email) {
    console.log("Window.resendVerificationEmail called with:", email);
    resendVerificationEmail(email);
};

// Setup event listeners when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Toggle game mode select based on Non-Participant status
    const nonParticipantCheckbox = document.getElementById('non-participant');
    const registerModeSelect = document.getElementById('register-mode');
    
    if (nonParticipantCheckbox && registerModeSelect) {
        nonParticipantCheckbox.addEventListener('change', function() {
            if (this.checked) {
                registerModeSelect.value = "";
                registerModeSelect.disabled = true;
            } else {
                registerModeSelect.disabled = false;
            }
        });
    }

    const registerForm = document.getElementById('register-form');
    const loginForm = document.getElementById('login-form');
    
    if (registerForm) {
        registerForm.addEventListener('submit', handleRegister);
    }
    
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }

    const showRegister = document.getElementById('show-register');
    const showLogin = document.getElementById('show-login');
    
    if (showRegister) {
        showRegister.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('login-container').style.display = 'none';
            document.getElementById('register-container').style.display = 'block';
        });
    }
    
    if (showLogin) {
        showLogin.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('register-container').style.display = 'none';
            document.getElementById('login-container').style.display = 'block';
        });
    }
});
