import { db, auth } from './firebase-config.js';
import { collection, query, orderBy, limit, onSnapshot, doc, getDoc, setDoc, where } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

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

// Update the query to get more recent promotions
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
    // Get last 5 promotions instead of just 1
    const q = query(
        historyRef, 
        where('type', '==', 'promotion'),
        orderBy('timestamp', 'desc'), 
        limit(5)
    );

    onSnapshot(q, async (snapshot) => {
        console.log('Checking for new history entries...');
        
        for (const change of snapshot.docChanges()) {
            if (change.type === "added") {
                const data = change.doc.data();
                console.log('New promotion entry:', data);
                
                if (data.rankAchieved) {
                    const currentUser = auth.currentUser;
                    if (!currentUser) {
                        console.log('No user logged in, skipping promotion banner');
                        continue; // Use continue instead of return to check other promotions
                    }

                    const promotionId = change.doc.id;
                    const shouldShow = await checkPromotionViews(promotionId, currentUser.uid);
                    
                    if (shouldShow) {
                        console.log('Showing promotion banner for:', data.player);
                        showPromotionBanner(data, promotionContainer, promotionDetails);

                        // Personal lightbox for promoted user
                        if (data.player === currentUser.displayName) {
                            showPromotionLightbox(data.rankAchieved);
                        }
                    } else {
                        console.log('Max views reached for promotion:', promotionId);
                    }
                }
            }
        }
    });
}

// New function to handle showing promotion banners
function showPromotionBanner(data, container, detailsElement) {
    // Create a new banner for this promotion
    const bannerDiv = document.createElement('div');
    bannerDiv.className = 'promotion-banner new-promotion';
    bannerDiv.innerHTML = `
        <p>${data.player} was promoted to ${data.rankAchieved} by ${data.promotedBy || 'Admin'}</p>
    `;
    container.appendChild(bannerDiv);
    container.style.display = 'block';

    // Remove banner after animation
    setTimeout(() => {
        bannerDiv.classList.remove('new-promotion');
        setTimeout(() => {
            bannerDiv.remove();
            // Hide container if no more banners
            if (container.children.length === 0) {
                container.style.display = 'none';
            }
        }, 5000);
    }, 3000);
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