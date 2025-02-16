import { 
    collection, 
    query, 
    orderBy, 
    getDocs 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from './firebase-config.js';

async function displayLadder() {
    const tableBody = document.querySelector('#ladder tbody');
    if (!tableBody) return;

    try {
        const playersRef = collection(db, 'players');
        const q = query(playersRef, orderBy('position', 'asc'));
        const querySnapshot = await getDocs(q);

        tableBody.innerHTML = ''; // Clear existing content
        
        let rank = 1;
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${rank}</td>
                <td>${data.username}</td>
                <td>${data.eloRating || 1200}</td>
            `;
            tableBody.appendChild(row);
            rank++;
        });
    } catch (error) {
        console.error("Error loading ladder:", error);
    }
}

document.addEventListener('DOMContentLoaded', displayLadder);
