import { 
    collection, 
    query, 
    orderBy, 
    getDocs,
    where,
    limit,
    startAfter
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from './firebase-config.js';

// approved-matches.js

// Add this line to update the title when the D1 script loads
const title = document.querySelector('h1');
if (title) {
    title.textContent = 'D1 Approved Matches';
}

// Helper function to get ELO class
function getEloClass(elo) {
    if (elo >= 2000) return 'elo-emerald';
    if (elo >= 1800) return 'elo-gold';
    if (elo >= 1600) return 'elo-silver';
    if (elo >= 1400) return 'elo-bronze';
    return 'elo-unranked';
}

// Add pagination state
let currentPage = 1;
const matchesPerPage = 10;
let lastVisibleDoc = null;
let firstVisibleDoc = null;
let pageCache = new Map(); // Cache for pages we've already fetched
let totalDocCount = 0;

document.addEventListener('DOMContentLoaded', async () => {
    await getTotalMatchCount();
    await fetchMatchesPage(1);
});

// Get the total count of matches (only needed once)
async function getTotalMatchCount() {
    try {
        const countSnapshot = await getDocs(
            query(collection(db, 'approvedMatches'))
        );
        totalDocCount = countSnapshot.size;
    } catch (error) {
        console.error("Error getting total count:", error);
        totalDocCount = 0;
    }
}

// Fetch a specific page of matches
async function fetchMatchesPage(page) {
    // Check if page is in cache
    if (pageCache.has(page)) {
        const cachedData = pageCache.get(page);
        displayMatches(cachedData.matches);
        lastVisibleDoc = cachedData.lastDoc;
        firstVisibleDoc = cachedData.firstDoc;
        updatePaginationControls(page);
        return;
    }
    
    const tableBody = document.querySelector('#approved-matches-table tbody');
    tableBody.innerHTML = '<tr><td colspan="10">Loading matches...</td></tr>';
    
    try {
        let matchesQuery;
        
        if (page === 1) {
            // First page query
            matchesQuery = query(
                collection(db, 'approvedMatches'),
                orderBy('createdAt', 'desc'),
                limit(matchesPerPage)
            );
        } else if (page > currentPage) {
            // Next page
            matchesQuery = query(
                collection(db, 'approvedMatches'),
                orderBy('createdAt', 'desc'),
                startAfter(lastVisibleDoc),
                limit(matchesPerPage)
            );
        } else {
            // Previous page - we should have this in cache ideally
            // This is a fallback and would require additional handling for proper prev pagination
            matchesQuery = query(
                collection(db, 'approvedMatches'),
                orderBy('createdAt', 'desc'),
                limit(page * matchesPerPage)
            );
        }

        const querySnapshot = await getDocs(matchesQuery);
        
        if (querySnapshot.empty) {
            tableBody.innerHTML = '<tr><td colspan="10">No matches found</td></tr>';
            return;
        }

        const matches = querySnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                ...data,
                id: doc.id,
                winnerElo: data.winnerOldElo || data.winnerElo || 1200,
                loserElo: data.loserOldElo || data.loserElo || 1200,
                date: data.createdAt ? new Date(data.createdAt.seconds * 1000).toLocaleString() : 'N/A',
                loserSuicidesValue: data.loserSuicides || data.suicides || 'N/A'
            };
        });

        // Update document pointers for pagination
        lastVisibleDoc = querySnapshot.docs[querySnapshot.docs.length - 1];
        firstVisibleDoc = querySnapshot.docs[0];
        
        // Cache this page
        pageCache.set(page, {
            matches: matches,
            lastDoc: lastVisibleDoc,
            firstDoc: firstVisibleDoc
        });
        
        // Update current page and display matches
        currentPage = page;
        displayMatches(matches);
        updatePaginationControls(page);
        
    } catch (error) {
        console.error("Error fetching matches:", error);
        tableBody.innerHTML = '<tr><td colspan="10">Error loading matches</td></tr>';
    }
}

function displayMatches(matches) {
    const tableBody = document.querySelector('#approved-matches-table tbody');
    tableBody.innerHTML = '';
    
    matches.forEach(data => {
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
}

function updatePaginationControls(page) {
    const totalPages = Math.ceil(totalDocCount / matchesPerPage);
    
    // Create or update pagination controls
    let paginationContainer = document.querySelector('.pagination-wrapper');
    if (!paginationContainer) {
        paginationContainer = document.createElement('div');
        paginationContainer.className = 'pagination-wrapper';
        const table = document.querySelector('#approved-matches-table');
        table.parentNode.insertBefore(paginationContainer, table.nextSibling);
    }
    
    paginationContainer.innerHTML = `
        <div class="pagination-controls">
            <button id="prevPage" ${page === 1 ? 'disabled' : ''}>Previous</button>
            <div class="page-navigation">
                <span>Page ${page} of ${totalPages}</span>
                <div class="page-search">
                    <input type="number" id="pageInput" min="1" max="${totalPages}" value="${page}">
                    <button id="goToPage">Go</button>
                </div>
            </div>
            <button id="nextPage" ${page === totalPages || totalPages === 0 ? 'disabled' : ''}>Next</button>
        </div>
    `;

    // Attach event listeners
    document.getElementById('prevPage').addEventListener('click', () => {
        if (currentPage > 1) fetchMatchesPage(currentPage - 1);
    });

    document.getElementById('nextPage').addEventListener('click', () => {
        if (currentPage < totalPages) fetchMatchesPage(currentPage + 1);
    });

    document.getElementById('goToPage').addEventListener('click', () => {
        const pageInput = document.getElementById('pageInput');
        const pageNumber = parseInt(pageInput.value);
        if (pageNumber >= 1 && pageNumber <= totalPages) {
            fetchMatchesPage(pageNumber);
        }
    });

    document.getElementById('pageInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const pageNumber = parseInt(e.target.value);
            if (pageNumber >= 1 && pageNumber <= totalPages) {
                fetchMatchesPage(pageNumber);
            }
        }
    });
}
