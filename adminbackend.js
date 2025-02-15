document.addEventListener('DOMContentLoaded', () => {
    const viewEloRatingsButton = document.getElementById('view-elo-ratings');
    const eloRatingsDiv = document.getElementById('elo-ratings');
    const eloTableBody = document.getElementById('elo-table').getElementsByTagName('tbody')[0];

    viewEloRatingsButton.addEventListener('click', () => {
        // Toggle the display of the ELO ratings table
        if (eloRatingsDiv.style.display === 'none') {
            eloRatingsDiv.style.display = 'block';
            loadEloRatings();
        } else {
            eloRatingsDiv.style.display = 'none';
        }
    });

    function loadEloRatings() {
        // Clear the existing table rows
        eloTableBody.innerHTML = '';

        // Fetch player data from Firestore
        db.collection('players')
            .orderBy('eloRating', 'desc') // Order by ELO rating in descending order
            .get()
            .then(querySnapshot => {
                querySnapshot.forEach(doc => {
                    const player = doc.data();
                    const row = eloTableBody.insertRow();

                    const usernameCell = row.insertCell();
                    usernameCell.textContent = player.username;

                    const eloRatingCell = row.insertCell();
                    eloRatingCell.textContent = player.eloRating || 1200; // Default ELO rating is 1200
                });
            })
            .catch(error => {
                console.error('Error fetching player data:', error);
            });
    }
});