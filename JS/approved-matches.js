import { 
    collection, 
    query, 
    orderBy, 
    getDocs,
    where 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from './firebase-config.js';

// approved-matches.js

// Helper function to get ELO class
function getEloClass(elo) {
    if (elo >= 2000) return 'elo-emerald';
    if (elo >= 1800) return 'elo-gold';
    if (elo >= 1600) return 'elo-silver';
    if (elo >= 1400) return 'elo-bronze';
    return 'elo-unranked';
}

// Helper function to get player data
async function getPlayerData(username) {
    try {
        const playersRef = collection(db, 'players');
        const q = query(playersRef, where('username', '==', username));
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
            return snapshot.docs[0].data();
        }
        return null;
    } catch (error) {
        console.error('Error fetching player data:', error);
        return null;
    }
}

// Add pagination state
let currentPage = 1;
const matchesPerPage = 10;
let allMatches = [];

document.addEventListener('DOMContentLoaded', async () => {
    const approvedMatchesRef = collection(db, 'approvedMatches');
    const q = query(approvedMatchesRef, orderBy('createdAt', 'desc'));
    
    try {
        const querySnapshot = await getDocs(q);
        allMatches = await Promise.all(querySnapshot.docs.map(async doc => {
            const data = doc.data();
            const winnerData = await getPlayerData(data.winnerUsername);
            const loserData = await getPlayerData(data.loserUsername);
            
            return {
                ...data,
                winnerElo: winnerData?.eloRating || 1200,
                loserElo: loserData?.eloRating || 1200,
                date: data.createdAt ? new Date(data.createdAt.seconds * 1000).toLocaleString() : 'N/A',
                loserSuicidesValue: data.loserSuicides || data.suicides || 'N/A'
            };
        }));

        // Create pagination controls
        createPaginationControls();
        // Display first page
        displayMatchesPage(1);
    } catch (error) {
        console.error("Error fetching approved matches:", error);
        const tableBody = document.querySelector('#approved-matches-table tbody');
        tableBody.innerHTML = '<tr><td colspan="10">Error loading matches</td></tr>';
    }
});

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
    const table = document.querySelector('#approved-matches-table');
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

function displayMatchesPage(page) {
    const tableBody = document.querySelector('#approved-matches-table tbody');
    tableBody.innerHTML = '';
    currentPage = page;

    const start = (page - 1) * matchesPerPage;
    const end = start + matchesPerPage;
    const matchesToShow = allMatches.slice(start, end);

    matchesToShow.forEach(data => {
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
    const totalPages = Math.ceil(allMatches.length / matchesPerPage);
    const paginationContainer = document.querySelector('.pagination-wrapper');
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
            <button id="nextPage" ${page === totalPages ? 'disabled' : ''}>Next</button>
        </div>
    `;

    // Reattach event listeners
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
