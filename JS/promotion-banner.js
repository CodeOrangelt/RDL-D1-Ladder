import { db, auth } from './firebase-config.js';
import { collection, query, orderBy, limit, onSnapshot, doc, getDoc, setDoc, where, deleteDoc, getDocs } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const MAX_VIEWS = 5;

// Modify the checkPromotionViews function for better tracking
async function checkPromotionViews(promotionId, userId) {
    try {
        const viewsRef = doc(db, 'promotionViews', `${promotionId}_${userId}`);
        const viewsDoc = await getDoc(viewsRef);
        
        if (!viewsDoc.exists()) {
            await setDoc(viewsRef, { 
                views: 1,
                firstView: new Date(),
                lastView: new Date()
            });
            return true;
        }
        
        const data = viewsDoc.data();
        if (data.views < MAX_VIEWS) {
            await setDoc(viewsRef, { 
                views: data.views + 1,
                lastView: new Date()
            }, { merge: true });
            return true;
        }
        
        console.log(`Max views (${MAX_VIEWS}) reached for promotion ${promotionId} by user ${userId}`);
        return false;
    } catch (error) {
        console.error('Error checking promotion views:', error);
        return false;
    }
}

// Update the query to get more recent promotions
export function initializePromotionTracker() {
    // Add more detailed logging
    console.log('DOM Ready - Initializing promotion tracker');
    
    const promotionContainer = document.querySelector('.promotion-container');
    console.log('Promotion container:', promotionContainer); // Log the actual element
    
    if (!promotionContainer) {
        console.error('Promotion container not found - Ensure .promotion-container exists in HTML');
        return;
    }

    console.log('Rank change tracker initializing...');

    // Add debug logging
    console.log('Found promotion container:', promotionContainer);

    promotionContainer.innerHTML = '';
    promotionContainer.style.display = 'none';
    
    const historyRef = collection(db, 'eloHistory');
    // Modify the query section in initializePromotionTracker
    const q = query(
        historyRef, 
        where('type', 'in', ['promotion', 'demotion']), 
        where('timestamp', '>', new Date(Date.now() - 24 * 60 * 60 * 1000)), // Last 24 hours only
        orderBy('timestamp', 'desc'), 
        limit(5)
    );

    // Update the onSnapshot callback
    onSnapshot(q, async (snapshot) => {
        console.log('Checking for new rank changes...', snapshot.size, 'changes found');
        
        const rankChanges = [];
        for (const change of snapshot.docChanges()) {
            console.log('Change type:', change.type, 'Document data:', change.doc.data());
            if (change.type === "added") {
                const data = change.doc.data();
                // Ensure rank is set correctly for both types
                const rankAchieved = data.rankAchieved || data.rank;
                console.log('Processing rank change:', {
                    type: data.type,
                    player: data.player,
                    rankAchieved: rankAchieved,
                    id: change.doc.id
                });

                if (data.type && ['promotion', 'demotion'].includes(data.type)) {
                    rankChanges.push({ 
                        id: change.doc.id, 
                        ...data,
                        rankAchieved: rankAchieved
                    });
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
// Update the banner display logic
function showRankChangeBanner(data, container) {
    console.log('Showing banner for:', data);
    
    container.style.display = 'block'; // Make sure container is visible
    
    if (container.children.length >= 3) {
        container.removeChild(container.firstChild);
    }

    const bannerDiv = document.createElement('div');
    bannerDiv.className = `rank-change-banner ${data.type}`;
    bannerDiv.setAttribute('data-rank', data.rankAchieved);
    
    const message = data.type === 'promotion' 
        ? `${data.player} was promoted to` 
        : `${data.player} was demoted to`;

    // Update the admin attribution based on type
    const byAdmin = data.type === 'promotion' 
        ? data.promotedBy || 'Admin'
        : data.demotedBy || 'Admin';

    // Add rank change direction indicator
    const directionIndicator = data.type === 'promotion' 
        ? '↑' 
        : '↓';

    bannerDiv.innerHTML = `
        <p>
            ${message} 
            <span class="rank-indicator ${data.type}" data-rank="${data.rankAchieved}">
                ${directionIndicator} ${data.rankAchieved}
            </span> 
            by ${byAdmin}
        </p>
    `;
    
    // Add animation class based on type
    bannerDiv.classList.add(`rank-change-${data.type}`);

    // Make sure to append the banner
    container.appendChild(bannerDiv);

    // Add debug logging
    console.log('Banner added to container:', {
        containerDisplay: container.style.display,
        containerChildren: container.children.length,
        bannerClass: bannerDiv.className
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

// Add a cleanup function for old view records
async function cleanupOldViewRecords() {
    try {
        const viewsRef = collection(db, 'promotionViews');
        const oldViews = query(
            viewsRef,
            where('lastView', '<', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) // Older than 7 days
        );
        
        const snapshot = await getDocs(oldViews);
        snapshot.forEach(async (doc) => {
            await deleteDoc(doc.ref);
        });
    } catch (error) {
        console.error('Error cleaning up old view records:', error);
    }
}

// or wherever you initialize your scripts
document.addEventListener('DOMContentLoaded', () => {
    initializePromotionTracker();
});