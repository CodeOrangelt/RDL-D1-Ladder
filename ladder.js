db.collection('players').orderBy('points', 'desc')
    .onSnapshot(snapshot => {
        const tbody = document.querySelector('#ladder tbody');
        tbody.innerHTML = '';  // Clear existing rows
        let rank = 1;
        const seenUsernames = new Set();
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
