import { getEloHistory, resetPagination } from './elo-history.js';

let currentPage = 1;
let allMatches = [];
const matchesPerPage = 10;

async function displayEloHistory() {
    const tableBody = document.querySelector('#elo-history tbody');
    const paginationDiv = document.getElementById('pagination');
    
    try {
        const { entries, hasMore } = await getEloHistory();
        
        if (entries.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="6">No ELO history available</td></tr>';
            return;
        }

        allMatches = entries;

        tableBody.innerHTML = entries.map(entry => `
            <tr>
                <td>${entry.timestamp ? new Date(entry.timestamp.toDate()).toLocaleString() : 'N/A'}</td>
                <td>${entry.player}</td>
                <td>${entry.previousElo}</td>
                <td>${entry.newElo}</td>
                <td>${entry.change > 0 ? '+' + entry.change : entry.change}</td>
                <td>${entry.opponent}</td>
                <td>${entry.matchResult}</td>
            </tr>
        `).join('');

        createPaginationControls();

    } catch (error) {
        console.error("Error displaying ELO history:", error);
        tableBody.innerHTML = '<tr><td colspan="6">Error loading ELO history</td></tr>';
    }
}

function createPaginationControls() {
    const totalPages = Math.ceil(allMatches.length / matchesPerPage);
    const paginationContainer = document.createElement('div');
    paginationContainer.className = 'pagination-wrapper';
    paginationContainer.innerHTML = `
        <div class="pagination-controls">
            <button id="prevPage" ${currentPage === 1 ? 'disabled' : ''}>Previous</button>
            <div class="page-navigation">
                <span>Page ${currentPage} of ${totalPages}</span>
                <div class="page-search">
                    <input type="number" id="pageInput" min="1" max="${totalPages}" value="${currentPage}">
                    <button id="goToPage">Go</button>
                </div>
            </div>
            <button id="nextPage" ${currentPage === totalPages ? 'disabled' : ''}>Next</button>
        </div>
    `;

    // Add pagination controls after the table
    const table = document.querySelector('#elo-history');
    table.parentNode.insertBefore(paginationContainer, table.nextSibling);

    // Add event listeners
    document.getElementById('prevPage').addEventListener('click', () => {
        if (currentPage > 1) displayMatchesPage(currentPage - 1);
    });

    document.getElementById('nextPage').addEventListener('click', () => {
        if (currentPage < totalPages) displayMatchesPage(currentPage + 1);
    });

    document.getElementById('goToPage').addEventListener('click', () => {
        const pageInput = document.getElementById('pageInput');
        const pageNumber = parseInt(pageInput.value);
        if (pageNumber >= 1 && pageNumber <= totalPages) {
            displayMatchesPage(pageNumber);
        }
    });

    // Add enter key support for page input
    document.getElementById('pageInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const pageNumber = parseInt(e.target.value);
            if (pageNumber >= 1 && pageNumber <= totalPages) {
                displayMatchesPage(pageNumber);
            }
        }
    });
}

async function displayMatchesPage(pageNumber) {
    currentPage = pageNumber;
    const startIndex = (currentPage - 1) * matchesPerPage;
    const endIndex = startIndex + matchesPerPage;
    const matchesToDisplay = allMatches.slice(startIndex, endIndex);

    const tableBody = document.querySelector('#elo-history tbody');
    tableBody.innerHTML = matchesToDisplay.map(entry => `
        <tr>
            <td>${entry.timestamp ? new Date(entry.timestamp.toDate()).toLocaleString() : 'N/A'}</td>
            <td>${entry.player}</td>
            <td>${entry.previousElo}</td>
            <td>${entry.newElo}</td>
            <td>${entry.change > 0 ? '+' + entry.change : entry.change}</td>
            <td>${entry.opponent}</td>
            <td>${entry.matchResult}</td>
        </tr>
    `).join('');

    createPaginationControls();
}

// Initialize the display when the page loads
document.addEventListener('DOMContentLoaded', displayEloHistory);