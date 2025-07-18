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

const mutedUsers = [
    { username: "Daz", muteFromDate: new Date("2025-07-02").getTime() }, // muted for 60 days. Varibale, depends on Behavior.
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
  currentMode: "D1",
  currentPage: 1,
  matchesPerPage: 5,
  lastVisible: null, // Firestore DocumentSnapshot for pagination
  firstVisible: null, // Firestore DocumentSnapshot for pagination
  isLoading: false,
  // Filter State
  filterUsername: '',
  // Enhanced filters
  enhancedFilters: {
    pilots: '',
    levels: '',
    subgames: [],
  },
  // Jump navigation
  totalPages: 1,
  hasReachedEnd: false
};

// --- Cache Helper Functions ---
function getCacheKey(mode, page, filters) {
    // Include filters in cache key to store filtered results separately
    const filterString = `u:${filters.filterUsername || ''}`;
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

// --- Shared Helper Functions ---
function getEloColor(elo) {
  const e = Number(elo);
  if (e >= 2000) return "#50C878";      // Emerald
  else if (e >= 1800) return "#FFD700"; // Gold
  else if (e >= 1600) return "#b9f1fc"; // Silver
  else if (e >= 1400) return "#CD7F32"; // Bronze
  else return "#808080";              // Unranked/Default
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
    
    if (ladderModeSpan) ladderModeSpan.textContent = previewState.currentMode;
    if (d1Button) d1Button.classList.toggle('active', previewState.currentMode === 'D1');
    if (d2Button) d2Button.classList.toggle('active', previewState.currentMode === 'D2');
    if (d3Button) d3Button.classList.toggle('active', previewState.currentMode === 'D3');
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

function applyClientFilters(docsData) {
    if (!previewState.filterUsername) {
        return docsData; // No filter applied
    }
    const searchTerm = previewState.filterUsername.toLowerCase();
    return docsData.filter(matchData => {
        const winner = (matchData.winnerUsername || '').toLowerCase();
        const loser = (matchData.loserUsername || '').toLowerCase();
        return winner.includes(searchTerm) || loser.includes(searchTerm);
    });
}

// Add enhanced filter functions after the existing applyClientFilters function
function applyEnhancedClientFilters(docsData) {
    if (!hasEnhancedFilters()) {
        return docsData;
    }
    
    return docsData.filter(matchData => {
        // Pilots filter
        if (previewState.enhancedFilters.pilots) {
            const pilotsSearch = previewState.enhancedFilters.pilots.toLowerCase();
            const winner = (matchData.winnerUsername || '').toLowerCase();
            const loser = (matchData.loserUsername || '').toLowerCase();
            if (!winner.includes(pilotsSearch) && !loser.includes(pilotsSearch)) {
                return false;
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
    const template = document.getElementById('match-card-template');
    if (previewState.isLoading || !container || !template) return;

    // Clear the page cache when filtering or changing modes
    if (direction === 'current') {
        console.log("Clearing cache for refresh/reset");
        // Optional: clear session storage for this mode to force fresh data
        Object.keys(sessionStorage).forEach(key => {
            if (key.includes(`previewCache_${previewState.currentMode}`)) {
                sessionStorage.removeItem(key);
            }
        });
    }
    
    // Calculate target page number based on navigation direction
    let targetPage = previewState.currentPage;
    if (direction === 'next') {
        targetPage++;
    } else if (direction === 'prev') {
        targetPage--;
    } else if (direction === 'current') {
        targetPage = 1; // Reset to page 1 for mode change or filter
        // Reset cursors for fresh start
        previewState.firstVisible = null;
        previewState.lastVisible = null;
    }
    
    // Ensure page is never less than 1
    if (targetPage < 1) targetPage = 1;
    
    // Before checking cache or fetching, update the page number in state
    // This ensures UI is consistent even during loading
    const previousPage = previewState.currentPage;
    previewState.currentPage = targetPage;
    
    // Update UI to reflect the new page number immediately
    updatePreviewPaginationControls(true); // Temporarily assume there's a next page
    
    // Try loading from cache (except on explicit refresh with 'current')
    const currentFilters = { filterUsername: previewState.filterUsername };
    const cacheKey = getCacheKey(previewState.currentMode, targetPage, currentFilters);
    const cachedData = (direction !== 'current') ? getCachedPage(cacheKey) : null;
    
    if (cachedData) {
        console.log(`Rendering page ${targetPage} from cache`);
        setPreviewLoadingState(true);
        
        // Render the cached data
        renderMatchCards(cachedData.docsData);
        updatePreviewPaginationControls(cachedData.hasNextPage);
        
        setPreviewLoadingState(false);
        return;
    }
    
    // Cache miss - need to fetch from Firestore
    console.log(`Cache miss for page ${targetPage}, fetching from Firestore`);
    setPreviewLoadingState(true);
    container.innerHTML = '<div class="matches-loading">Loading recent matches...</div>';
    
    const collectionName = 
        previewState.currentMode === "D1" ? "approvedMatches" : 
        previewState.currentMode === "D2" ? "approvedMatchesD2" : "approvedMatchesD3";
    
    const orderField = 
        previewState.currentMode === "D1" ? "createdAt" : "approvedAt";
    
    try {
        const matchesRef = collection(window.db, collectionName);
        let queryConstraints = [orderBy(orderField, "desc")];
        
        // Special case for page 1 - always fetch from beginning
        if (targetPage === 1) {
            console.log("Loading first page from Firestore");
            queryConstraints.push(limit(previewState.matchesPerPage));
        }
        // For next page navigation with valid lastVisible cursor
        else if (direction === 'next' && previewState.lastVisible) {
            console.log("Loading next page using cursor");
            queryConstraints.push(startAfter(previewState.lastVisible));
            queryConstraints.push(limit(previewState.matchesPerPage));
        }
        // For other cases (e.g., direct navigation, prev without cache)
        // We need to rebuild the pagination chain
        else {
            console.log("No valid cursor, fetching from beginning and skipping pages");
            // This is the key part: reset to page 1 and fetch enough docs to reach target page
            // Since Firestore doesn't have OFFSET, we'll need to fetch (targetPage * pageSize) 
            // docs and take the last pageSize
            
            // For moderate pagination (small pages), we can fetch all at once
            const docsToFetch = targetPage * previewState.matchesPerPage;
            queryConstraints.push(limit(docsToFetch));
            
            // After fetch, we'll need to slice to get just the current page
            // This is handled below
        }
        
        // Execute the query
        const q = query(matchesRef, ...queryConstraints);
        const snapshot = await getDocs(q);
        let docs = snapshot.docs;
        
        // If we're fetching multiple pages worth of data, extract just the target page
        if (targetPage > 1 && direction !== 'next') {
            // Calculate the start index for the current page
            const startIdx = (targetPage - 1) * previewState.matchesPerPage;
            // Slice to get just the current page's docs
            // If not enough docs, this will return what's available
            docs = docs.slice(startIdx, startIdx + previewState.matchesPerPage);
        }
        
        // If we got no results for this page
        if (docs.length === 0) {
            console.log("No results found for this page");
            // If we were trying to go forward but there's nothing there,
            // go back to the previous page
            if (direction === 'next') {
                previewState.currentPage = previousPage;
                updatePreviewPaginationControls(false); // No next page
            }
            container.innerHTML = `<div class="matches-loading">No more matches to display${previewState.filterUsername ? ' matching filters' : ''}.</div>`;
            setPreviewLoadingState(false);
            return;
        }

        // Update our cursors for next/prev navigation
        previewState.firstVisible = docs[0];
        previewState.lastVisible = docs[docs.length - 1];
        
        // Extract data for rendering
        const fetchedDocsData = docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // Check if there's another page after this one
        let hasNextPage = false;
        if (docs.length === previewState.matchesPerPage) { // If we got a full page
            const nextCheckQ = query(
                matchesRef,
                orderBy(orderField, "desc"),
                startAfter(previewState.lastVisible),
                limit(1)
            );
            const nextCheckSnap = await getDocs(nextCheckQ);
            hasNextPage = !nextCheckSnap.empty;
        }
        
        // Apply any client-side filtering
        const filteredDocsData = applyClientFilters(fetchedDocsData);
        
        // Cache the results
        const pageDataToCache = {
            docsData: fetchedDocsData,
            hasNextPage: hasNextPage
        };
        cachePage(getCacheKey(previewState.currentMode, previewState.currentPage, currentFilters), pageDataToCache);
        
        // Also cache adjacent pages for smoother navigation
        if (targetPage > 1 && direction !== 'next') {
            // If we fetched multiple pages, we can cache the preceding pages too
            for (let p = 1; p < targetPage; p++) {
                const pageStartIdx = (p - 1) * previewState.matchesPerPage;
                const pageEndIdx = pageStartIdx + previewState.matchesPerPage;
                const pageSlice = snapshot.docs.slice(pageStartIdx, pageEndIdx);
                
                if (pageSlice.length > 0) {
                    const pageData = pageSlice.map(doc => ({ id: doc.id, ...doc.data() }));
                    const pageHasNext = true; // We know there's a next page since we're viewing a later page
                    cachePage(getCacheKey(previewState.currentMode, p, currentFilters), {
                        docsData: pageData,
                        hasNextPage: pageHasNext
                    });
                    console.log(`Cached intermediary page ${p}`);
                }
            }
        }
        
        // Render the filtered data
        if (filteredDocsData.length === 0 && previewState.filterUsername) {
            container.innerHTML = `<div class="matches-loading">No matches found matching filter: "${previewState.filterUsername}"</div>`;
        } else {
            renderMatchCards(filteredDocsData);
        }
        
        updatePreviewPaginationControls(hasNextPage);
        
    } catch (error) {
        console.error(`Error fetching ${previewState.currentMode} matches:`, error);
        container.innerHTML = `<div class="matches-loading" style="color: red;">Error loading matches: ${error.message}</div>`;
        updatePreviewPaginationControls(false);
        
        // Revert to previous page on error
        previewState.currentPage = previousPage;
        
    } finally {
        setPreviewLoadingState(false);
    }
}

// Update the renderMatchCards function to use enhanced filters
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

    filteredData.forEach(match => {
        const cardClone = template.content.cloneNode(true);
        const wrapper = cardClone.querySelector('.match-display-wrapper');
        const card = cardClone.querySelector('.match-card');

        // Add winner rank border class to the card
        const winnerRankClass = getEloRankClass(match.winnerOldElo);
        card.classList.add(`winner-${winnerRankClass}`);

        // Populate match card as before
        card.querySelector('.match-map').textContent = match.mapPlayed || 'Unknown Map';
        card.querySelector('.match-date').textContent = formatDate(match.approvedAt || match.createdAt);

        const winnerNameEl = card.querySelector('.player.winner .player-name');
        winnerNameEl.textContent = match.winnerUsername || 'Unknown';
        winnerNameEl.style.color = getEloColor(match.winnerOldElo);
        card.querySelector('.player.winner .player-score').textContent = match.winnerScore ?? 0;
        
        // Add winner suicides
        const winnerSuicidesEl = card.querySelector('.player.winner .player-suicides');
        const winnerSuicides = match.winnerSuicides || 0;
        winnerSuicidesEl.textContent = `S: ${winnerSuicides}`;

        const loserNameEl = card.querySelector('.player.loser .player-name');
        loserNameEl.textContent = match.loserUsername || 'Unknown';
        loserNameEl.style.color = getEloColor(match.loserOldElo);
        card.querySelector('.player.loser .player-score').textContent = match.loserScore ?? 0;
        
        // Add loser suicides
        const loserSuicidesEl = card.querySelector('.player.loser .player-suicides');
        const loserSuicides = match.loserSuicides || 0;
        loserSuicidesEl.textContent = `S: ${loserSuicides}`;

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
            winnerCommentEl.onclick = () => showPreviewCommentPopup(filteredWinnerComment, match.winnerUsername || 'Winner', getEloColor(match.winnerOldElo));
        } else {
            winnerCommentEl.textContent = filteredWinnerComment === "Muted." ? "Muted." : "-";
            winnerCommentEl.style.cursor = 'default';
            winnerCommentEl.onclick = null;
        }
        
        if (fullLoserComment && !isUsernameMuted(match.loserUsername)) {
            loserCommentEl.onclick = () => showPreviewCommentPopup(filteredLoserComment, match.loserUsername || 'Loser', getEloColor(match.loserOldElo));
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
    });
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
        'Altered Powerups': 'altered-powerups',  // Fixed: no hyphen
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

// Add this helper function to get rank class from ELO
function getEloRankClass(elo) {
    const e = Number(elo);
    if (e >= 2000) return "emerald";
    else if (e >= 1800) return "gold";
    else if (e >= 1600) return "silver";
    else if (e >= 1400) return "bronze";
    else return "unranked";
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
    const filterToggleBtn = document.getElementById('filter-toggle-button');
    const enhancedFilterSection = document.getElementById('enhanced-filter-section');
    
    if (!prevButton || !nextButton || !d1Button || !d2Button || !d3Button || !filterToggleBtn || !enhancedFilterSection) {
        console.warn("Preview UI or Filter elements not found, cannot attach listeners.");
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
        }
    });
    d2Button.addEventListener('click', () => {
        if (previewState.currentMode !== 'D2' && !previewState.isLoading) {
            previewState.currentMode = 'D2';
            updatePreviewLadderModeUI();
            loadRecentMatchesPreview('current');
        }
    });
    d3Button.addEventListener('click', () => {
        if (previewState.currentMode !== 'D3' && !previewState.isLoading) {
            previewState.currentMode = 'D3';
            updatePreviewLadderModeUI();
            loadRecentMatchesPreview('current');
        }
    });

    // Enhanced filter toggle
    if (filterToggleBtn && enhancedFilterSection) {
        filterToggleBtn.addEventListener('click', () => {
            const isVisible = enhancedFilterSection.style.display !== 'none';
            enhancedFilterSection.style.display = isVisible ? 'none' : 'block';
            filterToggleBtn.classList.toggle('active', !isVisible);
        });
    }

    // Enhanced filter actions
    const applyEnhancedBtn = document.getElementById('apply-enhanced-filters');
    const clearEnhancedBtn = document.getElementById('clear-enhanced-filters');
    
    if (applyEnhancedBtn) {
        applyEnhancedBtn.addEventListener('click', () => {
            // Get filter values
            previewState.enhancedFilters.pilots = document.getElementById('filter-pilots').value.trim();
            previewState.enhancedFilters.levels = document.getElementById('filter-levels').value.trim();
            
            // Get selected subgames
            const subgamesSelect = document.getElementById('filter-subgames');
            previewState.enhancedFilters.subgames = Array.from(subgamesSelect.selectedOptions)
                .map(option => option.value)
                .filter(value => value !== '');
            
            // Apply filters and reload
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

    // Existing comment popup listeners...
    const closeBtn = document.getElementById('closeCommentPopupPreview');
    const overlay = document.getElementById('commentOverlayPreview');
    if (closeBtn) closeBtn.addEventListener('click', closePreviewCommentPopup);
    if (overlay) overlay.addEventListener('click', closePreviewCommentPopup);

    // Add comment popup event listeners
    const closeAddCommentBtn = document.getElementById('closeAddCommentPopup');
    const addCommentOverlay = document.getElementById('commentAddOverlay');
    const addCommentForm = document.getElementById('addCommentForm');
    
    if (closeAddCommentBtn) closeAddCommentBtn.addEventListener('click', closeAddCommentPopup);
    if (addCommentOverlay) addCommentOverlay.addEventListener('click', closeAddCommentPopup);
    if (addCommentForm) addCommentForm.addEventListener('submit', submitComment);

    // Use the parameterized version of setupWordCounter instead of the duplicate one
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

// --- END: Preview Section Functions ---