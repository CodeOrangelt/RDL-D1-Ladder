import { updateEloRatings, approveReport } from './ladderalgorithm.js';
import { 
    collection,
    getDocs,
    query,
    where,
    orderBy,
    serverTimestamp,
    doc,
    setDoc 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth, db } from './firebase-config.js';

document.addEventListener('DOMContentLoaded', () => {
    let confirmationNotification;
    let outstandingReportData = null;
    let currentUserEmail;

    onAuthStateChanged(auth, async (user) => {
        console.log("Authentication state changed:", user);
        if (user) {
            console.log('User signed in:', user.email || user.displayName);
            const authWarning = document.getElementById('auth-warning');
            if (authWarning) {
                authWarning.style.display = 'none';
            }

            currentUserEmail = user.email;

            // Fetch the username from the players collection
            try {
                const playersRef = collection(db, 'players');
                const q = query(playersRef, where('email', '==', user.email));
                const querySnapshot = await getDocs(q);

                if (!querySnapshot.empty) {
                    const playerDoc = querySnapshot.docs[0];
                    const username = playerDoc.data().username;

                    const loserUsername = document.getElementById('loser-username');
                    if (loserUsername) {
                        loserUsername.textContent = username;
                    }
                } else {
                    console.error('No player found with email:', user.email);
                }
            } catch (error) {
                console.error('Error fetching player:', error);
            }

            const reportForm = document.getElementById('report-form');
            if (reportForm) {
                reportForm.style.display = 'block';
            }
            await populateWinnerDropdown();
            checkForOutstandingReports(user.email);
        } else {
            console.log('No user signed in');
            const authWarning = document.getElementById('auth-warning');
            if (authWarning) {
                authWarning.style.display = 'block'; // Show the warning
            }
            const reportForm = document.getElementById('report-form');
            if (reportForm) {
                reportForm.style.display = 'none';
            }
        }
    });

    const reportForm = document.getElementById('report-form');
    const winnerUsername = document.getElementById('winner-username');
    const loserScore = document.getElementById('loser-score');
    const suicides = document.getElementById('suicides');
    const mapPlayed = document.getElementById('map-played');
    const loserComment = document.getElementById('loser-comment');

    if (reportForm) {
        reportForm.addEventListener('submit', async (event) => {
            event.preventDefault();

            const pendingMatchesRef = collection(db, 'pendingMatches');
            const newMatchRef = doc(pendingMatchesRef);

            try {
                const playersRef = collection(db, 'players');
                const q = query(playersRef, where('email', '==', winnerUsername.value));
                const querySnapshot = await getDocs(q);

                if (!querySnapshot.empty) {
                    const winnerDoc = querySnapshot.docs[0];
                    const winnerUsernameValue = winnerDoc.data().username;

                    const reportData = {
                        matchId: newMatchRef.id,
                        loserUsername: document.getElementById('loser-username').textContent,
                        winnerUsername: winnerUsernameValue,
                        winnerEmail: winnerUsername.value,
                        loserScore: loserScore.value,
                        suicides: suicides.value,
                        mapPlayed: mapPlayed.value,
                        loserComment: loserComment.value,
                        approved: false,
                        createdAt: serverTimestamp()
                    };

                    await setDoc(newMatchRef, reportData);
                    console.log('Report successfully added to pendingMatches.');
                    reportForm.reset();
                    alert('Game reported successfully.');
                    checkForOutstandingReports(document.getElementById('loser-username').textContent);
                }
            } catch (error) {
                console.error('Error adding report:', error);
                document.getElementById('report-error').textContent = 'Error reporting game. Please try again.';
            }
        });
    }

    async function populateWinnerDropdown() {
        try {
            const playersRef = collection(db, 'players');
            const querySnapshot = await getDocs(playersRef);

            if (winnerUsername) {
                winnerUsername.innerHTML = '<option value="">Select Winner</option>';

                if (querySnapshot.empty) {
                    winnerUsername.innerHTML = '<option value="">No players found</option>';
                } else {
                    querySnapshot.forEach(doc => {
                        const player = doc.data();
                        if (player.email !== currentUserEmail) {
                            const option = document.createElement('option');
                            option.value = player.email;
                            option.textContent = player.username;
                            winnerUsername.appendChild(option);
                        }
                    });
                }
            }
        } catch (error) {
            console.error('Error fetching players:', error);
        }
    }

    function checkForOutstandingReports(username) {
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
});