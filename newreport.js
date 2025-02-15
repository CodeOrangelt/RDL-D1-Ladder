// Ensure the DOM is fully loaded
document.addEventListener('DOMContentLoaded', function() {
    // Initialize Firebase (make sure firebase-config.js is included and configured properly)
    firebase.auth().onAuthStateChanged(function(user) {
        if (user) {
            // User is signed in
            const loserUsername = document.getElementById('loser-username');
            loserUsername.textContent = user.displayName || user.email; // Use display name if available, otherwise use email

            // Show the report form
            document.getElementById('report-form').style.display = 'block';

            // Fetch and populate the winner dropdown with player list from ladder.js
            fetchLadderData(); // Call fetchLadderData from ladder.js

            // Check for outstanding reports for the current user
            checkOutstandingReports(user.email || user.displayName);
        } else {
            // No user is signed in, show the authentication warning
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

        // Get the values from the form inputs
        const reportData = {
            loserUsername: document.getElementById('loser-username').textContent,
            winnerUsername: winnerUsername.value,
            finalScore: finalScore.value,
            suicides: suicides.value,
            mapPlayed: mapPlayed.value,
            loserComment: loserComment.value
        };

        // Log the form data to the console (for debugging purposes)
        console.log('Report Data:', reportData);

        // Here you can add the logic to send the reportData to your Firebase Firestore or other backend
        // Example: sendReportDataToFirestore(reportData);
    });

    // Function to populate the winner dropdown with player list from fetchLadderData
    function fetchPlayersFromLadder() {
        const winnerDropdown = document.getElementById('winner-username');
        const ladder = document.getElementById('ladder');
        const tbody = ladder.getElementsByTagName('tbody')[0];

        const rows = tbody.getElementsByTagName('tr');
        for (let row of rows) {
            const username = row.cells[1].textContent;
            const option = document.createElement('option');
            option.value = username;
            option.textContent = username;
            winnerDropdown.appendChild(option);
        }
    }

    // Fetch the ladder data and then call fetchPlayersFromLadder
    function fetchLadderData() {
        const table = document.getElementById('ladder');
        if (!table) {
            console.error('Ladder table not found');
            return;
        }

        const tbody = table.getElementsByTagName('tbody')[0];
        if (!tbody) {
            console.error('Ladder table body not found');
            return;
        }

        // Clear existing rows and fetch data
        tbody.innerHTML = '';  // Clear existing rows
        let rank = 1;
        const seenUsernames = new Set();

        db.collection('players').orderBy('points', 'desc')
            .onSnapshot(snapshot => {
                tbody.innerHTML = '';  // Clear existing rows
                snapshot.forEach(doc => {
                    const player = doc.data();
                    console.log(`Fetched username: ${player.username}`);  // Log fetched usernames
                    if (!seenUsernames.has(player.username)) {
                        seenUsernames.add(player.username);
                        const row = document.createElement('tr');
                        row.innerHTML = `
                            <td>${rank}</td>
                            <td>${player.username}</td>
                            <td>${player.points}</td>
                        `;
                        tbody.appendChild(row);
                        rank++;
                    } else {
                        console.log(`Duplicate username skipped: ${player.username}`);
                    }
                });

                fetchPlayersFromLadder(); // Populate the winner dropdown
            });
    }

    // Function to check for outstanding reports and display the notification button
    function checkOutstandingReports(currentUser) {
        const confirmationNotification = document.getElementById('confirmation-notification');
        db.collection('reports')
            .where('winnerUsername', '==', currentUser)
            .where('confirmed', '==', false) // Adjust according to your data structure
            .get()
            .then(snapshot => {
                if (!snapshot.empty) {
                    confirmationNotification.style.display = 'block'; // Show the notification button
                }
            })
            .catch(error => {
                console.error("Error checking for outstanding reports: ", error);
            });
    }
});
