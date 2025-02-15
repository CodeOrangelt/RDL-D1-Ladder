document.addEventListener('DOMContentLoaded', () => {
    // Handle authentication state changes
    auth.onAuthStateChanged(user => {
        if (user) {
            fetchUsername(user.uid).then(username => {
                document.getElementById('loser-username').textContent = username;
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

// Show authentication warning
function showAuthWarning() {
    document.getElementById('auth-warning').style.display = 'block';
    document.getElementById('report-form').style.display = 'none';
}

// Check for outstanding reports
function checkForOutstandingReport(username) {
    const confirmationNotification = document.getElementById('confirmation-notification');
    db.collection('reports')
        .where('winnerUsername', '==', username)
        .where('approved', '==', false)
        .get()
        .then(snapshot => {
            if (!snapshot.empty) {
                confirmationNotification.style.display = 'block'; // Show the notification button
                console.log('Outstanding reports found'); // Debugging log
            }
        })
        .catch(error => {
            console.error("Error checking for outstanding reports: ", error);
        });
}
