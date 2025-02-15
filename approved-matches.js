// approved-matches.js

document.addEventListener('DOMContentLoaded', () => {
    const approvedMatchesTable = document.getElementById('approved-matches').getElementsByTagName('tbody')[0];

    function populateApprovedMatches() {
        db.collection('pendingMatches')
            .where('approved', '==', true)
            .orderBy('createdAt', 'desc') // Order by creation date (newest first)
            .get()
            .then(querySnapshot => {
                if (!querySnapshot.empty) {
                    // Clear the table
                    approvedMatchesTable.innerHTML = '';

                    querySnapshot.forEach(doc => {
                        const matchData = doc.data();

                        // Fetch usernames for winner and loser
                        Promise.all([
                            getUsername(matchData.winnerUsername),
                            getUsername(matchData.loserUsername)
                        ]).then(([winnerUsername, loserUsername]) => {
                            // Create table row
                            const row = approvedMatchesTable.insertRow();

                            // Create table cells
                            const loserCell = row.insertCell(0);
                            const winnerCell = row.insertCell(1);
                            const loserScoreCell = row.insertCell(2);  // Changed from scoreCell
                            const winnerScoreCell = row.insertCell(3);
                            const loserSuicidesCell = row.insertCell(4);
                            const winnerSuicidesCell = row.insertCell(5);
                            const mapCell = row.insertCell(6);
                            const loserCommentCell = row.insertCell(7);
                            const winnerCommentCell = row.insertCell(8);

                            // Populate table cells
                            loserCell.textContent = loserUsername;
                            winnerCell.textContent = winnerUsername;
                            loserScoreCell.textContent = matchData.finalScore;  // Changed from matchData.loserScore
                            winnerScoreCell.textContent = matchData.winnerScore;
                            loserSuicidesCell.textContent = matchData.suicides;
                            winnerSuicidesCell.textContent = matchData.winnerSuicides;
                            mapCell.textContent = matchData.mapPlayed;
                            loserCommentCell.textContent = matchData.loserComment;
                            winnerCommentCell.textContent = matchData.winnerComment || ''; // Handle missing winner comment
                        });
                    });
                } else {
                    // Display message if no approved matches
                    approvedMatchesTable.innerHTML = '<tr><td colspan="9">No approved matches found.</td></tr>';  // Changed colspan to 9
                }
            })
            .catch(error => {
                console.error('Error fetching approved matches:', error);
                approvedMatchesTable.innerHTML = '<tr><td colspan="9">Error fetching approved matches. Please try again.</td></tr>';  // Changed colspan to 9
            });
    }

    function getUsername(email) {
        return db.collection('players')
            .where('email', '==', email)
            .get()
            .then(querySnapshot => {
                if (!querySnapshot.empty) {
                    const playerDoc = querySnapshot.docs[0];
                    return playerDoc.data().username;
                } else {
                    console.error('No player found with email:', email);
                    return 'Unknown Player';
                }
            })
            .catch(error => {
                console.error('Error fetching player:', error);
                return 'Unknown Player';
            });
    }

    // Call populateApprovedMatches when the page loads
    populateApprovedMatches();
});
