// current-user.js

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
    const ladderTableBody = document.getElementById('ladder').getElementsByTagName('tbody')[0];

    db.collection('players').orderBy('points', 'desc').get()
        .then(snapshot => {
            snapshot.forEach(doc => {
                const player = doc.data();
                const row = ladderTableBody.insertRow();

                const rankCell = row.insertCell(0);
                const usernameCell = row.insertCell(1);
                const pointsCell = row.insertCell(2);

                rankCell.textContent = row.rowIndex + 1;  // Rank is the row index + 1
                usernameCell.textContent = player.username;
                pointsCell.textContent = player.points;
            });
        })
        .catch(error => {
            console.error("Error fetching ladder data:", error);
        });
}
