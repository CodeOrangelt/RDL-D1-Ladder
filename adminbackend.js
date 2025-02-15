document.addEventListener('DOMContentLoaded', () => {
    const viewEloRatingsButton = document.getElementById('view-elo-ratings');
    const eloRatingsDiv = document.getElementById('elo-ratings');
    const eloTableBody = document.getElementById('elo-table').querySelector('tbody');
    const adminButton = document.getElementById('admin-button');

    if (!adminButton) {
        console.error('Admin button not found in the DOM');
        return;
    }

    // Check if the user is authenticated and authorized
    firebase.auth().onAuthStateChanged(user => {
        if (user) {
            console.log('User is signed in:', user.email); // Debug statement
            // User is signed in, check if the email is "admin@ladder.com"
            if (user.email === 'admin@ladder.com') {
                console.log('User is authorized as admin'); // Debug statement
                // User is authorized, show the admin button
                adminButton.style.display = 'block';
            } else {
                console.log('User is not authorized as admin'); // Debug statement
                // User is not authorized, redirect to another page or show an error message
                alert('You are not authorized to access this page.');
                window.location.href = 'index.html'; // Redirect to the home page
            }
        } else {
            console.log('No user is signed in'); // Debug statement
            // No user is signed in, redirect to the login page
            window.location.href = 'login.html'; // Redirect to the login page
        }
    });

    if (viewEloRatingsButton) {
        viewEloRatingsButton.addEventListener('click', () => {
            // Fetch ELO ratings from Firestore
            db.collection('players').orderBy('eloRating', 'desc').get()
                .then(querySnapshot => {
                    // Clear existing table rows
                    eloTableBody.innerHTML = '';

                    querySnapshot.forEach(doc => {
                        const player = doc.data();
                        const row = document.createElement('tr');
                        const usernameCell = document.createElement('td');
                        const eloRatingCell = document.createElement('td');

                        usernameCell.textContent = player.username;
                        eloRatingCell.textContent = player.eloRating;

                        row.appendChild(usernameCell);
                        row.appendChild(eloRatingCell);
                        eloTableBody.appendChild(row);
                    });

                    // Show the ELO ratings div
                    eloRatingsDiv.style.display = 'block';
                })
                .catch(error => {
                    console.error('Error fetching ELO ratings:', error);
                });
        });
    } else {
        console.error('Button with ID "view-elo-ratings" not found.');
    }
});