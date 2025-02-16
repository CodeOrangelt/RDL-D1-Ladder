import { approveReport } from './ladderalgorithm.js';
import { 
    collection, getDocs, query, where, 
    orderBy, serverTimestamp, doc, setDoc 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth, db } from './firebase-config.js';

// Move currentUserEmail to module scope
let currentUserEmail = null;
let confirmationNotification = null; // Also adding this to fix potential undefined error
let outstandingReportData = null; // And this one

document.addEventListener('DOMContentLoaded', async () => {
    const elements = {
        authWarning: document.getElementById('auth-warning'),
        reportForm: document.getElementById('report-form'),
        winnerUsername: document.getElementById('winner-username'),
        loserUsername: document.getElementById('loser-username'),
        loserScore: document.getElementById('loser-score'),
        suicides: document.getElementById('suicides'),
        mapPlayed: document.getElementById('map-played'),
        loserComment: document.getElementById('loser-comment'),
        reportError: document.getElementById('report-error'),
        reportLightbox: document.getElementById('report-lightbox')
    };

    setupAuthStateListener(elements);
    setupReportForm(elements);
});

function setupAuthStateListener(elements) {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            handleUserSignedIn(user, elements);
        } else {
            handleUserSignedOut(elements);
        }
    });
}

async function handleUserSignedIn(user, elements) {
    elements.authWarning.style.display = 'none';
    elements.reportForm.style.display = 'block';
    
    // Set email first before any other operations
    currentUserEmail = user.email || null;

    try {
        await updateUserDisplay(user.email, elements);
        await populateWinnerDropdown(elements.winnerUsername);
        checkForOutstandingReports(user.email, elements);
    } catch (error) {
        console.error('Error during sign-in handling:', error);
    }
}

function handleUserSignedOut(elements) {
    elements.authWarning.style.display = 'block';
    elements.reportForm.style.display = 'none';
    currentUserEmail = null; // Clear the email when user signs out
}

async function updateUserDisplay(userEmail, elements) {
    const playersRef = collection(db, 'players');
    const q = query(playersRef, where('email', '==', userEmail));
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
        const username = querySnapshot.docs[0].data().username;
        elements.loserUsername.textContent = username;
    }
}

async function populateWinnerDropdown(winnerSelect) {
    try {
        const playersRef = collection(db, 'players');
        const querySnapshot = await getDocs(playersRef);
        
        // Clear existing options
        winnerSelect.innerHTML = '<option value="">Select Winner</option>';
        
        if (!querySnapshot.empty) {
            querySnapshot.forEach(doc => {
                const player = doc.data();
                // Only add other players (not the current user)
                if (player.email !== currentUserEmail) {
                    const option = document.createElement('option');
                    option.value = player.email;
                    option.textContent = player.username;
                    winnerSelect.appendChild(option);
                }
            });
        }
    } catch (error) {
        console.error('Error populating winner dropdown:', error);
        throw error;
    }
}

function setupReportForm(elements) {
    if (!elements.reportForm) return;

    elements.reportForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
            await submitReport(elements);
            elements.reportForm.reset();
            alert('Game reported successfully.');
        } catch (error) {
            console.error('Error submitting report:', error);
            elements.reportError.textContent = 'Error reporting game. Please try again.';
        }
    });
}

async function submitReport(elements) {
    const pendingMatchesRef = collection(db, 'pendingMatches');
    const newMatchRef = doc(pendingMatchesRef);
    
    const winnerQuery = query(
        collection(db, 'players'), 
        where('email', '==', elements.winnerUsername.value)
    );
    const winnerSnapshot = await getDocs(winnerQuery);
    
    if (!winnerSnapshot.empty) {
        const winnerData = winnerSnapshot.docs[0].data();
        const reportData = {
            matchId: newMatchRef.id,
            loserUsername: elements.loserUsername.textContent,
            winnerUsername: winnerData.username,
            winnerEmail: elements.winnerUsername.value,
            loserScore: elements.loserScore.value,
            suicides: elements.suicides.value,
            mapPlayed: elements.mapPlayed.value,
            loserComment: elements.loserComment.value,
            approved: false,
            createdAt: serverTimestamp()
        };
        
        await setDoc(newMatchRef, reportData);
    }
}

function checkForOutstandingReports(username, elements) {
    console.log("Checking for outstanding reports for username:", username);

    if (!confirmationNotification) {
        confirmationNotification = document.createElement('div');
        confirmationNotification.id = 'confirmation-notification';
        confirmationNotification.classList.add('notification-banner');
        confirmationNotification.style.display = 'none';
        confirmationNotification.style.marginTop = '10px';
        const container = document.querySelector('.container');
        if (container) {
            container.prepend(confirmationNotification);
        } else {
            console.error('Container element not found.');
            return;
        }
    }

    db.collection('pendingMatches')
        .where('winnerEmail', '==', currentUserEmail) // Use winnerEmail instead of winnerUsername
        .where('approved', '==', false)
        .limit(1)
        .get()
        .then(snapshot => {
            if (!snapshot.empty) {
                snapshot.forEach(doc => {
                    outstandingReportData = doc.data();
                    outstandingReportData.id = doc.id;
                    console.log("Outstanding report data:", outstandingReportData);

                    // The loserUsername is already the username, so no need to fetch it
                    const loserUsername = outstandingReportData.loserUsername;

                    confirmationNotification.innerHTML = `
                        <div>
                            You have an outstanding report to confirm. <a href="#" id="auto-fill-report">Click here to review and approve</a>
                        </div>
                    `;
                    confirmationNotification.style.display = 'block';
                    console.log('Outstanding reports found');

                    const autoFillReportLink = document.getElementById('auto-fill-report');
                    if (autoFillReportLink) {
                        autoFillReportLink.addEventListener('click', function(e) {
                            e.preventDefault();
                            autoFillReportForm(outstandingReportData);
                        });
                    } else {
                        console.error("auto-fill-report link not found");
                    }
                });
            } else {
                confirmationNotification.style.display = 'none';
                console.log('No outstanding reports found');
                outstandingReportData = null;
            }
        })
        .catch(error => {
            console.error('Error checking for outstanding reports:', error);
        });
}

function autoFillReportForm(reportData) {
    console.log("Report Data in autoFillReportForm:", reportData); // ADD THIS LINE
    if (reportData) {
        // Fetch the winner's username
        db.collection('players')
            .where('email', '==', reportData.winnerEmail)
            .get()
            .then(winnerQuerySnapshot => {
                if (!winnerQuerySnapshot.empty) {
                    const winnerDoc = winnerQuerySnapshot.docs[0];
                    const winnerUsername = winnerDoc.data().username;

                    // Fetch the loser's username
                    db.collection('players')
                        .where('username', '==', reportData.loserUsername)
                        .get()
                        .then(loserQuerySnapshot => {
                            if (!loserQuerySnapshot.empty) {
                                const loserDoc = loserQuerySnapshot.docs[0];
                                const loserUsername = loserDoc.data().username;

                                // Populate the lightbox
                                document.getElementById('lightbox-winner').textContent = winnerUsername;
                                document.getElementById('lightbox-loser').textContent = loserUsername;
                                document.getElementById('lightbox-loser-score').textContent = reportData.loserScore;
                                document.getElementById('lightbox-suicides').textContent = reportData.suicides;
                                document.getElementById('lightbox-map').textContent = reportData.mapPlayed;
                                document.getElementById('lightbox-comment').textContent = reportData.loserComment;

                                // Show the lightbox
                                document.getElementById('report-lightbox').style.display = 'block';

                                // Add event listener to the Approve button
                                const approveButton = document.getElementById('approve-button'); // Get the button element
                                const approveReportHandler = function() { // Store the function in a variable
                                    // Get the winner's input values
                                    const winnerScore = document.getElementById('winner-score').value;
                                    const winnerSuicides = document.getElementById('winner-suicides').value;
                                    const winnerComment = document.getElementById('winner-comment').value;

                                    approveReport(reportData.id, winnerScore, winnerSuicides, winnerComment);
                                    document.getElementById('report-lightbox').style.display = 'none'; // Hide lightbox after approval
                                    approveButton.removeEventListener('click', approveReportHandler); // Remove the event listener
                                };
                                approveButton.addEventListener('click', approveReportHandler); // Add the event listener

                                // Add event listener to the Cancel button
                                document.getElementById('cancel-button').addEventListener('click', function() {
                                    document.getElementById('report-lightbox').style.display = 'none'; // Hide lightbox
                                });
                            } else {
                                console.error('No loser found with username:', reportData.loserUsername);
                                alert('Error: No loser found with that username.');
                            }
                        })
                        .catch(error => {
                            console.error('Error fetching loser:', error);
                            alert('Error fetching loser. Please try again.');
                        });
                } else {
                    console.error('No winner found with email:', reportData.winnerEmail);
                    alert('Error: No winner found with that email.');
                }
            })
            .catch(error => {
                console.error('Error fetching winner:', error);
                alert('Error fetching winner. Please try again.');
            });
    }
}