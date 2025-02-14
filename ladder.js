// ladder.js
db.collection('players').orderBy('points', 'desc').get()
    .then(snapshot => {
        const tbody = document.querySelector('#ladder tbody');
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
    })
    .catch(error => console.error('Error fetching data:', error));
