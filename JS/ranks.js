export const RANKS = {
    UNRANKED: { threshold: 0, color: '#DC143C', name: 'Unranked' },
    BRONZE: { threshold: 200, color: '#CD7F32', name: 'Bronze' },
    SILVER: { threshold: 500, color: '#C0C0C0', name: 'Silver' },
    GOLD: { threshold: 700, color: '#FFD700', name: 'Gold' },
    EMERALD: { threshold: 1000, color: '#50C878', name: 'Emerald' }
};

export function getRankStyle(eloRating, matchCount = 0, winRate = 0) {
    // Unranked if no matches played
    if (matchCount === 0) return RANKS.UNRANKED;

    // Standard tier checks
    if (eloRating < 200) return RANKS.UNRANKED;
    if (eloRating < 500) return RANKS.BRONZE;
    if (eloRating < 700) return RANKS.SILVER;
    if (eloRating < 1000) return RANKS.GOLD;

    // Special Emerald tier check
    // Only award if winRate >= 80% and matchCount >= 20
    if (eloRating >= 1000 && winRate >= 80 && matchCount >= 20) {
        return RANKS.EMERALD;
    }

    // Default to Gold if Emerald requirements not met
    return RANKS.GOLD;
}