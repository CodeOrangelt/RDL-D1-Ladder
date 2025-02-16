import { getEloHistory, resetPagination } from './elo-history.js';

let currentPage = 1;

async function displayEloHistory() {
    const tableBody = document.querySelector('#elo-history tbody');
    const paginationDiv = document.getElementById('pagination');
    
    try {
        const { entries, hasMore } = await getEloHistory();
        
        if (entries.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="6">No ELO history available</td></tr>';
            return;
        }

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

        // Update pagination buttons
        paginationDiv.innerHTML = `
            <button id="prevPage" ${currentPage === 1 ? 'disabled' : ''}>Previous</button>
            <span>Page ${currentPage}</span>
            <button id="nextPage" ${!hasMore ? 'disabled' : ''}>Next</button>
        `;

        // Add event listeners for pagination
        document.getElementById('nextPage')?.addEventListener('click', loadNextPage);
        document.getElementById('prevPage')?.addEventListener('click', loadPrevPage);

    } catch (error) {
        console.error("Error displaying ELO history:", error);
        tableBody.innerHTML = '<tr><td colspan="6">Error loading ELO history</td></tr>';
    }
}

async function loadNextPage() {
    const { entries, hasMore } = await getEloHistory(true);
    if (entries.length > 0) {
        currentPage++;
        displayEloHistory();
    }
}

async function loadPrevPage() {
    if (currentPage > 1) {
        currentPage--;
        resetPagination();
        // Reload up to the current page
        for (let i = 1; i < currentPage; i++) {
            await getEloHistory(true);
        }
        displayEloHistory();
    }
}

// Initialize the display when the page loads
document.addEventListener('DOMContentLoaded', displayEloHistory);