// report.js

// Check if user is signed in
auth.onAuthStateChanged(function(user) {
    if (user) {
        document.getElementById('auth-warning').style.display = 'none';
        checkForOutstandingReports(user.email);
    } else {
        document.getElementById('report-form').style.display = 'none';
        document.getElementById('confirm-form').style.display = 'none';
        document.getElementById('auth-warning').style.display = 'block';
    }
});

// Check for outstanding reports and toggle forms
function checkForOutstandingReports(winnerEmail) {
    const reportErrorDiv = document.getElementById('report-error');

    db.collection('reports').where('winnerUsername', '==', winnerEmail).where('approved', '==', false).get()
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
                document.getElementById('loser-username').textContent = auth.currentUser.email;  // Display loser's username
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
    db.collection('players').get()
        .then(snapshot => {
            snapshot.forEach(doc => {
                const player = doc.data();
                const option = document.createElement('option');
                option.value = player.username;
                option.textContent = player.username;
                winnerSelect.appendChild(option);
            });
        })
        .catch(error => console.error('Error fetching players:', error));
}

// Report Form Submission
document.getElementById('report-form').addEventListener('submit', function (e) {
    e.preventDefault();

    const loserUsername = document.getElementById('loser-username').textContent;
    const winnerUsername = document.getElementById('winner-username').value;
    const finalScore = document.getElementById('final-score').value;
    const suicides = document.getElementById('suicides').value;
    const mapPlayed = document.getElementById('map-played').value;
    const loserComment = document.getElementById('loser-comment').value;
    const reportErrorDiv = document.getElementById('report-error');

    const reportData = {
        loserUsername: loserUsername,
        winnerUsername: winnerUsername,
        finalScore: finalScore,
        suicides: suicides,
        mapPlayed: mapPlayed,
        loserComment: loserComment,
        winnerComment: '',
        approved: false  // Initial status
    };

    // Save report to Firestore
    db.collection('reports').add(reportData)
        .then(() => {
            alert('Game reported successfully! Awaiting approval from the winner.');
            document.getElementById('repsort-form').reset();
        })
        .catch(error => {
            console.error("Error reporting game:", error);
            reportErrorDiv.innerHTML = error.message;
        });
});

fetch('https://s1.npass.app/icons/github.io.png', {
    mode: 'no-cors'
})
.then(response => {
    console.log(response);
})
.catch(error => {
    console.error('Error fetching resource:', error);
});
