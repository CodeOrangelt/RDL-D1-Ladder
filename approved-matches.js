// approved-matches.js

// Fetch approved matches and display them in the table
function fetchApprovedMatches() {
    const matchesTableBody = document.getElementById('approved-matches').getElementsByTagName('tbody')[0];

    db.collection('reports').where('approved', '==', true).get()
        .then(snapshot => {
            snapshot.forEach(doc => {
                const match = doc.data();
                const row = matchesTableBody.insertRow();

                const loserCell = row.insertCell(0);
                const winnerCell = row.insertCell(1);
                const finalScoreCell = row.insertCell(2);
                const suicidesCell = row.insertCell(3);
                const mapPlayedCell = row.insertCell(4);
                const loserCommentCell = row.insertCell(5);
                const winnerCommentCell = row.insertCell(6);

                loserCell.textContent = match.loserUsername;
                winnerCell.textContent = match.winnerUsername;
                finalScoreCell.textContent = match.finalScore;
                suicidesCell.textContent = match.suicides;
                mapPlayedCell.textContent = match.mapPlayed;
                loserCommentCell.textContent = match.loserComment;
                winnerCommentCell.textContent = match.winnerComment;
            });
        })
        .catch(error => {
            console.error("Error fetching approved matches:", error);
        });
}

// Initialize fetching approved matches
fetchApprovedMatches();
