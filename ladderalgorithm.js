// ladderalgorithm.js
export function calculateElo(winnerRating, loserRating, kFactor = 32) {
    const expectedScoreWinner = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
    const expectedScoreLoser = 1 / (1 + Math.pow(10, (winnerRating - loserRating) / 400));

    const newWinnerRating = winnerRating + kFactor * (1 - expectedScoreWinner);
    const newLoserRating = loserRating + kFactor * (0 - expectedScoreLoser);

    return {
        newWinnerRating: Math.round(newWinnerRating),
        newLoserRating: Math.round(newLoserRating)
    };
}

export function assignDefaultEloRating(playerId, playerData) {
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

export function updateEloRatings(winnerId, loserId) {
    const playersRef = db.collection('players');

    // Get the current ratings and positions of the winner and loser
    Promise.all([
        playersRef.doc(winnerId).get(),
        playersRef.doc(loserId).get()
    ]).then(([winnerDoc, loserDoc]) => {
        if (winnerDoc.exists && loserDoc.exists) {
            const winnerData = winnerDoc.data();
            const loserData = loserDoc.data();

            console.log(`Current winner data: ${JSON.stringify(winnerData)}`);
            console.log(`Current loser data: ${JSON.stringify(loserData)}`);

            // Assign default ELO rating if not present
            assignDefaultEloRating(winnerId, winnerData);
            assignDefaultEloRating(loserId, loserData);

            const winnerRating = winnerData.eloRating || 1200; // Default ELO rating is 1200
            const loserRating = loserData.eloRating || 1200;

            // Calculate new ELO ratings
            const { newWinnerRating, newLoserRating } = calculateElo(winnerRating, loserRating);

            console.log(`New ELO ratings: Winner (${winnerId}) - ${newWinnerRating}, Loser (${loserId}) - ${newLoserRating}`);

            // Update the ratings in the database
            playersRef.doc(winnerId).update({ eloRating: newWinnerRating })
                .then(() => {
                    console.log(`Updated winner's ELO rating to ${newWinnerRating}`);
                })
                .catch(error => {
                    console.error('Error updating winner\'s ELO rating:', error);
                });

            playersRef.doc(loserId).update({ eloRating: newLoserRating })
                .then(() => {
                    console.log(`Updated loser's ELO rating to ${newLoserRating}`);
                })
                .catch(error => {
                    console.error('Error updating loser\'s ELO rating:', error);
                });

            // Swap positions in the ladder only if the winner's position is lower (higher number) than the loser's position
            const winnerPosition = winnerData.position;
            const loserPosition = loserData.position;

            if (winnerPosition > loserPosition) {
                console.log(`Swapping positions: Winner (${winnerId}) from position ${winnerPosition} to ${loserPosition}, Loser (${loserId}) from position ${loserPosition} to ${winnerPosition}`);

                playersRef.doc(winnerId).update({ position: loserPosition })
                    .then(() => {
                        console.log(`Updated winner's position to ${loserPosition}`);
                    })
                    .catch(error => {
                        console.error('Error updating winner\'s position:', error);
                    });

                playersRef.doc(loserId).update({ position: winnerPosition })
                    .then(() => {
                        console.log(`Updated loser's position to ${winnerPosition}`);
                    })
                    .catch(error => {
                        console.error('Error updating loser\'s position:', error);
                    });

                console.log(`Swapped positions: Winner (${winnerId}) is now at position ${loserPosition}, Loser (${loserId}) is now at position ${winnerPosition}`);
            } else {
                console.log(`No position swap needed: Winner (${winnerId}) is already higher ranked than Loser (${loserId})`);
            }
        } else {
            console.error('One or both players not found in the database.');
        }
    }).catch(error => {
        console.error('Error updating ELO ratings and positions:', error);
    });
}

export function approveReport(reportId, winnerScore, winnerSuicides, winnerComment) {
    db.collection('pendingMatches').doc(reportId).update({
        approved: true,
        winnerScore: winnerScore,
        winnerSuicides: winnerSuicides,
        winnerComment: winnerComment
    })
    .then(() => {
        console.log('Report approved successfully.');
        alert('Report approved!');
        // Clean up the form
        const reportForm = document.getElementById('report-form');
        if (reportForm) {
            reportForm.reset();
        }
        const winnerUsername = document.getElementById('winner-username');
        if (winnerUsername) {
            winnerUsername.disabled = false;
        }
        const loserScore = document.getElementById('loser-score');
        if (loserScore) {
            loserScore.disabled = false;
        }

        const approveReportElement = document.getElementById('approve-report');
        if (approveReportElement) {
            approveReportElement.remove();
        }

        const confirmationNotification = document.getElementById('confirmation-notification');
        if (confirmationNotification) {
            confirmationNotification.style.display = 'none';
        }
        outstandingReportData = null;

        // Apply the ELO rating algorithm
        db.collection('pendingMatches').doc(reportId).get().then(doc => {
            if (doc.exists) {
                const reportData = doc.data();
                const winnerEmail = reportData.winnerEmail;
                const loserUsername = reportData.loserUsername;

                // Fetch the winner and loser IDs
                Promise.all([
                    db.collection('players').where('email', '==', winnerEmail).get(),
                    db.collection('players').where('username', '==', loserUsername).get()
                ]).then(([winnerSnapshot, loserSnapshot]) => {
                    if (!winnerSnapshot.empty && !loserSnapshot.empty) {
                        const winnerId = winnerSnapshot.docs[0].id;
                        const loserId = loserSnapshot.docs[0].id;

                        console.log(`Winner ID: ${winnerId}, Loser ID: ${loserId}`); // Debug statement

                        // Update ELO ratings and swap positions
                        updateEloRatings(winnerId, loserId);

                        // Move the report to the approvedMatches collection
                        db.collection('approvedMatches').doc(reportId).set(reportData)
                            .then(() => {
                                console.log('Report successfully added to approvedMatches.');

                                // Delete the report from the pendingMatches collection
                                db.collection('pendingMatches').doc(reportId).delete()
                                    .then(() => {
                                        console.log('Report successfully deleted from pendingMatches.');
                                        alert('Report confirmed successfully.');
                                        const confirmForm = document.getElementById('confirm-form');
                                        if (confirmForm) {
                                            confirmForm.reset();
                                            confirmForm.style.display = 'none';
                                        }
                                    })
                                    .catch((error) => {
                                        console.error('Error deleting report from pendingMatches:', error);
                                        const confirmError = document.getElementById('confirm-error');
                                        if (confirmError) {
                                            confirmError.textContent = 'Error confirming report. Please try again.';
                                        }
                                    });
                            })
                            .catch((error) => {
                                console.error('Error adding report to approvedMatches:', error);
                                const confirmError = document.getElementById('confirm-error');
                                if (confirmError) {
                                    confirmError.textContent = 'Error confirming report. Please try again.';
                                }
                            });
                    } else {
                        console.error('Winner or loser not found in the database.');
                    }
                }).catch(error => {
                    console.error('Error fetching winner or loser:', error);
                });
            } else {
                console.error('Report not found.');
            }
        }).catch(error => {
            console.error('Error fetching report:', error);
        });
    })
    .catch(error => {
        console.error('Error approving report:', error);
        alert('Error approving report. Please try again.');
    });
}

// Example usage: Call this function when a match is reported
// updateEloRatings('winnerPlayerId', 'loserPlayerId');