// ladder.js

document.addEventListener('DOMContentLoaded', () => {
    const ladderTableBody = document.getElementById('ladder').querySelector('tbody');

    // Function to fetch ladder data
    function fetchLadder() {
        console.log('Fetching ladder data...'); // Debug statement

        // Simulate fetching data from an API or database
        const players = [
            { position: 1, username: 'Player1', eloRating: 1500 },
            { position: 2, username: 'Player2', eloRating: 1450 },
            { position: 3, username: 'Player3', eloRating: 1400 }
        ];

        // Clear existing table rows
        ladderTableBody.innerHTML = '';

        if (players.length === 0) {
            console.log('No players found in the ladder.'); // Debug statement
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.colSpan = 3;
            cell.textContent = 'No players found in the ladder.';
            row.appendChild(cell);
            ladderTableBody.appendChild(row);
        } else {
            players.forEach(player => {
                console.log('Player data:', player); // Debug statement

                const row = document.createElement('tr');
                const rankCell = document.createElement('td');
                const usernameCell = document.createElement('td');
                const pointsCell = document.createElement('td');

                rankCell.textContent = player.position;
                usernameCell.textContent = player.username;
                pointsCell.textContent = player.eloRating;

                row.appendChild(rankCell);
                row.appendChild(usernameCell);
                row.appendChild(pointsCell);
                ladderTableBody.appendChild(row);
            });
        }
    }

    // Fetch the ladder initially
    fetchLadder();

    // Optionally, set up a listener to refresh the ladder when changes are made
    // This is just a placeholder for any real-time updates
    setInterval(fetchLadder, 60000); // Refresh every 60 seconds
});
