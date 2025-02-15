document.addEventListener('DOMContentLoaded', () => {
    let confirmationNotification; // Declare it here
    let outstandingReportData = null; // Store outstanding report data
    let currentUserEmail; // Store the current user's email

    firebase.auth().onAuthStateChanged(function(user) {
        console.log("Authentication state changed:", user); // Add this line
        if (user) {
            console.log('User signed in:', user.email || user.displayName);
            const authWarning = document.getElementById('auth-warning');
            if (authWarning) {
                authWarning.style.display = 'none'; // Hide the warning
            }

            currentUserEmail = user.email; // Store the current user's email

            // Fetch the username from the players collection
            db.collection('players')
                .where('email', '==', user.email)
                .get()
                .then(querySnapshot => {
                    if (!querySnapshot.empty) {
                        // Get the username from the document
                        const playerDoc = querySnapshot.docs[0];
                        const username = playerDoc.data().username;

                        // Display the username in the loser-username span
                        const loserUsername = document.getElementById('loser-username');
                        loserUsername.textContent = username;
                    } else {
                        console.error('No player found with email:', user.email);
                        const loserUsername = document.getElementById('loser-username');
                        loserUsername.textContent = "Unknown User";
                    }
                })
                .catch(error => {
                    console.error('Error fetching player:', error);
                    const loserUsername = document.getElementById('loser-username');
                    loserUsername.textContent = "Error Fetching Username";
                });

            document.getElementById('report-form').style.display = 'block';
            populateWinnerDropdown(); // Move this line up
            checkForOutstandingReports(user.email || user.displayName);
        } else {
            console.log('No user signed in');
            const authWarning = document.getElementById('auth-warning');
            if (authWarning) {
                authWarning.style.display = 'block'; // Show the warning
            }
            document.getElementById('report-form').style.display = 'none';
        }
    });

    const reportForm = document.getElementById('report-form');
    const winnerUsername = document.getElementById('winner-username');
    const loserScore = document.getElementById('loser-score');
    const suicides = document.getElementById('suicides');
    const mapPlayed = document.getElementById('map-played');
    const loserComment = document.getElementById('loser-comment');

    reportForm.addEventListener('submit', function(event) {
        event.preventDefault();

        const matchId = db.collection('pendingMatches').doc().id;

        console.log("Winner Username Value:", winnerUsername.value); // ADD THIS LINE

        // Fetch the winner's username based on the email
        db.collection('players')
            .where('email', '==', winnerUsername.value)
            .get()
            .then(querySnapshot => {
                if (!querySnapshot.empty) {
                    const winnerDoc = querySnapshot.docs[0];
                    const winnerUsernameValue = winnerDoc.data().username;

                    const reportData = {
                        matchId: matchId,
                        loserUsername: document.getElementById('loser-username').textContent,
                        winnerUsername: winnerUsernameValue, // Store the winner's username
                        winnerEmail: winnerUsername.value, // Store the winner's email
                        loserScore: loserScore.value,
                        suicides: suicides.value,
                        mapPlayed: mapPlayed.value,
                        loserComment: loserComment.value,
                        approved: false,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    };

                    console.log("Report data being written:", reportData); // ADD THIS LINE

                    db.collection('pendingMatches').doc(matchId).set(reportData)
                        .then(() => {
                            console.log('Report successfully added to pendingMatches.');
                            console.log("Report data after write:", reportData); // ADD THIS LINE
                            reportForm.reset();
                            alert('Game reported successfully.');

                            // Check for outstanding reports for the LOSER (logged-in user)
                            checkForOutstandingReports(document.getElementById('loser-username').textContent);
                        })
                        .catch((error) => {
                            console.error('Error adding report to Firestore:', error);
                            document.getElementById('report-error').textContent = 'Error reporting game. Please try again.';
                        });
                } else {
                    console.error('No player found with email:', winnerUsername.value);
                    alert('Error: No player found with that email.');
                }
            })
            .catch(error => {
                console.error('Error fetching winner:', error);
                alert('Error fetching winner. Please try again.');
            });
    });

    function populateWinnerDropdown() {
        db.collection('players').get().then(querySnapshot => {
            // Clear existing options
            winnerUsername.innerHTML = '<option value="">Select Winner</option>';

            if (querySnapshot.empty) {
                // Display a message if no players are found
                winnerUsername.innerHTML = '<option value="">No players found</option>';
            } else {
                querySnapshot.forEach(doc => {
                    const player = doc.data();
                    // Exclude the current user from the dropdown
                    if (player.email !== currentUserEmail) {
                        const option = document.createElement('option');
                        option.value = player.email; // Store the email address as the value
                        option.textContent = player.username; // Display the username
                        winnerUsername.appendChild(option);
                    }
                });
            }
        }).catch(error => {
            console.error('Error fetching players:', error);
        });
    }

    function checkForOutstandingReports(username) {
        console.log("Checking for outstanding reports for username:", username);
    
        if (!confirmationNotification) {
            confirmationNotification = document.createElement('div');
            confirmationNotification.id = 'confirmation-notification';
            confirmationNotification.classList.add('notification-banner');
            confirmationNotification.style.display = 'none';
            confirmationNotification.style.marginTop = '10px';
            document.querySelector('.container').prepend(confirmationNotification);
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

    function approveReport(reportId, winnerScore, winnerSuicides, winnerComment) {
        db.collection('pendingMatches').doc(reportId).update({
            approved: true,
            winnerScore: winnerScore,
            winnerSuicides: winnerSuicides,
            winnerComment: winnerComment
        })
            .then(() => {
                console.log('Report approved successfully.');
                alert('Report approved!');
                // Clean up the form
                reportForm.reset();
                winnerUsername.disabled = false;
                loserScore.disabled = false;

                const approveReportElement = document.getElementById('approve-report');
                if (approveReportElement) {
                    approveReportElement.remove();
                }

                confirmationNotification.style.display = 'none';
                outstandingReportData = null;

                // Delay the page refresh by 500 milliseconds
                setTimeout(() => {
                    window.location.href = window.location.href; // Refresh the page
                }, 500);

                // Apply the ELO rating algorithm
                db.collection('pendingMatches').doc(reportId).get().then(doc => {
                    if (doc.exists) {
                        const reportData = doc.data();
                        const winnerEmail = reportData.winnerEmail;
                        const loserUsername = reportData.loserUsername;

                        // Fetch the winner and loser IDs
                        Promise.all([
                            db.collection('players').where('email', '==', winnerEmail).get(),
                            db.collection('players').where('username', '==', loserUsername).get()
                        ]).then(([winnerSnapshot, loserSnapshot]) => {
                            if (!winnerSnapshot.empty && !loserSnapshot.empty) {
                                const winnerId = winnerSnapshot.docs[0].id;
                                const loserId = loserSnapshot.docs[0].id;

                                // Update ELO ratings
                                updateEloRatings(winnerId, loserId);
                            } else {
                                console.error('Winner or loser not found in the database.');
                            }
                        }).catch(error => {
                            console.error('Error fetching winner or loser:', error);
                        });
                    } else {
                        console.error('Report not found.');
                    }
                }).catch(error => {
                    console.error('Error fetching report:', error);
                });
            })
            .catch(error => {
                console.error('Error approving report:', error);
                alert('Error approving report. Please try again.');
            });
    }
});