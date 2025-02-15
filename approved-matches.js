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
                            const scoreCell = row.insertCell(2);
                            const suicidesCell = row.insertCell(3);
                            const mapCell = row.insertCell(4);
                            const loserCommentCell = row.insertCell(5);
                            const winnerCommentCell = row.insertCell(6);

                            // Populate table cells
                            loserCell.textContent = loserUsername;
                            winnerCell.textContent = winnerUsername;
                            scoreCell.textContent = matchData.finalScore;
                            suicidesCell.textContent = matchData.suicides;
                            mapCell.textContent = matchData.mapPlayed;
                            loserCommentCell.textContent = matchData.loserComment;
                            winnerCommentCell.textContent = matchData.winnerComment || ''; // Handle missing winner comment
                        });
                    });
                } else {
                    // Display message if no approved matches
                    approvedMatchesTable.innerHTML = '<tr><td colspan="7">No approved matches found.</td></tr>';
                }
            })
            .catch(error => {
                console.error('Error fetching approved matches:', error);
                approvedMatchesTable.innerHTML = '<tr><td colspan="7">Error fetching approved matches. Please try again.</td></tr>';
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
