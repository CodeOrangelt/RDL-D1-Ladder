document.addEventListener('DOMContentLoaded', () => {
    // Initialize Firebase (make sure firebase-config.js is included and configured properly)
    firebase.auth().onAuthStateChanged(user => {
        if (user) {
            console.log('User signed in:', user.email || user.displayName); // Debugging log

            // Check for outstanding reports for the current user
            checkForOutstandingReports(user.email || user.displayName);
        } else {
            // No user is signed in, show the authentication warning
            console.log('No user signed in'); // Debugging log
            document.getElementById('auth-warning').style.display = 'block';
        }
    });

    // Function to check for outstanding reports for the current user
    function checkForOutstandingReports(username) {
        console.log('Checking for outstanding reports for username:', username); // Debugging log

        db.collection('pendingMatches')
            .where('winnerUsername', '==', username)
            .where('approved', '==', false)
            .get()
            .then(snapshot => {
                if (!snapshot.empty) {
                    const reportData = snapshot.docs[0].data();
                    const reportId = snapshot.docs[0].id;
                    autofillConfirmForm(reportData, reportId);
                } else {
                    console.log('No outstanding reports found');
                    document.getElementById('auth-warning').textContent = 'No outstanding reports to confirm.';
                }
            })
            .catch(error => {
                console.error('Error checking for outstanding reports:', error);
            });
    }

    // Function to auto-fill the confirm form with report data
    function autofillConfirmForm(reportData, reportId) {
        console.log('Auto-filling confirm form with data:', reportData); // Debugging log

        document.getElementById('loser-username').textContent = reportData.loserUsername;
        document.getElementById('winner-username').textContent = reportData.winnerUsername;
        document.getElementById('final-score').textContent = reportData.finalScore;
        document.getElementById('suicides').textContent = reportData.suicides;
        document.getElementById('map-played').textContent = reportData.mapPlayed;
        document.getElementById('loser-comment').textContent = reportData.loserComment;

        // Show the confirm form
        document.getElementById('confirm-form').style.display = 'block';

        // Handle confirm form submission
        document.getElementById('confirm-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const winnerComment = document.getElementById('winner-comment').value;
            confirmReport(reportId, reportData, winnerComment);
        });
    }

    // Function to confirm the report
    function confirmReport(reportId, reportData, winnerComment) {
        console.log('Confirming report with ID:', reportId); // Debugging log

        // Update the original report with the confirmation details
        reportData.winnerComment = winnerComment;
        reportData.approved = true;

        // Move report to approvedMatches collection
        db.collection('approvedMatches').add(reportData)
            .then(() => {
                console.log('Report successfully added to approvedMatches.');

                // Delete report from pendingMatches collection
                db.collection('pendingMatches').doc(reportId).delete()
                    .then(() => {
                        console.log('Report successfully deleted from pendingMatches.');
                        alert('Report confirmed successfully.');
                        document.getElementById('confirm-form').reset();
                        document.getElementById('confirm-form').style.display = 'none';
                    })
                    .catch((error) => {
                        console.error('Error deleting report from pendingMatches:', error);
                        document.getElementById('confirm-error').textContent = 'Error confirming report. Please try again.';
                    });
            })
            .catch((error) => {
                console.error('Error adding report to approvedMatches:', error);
                document.getElementById('confirm-error').textContent = 'Error confirming report. Please try again.';
            });
    }
});
