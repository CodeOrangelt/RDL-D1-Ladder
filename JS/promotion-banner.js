import { db, auth } from './firebase-config.js';
import { collection, query, orderBy, limit, onSnapshot, doc, getDoc, setDoc, where } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const MAX_VIEWS = 5;

// Add error handling for the view counter
async function checkPromotionViews(promotionId, userId) {
    if (!promotionId || !userId) {
        console.warn('Missing promotionId or userId');
        return false;
    }

    try {
        const viewsRef = doc(db, 'promotionViews', `${promotionId}_${userId}`);
        const viewsDoc = await getDoc(viewsRef);
        
        if (!viewsDoc.exists()) {
            await setDoc(viewsRef, { 
                views: 1,
                firstViewedAt: new Date(),
                lastViewedAt: new Date()
            });
            return true;
        }
        
        const views = viewsDoc.data().views;
        if (views < MAX_VIEWS) {
            await setDoc(viewsRef, { 
                views: views + 1,
                lastViewedAt: new Date()
            }, { merge: true });
            return true;
        }
        
        return false;
    } catch (error) {
        console.error('Error checking promotion views:', error);
        return false;
    }
}

// Update the query to get more recent promotions
export function initializePromotionTracker() {
    const bannerContainer = document.getElementById('promotion-banner-container');
    if (!bannerContainer) {
        console.error('Promotion container not found in DOM');
        return;
    }

    console.log('Rank change tracker initializing...');

    bannerContainer.innerHTML = '';
    bannerContainer.style.display = 'none';
    
    const historyRef = collection(db, 'eloHistory');
    const q = query(
        historyRef, 
        where('type', 'in', ['promotion', 'demotion']), // Add demotion type
        orderBy('timestamp', 'desc'), 
        limit(5)
    );

    onSnapshot(q, async (snapshot) => {
        console.log('Checking for new rank changes...');
        
        const rankChanges = [];
        for (const change of snapshot.docChanges()) {
            if (change.type === "added") {
                const data = change.doc.data();
                rankChanges.push({ id: change.doc.id, ...data });
            }
        }

        rankChanges.sort((a, b) => b.timestamp.toMillis() - a.timestamp.toMillis());

        for (let i = 0; i < rankChanges.length; i++) {
            const rankChange = rankChanges[i];
            
            if (rankChange.rankAchieved) {
                const currentUser = auth.currentUser;
                if (!currentUser) {
                    console.log('No user logged in, skipping rank change banner');
                    continue;
                }

                const shouldShow = await checkPromotionViews(rankChange.id, currentUser.uid);
                
                if (shouldShow) {
                    console.log(`Showing ${rankChange.type} banner for:`, rankChange.player);
                    setTimeout(() => {
                        showRankChangeBanner(rankChange, bannerContainer);
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
    bannerDiv.className = 'promotion-banner'; // Changed from rank-change-banner
    bannerDiv.setAttribute('data-rank', data.rankAchieved);
    
    // Create details element with proper class
    const details = document.createElement('div');
    details.className = 'promotion-details';
    
    const message = data.type === 'promotion' 
        ? `${data.player} was promoted to` 
        : `${data.player} was demoted to`;

    details.innerHTML = `${message} <span class="rank-text">${data.rankAchieved}</span> by ${data.promotedBy || 'Admin'}`;
    
    bannerDiv.appendChild(details);
    container.appendChild(bannerDiv);
    container.style.display = 'block';

    // Rest of the animation timing code remains the same
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