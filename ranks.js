export const RANKS = {
    UNRANKED: { threshold: 0, color: '#808080', name: 'Unranked' },    // Gray (<1400)
    BRONZE: { threshold: 1400, color: '#CD7F32', name: 'Bronze' },     // Bronze (1400-1599)
    SILVER: { threshold: 1600, color: '#C0C0C0', name: 'Silver' },     // Silver (1600-1799)
    GOLD: { threshold: 1800, color: '#FFD700', name: 'Gold' },         // Gold (1800-2099)
    EMERALD: { threshold: 2100, color: '#50C878', name: 'Emerald' }    // Emerald (2100+)
};

export function getRankStyle(eloRating) {
    if (!eloRating || eloRating < 1400) return RANKS.UNRANKED;    // Gray for under 1400
    if (eloRating < 1600) return RANKS.BRONZE;                    // Bronze for 1400-1599
    if (eloRating < 1800) return RANKS.SILVER;                   // Silver for 1600-1799
    if (eloRating < 2100) return RANKS.GOLD;                     // Gold for 1800-2099
    return RANKS.EMERALD;                                        // Emerald for 2100+
}