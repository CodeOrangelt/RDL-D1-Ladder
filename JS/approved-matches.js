import { rdlFirestore } from './firestore-wrapper.js';
const { 
    collection, getDocs, query, orderBy, where, limit, startAfter, Timestamp 
} = rdlFirestore;
import { db } from './firebase-config.js';

// Helper function to get ELO class
function getEloClass(elo) {
    if (elo >= 2000) return 'elo-emerald';
    if (elo >= 1800) return 'elo-gold';
    if (elo >= 1600) return 'elo-silver';
    if (elo >= 1400) return 'elo-bronze';
    return 'elo-unranked';
}

// Batch fetch player data to reduce individual reads
async function fetchPlayerElosInBatch(usernames) {
    const eloMap = {};
    
    try {
        if (!usernames.length) return eloMap;
        
        // Check for cached ELO data first
        const cacheKey = 'player_elos_' + usernames.sort().join('_');
        const cachedData = localStorage.getItem(cacheKey);
        const cacheTimestamp = localStorage.getItem(cacheKey + '_time');
        
        // Use cache if it's less than 5 minutes old
        if (cachedData && cacheTimestamp) {
            const ageInMinutes = (Date.now() - parseInt(cacheTimestamp)) / (1000 * 60);
            if (ageInMinutes < 5) {
                console.log('Using cached ELO data');
                return JSON.parse(cachedData);
            }
        }
        
        // Optimize batch size to maximum allowed by Firestore (10)
        const batchSize = 10;
        const batches = [];
        
        for (let i = 0; i < usernames.length; i += batchSize) {
            const batch = usernames.slice(i, i + batchSize);
            batches.push(batch);
        }
        
        // Process each batch with parallel queries
        const batchPromises = batches.map(async batch => {
            const playersRef = collection(db, 'players');
            const q = query(playersRef, where('username', 'in', batch));
            const snapshot = await getDocs(q);
            
            snapshot.forEach(doc => {
                const data = doc.data();
                eloMap[data.username] = data.eloRating || 1200;
            });
        });
        
        await Promise.all(batchPromises);
        
        // Cache the results
        localStorage.setItem(cacheKey, JSON.stringify(eloMap));
        localStorage.setItem(cacheKey + '_time', Date.now().toString());
        
        return eloMap;
    } catch (error) {
        console.error(`Error getting batch ELO ratings:`, error);
        return eloMap;
    }
}

// Add state management
const state = {
    currentPage: 1,
    matchesPerPage: 10,
    currentMatches: [],
    lastVisible: null,
    hasNextPage: true,
    hasPrevPage: false,
    totalPages: 0,
    pageCache: {}, // Cache for each page of results
    estimatedTotal: 0
};

let loadingIndicator;

// Create loading indicator
function createLoadingIndicator() {
    loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'loading-indicator';
    loadingIndicator.innerHTML = `
        <div class="spinner"></div>
        <p>Loading matches...</p>
    `;
    loadingIndicator.style.cssText = `
        display: none;
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background-color: rgba(0, 0, 0, 0.8);
        padding: 20px;
        border-radius: 8px;
        color: white;
        text-align: center;
        z-index: 1000;
    `;
    
    const spinner = loadingIndicator.querySelector('.spinner');
    spinner.style.cssText = `
        width: 40px;
        height: 40px;
        border: 4px solid rgba(255, 255, 255, 0.3);
        border-top: 4px solid #50C878;
        border-radius: 50%;
        margin: 0 auto 10px;
        animation: spin 1s linear infinite;
    `;
    
    // Add animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);
    document.body.appendChild(loadingIndicator);
}

function showLoading() {
    if (loadingIndicator) loadingIndicator.style.display = 'block';
}

function hideLoading() {
    if (loadingIndicator) loadingIndicator.style.display = 'none';
}

// Count the total number of matches (approximate)
async function getApproximateMatchCount() {
    try {
        // First try to get from session storage to avoid unnecessary reads
        const cachedCount = sessionStorage.getItem('approvedMatchesCount');
        const cachedTime = sessionStorage.getItem('approvedMatchesCountTime');
        
        if (cachedCount && cachedTime) {
            const ageInMinutes = (Date.now() - parseInt(cachedTime)) / (1000 * 60);
            if (ageInMinutes < 30) { // Use cache if less than 30 minutes old
                return parseInt(cachedCount);
            }
        }
        
        // Get estimate by fetching just a few matches and checking their indices
        const matchesRef = collection(db, 'approvedMatches');
        const q = query(matchesRef, orderBy('createdAt', 'desc'), limit(1));
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) return 0;
        
        // Store in session storage
        const count = Math.max(100, snapshot.size * 100); // Conservative estimate
        sessionStorage.setItem('approvedMatchesCount', count.toString());
        sessionStorage.setItem('approvedMatchesCountTime', Date.now().toString());
        
        return count;
    } catch (error) {
        console.error('Error getting match count:', error);
        return 100; // Default fallback
    }
}

// Fetch one page of matches
async function fetchMatchesPage(isNextPage = true) {
    showLoading();
    
    try {
        // Check if we've cached this page already
        if (state.pageCache[state.currentPage]) {
            console.log(`Using cached data for page ${state.currentPage}`);
            state.currentMatches = state.pageCache[state.currentPage].matches;
            state.lastVisible = state.pageCache[state.currentPage].lastVisible;
            state.hasNextPage = state.pageCache[state.currentPage].hasNextPage;
            state.hasPrevPage = state.currentPage > 1;
            hideLoading();
            return state.currentMatches;
        }
        
        const matchesRef = collection(db, 'approvedMatches');
        let q;
        
        if (isNextPage && state.lastVisible) {
            // Fetch next page
            console.log(`Fetching next page after document ID: ${state.lastVisible.id}`);
            q = query(
                matchesRef, 
                orderBy('createdAt', 'desc'), 
                startAfter(state.lastVisible), 
                limit(state.matchesPerPage)
            );
        } else if (!isNextPage && state.currentPage > 1 && state.pageCache[state.currentPage - 1]) {
            // For previous page, we use the cached data
            state.currentPage--;
            console.log(`Going back to cached page ${state.currentPage}`);
            state.currentMatches = state.pageCache[state.currentPage].matches;
            state.lastVisible = state.pageCache[state.currentPage].lastVisible;
            state.hasNextPage = state.pageCache[state.currentPage].hasNextPage;
            state.hasPrevPage = state.currentPage > 1;
            hideLoading();
            return state.currentMatches;
        } else {
            // First page or reset
            console.log(`Fetching first page of matches`);
            q = query(
                matchesRef, 
                orderBy('createdAt', 'desc'), 
                limit(state.matchesPerPage)
            );
            state.lastVisible = null;
        }
        
        console.log(`Executing Firestore query for page ${state.currentPage}`);
        const querySnapshot = await getDocs(q);
        console.log(`Retrieved ${querySnapshot.docs.length} matches`);
        
        // Check if we have more pages
        state.hasNextPage = querySnapshot.docs.length === state.matchesPerPage;
        state.hasPrevPage = state.currentPage > 1;
        
        // Update lastVisible for pagination
        if (querySnapshot.docs.length > 0) {
            state.lastVisible = querySnapshot.docs[querySnapshot.docs.length - 1];
        }
        
        // If no results and we're fetching next page, maybe we reached the end
        if (querySnapshot.docs.length === 0 && isNextPage) {
            console.log('No more matches found');
            state.hasNextPage = false;
            state.currentPage--; // Go back to previous page
            if (state.pageCache[state.currentPage]) {
                state.currentMatches = state.pageCache[state.currentPage].matches;
                state.lastVisible = state.pageCache[state.currentPage].lastVisible;
            }
            return state.currentMatches;
        }
        
        // Extract all unique usernames first
        const uniqueUsernames = new Set();
        querySnapshot.docs.forEach(doc => {
            const data = doc.data();
            if (data.winnerUsername) uniqueUsernames.add(data.winnerUsername);
            if (data.loserUsername) uniqueUsernames.add(data.loserUsername);
        });
        
        // Fetch all player data in batch
        const eloMap = await fetchPlayerElosInBatch([...uniqueUsernames]);
        
        // Map match data with player ELO ratings
        const matches = querySnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                winnerElo: eloMap[data.winnerUsername] || 1200,
                loserElo: eloMap[data.loserUsername] || 1200,
                date: data.createdAt ? new Date(data.createdAt.seconds * 1000).toLocaleString() : 'N/A',
                loserSuicidesValue: data.loserSuicides || data.suicides || 'N/A'
            };
        });
        
        state.currentMatches = matches;
        
        // Cache this page
        state.pageCache[state.currentPage] = {
            matches,
            lastVisible: state.lastVisible,
            hasNextPage: state.hasNextPage
        };
        
        console.log(`Page ${state.currentPage} loaded and cached with ${matches.length} matches`);
        
        return matches;
    } catch (error) {
        console.error("Error fetching matches page:", error);
        return [];
    } finally {
        hideLoading();
    }
}

// Display current matches page
function displayCurrentMatches() {
    const tableBody = document.querySelector('#approved-matches-table tbody');
    if (!tableBody) {
        console.error("Table body not found");
        return;
    }
    
    tableBody.innerHTML = '';
    
    if (state.currentMatches.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="10">No matches found</td></tr>';
        return;
    }
    
    state.currentMatches.forEach(data => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>
                <a href="profile.html?username=${encodeURIComponent(data.winnerUsername)}" 
                   class="player-link ${getEloClass(data.winnerElo)}">
                    ${data.winnerUsername}
                </a>
            </td>
            <td>
                <a href="profile.html?username=${encodeURIComponent(data.loserUsername)}" 
                   class="player-link ${getEloClass(data.loserElo)}">
                    ${data.loserUsername}
                </a>
            </td>
            <td>${data.winnerScore}</td>
            <td>${data.loserScore}</td>
            <td>${data.winnerSuicides || 'N/A'}</td>
            <td>${data.loserSuicidesValue}</td>
            <td>${data.mapPlayed || 'N/A'}</td>
            <td>${data.winnerComment || 'N/A'}</td>
            <td>${data.loserComment || 'N/A'}</td>
            <td>${data.date}</td>
        `;
        tableBody.appendChild(row);
    });
    
    // Update pagination controls
    updatePaginationControls();
}

// Create pagination controls
function createPaginationControls() {
    // Check if pagination already exists
    let paginationContainer = document.querySelector('.pagination-wrapper');
    if (!paginationContainer) {
        paginationContainer = document.createElement('div');
        paginationContainer.className = 'pagination-wrapper';
        
        // Add pagination controls after the table
        const table = document.querySelector('#approved-matches-table');
        table.parentNode.insertBefore(paginationContainer, table.nextSibling);
    }
    
    updatePaginationControls();
}

// Update pagination controls
function updatePaginationControls() {
    const paginationContainer = document.querySelector('.pagination-wrapper');
    if (!paginationContainer) return;
    
    const approximatePages = Math.ceil(state.estimatedTotal / state.matchesPerPage);
    const displayPages = isNaN(approximatePages) ? '?' : approximatePages;
    
    console.log(`Updating pagination controls: Page ${state.currentPage} of ~${displayPages}`);
    console.log(`Previous: ${state.hasPrevPage ? 'enabled' : 'disabled'}, Next: ${state.hasNextPage ? 'enabled' : 'disabled'}`);
    
    paginationContainer.innerHTML = `
        <div class="pagination-controls">
            <button id="prevPage" ${!state.hasPrevPage ? 'disabled' : ''}>Previous</button>
            <div class="page-navigation">
                <span>Page ${state.currentPage} of ~${displayPages}</span>
                <div class="page-search">
                    <button id="firstPage">First</button>
                    <button id="lastPage" style="margin-left: 10px;">Last</button>
                </div>
            </div>
            <button id="nextPage" ${!state.hasNextPage ? 'disabled' : ''}>Next</button>
        </div>
    `;
    
    // Add event listeners after updating the HTML
    addPaginationEventListeners();
}

// Update event listeners to pagination controls
function addPaginationEventListeners() {
    const paginationContainer = document.querySelector('.pagination-wrapper');
    if (!paginationContainer) return;
    
    // Remove any existing event listeners by cloning and replacing elements
    const prevButton = document.getElementById('prevPage');
    const nextButton = document.getElementById('nextPage');
    const firstButton = document.getElementById('firstPage');
    const lastButton = document.getElementById('lastPage');
    
    // Remove old event listeners by cloning and replacing
    if (prevButton) {
        const newPrevButton = prevButton.cloneNode(true);
        prevButton.parentNode.replaceChild(newPrevButton, prevButton);
        newPrevButton.addEventListener('click', async (e) => {
            e.preventDefault();
            if (state.hasPrevPage) {
                console.log('Going to previous page');
                await goToPreviousPage();
            }
        });
    }
    
    if (nextButton) {
        const newNextButton = nextButton.cloneNode(true);
        nextButton.parentNode.replaceChild(newNextButton, nextButton);
        newNextButton.addEventListener('click', async (e) => {
            e.preventDefault();
            if (state.hasNextPage) {
                console.log('Going to next page');
                await goToNextPage();
            }
        });
    }
    
    if (firstButton) {
        const newFirstButton = firstButton.cloneNode(true);
        firstButton.parentNode.replaceChild(newFirstButton, firstButton);
        newFirstButton.addEventListener('click', async (e) => {
            e.preventDefault();
            if (state.currentPage !== 1) {
                console.log('Going to first page');
                await goToFirstPage();
            }
        });
    }
    
    if (lastButton) {
        const newLastButton = lastButton.cloneNode(true);
        lastButton.parentNode.replaceChild(newLastButton, lastButton);
        newLastButton.addEventListener('click', async (e) => {
            e.preventDefault();
            console.log('Going to last known page');
            await goToLastKnownPage();
        });
    }
}

// Navigation functions
async function goToNextPage() {
    try {
        showLoading();
        state.currentPage++;
        state.hasPrevPage = true;
        
        await fetchMatchesPage(true);
        displayCurrentMatches();
        
        console.log(`Navigated to page ${state.currentPage}`);
    } catch (error) {
        console.error("Error navigating to next page:", error);
        state.currentPage--; // Revert page change if there was an error
        hideLoading();
    }
}

async function goToPreviousPage() {
    try {
        if (state.currentPage <= 1) {
            console.log("Already on first page");
            return;
        }
        
        showLoading();
        
        // Direct access to cached previous page
        const previousPage = state.currentPage - 1;
        
        if (state.pageCache[previousPage]) {
            // Use cached data
            state.currentPage = previousPage;
            state.currentMatches = state.pageCache[previousPage].matches;
            state.lastVisible = state.pageCache[previousPage].lastVisible;
            state.hasNextPage = true; // We know there's at least one more page (the one we came from)
            state.hasPrevPage = previousPage > 1;
            
            console.log(`Going back to cached page ${previousPage}`);
            displayCurrentMatches();
            hideLoading();
        } else {
            // Need to restart from the beginning and page forward
            console.log("Previous page not cached, restarting from page 1");
            state.currentPage = 1;
            state.lastVisible = null;
            await fetchMatchesPage(true);
            
            // Now page forward until we reach the target page
            for (let i = 1; i < previousPage; i++) {
                state.currentPage++;
                await fetchMatchesPage(true);
            }
            
            displayCurrentMatches();
        }
    } catch (error) {
        console.error("Error navigating to previous page:", error);
        hideLoading();
    }
}

async function goToFirstPage() {
    try {
        if (state.currentPage === 1) {
            console.log("Already on first page");
            return;
        }
        
        showLoading();
        state.currentPage = 1;
        state.lastVisible = null;
        state.hasPrevPage = false;
        
        // Check if we already have the first page cached
        if (state.pageCache[1]) {
            state.currentMatches = state.pageCache[1].matches;
            state.lastVisible = state.pageCache[1].lastVisible;
            state.hasNextPage = state.pageCache[1].hasNextPage;
            displayCurrentMatches();
        } else {
            await fetchMatchesPage(true);
            displayCurrentMatches();
        }
        
        console.log('Navigated to first page');
    } catch (error) {
        console.error("Error navigating to first page:", error);
        hideLoading();
    }
}

async function goToLastKnownPage() {
    try {
        showLoading();
        
        // Find the highest page number in our cache
        const cachedPages = Object.keys(state.pageCache).map(Number);
        if (cachedPages.length === 0) {
            console.log("No cached pages, going to next page");
            await goToNextPage(); // Just go to next page if nothing is cached
            return;
        }
        
        // Go to highest known page
        const highestCachedPage = Math.max(...cachedPages);
        
        // If we're already on the highest page and there's a next page, try to go further
        if (state.currentPage === highestCachedPage && state.hasNextPage) {
            console.log("Already at highest cached page, trying to go further");
            await goToNextPage();
        } else if (state.currentPage !== highestCachedPage) {
            // Otherwise go to the highest cached page
            state.currentPage = highestCachedPage;
            state.currentMatches = state.pageCache[highestCachedPage].matches;
            state.lastVisible = state.pageCache[highestCachedPage].lastVisible;
            state.hasNextPage = state.pageCache[highestCachedPage].hasNextPage;
            state.hasPrevPage = highestCachedPage > 1;
            displayCurrentMatches();
            
            console.log(`Navigated to last known page: ${highestCachedPage}`);
        }
    } catch (error) {
        console.error("Error navigating to last known page:", error);
        hideLoading();
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    createLoadingIndicator();
    
    try {
        // Get an approximate count of matches
        state.estimatedTotal = await getApproximateMatchCount();
        
        // Initial fetch
        await fetchMatchesPage(true);
        
        // Create pagination controls
        createPaginationControls();
        
        // Display first page
        displayCurrentMatches();
    } catch (error) {
        console.error("Error initializing matches:", error);
        const tableBody = document.querySelector('#approved-matches-table tbody');
        if (tableBody) {
            tableBody.innerHTML = '<tr><td colspan="10">Error loading matches</td></tr>';
        }
        hideLoading();
    }
});

// Add CSS for loading indicator
const style = document.createElement('style');
style.textContent = `
    .pagination-wrapper {
        margin-top: 20px;
        text-align: center;
    }
    
    .pagination-controls {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 10px;
    }
    
    .page-navigation {
        display: flex;
        flex-direction: column;
        align-items: center;
        margin: 0 20px;
    }
    
    .page-search {
        margin-top: 10px;
        display: flex;
        align-items: center;
    }
    
    .pagination-controls button {
        padding: 8px 15px;
        background-color: #3a3a3a;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        transition: background-color 0.2s;
    }
    
    .pagination-controls button:hover:not([disabled]) {
        background-color: #50C878;
    }
    
    .pagination-controls button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
`;
document.head.appendChild(style);