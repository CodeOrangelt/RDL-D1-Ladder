import {
    doc,
    getDoc,
    getDocs,
    updateDoc,
    query,
    collection,
    where,
    orderBy,
    limit,
    serverTimestamp,
    addDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { auth, db } from './firebase-config.js';

// Tier system configuration (hidden from players, visible to admins only)
const TIER_SYSTEM = {
    CHAMPION: { min: 90, color: '#50C878', name: 'Masters' },      // 90%+ win rate (Emerald Green)
    ELITE: { min: 80, color: '#50C878', name: 'Emerald' },         // 80-89% win rate (Emerald Green)
    VETERAN: { min: 70, color: '#FFD700', name: 'Gold' },          // 70-79% win rate (Gold)
    SKILLED: { min: 60, color: '#C0C0C0', name: 'Silver' },        // 60-69% win rate (Silver)
    ROOKIE: { min: 0, color: '#CD7F32', name: 'Bronze' }           // Below 60% win rate (Bronze)
};

// Minimum matches required for ranking
const MIN_MATCHES_FOR_RANKING = 6;

// Function to calculate team tier based on win rate
function calculateTeamTier(winRate) {
    if (winRate >= TIER_SYSTEM.CHAMPION.min) return TIER_SYSTEM.CHAMPION;
    if (winRate >= TIER_SYSTEM.ELITE.min) return TIER_SYSTEM.ELITE;
    if (winRate >= TIER_SYSTEM.VETERAN.min) return TIER_SYSTEM.VETERAN;
    if (winRate >= TIER_SYSTEM.SKILLED.min) return TIER_SYSTEM.SKILLED;
    return TIER_SYSTEM.ROOKIE;
}

// Check if current user is admin
async function isCurrentUserAdmin() {
    const user = auth.currentUser;
    if (!user) return false;
    
    try {
        const profileRef = doc(db, 'userProfiles', user.uid);
        const profileDoc = await getDoc(profileRef);
        return profileDoc.exists() && profileDoc.data().isAdmin === true;
    } catch (error) {
        console.error('Error checking admin status:', error);
        return false;
    }
}

// Add function to calculate tier-based win rates
function calculateTierWinRates(username, allMatches) {
    const tierStats = {
        M: { wins: 0, total: 0 }, // Masters
        E: { wins: 0, total: 0 }, // Emerald  
        G: { wins: 0, total: 0 }, // Gold
        S: { wins: 0, total: 0 }, // Silver
        B: { wins: 0, total: 0 }  // Bronze
    };

    allMatches.forEach(match => {
        const isWinner = match.winnerUsername === username;
        const isLoser = match.loserUsername === username;
        
        if (isWinner || isLoser) {
            // Determine opponent's tier at time of match
            const opponentUsername = isWinner ? match.loserUsername : match.winnerUsername;
            const opponentWinRate = getPlayerWinRateAtTime(opponentUsername, match.createdAt, allMatches);
            const opponentTier = calculateTeamTier(opponentWinRate);
            
            let tierKey = 'B'; // Default Bronze
            if (opponentTier.name === 'Masters') tierKey = 'M';
            else if (opponentTier.name === 'Emerald') tierKey = 'E';
            else if (opponentTier.name === 'Gold') tierKey = 'G';
            else if (opponentTier.name === 'Silver') tierKey = 'S';
            
            tierStats[tierKey].total++;
            if (isWinner) {
                tierStats[tierKey].wins++;
            }
        }
    });

    return tierStats;
}

// Helper function to get player's win rate at a specific time
function getPlayerWinRateAtTime(username, beforeDate, allMatches) {
    let wins = 0;
    let total = 0;
    
    allMatches.forEach(match => {
        if (match.createdAt <= beforeDate) {
            if (match.winnerUsername === username) {
                wins++;
                total++;
            } else if (match.loserUsername === username) {
                total++;
            }
        }
    });
    
    return total > 0 ? (wins / total) * 100 : 0;
}

// Format tier win rates for display
function formatTierWinRates(tierStats) {
    const tiers = ['M', 'E', 'G', 'S', 'B'];
    const formatted = [];
    
    tiers.forEach(tier => {
        const stats = tierStats[tier];
        if (stats.total > 0) {
            const winRate = ((stats.wins / stats.total) * 100).toFixed(0);
            formatted.push(`${tier}:${winRate}%`);
        }
    });
    
    return formatted.length > 0 ? formatted.join(' ') : 'No data';
}

// Updated fetchBatchMatchStatsDuos function to include tier breakdowns
async function fetchBatchMatchStatsDuos(usernames) {
    const matchStats = new Map();

    try {
        // Initialize stats for all players
        usernames.forEach(username => {
            matchStats.set(username, {
                totalMatches: 0,
                wins: 0,
                losses: 0,
                totalKills: 0,
                totalDeaths: 0,
                totalSuicides: 0,
                kda: 0,
                winRate: 0,
                tierWinRates: { M: { wins: 0, total: 0 }, E: { wins: 0, total: 0 }, G: { wins: 0, total: 0 }, S: { wins: 0, total: 0 }, B: { wins: 0, total: 0 } }
            });
        });

        // Get all matches from approvedMatchesDuos
        const approvedMatchesRef = collection(db, 'approvedMatchesDuos');
        const allMatches = await getDocs(approvedMatchesRef);
        const matchesArray = [];
        
        // Convert to array for easier processing
        allMatches.forEach(doc => {
            const match = { id: doc.id, ...doc.data() };
            matchesArray.push(match);
        });

        // Sort matches by date
        matchesArray.sort((a, b) => {
            const dateA = a.createdAt?.toDate?.() || new Date(a.createdAt) || new Date(0);
            const dateB = b.createdAt?.toDate?.() || new Date(b.createdAt) || new Date(0);
            return dateA - dateB;
        });

        // Process all matches for basic stats
        matchesArray.forEach(match => {
            const winnerUsername = match.winnerUsername;
            const loserUsername = match.loserUsername;

            if (usernames.includes(winnerUsername)) {
                const stats = matchStats.get(winnerUsername);
                stats.totalMatches++;
                stats.wins++;
                stats.totalKills += match.winnerKills || 0;
                stats.totalDeaths += match.winnerDeaths || 0;
                stats.totalSuicides += match.winnerSuicides || 0;
            }

            if (usernames.includes(loserUsername)) {
                const stats = matchStats.get(loserUsername);
                stats.totalMatches++;
                stats.losses++;
                stats.totalKills += match.loserKills || 0;
                stats.totalDeaths += match.loserDeaths || 0;
                stats.totalSuicides += match.loserSuicides || 0;
            }
        });

        // Calculate tier-based win rates for each player
        usernames.forEach(username => {
            const stats = matchStats.get(username);
            stats.tierWinRates = calculateTierWinRates(username, matchesArray);
            
            // Calculate overall stats
            stats.kda = stats.totalDeaths > 0 ? 
                (stats.totalKills / stats.totalDeaths).toFixed(2) : 
                stats.totalKills.toFixed(2);

            stats.winRate = stats.totalMatches > 0 ? 
                ((stats.wins / stats.totalMatches) * 100).toFixed(1) : 0;
        });

    } catch (error) {
        console.error("Error fetching batch Duos match stats:", error);
    }

    return matchStats;
}

// Optimized display function for Duos
async function displayLadderDuos(forceRefresh = false) {
    const tableBody = document.querySelector('#ladder-duos tbody');
    if (!tableBody) {
        console.error('Duos Ladder table body not found');
        return;
    }

    // Clear the table first to prevent duplicates
    tableBody.innerHTML = '<tr><td colspan="8" class="loading-cell">Loading Duos ladder data...</td></tr>';
    
    try {
        // Get all players from playersDuos collection
        const playersRef = collection(db, 'playersDuos');
        const querySnapshot = await getDocs(playersRef);
        const players = [];
        
        querySnapshot.forEach((doc) => {
            const playerData = doc.data();
            if (playerData.username) {
                players.push({
                    ...playerData,
                    id: doc.id,
                    tierValue: playerData.tierValue || 1000,
                    position: playerData.position || Number.MAX_SAFE_INTEGER,
                    hasTeam: playerData.hasTeam || false,
                    teamId: playerData.teamId || null,
                    teamName: playerData.teamName || null,
                    teammate: playerData.teammate || null,
                    teamColor: playerData.teamColor || null
                });
            }
        });

        // Get all user profiles for flags
        const profilesRef = collection(db, 'userProfiles');
        const profilesSnapshot = await getDocs(profilesRef);

        const profilesByUsername = new Map();
        profilesSnapshot.forEach((doc) => {
            const profileData = doc.data();
            if (profileData.username) {
                profilesByUsername.set(profileData.username.toLowerCase(), profileData);
            }
        });

        // Match profiles to players
        players.forEach(player => {
            const username = player.username.toLowerCase();
            if (profilesByUsername.has(username)) {
                const profile = profilesByUsername.get(username);
                if (profile.country) {
                    player.country = profile.country;
                }
            }
        });

        // Get match stats for all players
        const usernames = players.map(p => p.username);
        const matchStatsBatch = await fetchBatchMatchStatsDuos(usernames);

        // Separate teams, ranked solo players, and unranked solo players
        const teams = new Map();
        const rankedSoloPlayers = [];
        const unrankedSoloPlayers = [];

        players.forEach(player => {
            const stats = matchStatsBatch.get(player.username) || {
                totalMatches: 0, wins: 0, losses: 0,
                kda: 0, winRate: 0, totalKills: 0, totalDeaths: 0
            };
            
            // Store individual stats for the player
            player.individualStats = stats;
            
            if (player.hasTeam && player.teamId) {
                if (!teams.has(player.teamId)) {
                    teams.set(player.teamId, {
                        teamId: player.teamId,
                        teamName: player.teamName,
                        teamColor: player.teamColor,
                        players: [],
                        combinedMatches: 0,
                        combinedWins: 0,
                        combinedLosses: 0,
                        combinedKills: 0,
                        combinedDeaths: 0,
                        tierValue: 0,
                        position: Math.min(player.position || 999, teams.get(player.teamId)?.position || 999)
                    });
                }
                
                const team = teams.get(player.teamId);
                team.players.push(player);
                team.combinedMatches += stats.totalMatches;
                team.combinedWins += stats.wins;
                team.combinedLosses += stats.losses;
                team.combinedKills += stats.totalKills;
                team.combinedDeaths += stats.totalDeaths;
                team.tierValue += player.tierValue;
                
                // Update team color if not set
                if (!team.teamColor && player.teamColor) {
                    team.teamColor = player.teamColor;
                }
            } else {
                // Separate ranked and unranked solo players
                if (stats.totalMatches >= MIN_MATCHES_FOR_RANKING) {
                    player.winRate = parseFloat(stats.winRate) || 0;
                    player.matchStats = stats;
                    rankedSoloPlayers.push(player);
                } else {
                    player.winRate = parseFloat(stats.winRate) || 0;
                    player.matchStats = stats;
                    unrankedSoloPlayers.push(player);
                }
            }
        });

        // Convert teams map to array and calculate team stats
        const teamsArray = Array.from(teams.values()).map(team => {
            team.winRate = team.combinedMatches > 0 ? 
                ((team.combinedWins / team.combinedMatches) * 100) : 0;
            team.averageTierValue = team.tierValue / team.players.length;
            team.combinedKDA = team.combinedDeaths > 0 ? 
                (team.combinedKills / team.combinedDeaths) : team.combinedKills;
            return team;
        });

        // Sort teams by win rate first, then by tier value
        teamsArray.sort((a, b) => {
            if (Math.abs(a.winRate - b.winRate) > 0.1) {
                return b.winRate - a.winRate;
            }
            return b.averageTierValue - a.averageTierValue;
        });

        // Sort ranked solo players by win rate, then by matches played
        rankedSoloPlayers.sort((a, b) => {
            if (Math.abs(a.winRate - b.winRate) > 0.1) {
                return b.winRate - a.winRate;
            }
            return b.matchStats.totalMatches - a.matchStats.totalMatches;
        });

        // Sort unranked solo players by matches played (closest to 6 at top)
        unrankedSoloPlayers.sort((a, b) => {
            return b.matchStats.totalMatches - a.matchStats.totalMatches;
        });

        // Update display
        await updateLadderDisplayDuos({ 
            teams: teamsArray, 
            rankedSoloPlayers, 
            unrankedSoloPlayers 
        });
        
        // Re-initialize event listeners after the table is updated
        setTimeout(() => {
            setupTeamInvitationSystem();
        }, 100);

    } catch (error) {
        console.error("Error loading Duos ladder:", error);
        tableBody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; color: red;">
                    Error loading Duos ladder data: ${error.message}
                </td>
            </tr>
        `;
    }
}

// Updated display function
async function updateLadderDisplayDuos(ladderData) {
    const tbody = document.querySelector('#ladder-duos tbody');
    if (!tbody) {
        console.error('Duos Ladder table body not found');
        return;
    }

    const isAdmin = await isCurrentUserAdmin();

    // Update the table header based on admin status
    const thead = document.querySelector('#ladder-duos thead tr');
    if (thead) {
        if (isAdmin) {
            thead.innerHTML = `
                <th>Rank</th>
                <th>Team/Player</th>
                <th>Status</th>
                <th>Tier Value</th>
                <th>Win Rate</th>
                <th>Matches</th>
                <th>Wins</th>
                <th>Losses</th>
                <th>K/D</th>
            `;
        } else {
            thead.innerHTML = `
                <th>Rank</th>
                <th>Team/Player</th>
                <th>Status</th>
                <th>Win Rate</th>
                <th>Matches</th>
                <th>Wins</th>
                <th>Losses</th>
                <th>K/D</th>
            `;
        }
    }

    let rowsHtml = '';
    let currentRank = 1;

    // Display teams first
    if (ladderData.teams && ladderData.teams.length > 0) {
        ladderData.teams.forEach(team => {
            rowsHtml += createTeamRow(team, currentRank, isAdmin);
            currentRank++;
        });
    }

    // Add separator for ranked solo players
    if (ladderData.rankedSoloPlayers && ladderData.rankedSoloPlayers.length > 0) {
        if (ladderData.teams && ladderData.teams.length > 0) {
            rowsHtml += `
                <tr class="separator-row">
                    <td colspan="${isAdmin ? '9' : '8'}" style="text-align: center; background-color: #2c2c2c; color: #888; padding: 10px; font-style: italic;">
                        Ranked Solo Players (${MIN_MATCHES_FOR_RANKING}+ matches)
                    </td>
                </tr>
            `;
        }

        ladderData.rankedSoloPlayers.forEach(player => {
            rowsHtml += createPlayerRowDuos(player, player.matchStats, currentRank, isAdmin, true);
            currentRank++;
        });
    }

    // Add separator for unranked solo players
    if (ladderData.unrankedSoloPlayers && ladderData.unrankedSoloPlayers.length > 0) {
        rowsHtml += `
            <tr class="separator-row">
                <td colspan="${isAdmin ? '9' : '8'}" style="text-align: center; background-color: #2c2c2c; color: #888; padding: 8px; font-style: italic;">
                    Players Under Evaluation (Less than ${MIN_MATCHES_FOR_RANKING} matches)
                </td>
            </tr>
        `;

        ladderData.unrankedSoloPlayers.forEach(player => {
            rowsHtml += createPlayerRowDuos(player, player.matchStats, '?', isAdmin, false);
        });
    }

    tbody.innerHTML = rowsHtml;
}

// Updated createTeamRow function with better spacing and alignment
// Updated createTeamRow function - changing the link to team.html
function createTeamRow(team, rank, isAdmin = false) {
    const tier = calculateTeamTier(team.winRate);
    const winRateFormatted = team.winRate.toFixed(1);

    let streakHtml = '';
    if (rank === 1) {
        streakHtml = `<span class="streak-indicator" title="Team at #1">👑</span>`;
    }

    const tierValueCell = isAdmin ? `<td style="color: #888; font-size: 0.9em; padding: 8px;">${Math.round(team.averageTierValue)}</td>` : '';

    // Calculate combined tier win rates for the team
    const combinedTierStats = { M: { wins: 0, total: 0 }, E: { wins: 0, total: 0 }, G: { wins: 0, total: 0 }, S: { wins: 0, total: 0 }, B: { wins: 0, total: 0 } };
    team.players.forEach(player => {
        if (player.individualStats?.tierWinRates) {
            Object.keys(combinedTierStats).forEach(tier => {
                combinedTierStats[tier].wins += player.individualStats.tierWinRates[tier].wins;
                combinedTierStats[tier].total += player.individualStats.tierWinRates[tier].total;
            });
        }
    });
    const teamTierBreakdown = formatTierWinRates(combinedTierStats);

    // Create team header row - CHANGED: Link now points to team.html instead of profile.html
    let teamHtml = `
    <tr class="team-row team-header">
        <td rowspan="${team.players.length + 1}" style="padding: 10px 8px; vertical-align: middle;">${rank}</td>
        <td style="position: relative; padding: 8px;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 2px;">
                <a href="team.html?team=${encodeURIComponent(team.teamId)}&ladder=duos" 
                   style="color: ${team.teamColor || tier.color}; text-decoration: none; font-weight: bold; font-size: 1em;">
                    ${team.teamName}
                </a>
                ${streakHtml}
            </div>
        </td>
        <td style="color: ${tier.color}; font-weight: bold; padding: 8px;">${tier.name}</td>
        ${tierValueCell}
        <td style="color: ${tier.color}; font-weight: bold; padding: 8px;">
            <div style="margin-bottom: 3px;">${winRateFormatted}%</div>
            <div style="font-size: 0.75em; color: #888; line-height: 1.2;">${teamTierBreakdown}</div>
        </td>
        <td style="padding: 8px;">${team.combinedMatches}</td>
        <td style="padding: 8px;">${team.combinedWins}</td>
        <td style="padding: 8px;">${team.combinedLosses}</td>
        <td style="padding: 8px;">${team.combinedKDA.toFixed(2)}</td>
    </tr>`;

    // Add compact player rows
    team.players.forEach((player, index) => {
        const stats = player.individualStats || {
            totalMatches: 0, wins: 0, losses: 0,
            kda: 0, winRate: 0, totalKills: 0, totalDeaths: 0,
            tierWinRates: { M: { wins: 0, total: 0 }, E: { wins: 0, total: 0 }, G: { wins: 0, total: 0 }, S: { wins: 0, total: 0 }, B: { wins: 0, total: 0 } }
        };

        const playerTierBreakdown = formatTierWinRates(stats.tierWinRates);

        let flagHtml = '';
        if (player.country) {
            flagHtml = `<img src="../images/flags/${player.country.toLowerCase()}.png" 
                            alt="${player.country}" 
                            class="player-flag" 
                            style="margin-left: 6px; vertical-align: middle; width: 16px; height: 12px;"
                            onerror="this.style.display='none'">`;
        }

        const playerTierValueCell = isAdmin ? `<td style="color: #666; font-size: 0.85em; padding: 6px 8px;">${player.tierValue}</td>` : '';

        teamHtml += `
        <tr class="team-player-row">
            <td style="padding: 6px 8px 6px 20px; font-size: 0.9em;">
                <div style="display: flex; align-items: center;">
                    <span style="color: #666; margin-right: 6px;">└</span>
                    <a href="profile.html?username=${encodeURIComponent(player.username)}&ladder=duos" 
                       style="color: ${team.teamColor || '#bbb'}; text-decoration: none;">
                        ${player.username}
                    </a>
                    ${flagHtml}
                </div>
            </td>
            <td style="color: #777; font-size: 0.8em; font-style: italic; padding: 6px 8px;">Member</td>
            ${playerTierValueCell}
            <td style="color: #ccc; font-size: 0.9em; padding: 6px 8px;">
                <div style="margin-bottom: 2px;">${stats.winRate}%</div>
                <div style="font-size: 0.75em; color: #666; line-height: 1.2;">${playerTierBreakdown}</div>
            </td>
            <td style="font-size: 0.9em; padding: 6px 8px;">${stats.totalMatches}</td>
            <td style="font-size: 0.9em; padding: 6px 8px;">${stats.wins}</td>
            <td style="font-size: 0.9em; padding: 6px 8px;">${stats.losses}</td>
            <td style="font-size: 0.9em; padding: 6px 8px;">${stats.kda}</td>
        </tr>`;
    });

    return teamHtml;
}

// Updated createPlayerRowDuos function with compact mode for unranked players
function createPlayerRowDuos(player, stats, rank, isAdmin = false, isRanked = true) {
    const winRate = parseFloat(stats.winRate) || 0;
    const tier = isRanked ? calculateTeamTier(winRate) : { color: '#666', name: 'Unranked' };
    const tierBreakdown = formatTierWinRates(stats.tierWinRates || {});

    // Create flag HTML
    let flagHtml = '';
    if (player.country) {
        const flagSize = isRanked ? 'width: 16px; height: 12px;' : 'width: 12px; height: 9px;';
        flagHtml = `<img src="../images/flags/${player.country.toLowerCase()}.png" 
                        alt="${player.country}" 
                        class="player-flag" 
                        style="margin-left: ${isRanked ? '8px' : '4px'}; vertical-align: middle; ${flagSize}"
                        onerror="this.style.display='none'">`;
    }

    const tierValueCell = isAdmin ? `<td style="color: #888; font-size: ${isRanked ? '0.9em' : '0.8em'}; padding: ${isRanked ? '8px' : '4px'};">${player.tierValue}</td>` : '';

    let statusText = '';
    if (!isRanked) {
        const matchesNeeded = MIN_MATCHES_FOR_RANKING - stats.totalMatches;
        statusText = `<span style="color: #ffa500; font-size: 1.0em; font-style: italic; margin-left: 4px;">(${matchesNeeded} more)</span>`;
    } else {
        statusText = `<span style="margin-left: 8px; color: #888; font-size: 0.85em; font-style: italic;">Looking for team</span>`;
    }

    // Add team invite button for solo players (smaller for unranked)
    const inviteButton = isRanked ? createTeamInviteButton(player.username) : createCompactTeamInviteButton(player.username);

    const displayWinRate = isRanked ? `${winRate}%` : `${winRate}%*`;

    // Compact styling for unranked players
    if (!isRanked) {
        return `
        <tr class="solo-player-row unranked-player compact-row">
            <td style="padding: 3px 4px; font-size: 1.2em;">${rank}</td>
            <td style="position: relative; padding: 3px 4px;">
                <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 2px;">
                    <a href="profile.html?username=${encodeURIComponent(player.username)}&ladder=duos" 
                       style="color: ${tier.color}; text-decoration: none; font-weight: 400; font-size: 1.1em;">
                        ${player.username}
                    </a>
                    ${flagHtml}
                    ${statusText}
                    ${inviteButton}
                </div>
            </td>
            <td style="color: ${tier.color}; font-weight: normal; padding: 3px 4px; font-size: 0.8em;">${tier.name}</td>
            ${tierValueCell}
            <td style="color: ${tier.color}; font-weight: normal; padding: 3px 4px; font-size: 0.8em;">
                ${displayWinRate}
            </td>
            <td style="padding: 8px;">${stats.totalMatches}</td>
            <td style="padding: 8px;">${stats.wins}</td>
            <td style="padding: 8px;">${stats.losses}</td>
            <td style="padding: 8px;">${stats.kda}</td>
        </tr>`;
    }
    // Normal styling for ranked players
    return `
    <tr class="solo-player-row">
        <td style="padding: 8px;">${rank}</td>
        <td style="position: relative; padding: 8px;">
            <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 4px;">
                <a href="profile.html?username=${encodeURIComponent(player.username)}&ladder=duos" 
                   style="color: ${tier.color}; text-decoration: none; font-weight: 500;">
                    ${player.username}
                </a>
                ${flagHtml}
                ${statusText}
                ${inviteButton}
            </div>
        </td>
        <td style="color: ${tier.color}; font-weight: bold; padding: 8px;">${tier.name}</td>
        ${tierValueCell}
        <td style="color: ${tier.color}; font-weight: bold; padding: 8px;">
            <div style="margin-bottom: 3px;">${displayWinRate}</div>
            <div style="font-size: 0.75em; color: #888; line-height: 1.2;">${tierBreakdown}</div>
        </td>
        <td style="padding: 8px;">${stats.totalMatches}</td>
        <td style="padding: 8px;">${stats.wins}</td>
        <td style="padding: 8px;">${stats.losses}</td>
        <td style="padding: 8px;">${stats.kda}</td>
    </tr>`;
}

// Function to send team invitation
async function sendTeamInvitation(fromUsername, toUsername, teamName, teamColor) {
    try {
        const user = auth.currentUser;
        if (!user) {
            throw new Error('You must be logged in to send invitations');
        }

        // Get the target user's UID from their username
        const toUserProfile = await findUserByUsername(toUsername);
        if (!toUserProfile) {
            throw new Error('Player not found');
        }

        // Check if target user is already on a team
        const playersRef = collection(db, 'playersDuos');
        const targetPlayerQuery = query(playersRef, where('username', '==', toUsername));
        const targetPlayerSnapshot = await getDocs(targetPlayerQuery);
        
        if (!targetPlayerSnapshot.empty) {
            const targetPlayerData = targetPlayerSnapshot.docs[0].data();
            if (targetPlayerData.hasTeam) {
                throw new Error('This player is already on a team');
            }
        }

        // Check if sender is already on a team
        const senderPlayerQuery = query(playersRef, where('username', '==', fromUsername));
        const senderPlayerSnapshot = await getDocs(senderPlayerQuery);
        
        if (!senderPlayerSnapshot.empty) {
            const senderPlayerData = senderPlayerSnapshot.docs[0].data();
            if (senderPlayerData.hasTeam) {
                throw new Error('You are already on a team');
            }
        }

        // Create the invitation document
        const invitationData = {
            type: 'team_invite',
            fromUserId: user.uid,
            fromUsername: fromUsername,
            toUserId: toUserProfile.uid,
            toUsername: toUsername,
            status: 'pending',
            createdAt: serverTimestamp(),
            message: `${fromUsername} has invited you to form a team in the Duos ladder!`,
            teamData: {
                proposedTeamName: teamName,
                teamColor: teamColor,
                ladder: 'duos'
            }
        };

        // Add to gameInvitations collection (reusing existing system)
        const invitationsRef = collection(db, 'gameInvitations');
        await addDoc(invitationsRef, invitationData);

        return { success: true, message: 'Team invitation sent successfully!' };
    } catch (error) {
        console.error('Error sending team invitation:', error);
        return { success: false, error: error.message };
    }
}

// Helper function to find user by username
async function findUserByUsername(username) {
    try {
        const profilesRef = collection(db, 'userProfiles');
        const userQuery = query(profilesRef, where('username', '==', username));
        const userSnapshot = await getDocs(userQuery);
        
        if (userSnapshot.empty) {
            return null;
        }
        
        const userDoc = userSnapshot.docs[0];
        return {
            uid: userDoc.id,
            ...userDoc.data()
        };
    } catch (error) {
        console.error('Error finding user:', error);
        return null;
    }
}

// Function to create team invite button for each solo player
function createTeamInviteButton(playerUsername) {
    const user = auth.currentUser;
    if (!user) return '';

    return `
        <button class="team-invite-btn" 
                data-target-username="${playerUsername}"
                title="Invite ${playerUsername} to form a team"
                type="button">
            <i class="fas fa-user-plus"></i> Invite
        </button>
    `;
}

// Create compact team invite button for unranked players
function createCompactTeamInviteButton(playerUsername) {
    const user = auth.currentUser;
    if (!user) return '';

    return `
        <button class="team-invite-btn compact" 
                data-target-username="${playerUsername}"
                title="Invite ${playerUsername} to form a team"
                type="button">
            <i class="fas fa-user-plus"></i>
        </button>
    `;
}

// Setup team invitation system with all styles
function setupTeamInvitationSystem() {
    // Add CSS for team invite buttons and modal
    if (!document.getElementById('team-invite-styles')) {
        const styleEl = document.createElement('style');
        styleEl.id = 'team-invite-styles';
        styleEl.textContent = `
            .team-invite-btn {
                background: #4CAF50;
                color: white;
                border: none;
                padding: 4px 8px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 0.75em;
                margin-left: 8px;
                transition: background-color 0.3s;
                display: inline-flex;
                align-items: center;
                gap: 3px;
                white-space: nowrap;
            }
            
            .team-invite-btn.compact {
                padding: 2px 4px;
                font-size: 0.65em;
                margin-left: 4px;
                gap: 1px;
            }
            
            .team-invite-btn:hover {
                background: #45a049;
            }
            
            .team-invite-btn:disabled {
                background: #666;
                cursor: not-allowed;
            }
            
            .team-creation-modal {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.8);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 1000;
            }
            
            .team-creation-content {
                background: #2a2a2a;
                border-radius: 8px;
                width: 90%;
                max-width: 500px;
                padding: 2rem;
                color: white;
            }
            
            .color-picker {
                display: grid;
                grid-template-columns: repeat(6, 1fr);
                gap: 0.5rem;
                margin: 1rem 0;
            }
            
            .color-option {
                width: 40px;
                height: 40px;
                border-radius: 50%;
                border: 3px solid transparent;
                cursor: pointer;
                transition: border-color 0.3s;
            }
            
            .color-option.selected {
                border-color: white;
            }
            
            .form-group {
                margin-bottom: 1rem;
            }
            
            .form-group label {
                display: block;
                margin-bottom: 0.5rem;
                color: #ccc;
            }
            
            .form-group input {
                width: 100%;
                padding: 0.5rem;
                background: #1a1a1a;
                border: 1px solid #444;
                color: white;
                border-radius: 4px;
                box-sizing: border-box;
            }
            
            .team-header {
                background-color: rgba(255, 255, 255, 0.03);
                border-left: 3px solid rgba(255, 255, 255, 0.2);
            }
            
            .team-player-row {
                background-color: rgba(0, 0, 0, 0.15);
                border-left: 3px solid rgba(255, 255, 255, 0.1);
            }
            
            .team-player-row:hover {
                background-color: rgba(255, 255, 255, 0.08);
            }
            
            .team-header:hover {
                background-color: rgba(255, 255, 255, 0.08);
            }
            
            .team-row td {
                border-bottom: 1px solid #333;
                vertical-align: middle;
            }
            
            .team-player-row td {
                border-bottom: 1px solid #222;
            }
            
            .solo-player-row td {
                padding: 8px;
                vertical-align: middle;
                border-bottom: 1px solid #333;
            }
            
            /* Even more compact styling for unranked players */
            .compact-row td {
                padding: 3px 4px !important;
                font-size: 0.75em !important;
                border-bottom: 1px solid #2a2a2a !important;
                line-height: 1.2 !important;
            }
            
            .compact-row {
                background-color: rgba(0, 0, 0, 0.25) !important;
                height: 28px !important;
            }
            
            .compact-row:hover {
                background-color: rgba(255, 255, 255, 0.03) !important;
            }
            
            .separator-row td {
                padding: 8px !important;
                text-align: center;
                background-color: #2c2c2c;
                color: #888;
                font-style: italic;
                border-bottom: 2px solid #444 !important;
            }
            
            #ladder-duos tbody tr:hover {
                background-color: rgba(255, 255, 255, 0.05);
            }
            
            .separator-row:hover {
                background-color: #2c2c2c !important;
            }
            
            /* Ensure consistent table cell alignment */
            #ladder-duos td {
                text-align: center;
                vertical-align: middle;
            }
            
            #ladder-duos td:nth-child(2) {
                text-align: left;
            }
            
            #ladder-duos th {
                padding: 12px 8px;
                text-align: center;
                border-bottom: 2px solid #444;
            }
            
            #ladder-duos th:nth-child(2) {
                text-align: left;
            }
        `;
        document.head.appendChild(styleEl);
    }
    
    // Remove any existing event listeners to prevent duplicates
    document.removeEventListener('click', handleTeamInviteClick);
    
    // Add the event listener
    document.addEventListener('click', handleTeamInviteClick);
    
    console.log('Team invitation system initialized');
}

// Separate click handler function
function handleTeamInviteClick(e) {
    if (e.target.closest('.team-invite-btn')) {
        e.preventDefault();
        e.stopPropagation();
        
        const btn = e.target.closest('.team-invite-btn');
        const targetUsername = btn.dataset.targetUsername;
        
        console.log('Team invite button clicked for:', targetUsername);
        
        // Disable button temporarily to prevent double clicks
        btn.disabled = true;
        setTimeout(() => {
            btn.disabled = false;
        }, 1000);
        
        openTeamCreationModal(targetUsername);
    }
}

// Updated modal opening function with better error handling
async function openTeamCreationModal(targetUsername) {
    console.log('Opening team creation modal for:', targetUsername);
    
    const user = auth.currentUser;
    if (!user) {
        alert('You must be logged in to send team invitations');
        return;
    }

    try {
        // Get current user's username and check if it's the same as target
        const currentUsername = await getCurrentUserUsername();
        if (!currentUsername) {
            alert('Please set up your profile before sending invitations');
            return;
        }

        if (currentUsername === targetUsername) {
            alert('You cannot invite yourself!');
            return;
        }

        // Check if current user is already on a team
        const playersRef = collection(db, 'playersDuos');
        const currentPlayerQuery = query(playersRef, where('username', '==', currentUsername));
        const currentPlayerSnapshot = await getDocs(currentPlayerQuery);
        
        if (!currentPlayerSnapshot.empty) {
            const currentPlayerData = currentPlayerSnapshot.docs[0].data();
            if (currentPlayerData.hasTeam) {
                alert('You are already on a team! Leave your current team before creating a new one.');
                return;
            }
        }

        // Create modal
        const modal = document.createElement('div');
        modal.className = 'team-creation-modal';
        modal.innerHTML = `
            <div class="team-creation-content">
                <h3 style="margin-top: 0; color: white;">Invite ${targetUsername} to Form a Team</h3>
                
                <div class="form-group">
                    <label for="team-name">Team Name:</label>
                    <input type="text" 
                           id="team-name" 
                           placeholder="Enter team name..." 
                           value="${currentUsername} & ${targetUsername}"
                           maxlength="50">
                </div>
                
                <div class="form-group">
                    <label>Team Color:</label>
                    <div class="color-picker">
                        <div class="color-option selected" data-color="#FFD700" style="background: #FFD700;" title="Gold"></div>
                        <div class="color-option" data-color="#50C878" style="background: #50C878;" title="Emerald"></div>
                        <div class="color-option" data-color="#FF6B6B" style="background: #FF6B6B;" title="Red"></div>
                        <div class="color-option" data-color="#4ECDC4" style="background: #4ECDC4;" title="Teal"></div>
                        <div class="color-option" data-color="#C0C0C0" style="background: #C0C0C0;" title="Silver"></div>
                        <div class="color-option" data-color="#FF8C42" style="background: #FF8C42;" title="Orange"></div>
                        <div class="color-option" data-color="#A8E6CF" style="background: #A8E6CF;" title="Mint"></div>
                        <div class="color-option" data-color="#FF87AB" style="background: #FF87AB;" title="Pink"></div>
                        <div class="color-option" data-color="#B19CD9" style="background: #B19CD9;" title="Purple"></div>
                        <div class="color-option" data-color="#87CEEB" style="background: #87CEEB;" title="Sky Blue"></div>
                        <div class="color-option" data-color="#DDA0DD" style="background: #DDA0DD;" title="Plum"></div>
                        <div class="color-option" data-color="#F0E68C" style="background: #F0E68C;" title="Khaki"></div>
                    </div>
                </div>
                
                <div class="form-group">
                    <label>Preview:</label>
                    <div id="team-preview" style="padding: 1rem; background: #1a1a1a; border-radius: 4px; color: #FFD700;">
                        <strong id="preview-name">${currentUsername} & ${targetUsername}</strong>
                    </div>
                </div>
                
                <div style="display: flex; gap: 1rem; justify-content: flex-end; margin-top: 2rem;">
                    <button id="cancel-team-invite" style="background: #666; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer;">
                        Cancel
                    </button>
                    <button id="send-team-invite" style="background: #4CAF50; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer;">
                        Send Invitation
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Setup modal event listeners
        let selectedColor = '#FFD700'; // Default gold

        // Color picker functionality
        modal.querySelectorAll('.color-option').forEach(option => {
            option.addEventListener('click', () => {
                modal.querySelectorAll('.color-option').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
                selectedColor = option.dataset.color;
                updatePreview();
            });
        });

        // Team name input
        const teamNameInput = modal.querySelector('#team-name');
        teamNameInput.addEventListener('input', updatePreview);

        // Preview update function
        function updatePreview() {
            const previewName = modal.querySelector('#preview-name');
            const previewContainer = modal.querySelector('#team-preview');
            previewName.textContent = teamNameInput.value || `${currentUsername} & ${targetUsername}`;
            previewContainer.style.color = selectedColor;
        }

        // Cancel button
        modal.querySelector('#cancel-team-invite').addEventListener('click', () => {
            modal.remove();
        });

        // Send invitation button
        modal.querySelector('#send-team-invite').addEventListener('click', async () => {
            const teamName = teamNameInput.value.trim() || `${currentUsername} & ${targetUsername}`;
            
            if (teamName.length < 3) {
                alert('Team name must be at least 3 characters long');
                return;
            }

            const sendBtn = modal.querySelector('#send-team-invite');
            sendBtn.disabled = true;
            sendBtn.textContent = 'Sending...';

            try {
                const result = await sendTeamInvitation(currentUsername, targetUsername, teamName, selectedColor);
                
                if (result.success) {
                    alert('Team invitation sent successfully!');
                    modal.remove();
                } else {
                    alert(`Error: ${result.error}`);
                    sendBtn.disabled = false;
                    sendBtn.textContent = 'Send Invitation';
                }
            } catch (error) {
                console.error('Error sending invitation:', error);
                alert('Failed to send invitation. Please try again.');
                sendBtn.disabled = false;
                sendBtn.textContent = 'Send Invitation';
            }
        });

        // Close on outside click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });

    } catch (error) {
        console.error('Error opening team creation modal:', error);
        alert('Failed to open team creation form. Please try again.');
    }
}

// Helper function to get current user's username
async function getCurrentUserUsername() {
    const user = auth.currentUser;
    if (!user) return null;

    try {
        const profileRef = doc(db, 'userProfiles', user.uid);
        const profileDoc = await getDoc(profileRef);
        
        if (profileDoc.exists()) {
            return profileDoc.data().username;
        }
        return null;
    } catch (error) {
        console.error('Error getting username:', error);
        return null;
    }
}

// Updated position update function using tier values instead of ELO
async function updatePlayerPositionsDuos(winnerUsername, loserUsername) {
    try {
        const playersRef = collection(db, 'playersDuos');
        const querySnapshot = await getDocs(playersRef);
        const players = [];
        
        querySnapshot.forEach((doc) => {
            players.push({
                id: doc.id,
                ...doc.data()
            });
        });

        const winner = players.find(p => p.username === winnerUsername);
        const loser = players.find(p => p.username === loserUsername);

        if (!winner || !loser) {
            console.error("Could not find winner or loser in Duos players list");
            return;
        }

        // Calculate tier value changes based on win/loss
        const tierValueChange = calculateTierValueChange(winner.tierValue || 1000, loser.tierValue || 1000);
        
        // Update tier values
        await updateDoc(doc(db, 'playersDuos', winner.id), {
            tierValue: (winner.tierValue || 1000) + tierValueChange.winner
        });
        
        await updateDoc(doc(db, 'playersDuos', loser.id), {
            tierValue: Math.max(500, (loser.tierValue || 1000) + tierValueChange.loser) // Minimum tier value of 500
        });

        // Handle position updates based on new tier values and win rates
        // Positions will be recalculated when the ladder refreshes based on win rates
        console.log(`Updated tier values: ${winnerUsername} +${tierValueChange.winner}, ${loserUsername} ${tierValueChange.loser}`);
        
    } catch (error) {
        console.error("Error updating Duos player positions:", error);
    }
}

// Calculate tier value changes (similar to ELO but simpler)
function calculateTierValueChange(winnerTier, loserTier) {
    const K = 25; // Adjustment factor
    const expectedScore = 1 / (1 + Math.pow(10, (loserTier - winnerTier) / 400));
    
    const winnerChange = Math.round(K * (1 - expectedScore));
    const loserChange = Math.round(K * (0 - (1 - expectedScore)));
    
    return {
        winner: Math.max(1, winnerChange), // Minimum +1 for winner
        loser: Math.min(-1, loserChange)   // Maximum -1 for loser
    };
}

// Team creation function (improved)
async function createTeam(player1Username, player2Username, teamName = null, teamColor = '#FFD700') {
    try {
        const teamId = `team_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const finalTeamName = teamName || `${player1Username} & ${player2Username}`;
        
        const playersRef = collection(db, 'playersDuos');
        const player1Query = query(playersRef, where('username', '==', player1Username));
        const player2Query = query(playersRef, where('username', '==', player2Username));
        
        const [player1Snapshot, player2Snapshot] = await Promise.all([
            getDocs(player1Query),
            getDocs(player2Query)
        ]);
        
        if (player1Snapshot.empty || player2Snapshot.empty) {
            throw new Error('One or both players not found in Duos ladder');
        }
        
        const player1Doc = player1Snapshot.docs[0];
        const player2Doc = player2Snapshot.docs[0];
        
        // Check if either player is already on a team
        if (player1Doc.data().hasTeam || player2Doc.data().hasTeam) {
            throw new Error('One or both players are already on a team');
        }
        
        await Promise.all([
            updateDoc(player1Doc.ref, {
                teamId: teamId,
                teamName: finalTeamName,
                teammate: player2Username,
                hasTeam: true,
                teamColor: teamColor
            }),
            updateDoc(player2Doc.ref, {
                teamId: teamId,
                teamName: finalTeamName,
                teammate: player1Username,
                hasTeam: true,
                teamColor: teamColor
            })
        ]);
        
        return { success: true, teamId, teamName: finalTeamName };
    } catch (error) {
        console.error('Error creating team:', error);
        return { success: false, error: error.message };
    }
}

// Fix the getCurrentUserProfile function issue
async function getCurrentUserProfile() {
    const user = auth.currentUser;
    if (!user) return null;

    try {
        const profileRef = doc(db, 'userProfiles', user.uid);
        const profileDoc = await getDoc(profileRef);
        
        if (profileDoc.exists()) {
            return profileDoc.data();
        }
        return null;
    } catch (error) {
        console.error('Error getting user profile:', error);
        return null;
    }
}

// Export all the functions
export { 
    displayLadderDuos, 
    updatePlayerPositionsDuos, 
    sendTeamInvitation, 
    setupTeamInvitationSystem,
    createTeam 
};