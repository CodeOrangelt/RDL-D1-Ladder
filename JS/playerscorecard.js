// Player Scorecard Module
// Handles calculation and display of player performance grades

class PlayerScorecard {
    constructor() {
        this.containerReferences = null;
        this.currentProfileData = null;
    }

    // Set references to required objects
    setReferences(containerReferences, currentProfileData) {
        this.containerReferences = containerReferences;
        this.currentProfileData = currentProfileData;
    }

    // Main display method for the scorecard
    async displayPlayerScorecard(username, matches, calculateMatchStatsImproved) {
        try {
            const scorecardContainer = this.containerReferences['player-scorecard'];
            if (!scorecardContainer) return;
            
            // Get existing rank class and apply it early for styling
            const container = document.querySelector('.profile-content');
            let existingRankClass = container ? 
                Array.from(container.classList).find(c => c.startsWith('elo-')) : 
                null;
            
            // Apply rank class to scorecard container
            if (existingRankClass) {
                scorecardContainer.classList.remove('elo-unranked', 'elo-bronze', 'elo-silver', 'elo-gold', 'elo-emerald');
                scorecardContainer.classList.add(existingRankClass);
            }
            
            // Check for non-participant
            if (this.currentProfileData?.isNonParticipant) {
                scorecardContainer.innerHTML = `
                    <h2>Player Scorecard</h2>
                    <div class="non-participant-notice">
                        <p>This player is not participating in the ladder.</p>
                    </div>
                `;
                return;
            }
            
            if (matches.length === 0) {
                scorecardContainer.innerHTML = `
                    <h2>Player Scorecard</h2>
                    <div class="non-participant-notice">
                        <p>No matches played yet. Grades will appear after completing matches.</p>
                    </div>
                `;
                return;
            }
            
            // Count unique opponents
            const uniqueOpponents = new Set();
            matches.forEach(match => {
                const opponent = match.winnerUsername === username ? match.loserUsername : match.winnerUsername;
                if (opponent) uniqueOpponents.add(opponent);
            });
            
            // Check minimum requirements: 30 matches and 6 unique opponents
            const minMatches = 30;
            const minOpponents = 6;
            const hasEnoughMatches = matches.length >= minMatches;
            const hasEnoughOpponents = uniqueOpponents.size >= minOpponents;
            
            if (!hasEnoughMatches || !hasEnoughOpponents) {
                const matchesNeeded = Math.max(0, minMatches - matches.length);
                const opponentsNeeded = Math.max(0, minOpponents - uniqueOpponents.size);
                
                scorecardContainer.innerHTML = `
                    <h2>Player Scorecard</h2>
                    <div class="non-participant-notice">
                        <p><strong>More matches needed for grading</strong></p>
                        <p style="margin-top: 8px; font-size: 0.9rem;">Requirements:</p>
                        <ul style="text-align: left; margin: 8px auto; max-width: 280px;">
                            <li style="color: ${hasEnoughMatches ? '#4caf50' : '#ff9800'};">
                                ${matches.length} / ${minMatches} matches ${hasEnoughMatches ? '✓' : ''}
                            </li>
                            <li style="color: ${hasEnoughOpponents ? '#4caf50' : '#ff9800'};">
                                ${uniqueOpponents.size} / ${minOpponents} unique opponents ${hasEnoughOpponents ? '✓' : ''}
                            </li>
                        </ul>
                    </div>
                `;
                return;
            }
            
            // Calculate statistics (using the passed function from profile-viewer)
            const stats = calculateMatchStatsImproved(username, matches, []);
            
            // Calculate scorecard
            const scorecard = this.calculatePlayerScorecard(stats, matches, username);
            
            // Build HTML
            scorecardContainer.innerHTML = `
                <h2>Player Scorecard</h2>
                <div class="scorecard-grid">
                    ${scorecard
                        .sort((a, b) => a.order - b.order)
                        .map(item => `
                        <div class="scorecard-item ${item.key === 'overall' ? 'scorecard-overall' : ''}" title="${item.description}">
                            <div class="scorecard-grade" style="color: ${item.color};">${item.grade}</div>
                            <div class="scorecard-label">${item.name}</div>
                            ${item.key !== 'overall' ? `<div class="scorecard-value">${item.value}</div>` : ''}
                        </div>
                    `).join('')}
                </div>
            `;
            
        } catch (error) {
            console.error('Error displaying player scorecard:', error);
            const scorecardContainer = this.containerReferences['player-scorecard'];
            if (scorecardContainer) {
                scorecardContainer.innerHTML = `
                    <h2>Player Scorecard</h2>
                    <div class="non-participant-notice">
                        <p>Failed to load player scorecard</p>
                    </div>
                `;
            }
        }
    }

    // Calculate scorecard grades based on player statistics
    calculatePlayerScorecard(stats, matches, username) {
        // Grading thresholds and logic for each characteristic
        const getGrade = (value, thresholds) => {
            if (value >= thresholds.S) return { grade: 'S', color: '#ff00ff' };
            if (value >= thresholds.A) return { grade: 'A', color: '#00ff00' };
            if (value >= thresholds.B) return { grade: 'B', color: '#4bc0c0' };
            if (value >= thresholds.C) return { grade: 'C', color: '#ffd700' };
            if (value >= thresholds.D) return { grade: 'D', color: '#ff9800' };
            return { grade: 'F', color: '#f44336' };
        };

        const scorecard = [];

        // First pass: Calculate RAW statistics
        let rawTotalKills = 0;
        let rawTotalDeaths = 0;
        let rawWins = 0;
        let rawDominantWins = 0;
        let rawCloseGames = 0;
        
        const opponentData = {}; // { opponentName: { matches, wins, kills, deaths, dominantWins } }
        
        matches.forEach(match => {
            const isWinner = match.winnerUsername === username;
            const opponent = isWinner ? match.loserUsername : match.winnerUsername;
            
            // Parse scores
            let playerScore = 0;
            let opponentScore = 0;
            
            if (isWinner) {
                playerScore = parseInt(match.winnerScore || match.score1 || match.winnerKills || 0) || 0;
                opponentScore = parseInt(match.loserScore || match.score2 || match.loserKills || 0) || 0;
            } else {
                playerScore = parseInt(match.loserScore || match.score2 || match.loserKills || 0) || 0;
                opponentScore = parseInt(match.winnerScore || match.score1 || match.winnerKills || 0) || 0;
            }
            
            const scoreDiff = Math.abs(playerScore - opponentScore);
            
            // Update raw totals
            rawTotalKills += playerScore;
            rawTotalDeaths += opponentScore;
            if (isWinner) rawWins++;
            if (isWinner && scoreDiff >= 10) rawDominantWins++;
            if (scoreDiff <= 3) rawCloseGames++;
            
            // Track per-opponent data
            if (!opponentData[opponent]) {
                opponentData[opponent] = {
                    matches: 0,
                    wins: 0,
                    kills: 0,
                    deaths: 0,
                    dominantWins: 0
                };
            }
            
            opponentData[opponent].matches++;
            if (isWinner) opponentData[opponent].wins++;
            opponentData[opponent].kills += playerScore;
            opponentData[opponent].deaths += opponentScore;
            if (isWinner && scoreDiff >= 10) opponentData[opponent].dominantWins++;
        });
        
        const totalMatches = matches.length;
        const uniqueOpponents = Object.keys(opponentData).length;
        
        // Calculate raw metrics
        const rawWinRate = totalMatches > 0 ? (rawWins / totalMatches) * 100 : 0;
        const rawAvgScore = totalMatches > 0 ? rawTotalKills / totalMatches : 0;
        const rawKdRatio = rawTotalDeaths > 0 ? rawTotalKills / rawTotalDeaths : 0;
        
        // Determine if adjustment is needed
        const MAX_MATCHES_PER_OPPONENT = 30;
        const maxMatchesAgainstOne = Math.max(...Object.values(opponentData).map(d => d.matches));
        const percentageAgainstTopOpponent = (maxMatchesAgainstOne / totalMatches) * 100;
        const needsAdjustment = percentageAgainstTopOpponent > 30;
        
        // Second pass: Calculate ADJUSTED statistics (if needed)
        let adjustedTotalKills = 0;
        let adjustedTotalDeaths = 0;
        let adjustedWins = 0;
        let adjustedTotalMatches = 0;
        let adjustedDominantWins = 0;
        
        Object.entries(opponentData).forEach(([opponent, data]) => {
            if (data.matches <= MAX_MATCHES_PER_OPPONENT) {
                // Use all matches if under the cap
                adjustedTotalMatches += data.matches;
                adjustedWins += data.wins;
                adjustedTotalKills += data.kills;
                adjustedTotalDeaths += data.deaths;
                adjustedDominantWins += data.dominantWins;
            } else {
                // Cap the contribution to MAX_MATCHES_PER_OPPONENT
                const ratio = MAX_MATCHES_PER_OPPONENT / data.matches;
                adjustedTotalMatches += MAX_MATCHES_PER_OPPONENT;
                adjustedWins += Math.round(data.wins * ratio);
                adjustedTotalKills += Math.round(data.kills * ratio);
                adjustedTotalDeaths += Math.round(data.deaths * ratio);
                adjustedDominantWins += Math.round(data.dominantWins * ratio);
            }
        });
        
        // Calculate adjusted metrics
        const adjustedWinRate = adjustedTotalMatches > 0 ? (adjustedWins / adjustedTotalMatches) * 100 : rawWinRate;
        const adjustedAvgScore = adjustedTotalMatches > 0 ? adjustedTotalKills / adjustedTotalMatches : rawAvgScore;
        const adjustedKdRatio = adjustedTotalDeaths > 0 ? adjustedTotalKills / adjustedTotalDeaths : rawKdRatio;
        
        // Decide which metrics to display
        const displayWinRate = needsAdjustment ? adjustedWinRate : rawWinRate;
        const displayAvgScore = needsAdjustment ? adjustedAvgScore : rawAvgScore;
        const displayKdRatio = needsAdjustment ? adjustedKdRatio : rawKdRatio;
        const displayDominantWins = needsAdjustment ? adjustedDominantWins : rawDominantWins;
        
        const adjustmentNote = needsAdjustment 
            ? `Adjusted statistics due to ${maxMatchesAgainstOne} matches (${percentageAgainstTopOpponent.toFixed(1)}%) against one opponent. Capped at ${MAX_MATCHES_PER_OPPONENT} matches per opponent for balanced grading.`
            : '';

        // 1. TOTAL WIN RATE
        const winRateGrade = getGrade(displayWinRate, {
            S: 95,  // 95%+
            A: 80,  // 80-94%
            B: 65,  // 65-79%
            C: 55,  // 55-64%
            D: 45   // 45-54%
        });
        
        const winRateDescription = needsAdjustment
            ? `${displayWinRate.toFixed(1)}% (Raw: ${rawWinRate.toFixed(1)}%) - ${adjustmentNote}`
            : `Overall win percentage across all matches: ${displayWinRate.toFixed(1)}%`;
        
        scorecard.push({
            key: 'winRate',
            ...winRateGrade,
            value: `${displayWinRate.toFixed(1)}%`,
            name: 'Total Win Rate',
            description: winRateDescription,
            order: 1
        });

        // 2. AVERAGE SCORE
        const scoringGrade = getGrade(displayAvgScore, {
            S: 19.0,  // 19+ avg
            A: 17.5,  // 17.5-18.9
            B: 16.0,  // 16-17.4
            C: 14.5,  // 14.5-15.9
            D: 13.0   // 13-14.4
        });
        
        const avgScoreDescription = needsAdjustment
            ? `${displayAvgScore.toFixed(1)} (Raw: ${rawAvgScore.toFixed(1)}) - ${adjustmentNote}`
            : `Average kills per match: ${displayAvgScore.toFixed(1)}`;
        
        scorecard.push({
            key: 'scoring',
            ...scoringGrade,
            value: displayAvgScore.toFixed(1),
            name: 'Average Score',
            description: avgScoreDescription,
            order: 2
        });

        // 3. OPPONENT MASTERY
        const dominantWinRate = totalMatches > 0 ? (displayDominantWins / totalMatches) * 100 : 0;
        const closeWinRate = totalMatches > 0 && rawCloseGames > 0 ? 
            (rawWins / totalMatches) * (rawCloseGames / totalMatches) * 100 : 0;
        const opponentMasteryScore = (dominantWinRate * 0.7) + (closeWinRate * 0.3);
        
        const opponentMasteryGrade = getGrade(opponentMasteryScore, {
            S: 50,  // Exceptional dominance
            A: 40,  // Strong dominance
            B: 30,  // Good control
            C: 20,  // Average
            D: 10   // Struggles
        });
        
        const masteryDescription = needsAdjustment
            ? `${displayDominantWins} dominant wins (10+ kill margin) - Raw: ${rawDominantWins}. ${adjustmentNote}`
            : `${displayDominantWins} dominant wins (10+ kill margin). Measures ability to control and dominate opponents.`;
        
        scorecard.push({
            key: 'opponentMastery',
            ...opponentMasteryGrade,
            value: `${displayDominantWins} dominant`,
            name: 'Opponent Mastery',
            description: masteryDescription,
            order: 3
        });

        // 4. MAP MASTERY
        let versatilityScore = 0;
        if (stats.mapStats.best.length > 0) {
            const avgBestMapWinRate = stats.mapStats.best.reduce((sum, m) => sum + parseFloat(m.winRate), 0) / stats.mapStats.best.length;
            const mapCount = stats.mapStats.mostPlayed.length;
            versatilityScore = (avgBestMapWinRate * 0.7) + (Math.min(mapCount, 10) * 3);
        }
        const versatilityGrade = getGrade(versatilityScore, {
            S: 95,  // Dominant across many maps
            A: 85,  // Strong on multiple maps
            B: 75,  // Good on several maps
            C: 65,  // Decent on some maps
            D: 55   // Limited map pool
        });
        
        scorecard.push({
            key: 'versatility',
            ...versatilityGrade,
            value: `${stats.mapStats.mostPlayed.length} maps`,
            name: 'Map Mastery',
            description: `Performance across ${stats.mapStats.mostPlayed.length} different maps. Higher scores indicate versatility and adaptability.`,
            order: 4
        });

        // 5. K/D RATIO
        const kdGrade = getGrade(displayKdRatio, {
            S: 1.8,  // 1.8+ K/D
            A: 1.5,  // 1.5-1.79
            B: 1.2,  // 1.2-1.49
            C: 1.0,  // 1.0-1.19
            D: 0.8   // 0.8-0.99
        });
        
        const kdDescription = needsAdjustment
            ? `${displayKdRatio.toFixed(2)} (Raw: ${rawKdRatio.toFixed(2)}) - Total kills vs opponent kills ratio. ${adjustmentNote}`
            : `${displayKdRatio.toFixed(2)} - Total kills vs opponent kills ratio across all matches.`;
        
        scorecard.push({
            key: 'kd',
            ...kdGrade,
            value: displayKdRatio.toFixed(2),
            name: 'K/D Ratio',
            description: kdDescription,
            order: 5
        });

        // Calculate OVERALL GRADE (weighted average)
        const weights = {
            winRate: 0.30,          // 30%
            scoring: 0.25,          // 25%
            opponentMastery: 0.20,  // 20%
            versatility: 0.15,      // 15%
            kd: 0.10                // 10%
        };

        const gradeToNum = { S: 100, A: 85, B: 70, C: 55, D: 40, F: 20 };
        const overallScore = scorecard.reduce((sum, item) => {
            return sum + (gradeToNum[item.grade] * (weights[item.key] || 0));
        }, 0);

        const overallGrade = getGrade(overallScore, {
            S: 95,  // Legendary
            A: 82,  // Elite
            B: 68,  // Strong
            C: 54,  // Average
            D: 40   // Below average
        });
        
        scorecard.push({
            key: 'overall',
            ...overallGrade,
            value: overallGrade.grade,
            name: 'Overall Rating',
            description: `Weighted score: Win Rate (30%), Scoring (25%), Opponent Mastery (20%), Map Mastery (15%), K/D (10%). ${needsAdjustment ? 'Adjusted for opponent distribution.' : ''}`,
            order: 6
        });

        return scorecard;
    }
}

// Create and export a singleton instance
const playerScorecardInstance = new PlayerScorecard();
export { playerScorecardInstance };