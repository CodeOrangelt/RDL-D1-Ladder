document.addEventListener('DOMContentLoaded', () => {
    // Handle authentication state changes
    auth.onAuthStateChanged(user => {
        if (user) {
            fetchUsername(user.uid).then(username => {
                document.getElementById('loser-username').textContent = username;
                document.getElementById('loser-username-confirm').textContent = username;
                populateWinnerDropdown();
                checkForOutstandingReport(username);
            }).catch(error => {
                console.error('Error fetching username:', error);
                showAuthWarning();
            });
        } else {
            showAuthWarning();
        }
    });

    // Handle report form submission
    document.getElementById('report-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const reportData = getReportFormData();
        db.collection('reports').add(reportData).then(() => {
            document.getElementById('report-form').reset();
            alert('Game reported successfully.');
        }).catch(error => {
            console.error('Error reporting game:', error);
            document.getElementById('report-error').textContent = 'Error reporting game. Please try again.';
        });
    });

    // Handle confirm form submission
    document.getElementById('confirm-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const confirmData = getConfirmFormData();
        const query = db.collection('reports').where('loserUsername', '==', confirmData.loserUsername)
                        .where('winnerUsername', '==', confirmData.winnerUsername)
                        .where('approved', '==', false);

        query.get().then(snapshot => {
            if (!snapshot.empty) {
                const reportDoc = snapshot.docs[0];
                reportDoc.ref.update(confirmData).then(() => {
                    document.getElementById('confirm-form').reset();
                    alert('Game confirmed successfully.');
                }).catch(error => {
                    console.error('Error confirming game:', error);
                    document.getElementById('report-error').textContent = 'Error confirming game. Please try again.';
                });
            } else {
                alert('No matching report found to confirm.');
            }
        }).catch(error => {
            console.error('Error finding report to confirm:', error);
            document.getElementById('report-error').textContent = 'Error finding report to confirm. Please try again.';
        });
    });
});

// Fetch username from Firestore
function fetchUsername(uid) {
    return db.collection('players').doc(uid).get().then(doc => {
        if (doc.exists) {
            return doc.data().username;
        } else {
            throw new Error('No such document!');
        }
    }).catch(error => {
        console.error('Error getting document:', error);
        throw error;
    });
}

// Populate winner dropdown with usernames
function populateWinnerDropdown() {
    const winnerDropdown = document.getElementById('winner-username');
    db.collection('players').get().then(querySnapshot => {
        querySnapshot.forEach(doc => {
            const username = doc.data().username;
            const option = document.createElement('option');
            option.value = username;
            option.textContent = username;
            winnerDropdown.appendChild(option);
        });
    }).catch(error => {
        console.error('Error fetching players:', error);
    });
}

// Check for outstanding reports
function checkForOutstandingReport(username) {
    db.collection('reports')
        .where('loserUsername', '==', username)
        .where('approved', '==', false)
        .get()
        .then(querySnapshot => {
            if (!querySnapshot.empty) {
                // Outstanding report found
                document.getElementById('confirm-form').style.display = 'block';
                document.getElementById('report-form').style.display = 'none';

                const reportData = querySnapshot.docs[0].data();
                populateConfirmForm(reportData);
            } else {
                // No outstanding report, show report form
                document.getElementById('report-form').style.display = 'block';
                document.getElementById('confirm-form').style.display = 'none';
            }
        })
        .catch(error => {
            console.error('Error fetching reports:', error);
        });
}

// Populate confirm form with report data
function populateConfirmForm(data) {
    document.getElementById('loser-username-confirm').textContent = data.loserUsername;
    document.getElementById('winner-username-confirm').textContent = data.winnerUsername;
    document.getElementById('final-score-confirm').textContent = data.finalScore;
    document.getElementById('suicides-confirm').textContent = data.suicides;
    document.getElementById('map-played-confirm').textContent = data.mapPlayed;
    document.getElementById('loser-comment-confirm').textContent = data.loserComment;
}

// Get report form data
function getReportFormData() {
    return {
        loserUsername: document.getElementById('loser-username').textContent,
        winnerUsername: document.getElementById('winner-username').value,
        finalScore: document.getElementById('final-score').value,
        suicides: document.getElementById('suicides').value,
        mapPlayed: document.getElementById('map-played').value,
        loserComment: document.getElementById('loser-comment').value,
        approved: false,
    };
}

// Get confirm form data
function getConfirmFormData() {
    return {
        loserUsername: document.getElementById('loser-username-confirm').textContent,
        winnerUsername: document.getElementById('winner-username-confirm').textContent,
        finalScore: document.getElementById('final-score-confirm').textContent,
        suicides: document.getElementById('suicides-confirm').textContent,
        mapPlayed: document.getElementById('map-played-confirm').textContent,
        loserComment: document.getElementById('loser-comment-confirm').textContent,
        winnerScore: document.getElementById('winner-score').value,
        winnerSuicides: document.getElementById('winner-suicides').value,
        winnerComment: document.getElementById('winner-comment').value,
        approved: true,
    };
}

// Show authentication warning
function showAuthWarning() {
    document.getElementById('auth-warning').style.display = 'block';
    document.getElementById('report-form').style.display = 'none';
    document.getElementById('confirm-form').style.display = 'none';
}
