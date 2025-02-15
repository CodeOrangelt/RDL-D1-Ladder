// approved-matches.js

document.addEventListener('DOMContentLoaded', () => {
    const approvedMatchesTable = document.getElementById('approved-matches-table').getElementsByTagName('tbody')[0];

    db.collection('pendingMatches')
        .where('approved', '==', true)
        .get()
        .then(querySnapshot => {
            querySnapshot.forEach(doc => {
                const match = doc.data();
                const row = approvedMatchesTable.insertRow();

                // Fetch the winner's username
                db.collection('players')
                    .where('email', '==', match.winnerEmail)
                    .get()
                    .then(winnerQuerySnapshot => {
                        if (!winnerQuerySnapshot.empty) {
                            const winnerDoc = winnerQuerySnapshot.docs[0];
                            const winnerUsername = winnerDoc.data().username;

                            const winnerCell = row.insertCell();
                            winnerCell.textContent = winnerUsername;
                        } else {
                            const winnerCell = row.insertCell();
                            winnerCell.textContent = "Unknown Player";
                        }
                    })
                    .catch(error => {
                        console.error('Error fetching winner:', error);
                        const winnerCell = row.insertCell();
                        winnerCell.textContent = "Error Fetching Username";
                    });

                const loserCell = row.insertCell();
                loserCell.textContent = match.loserUsername;

                const winnerScoreCell = row.insertCell();
                winnerScoreCell.textContent = match.winnerScore;

                const loserScoreCell = row.insertCell();
                loserScoreCell.textContent = match.loserScore;

                const winnerSuicidesCell = row.insertCell();
                winnerSuicidesCell.textContent = match.winnerSuicides;

                const loserSuicidesCell = row.insertCell();
                loserSuicidesCell.textContent = match.suicides;

                const mapPlayedCell = row.insertCell();
                mapPlayedCell.textContent = match.mapPlayed;

                const winnerCommentCell = row.insertCell();
                winnerCommentCell.textContent = match.winnerComment;

                const loserCommentCell = row.insertCell();
                loserCommentCell.textContent = match.loserComment;
            });
        })
        .catch(error => {
            console.error('Error fetching approved matches:', error);
        });
});
