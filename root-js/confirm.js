document.addEventListener('DOMContentLoaded', () => {
    firebase.auth().onAuthStateChanged(user => {
        if (user) {
            console.log('User signed in:', user.email || user.displayName);

            checkForOutstandingReports(user.email || user.displayName);
        } else {
            console.log('No user signed in');
            document.getElementById('auth-warning').style.display = 'block';
        }
    });

    function checkForOutstandingReports(username) {
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

    function autofillConfirmForm(reportData, reportId) {
        document.getElementById('loser-username').textContent = reportData.loserUsername;
        document.getElementById('winner-username').textContent = reportData.winnerUsername;
        document.getElementById('final-score').textContent = reportData.finalScore;
        document.getElementById('suicides').textContent = reportData.suicides;
        document.getElementById('map-played').textContent = reportData.mapPlayed;
        document.getElementById('loser-comment').textContent = reportData.loserComment;

        document.getElementById('confirm-form').style.display = 'block';

        document.getElementById('confirm-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const winnerComment = document.getElementById('winner-comment').value;
            confirmReport(reportId, reportData, winnerComment);
        });
    }

    function confirmReport(reportId, reportData, winnerComment) {
        reportData.winnerComment = winnerComment;
        reportData.approved = true;

        db.collection('approvedMatches').doc(reportId).set(reportData)
            .then(() => {
                console.log('Report successfully added to approvedMatches.');

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
