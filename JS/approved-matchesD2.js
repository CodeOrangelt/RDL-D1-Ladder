// Language: JavaScript
// filepath: /c:/Descent Nexus Repo/RDL-D1-Ladder/JS/approved-matchesD2.js

import { 
    collection, 
    getDocs, 
    query, 
    orderBy, 
    limit 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from './firebase-config.js';

document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Clear any existing content
        const tableBody = document.querySelector('#approved-matches-table tbody');
        tableBody.innerHTML = '<tr><td colspan="10" style="text-align: center;">Loading D2 matches...</td></tr>';
        
        // Get matches from D2 collection
        const matchesRef = collection(db, 'approvedMatchesD2');
        const q = query(matchesRef, orderBy('approvedAt', 'desc'), limit(100));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            tableBody.innerHTML = '<tr><td colspan="10" style="text-align: center;">No D2 matches found</td></tr>';
            return;
        }
        
        // Build table rows
        let tableContent = '';
        querySnapshot.forEach(doc => {
            const match = doc.data();
            const approvedDate = match.approvedAt ? new Date(match.approvedAt.seconds * 1000) : new Date();
            
            tableContent += `
                <tr>
                    <td>${match.winnerUsername || 'Unknown'}</td>
                    <td>${match.loserUsername || 'Unknown'}</td>
                    <td>${match.winnerScore || '20'}</td>
                    <td>${match.loserScore || '0'}</td>
                    <td>${match.winnerSuicides || '0'}</td>
                    <td>${match.suicides || '0'}</td>
                    <td>${match.mapPlayed || 'Unknown'}</td>
                    <td>${match.winnerComment || 'None'}</td>
                    <td>${match.loserComment || 'None'}</td>
                    <td>${approvedDate.toLocaleString()}</td>
                </tr>
            `;
        });
        
        tableBody.innerHTML = tableContent;
        
        // Update the title to indicate D2 ladder
        const title = document.querySelector('h1');
        if (title) {
            title.textContent = 'D2 Approved Matches';
        }
        
    } catch (error) {
        console.error('Error fetching approved matches:', error);
        const tableBody = document.querySelector('#approved-matches-table tbody');
        tableBody.innerHTML = '<tr><td colspan="10" style="text-align: center;">Error loading matches. Please try again.</td></tr>';
    }
});