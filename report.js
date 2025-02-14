// Check if user is signed in
auth.onAuthStateChanged(function(user) {
    if (user) {

        document.getElementById('auth-warning').style.display = 'none';
        fetchUsername(user.uid);  // Fetch the username

    } else {
        document.getElementById('report-form').style.display = 'none';
        document.getElementById('confirm-form').style.display = 'none';
        document.getElementById('auth-warning').style.display = 'block';
    }
});

// Fetch the username and check for outstanding reports
function fetchUsername(uid) {
    db.collection('players').doc(uid).get().then(doc => {
        if (doc.exists) {
            const username = doc.data().username;
            document.getElementById('loser-username').textContent = username;  // Display loser's username
            checkForOutstandingReports(username);
        } else {
            console.error("No such document!");
        }
    }).catch(error => {
        console.error("Error getting document:", error);
    });
}

// Check for outstanding reports and toggle forms
function checkForOutstandingReports(winnerUsername) {
    const reportErrorDiv = document.getElementById('report-error');

    db.collection('reports').where('winnerUsername', '==', winnerUsername).where('approved', '==', false).get()
        .then(snapshot => {
            if (!snapshot.empty) {
                // Show confirm form
                document.getElementById('confirm-form').style.display = 'block';
                const report = snapshot.docs[0].data();
                document.getElementById('loser-username-confirm').textContent = report.loserUsername;
                document.getElementById('winner-username-confirm').textContent = report.winnerUsername;
                document.getElementById('final-score-confirm').textContent = report.finalScore;
                document.getElementById('suicides-confirm').textContent = report.suicides;
                document.getElementById('map-played-confirm').textContent = report.mapPlayed;
                document.getElementById('loser-comment-confirm').textContent = report.loserComment;

                document.getElementById('confirm-form').addEventListener('submit', function (e) {
                    e.preventDefault();
                    const winnerComment = document.getElementById('winner-comment').value;

                    db.collection('reports').doc(snapshot.docs[0].id).update({
                        winnerComment: winnerComment,
                        approved: true
                    })
                        .then(() => {
                            alert('Report confirmed successfully!');
                            document.getElementById('confirm-form').reset();
                            window.location.href = 'index.html';  // Redirect to the main page
                        })
                        .catch(error => {
                            console.error("Error confirming report:", error);
                            reportErrorDiv.innerHTML = error.message;
                        });
                });
            } else {
                // Show report form
                document.getElementById('report-form').style.display = 'block';
                populateWinnerDropdown();
            }
        })
        .catch(error => {
            console.error('Error fetching reports:', error);
            reportErrorDiv.innerHTML = error.message;
        });
}

// Populate winner dropdown with players from Firestore
function populateWinnerDropdown() {
    const winnerSelect = document.getElementById('winner-username');
}