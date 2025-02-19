import { db, auth } from './firebase-config.js';
import { collection, query, orderBy, limit, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

export function initializePromotionTracker() {
    const promotionDetails = document.getElementById('promotion-details');
    const promotionContainer = document.querySelector('.promotion-container');
    
    console.log('Promotion tracker initializing...');

    // Ensure the banner starts hidden
    if (promotionContainer) {
        promotionContainer.style.display = 'none';
        console.log('Banner hidden on initialization');
    } else {
        console.warn('Promotion container not found in DOM');
        return;
    }
    
    const historyRef = collection(db, 'eloHistory');
    const q = query(
        historyRef, 
        orderBy('timestamp', 'desc'),
        limit(1)
    );

    onSnapshot(q, (snapshot) => {
        console.log('Checking for new history entries...');
        
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                const data = change.doc.data();
                console.log('New history entry:', data);
                console.log('Entry type:', data.type);
                
                // Check if this is a promotion event
                if (data.type === 'promotion' && data.rankAchieved) {
                    console.log('Found promotion event:', {
                        player: data.player,
                        rank: data.rankAchieved
                    });
                    
                    // Update and show the banner
                    promotionContainer.style.display = 'block';
                    const promotionText = `${data.player} was promoted to ${data.rankAchieved} by ${data.promotedBy || 'Admin'}`;
                    promotionDetails.textContent = promotionText;
                    promotionDetails.classList.add('new-promotion');
                    
                    // Auto-hide after delay
                    setTimeout(() => {
                        console.log('Hiding promotion banner');
                        promotionDetails.classList.remove('new-promotion');
                        setTimeout(() => {
                            promotionContainer.style.display = 'none';
                        }, 5000); // Hide after 5 seconds
                    }, 3000);

                    // Show personal lightbox if it's the current user
                    const currentUser = auth.currentUser;
                    if (currentUser && data.player === currentUser.displayName) {
                        showPromotionLightbox(data.rankAchieved);
                    }
                } else {
                    console.log('Not a promotion event, keeping banner hidden');
                    promotionContainer.style.display = 'none';
                }
            }
        });
    });
}

function showPromotionLightbox(rankName) {
    // Create modal if it doesn't exist
    let modal = document.getElementById('promotionModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'promotionModal';
        modal.className = 'promotion-modal';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="promotion-content">
            <h2 class="promotion-title">Congratulations!</h2>
            <p>You've been promoted to</p>
            <h3 class="rank-name">${rankName}</h3>
            <button class="promotion-button" onclick="document.getElementById('promotionModal').style.display='none'">
                Got it!
            </button>
        </div>
    `;

    modal.style.display = 'flex';

    // Close on click outside
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });
}