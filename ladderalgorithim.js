// ELO rating calculation function
function calculateElo(winnerRating, loserRating, kFactor = 32) {
    const expectedScoreWinner = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
    const expectedScoreLoser = 1 / (1 + Math.pow(10, (winnerRating - loserRating) / 400));

    const newWinnerRating = winnerRating + kFactor * (1 - expectedScoreWinner);
    const newLoserRating = loserRating + kFactor * (0 - expectedScoreLoser);

    return {
        newWinnerRating: Math.round(newWinnerRating),
        newLoserRating: Math.round(newLoserRating)
    };
}

// Function to assign default ELO rating if not present
function assignDefaultEloRating(playerId, playerData) {
    const defaultEloRating = 1200; // Default ELO rating
    if (!playerData.eloRating) {
        db.collection('players').doc(playerId).update({ eloRating: defaultEloRating })
            .then(() => {
                console.log(`Assigned default ELO rating to player ${playerData.username}`);
            })
            .catch(error => {
                console.error('Error assigning default ELO rating:', error);
            });
    }
}

// Function to update ELO ratings and swap positions after a match
function updateEloRatings(winnerId, loserId) {
    const playersRef = db.collection('players');

    // Get the current ratings and positions of the winner and loser
    Promise.all([
        playersRef.doc(winnerId).get(),
        playersRef.doc(loserId).get()
    ]).then(([winnerDoc, loserDoc]) => {
        if (winnerDoc.exists && loserDoc.exists) {
            const winnerData = winnerDoc.data();
            const loserData = loserDoc.data();

            // Assign default ELO rating if not present
            assignDefaultEloRating(winnerId, winnerData);
            assignDefaultEloRating(loserId, loserData);

            const winnerRating = winnerData.eloRating || 1200; // Default ELO rating is 1200
            const loserRating = loserData.eloRating || 1200;

            // Calculate new ELO ratings
            const { newWinnerRating, newLoserRating } = calculateElo(winnerRating, loserRating);

            // Update the ratings in the database
            playersRef.doc(winnerId).update({ eloRating: newWinnerRating });
            playersRef.doc(loserId).update({ eloRating: newLoserRating });

            console.log(`Updated ELO ratings: Winner (${winnerId}) - ${newWinnerRating}, Loser (${loserId}) - ${newLoserRating}`);

            // Swap positions in the ladder
            const winnerPosition = winnerData.position;
            const loserPosition = loserData.position;

            if (winnerPosition > loserPosition) {
                playersRef.doc(winnerId).update({ position: loserPosition });
                playersRef.doc(loserId).update({ position: winnerPosition });

                console.log(`Swapped positions: Winner (${winnerId}) is now at position ${loserPosition}, Loser (${loserId}) is now at position ${winnerPosition}`);
            }
        } else {
            console.error('One or both players not found in the database.');
        }
    }).catch(error => {
        console.error('Error updating ELO ratings and positions:', error);
    });
}

// Example usage: Call this function when a match is reported
// updateEloRatings('winnerPlayerId', 'loserPlayerId');