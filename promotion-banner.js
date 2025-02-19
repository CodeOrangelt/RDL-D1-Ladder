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
    const promotionContainer = document.querySelector('.promotion-container');
    
    console.log('Promotion tracker initializing...');

    if (!promotionContainer) {
        console.warn('Promotion container not found in DOM');
        return;
    }

    // Clear existing banners and ensure container is ready
    promotionContainer.innerHTML = '';
    promotionContainer.style.display = 'none';
    
    const historyRef = collection(db, 'eloHistory');
    const q = query(
        historyRef, 
        where('type', '==', 'promotion'),
        orderBy('timestamp', 'desc'), 
        limit(5)
    );

    onSnapshot(q, async (snapshot) => {
        console.log('Checking for new history entries...');
        
        // Process promotions in order
        const promotions = [];
        for (const change of snapshot.docChanges()) {
            if (change.type === "added") {
                const data = change.doc.data();
                promotions.push({ id: change.doc.id, ...data });
            }
        }

        // Sort by timestamp to show newest first
        promotions.sort((a, b) => b.timestamp.toMillis() - a.timestamp.toMillis());

        // Show promotions with delay between each
        for (let i = 0; i < promotions.length; i++) {
            const promotion = promotions[i];
            
            if (promotion.rankAchieved) {
                const currentUser = auth.currentUser;
                if (!currentUser) {
                    console.log('No user logged in, skipping promotion banner');
                    continue;
                }

                const shouldShow = await checkPromotionViews(promotion.id, currentUser.uid);
                
                if (shouldShow) {
                    console.log('Showing promotion banner for:', promotion.player);
                    // Add delay between banners
                    setTimeout(() => {
                        showPromotionBanner(promotion, promotionContainer);
                    }, i * 1000); // 1 second delay between each banner

                    // Personal lightbox for promoted user
                    if (promotion.player === currentUser.displayName) {
                        showPromotionLightbox(promotion.rankAchieved);
                    }
                }
            }
        }
    });
}

function showPromotionBanner(data, container) {
    // Check if we already have 3 banners
    if (container.children.length >= 3) {
        container.removeChild(container.firstChild);
    }

    const bannerDiv = document.createElement('div');
    bannerDiv.className = 'promotion-banner';
    bannerDiv.setAttribute('data-rank', data.rankAchieved);
    bannerDiv.innerHTML = `
        <p>${data.player} was promoted to <span class="rank-indicator" data-rank="${data.rankAchieved}">${data.rankAchieved}</span> by ${data.promotedBy || 'Admin'}</p>
    `;
    container.appendChild(bannerDiv);
    container.style.display = 'block';

    // Add animation class after a brief delay
    setTimeout(() => {
        bannerDiv.classList.add('new-promotion');
    }, 100);

    // Remove banner after display time
    setTimeout(() => {
        bannerDiv.classList.remove('new-promotion');
        setTimeout(() => {
            bannerDiv.remove();
            // Hide container if no more banners
            if (container.children.length === 0) {
                container.style.display = 'none';
            }
        }, 5000);
    }, 8000);
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