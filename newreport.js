// Ensure the DOM is fully loaded
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM fully loaded'); // Debugging log

    // Initialize Firebase (make sure firebase-config.js is included and configured properly)
    firebase.auth().onAuthStateChanged(function(user) {
        if (user) {
            console.log('User signed in:', user.email || user.displayName); // Debugging log

            // User is signed in
            const loserUsername = document.getElementById('loser-username');
            loserUsername.textContent = user.displayName || user.email; // Use display name if available, otherwise use email

            // Show the report form
            document.getElementById('report-form').style.display = 'block';

            // Fetch and populate the winner dropdown with player list from ladder.js
            fetchPlayersFromLadder(); // Call fetchPlayersFromLadder from ladder.js

            // Check for outstanding reports for the current user
            checkOutstandingReports(user.email || user.displayName);
        } else {
            // No user is signed in, show the authentication warning
            console.log('No user signed in'); // Debugging log
            document.getElementById('auth-warning').style.display = 'block';
        }
    });

    // Get form elements
    const reportForm = document.getElementById('report-form');
    const winnerUsername = document.getElementById('winner-username');
    const finalScore = document.getElementById('final-score');
    const suicides = document.getElementById('suicides');
    const mapPlayed = document.getElementById('map-played');
    const loserComment = document.getElementById('loser-comment');

    // Listen for the form submission
    reportForm.addEventListener('submit', function(event) {
        event.preventDefault(); // Prevent form from submitting the default way

        console.log('Form submitted'); // Debugging log

        // Get the values from the form inputs
        const reportData = {
            loserUsername: document.getElementById('loser-username').textContent,
            winnerUsername: winnerUsername.value,
            finalScore: finalScore.value,
            suicides: suicides.value,
            mapPlayed: mapPlayed.value,
            loserComment: loserComment.value,
            approved: false
        };

        // Log the form data to the console (for debugging purposes)
        console.log('Report Data:', reportData);

        // Send the reportData to your Firebase Firestore
        db.collection('reports').add(reportData)
            .then(() => {
                console.log('Report successfully added to Firestore.');
            })
            .catch((error) => {
                console.error('Error adding report to Firestore: ', error);
            });
    });

    // Function to populate the winner dropdown with player list from ladder.js
    function fetchPlayersFromLadder() {
        const winnerDropdown = document.getElementById('winner-username');

        // Fetch the ladder data and then call fetchPlayersFromLadder
        const table = document.getElementById('ladder');
        if (!table) {
            console.error('Ladder table not found'); // Debugging log
            return;
        }

        const tbody = table.getElementsByTagName('tbody')[0];
        if (!tbody) {
            console.error('Ladder table body not found'); // Debugging log
            return;
        }

        // Populate the winner dropdown with player list
        const rows = tbody.getElementsByTagName('tr');
        for (let row of rows) {
            const username = row.cells[1].textContent;
            console.log(`Adding player to dropdown: ${username}`); // Debugging log
            const option = document.createElement('option');
            option.value = username;
            option.textContent = username;
            winnerDropdown.appendChild(option);
        }
    }

    // Function to check for outstanding reports and display the notification button
    function checkOutstandingReports(currentUser) {
        const confirmationNotification = document.getElementById('confirmation-notification');
        db.collection('reports')
            .where('winnerUsername', '==', currentUser)
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
});
