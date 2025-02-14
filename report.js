// report.js

// Report Form Submission
document.getElementById('report-form').addEventListener('submit', function (e) {
    e.preventDefault();

    const loserUsername = document.getElementById('loser-username').value;
    const winnerUsername = document.getElementById('winner-username').value;
    const finalScore = document.getElementById('final-score').value;
    const suicides = document.getElementById('suicides').value;
    const mapPlayed = document.getElementById('map-played').value;
    const reportErrorDiv = document.getElementById('report-error');

    const reportData = {
        loserUsername: loserUsername,
        winnerUsername: winnerUsername,
        finalScore: finalScore,
        suicides: suicides,
        mapPlayed: mapPlayed,
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
