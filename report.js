// report.js

// Check if user is signed in
auth.onAuthStateChanged(function(user) {
    if (user) {
        document.getElementById('report-form').style.display = 'block';
        document.getElementById('auth-warning').style.display = 'none';
        document.getElementById('loser-username').value = user.email;  // Auto-fill loser's username
        populateWinnerDropdown();
    } else {
        document.getElementById('report-form').style.display = 'none';
        document.getElementById('auth-warning').style.display = 'block';
    }
});

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

    const loserUsername = document.getElementById('loser-username').value;
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
            document.getElementById('report-form').reset();
        })
        .catch(error => {
            console.error("Error reporting game:", error);
            reportErrorDiv.innerHTML = error.message;
        });
});
