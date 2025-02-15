document.addEventListener('DOMContentLoaded', () => {
    const viewEloRatingsButton = document.getElementById('view-elo-ratings');
    const eloRatingsDiv = document.getElementById('elo-ratings');
    const eloTableBody = document.getElementById('elo-table').getElementsByTagName('tbody')[0];
    const adminDropdown = document.getElementById('admin-dropdown');

    // Check if the user is authenticated and authorized
    firebase.auth().onAuthStateChanged(user => {
        if (user) {
            // User is signed in, check if the email is "admin@ladder.com"
            if (user.email === 'admin@ladder.com') {
                // User is authorized, show the admin backend and dropdown
                document.getElementById('admin-container').style.display = 'block';
                adminDropdown.style.display = 'block';
            } else {
                // User is not authorized, redirect to another page or show an error message
                alert('You are not authorized to access this page.');
                window.location.href = 'index.html'; // Redirect to the home page
            }
        } else {
            // No user is signed in, redirect to the login page
            window.location.href = 'login.html'; // Redirect to the login page
        }
    });

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