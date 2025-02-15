document.addEventListener('DOMContentLoaded', () => {
    let confirmationNotification; // Declare it here
    let outstandingReportData = null; // Store outstanding report data

    firebase.auth().onAuthStateChanged(user => {
        if (user) {
            console.log('User signed in:', user.email || user.displayName);

            const loserUsername = document.getElementById('loser-username');
            loserUsername.textContent = user.displayName || user.email;

            document.getElementById('report-form').style.display = 'block';
            populateWinnerDropdown();

            // Add a delay before calling checkForOutstandingReports
            setTimeout(() => {
                checkForOutstandingReports(user.email || user.displayName);
            }, 2000); // 2 seconds
        } else {
            console.log('No user signed in');
            document.getElementById('auth-warning').style.display = 'block';
        }
    });

    const reportForm = document.getElementById('report-form');
    const winnerUsername = document.getElementById('winner-username');
    const finalScore = document.getElementById('final-score');
    const suicides = document.getElementById('suicides');
    const mapPlayed = document.getElementById('map-played');
    const loserComment = document.getElementById('loser-comment');

    reportForm.addEventListener('submit', function(event) {
        event.preventDefault();

        const matchId = db.collection('pendingMatches').doc().id;

        console.log("Winner Username Value:", winnerUsername.value); // ADD THIS LINE

        const reportData = {
            matchId: matchId,
            loserUsername: document.getElementById('loser-username').textContent,
            winnerUsername: winnerUsername.value,
            finalScore: finalScore.value,
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
            })
            .catch((error) => {
                console.error('Error adding report to Firestore:', error);
                document.getElementById('report-error').textContent = 'Error reporting game. Please try again.';
            });
    });

    function populateWinnerDropdown() {
        db.collection('players').get().then(querySnapshot => {
            querySnapshot.forEach(doc => {
                const player = doc.data();
                const option = document.createElement('option');
                option.value = player.username;
                option.textContent = player.username;
                winnerUsername.appendChild(option);
            });
        }).catch(error => {
            console.error('Error fetching players:', error);
        });
    }

    function checkForOutstandingReports(username) {
        console.log("Checking for outstanding reports for username:", username); // ADD THIS LINE
    
        if (!confirmationNotification) {
            confirmationNotification = document.createElement('div');
            confirmationNotification.id = 'confirmation-notification';
            confirmationNotification.classList.add('notification-banner');
            confirmationNotification.style.display = 'none';
            confirmationNotification.style.marginTop = '10px';
            document.querySelector('.container').prepend(confirmationNotification);
        }
    
        db.collection('pendingMatches')
            .where('winnerUsername', '==', username)
            .where('approved', '==', false)
            .limit(1)
            .get()
            .then(snapshot => {
                console.log("Snapshot size:", snapshot.size); // ADD THIS LINE
                if (!snapshot.empty) {
                    snapshot.forEach(doc => {
                        outstandingReportData = doc.data();
                        outstandingReportData.id = doc.id;
                        console.log("Outstanding report data:", outstandingReportData); // ADD THIS LINE
                    });
    
                    confirmationNotification.style.display = 'block';
                    confirmationNotification.innerHTML = `
                        <div>
                            You have an outstanding report to confirm. <a href="#" id="auto-fill-report">Click here to review and approve</a>
                        </div>
                    `;
                    console.log('Outstanding reports found');
    
                    document.getElementById('auto-fill-report').addEventListener('click', function(e) {
                        e.preventDefault();
                        autoFillReportForm(outstandingReportData);
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
        if (reportData) {
            // Populate the form fields
            winnerUsername.value = reportData.winnerUsername;
            finalScore.value = reportData.finalScore;
            suicides.value = reportData.suicides;
            mapPlayed.value = reportData.mapPlayed;
            loserComment.value = reportData.loserComment;

            // Optionally, disable the fields to prevent modification
            winnerUsername.disabled = true;
            finalScore.disabled = true;
            suicides.disabled = true;
            mapPlayed.disabled = true;
            loserComment.disabled = true;

            // Change the submit button to an "Approve" button
            reportForm.innerHTML += '<button type="button" id="approve-report">Approve Report</button>';

            // Add event listener to the Approve button
            document.getElementById('approve-report').addEventListener('click', function() {
                approveReport(reportData.id);
            });
        }
    }

    function approveReport(reportId) {
        db.collection('pendingMatches').doc(reportId).update({ approved: true })
            .then(() => {
                console.log('Report approved successfully.');
                alert('Report approved!');
                // Clean up the form
                reportForm.reset();
                winnerUsername.disabled = false;
                finalScore.disabled = false;
                suicides.disabled = false;
                mapPlayed.disabled = false;
                loserComment.disabled = false;
                document.getElementById('approve-report').remove();
                confirmationNotification.style.display = 'none';
                outstandingReportData = null;
            })
            .catch(error => {
                console.error('Error approving report:', error);
                alert('Error approving report. Please try again.');
            });
    }
});