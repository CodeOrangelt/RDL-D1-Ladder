import {
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  startAfter,
  endBefore,
  limitToLast
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Global state for matches & settings
export const state = {
  currentMode: "D1", // Default to D1
  currentPage: 1,
  matchesPerPage: 10,
  lastVisible: null, // Store the last document for pagination
  firstVisible: null, // Store the first document for backward pagination
  cachedSnapshots: {}, // Cache snapshots by page
};

// Attach state to window for external access.
window.state = state;

// Allow external modules to change the game mode
export function setGameMode(mode) {
  state.currentMode = mode;
  state.currentPage = 1; // Reset page when changing mode
  state.lastVisible = null;
  state.firstVisible = null;
  state.cachedSnapshots = {}; // Clear cache when mode changes
}

// Helper: get color based on Elo thresholds
function getEloColor(elo) {
  const e = Number(elo);
  if (e >= 2000) return "#50C878";      // Emerald
  else if (e >= 1800) return "#FFD700"; // Gold
  else if (e >= 1600) return "#C0C0C0"; // Silver
  else if (e >= 1400) return "#CD7F32"; // Bronze
  else return "#808080";              // Unranked/Default
}

// Helper: Update pagination controls enabling/disabling
function updatePaginationControls(hasNextPage) {
  const firstPageButton = document.getElementById("firstPage");
  const prevPageButton = document.getElementById("prevPage");
  const nextPageButton = document.getElementById("nextPage");
  const pageInfo = document.getElementById("page-info");
  if (!firstPageButton || !prevPageButton || !nextPageButton || !pageInfo) return;
  
  // Update text info
  pageInfo.textContent = `Page ${state.currentPage}`;
  
  // Enable Prev/First if not on page 1
  if (state.currentPage > 1) {
    firstPageButton.disabled = false;
    prevPageButton.disabled = false;
  } else {
    firstPageButton.disabled = true;
    prevPageButton.disabled = true;
  }
  
  // Enable Next only if more pages exist
  nextPageButton.disabled = !hasNextPage;
}

// Main function to load matches
export async function loadMatches() {
  const loadingIndicator = document.getElementById("loading-indicator");
  if (loadingIndicator) loadingIndicator.style.display = "block";
  
  const collectionName = state.currentMode === "D1" ? "approvedMatches" : "approvedMatchesD2";
  const orderField = state.currentMode === "D1" ? "createdAt" : "approvedAt";
  const searchTerm = sessionStorage.getItem("playerSearchTerm");
  
  // Create cache key based on mode, page and search term
  const cacheKey = `${collectionName}_${state.currentPage}_${searchTerm || "all"}`;
  
  try {
    console.log(`Loading ${state.currentMode} matches - Page ${state.currentPage}`);
    
    // Check if we have this page cached
    if (state.cachedSnapshots[cacheKey]) {
      console.log(`Using cached data for ${cacheKey}`);
      displayMatches(state.cachedSnapshots[cacheKey]);
      return;
    }
    
    const matchesRef = collection(window.db, collectionName);
    let q;
    
    // Build query based on pagination direction
    if (state.currentPage === 1) {
      // First page - no pagination cursor needed
      q = query(
        matchesRef, 
        orderBy(orderField, "desc"), 
        limit(state.matchesPerPage)
      );
    } else if (state.lastVisible && state.currentPage > (state.cachedSnapshots[cacheKey-1] ? state.cachedSnapshots[cacheKey-1].currentPage : 0)) {
      // Next page - use last visible document as start point
      q = query(
        matchesRef,
        orderBy(orderField, "desc"),
        startAfter(state.lastVisible),
        limit(state.matchesPerPage)
      );
    } else if (state.firstVisible && state.currentPage < (state.cachedSnapshots[cacheKey+1] ? state.cachedSnapshots[cacheKey+1].currentPage : Infinity)) {
      // Previous page - use first visible document as end point
      q = query(
        matchesRef,
        orderBy(orderField, "desc"),
        endBefore(state.firstVisible),
        limitToLast(state.matchesPerPage)
      );
    } else {
      // Fallback if we've lost track - reset to page 1
      state.currentPage = 1;
      q = query(
        matchesRef, 
        orderBy(orderField, "desc"), 
        limit(state.matchesPerPage)
      );
    }
    
    // Execute query
    const snapshot = await getDocs(q);
    
    console.log(`Query returned ${snapshot.size} matches`);
    
    // Update pagination controls
    updatePaginationControls(snapshot.size === state.matchesPerPage);
    
    // Cache pagination markers
    if (!snapshot.empty) {
      state.lastVisible = snapshot.docs[snapshot.docs.length - 1];
      state.firstVisible = snapshot.docs[0];
      
      // Cache this snapshot
      state.cachedSnapshots[cacheKey] = snapshot;
    }
    
    displayMatches(snapshot);
  } catch (error) {
    console.error(`Error fetching ${state.currentMode} matches:`, error);
    displayError(error);
  } finally {
    if (loadingIndicator) loadingIndicator.style.display = "none";
    updatePageTitle();
  }
}

// Helper function to display matches
function displayMatches(snapshot) {
  const tableBody = document.querySelector("#approved-matches-table tbody");
  
  if (!tableBody) return;
  
  if (snapshot.empty) {
    tableBody.innerHTML = `<tr><td colspan="10" style="text-align: center;">No matches found</td></tr>`;
    return;
  }
  
  let html = '';
  snapshot.forEach((doc) => {
    const match = doc.data();
    const approvedDate = match.approvedAt || match.createdAt 
      ? new Date((match.approvedAt || match.createdAt).seconds * 1000)
      : new Date();
    
    const searchTerm = sessionStorage.getItem("playerSearchTerm");
    
    // Filter by search term if provided
    if (searchTerm) {
      const winnerUsername = (match.winnerUsername || "").toLowerCase();
      const loserUsername = (match.loserUsername || "").toLowerCase();
      
      if (!winnerUsername.includes(searchTerm) && !loserUsername.includes(searchTerm)) {
        return;
      }
    }
    
    // Get ELO colors for winner and loser based on their ELO values
    const winnerEloColor = getEloColor(match.winnerOldElo);
    const loserEloColor = getEloColor(match.loserOldElo);
    
    // Generate truncated comments with popups
    const winnerComment = match.winnerComment || "None";
    const loserComment = match.loserComment || "None";
    
    // Get first word or up to 10 characters
    const truncateText = (text) => {
      const firstWord = text.split(' ')[0];
      return firstWord.length > 10 ? firstWord.substring(0, 10) + '...' : firstWord;
    };
    
    const winnerCommentTruncated = truncateText(winnerComment) + (winnerComment.length > truncateText(winnerComment).length ? '...' : '');
    const loserCommentTruncated = truncateText(loserComment) + (loserComment.length > truncateText(loserComment).length ? '...' : '');
    
    html += `
      <tr>
        <td><span style="color: ${winnerEloColor};">${match.winnerUsername || "Unknown"}</span></td>
        <td><span style="color: ${loserEloColor};">${match.loserUsername || "Unknown"}</span></td>
        <td>${match.winnerScore || "0"}</td>
        <td>${match.loserScore || "0"}</td>
        <td>${match.winnerSuicides || "0"}</td>
        <td>${match.loserSuicides || "0"}</td>
        <td>${match.mapPlayed || "Unknown"}</td>
        <td><span class="comment-link" data-comment="${winnerComment.replace(/"/g, '&quot;')}" 
            data-player="${match.winnerUsername || 'Winner'}" 
            data-color="${winnerEloColor}">${winnerCommentTruncated}</span></td>
        <td><span class="comment-link" data-comment="${loserComment.replace(/"/g, '&quot;')}" 
            data-player="${match.loserUsername || 'Loser'}" 
            data-color="${loserEloColor}">${loserCommentTruncated}</span></td>
        <td>${approvedDate.toLocaleString()}</td>
      </tr>
    `;
  });
  
  if (html === '') {
    html = `<tr><td colspan="10" style="text-align: center;">No matches match the search criteria</td></tr>`;
  }
  
  tableBody.innerHTML = html;
  
  // Add event listeners for comment links after rendering
  document.querySelectorAll('.comment-link').forEach(link => {
    link.addEventListener('click', function() {
      showCommentPopup(
        this.dataset.comment, 
        this.dataset.player, 
        this.dataset.color
      );
    });
  });
}

function updatePageTitle() {
  const pageTitle = document.getElementById("page-title");
  if (!pageTitle) return;
  pageTitle.textContent = state.currentMode === "D1" ? "D1 Approved Matches" : "D2 Approved Matches";
}

// Function to show comment popup
function showCommentPopup(comment, player, color) {
  const popup = document.getElementById('commentPopup');
  const overlay = document.getElementById('commentOverlay');
  const title = document.getElementById('commentPopupTitle');
  const content = document.getElementById('commentPopupContent');
  
  // Apply ELO color to the entire title element instead of just the player name
  title.style.color = color;
  title.textContent = `${player}'s Comment`;
  
  // Set comment content
  content.textContent = comment;
  
  // Show popup
  popup.style.display = 'block';
  overlay.style.display = 'block';
}

// Event listener for close button
document.addEventListener('DOMContentLoaded', () => {
  const closeBtn = document.getElementById('closeCommentPopup');
  const overlay = document.getElementById('commentOverlay');
  const popup = document.getElementById('commentPopup');
  
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      popup.style.display = 'none';
      overlay.style.display = 'none';
    });
  }
  
  // Also close when clicking outside the popup
  if (overlay) {
    overlay.addEventListener('click', () => {
      popup.style.display = 'none';
      overlay.style.display = 'none';
    });
  }
});