import {
  collection,
  getDocs,
  addDoc,
  query,
  orderBy,
  limit,
  startAfter,
  Timestamp,
  serverTimestamp,
  getDoc,
  doc,
  where,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

import { getRankStyle } from './ranks.js';

const mutedUsers = [
   //unmuted 10/28/2025, forgot to unmute, but no mention from player. 
   // { username: "Daz", muteFromDate: new Date("2025-07-02").getTime() }, // muted for 60 days. Varibale, depends on Behavior.
  ];
  
  // Function to check if a username should be muted
  function isUsernameMuted(username, timestamp) {
    if (!username) return false;
    
    const user = mutedUsers.find(u => u.username === username);
    if (!user) return false;
    
    // If no timestamp provided, mute by default (for preview cases)
    if (!timestamp) return true;
    
    // Convert Firestore timestamp to milliseconds
    const commentTime = timestamp instanceof Date 
      ? timestamp.getTime() 
      : (timestamp.seconds ? timestamp.seconds * 1000 : Date.now());
    
    // Only mute if comment was posted after the mute date
    return commentTime >= user.muteFromDate;
  }
  
  // Function to filter comments based on mute status
  function filterComment(comment, username, timestamp) {
    if (!comment) return "-";
    if (isUsernameMuted(username, timestamp)) {
      return "Muted.";
    }
    return comment;
  }

// --- State for PREVIEW SECTION ---
const previewState = {
  currentMode: "D1",  // Can now be "D1", "D2", "D3", or "FFA"
  currentPage: 1,
  matchesPerPage: 5,
  lastVisible: null,
  firstVisible: null,
  isLoading: false,
  filterUsername: '',
  enhancedFilters: {
    pilots: '',
    levels: '',
    subgames: [],
  },
  totalPages: 1,
  hasReachedEnd: false,
  // New: Store filtered match IDs for semi-lazy loading
  filteredMatchIds: null,
  allMatchesLoaded: false
};

// --- Cache Helper Functions ---
function getCacheKey(mode, page, filters) {
    // Include all filters in cache key to store filtered results separately
    const filterParts = [
        `u:${filters.filterUsername || ''}`,
        `p:${filters.enhancedFilters?.pilots || ''}`,
        `l:${filters.enhancedFilters?.levels || ''}`,
        `s:${filters.enhancedFilters?.subgames?.join(',') || ''}`
    ];
    const filterString = filterParts.join('|');
    return `previewCache_${mode}_p${page}_${filterString}`;
}

function getCachedPage(key) {
    const cached = sessionStorage.getItem(key);
    if (cached) {
        try {
            // console.log("Cache HIT for key:", key);
            return JSON.parse(cached);
        } catch (e) {
            console.error("Failed to parse cache:", e);
            sessionStorage.removeItem(key); // Clear invalid cache entry
            return null;
        }
    }
    // console.log("Cache MISS for key:", key);
    return null;
}

function cachePage(key, data) {
    try {
        sessionStorage.setItem(key, JSON.stringify(data));
        // console.log("Cached data for key:", key);
    } catch (e) {
        console.error("Failed to cache data:", e);
        // Handle potential storage limits if necessary
        // Simple approach: clear older cache items or the whole cache
        // sessionStorage.clear();
    }
}

function getEloColor(elo, matchCount = null, winRate = 0) {
  const rank = getRankStyle(Number(elo), matchCount, winRate);
  return rank.color;
}

// Fetch current player stats from the ladder for accurate rank determination
async function fetchCurrentPlayerStats(username) {
  if (!username) return null;
  
  try {
    // Determine collection based on current mode
    const collectionName = previewState.currentMode === "D1" ? "players" : 
                          previewState.currentMode === "D2" ? "playersD2" : 
                          previewState.currentMode === "D3" ? "playersD3" : "players";
    
    const playersRef = collection(window.db, collectionName);
    const q = query(playersRef, where("username", "==", username), limit(1));
    const snapshot = await getDocs(q);
    
    if (!snapshot.empty) {
      const playerData = snapshot.docs[0].data();
      return {
        matchCount: playerData.matchCount || 0,
        winRate: playerData.winRate || 0,
        elo: playerData.elo || 0
      };
    }
  } catch (error) {
    console.error(`Error fetching player stats for ${username}:`, error);
  }
  
  return null;
}

function formatDate(timestamp, includeTime = false) {
    if (!timestamp || !timestamp.seconds) return 'N/A';
    const date = new Date(timestamp.seconds * 1000);
    return includeTime ? date.toLocaleString() : date.toLocaleDateString();
}

function truncateComment(comment, maxLength = 30) {
    if (!comment) return "-";
    if (comment.length <= maxLength) return comment;
    return comment.substring(0, maxLength) + "...";
}

function formatCommentDate(timestamp) {
    if (!timestamp || !timestamp.seconds) return '';
    const date = new Date(timestamp.seconds * 1000);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
        return 'Today';
    } else if (diffDays === 1) {
        return 'Yesterday';
    } else if (diffDays < 7) {
        return `${diffDays} days ago`;
    } else {
        return date.toLocaleDateString();
    }
}

// --- START: Preview Section Functions ---
function setLoadingIndicator(isLoading) {
    const loadingIndicator = document.getElementById("loading-indicator");
    if (loadingIndicator) loadingIndicator.style.display = isLoading ? "block" : "none";
}

export function updatePreviewLadderModeUI() {
    const ladderModeSpan = document.getElementById('preview-ladder-mode');
    const d1Button = document.getElementById('preview-d1-button');
    const d2Button = document.getElementById('preview-d2-button');
    const d3Button = document.getElementById('preview-d3-button');
    const ffaButton = document.getElementById('preview-ffa-button');
    
    if (ladderModeSpan) ladderModeSpan.textContent = previewState.currentMode;
    if (d1Button) d1Button.classList.toggle('active', previewState.currentMode === 'D1');
    if (d2Button) d2Button.classList.toggle('active', previewState.currentMode === 'D2');
    if (d3Button) d3Button.classList.toggle('active', previewState.currentMode === 'D3');
    if (ffaButton) ffaButton.classList.toggle('active', previewState.currentMode === 'FFA');
}

function updatePreviewPaginationControls(hasNextPage) {
    const prevButton = document.getElementById('previewPrevPage');
    const nextButton = document.getElementById('previewNextPage');
    const pageInfo = document.getElementById('previewPageInfo');
    if (!prevButton || !nextButton || !pageInfo) return;

    pageInfo.textContent = `Page ${previewState.currentPage}`;
    prevButton.disabled = previewState.currentPage <= 1;
    nextButton.disabled = !hasNextPage;
}

function setPreviewLoadingState(isLoading) {
    previewState.isLoading = isLoading;
    setLoadingIndicator(isLoading); // Use shared loading indicator
    const container = document.getElementById('recent-matches-preview');
    const loadingDiv = container ? container.querySelector('.matches-loading') : null;
    const prevButton = document.getElementById('previewPrevPage');
    const nextButton = document.getElementById('previewNextPage');
    const d1Button = document.getElementById('preview-d1-button');
    const d2Button = document.getElementById('preview-d2-button');
    const applyFilterBtn = document.getElementById('applyFilterBtn');
    const clearFilterBtn = document.getElementById('clearFilterBtn');

    if (loadingDiv && !isLoading) {
        loadingDiv.style.display = 'none';
    } else if (loadingDiv && isLoading) {
        loadingDiv.style.display = 'block';
    }

    if (!isLoading && container && !container.querySelector('.match-card') && !container.querySelector('.matches-loading[style*="color: red"]')) {
        container.innerHTML = `<div class="matches-loading">No recent matches found${previewState.filterUsername ? ' matching filters' : ''}.</div>`;
    }

    if (prevButton) prevButton.disabled = isLoading || previewState.currentPage <= 1;
    if (nextButton) nextButton.disabled = isLoading;
    if (d1Button) d1Button.disabled = isLoading;
    if (d2Button) d2Button.disabled = isLoading;
    if (applyFilterBtn) applyFilterBtn.disabled = isLoading;
    if (clearFilterBtn) clearFilterBtn.disabled = isLoading;
}

function applyClientFiltersForFFA(docsData) {
    if (!previewState.filterUsername) {
        return docsData; // No filter applied
    }
    const searchTerm = previewState.filterUsername.toLowerCase();
    return docsData.filter(matchData => {
        // For FFA, check if any participant matches the search term
        const participants = matchData.participants || [];
        return participants.some(p => 
            (p.username || '').toLowerCase().includes(searchTerm)
        );
    });
}

// ✅ ADD THIS MISSING FUNCTION for D1/D2/D3 matches
function applyClientFilters(docsData) {
    if (!previewState.filterUsername) {
        return docsData; // No filter applied
    }
    const searchTerm = previewState.filterUsername.toLowerCase();
    return docsData.filter(matchData => {
        // For regular matches, check if winner or loser matches the search term
        const winner = (matchData.winnerUsername || '').toLowerCase();
        const loser = (matchData.loserUsername || '').toLowerCase();
        return winner.includes(searchTerm) || loser.includes(searchTerm);
    });
}

// Add enhanced filter functions after the existing applyClientFilters function
function applyEnhancedClientFilters(docsData, isFFA = false) {
    if (!hasEnhancedFilters()) {
        return docsData;
    }
    
    return docsData.filter(matchData => {
        // Pilots filter
        if (previewState.enhancedFilters.pilots) {
            const pilotsSearch = previewState.enhancedFilters.pilots.toLowerCase();
            
            if (isFFA) {
                // For FFA matches, check all participants
                const participants = matchData.participants || [];
                const hasMatch = participants.some(p => 
                    (p.username || '').toLowerCase().includes(pilotsSearch)
                );
                if (!hasMatch) return false;
            } else {
                // For regular matches, check winner and loser
                const winner = (matchData.winnerUsername || '').toLowerCase();
                const loser = (matchData.loserUsername || '').toLowerCase();
                if (!winner.includes(pilotsSearch) && !loser.includes(pilotsSearch)) {
                    return false;
                }
            }
        }
        
        // Levels filter
        if (previewState.enhancedFilters.levels) {
            const levelsSearch = previewState.enhancedFilters.levels.toLowerCase();
            const mapPlayed = (matchData.mapPlayed || '').toLowerCase();
            if (!mapPlayed.includes(levelsSearch)) {
                return false;
            }
        }
        
        // Subgames filter
        if (previewState.enhancedFilters.subgames.length > 0) {
            const matchSubgame = matchData.subgameType || 'Standard Match';
            if (!previewState.enhancedFilters.subgames.includes(matchSubgame)) {
                return false;
            }
        }
        
        return true;
    });
}

function hasEnhancedFilters() {
    return previewState.enhancedFilters.pilots || 
           previewState.enhancedFilters.levels || 
           previewState.enhancedFilters.subgames.length > 0;
}

function clearEnhancedFilters() {
    previewState.enhancedFilters = {
        pilots: '',
        levels: '',
        subgames: []
    };
    
    // Clear UI
    document.getElementById('filter-pilots').value = '';
    document.getElementById('filter-levels').value = '';
    const subgamesSelect = document.getElementById('filter-subgames');
    for (let option of subgamesSelect.options) {
        option.selected = false;
    }
}

// Jump navigation functions
function jumpToPage(direction) {
    const jumpInput = document.getElementById('jump-to-page');
    const currentPage = previewState.currentPage;
    let targetPage = currentPage;
    
    switch (direction) {
        case 'start':
            targetPage = 1;
            break;
        case 'end':
            // For end, we'll need to implement end detection
            targetPage = Math.max(currentPage + 10, previewState.totalPages || currentPage + 10);
            break;
        case '+1':
            targetPage = currentPage + 1;
            break;
        case '+5':
            targetPage = currentPage + 5;
            break;
        case '+10':
            targetPage = currentPage + 10;
            break;
        case '-1':
            targetPage = Math.max(1, currentPage - 1);
            break;
        case '-5':
            targetPage = Math.max(1, currentPage - 5);
            break;
        case '-10':
            targetPage = Math.max(1, currentPage - 10);
            break;
        case 'input':
            const inputValue = parseInt(jumpInput.value);
            if (inputValue && inputValue > 0) {
                targetPage = inputValue;
                jumpInput.value = '';
            }
            break;
    }
    
    if (targetPage !== currentPage && targetPage > 0) {
        previewState.currentPage = targetPage;
        loadRecentMatchesPreview('jump');
    }
}

export async function loadRecentMatchesPreview(direction = 'current') {
    const container = document.getElementById('recent-matches-preview');
    const template = previewState.currentMode === 'FFA' 
        ? document.getElementById('ffa-match-card-template')
        : document.getElementById('match-card-template');
    
    if (previewState.isLoading || !container || !template) return;

    // Clear the page cache when filtering or changing modes
    if (direction === 'current') {
        console.log("Clearing cache for refresh/reset");
        Object.keys(sessionStorage).forEach(key => {
            if (key.includes(`previewCache_${previewState.currentMode}`)) {
                sessionStorage.removeItem(key);
            }
        });
        // Reset filtered state when starting fresh
        previewState.filteredMatchIds = null;
        previewState.allMatchesLoaded = false;
    }
    
    // Check if we have active filters
    const hasActiveFilters = previewState.filterUsername || hasEnhancedFilters();
    
    // If filters are active and we haven't loaded all matches yet, do a full scan
    if (hasActiveFilters && !previewState.allMatchesLoaded) {
        await loadAndFilterAllMatches();
    }
    
    // Calculate target page number based on navigation direction
    let targetPage = previewState.currentPage;
    if (direction === 'next') {
        targetPage++;
    } else if (direction === 'prev') {
        targetPage--;
    } else if (direction === 'current') {
        targetPage = 1;
        previewState.firstVisible = null;
        previewState.lastVisible = null;
    }
    
    if (targetPage < 1) targetPage = 1;
    
    const previousPage = previewState.currentPage;
    previewState.currentPage = targetPage;
    
    updatePreviewPaginationControls(true);
    
    // Try loading from cache
    const currentFilters = { 
        filterUsername: previewState.filterUsername,
        enhancedFilters: previewState.enhancedFilters
    };
    const cacheKey = getCacheKey(previewState.currentMode, targetPage, currentFilters);
    const cachedData = (direction !== 'current') ? getCachedPage(cacheKey) : null;
    
    if (cachedData) {
        console.log(`Rendering page ${targetPage} from cache`);
        setPreviewLoadingState(true);
        
        if (previewState.currentMode === 'FFA') {
            renderFFAMatchCards(cachedData.docsData);
        } else {
            renderMatchCards(cachedData.docsData);
        }
        updatePreviewPaginationControls(cachedData.hasNextPage);
        
        setPreviewLoadingState(false);
        return;
    }
    
    console.log(`Cache miss for page ${targetPage}, fetching from Firestore`);
    setPreviewLoadingState(true);
    container.innerHTML = '<div class="matches-loading">Loading recent matches...</div>';
    
    // If we have filtered IDs, use them; otherwise load normally
    if (hasActiveFilters && previewState.filteredMatchIds) {
        await loadFilteredPage(targetPage, previousPage);
    } else {
        await loadUnfilteredPage(targetPage, previousPage);
    }
}

// Load and filter ALL matches from the database (lightweight scan)
async function loadAndFilterAllMatches() {
    const container = document.getElementById('recent-matches-preview');
    container.innerHTML = '<div class="matches-loading">Scanning all matches for filters... This may take a moment.</div>';
    
    console.log("Loading all matches for filtering...");
    
    // Determine collection based on mode
    let collectionName, orderField;
    
    if (previewState.currentMode === 'FFA') {
        collectionName = 'approvedMatchesFFA';
        orderField = 'approvedAt';
    } else {
        collectionName = previewState.currentMode === "D1" ? "approvedMatches" : 
                         previewState.currentMode === "D2" ? "approvedMatchesD2" : "approvedMatchesD3";
        orderField = previewState.currentMode === "D1" ? "createdAt" : "approvedAt";
    }
    
    try {
        const matchesRef = collection(window.db, collectionName);
        const q = query(matchesRef, orderBy(orderField, "desc"));
        const snapshot = await getDocs(q);
        
        console.log(`Loaded ${snapshot.docs.length} total matches`);
        
        // Extract lightweight data for filtering
        const allMatches = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        
        // Apply filters
        let filteredMatches = previewState.currentMode === 'FFA' 
            ? applyClientFiltersForFFA(allMatches)
            : applyClientFilters(allMatches);
        
        filteredMatches = applyEnhancedClientFilters(filteredMatches, previewState.currentMode === 'FFA');
        
        console.log(`Filtered down to ${filteredMatches.length} matches`);
        
        // Store the filtered match data (not just IDs, but full data for rendering)
        previewState.filteredMatchIds = filteredMatches;
        previewState.allMatchesLoaded = true;
        previewState.totalPages = Math.ceil(filteredMatches.length / previewState.matchesPerPage);
        
        console.log(`Total pages after filtering: ${previewState.totalPages}`);
        
    } catch (error) {
        console.error("Error loading all matches:", error);
        container.innerHTML = `<div class="matches-loading" style="color: red;">Error scanning matches: ${error.message}</div>`;
        throw error;
    }
}

// Load a specific page from filtered results
async function loadFilteredPage(targetPage, previousPage) {
    const container = document.getElementById('recent-matches-preview');
    
    if (!previewState.filteredMatchIds || previewState.filteredMatchIds.length === 0) {
        const filterInfo = [];
        if (previewState.filterUsername) filterInfo.push(`Username: "${previewState.filterUsername}"`);
        if (previewState.enhancedFilters.pilots) filterInfo.push(`Pilots: "${previewState.enhancedFilters.pilots}"`);
        if (previewState.enhancedFilters.levels) filterInfo.push(`Levels: "${previewState.enhancedFilters.levels}"`);
        if (previewState.enhancedFilters.subgames.length > 0) filterInfo.push(`Subgames: ${previewState.enhancedFilters.subgames.join(', ')}`);
        container.innerHTML = `<div class="matches-loading">No matches found matching filters: ${filterInfo.join(' | ')}</div>`;
        setPreviewLoadingState(false);
        return;
    }
    
    // Calculate pagination
    const startIdx = (targetPage - 1) * previewState.matchesPerPage;
    const endIdx = startIdx + previewState.matchesPerPage;
    const pageMatches = previewState.filteredMatchIds.slice(startIdx, endIdx);
    
    if (pageMatches.length === 0) {
        console.log("No results on this page");
        previewState.currentPage = previousPage;
        updatePreviewPaginationControls(false);
        container.innerHTML = '<div class="matches-loading">No more matches to display.</div>';
        setPreviewLoadingState(false);
        return;
    }
    
    console.log(`Rendering page ${targetPage} with ${pageMatches.length} matches from filtered results`);
    
    // Render the page
    if (previewState.currentMode === 'FFA') {
        renderFFAMatchCards(pageMatches);
    } else {
        renderMatchCards(pageMatches);
    }
    
    const hasNextPage = endIdx < previewState.filteredMatchIds.length;
    updatePreviewPaginationControls(hasNextPage);
    
    // Cache the page
    const currentFilters = { 
        filterUsername: previewState.filterUsername,
        enhancedFilters: previewState.enhancedFilters
    };
    const pageDataToCache = {
        docsData: pageMatches,
        hasNextPage: hasNextPage
    };
    cachePage(getCacheKey(previewState.currentMode, targetPage, currentFilters), pageDataToCache);
    
    setPreviewLoadingState(false);
}

// Load unfiltered page (original behavior)
async function loadUnfilteredPage(targetPage, previousPage) {
    const container = document.getElementById('recent-matches-preview');
    
    // Determine collection based on mode
    let collectionName, orderField;
    
    if (previewState.currentMode === 'FFA') {
        collectionName = 'approvedMatchesFFA';
        orderField = 'approvedAt';
    } else {
        collectionName = previewState.currentMode === "D1" ? "approvedMatches" : 
                         previewState.currentMode === "D2" ? "approvedMatchesD2" : "approvedMatchesD3";
        orderField = previewState.currentMode === "D1" ? "createdAt" : "approvedAt";
    }
    
    try {
        const matchesRef = collection(window.db, collectionName);
        let queryConstraints = [orderBy(orderField, "desc")];
        
        // Simple pagination for unfiltered results
        const startIdx = (targetPage - 1) * previewState.matchesPerPage;
        queryConstraints.push(limit(previewState.matchesPerPage + startIdx + 1));
        
        const q = query(matchesRef, ...queryConstraints);
        const snapshot = await getDocs(q);
        let docs = snapshot.docs;
        
        // Slice to get the specific page
        docs = docs.slice(startIdx, startIdx + previewState.matchesPerPage);
        
        if (docs.length === 0) {
            console.log("No results found for this page");
            previewState.currentPage = previousPage;
            updatePreviewPaginationControls(false);
            container.innerHTML = '<div class="matches-loading">No more matches to display.</div>';
            setPreviewLoadingState(false);
            return;
        }
        
        const fetchedDocsData = docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // Check if there's a next page
        const hasNextPage = snapshot.docs.length > startIdx + previewState.matchesPerPage;
        
        // Render
        if (previewState.currentMode === 'FFA') {
            renderFFAMatchCards(fetchedDocsData);
        } else {
            renderMatchCards(fetchedDocsData);
        }
        
        updatePreviewPaginationControls(hasNextPage);
        
        // Cache
        const currentFilters = { 
            filterUsername: previewState.filterUsername,
            enhancedFilters: previewState.enhancedFilters
        };
        const pageDataToCache = {
            docsData: fetchedDocsData,
            hasNextPage: hasNextPage
        };
        cachePage(getCacheKey(previewState.currentMode, targetPage, currentFilters), pageDataToCache);
        
        setPreviewLoadingState(false);
        
    } catch (error) {
        console.error(`Error fetching ${previewState.currentMode} matches:`, error);
        container.innerHTML = `<div class="matches-loading" style="color: red;">Error loading matches: ${error.message}</div>`;
        updatePreviewPaginationControls(false);
        previewState.currentPage = previousPage;
        setPreviewLoadingState(false);
    }
}

/**
 * Render FFA match cards
 */
async function renderFFAMatchCards(docsData) {
    const container = document.getElementById('recent-matches-preview');
    const template = document.getElementById('ffa-match-card-template');
    
    if (!container || !template) {
        console.error('FFA template or container not found');
        return;
    }

    if (!container.querySelector('.matches-loading[style*="color: red"]')) {
        container.innerHTML = '';
    }

    if (!docsData || docsData.length === 0) {
        if (!container.querySelector('.matches-loading[style*="color: red"]')) {
            container.innerHTML = `<div class="matches-loading">No FFA matches found.</div>`;
        }
        return;
    }

    // Fetch comments for all matches
    const allCommentsPromises = docsData.map(match => getAllCommentsForMatchFFA(match.id));
    let allCommentsResults = [];

    try {
        allCommentsResults = await Promise.all(allCommentsPromises);
    } catch (error) {
        console.error("Error fetching FFA comments batch:", error);
        allCommentsResults = docsData.map(() => []);
    }

    const commentsMap = {};
    allCommentsResults.forEach((comments, index) => {
        commentsMap[docsData[index].id] = comments || [];
    });

    docsData.forEach(match => {
        const cardClone = template.content.cloneNode(true);
        const wrapper = cardClone.querySelector('.match-display-wrapper');
        const card = cardClone.querySelector('.match-card.ffa-card');
        const cardTemplate = document.getElementById('ffa-match-card-template');

                // Add game version data attribute for border color
        const gameVersion = match.gameVersion || 'D1';
        card.setAttribute('data-game-version', gameVersion);

        // Populate header
        const mapEl = card.querySelector('.match-map');
        if (mapEl) mapEl.textContent = match.mapPlayed || 'Unknown Map';
        
        const dateEl = card.querySelector('.match-date');
        if (dateEl) dateEl.textContent = formatDate(match.approvedAt || match.createdAt);
        
        // Game version badge (D1 or D2)
        const gameVersionBadge = card.querySelector('.ffa-game-version-badge');
        if (gameVersionBadge) {
            const gameVersion = match.gameVersion || 'D1';
            gameVersionBadge.textContent = gameVersion;
            gameVersionBadge.classList.add(gameVersion.toLowerCase());
        }
        
        // Player count
        const playerCountEl = card.querySelector('.player-count-number');
        const participants = match.participants || [];
        if (playerCountEl) {
            playerCountEl.textContent = participants.length;
        }

        // Populate placements
        const placementsContainer = card.querySelector('.ffa-placements');
        if (placementsContainer && participants.length > 0) {
            placementsContainer.innerHTML = '';
            
            // Sort participants by placement
            const sortedParticipants = [...participants].sort((a, b) => a.placement - b.placement);
            
            sortedParticipants.forEach(participant => {
                const row = createFFAPlacementRow(participant, match);
                placementsContainer.appendChild(row);
            });
        }

        // Match notes
        const notesEl = card.querySelector('.ffa-match-notes');
        if (notesEl) {
            if (match.matchNotes) {
                notesEl.textContent = match.matchNotes;
            } else {
                notesEl.style.display = 'none';
            }
        }

                const eloTooltip = document.createElement('div');
        eloTooltip.className = 'elo-info-tooltip';
        eloTooltip.innerHTML = `<span class="elo-info-icon">?</span>`;
        eloTooltip.setAttribute('data-tooltip', getFFAEloExplanation(match));
        card.appendChild(eloTooltip);
        
        wrapper.appendChild(card);
        container.appendChild(wrapper);

         // ✅ UPDATED: Handle community comments using unified function
        const commentsSection = wrapper?.querySelector('.community-comments-section');
        if (commentsSection) {
            const commentsContainer = commentsSection.querySelector('.comments-container');
            const noCommentsMsg = commentsContainer?.querySelector('.no-comments-message');
            const addCommentBtn = commentsSection.querySelector('.add-comment-btn');

            if (commentsContainer) {
                while (commentsContainer.firstChild && commentsContainer.firstChild !== noCommentsMsg) {
                    commentsContainer.removeChild(commentsContainer.firstChild);
                }

                // ✅ USE UNIFIED FUNCTION: showAddCommentPopup now handles FFA automatically
                if (addCommentBtn) {
                    addCommentBtn.addEventListener('click', () => {
                        showAddCommentPopup(match.id);
                    });
                }

                const matchComments = commentsMap[match.id] || [];

                if (matchComments.length > 0) {
                    if (noCommentsMsg) noCommentsMsg.style.display = 'none';
                    
                    const truncateToWords = (text, maxWords) => {
                        const words = text.split(' ');
                        if (words.length <= maxWords) return text;
                        return words.slice(0, maxWords).join(' ') + '...';
                    };
                    
                    matchComments.forEach(comment => {
                        const commentEl = document.createElement('div');
                        
                        if (comment.type === 'demo') {
                            commentEl.className = 'demo-link';
                            commentEl.innerHTML = `
                                <a href="${comment.demoLink}" target="_blank" class="play-icon">
                                    <svg viewBox="0 0 24 24">
                                        <path d="M8,5.14V19.14L19,12.14L8,5.14Z" />
                                    </svg>
                                </a>
                                <div class="demo-info">
                                    <div class="demo-author">Demo from ${comment.username}</div>
                                    <div class="demo-description">${comment.description || 'No description'}</div>
                                </div>
                            `;
                        } else {
                            commentEl.className = 'comment-item';
                            const isMuted = isUsernameMuted(comment.username, comment.timestamp);
                            const displayText = isMuted ? "Muted." : truncateToWords(comment.text || "", 15);
                            const username = comment.username || 'Anonymous';
                            
                            const currentUser = window.auth?.currentUser;
                            const isOwnComment = currentUser && comment.userId === currentUser.uid;
                            
                            let deleteButton = '';
                            if (isOwnComment) {
                                deleteButton = '<button class="delete-comment-btn" aria-label="Delete comment">×</button>';
                            }
                            
                            commentEl.innerHTML = `${deleteButton}<strong>${username}:</strong> "${displayText}"`;
                            
                            if (isOwnComment) {
                                const deleteBtn = commentEl.querySelector('.delete-comment-btn');
                                if (deleteBtn) {
                                    deleteBtn.addEventListener('click', (e) => {
                                        e.stopPropagation();
                                        deleteCommentFFA(comment.id, commentEl);
                                    });
                                }
                            }
                            
                            if (!isMuted) {
                                commentEl.addEventListener('click', () => {
                                    showFullCommentLightbox(comment);
                                });
                            } else {
                                commentEl.style.cursor = 'default';
                            }
                        }
                        
                        commentsContainer.insertBefore(commentEl, commentsContainer.firstChild);
                    });
                } else {
                    if (noCommentsMsg) noCommentsMsg.style.display = 'block';
                }
            }
        }

        container.appendChild(cardClone);
    });
}

function createFFAPlacementRow(participant, match) {
    const row = document.createElement('div');
    row.className = 'ffa-placement-row';
    
    // Rating change display
    let ratingChangeHtml = '';
    const displayChange = participant.eloChange || 
        (participant.newDisplayRating - participant.previousDisplayRating) || 
        (participant.newElo - participant.oldElo) || 0;
    
    if (displayChange !== 0) {
        const changeClass = displayChange >= 0 ? 'positive' : 'negative';
        const changeSign = displayChange >= 0 ? '+' : '';
        ratingChangeHtml = `<span class="ffa-elo-change ${changeClass}">${changeSign}${Math.round(displayChange)}</span>`;
    }
    
    // Current display rating
    const currentRating = participant.newDisplayRating || participant.newElo || participant.oldElo || 1000;
    
    // Points earned
    const pointsEarned = participant.pointsEarned || getFFAPointsForPlacement(participant.placement);
    
    row.innerHTML = `
        <span class="ffa-placement">${participant.placement}.</span>
        <a href="profile.html?username=${encodeURIComponent(participant.username)}&ladder=ffa" 
           class="ffa-username">
            ${participant.username || 'Unknown'}
        </a>
        <span class="ffa-rating">
            ${Math.round(currentRating)}
            ${ratingChangeHtml}
        </span>
        <span class="ffa-score">Score: ${participant.score || 0}</span>
        <span class="ffa-points">+${pointsEarned}pts</span>
    `;
    
    return row;
}

function getFFAEloExplanation(match) {
    const participants = match.participants || match.players || [];
    const isTrueSkill = participants.some(p => p.newMu !== undefined);
    
    if (isTrueSkill) {
        let lines = [
            'TrueSkill Rating System:',
            '',
            'Each player\'s skill is modeled as:',
            '  μ (mu) = estimated skill level',
            '  σ (sigma) = uncertainty in estimate',
            '',
            'Display Rating = 1000 + (μ - 3σ) × 40',
            '',
            'Player Updates:'
        ];
        
        const sorted = [...participants].sort((a, b) => a.placement - b.placement);
        sorted.forEach(p => {
            const muChange = p.muChange ? (p.muChange > 0 ? '+' : '') + p.muChange.toFixed(2) : '?';
            const sigmaChange = p.sigmaChange ? p.sigmaChange.toFixed(2) : '?';
            const displayChange = p.eloChange || (p.newElo - p.oldElo) || 0;
            const sign = displayChange >= 0 ? '+' : '';
            
            lines.push(`  ${p.placement}. ${p.username}: ${sign}${displayChange} (Δμ:${muChange}, Δσ:${sigmaChange})`);
        });
        
        return lines.join('\n');
    }
    
    // Legacy ELO explanation
    return 'ELO Rating System\n\nEach match affects all players based on their finishing position relative to others.';
}

/**
 * Get FFA points for placement (matches ladderalgorithm-ffa.js)
 */
function getFFAPointsForPlacement(placement) {
    const pointsConfig = {
        1: 100,
        2: 75,
        3: 55,
        4: 40,
        5: 30,
        6: 20,
        7: 15,
        8: 10
    };
    return pointsConfig[placement] || 5;
}

/**
 * Fetch comments for FFA matches
 */
async function getAllCommentsForMatchFFA(matchId) {
    if (!matchId) return [];
    
    try {
        const commentsRef = collection(window.db, "matchComments");
        const q = query(commentsRef, 
                        where("matchId", "==", matchId),
                        orderBy("timestamp", "desc"));
        
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
            return [];
        }
        
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    } catch (error) {
        console.error("Error fetching FFA comments:", error);
        return [];
    }
}

/**
 * Delete FFA comment
 */
async function deleteCommentFFA(commentId, commentElement) {
    const currentUser = window.auth?.currentUser;
    if (!currentUser) {
        alert("You need to be signed in to delete comments");
        return;
    }
    
    if (!confirm("Are you sure you want to delete this comment?")) {
        return;
    }
    
    try {
        const commentRef = doc(window.db, "matchComments", commentId);
        
        const commentSnap = await getDoc(commentRef);
        if (!commentSnap.exists()) {
            alert("Comment not found.");
            return;
        }
        
        const commentData = commentSnap.data();
        if (commentData.userId !== currentUser.uid) {
            alert("You can only delete your own comments");
            return;
        }
        
        await deleteDoc(commentRef);
        
        if (commentElement && commentElement.parentNode) {
            commentElement.parentNode.removeChild(commentElement);
            
            const commentsContainer = commentElement.closest('.comments-container');
            if (commentsContainer && !commentsContainer.querySelector('.comment-item')) {
                const noCommentsMsg = commentsContainer.querySelector('.no-comments-message');
                if (noCommentsMsg) noCommentsMsg.style.display = 'block';
            }
        }
        
        console.log("FFA comment deleted successfully");
    } catch (error) {
        console.error("Error deleting FFA comment:", error);
        alert(`Failed to delete comment: ${error.message}`);
    }
}

// --- Update the renderMatchCards function to use enhanced filters
async function renderMatchCards(docsData) {
    const container = document.getElementById('recent-matches-preview');
    const template = document.getElementById('match-card-template');
    if (!container || !template) return;

    // Clear container unless there's an error message
    if (!container.querySelector('.matches-loading[style*="color: red"]')) {
        container.innerHTML = '';
    }

    if (!docsData || docsData.length === 0) {
        if (!container.querySelector('.matches-loading[style*="color: red"]')) {
            const filterMessage = hasEnhancedFilters() ? ' matching filters' : 
                                  previewState.filterUsername ? ' matching filters' : '';
            container.innerHTML = `<div class="matches-loading">No recent matches found${filterMessage}.</div>`;
        }
        return;
    }

    // Apply enhanced filters
    const filteredData = applyEnhancedClientFilters(docsData);
    
    if (filteredData.length === 0) {
        container.innerHTML = `<div class="matches-loading">No matches found matching current filters.</div>`;
        return;
    }

    // Fetch comments for all matches in one go with better error handling
    const allCommentsPromises = filteredData.map(match => getAllCommentsForMatch(match.id));
    let allCommentsResults = [];

    try {
        allCommentsResults = await Promise.all(allCommentsPromises);
    } catch (error) {
        console.error("Error fetching comments batch:", error);
        allCommentsResults = filteredData.map(() => []);
    }

    // Create a map of matchId -> comments array
    const commentsMap = {};
    allCommentsResults.forEach((comments, index) => {
        commentsMap[filteredData[index].id] = comments || [];
    });

    // Store match data for async ELO loading
    const matchCardsData = [];

    // Render cards quickly without ELO changes
    for (const match of filteredData) {
        const cardClone = template.content.cloneNode(true);
        const wrapper = cardClone.querySelector('.match-display-wrapper');
        const card = cardClone.querySelector('.match-card');

        // Calculate adjusted match counts (+1 since stored counts are from BEFORE this match)
        // For display purposes, ensure minimum of 5 matches to avoid "Unranked" status
        // (If someone has completed THIS match and has an ELO, they should be ranked)
        const winnerMatchCountRaw = match.winnerMatchCount != null ? match.winnerMatchCount + 1 : null;
        const loserMatchCountRaw = match.loserMatchCount != null ? match.loserMatchCount + 1 : null;
        
        // Use null (lenient mode) if match count data is missing, otherwise ensure minimum of 5
        const winnerMatchCountAdjusted = winnerMatchCountRaw != null ? Math.max(5, winnerMatchCountRaw) : null;
        const loserMatchCountAdjusted = loserMatchCountRaw != null ? Math.max(5, loserMatchCountRaw) : null;

        // Debug logging to diagnose rank display issues
        console.log(`Match Debug - Winner: ${match.winnerUsername}, ELO: ${match.winnerOldElo}, MatchCount: ${match.winnerMatchCount} -> Adjusted: ${winnerMatchCountAdjusted}, WinRate: ${match.winnerWinRate}`);
        console.log(`Match Debug - Loser: ${match.loserUsername}, ELO: ${match.loserOldElo || match.losersOldElo}, MatchCount: ${match.loserMatchCount} -> Adjusted: ${loserMatchCountAdjusted}, WinRate: ${match.loserWinRate}`);

        // Add winner rank border class to the card
        const winnerRankClass = getEloRankClass(match.winnerOldElo, winnerMatchCountAdjusted, match.winnerWinRate ?? 0);
        console.log(`Winner rank class: ${winnerRankClass}`);
        card.classList.add(`winner-${winnerRankClass}`);

        // Populate match card as before
        card.querySelector('.match-map').textContent = match.mapPlayed || 'Unknown Map';
        card.querySelector('.match-date').textContent = formatDate(match.approvedAt || match.createdAt);

        const winnerNameEl = card.querySelector('.player.winner .player-name');
        const currentLadder = previewState.currentMode.toLowerCase();
        winnerNameEl.innerHTML = `<a href="profile.html?username=${encodeURIComponent(match.winnerUsername)}&ladder=${currentLadder}" style="color: inherit; text-decoration: none;">${match.winnerUsername || 'Unknown'}</a>`;
        winnerNameEl.style.color = getEloColor(match.winnerOldElo, winnerMatchCountAdjusted, match.winnerWinRate ?? 0);
        
        // Debug logging for Emerald detection
        if (match.winnerOldElo >= 1000) {
            console.log(`Winner ${match.winnerUsername}: ELO=${match.winnerOldElo}, matchCount=${winnerMatchCountAdjusted}, winRate=${match.winnerWinRate}`);
        }
        card.querySelector('.player.winner .player-score').textContent = match.winnerScore ?? 0;
        
        // Add winner suicides
        const winnerSuicidesEl = card.querySelector('.player.winner .player-suicides');
        const winnerSuicides = match.winnerSuicides || 0;
        winnerSuicidesEl.textContent = `S: ${winnerSuicides}`;

        const loserNameEl = card.querySelector('.player.loser .player-name');
        loserNameEl.innerHTML = `<a href="profile.html?username=${encodeURIComponent(match.loserUsername)}&ladder=${currentLadder}" style="color: inherit; text-decoration: none;">${match.loserUsername || 'Unknown'}</a>`;
        loserNameEl.style.color = getEloColor(match.loserOldElo || match.losersOldElo || 0, loserMatchCountAdjusted, match.loserWinRate ?? 0);
        
        // Debug logging for Emerald detection
        if ((match.loserOldElo || match.losersOldElo || 0) >= 1000) {
            console.log(`Loser ${match.loserUsername}: ELO=${match.loserOldElo || match.losersOldElo}, matchCount=${loserMatchCountAdjusted}, winRate=${match.loserWinRate}`);
        }
        card.querySelector('.player.loser .player-score').textContent = match.loserScore ?? 0;
        
        // Add loser suicides
        const loserSuicidesEl = card.querySelector('.player.loser .player-suicides');
        const loserSuicides = match.loserSuicides || 0;
        loserSuicidesEl.textContent = `S: ${loserSuicides}`;

        // Store card and match for async ELO loading later
        matchCardsData.push({ card, match });

        // Add subgame type display
        const subgameEl = card.querySelector('.match-subgame');
        if (subgameEl) {
            if (match.subgameType && match.subgameType.trim() !== '') {
                subgameEl.textContent = match.subgameType;
                subgameEl.style.display = 'block';
                // Add the CSS class for color coding
                const subgameClass = getSubgameClass(match.subgameType);
                if (subgameClass) {
                    subgameEl.classList.add(subgameClass);
                }
            } else {
                subgameEl.textContent = 'Standard Match';
                subgameEl.style.display = 'block';
                subgameEl.style.opacity = '0.6'; // Make it more subtle for standard matches
            }
        }

        // Player comments handling remains the same
        const winnerCommentEl = card.querySelector('.comment.winner-comment');
        const loserCommentEl = card.querySelector('.comment.loser-comment');
        const fullWinnerComment = match.winnerComment || "";
        const fullLoserComment = match.loserComment || "";

        // Get timestamps - use match creation/approval time if comment timestamp not available
        const commentTimestamp = match.approvedAt || match.createdAt;

        // Filter comments if author is muted (now including date check)
        const filteredWinnerComment = filterComment(fullWinnerComment, match.winnerUsername, commentTimestamp);
        const filteredLoserComment = filterComment(fullLoserComment, match.loserUsername, commentTimestamp);

        winnerCommentEl.textContent = `"${truncateComment(fullWinnerComment)}"`;
        loserCommentEl.textContent = `"${truncateComment(fullLoserComment)}"`;

        if (fullWinnerComment && !isUsernameMuted(match.winnerUsername, commentTimestamp)) {
            winnerCommentEl.onclick = () => showPreviewCommentPopup(filteredWinnerComment, match.winnerUsername || 'Winner', getEloColor(match.winnerOldElo, winnerMatchCountAdjusted, match.winnerWinRate ?? 0));
        } else {
            winnerCommentEl.textContent = filteredWinnerComment === "Muted." ? "Muted." : "-";
            winnerCommentEl.style.cursor = 'default';
            winnerCommentEl.onclick = null;
        }
        
        if (fullLoserComment && !isUsernameMuted(match.loserUsername)) {
            loserCommentEl.onclick = () => showPreviewCommentPopup(filteredLoserComment, match.loserUsername || 'Loser', getEloColor(match.losersOldElo, loserMatchCountAdjusted, match.loserWinRate ?? 0));
        } else {
            loserCommentEl.textContent = filteredLoserComment === "Muted." ? "Muted." : "-";
            loserCommentEl.style.cursor = 'default';
            loserCommentEl.onclick = null;
        }

        // Now handle the community comments section
        // Safely get elements with null checks
        const commentsSection = wrapper?.querySelector('.community-comments-section');
        if (!commentsSection) {
            console.warn('Comments section not found in template');
            // Continue with the rest of the card setup
        } else {
            const commentsContainer = commentsSection.querySelector('.comments-container');
            const noCommentsMsg = commentsContainer?.querySelector('.no-comments-message');
            const addCommentBtn = commentsSection.querySelector('.add-comment-btn');

            // Only proceed with comments setup if container exists
            if (commentsContainer) {
                // Clear existing comments if any
                while (commentsContainer.firstChild && commentsContainer.firstChild !== noCommentsMsg) {
                    commentsContainer.removeChild(commentsContainer.firstChild);
                }

                // Setup add comment button
                if (addCommentBtn) {
                    addCommentBtn.addEventListener('click', () => {
                        showAddCommentPopup(match.id);
                    });
                }

                // Get the comments for this match
                const matchComments = commentsMap[match.id] || [];

                // If there are comments, hide the "no comments" message and add them
                if (matchComments.length > 0) {
                    if (noCommentsMsg) noCommentsMsg.style.display = 'none';
                    
                    // Helper function to truncate to 15 words
                    const truncateToWords = (text, maxWords) => {
                        const words = text.split(' ');
                        if (words.length <= maxWords) return text;
                        return words.slice(0, maxWords).join(' ') + '...';
                    };
                    
                    // Add each comment in compact format
                    matchComments.forEach(comment => {
                        const commentEl = document.createElement('div');
                        
                        if (comment.type === 'demo') {
                            // Render as demo link with play icon
                            commentEl.className = 'demo-link';
                            commentEl.innerHTML = `
                                <a href="${comment.demoLink}" target="_blank" class="play-icon">
                                    <svg viewBox="0 0 24 24">
                                        <path d="M8,5.14V19.14L19,12.14L8,5.14Z" />
                                    </svg>
                                </a>
                                <div class="demo-info">
                                    <div class="demo-author">Demo from ${comment.username}</div>
                                    <div class="demo-description">${comment.description || 'No description provided'}</div>
                                </div>
                            `;
                            
                            // Handle delete button for user's own demos
                            const currentUser = window.auth.currentUser;
                            const isOwn = currentUser && comment.userId === currentUser.uid;
                            if (isOwn) {
                                const deleteBtn = document.createElement('button');
                                deleteBtn.className = 'delete-comment-btn';
                                deleteBtn.innerHTML = '×';
                                deleteBtn.setAttribute('aria-label', 'Delete demo');
                                deleteBtn.addEventListener('click', (e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    deleteComment(comment.id, commentEl);
                                });
                                commentEl.appendChild(deleteBtn);
                            }
                            
                        } else {
                        // Regular comment
                        commentEl.className = 'comment-item';
                        
                        // Check if the comment author is muted - now with timestamp check
                        const isMuted = isUsernameMuted(comment.username, comment.timestamp);
                        
                        // Get text for display - muted or truncated
                        const displayText = isMuted ? 
                            "Muted." : 
                            truncateToWords(comment.text || "", 15);
                        
                        // Use default username if not provided
                        const username = comment.username || 'Anonymous';
                        
                        // Create the compact format with delete button for user's own comments
                        const currentUser = window.auth.currentUser;
                        const isOwnComment = currentUser && comment.userId === currentUser.uid;
                        
                        // Add delete button for user's own comments
                        let deleteButton = '';
                        if (isOwnComment) {
                            deleteButton = '<button class="delete-comment-btn" aria-label="Delete comment">×</button>';
                        }
                        
                        commentEl.innerHTML = `${deleteButton}<strong>${username}:</strong> "${displayText}"`;
                        
                        // Add click handler for delete button
                        if (isOwnComment) {
                            const deleteBtn = commentEl.querySelector('.delete-comment-btn');
                            if (deleteBtn) {
                                deleteBtn.addEventListener('click', (e) => {
                                    e.stopPropagation(); // Prevent opening the comment popup
                                    deleteComment(comment.id, commentEl);
                                });
                            }
                        }
                        
                        // Add click handler to show full comment in lightbox only if not muted
                        if (!isMuted) {
                            commentEl.addEventListener('click', () => {
                                showFullCommentLightbox(comment);
                            });
                        } else {
                            commentEl.style.cursor = 'default';
                        }
                    }
                    
                    // Insert at the beginning to show newest first
                    commentsContainer.insertBefore(commentEl, commentsContainer.firstChild);
                });
                } else {
                    if (noCommentsMsg) noCommentsMsg.style.display = 'block';
                }
            }
        }

        // Handle demo links with robust error checking
        const demoLinksContainer = card.querySelector('.match-demo-links');
        if (demoLinksContainer) {
            const winnerDemoLink = card.querySelector('.winner-demo-link');
            const loserDemoLink = card.querySelector('.loser-demo-link');
            
            // Define both URLs outside if blocks so they're available in the whole function scope
            const winnerDemoLinkUrl = match.winnerDemoLink || null;
            const loserDemoLinkUrl = match.loserDemoLink || match.demoLink || null;
            
            // Debug what we found
            console.log(`Match ${match.id} demo links:`, {
                winner: winnerDemoLinkUrl,
                loser: loserDemoLinkUrl
            });
            
            // Handle winner link
            if (winnerDemoLink) {
                if (winnerDemoLinkUrl) {
                    winnerDemoLink.href = winnerDemoLinkUrl;
                    winnerDemoLink.style.display = 'flex'; // Change to flex for proper SVG centering
                    winnerDemoLink.title = `${match.winnerUsername}'s Demo`; // Dynamic tooltip
                } else {
                    winnerDemoLink.style.display = 'none';
                }
            }
            
            // Handle loser link 
            if (loserDemoLink) {
                if (loserDemoLinkUrl) {
                    loserDemoLink.href = loserDemoLinkUrl;
                    loserDemoLink.style.display = 'flex'; // Change to flex for proper SVG centering
                    loserDemoLink.title = `${match.loserUsername}'s Demo`; // Dynamic tooltip
                } else {
                    loserDemoLink.style.display = 'none';
                }
            }

            // Make sure the container is visible if at least one link exists
            if ((winnerDemoLinkUrl && winnerDemoLink) || (loserDemoLinkUrl && loserDemoLink)) {
                demoLinksContainer.style.display = 'flex';
            } else {
                demoLinksContainer.style.display = 'none';
            }
        }

        container.appendChild(cardClone);
    }

    // Load ELO changes asynchronously after all cards are rendered
    loadEloChangesAsync(matchCardsData);
}

/**
 * Load ELO changes asynchronously after match cards are rendered
 * Fast path: Use match document data immediately
 * Slow path: Query database for matches missing ELO data (parallelized)
 */
async function loadEloChangesAsync(matchCardsData) {
    const matchesNeedingQuery = [];
    
    // First pass - display ELO from match documents (instant)
    for (const { card, match } of matchCardsData) {
        const hasData = displayEloChangesFromMatch(card, match);
        if (!hasData) {
            matchesNeedingQuery.push({ card, match });
        }
    }
    
    // Second pass - query database for missing data in parallel (only if needed)
    if (matchesNeedingQuery.length > 0) {
        await Promise.all(
            matchesNeedingQuery.map(({ card, match }) => displayEloChanges(card, match))
        );
    }
}

/**
 * Display ELO changes from match document data (fast, no database queries)
 * Returns true if data was found and displayed, false if database query needed
 */
function displayEloChangesFromMatch(card, match) {
    const winnerEloChangeEl = card.querySelector('.player.winner .player-elo-change');
    const loserEloChangeEl = card.querySelector('.player.loser .player-elo-change');
    
    if (!winnerEloChangeEl || !loserEloChangeEl) return false;
    
    let winnerChange = null;
    let loserChange = null;
    
    // Get winner's old ELO (check multiple possible field names)
    const winnerOldElo = match.winnerOldElo;
    // Get winner's new ELO (check multiple possible field names: winnerNewElo or newElo)
    const winnerNewElo = match.winnerNewElo !== undefined ? match.winnerNewElo : match.newElo;
    
    // Get loser's old ELO (check multiple possible field names: loserOldElo or losersOldElo)
    const loserOldElo = match.loserOldElo !== undefined ? match.loserOldElo : match.losersOldElo;
    // Get loser's new ELO (check multiple possible field names: loserNewElo or losersNewElo)
    const loserNewElo = match.loserNewElo !== undefined ? match.loserNewElo : match.losersNewElo;
    
    // Get ELO changes from match document fields
    if (match.winnerEloChange !== undefined) {
        winnerChange = match.winnerEloChange;
    } else if (winnerNewElo !== undefined && winnerOldElo !== undefined) {
        winnerChange = winnerNewElo - winnerOldElo;
    }
    
    if (match.loserEloChange !== undefined) {
        loserChange = match.loserEloChange;
    } else if (loserNewElo !== undefined && loserOldElo !== undefined) {
        loserChange = loserNewElo - loserOldElo;
    }
    
    // If we don't have both changes, return false to trigger database query
    if (winnerChange === null || loserChange === null) {
        return false;
    }
    
    // Display winner ELO change
    if (winnerChange !== null && !isNaN(winnerChange)) {
        const rounded = Math.round(winnerChange);
        const sign = rounded >= 0 ? '+' : '';
        winnerEloChangeEl.textContent = `${sign}${rounded}`;
        winnerEloChangeEl.className = 'player-elo-change ' + (rounded >= 0 ? 'positive' : 'negative');
        winnerEloChangeEl.style.display = 'inline-block';
    } else {
        winnerEloChangeEl.style.display = 'none';
    }
    
    // Display loser ELO change
    if (loserChange !== null && !isNaN(loserChange)) {
        const rounded = Math.round(loserChange);
        const sign = rounded >= 0 ? '+' : '';
        loserEloChangeEl.textContent = `${sign}${rounded}`;
        loserEloChangeEl.className = 'player-elo-change ' + (rounded >= 0 ? 'positive' : 'negative');
        loserEloChangeEl.style.display = 'inline-block';
    } else {
        loserEloChangeEl.style.display = 'none';
    }
    
    return true;
}

/**
 * Display ELO changes for both players on a match card (LEGACY - with database fallback)
 * PRIMARY: Use match document fields (most reliable)
 * FALLBACK: Query eloHistory if fields missing (backward compatibility)
 */
async function displayEloChanges(card, match) {
    const winnerEloChangeEl = card.querySelector('.player.winner .player-elo-change');
    const loserEloChangeEl = card.querySelector('.player.loser .player-elo-change');
    
    if (!winnerEloChangeEl || !loserEloChangeEl) return;
    
    let winnerChange = null;
    let loserChange = null;
    
    // Get winner's old ELO (check multiple possible field names)
    const winnerOldElo = match.winnerOldElo;
    // Get winner's new ELO (check multiple possible field names: winnerNewElo or newElo)
    const winnerNewElo = match.winnerNewElo !== undefined ? match.winnerNewElo : match.newElo;
    
    // Get loser's old ELO (check multiple possible field names: loserOldElo or losersOldElo)
    const loserOldElo = match.loserOldElo !== undefined ? match.loserOldElo : match.losersOldElo;
    // Get loser's new ELO (check multiple possible field names: loserNewElo or losersNewElo)
    const loserNewElo = match.loserNewElo !== undefined ? match.loserNewElo : match.losersNewElo;
    
    // Try to get ELO changes from match document fields (most reliable)
    if (match.winnerEloChange !== undefined) {
        winnerChange = match.winnerEloChange;
    } else if (winnerNewElo !== undefined && winnerOldElo !== undefined) {
        winnerChange = winnerNewElo - winnerOldElo;
    }
    
    if (match.loserEloChange !== undefined) {
        loserChange = match.loserEloChange;
    } else if (loserNewElo !== undefined && loserOldElo !== undefined) {
        loserChange = loserNewElo - loserOldElo;
    }
    
    // If we don't have both changes, try querying eloHistory (backward compatibility)
    if (winnerChange === null || loserChange === null) {
        try {
            const mode = previewState.currentMode;
            const collectionName = mode === 'D1' ? 'eloHistory' : 
                                  mode === 'D2' ? 'eloHistoryD2' : 
                                  mode === 'D3' ? 'eloHistoryD3' : 'eloHistory';
            
            const historyQuery = query(
                collection(window.db, collectionName),
                where('matchId', '==', match.id),
                limit(2)
            );
            const historySnapshot = await getDocs(historyQuery);
            
            historySnapshot.forEach(doc => {
                const entry = doc.data();
                const username = entry.username || entry.playerUsername;
                const change = entry.change || (entry.newElo - entry.previousElo);
                
                if (username === match.winnerUsername && winnerChange === null) {
                    winnerChange = change;
                } else if (username === match.loserUsername && loserChange === null) {
                    loserChange = change;
                }
            });
        } catch (error) {
            // Silently fail for old matches without eloHistory
        }
    }
    
    // Display winner ELO change
    if (winnerChange !== null && !isNaN(winnerChange)) {
        const rounded = Math.round(winnerChange);
        const sign = rounded >= 0 ? '+' : '';
        winnerEloChangeEl.textContent = `${sign}${rounded}`;
        winnerEloChangeEl.className = 'player-elo-change ' + (rounded >= 0 ? 'positive' : 'negative');
        winnerEloChangeEl.style.display = 'inline-block';
    } else {
        winnerEloChangeEl.style.display = 'none';
    }
    
    // Display loser ELO change
    if (loserChange !== null && !isNaN(loserChange)) {
        const rounded = Math.round(loserChange);
        const sign = rounded >= 0 ? '+' : '';
        loserEloChangeEl.textContent = `${sign}${rounded}`;
        loserEloChangeEl.className = 'player-elo-change ' + (rounded >= 0 ? 'positive' : 'negative');
        loserEloChangeEl.style.display = 'inline-block';
    } else {
        loserEloChangeEl.style.display = 'none';
    }
}

function getSubgameClass(subgameType) {
    const subgameClassMap = {
        'Fusion Match': 'fusion-match',
        '≥6 Missiles': 'missiles-6plus',  // Fixed: capital M
        '≥6 missiles': 'missiles-6plus',  // Support both variants
        'Weapon Imbalance': 'weapon-imbalance',
        'Blind Match': 'blind-match',
        'Rematch': 'rematch',
        'Disorientation': 'disorientation',
        'Ratting': 'ratting',
        'Altered Powerups': 'altered-power-ups',  // Fixed: no hyphen
        'Mega Match': 'mega-match', 
        'Dogfight': 'dogfight',          
        'Gauss and Mercs': 'gauss-and-mercs',  
    };
    
    return subgameClassMap[subgameType] || '';
}

/**
 * Deletes a user comment after confirmation
 * @param {string} commentId - The ID of the comment to delete
 * @param {HTMLElement} commentElement - The DOM element to remove on success
 */
async function deleteComment(commentId, commentElement) {
    // Check if user is authenticated
    const currentUser = window.auth.currentUser;
    if (!currentUser) {
        alert("You need to be signed in to delete comments");
        return;
    }
    
    // Confirm deletion
    if (!confirm("Are you sure you want to delete this comment?")) {
        return;
    }
    
    try {
        // Get comment reference
        const commentRef = doc(window.db, "matchComments", commentId);
        
        // Verify ownership before deletion
        const commentSnap = await getDoc(commentRef);
        if (!commentSnap.exists()) {
            alert("Comment not found. It may have already been deleted.");
            return;
        }
        
        const commentData = commentSnap.data();
        if (commentData.userId !== currentUser.uid) {
            alert("You can only delete your own comments");
            return;
        }
        
        // Delete the comment
        await deleteDoc(commentRef);
        
        // Remove from UI if element provided
        if (commentElement && commentElement.parentNode) {
            commentElement.parentNode.removeChild(commentElement);
            
            // Check if this was the last comment
            const commentsContainer = commentElement.closest('.comments-container');
            if (commentsContainer && !commentsContainer.querySelector('.comment-item')) {
                const noCommentsMsg = commentsContainer.querySelector('.no-comments-message');
                if (noCommentsMsg) noCommentsMsg.style.display = 'block';
            }
        }
        
        console.log("Comment deleted successfully");
    } catch (error) {
        console.error("Error deleting comment:", error);
        alert(`Failed to delete comment: ${error.message}`);
    }
}

/**
 * Fetches all comments for a specific match with proper error handling
 * @param {string} matchId The ID of the match to fetch comments for
 * @returns {Promise<Array>} Array of comment documents or empty array on error
 */
async function getAllCommentsForMatch(matchId) {
    if (!matchId) return [];
    
    try {
        // Make sure we're using the right collection name
        const commentsRef = collection(window.db, "matchComments");
        const q = query(commentsRef, 
                        where("matchId", "==", matchId),
                        orderBy("timestamp", "desc"));
        
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
            return [];
        }
        
        // Map documents to data objects
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    } catch (error) {
        console.error("Error fetching comments:", error);
        // Return empty array instead of propagating error
        // This prevents the UI from breaking if comments fail to load
        return [];
    }
}

/**
 * Submits a comment to Firebase with the correct username
 * @param {Event} event Form submit event
 */
async function submitComment(event) {
    event.preventDefault();
    
    // Ensure auth is initialized
    if (!window.auth || !window.db) {
        console.error("Firebase not initialized");
        alert("Unable to submit comment - system not ready");
        return;
    }
    
    // Check if user is authenticated
    const currentUser = window.auth.currentUser;
    if (!currentUser) {
        alert("You must be signed in to leave a comment");
        return;
    }
    
    // Get form values
    const matchId = document.getElementById('commentMatchId')?.value;
    const commentText = document.getElementById('commentText')?.value?.trim();
    
    // Validate inputs
    if (!matchId || !commentText) {
        alert("Please enter a comment before submitting");
        return;
    }
    
    // Check word count - max 15 words
    const wordCount = commentText.split(/\s+/).filter(word => word.length > 0).length;
    if (wordCount > 15) {
        alert("Comments are limited to 15 words maximum. Please shorten your comment.");
        return;
    }
    
    // Disable submit button and show loading state
    const submitButton = document.querySelector('.submit-comment-btn');
    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "Submitting...";
    }
    
    try {
        // SIMPLIFIED USERNAME DETECTION - prioritize userProfiles
        let username = 'Anonymous';
        
        try {
            // First check userProfiles collection (most reliable source)
            const userProfileRef = doc(window.db, "userProfiles", currentUser.uid);
            const userProfileSnap = await getDoc(userProfileRef);
            
            if (userProfileSnap.exists()) {
                const profileData = userProfileSnap.data();
                
                // Use the username field if available
                if (profileData.username) {
                    username = profileData.username;
                }
            }
            
            // If still not found, try Firebase Auth display name
            if (username === 'Anonymous' && currentUser.displayName) {
                username = currentUser.displayName;
            }
            
        } catch (profileError) {
            console.warn("Failed to fetch user profile:", profileError);
            // Fall back to displayName if profile fetch fails
            if (currentUser.displayName) {
                username = currentUser.displayName;
            }
        }
        
        // Prepare comment data with properly detected username
        const commentData = {
            matchId: matchId,
            userId: currentUser.uid,
            username: username,
            text: commentText,
            timestamp: serverTimestamp()
        };
        
        console.log("Submitting comment as:", username);
        
        // Add the document to Firebase
        const commentsRef = collection(window.db, "matchComments");
        await addDoc(commentsRef, commentData);
        
        console.log("Comment added successfully");
        
        // Close the popup
        closeAddCommentPopup();
        
        // Reload match display to show new comment
        loadRecentMatchesPreview('current');
        
    } catch (error) {
        console.error("Error submitting comment:", error);
        alert(`Failed to add comment: ${error.message}`);
        
        // Re-enable the submit button
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = "Submit";
        }
    }
}

/**
 * Closes the comment popup
 */
function closeAddCommentPopup() {
    const popup = document.getElementById('commentAddPopup');
    const overlay = document.getElementById('commentAddOverlay');
    
    if (popup) popup.style.display = 'none';
    if (overlay) overlay.style.display = 'none';
}

/**
 * Shows the popup for adding a comment or demo link
 * @param {string} matchId The ID of the match to comment on
 */
function showAddCommentPopup(matchId) {
    // Check if user is authenticated
    const currentUser = window.auth.currentUser;
    if (!currentUser) {
        alert("You need to be signed in to leave a comment or add a demo");
        return;
    }
    
    // Create or update the popup HTML to include both options
    let popup = document.getElementById('commentAddPopup');
    let overlay = document.getElementById('commentAddOverlay');
    
    if (!popup) {
        // Create popup if it doesn't exist
        popup = document.createElement('div');
        popup.id = 'commentAddPopup';
        popup.className = 'comment-popup';
        document.body.appendChild(popup);
    }
    
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'commentAddOverlay';
        overlay.className = 'comment-overlay';
        document.body.appendChild(overlay);
    }
    
    // Update popup content with the new dual-option form
    popup.innerHTML = `
        <div class="popup-header">
            <h3>Add Comment or Demo</h3>
            <button id="closeAddCommentPopup" class="close-btn">&times;</button>
        </div>
        <form id="addCommentForm">
            <input type="hidden" id="commentMatchId" name="commentMatchId" value="${matchId}">
            
            <div class="option-tabs">
                <button type="button" class="option-tab active" data-option="comment">Add Comment</button>
                <span class="option-divider">OR</span>
                <button type="button" class="option-tab" data-option="demo">Share Demo Link</button>
            </div>
            
            <div class="option-content" id="commentOption">
                <div class="form-group">
                    <label for="commentText">Your comment (15 words max):</label>
                    <textarea id="commentText" name="commentText" rows="3" placeholder="Share your thoughts..."></textarea>
                    <div class="word-counter"><span id="wordCount">0</span>/15 words</div>
                </div>
            </div>
            
            <div class="option-content" id="demoOption" style="display: none;">
                <div class="form-group">
                    <label for="demoLink">Demo Link:</label>
                    <input type="url" id="demoLink" name="demoLink" placeholder="https://..." required>
                </div>
                <div class="form-group">
                    <label for="demoDescription">Description (20 words max):</label>
                    <textarea id="demoDescription" name="demoDescription" rows="2" placeholder="Describe your demo..."></textarea>
                    <div class="word-counter"><span id="demoWordCount">0</span>/20 words</div>
                </div>
            </div>
            
            <div class="form-actions">
                <button type="submit" class="submit-comment-btn">Submit</button>
            </div>
        </form>
    `;
    
    // Show the popup
    popup.style.display = 'block';
    overlay.style.display = 'block';
    
    // Set up event listeners
    document.getElementById('closeAddCommentPopup').addEventListener('click', closeAddCommentPopup);
    overlay.addEventListener('click', closeAddCommentPopup);
    
    // Set up tab switching
    const tabs = popup.querySelectorAll('.option-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', function() {
            // Deactivate all tabs
            tabs.forEach(t => t.classList.remove('active'));
            // Hide all content
            document.querySelectorAll('.option-content').forEach(c => c.style.display = 'none');
            
            // Activate this tab
            this.classList.add('active');
            
            // Show the corresponding content
            const option = this.dataset.option;
            document.getElementById(`${option}Option`).style.display = 'block';
            
            // Toggle required attributes based on active tab
            if (option === 'demo') {
                document.getElementById('demoLink').setAttribute('required', '');
                document.getElementById('commentText').removeAttribute('required');
            } else {
                document.getElementById('demoLink').removeAttribute('required');
                document.getElementById('commentText').setAttribute('required', '');
            }
        });
    });
    
    // Set initial required state based on default active tab
    document.getElementById('commentText').setAttribute('required', '');
    document.getElementById('demoLink').removeAttribute('required');
    
    // Set up word counters
    setupWordCounter('commentText', 'wordCount', 15);
    setupWordCounter('demoDescription', 'demoWordCount', 20);
    
    // Set up the form submission
    document.getElementById('addCommentForm').addEventListener('submit', submitCommentOrDemo);
}

/**
 * Sets up word counter for a textarea
 * @param {string} textareaId The ID of the textarea
 * @param {string} counterId The ID of the counter element
 * @param {number} limit The word limit
 */
function setupWordCounter(textareaId, counterId, limit) {
    const textarea = document.getElementById(textareaId);
    const counter = document.getElementById(counterId);
    
    if (!textarea || !counter) return;
    
    // Initial count
    updateCount();
    
    // Update on input
    textarea.addEventListener('input', updateCount);
    
    function updateCount() {
        const text = textarea.value.trim();
        const count = text ? text.split(/\s+/).filter(word => word.length > 0).length : 0;
        
        counter.textContent = count;
        
        // Visual feedback if over limit
        if (count > limit) {
            counter.style.color = '#ff4444';
        } else {
            counter.style.color = '#aaa';
        }
    }
}

/**
 * Submits either a comment or demo link based on user selection
 * @param {Event} event Form submit event
 */
async function submitCommentOrDemo(event) {
    event.preventDefault();
    
    // Ensure auth is initialized
    if (!window.auth || !window.db) {
        console.error("Firebase not initialized");
        alert("Unable to submit - system not ready");
        return;
    }
    
    // Check if user is authenticated
    const currentUser = window.auth.currentUser;
    if (!currentUser) {
        alert("You must be signed in to continue");
        return;
    }
    
    // Get form values
    const matchId = document.getElementById('commentMatchId').value;
    
    // Determine which option is active
    const activeOption = document.querySelector('.option-tab.active').dataset.option;
    
    // Get username
    let username = 'Anonymous';
    try {
        const userProfileRef = doc(window.db, "userProfiles", currentUser.uid);
        const userProfileSnap = await getDoc(userProfileRef);
        
        if (userProfileSnap.exists()) {
            const profileData = userProfileSnap.data();
            if (profileData.username) {
                username = profileData.username;
            }
        }
        
        if (username === 'Anonymous' && currentUser.displayName) {
            username = currentUser.displayName;
        }
    } catch (error) {
        console.warn("Failed to fetch username:", error);
        if (currentUser.displayName) {
            username = currentUser.displayName;
        }
    }
    
    // Disable submit button
    const submitButton = document.querySelector('.submit-comment-btn');
    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "Submitting...";
    }
    
    try {
        if (activeOption === 'comment') {
            // Handle comment submission
            const commentText = document.getElementById('commentText').value.trim();
            
            // Validate
            if (!commentText) {
                alert("Please enter a comment before submitting");
                submitButton.disabled = false;
                submitButton.textContent = "Submit";
                return;
            }
            
            // Check word count
            const wordCount = commentText.split(/\s+/).filter(word => word.length > 0).length;
            if (wordCount > 15) {
                alert("Comments are limited to 15 words maximum. Please shorten your comment.");
                submitButton.disabled = false;
                submitButton.textContent = "Submit";
                return;
            }
            
            // Prepare data - IMPORTANT: Include all required fields per security rules
            const commentData = {
                matchId: matchId,
                userId: currentUser.uid,
                username: username,
                text: commentText,
                type: 'comment',
                timestamp: serverTimestamp()
            };
            
            // Add to Firebase
            const commentsRef = collection(window.db, "matchComments");
            await addDoc(commentsRef, commentData);
            
        } else {
            // Handle demo link submission
            const demoLink = document.getElementById('demoLink').value.trim();
            const demoDescription = document.getElementById('demoDescription').value.trim() || "Demo link";
            
            // Validate
            if (!demoLink) {
                alert("Please enter a demo link");
                submitButton.disabled = false;
                submitButton.textContent = "Submit";
                return;
            }
            
            // Validate URL format
            try {
                new URL(demoLink);
            } catch (e) {
                alert("Please enter a valid URL for the demo link");
                submitButton.disabled = false;
                submitButton.textContent = "Submit";
                return;
            }
            
            // Check word count for description
            const wordCount = demoDescription.split(/\s+/).filter(word => word.length > 0).length;
            if (wordCount > 20) {
                alert("Demo descriptions are limited to 20 words maximum. Please shorten your description.");
                submitButton.disabled = false;
                submitButton.textContent = "Submit";
                return;
            }
            
            // Prepare data - CRITICAL CHANGE: Include required 'text' field to satisfy security rules
            const demoData = {
                matchId: matchId,
                userId: currentUser.uid,
                username: username,
                demoLink: demoLink,
                description: demoDescription,
                type: 'demo',
                text: `Demo: ${demoDescription}`, // Add text field to meet security requirements
                timestamp: serverTimestamp()
            };
            
            // Add to Firebase
            const commentsRef = collection(window.db, "matchComments");
            await addDoc(commentsRef, demoData);
        }
        
        // Close popup and refresh
        closeAddCommentPopup();
        loadRecentMatchesPreview('current');
        
    } catch (error) {
        console.error("Error submitting:", error);
        alert(`Failed to submit: ${error.message}`);
        
        // Re-enable submit button
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = "Submit";
        }
    }
}

function getEloRankClass(elo, matchCount = null, winRate = 0) {
  const rank = getRankStyle(Number(elo), matchCount, winRate);
  return rank.name.toLowerCase();
}

function showPreviewCommentPopup(commentText, username, usernameColor = "#fff") {
    const popup = document.getElementById('commentPopupPreview');
    const overlay = document.getElementById('commentOverlayPreview');
    const title = document.getElementById('commentPopupTitlePreview');
    const content = document.getElementById('commentPopupContentPreview');
    const reportBtn = document.getElementById('reportCommentButton');

    if (!popup || !overlay || !title || !content || !reportBtn) return;

    // Store comment data as attributes for reporting
    popup.dataset.commentText = commentText;
    popup.dataset.commentUser = username;

    title.style.color = usernameColor;
    title.textContent = `Comment from ${username}`;
    content.textContent = commentText;

    // Set up report button event handler
    reportBtn.onclick = reportComment;

    popup.style.display = 'block';
    overlay.style.display = 'block';
}

// Make sure this is adapted to your existing close function
function closePreviewCommentPopup() {
    const popup = document.getElementById('commentPopupPreview');
    const overlay = document.getElementById('commentOverlayPreview');
    
    if (popup) popup.style.display = 'none';
    if (overlay) overlay.style.display = 'none';
}

async function reportComment() {
    // Check if user is authenticated
    const currentUser = window.auth.currentUser;
    if (!currentUser) {
        alert("You need to be signed in to report comments");
        return;
    }
    
    // Confirm reporting
    if (!confirm("Are you sure you want to report this comment as inappropriate?")) {
        return;
    }
    
    try {
        const popup = document.getElementById('commentPopupPreview');
        
        // Get comment data from popup dataset
        const commentData = {
            commentAuthor: popup.dataset.commentUser || 'Unknown User',
            commentText: popup.dataset.commentText || '',
            matchId: previewState.currentMatchId || '', // From the current state
            reportedBy: currentUser.uid,
            reporterUsername: currentUser.displayName || 'Anonymous User',
            reportedAt: serverTimestamp()
        };
        
        // Add the report to the badComments collection
        const badCommentsRef = collection(window.db, "badComments");
        await addDoc(badCommentsRef, commentData);
        
        // Provide feedback and close popup
        alert("Thank you. The comment has been reported and will be reviewed.");
        closePreviewCommentPopup();
        
    } catch (error) {
        console.error("Error reporting comment:", error);
        alert(`Failed to report comment: ${error.message}`);
    }
}

function showFullCommentLightbox(comment) {
    // Check if the comment author is muted
    if (isUsernameMuted(comment.username)) {
        return; // Don't show lightbox for muted users
    }
    
    // Rest of the existing function
    const popup = document.getElementById('commentPopupPreview');
    const overlay = document.getElementById('commentOverlayPreview');
    const title = document.getElementById('commentPopupTitlePreview');
    const content = document.getElementById('commentPopupContentPreview');

    if (!popup || !overlay || !title || !content) return;

    title.style.color = "#fff";
    title.textContent = `Comment from ${comment.username}`;
    
    // Add date information if available
    if (comment.timestamp) {
        const date = new Date(comment.timestamp.seconds * 1000);
        const dateStr = date.toLocaleString();
        content.innerHTML = `<p>${comment.text}</p><small style="color:#aaa; display:block; text-align:right; margin-top:10px;">Posted on ${dateStr}</small>`;
    } else {
        content.textContent = comment.text;
    }

    // Store the comment data for reporting
    popup.dataset.commentId = comment.id || '';
    popup.dataset.commentUser = comment.username || '';
    popup.dataset.commentText = comment.text || '';
    popup.dataset.matchId = comment.matchId || '';

    // Update buttons to include report button
    const buttonsContainer = popup.querySelector('.popup-actions') || document.createElement('div');
    if (!popup.querySelector('.popup-actions')) {
        buttonsContainer.className = 'popup-actions';
        buttonsContainer.style.display = 'flex';
        buttonsContainer.style.justifyContent = 'center';
        buttonsContainer.style.gap = '10px';
        buttonsContainer.style.marginTop = '15px';
        popup.appendChild(buttonsContainer);
    } else {
        buttonsContainer.innerHTML = ''; // Clear existing buttons
    }

    // Create Close button
    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.className = 'popup-btn close-btn';
    closeButton.id = 'closeCommentPopupPreview';
    closeButton.addEventListener('click', closePreviewCommentPopup);

    // Create Report button
    const reportButton = document.createElement('button');
    reportButton.textContent = 'Report';
    reportButton.className = 'popup-btn report-btn';
    reportButton.style.backgroundColor = '#d32f2f';
    reportButton.addEventListener('click', reportComment);

    // Add buttons to container
    buttonsContainer.appendChild(closeButton);
    buttonsContainer.appendChild(reportButton);

    popup.style.display = 'block';
    overlay.style.display = 'block';
}

export function setupPreviewEventListeners() {
    const prevButton = document.getElementById('previewPrevPage');
    const nextButton = document.getElementById('previewNextPage');
    const d1Button = document.getElementById('preview-d1-button');
    const d2Button = document.getElementById('preview-d2-button');
    const d3Button = document.getElementById('preview-d3-button');
    const ffaButton = document.getElementById('preview-ffa-button');
    const filterToggleBtn = document.getElementById('filter-toggle-button');
    const enhancedFilterSection = document.getElementById('enhanced-filter-section');
    
    if (!prevButton || !nextButton || !d1Button || !d2Button || !d3Button) {
        console.warn("Preview UI elements not found, cannot attach listeners.");
        return;
    }

    prevButton.addEventListener('click', () => {
        if (!prevButton.disabled) loadRecentMatchesPreview('prev');
    });
    nextButton.addEventListener('click', () => {
         if (!nextButton.disabled) loadRecentMatchesPreview('next');
    });

    d1Button.addEventListener('click', () => {
        if (previewState.currentMode !== 'D1' && !previewState.isLoading) {
            previewState.currentMode = 'D1';
            updatePreviewLadderModeUI();
            loadRecentMatchesPreview('current');
            
            // If notable matches is active, refresh it
            const notableSection = document.getElementById('notable-matches-section');
            if (notableSection && notableSection.style.display !== 'none') {
                generateNotableMatches();
            }
        }
    });
    d2Button.addEventListener('click', () => {
        if (previewState.currentMode !== 'D2' && !previewState.isLoading) {
            previewState.currentMode = 'D2';
            updatePreviewLadderModeUI();
            loadRecentMatchesPreview('current');
            
            // If notable matches is active, refresh it
            const notableSection = document.getElementById('notable-matches-section');
            if (notableSection && notableSection.style.display !== 'none') {
                generateNotableMatches();
            }
        }
    });
    d3Button.addEventListener('click', () => {
        if (previewState.currentMode !== 'D3' && !previewState.isLoading) {
            previewState.currentMode = 'D3';
            updatePreviewLadderModeUI();
            loadRecentMatchesPreview('current');
            
            // If notable matches is active, refresh it
            const notableSection = document.getElementById('notable-matches-section');
            if (notableSection && notableSection.style.display !== 'none') {
                generateNotableMatches();
            }
        }
    });
    
    // FFA Button listener
    if (ffaButton) {
        ffaButton.addEventListener('click', () => {
            if (previewState.currentMode !== 'FFA' && !previewState.isLoading) {
                previewState.currentMode = 'FFA';
                updatePreviewLadderModeUI();
                loadRecentMatchesPreview('current');
                
                // If notable matches is active, refresh it
                const notableSection = document.getElementById('notable-matches-section');
                if (notableSection && notableSection.style.display !== 'none') {
                    generateNotableMatches();
                }
            }
        });
    }

    // Enhanced filter toggle
    if (filterToggleBtn && enhancedFilterSection) {
        filterToggleBtn.addEventListener('click', () => {
            const isVisible = enhancedFilterSection.style.display !== 'none';
            enhancedFilterSection.style.display = isVisible ? 'none' : 'block';
            filterToggleBtn.classList.toggle('active', !isVisible);
        });
    }

    // Notable matches toggle
    const summaryToggleBtn = document.getElementById('summary-toggle-button');
    const notableMatchesSection = document.getElementById('notable-matches-section');
    const regularMatchesContainer = document.getElementById('recent-matches-preview');
    
    if (summaryToggleBtn && notableMatchesSection && regularMatchesContainer) {
        summaryToggleBtn.addEventListener('click', () => {
            const isVisible = notableMatchesSection.style.display !== 'none';
            
            if (isVisible) {
                // Hide notable matches, show regular matches
                notableMatchesSection.style.display = 'none';
                regularMatchesContainer.style.display = 'block';
                summaryToggleBtn.classList.remove('active');
            } else {
                // Show notable matches, hide regular matches
                notableMatchesSection.style.display = 'block';
                regularMatchesContainer.style.display = 'none';
                summaryToggleBtn.classList.add('active');
                
                // Generate notable matches
                generateNotableMatches();
            }
        });
    }

    // Enhanced filter actions
    const applyEnhancedBtn = document.getElementById('apply-enhanced-filters');
    const clearEnhancedBtn = document.getElementById('clear-enhanced-filters');
    
    if (applyEnhancedBtn) {
        applyEnhancedBtn.addEventListener('click', () => {
            previewState.enhancedFilters.pilots = document.getElementById('filter-pilots').value.trim();
            previewState.enhancedFilters.levels = document.getElementById('filter-levels').value.trim();
            
            const subgamesSelect = document.getElementById('filter-subgames');
            previewState.enhancedFilters.subgames = Array.from(subgamesSelect.selectedOptions)
                .map(option => option.value)
                .filter(value => value !== '');
            
            loadRecentMatchesPreview('current');
        });
    }
    
    if (clearEnhancedBtn) {
        clearEnhancedBtn.addEventListener('click', () => {
            clearEnhancedFilters();
            loadRecentMatchesPreview('current');
        });
    }

    // Jump navigation
    document.querySelectorAll('.jump-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const jumpType = btn.dataset.jump;
            jumpToPage(jumpType);
        });
    });
    
    const jumpInput = document.getElementById('jump-to-page');
    if (jumpInput) {
        jumpInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                jumpToPage('input');
            }
        });
    }

    // Comment popup listeners
    const closeBtn = document.getElementById('closeCommentPopupPreview');
    const overlay = document.getElementById('commentOverlayPreview');
    if (closeBtn) closeBtn.addEventListener('click', closePreviewCommentPopup);
    if (overlay) overlay.addEventListener('click', closePreviewCommentPopup);

    const closeAddCommentBtn = document.getElementById('closeAddCommentPopup');
    const addCommentOverlay = document.getElementById('commentAddOverlay');
    const addCommentForm = document.getElementById('addCommentForm');
    
    if (closeAddCommentBtn) closeAddCommentBtn.addEventListener('click', closeAddCommentPopup);
    if (addCommentOverlay) addCommentOverlay.addEventListener('click', closeAddCommentPopup);
    if (addCommentForm) addCommentForm.addEventListener('submit', submitComment);

    const commentText = document.getElementById('commentText');
    const wordCount = document.getElementById('wordCount');
    if (commentText && wordCount) {
        setupWordCounter('commentText', 'wordCount', 15);
    }
}

// Make necessary functions available globally
window.showAddCommentPopup = showAddCommentPopup;
window.closeAddCommentPopup = closeAddCommentPopup;
window.submitComment = submitComment;

// ===================================
// NOTABLE MATCHES FUNCTIONS
// ===================================

export async function generateNotableMatches() {
  const contentEl = document.getElementById('notable-matches-content');
  const periodText = document.getElementById('summary-period-text');
  
  if (!contentEl) return;
  
  try {
    contentEl.innerHTML = '<div class="summary-loading">Finding interesting matches...</div>';
    
    // Get matches from the last 3 months
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const threeMonthsAgoTimestamp = Timestamp.fromDate(threeMonthsAgo);
    
    // Use existing pattern for collection name
    const collectionName = previewState.currentMode === 'FFA' ? 'approvedMatchesFFA' :
                          previewState.currentMode === 'D2' ? 'approvedMatchesD2' :
                          previewState.currentMode === 'D3' ? 'approvedMatchesD3' :
                          'approvedMatches';
    const matchesRef = collection(window.db, collectionName);
    const q = query(
      matchesRef,
      where('createdAt', '>=', threeMonthsAgoTimestamp),
      orderBy('createdAt', 'desc')
    );
    
    const snapshot = await getDocs(q);
    const allMatches = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    if (allMatches.length === 0) {
      contentEl.innerHTML = '<div class="summary-empty">No matches found in the past 3 months.</div>';
      return;
    }
    
    // Find notable matches
    const notableMatches = findNotableMatches(allMatches);
    
    if (notableMatches.length === 0) {
      contentEl.innerHTML = '<div class="summary-empty">No notable matches found.</div>';
      return;
    }
    
    // Update period text
    if (periodText) {
      periodText.textContent = `(${notableMatches.length} notable matches from the last 3 months.)`;
    }
    
    // Render match cards
    await renderNotableMatchCards(notableMatches, contentEl);
    
  } catch (error) {
    console.error('Error generating notable matches:', error);
    contentEl.innerHTML = '<div class="summary-empty">Unable to load notable matches.</div>';
  }
}

function analyzeMatches(matches) {
  const playerStats = {};
  const upsets = [];
  
  matches.forEach(match => {
    const winner = match.winnerUsername;
    const loser = match.loserUsername;
    const winnerElo = match.winnerPreviousElo || match.winnerRating || 0;
    const loserElo = match.loserPreviousElo || match.loserRating || 0;
    const eloChange = Math.abs((match.winnerNewElo || winnerElo) - winnerElo);
    
    // Track player stats
    if (!playerStats[winner]) {
      playerStats[winner] = { wins: 0, losses: 0, eloGain: 0, streak: 0, currentStreak: 0, matches: [] };
    }
    if (!playerStats[loser]) {
      playerStats[loser] = { wins: 0, losses: 0, eloGain: 0, streak: 0, currentStreak: 0, matches: [] };
    }
    
    playerStats[winner].wins++;
    playerStats[winner].eloGain += eloChange;
    playerStats[winner].currentStreak++;
    playerStats[winner].streak = Math.max(playerStats[winner].streak, playerStats[winner].currentStreak);
    playerStats[winner].matches.push({ result: 'win', match });
    
    playerStats[loser].losses++;
    playerStats[loser].eloGain -= eloChange;
    playerStats[loser].currentStreak = 0;
    playerStats[loser].matches.push({ result: 'loss', match });
    
    // Detect upsets (lower ELO beating higher ELO)
    const eloDiff = loserElo - winnerElo;
    if (eloDiff >= 100) {
      upsets.push({
        winner,
        loser,
        map: match.map,
        eloDiff,
        date: match.createdAt
      });
    }
  });
  
  // Calculate rising stars (biggest ELO gains)
  const risingStars = Object.entries(playerStats)
    .filter(([_, stats]) => stats.wins > 0)
    .map(([player, stats]) => ({ player, eloGain: stats.eloGain, wins: stats.wins, losses: stats.losses }))
    .sort((a, b) => b.eloGain - a.eloGain)
    .slice(0, 5);
  
  // Find hot streaks
  const hotStreaks = Object.entries(playerStats)
    .filter(([_, stats]) => stats.streak >= 3)
    .map(([player, stats]) => ({ player, streak: stats.streak, currentStreak: stats.currentStreak }))
    .sort((a, b) => b.streak - a.streak)
    .slice(0, 5);
  
  // Most active players
  const mostActive = Object.entries(playerStats)
    .map(([player, stats]) => ({ player, total: stats.wins + stats.losses, wins: stats.wins, losses: stats.losses }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
  
  return {
    upsets: upsets.sort((a, b) => b.eloDiff - a.eloDiff).slice(0, 5),
    risingStars,
    hotStreaks,
    mostActive
  };
}

function renderSummaryCards(analysis) {
  let html = '';
  
  // Upsets card
  if (analysis.upsets.length > 0) {
    html += `
      <div class="summary-card upsets">
        <div class="summary-card-header">
          <div class="summary-card-icon"><i class="fas fa-bolt"></i></div>
          <div class="summary-card-title">Biggest Upsets</div>
        </div>
        <div class="summary-card-body">
          ${analysis.upsets.map(upset => `
            <div class="summary-item">
              <a href="profile.html?username=${encodeURIComponent(upset.winner)}" class="summary-player">${upset.winner}</a>
              <span class="summary-stat"> defeated </span>
              <a href="profile.html?username=${encodeURIComponent(upset.loser)}" class="summary-player">${upset.loser}</a>
              <br><span class="summary-stat">${upset.map}</span>
              <span class="summary-highlight"> (${upset.eloDiff} ELO diff)</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
  
  // Rising Stars card
  if (analysis.risingStars.length > 0) {
    html += `
      <div class="summary-card rising-stars">
        <div class="summary-card-header">
          <div class="summary-card-icon"><i class="fas fa-arrow-trend-up"></i></div>
          <div class="summary-card-title">Rising Stars</div>
        </div>
        <div class="summary-card-body">
          ${analysis.risingStars.map(star => `
            <div class="summary-item">
              <a href="profile.html?username=${encodeURIComponent(star.player)}" class="summary-player">${star.player}</a>
              <br><span class="summary-stat">${star.wins}-${star.losses} record</span>
              <span class="summary-highlight"> +${Math.round(star.eloGain)} ELO</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
  
  // Hot Streaks card
  if (analysis.hotStreaks.length > 0) {
    html += `
      <div class="summary-card hot-streaks">
        <div class="summary-card-header">
          <div class="summary-card-icon"><i class="fas fa-fire"></i></div>
          <div class="summary-card-title">Hot Streaks</div>
        </div>
        <div class="summary-card-body">
          ${analysis.hotStreaks.map(streak => `
            <div class="summary-item">
              <a href="profile.html?username=${encodeURIComponent(streak.player)}" class="summary-player">${streak.player}</a>
              <br><span class="summary-highlight">${streak.streak} wins in a row</span>
              ${streak.currentStreak > 0 ? '<span class="summary-stat"> (ongoing!)</span>' : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
  
  // Most Active card
  if (analysis.mostActive.length > 0) {
    html += `
      <div class="summary-card notable">
        <div class="summary-card-header">
          <div class="summary-card-icon"><i class="fas fa-trophy"></i></div>
          <div class="summary-card-title">Most Active</div>
        </div>
        <div class="summary-card-body">
          ${analysis.mostActive.map(player => `
            <div class="summary-item">
              <a href="profile.html?username=${encodeURIComponent(player.player)}" class="summary-player">${player.player}</a>
              <br><span class="summary-stat">${player.total} matches</span>
              <span class="summary-highlight"> (${player.wins}-${player.losses})</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
  
  return html || '<div class="summary-empty">No notable activity this week.</div>';
}

// ===================================
// NOTABLE MATCHES HELPER FUNCTIONS
// ===================================

function findNotableMatches(matches) {
  const notable = [];
  const playerMatchups = {}; // Track head-to-head records
  
  // Rare subgames list
  const rareSubgames = ['Rematch', 'Blind Match'];
  
  matches.forEach(match => {
    let score = 0;
    const reasons = [];
    
    const winner = match.winnerUsername;
    const loser = match.loserUsername;
    const winnerElo = match.winnerPreviousElo || match.winnerOldElo || match.winnerRating || 0;
    const loserElo = match.loserPreviousElo || match.loserOldElo || match.loserRating || match.losersOldElo || 0;
    const eloDiff = loserElo - winnerElo;
    const subgame = (match.subgameType || '').toLowerCase().trim();
    const winnerScore = match.winnerScore || 0;
    const loserScore = match.loserScore || 0;
    
    // 1. OVERTIME MATCHES (HIGH PRIORITY)
    if (winnerScore > 25 || loserScore > 25) {
      score += 15; // Very long overtime
      reasons.push('Epic Overtime');
    } else if (winnerScore > 20 || loserScore > 20) {
      score += 12; // Overtime
      reasons.push('Overtime');
    }
    
    // 2. MAJOR UPSETS (HIGH PRIORITY)
    if (eloDiff >= 300) {
      score += 20;
      reasons.push('Massive Upset');
    } else if (eloDiff >= 200) {
      score += 15;
      reasons.push('Major Upset');
    } else if (eloDiff >= 150) {
      score += 10;
      reasons.push('Big Upset');
    } else if (eloDiff >= 100) {
      score += 6;
      reasons.push('Upset');
    }
    
    // 3. Rare Subgames
    if (subgame && rareSubgames.includes(subgame)) {
      score += 10;
      reasons.push('Rare Subgame');
    }
    
    // 4. Close matches (both scores 18+)
    if (winnerScore >= 18 && loserScore >= 18) {
      score += 8;
      reasons.push('Close Match');
    }
    
    // 5. High ELO matches (both players above 950)
    if (winnerElo >= 950 && loserElo >= 950) {
      score += 7;
      reasons.push('High Stakes');
    }
    
    // 6. Track rivalries (players facing each other multiple times)
    const matchupKey = [winner, loser].sort().join('_vs_');
    if (!playerMatchups[matchupKey]) {
      playerMatchups[matchupKey] = 0;
    }
    playerMatchups[matchupKey]++;
    
    if (playerMatchups[matchupKey] >= 4) {
      score += 6;
      reasons.push('Rivalry');
    }
    
    // Add to notable if score is high enough (stricter threshold)
    if (score >= 10) {
      notable.push({
        match,
        score,
        reasons
      });
    }
  });
  
  // Second pass: check for nemesis scenarios
  const playerResults = {};
  matches.forEach(match => {
    const winner = match.winnerUsername;
    const loser = match.loserUsername;
    
    if (!playerResults[winner]) playerResults[winner] = { beaten: new Set(), lostTo: new Set() };
    if (!playerResults[loser]) playerResults[loser] = { beaten: new Set(), lostTo: new Set() };
    
    playerResults[winner].beaten.add(loser);
    playerResults[loser].lostTo.add(winner);
  });
  
  notable.forEach(item => {
    const winner = item.match.winnerUsername;
    const loser = item.match.loserUsername;
    
    // Check if loser previously beat winner
    if (playerResults[loser] && playerResults[loser].beaten.has(winner)) {
      item.score += 8;
      item.reasons.push('Revenge Match');
    }
  });
  
  // Sort by score and take top 15
  notable.sort((a, b) => b.score - a.score);
  return notable.slice(0, 15); // Return full notable objects with reasons
}

async function renderNotableMatchCards(matches, container) {
  const template = document.getElementById('match-card-template');
  if (!template) {
    container.innerHTML = '<div class=\"summary-empty\">Unable to render match cards.</div>';
    return;
  }
  
  container.innerHTML = '';
  
  // Fetch comments for all matches
  const commentsMap = {};
  try {
    const allCommentsPromises = matches.map(match => getAllCommentsForMatch(match.id));
    const allCommentsResults = await Promise.all(allCommentsPromises);
    allCommentsResults.forEach((comments, index) => {
      commentsMap[matches[index].id] = comments || [];
    });
  } catch (error) {
    console.error('Error fetching comments:', error);
  }
  
  // Render each match card (reuse existing logic from renderMatchCards)
  matches.forEach(notableItem => {
    const match = notableItem.match;
    const reasons = notableItem.reasons || [];
    
    const cardClone = template.content.cloneNode(true);
    const wrapper = cardClone.querySelector('.match-display-wrapper');
    const card = cardClone.querySelector('.match-card');

    // Calculate adjusted match counts (+1 since stored counts are from BEFORE this match)
    const winnerMatchCountAdjusted = match.winnerMatchCount != null ? match.winnerMatchCount + 1 : null;
    const loserMatchCountAdjusted = match.loserMatchCount != null ? match.loserMatchCount + 1 : null;

    // Add winner rank border class
    const winnerRankClass = getEloRankClass(match.winnerOldElo || match.winnerPreviousElo || 0, winnerMatchCountAdjusted, match.winnerWinRate ?? 0);
    card.classList.add(`winner-${winnerRankClass}`);

    // Populate match card
    card.querySelector('.match-map').textContent = match.mapPlayed || match.map || 'Unknown Map';
    card.querySelector('.match-date').textContent = formatDate(match.approvedAt || match.createdAt);

    const winnerNameEl = card.querySelector('.player.winner .player-name');
    winnerNameEl.textContent = match.winnerUsername || 'Unknown';
    winnerNameEl.style.color = getEloColor(match.winnerOldElo || match.winnerPreviousElo || 0, winnerMatchCountAdjusted, match.winnerWinRate ?? 0);
    card.querySelector('.player.winner .player-score').textContent = match.winnerScore ?? 0;
    
    const winnerSuicidesEl = card.querySelector('.player.winner .player-suicides');
    winnerSuicidesEl.textContent = `S: ${match.winnerSuicides || 0}`;

    const loserNameEl = card.querySelector('.player.loser .player-name');
    loserNameEl.textContent = match.loserUsername || 'Unknown';
    loserNameEl.style.color = getEloColor(match.loserOldElo || match.loserPreviousElo || match.losersOldElo || 0, loserMatchCountAdjusted, match.loserWinRate ?? 0);
    card.querySelector('.player.loser .player-score').textContent = match.loserScore ?? 0;
    
    const loserSuicidesEl = card.querySelector('.player.loser .player-suicides');
    loserSuicidesEl.textContent = `S: ${match.loserSuicides || 0}`;

    // Add subgame type and notable tags
    const subgameEl = card.querySelector('.match-subgame');
    if (subgameEl) {
      if (match.subgameType && match.subgameType.trim() !== '') {
        subgameEl.textContent = match.subgameType;
        subgameEl.style.display = 'block';
        const subgameClass = getSubgameClass(match.subgameType);
        if (subgameClass) {
          subgameEl.classList.add(subgameClass);
        }
      } else {
        subgameEl.textContent = 'Standard Match';
        subgameEl.style.display = 'block';
        subgameEl.style.opacity = '0.6';
      }
      
      // Add notable reasons as tags below subgame (limit to top 2 most important)
      if (reasons.length > 0) {
        const tagsContainer = document.createElement('div');
        tagsContainer.style.cssText = 'display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px;';
        
        // Show max 2 tags to avoid overwhelming the card
        reasons.slice(0, 2).forEach(reason => {
          const tag = document.createElement('span');
          tag.textContent = reason;
          tag.style.cssText = 'font-size: 0.65em; padding: 1px 6px; border-radius: 2px; font-weight: 500; white-space: nowrap; opacity: 0.85;';
          
          // Color code tags
          switch(reason) {
            case 'Massive Upset':
            case 'Major Upset':
            case 'Big Upset':
            case 'Upset':
              tag.style.backgroundColor = 'rgba(255, 107, 107, 0.15)';
              tag.style.color = '#ff6b6b';
              tag.style.border = '1px solid rgba(255, 107, 107, 0.3)';
              break;
            case 'Epic Overtime':
            case 'Overtime':
              tag.style.backgroundColor = 'rgba(33, 150, 243, 0.15)';
              tag.style.color = '#42A5F5';
              tag.style.border = '1px solid rgba(33, 150, 243, 0.3)';
              break;
            case 'Rare Subgame':
              tag.style.backgroundColor = 'rgba(156, 39, 176, 0.15)';
              tag.style.color = '#ce93d8';
              tag.style.border = '1px solid rgba(156, 39, 176, 0.3)';
              break;
            case 'Close Match':
              tag.style.backgroundColor = 'rgba(76, 175, 80, 0.15)';
              tag.style.color = '#4CAF50';
              tag.style.border = '1px solid rgba(76, 175, 80, 0.3)';
              break;
            case 'Rivalry':
            case 'Revenge Match':
              tag.style.backgroundColor = 'rgba(255, 167, 38, 0.15)';
              tag.style.color = '#FFA726';
              tag.style.border = '1px solid rgba(255, 167, 38, 0.3)';
              break;
            case 'High Stakes':
              tag.style.backgroundColor = 'rgba(255, 215, 0, 0.15)';
              tag.style.color = '#FFD700';
              tag.style.border = '1px solid rgba(255, 215, 0, 0.3)';
              break;
            default:
              tag.style.backgroundColor = 'rgba(158, 158, 158, 0.15)';
              tag.style.color = '#9e9e9e';
              tag.style.border = '1px solid rgba(158, 158, 158, 0.3)';
          }
          
          tagsContainer.appendChild(tag);
        });
        
        subgameEl.parentNode.insertBefore(tagsContainer, subgameEl.nextSibling);
      }
    }

    // Player comments
    const winnerCommentEl = card.querySelector('.comment.winner-comment');
    const loserCommentEl = card.querySelector('.comment.loser-comment');
    const fullWinnerComment = match.winnerComment || "";
    const fullLoserComment = match.loserComment || "";
    const commentTimestamp = match.approvedAt || match.createdAt;

    const filteredWinnerComment = filterComment(fullWinnerComment, match.winnerUsername, commentTimestamp);
    const filteredLoserComment = filterComment(fullLoserComment, match.loserUsername, commentTimestamp);

    winnerCommentEl.textContent = `"${truncateComment(fullWinnerComment)}"`;
    loserCommentEl.textContent = `"${truncateComment(fullLoserComment)}"`;

    if (fullWinnerComment && !isUsernameMuted(match.winnerUsername, commentTimestamp)) {
      winnerCommentEl.onclick = () => showPreviewCommentPopup(filteredWinnerComment, match.winnerUsername || 'Winner', getEloColor(match.winnerOldElo || match.winnerPreviousElo || 0, winnerMatchCountAdjusted, match.winnerWinRate ?? 0));
    } else {
      winnerCommentEl.textContent = filteredWinnerComment === "Muted." ? "Muted." : "-";
      winnerCommentEl.style.cursor = 'default';
      winnerCommentEl.onclick = null;
    }
    
    if (fullLoserComment && !isUsernameMuted(match.loserUsername, commentTimestamp)) {
      loserCommentEl.onclick = () => showPreviewCommentPopup(filteredLoserComment, match.loserUsername || 'Loser', getEloColor(match.loserOldElo || match.loserPreviousElo || match.losersOldElo || 0, loserMatchCountAdjusted, match.loserWinRate ?? 0));
    } else {
      loserCommentEl.textContent = filteredLoserComment === "Muted." ? "Muted." : "-";
      loserCommentEl.style.cursor = 'default';
      loserCommentEl.onclick = null;
    }

    // Community comments section (simplified for notable matches)
    const commentsSection = wrapper?.querySelector('.community-comments-section');
    if (commentsSection) {
      const commentsContainer = commentsSection.querySelector('.comments-container');
      const addCommentBtn = commentsSection.querySelector('.add-comment-btn');
      
      if (addCommentBtn) {
        addCommentBtn.addEventListener('click', () => {
          showAddCommentPopup(match.id);
        });
      }
      
      const matchComments = commentsMap[match.id] || [];
      if (matchComments.length > 0 && commentsContainer) {
        const noCommentsMsg = commentsContainer.querySelector('.no-comments-message');
        if (noCommentsMsg) noCommentsMsg.style.display = 'none';
        
        // Add comments (simplified version)
        matchComments.forEach(comment => {
          const commentEl = document.createElement('div');
          commentEl.className = 'comment-item';
          
          if (comment.type === 'demo') {
            commentEl.innerHTML = `
              <a href="${comment.demoLink}" target="_blank" class="play-icon">
                <svg viewBox="0 0 24 24">
                  <path d="M8,5.14V19.14L19,12.14L8,5.14Z" />
                </svg>
              </a>
              <div class="demo-info">
                <div class="demo-author">Demo from ${comment.username}</div>
                <div class="demo-description">${comment.description || 'No description'}</div>
              </div>
            `;
          } else {
            const isMuted = isUsernameMuted(comment.username, comment.timestamp);
            const displayText = isMuted ? 'Muted.' : (comment.comment || '');
            commentEl.innerHTML = `
              <strong>${comment.username}:</strong>
              <span class="comment-text">${displayText}</span>
            `;
          }
          
          commentsContainer.appendChild(commentEl);
        });
      }
    }

    container.appendChild(cardClone);
  });
}