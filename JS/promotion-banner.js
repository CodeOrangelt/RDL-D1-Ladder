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
    
    console.log('Rank change tracker initializing...');

    if (!promotionContainer) {
        console.warn('Promotion container not found in DOM');
        return;
    }

    // Add debug logging
    console.log('Found promotion container:', promotionContainer);

    promotionContainer.innerHTML = '';
    promotionContainer.style.display = 'none';
    
    const historyRef = collection(db, 'eloHistory');
    const q = query(
        historyRef, 
        where('type', 'in', ['promotion', 'demotion']), // Add demotion type
        orderBy('timestamp', 'desc'), 
        limit(5)
    );

    // Update the onSnapshot callback
    onSnapshot(q, async (snapshot) => {
        console.log('Checking for new rank changes...');
        
        const rankChanges = [];
        for (const change of snapshot.docChanges()) {
            if (change.type === "added") {
                const data = change.doc.data();
                console.log('New rank change detected:', data); // Debug log
                
                // Verify the type is being captured
                if (data.type && (data.type === 'promotion' || data.type === 'demotion')) {
                    rankChanges.push({ id: change.doc.id, ...data });
                }
            }
        }

        rankChanges.sort((a, b) => b.timestamp.toMillis() - a.timestamp.toMillis());

        for (let i = 0; i < rankChanges.length; i++) {
            const rankChange = rankChanges[i];
            
            if (rankChange.rankAchieved) {
                console.log(`Processing ${rankChange.type} for player:`, rankChange.player);
                
                const currentUser = auth.currentUser;
                if (!currentUser) {
                    console.log('No user logged in, showing rank change anyway');
                    setTimeout(() => {
                        showRankChangeBanner(rankChange, promotionContainer);
                    }, i * 1000);
                    continue;
                }

                const shouldShow = await checkPromotionViews(rankChange.id, currentUser.uid);
                
                if (shouldShow) {
                    console.log(`Showing ${rankChange.type} banner for:`, rankChange.player);
                    setTimeout(() => {
                        showRankChangeBanner(rankChange, promotionContainer);
                    }, i * 1000);

                    if (rankChange.player === currentUser.displayName) {
                        showRankChangeLightbox(rankChange.type, rankChange.rankAchieved);
                    }
                }
            }
        }
    });
}

function showRankChangeBanner(data, container) {
    if (container.children.length >= 3) {
        container.removeChild(container.firstChild);
    }

    const bannerDiv = document.createElement('div');
    bannerDiv.className = `rank-change-banner ${data.type}`; // Add type-specific class
    bannerDiv.setAttribute('data-rank', data.rankAchieved);
    
    const message = data.type === 'promotion' 
        ? `${data.player} was promoted to` 
        : `${data.player} was demoted to`;

    // Update the admin attribution based on type
    const byAdmin = data.type === 'promotion' 
        ? data.promotedBy || 'Admin'
        : data.demotedBy || 'Admin';

    bannerDiv.innerHTML = `
        <p>${message} <span class="rank-indicator" data-rank="${data.rankAchieved}">${data.rankAchieved}</span> by ${byAdmin}</p>
    `;
    container.appendChild(bannerDiv);
    container.style.display = 'block';

    // Add debug logging
    console.log('Showing rank change banner:', {
        type: data.type,
        player: data.player,
        rank: data.rankAchieved,
        by: byAdmin
    });

    setTimeout(() => {
        bannerDiv.classList.add('new-rank-change');
    }, 100);

    setTimeout(() => {
        bannerDiv.classList.remove('new-rank-change');
        setTimeout(() => {
            bannerDiv.remove();
            if (container.children.length === 0) {
                container.style.display = 'none';
            }
        }, 5000);
    }, 8000);
}

function showRankChangeLightbox(type, rankName) {
    let modal = document.getElementById('rankChangeModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'rankChangeModal';
        modal.className = `rank-change-modal ${type}`;
        document.body.appendChild(modal);
    }

    const title = type === 'promotion' ? 'Congratulations!' : 'Rank Update';
    const message = type === 'promotion' ? "You've been promoted to" : "You've been demoted to";

    modal.innerHTML = `
        <div class="rank-change-content">
            <h2 class="rank-change-title">${title}</h2>
            <p>${message}</p>
            <h3 class="rank-name">${rankName}</h3>
            <button class="rank-change-button" onclick="document.getElementById('rankChangeModal').style.display='none'">
                Got it!
            </button>
        </div>
    `;

    modal.style.display = 'flex';

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });
}