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
