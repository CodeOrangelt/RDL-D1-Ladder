import { db, auth } from './firebase-config.js';
import { collection, query, orderBy, limit, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

export function initializePromotionTracker() {
    const promotionDetails = document.getElementById('promotion-details');
    const promotionContainer = document.querySelector('.promotion-container');
    
    // Hide promotion container initially
    if (promotionContainer) {
        promotionContainer.style.display = 'none';
    }
    
    // Listen for changes in eloHistory
    const historyRef = collection(db, 'eloHistory');
    const q = query(
        historyRef, 
        orderBy('timestamp', 'desc'),
        limit(1)
    );

    onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                const data = change.doc.data();
                if (data.type === 'promotion') {
                    // Show container and update banner
                    if (promotionContainer) {
                        promotionContainer.style.display = 'block';
                    }
                    
                    const promotionText = `${data.player} was promoted to ${data.rankAchieved} by ${data.promotedBy || 'Admin'}`;
                    if (promotionDetails) {
                        promotionDetails.textContent = promotionText;
                        promotionDetails.classList.add('new-promotion');
                        
                        // Hide banner after animation
                        setTimeout(() => {
                            promotionDetails.classList.remove('new-promotion');
                            // Hide container after delay
                            setTimeout(() => {
                                if (promotionContainer) {
                                    promotionContainer.style.display = 'none';
                                }
                            }, 5000); // Hide after 5 seconds
                        }, 3000);
                    }

                    // Show personal lightbox if it's the current user
                    const currentUser = auth.currentUser;
                    if (currentUser && data.player === currentUser.displayName) {
                        showPromotionLightbox(data.rankAchieved);
                    }
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