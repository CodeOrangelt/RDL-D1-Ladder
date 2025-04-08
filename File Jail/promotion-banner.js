import { 
    collection, 
    doc, 
    query, 
    where, 
    orderBy, 
    limit, 
    getDoc, 
    setDoc, 
    onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { auth, db } from './firebase-config.js';

// Maximum views for each promotion
const MAX_VIEWS = 2;

// Add error handling for the view counter
async function checkPromotionViews(promotionId, playerName) {
    if (!promotionId || !playerName) {
        console.warn('Missing promotionId or playerName');
        return true; // Default to showing banner if missing data
    }
    
    try {
        // Create a valid document ID that matches our security rules
        const docId = `promotion_${promotionId}_${playerName}`;
        const viewsRef = doc(db, 'promotionViews', docId);
        const viewsDoc = await getDoc(viewsRef);
        
        if (!viewsDoc.exists()) {
            // First view - create document
            await setDoc(viewsRef, { 
                promotionId,
                playerName,
                views: 1,
                createdAt: new Date(),
                updatedAt: new Date()
            });
            console.log(`First view for promotion ${promotionId}`);
            return true;
        }
        
        const data = viewsDoc.data();
        const currentViews = data.views || 0;
        
        // Check if we've hit the view limit
        if (currentViews >= MAX_VIEWS) {
            console.log(`Max views (${MAX_VIEWS}) reached for promotion ${promotionId}`);
            return false;
        }

        // Increment view count
        await setDoc(viewsRef, {
            promotionId,
            playerName,
            views: currentViews + 1,
            updatedAt: new Date(),
            createdAt: data.createdAt || new Date()
        }, { merge: true });
        
        console.log(`View ${currentViews + 1}/${MAX_VIEWS} for promotion ${promotionId}`);
        return true;
    } catch (error) {
        console.error('Error checking promotion views:', error);
        // Don't block showing the banner if we can't track views
        return true;
    }
}

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
        where('type', 'in', ['promotion', 'demotion']),
        orderBy('timestamp', 'desc'), 
        limit(5) // Fetch slightly more than we need in case some are filtered
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
        
        if (rankChanges.length === 0) {
            console.log('No new rank changes');
            return;
        }
        
        // Sort by timestamp (newest first)
        rankChanges.sort((a, b) => b.timestamp.toMillis() - a.timestamp.toMillis());

        // Determine how many slots are available for new banners
        const currentBannerCount = bannerContainer.children.length;
        const availableSlots = 3 - currentBannerCount;
        
        // If we already have 3 banners, exit early
        if (availableSlots <= 0) {
            console.log('Already displaying maximum (3) banners, no new ones will be added');
            return;
        }
        
        // Take only the number of rank changes we can display (max 3 total)
        const changesToShow = rankChanges.slice(0, availableSlots);
        console.log(`Showing ${changesToShow.length} new rank change banners`);

        for (let i = 0; i < changesToShow.length; i++) {
            const rankChange = changesToShow[i];
            
            if (rankChange.rankAchieved) {
                const currentUser = auth.currentUser;
                if (!currentUser) {
                    console.log('No user logged in, skipping rank change banner');
                    continue;
                }

                try {
                    const shouldShow = await checkPromotionViews(rankChange.id, rankChange.player);
                    
                    if (shouldShow) {
                        console.log(`Showing ${rankChange.type} banner for:`, rankChange.player);
                        setTimeout(() => {
                            showRankChangeBanner(rankChange, bannerContainer);
                        }, i * 1000);

                        if (rankChange.player === currentUser.displayName) {
                            showRankChangeLightbox(rankChange.type, rankChange.rankAchieved);
                        }
                    }
                } catch (error) {
                    console.error('Error processing rank change:', error);
                }
            }
        }
    }, (error) => {
        console.error('Error listening for rank changes:', error);
    });
}

// Modified showRankChangeBanner to ensure we never exceed 3 banners
function showRankChangeBanner(data, container) {
    // Hard limit - never show more than 3 banners
    while (container.children.length >= 3) {
        container.removeChild(container.firstChild);
    }

    const bannerDiv = document.createElement('div');
    bannerDiv.className = 'promotion-banner clickable';
    bannerDiv.setAttribute('data-rank', data.rankAchieved);
    
    // Create details element with proper class
    const details = document.createElement('div');
    details.className = 'promotion-details';
    
    // Make sure we're displaying a username, not an ID
    let playerName = data.player;
    
    // If player appears to be a UID (long string with no spaces), try to get the username
    if (playerName && playerName.length > 20 && !playerName.includes(' ')) {
        // Attempt to get username from players collection
        getUsernameFromId(playerName).then(username => {
            if (username) {
                updateBannerText(username);
            }
        }).catch(err => console.error('Error getting username:', err));
    }
    
    // Initial setup with whatever data we have
    updateBannerText(playerName);
    
    // Add to container and show
    bannerDiv.appendChild(details);
    container.appendChild(bannerDiv);
    container.style.display = 'block';
    
    // Function to update banner text when we get the username
    function updateBannerText(name) {
        const message = data.type === 'promotion' 
            ? `${name} was promoted to` 
            : `${name} was demoted to`;
            
        // Removed the "by Admin" part
        details.innerHTML = `${message} <span class="rank-text">${data.rankAchieved}</span>`;
    }
    
    // Make banner clickable to dismiss
    bannerDiv.addEventListener('click', () => {
        bannerDiv.classList.remove('new-rank-change');
        bannerDiv.classList.add('dismissing');
        
        // Remove after animation completes
        setTimeout(() => {
            bannerDiv.remove();
            if (container.children.length === 0) {
                container.style.display = 'none';
            }
        }, 300); // Match this to your CSS transition time
    });

    // Animation timing
    setTimeout(() => {
        bannerDiv.classList.add('new-rank-change');
        
        // Auto-dismiss after delay (keeping your original behavior)
        setTimeout(() => {
            bannerDiv.classList.remove('new-rank-change');
            setTimeout(() => {
                if (bannerDiv.parentNode) { // Check if it hasn't been clicked already
                    bannerDiv.remove();
                    if (container.children.length === 0) {
                        container.style.display = 'none';
                    }
                }
            }, 5000);
        }, 10000);
    }, 100);
}

// Add this helper function to lookup usernames from IDs
async function getUsernameFromId(userId) {
    try {
        // Try D1 players first
        let playerDoc = await getDoc(doc(db, 'players', userId));
        
        // If not found, try D2 players
        if (!playerDoc.exists()) {
            playerDoc = await getDoc(doc(db, 'playersD2', userId));
        }
        
        // Return username if found
        if (playerDoc.exists() && playerDoc.data().username) {
            return playerDoc.data().username;
        }
        return null;
    } catch (error) {
        console.error('Error getting username from ID:', error);
        return null;
    }
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
            <button class="rank-change-button" id="rank-change-ok-btn">
                Got it!
            </button>
        </div>
    `;

    modal.style.display = 'flex';

    // Add event listener to button using proper method
    document.getElementById('rank-change-ok-btn').addEventListener('click', () => {
        modal.style.display = 'none';
    });

    // Close when clicking outside
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });
}