export const RANKS = {
    UNRANKED: { threshold: 0, color: '#DC143C', name: 'Unranked' },
    BRONZE: { threshold: 200, color: '#CD7F32', name: 'Bronze' },
    SILVER: { threshold: 500, color: '#C0C0C0', name: 'Silver' },
    GOLD: { threshold: 700, color: '#FFD700', name: 'Gold' },
    EMERALD: { threshold: 1000, color: '#50C878', name: 'Emerald' }
};

export function getRankStyle(eloRating, matchCount = null, winRate = 0) {
    // If matchCount is known and less than 5, always Unranked
    // (Unranked = less than 5 matches on record)
    if (matchCount !== null && matchCount < 5) {
        return RANKS.UNRANKED;
    }

    // If matchCount is known and >= 5, minimum Bronze rank
    // (Being "ranked" requires 5+ matches)
    if (matchCount !== null && matchCount >= 5 && eloRating < 500) {
        return RANKS.BRONZE;
    }

    // Standard tier checks based on ELO
    // When matchCount is unknown (old match data), be lenient:
    // - Only return Unranked for 0 ELO (truly unranked)
    // - Assume anyone with >0 ELO has played enough matches for Bronze minimum
    if (matchCount === null) {
        // Unknown match count - use lenient fallback
        if (eloRating === 0) return RANKS.UNRANKED;  // 0 ELO = definitely unranked
        if (eloRating < 500) return RANKS.BRONZE;    // Low ELO but has played = Bronze
        if (eloRating < 700) return RANKS.SILVER;
        if (eloRating < 1000) return RANKS.GOLD;
        return RANKS.GOLD;  // 1000+ but no match count = can't verify Emerald
    }
    
    // Match count is known - use strict thresholds
    if (eloRating < 500) return RANKS.BRONZE;  // Should already be caught above, but safety
    if (eloRating < 700) return RANKS.SILVER;
    if (eloRating < 1000) return RANKS.GOLD;

    // Special Emerald tier check (only if matchCount and winRate are known)
    // Only award if winRate >= 80% and matchCount >= 20
    if (eloRating >= 1000 && matchCount !== null && winRate >= 80 && matchCount >= 20) {
        return RANKS.EMERALD;
    }

    // Default to Gold if Emerald requirements not met
    return RANKS.GOLD;
}