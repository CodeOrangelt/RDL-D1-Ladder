document.addEventListener('DOMContentLoaded', () => {
    fetchLadderData();  // Fetch and display ladder data
});

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
        });
}
