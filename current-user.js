// Check if user is signed in
auth.onAuthStateChanged(function(user) {
    if (user) {
        fetchUsername(user.uid);  // Fetch the username
        document.getElementById('sign-out-container').style.display = 'block';
        document.getElementById('login-register').style.display = 'none';  // Hide Login/Register
    } else {
        document.getElementById('sign-out-container').style.display = 'none';
        document.getElementById('login-register').style.display = 'block';  // Show Login/Register
    }
});

// Fetch the username and display it
function fetchUsername(uid) {
    db.collection('players').doc(uid).get().then(doc => {
        if (doc.exists) {
            const username = doc.data().username;
            document.getElementById('current-user').textContent = `(${username})`;  // Display current user's username
        } else {
            console.error("No such document!");
        }
    }).catch(error => {
        console.error("Error getting document:", error);
    });
}

// Ensure ladder is visible to all visitors
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
                }
            });
        });
}
