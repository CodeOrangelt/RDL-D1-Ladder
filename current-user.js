import { 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    collection,
    doc,
    getDoc 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { auth, db } from './firebase-config.js';

document.addEventListener('DOMContentLoaded', () => {
    onAuthStateChanged(auth, async (user) => {
        const currentUserSpan = document.getElementById('current-user');
        const signOutLink = document.getElementById('sign-out');
        const loginRegisterLink = document.getElementById('login-register');

        if (user) {
            try {
                const userDoc = doc(db, 'players', user.uid);
                const docSnap = await getDoc(userDoc);
                
                if (docSnap.exists()) {
                    const username = docSnap.data().username;
                    currentUserSpan.textContent = username;
                } else {
                    console.log("No such document!");
                    currentUserSpan.textContent = "User"; // Default username
                }
            } catch (error) {
                console.error("Error fetching user data:", error);
                currentUserSpan.textContent = "User"; // Default username
            }

            if (currentUserSpan) {
                currentUserSpan.style.display = 'inline'; // Show the username
            }
            if (signOutLink) {
                signOutLink.style.display = 'inline'; // Show the sign-out link
            }
            if (loginRegisterLink) {
                loginRegisterLink.style.display = 'none'; // Hide login/register
            }
        } else {
            if (currentUserSpan) {
                currentUserSpan.textContent = '';
                currentUserSpan.style.display = 'none'; // Hide the username
            }
            if (signOutLink) {
                signOutLink.style.display = 'none'; // Hide the sign-out link
            }
            if (loginRegisterLink) {
                loginRegisterLink.style.display = 'inline-block'; // Show login/register
            }
        }
    });
});