// Ensure the DOM is fully loaded
document.addEventListener('DOMContentLoaded', function() {
    // Initialize Firebase (make sure firebase-config.js is included and configured properly)
    firebase.auth().onAuthStateChanged(function(user) {
        if (user) {
            // User is signed in
            const loserUsername = document.getElementById('loser-username');
            loserUsername.textContent = user.displayName; // Use display name if available, otherwise use email

            // Show the report form
            document.getElementById('report-form').style.display = 'block';

            // Fetch and populate the winner dropdown with player list
            fetchPlayers();
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

    // Function to fetch players from Firestore and populate the winner dropdown
    function fetchPlayers() {
        const playersRef = firebase.firestore().collection('players'); // Replace 'players' with your collection name
        playersRef.get().then(function(querySnapshot) {
            querySnapshot.forEach(function(doc) {
                const player = doc.data();
                const option = document.createElement('option');
                option.value = player.username; // Adjust according to your data structure
                option.textContent = player.username;
                winnerUsername.appendChild(option);
            });
        }).catch(function(error) {
            console.error("Error fetching players: ", error);
        });
    }
});
