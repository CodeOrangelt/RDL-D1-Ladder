const players = [
    { username: 'Player1', points: 1500 },
    { username: 'Player2', points: 1400 },
    { username: 'Player3', points: 1300 },
    { username: 'Player4', points: 1200 },
    { username: 'Player5', points: 1100 },
];

function displayLadder() {
    const tbody = document.querySelector('#ladder tbody');
    players.sort((a, b) => b.points - a.points);

    players.forEach((player, index) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${index + 1}</td>
            <td>${player.username}</td>
            <td>${player.points}</td>
        `;
        tbody.appendChild(row);
    });
}

window.onload = displayLadder;
