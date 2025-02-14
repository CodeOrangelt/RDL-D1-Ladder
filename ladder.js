// ladder.js
db.collection('players').orderBy('points', 'desc')
    .onSnapshot(snapshot => {
        const tbody = document.querySelector('#ladder tbody');
        tbody.innerHTML = '';  // Clear existing rows
        let rank = 1;
        snapshot.forEach(doc => {
            const player = doc.data();
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${rank}</td>
                <td>${player.username}</td>
                <td>${player.points}</td>
            `;
            tbody.appendChild(row);
            rank++;
        });
    });
