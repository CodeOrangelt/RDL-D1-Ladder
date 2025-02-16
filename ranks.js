export const RANKS = {
    UNRANKED: { threshold: 0, color: '#808080', name: 'Unranked' },    // Gray for unranked
    BRONZE: { threshold: 1400, color: '#CD7F32', name: 'Bronze' },     // Bronze
    SILVER: { threshold: 1600, color: '#C0C0C0', name: 'Silver' },     // Silver
    GOLD: { threshold: 1800, color: '#FFD700', name: 'Gold' },         // Gold
    EMERALD: { threshold: 2100, color: '#50C878', name: 'Emerald' }    // Emerald
};

export function getRankStyle(eloRating) {
    if (eloRating >= RANKS.EMERALD.threshold) return RANKS.EMERALD;
    if (eloRating >= RANKS.GOLD.threshold) return RANKS.GOLD;
    if (eloRating >= RANKS.SILVER.threshold) return RANKS.SILVER;
    if (eloRating >= RANKS.BRONZE.threshold) return RANKS.BRONZE;
    return RANKS.UNRANKED;
}