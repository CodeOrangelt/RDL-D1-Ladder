import { db, auth } from './firebase-config.js';
import { collection, query, orderBy, limit, onSnapshot, doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const MAX_VIEWS = 5;

async function checkPromotionViews(promotionId, userId) {
    try {
        const viewsRef = doc(db, 'promotionViews', `${promotionId}_${userId}`);
        const viewsDoc = await getDoc(viewsRef);
        
        if (!viewsDoc.exists()) {
            // First view
            await setDoc(viewsRef, { views: 1 });
            return true;
        }
        
        const views = viewsDoc.data().views;
        if (views < MAX_VIEWS) {
            // Increment views
            await setDoc(viewsRef, { views: views + 1 }, { merge: true });
            return true;
        }
        
        return false; // Max views reached
    } catch (error) {
        console.error('Error checking promotion views:', error);
        return false;
    }
}

export function initializePromotionTracker() {
    const promotionDetails = document.getElementById('promotion-details');
    const promotionContainer = document.querySelector('.promotion-container');
    
    console.log('Promotion tracker initializing...');

    if (!promotionContainer) {
        console.warn('Promotion container not found in DOM');
        return;
    }

    promotionContainer.style.display = 'none';
    
    const historyRef = collection(db, 'eloHistory');
    const q = query(historyRef, orderBy('timestamp', 'desc'), limit(1));

    onSnapshot(q, async (snapshot) => {
        console.log('Checking for new history entries...');
        
        for (const change of snapshot.docChanges()) {
            if (change.type === "added") {
                const data = change.doc.data();
                console.log('New history entry:', data);
                
                if (data.type === 'promotion' && data.rankAchieved) {
                    const currentUser = auth.currentUser;
                    if (!currentUser) {
                        console.log('No user logged in, skipping promotion banner');
                        return;
                    }

                    // Check if user should see this promotion
                    const promotionId = change.doc.id;
                    const shouldShow = await checkPromotionViews(promotionId, currentUser.uid);
                    
                    if (shouldShow) {
                        console.log('Showing promotion banner (view count not exceeded)');
                        promotionContainer.style.display = 'block';
                        const promotionText = `${data.player} was promoted to ${data.rankAchieved} by ${data.promotedBy || 'Admin'}`;
                        promotionDetails.textContent = promotionText;
                        promotionDetails.classList.add('new-promotion');
                        
                        setTimeout(() => {
                            promotionDetails.classList.remove('new-promotion');
                            setTimeout(() => {
                                promotionContainer.style.display = 'none';
                            }, 5000);
                        }, 3000);

                        // Personal lightbox for promoted user
                        if (data.player === currentUser.displayName) {
                            showPromotionLightbox(data.rankAchieved);
                        }
                    } else {
                        console.log('Max views reached for this promotion, not showing banner');
                    }
                }
            }
        }
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