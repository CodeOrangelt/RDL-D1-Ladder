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
  // filterStartDate: null, // Add later if needed
  // filterEndDate: null, // Add later if needed
  // Cache object (simple in-memory for now, could use sessionStorage)
  // cache: {}, // Let's use sessionStorage directly
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
  else if (e >= 1600) return "#C0C0C0"; // Silver
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

// Update renderMatchCards function to handle the new structure

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
             container.innerHTML = `<div class="matches-loading">No recent matches found${previewState.filterUsername ? ' matching filters' : ''}.</div>`;
        }
        return;
    }

    // Fetch comments for all matches in one go with better error handling
    const allCommentsPromises = docsData.map(match => getAllCommentsForMatch(match.id));
    let allCommentsResults = [];

    try {
        allCommentsResults = await Promise.all(allCommentsPromises);
    } catch (error) {
        console.error("Error fetching comments batch:", error);
        // Initialize with empty arrays so the UI can continue
        allCommentsResults = docsData.map(() => []);
    }

    // Create a map of matchId -> comments array
    const commentsMap = {};
    allCommentsResults.forEach((comments, index) => {
        commentsMap[docsData[index].id] = comments || [];
    });

    docsData.forEach(match => {
        const cardClone = template.content.cloneNode(true);
        const wrapper = cardClone.querySelector('.match-display-wrapper');
        const card = cardClone.querySelector('.match-card');

        // Populate match card as before
        card.querySelector('.match-map').textContent = match.mapPlayed || 'Unknown Map';
        card.querySelector('.match-date').textContent = formatDate(match.approvedAt || match.createdAt);

        const winnerNameEl = card.querySelector('.player.winner .player-name');
        winnerNameEl.textContent = match.winnerUsername || 'Unknown';
        winnerNameEl.style.color = getEloColor(match.winnerOldElo);
        card.querySelector('.player.winner .player-score').textContent = match.winnerScore ?? 0;

        const loserNameEl = card.querySelector('.player.loser .player-name');
        loserNameEl.textContent = match.loserUsername || 'Unknown';
        loserNameEl.style.color = getEloColor(match.loserOldElo);
        card.querySelector('.player.loser .player-score').textContent = match.loserScore ?? 0;

        // Player comments handling remains the same
        const winnerCommentEl = card.querySelector('.comment.winner-comment');
        const loserCommentEl = card.querySelector('.comment.loser-comment');
        const fullWinnerComment = match.winnerComment || "";
        const fullLoserComment = match.loserComment || "";

        winnerCommentEl.textContent = `"${truncateComment(fullWinnerComment)}"`;
        loserCommentEl.textContent = `"${truncateComment(fullLoserComment)}"`;

        if (fullWinnerComment) {
            winnerCommentEl.onclick = () => showPreviewCommentPopup(fullWinnerComment, match.winnerUsername || 'Winner', getEloColor(match.winnerOldElo));
        } else {
             winnerCommentEl.textContent = "-";
             winnerCommentEl.style.cursor = 'default';
             winnerCommentEl.onclick = null;
        }
        if (fullLoserComment) {
            loserCommentEl.onclick = () => showPreviewCommentPopup(fullLoserComment, match.loserUsername || 'Loser', getEloColor(match.loserOldElo));
        } else {
             loserCommentEl.textContent = "-";
             loserCommentEl.style.cursor = 'default';
             loserCommentEl.onclick = null;
        }

        // Now handle the community comments section
        const commentsSection = wrapper.querySelector('.community-comments-section');
        const commentsContainer = commentsSection.querySelector('.comments-container');
        const noCommentsMsg = commentsContainer.querySelector('.no-comments-message');
        const addCommentBtn = commentsSection.querySelector('.add-comment-btn');

        // Get the comments for this match
        const matchComments = commentsMap[match.id] || [];

        // Clear existing comments if any
        while (commentsContainer.firstChild && commentsContainer.firstChild !== noCommentsMsg) {
            commentsContainer.removeChild(commentsContainer.firstChild);
        }

        // Setup add comment button
        addCommentBtn.addEventListener('click', () => {
            showAddCommentPopup(match.id);
        });

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
                commentEl.className = 'comment-item';
                
                // Get truncated text for display
                const displayText = truncateToWords(comment.text || "", 15);
                
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
                
                // Add click handler to show full comment in lightbox
                commentEl.addEventListener('click', () => {
                    showFullCommentLightbox(comment);
                });
                
                // Insert at the beginning to show newest first (assuming they're sorted by time)
                commentsContainer.insertBefore(commentEl, commentsContainer.firstChild);
            });
        } else {
            if (noCommentsMsg) noCommentsMsg.style.display = 'block';
        }

        container.appendChild(cardClone);
    });
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
 * Shows the popup for adding a comment
 * @param {string} matchId The ID of the match to comment on
 */
function showAddCommentPopup(matchId) {
    // Check if user is authenticated
    const currentUser = window.auth.currentUser;
    if (!currentUser) {
        alert("You need to be signed in to leave a comment");
        return;
    }
    
    const popup = document.getElementById('commentAddPopup');
    const overlay = document.getElementById('commentAddOverlay');
    
    if (!popup || !overlay) {
        console.error("Comment popup elements not found");
        return;
    }
    
    // Set up the form with match ID
    const matchIdField = document.getElementById('commentMatchId');
    if (matchIdField) {
        matchIdField.value = matchId;
    }
    
    // Reset the comment text field
    const commentTextField = document.getElementById('commentText');
    if (commentTextField) {
        commentTextField.value = '';
    }
    
    // Set up word counter if it exists
    setupWordCounter();
    
    // Show the popup
    popup.style.display = 'block';
    overlay.style.display = 'block';
    
    // Focus on comment text area
    if (commentTextField) {
        commentTextField.focus();
    }
    
    console.log("Comment popup opened for match ID:", matchId);
}

function showPreviewCommentPopup(comment, player, color) {
  const popup = document.getElementById('commentPopupPreview');
  const overlay = document.getElementById('commentOverlayPreview');
  const title = document.getElementById('commentPopupTitlePreview');
  const content = document.getElementById('commentPopupContentPreview');

  if (!popup || !overlay || !title || !content) return;

  title.style.color = color;
  title.textContent = `${player}'s Comment`;
  content.textContent = comment;

  popup.style.display = 'block';
  overlay.style.display = 'block';
}

function closePreviewCommentPopup() {
  const popup = document.getElementById('commentPopupPreview');
  const overlay = document.getElementById('commentOverlayPreview');
  if (popup) popup.style.display = 'none';
  if (overlay) overlay.style.display = 'none';
}

function showFullCommentLightbox(comment) {
    // Use the existing popup system to show the full comment
    const popup = document.getElementById('commentPopupPreview');
    const overlay = document.getElementById('commentOverlayPreview');
    const title = document.getElementById('commentPopupTitlePreview');
    const content = document.getElementById('commentPopupContentPreview');

    if (!popup || !overlay || !title || !content) return;

    title.style.color = "#fff";
    title.textContent = `Comment from ${comment.username}`;
    content.textContent = comment.text;
    
    // Add date information if available
    if (comment.timestamp) {
        const date = new Date(comment.timestamp.seconds * 1000);
        const dateStr = date.toLocaleString();
        content.innerHTML = `<p>${comment.text}</p><small style="color:#aaa; display:block; text-align:right; margin-top:10px;">Posted on ${dateStr}</small>`;
    } else {
        content.textContent = comment.text;
    }

    popup.style.display = 'block';
    overlay.style.display = 'block';
}

/**
 * Sets up the word counter for the comment textarea
 */
function setupWordCounter() {
    const commentText = document.getElementById('commentText');
    const wordCount = document.getElementById('wordCount');
    
    if (!commentText || !wordCount) return;
    
    // Initialize counter
    updateWordCount();
    
    // Update counter on input
    commentText.addEventListener('input', updateWordCount);
    
    function updateWordCount() {
        const text = commentText.value.trim();
        const count = text ? text.split(/\s+/).filter(word => word.length > 0).length : 0;
        
        wordCount.textContent = count;
        
        // Visual feedback if over limit
        if (count > 15) {
            wordCount.style.color = '#ff4444';
        } else {
            wordCount.style.color = '#aaa';
        }
    }
}

export function setupPreviewEventListeners() {
    const prevButton = document.getElementById('previewPrevPage');
    const nextButton = document.getElementById('previewNextPage');
    const d1Button = document.getElementById('preview-d1-button');
    const d2Button = document.getElementById('preview-d2-button');
    const d3Button = document.getElementById('preview-d3-button');
    const filterSection = document.getElementById('filterSection');
    const applyFilterBtn = document.getElementById('applyFilterBtn');
    const clearFilterBtn = document.getElementById('clearFilterBtn');
    const filterUsernameInput = document.getElementById('filterUsername');

    if (!prevButton || !nextButton || !d1Button || !d2Button || !d3Button || !filterSection || !applyFilterBtn || !clearFilterBtn || !filterUsernameInput) {
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

    applyFilterBtn.addEventListener('click', () => {
        previewState.filterUsername = filterUsernameInput.value.trim();
        loadRecentMatchesPreview('current');
    });

    clearFilterBtn.addEventListener('click', () => {
        filterUsernameInput.value = '';
        previewState.filterUsername = '';
        loadRecentMatchesPreview('current');
    });

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

    // Word counter for comment form
    setupWordCounter();
}

// Make necessary functions available globally
window.showAddCommentPopup = showAddCommentPopup;
window.closeAddCommentPopup = closeAddCommentPopup;
window.submitComment = submitComment;

// --- END: Preview Section Functions ---