// Import Firebase functions
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    getDoc, 
    setDoc, 
    updateDoc, 
    collection, 
    addDoc, 
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { clearTokenCache } from './tokens.js';

// Initialize Firebase
const auth = getAuth();
const db = getFirestore();

// Theme configuration
const THEMES = {
    default:   { price: 0,    name: "Classic RDL", description: "Rock texture with a sleek nav and footer" },
    contrast:  { price: 0,    name: "Nightlight", description: "For the late-nights." },
    purple:    { price: 150,  name: "Purple", description: "Can't get enough" },
    ocean:     { price: 300,  name: "Blue", description: "This one is really pretty" },
    cyberpunk: { price: 400,  name: "Yellow Orange", description: "This theme makes me happy" },
    volcanic:  { price: 500,  name: "Red", description: "For the angry type." },
    gold:      { price: 800,  name: "Gold", description: "Only the best get this one" },
    emerald:   { price: 1000, name: "Emerald", description: "Emerald City!" },
    cockpit:   { price: 1200, name: "Cockpit", description: "is that... Pfunk?" }
};

// Token configuration
const TOKENS = {
    pwr01: { 
        price: 100, 
        name: "Energy", 
        description: "Enhanced energy generation unit",
        image: "../images/tokens/subgame/pwr01.gif",
        category: "powerup"
    },
    fan: {
        price: 150,
        name: "Fan",
        description: "Show your support with this fan token.",
        image: "../images/tokens/Fan.gif",
        category: "fun"
    },
    marker: {
        price: 250,
        name: "Marker",
        description: "Leave your mark on the leaderboard.",
        image: "../images/tokens/Marker.gif",
        category: "fun"
    },
    laser: {
        price: 300,
        name: "Laser",
        description: "Classic laser weapon token.",
        image: "../images/tokens/Laser.gif",
        category: "weapon"
    },
    pbomb: { 
        price: 350, 
        name: "Proximity Bomb", 
        description: "Strategic explosive device",
        image: "../images/tokens/subgame/pbomb.gif",
        category: "weapon"
    },
    fusion: { 
        price: 350, 
        name: "Fusion Cannon", 
        description: "Devastating fusion weapon technology",
        image: "../images/tokens/subgame/fusion.gif",
        category: "weapon"
    },
    lock: {
        price: 450,
        name: "Lock",
        description: "Lock in your victory.",
        image: "../images/tokens/Lock.gif",
        category: "fun"
    },
    blob01: { 
        price: 500, 
        name: "Blob Token 1", 
        description: "A mysterious purple blob token",
        image: "../images/tokens/blob01.gif",
        category: "blob"
    },
    plasma: {
        price: 500,
        name: "Plasma Cannon",
        description: "High-powered plasma cannon token.",
        image: "../images/tokens/Plasma.gif",
        category: "weapon"
    },
    cloak: { 
        price: 500, 
        name: "Cloaking Device", 
        description: "Become one with the shadows",
        image: "../images/tokens/cloak.gif",
        category: "special"
    },
    pwr02: { 
        price: 600, 
        name: "Shield Orb", 
        description: "Advanced energy storage system",
        image: "../images/tokens/subgame/pwr02.gif",
        category: "powerup"
    },
    mercury: {
        price: 600,
        name: "Mercury Missile",
        description: "Fast and furious missile token.",
        image: "../images/tokens/Mercury.gif",
        category: "weapon"
    },
    plasmablobl: {
        price: 600,
        name: "Plasma Blob",
        description: "A mysterious plasma blob.",
        image: "../images/tokens/Plasmablobl.gif",
        category: "blob"
    },
    smissile: { 
        price: 650, 
        name: "Smart Missile", 
        description: "Intelligent targeting system",
        image: "../images/tokens/subgame/smissile.gif",
        category: "weapon"
    },
    smartmine: {
        price: 750,
        name: "Smart Mine",
        description: "A cunning explosive device.",
        image: "../images/tokens/Smartmine.gif",
        category: "weapon"
    },
    mmissile: { 
        price: 800, 
        name: "Mega Missile", 
        description: "Heavy ordinance for tough situations",
        image: "../images/tokens/subgame/mmissile.gif",
        category: "weapon"
    },
    gauge18: { 
        price: 800, 
        name: "R/Y/B Keys", 
        description: "Monitor your ship's energy levels",
        image: "../images/tokens/gauge18.gif",
        category: "equipment"
    },
    extralife: {
        price: 800,
        name: "Extra Life",
        description: "A rare extra life token.",
        image: "../images/tokens/Extralife.gif",
        category: "special"
    },
    hostage: {
        price: 950,
        name: "Hostage",
        description: "Rescue the hostage for bonus points.",
        image: "../images/tokens/Hostage.gif",
        category: "special"
    },
    phoenix: {
        price: 950,
        name: "Phoenix Cannon",
        description: "Fiery phoenix cannon token.",
        image: "../images/tokens/Phoenix.gif",
        category: "weapon"
    },
    blob02: { 
        price: 1000, 
        name: "Blob Token 2", 
        description: "Another enigmatic blob creature",
        image: "../images/tokens/blob02.gif",
        category: "blob"
    },
    invuln: {
        price: 1500,
        name: "Invulnerability",
        description: "Become invincible for a short time.",
        image: "../images/tokens/Invuln.gif",
        category: "powerup"
    },
    blob03: { 
        price: 2000, 
        name: "Blob Token 3", 
        description: "The final blob in the collection",
        image: "../images/tokens/blob03.gif",
        category: "blob"
    },
    reactor: {
        price: 2000,
        name: "Reactor",
        description: "The heart of every mine.",
        image: "../images/tokens/Reactor.gif",
        category: "special"
    },
    pyro: {
        price: 3000,
        name: "Pyro",
        description: "The iconic Pyro-GX ship.",
        image: "../images/tokens/Pyro.gif",
        category: "ship"
    },
    architect: {
        price: -1,
        name: "Architect",
        description: "The iconic Architect ship.",
        image: "../images/tokens/allmap.gif",
        category: "ship",
    }
};

// Global state
let userData = {
    points: 0,
    inventory: [],
    isAdmin: false
};

// DOM elements
let storeContainer;
let pointsDisplay;
let authWarning;

// Initialize after DOM loads
document.addEventListener('DOMContentLoaded', () => {
    console.log('🏪 Redeem store initializing...');
    
    // Get DOM elements
    storeContainer = document.getElementById('store-content');
    pointsDisplay = document.getElementById('user-points');
    authWarning = document.getElementById('auth-warning');
    
    // Initialize auth listener
    initAuthListener();
    
    // Build store UI
    buildStoreUI();
});

// Auth state listener
function initAuthListener() {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            console.log('✅ User authenticated:', user.displayName || user.email);
            
            // Show store content
            if (authWarning) authWarning.style.display = 'none';
            if (storeContainer) storeContainer.style.display = 'block';
            
            // Load user data
            await loadUserData(user);
            
            // Update UI based on ownership
            updateThemeButtons();
            updateTokenButtons();
            
        } else {
            console.log('❌ User not authenticated');
            
            // Show auth warning
            if (authWarning) authWarning.style.display = 'block';
            if (storeContainer) storeContainer.style.display = 'none';
            
            // Reset user data
            userData = {
                points: 0,
                inventory: [],
                isAdmin: false
            };
            
            window.isUserAdmin = false;
        }
    });
}

// Load user data from Firestore
async function loadUserData(user) {
    try {
        const userRef = doc(db, "userProfiles", user.uid);
        const userDoc = await getDoc(userRef);
        
        if (userDoc.exists()) {
            // Extract data
            const data = userDoc.data();
            userData = {
                points: data.points || 0,
                inventory: data.inventory || [],
                isAdmin: data.isAdmin || false,
                equippedToken: data.equippedToken || null // NEW: Track equipped token
            };
            
            // Update points display
            if (pointsDisplay) {
                pointsDisplay.textContent = userData.points.toLocaleString();
            }
            
            // Set admin status
            window.isUserAdmin = userData.isAdmin;
            
            if (userData.isAdmin) {
                console.log('👑 Admin controls enabled');
                window.dispatchEvent(new CustomEvent('adminStatusChanged', { 
                    detail: { isAdmin: true } 
                }));
            }
            
            console.log(`User data loaded - Points: ${userData.points}, Inventory: ${userData.inventory.length} items, Equipped: ${userData.equippedToken || 'none'}`);
            
        } else {
            // Create new user profile
            await setDoc(userRef, {
                points: 0,
                inventory: [],
                equippedToken: null, // NEW
                createdAt: serverTimestamp(),
                username: user.displayName || user.email?.split('@')[0] || 'User'
            });
            
            userData = {
                points: 0,
                inventory: [],
                isAdmin: false,
                equippedToken: null // NEW
            };
            
            if (pointsDisplay) {
                pointsDisplay.textContent = '0';
            }
            
            window.isUserAdmin = false;
            console.log('New user profile created');
        }
    } catch (error) {
        console.error('Error loading user data:', error);
    }
}

// Check if user owns a theme
function userOwnsTheme(themeId) {
    // Free themes are always "owned"
    if (THEMES[themeId]?.price === 0) return true;
    
    // Check inventory
    return userData.inventory.includes(`theme_${themeId}`);
}

// Check if user owns a token
function userOwnsToken(tokenId) {
    return userData.inventory.includes(`token_${tokenId}`);
}

// Check if user has a token equipped
function userHasTokenEquipped(tokenId) {
    return userData.equippedToken === tokenId;
}

// Get currently equipped token
function getEquippedToken() {
    return userData.equippedToken || null;
}

// Process theme purchase
async function purchaseTheme(themeId) {
    const user = auth.currentUser;
    if (!user) {
        showMessage('Please sign in to purchase themes', 'error');
        return false;
    }
    
    const theme = THEMES[themeId];
    if (!theme) {
        console.error(`Theme ${themeId} not found`);
        return false;
    }
    
    // Verify user can afford it
    if (userData.points < theme.price) {
        showMessage(`Not enough points. You need ${theme.price - userData.points} more points.`, 'error');
        return false;
    }
    
    // Verify user doesn't already own it
    if (userOwnsTheme(themeId)) {
        showMessage(`You already own the ${theme.name} theme`, 'info');
        return false;
    }
    
    try {
        return await processPurchase(themeId, theme, 'theme');
    } catch (error) {
        console.error('Theme purchase failed:', error);
        showMessage('Purchase failed. Please try again.', 'error');
        return false;
    }
}

// Process token purchase
async function purchaseToken(tokenId) {
    const user = auth.currentUser;
    if (!user) {
        showMessage('Please sign in to purchase tokens', 'error');
        return false;
    }
    
    const token = TOKENS[tokenId];
    if (!token) {
        console.error(`Token ${tokenId} not found`);
        return false;
    }
    
    // Verify user can afford it
    if (userData.points < token.price) {
        showMessage(`Not enough points. You need ${token.price - userData.points} more points.`, 'error');
        return false;
    }
    
    // Verify user doesn't already own it
    if (userOwnsToken(tokenId)) {
        showMessage(`You already own the ${token.name} token`, 'info');
        return false;
    }
    
    try {
        return await processPurchase(tokenId, token, 'token');
    } catch (error) {
        console.error('Token purchase failed:', error);
        showMessage('Purchase failed. Please try again.', 'error');
        return false;
    }
}

// Update the processPurchase function in JS/redeem.js
async function processPurchase(itemId, item, type) {
    const user = auth.currentUser;
    
    try {
        // Get fresh user data to avoid race conditions
        const userRef = doc(db, "userProfiles", user.uid);
        const userDoc = await getDoc(userRef);
        
        if (!userDoc.exists()) {
            showMessage('User profile not found', 'error');
            return false;
        }
        
        const freshData = userDoc.data();
        const currentPoints = freshData.points || 0;
        const currentInventory = freshData.inventory || [];
        
        // Double-check funds and ownership
        if (currentPoints < item.price) {
            showMessage('Insufficient points', 'error');
            return false;
        }
        
        if (currentInventory.includes(`${type}_${itemId}`)) {
            showMessage(`You already own this ${type}`, 'info');
            return false;
        }
        
        // Update user profile first
        const newPoints = currentPoints - item.price;
        const newInventory = [...currentInventory, `${type}_${itemId}`];
        
        await updateDoc(userRef, {
            points: newPoints,
            inventory: newInventory,
            lastPurchase: serverTimestamp()
        });
        
        // NEW: If it's a token, also save to dedicated userTokens collection
        if (type === 'token') {
            try {
                const userTokensRef = doc(db, 'userTokens', user.uid);
                const userTokensDoc = await getDoc(userTokensRef);
                
                let ownedTokens = [];
                if (userTokensDoc.exists()) {
                    ownedTokens = userTokensDoc.data().tokens || [];
                }
                
                // Create timestamp as Date object instead of serverTimestamp()
                const purchaseTimestamp = new Date();
                
                // Add the new token - DO NOT auto-equip
                ownedTokens.push({
                    tokenId: itemId,
                    tokenName: item.name,
                    tokenImage: item.image,
                    category: item.category,
                    purchasedAt: purchaseTimestamp,
                    price: item.price,
                    equipped: false // Don't auto-equip new tokens
                });
                
                // Save to userTokens collection with merge
                await setDoc(userTokensRef, {
                    userId: user.uid,
                    username: freshData.username || user.displayName || 'Unknown',
                    tokens: ownedTokens,
                    lastUpdated: serverTimestamp()
                }, { merge: true });
                
                // Clear the cache for this user so the ladder will show the new token
                if (typeof clearTokenCache === 'function') {
                    clearTokenCache(user.uid);
                }
                
                console.log(`✅ Token ${itemId} saved to userTokens collection (not equipped)`);
            } catch (tokenError) {
                // Log the error but don't show it to user since main purchase succeeded
                console.warn('Token collection update had an issue, but purchase completed:', tokenError);
                
                // Only show error if it's a serious permission issue
                if (tokenError.code === 'permission-denied') {
                    console.log('🔧 Token permissions issue detected, but purchase was successful');
                    // Don't show error message since the purchase worked
                } else {
                    console.error('Unexpected token error:', tokenError);
                }
                
                // Don't fail the whole purchase - the token is still in the user's inventory
            }
        }
        
        // Log transaction
        try {
            await addDoc(collection(db, "transactions"), {
                userId: user.uid,
                userEmail: user.email,
                itemId: `${type}_${itemId}`,
                itemTitle: item.name,
                price: item.price,
                type: 'purchase',
                category: type,
                timestamp: serverTimestamp()
            });
        } catch (transactionError) {
            console.warn('Transaction logging failed, but purchase was successful:', transactionError);
            // Don't fail the purchase for logging issues
        }
        
        // Update local data
        userData.points = newPoints;
        userData.inventory = newInventory;
        
        // Update points display
        if (pointsDisplay) {
            pointsDisplay.textContent = userData.points.toLocaleString();
        }
        
        // Refresh UI to show ownership changes
        updateTokenButtons();
        if (type === 'theme') {
            updateThemeButtons();
        }
        
        console.log(`✅ Purchased ${item.name} for ${item.price} points`);
        showMessage(`Successfully purchased ${item.name}! Use the "Equip" button to show it on the ladder.`, 'success');
        return true;
        
    } catch (error) {
        console.error('Purchase processing error:', error);
        
        // Only show specific error messages for actual failures
        if (error.code === 'permission-denied') {
            showMessage('Permission denied. Please try again or contact support.', 'error');
        } else if (error.code === 'unavailable') {
            showMessage('Service temporarily unavailable. Please try again.', 'error');
        } else if (error.code === 'unauthenticated') {
            showMessage('Please sign in again to complete purchase.', 'error');
        } else {
            showMessage('Purchase failed. Please try again.', 'error');
        }
        
        return false;
    }
}

async function equipToken(tokenId) {
    const user = auth.currentUser;
    if (!user) {
        showMessage('Please sign in to equip tokens', 'error');
        return false;
    }
    
    const token = TOKENS[tokenId];
    if (!token) {
        console.error(`Token ${tokenId} not found`);
        return false;
    }
    
    // Check if user owns the token
    if (!userOwnsToken(tokenId)) {
        showMessage(`You must own this token to equip it`, 'error');
        return false;
    }
    
    try {
        // Update user profile with equipped token
        const userRef = doc(db, "userProfiles", user.uid);
        await updateDoc(userRef, {
            equippedToken: tokenId,
            lastTokenEquip: serverTimestamp()
        });
        
        // Update userTokens collection to mark equipped token
        try {
            const userTokensRef = doc(db, 'userTokens', user.uid);
            const userTokensDoc = await getDoc(userTokensRef);
            
            if (userTokensDoc.exists()) {
                const tokensData = userTokensDoc.data();
                const tokens = tokensData.tokens || [];
                
                // Update all tokens to unequipped, then set the selected one as equipped
                const updatedTokens = tokens.map(token => ({
                    ...token,
                    equipped: token.tokenId === tokenId
                }));
                
                await updateDoc(userTokensRef, {
                    tokens: updatedTokens,
                    equippedToken: tokenId,
                    lastUpdated: serverTimestamp()
                });
            }
        } catch (tokenCollectionError) {
            console.warn('Token collection update had an issue, but equip was successful:', tokenCollectionError);
            // Don't fail the equip operation for collection sync issues
        }
        
        // Update local data
        userData.equippedToken = tokenId;
        
        // Clear token cache to refresh display
        if (typeof clearTokenCache === 'function') {
            clearTokenCache(user.uid);
            clearTokenCache();
        }
        
        // Trigger ladder refresh if available
        setTimeout(() => {
            if (window.displayLadder && typeof window.displayLadder === 'function') {
                console.log('🔄 Refreshing ladder to show equipped token');
                window.displayLadder(true);
            }
            
            if (window.RedeemStore && typeof window.RedeemStore.refreshUI === 'function') {
                window.RedeemStore.refreshUI();
            }
        }, 500);
        
        console.log(`✅ Equipped token: ${token.name}`);
        showMessage(`${token.name} equipped! Ladder will refresh shortly.`, 'success');
        return true;
        
    } catch (error) {
        console.error('Token equip failed:', error);
        
        // Only show error for actual failures
        if (error.code === 'permission-denied') {
            showMessage('Permission denied. Token may still be equipped - check the ladder.', 'warning');
        } else {
            showMessage(`Failed to equip token: ${error.message}`, 'error');
        }
        return false;
    }
}

// Unequip current token
async function unequipToken() {
    const user = auth.currentUser;
    if (!user) {
        showMessage('Please sign in to unequip tokens', 'error');
        return false;
    }
    
    if (!userData.equippedToken) {
        showMessage('No token is currently equipped', 'info');
        return false;
    }
    
    try {
        // Update user profile
        const userRef = doc(db, "userProfiles", user.uid);
        await updateDoc(userRef, {
            equippedToken: null,
            lastTokenEquip: serverTimestamp()
        });
        
        // Update userTokens collection
        const userTokensRef = doc(db, 'userTokens', user.uid);
        const userTokensDoc = await getDoc(userTokensRef);
        
        if (userTokensDoc.exists()) {
            const tokensData = userTokensDoc.data();
            const tokens = tokensData.tokens || [];
            
            // Unequip all tokens
            const updatedTokens = tokens.map(token => ({
                ...token,
                equipped: false
            }));
            
            await updateDoc(userTokensRef, {
                tokens: updatedTokens,
                equippedToken: null,
                lastUpdated: serverTimestamp()
            });
        }
        
        // Update local data
        userData.equippedToken = null;
        
        // Clear token cache to refresh display
        if (typeof clearTokenCache === 'function') {
            clearTokenCache(user.uid);
            // Also clear the cache globally to force refresh
            clearTokenCache();
        }
        
        // NEW: Trigger ladder refresh if available
        setTimeout(() => {
            if (window.displayLadder && typeof window.displayLadder === 'function') {
                console.log('🔄 Refreshing ladder to remove unequipped token');
                window.displayLadder(true); // Force refresh
            }
            
            // Also try the RedeemStore refresh
            if (window.RedeemStore && typeof window.RedeemStore.refreshUI === 'function') {
                window.RedeemStore.refreshUI();
            }
        }, 500); // Small delay to ensure Firestore updates are processed
        
        console.log('✅ Token unequipped');
        showMessage('Token unequipped! Ladder will refresh shortly.', 'success');
        return true;
        
    } catch (error) {
        console.error('Token unequip failed:', error);
        showMessage(`Failed to unequip token: ${error.message}`, 'error');
        return false;
    }
}

// Admin function to sell back (disown) a token
async function sellToken(tokenId) {
    const user = auth.currentUser;
    if (!user) {
        showMessage('Please sign in to sell tokens', 'error');
        return false;
    }
    
    // Check admin status
    if (!userData.isAdmin) {
        showMessage('Only admins can sell tokens', 'error');
        return false;
    }
    
    const token = TOKENS[tokenId];
    if (!token) {
        console.error(`Token ${tokenId} not found`);
        return false;
    }
    
    // Check if user owns the token
    if (!userOwnsToken(tokenId)) {
        showMessage(`You don't own this token`, 'error');
        return false;
    }
    
    try {
        // Get fresh user data
        const userRef = doc(db, "userProfiles", user.uid);
        const userDoc = await getDoc(userRef);
        const freshData = userDoc.data();
        
        // Calculate refund (50% of original price)
        const refundAmount = Math.floor(token.price * 0.5);
        const newPoints = (freshData.points || 0) + refundAmount;
        const newInventory = (freshData.inventory || []).filter(item => item !== `token_${tokenId}`);
        
        // If this token is equipped, unequip it
        const newEquippedToken = freshData.equippedToken === tokenId ? null : freshData.equippedToken;
        
        // Update user profile
        await updateDoc(userRef, {
            points: newPoints,
            inventory: newInventory,
            equippedToken: newEquippedToken,
            lastSale: serverTimestamp()
        });
        
        // Update userTokens collection
        const userTokensRef = doc(db, 'userTokens', user.uid);
        const userTokensDoc = await getDoc(userTokensRef);
        
        if (userTokensDoc.exists()) {
            const tokensData = userTokensDoc.data();
            const tokens = tokensData.tokens || [];
            
            // Remove the sold token
            const updatedTokens = tokens.filter(t => t.tokenId !== tokenId);
            
            await updateDoc(userTokensRef, {
                tokens: updatedTokens,
                equippedToken: newEquippedToken,
                lastUpdated: serverTimestamp()
            });
        }
        
        // Log transaction
        await addDoc(collection(db, "transactions"), {
            userId: user.uid,
            userEmail: user.email,
            itemId: `token_${tokenId}`,
            itemTitle: token.name,
            refund: refundAmount,
            originalPrice: token.price,
            type: 'sale',
            category: 'token',
            timestamp: serverTimestamp()
        });
        
        // Update local data
        userData.points = newPoints;
        userData.inventory = newInventory;
        userData.equippedToken = newEquippedToken;
        
        // Update points display
        if (pointsDisplay) {
            pointsDisplay.textContent = userData.points.toLocaleString();
        }
        
        // Clear token cache to refresh display
        if (typeof clearTokenCache === 'function') {
            clearTokenCache(user.uid);
        }
        
        console.log(`✅ Sold token ${token.name} for ${refundAmount} points`);
        showMessage(`Sold ${token.name} for ${refundAmount} points (50% refund)`, 'success');
        return true;
        
    } catch (error) {
        console.error('Token sale failed:', error);
        showMessage(`Failed to sell token: ${error.message}`, 'error');
        return false;
    }
}

// Apply a theme
function applyTheme(themeId) {
    if (!userOwnsTheme(themeId)) {
        showMessage(`You must purchase this theme first`, 'error');
        return false;
    }
    
    if (window.ThemeSystem) {
        window.ThemeSystem.switchTheme(themeId);
        showMessage(`${THEMES[themeId]?.name || themeId} theme applied!`, 'success');
        return true;
    } else {
        console.error('Theme system not found');
        return false;
    }
}

// Build store UI with theme items
function buildStoreUI() {
    buildThemeItems();
    buildTokenItems();
}

// Build theme items
function buildThemeItems() {
    const themesContainer = document.querySelector('.themes-grid');
    if (!themesContainer) {
        console.error('Themes container not found');
        return;
    }
    
    // Clear existing items
    themesContainer.innerHTML = '';
    
    // Create theme items
    Object.entries(THEMES).forEach(([themeId, theme]) => {
        const themeCard = document.createElement('div');
        themeCard.className = 'store-item';
        themeCard.dataset.theme = themeId;
        themeCard.dataset.itemId = `theme_${themeId}`;
        themeCard.dataset.price = theme.price;
        
        themeCard.innerHTML = `
            <div class="item-header">
                <div class="item-icon theme-icon-${themeId}">
                    <i class="fas fa-palette"></i>
                </div>
                <div class="item-price">${theme.price === 0 ? 'FREE' : `${theme.price} Points`}</div>
            </div>
            <h3 class="item-title">${theme.name}</h3>
            <p class="item-description">${theme.description}</p>
            <button class="theme-select-btn purchase-btn">Select Theme</button>
        `;
        
        themesContainer.appendChild(themeCard);
    });
    
    // Set up theme buttons
    setupThemeButtons();
}

// Update the buildTokenItems function
function buildTokenItems() {
    const tokensContainer = document.querySelector('.tokens-grid');
    if (!tokensContainer) {
        console.error('Tokens container not found');
        return;
    }
    
    // Clear existing items
    tokensContainer.innerHTML = '';
    
    // Create token items
    Object.entries(TOKENS).forEach(([tokenId, token]) => {
        const tokenCard = document.createElement('div');
        tokenCard.className = 'store-item token-item';
        tokenCard.dataset.token = tokenId;
        tokenCard.dataset.itemId = `token_${tokenId}`;
        tokenCard.dataset.price = token.price;
        
        // Admin sell button (only show for admins and owned tokens)
        const adminControls = userData.isAdmin && userOwnsToken(tokenId) ? `
            <button class="token-sell-btn admin-btn" style="margin-top: 0.5rem; background: #f44336; font-size: 0.8rem; padding: 0.3rem;">
                Sell (${Math.floor(token.price * 0.5)} pts)
            </button>
        ` : '';
        
        tokenCard.innerHTML = `
            <div class="item-header">
                <div class="item-icon token-icon">
                    <img src="${token.image}" alt="${token.name}" class="token-preview" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                    <div class="token-fallback" style="display: none;">
                        <i class="fas fa-coins"></i>
                    </div>
                </div>
                <div class="item-price">${token.price} Points</div>
            </div>
            <button class="token-select-btn purchase-btn">Purchase</button>
            <button class="token-equip-btn equip-btn" style="margin-top: 0.5rem; display: none;">Equip</button>
            ${adminControls}
        `;
        
        tokensContainer.appendChild(tokenCard);
    });
    
    // Set up token buttons
    setupTokenButtons();
}

// Setup theme buttons
function setupThemeButtons() {
    const themeButtons = document.querySelectorAll('.theme-select-btn');
    
    themeButtons.forEach(button => {
        button.addEventListener('click', async (e) => {
            e.preventDefault();
            
            const user = auth.currentUser;
            if (!user) {
                showMessage('Please sign in to select themes', 'error');
                return;
            }
            
            const themeCard = button.closest('[data-theme]');
            const themeId = themeCard.dataset.theme;
            const theme = THEMES[themeId];
            
            if (!theme) {
                console.error(`Theme ${themeId} not found`);
                return;
            }
            
            console.log(`Theme clicked: ${theme.name} (${themeId})`);
            
            // Check if button is disabled
            if (button.disabled) {
                if (theme.price > 0) {
                    showMessage(`You need ${theme.price} points to purchase this theme`, 'error');
                }
                return;
            }
            
            // Button actions based on text
            if (button.textContent === 'Current Theme') {
                showMessage(`${theme.name} is already your current theme`, 'info');
                return;
            }
            
            if (button.textContent === 'Apply Theme') {
                applyTheme(themeId);
                updateThemeButtons();
                return;
            }
            
            if (button.textContent.includes('Buy')) {
                const confirm = window.confirm(`Purchase ${theme.name} theme for ${theme.price} points?`);
                if (!confirm) return;
                
                const success = await purchaseTheme(themeId);
                if (success) {
                    showMessage(`${theme.name} theme purchased!`, 'success');
                    applyTheme(themeId);
                    updateThemeButtons();
                }
                return;
            }
            
            // Default action - try to apply if owned, otherwise purchase
            if (userOwnsTheme(themeId)) {
                applyTheme(themeId);
            } else {
                showMessage(`You must purchase this theme first`, 'error');
            }
        });
    });
    
    // Update initial button states
    updateThemeButtons();
}

// Update the setupTokenButtons function
function setupTokenButtons() {
    const tokenButtons = document.querySelectorAll('.token-select-btn');
    const equipButtons = document.querySelectorAll('.token-equip-btn');
    const sellButtons = document.querySelectorAll('.token-sell-btn');
    
    // Purchase buttons
    tokenButtons.forEach(button => {
        button.addEventListener('click', async (e) => {
            e.preventDefault();
            
            const user = auth.currentUser;
            if (!user) {
                showMessage('Please sign in to purchase tokens', 'error');
                return;
            }
            
            const tokenCard = button.closest('[data-token]');
            const tokenId = tokenCard.dataset.token;
            const token = TOKENS[tokenId];
            
            if (!token) {
                console.error(`Token ${tokenId} not found`);
                return;
            }
            
            console.log(`Token clicked: ${token.name} (${tokenId})`);
            
            // Check if button is disabled
            if (button.disabled) {
                showMessage(`You need ${token.price} points to purchase this token`, 'error');
                return;
            }
            
            if (button.textContent === 'Owned') {
                showMessage(`You already own the ${token.name} token`, 'info');
                return;
            }
            
            if (button.textContent.includes('Purchase') || button.textContent.includes('Buy')) {
                const confirm = window.confirm(`Purchase ${token.name} token for ${token.price} points?`);
                if (!confirm) return;
                
                const success = await purchaseToken(tokenId);
                if (success) {
                    updateTokenButtons();
                }
                return;
            }
        });
    });
    
    // Equip buttons
    equipButtons.forEach(button => {
        button.addEventListener('click', async (e) => {
            e.preventDefault();
            
            const tokenCard = button.closest('[data-token]');
            const tokenId = tokenCard.dataset.token;
            const token = TOKENS[tokenId];
            
            if (button.textContent === 'Equipped') {
                const confirm = window.confirm(`Unequip ${token.name}?`);
                if (!confirm) return;
                
                const success = await unequipToken();
                if (success) {
                    updateTokenButtons();
                }
            } else {
                const confirm = window.confirm(`Equip ${token.name}? This will unequip your current token.`);
                if (!confirm) return;
                
                const success = await equipToken(tokenId);
                if (success) {
                    updateTokenButtons();
                }
            }
        });
    });
    
    // Sell buttons (admin only)
    sellButtons.forEach(button => {
        button.addEventListener('click', async (e) => {
            e.preventDefault();
            
            const tokenCard = button.closest('[data-token]');
            const tokenId = tokenCard.dataset.token;
            const token = TOKENS[tokenId];
            const refund = Math.floor(token.price * 0.5);
            
            const confirm = window.confirm(`Are you sure you want to sell ${token.name} for ${refund} points? This cannot be undone.`);
            if (!confirm) return;
            
            const success = await sellToken(tokenId);
            if (success) {
                updateTokenButtons();
            }
        });
    });
    
    // Update initial button states
    updateTokenButtons();
}

// Update theme button states
function updateThemeButtons() {
    const currentTheme = window.ThemeSystem ? window.ThemeSystem.getCurrentTheme() : 'default';
    const user = auth.currentUser;
    
    document.querySelectorAll('.theme-select-btn').forEach(button => {
        const themeCard = button.closest('[data-theme]');
        const themeId = themeCard.dataset.theme;
        const theme = THEMES[themeId];
        
        if (!theme) return;
        
        // Reset button styling
        button.disabled = false;
        button.style.opacity = '';
        button.style.cursor = 'pointer';
        
        // Remove all state classes
        button.classList.remove('current-theme', 'apply-theme', 'can-afford', 'cannot-afford', 'sign-in-free', 'sign-in-paid');
        
        // Not logged in
        if (!user) {
            if (theme.price === 0) {
                button.textContent = 'Sign in to Apply';
                button.classList.add('sign-in-free');
            } else {
                button.textContent = 'Sign in to Purchase';
                button.disabled = true;
                button.style.opacity = '0.7';
                button.classList.add('sign-in-paid');
            }
            return;
        }
        
        // Current theme
        if (themeId === currentTheme) {
            button.textContent = 'Current Theme';
            button.classList.add('current-theme');
            button.disabled = true;
            button.style.cursor = 'default';
            return;
        }
        
        // Owned but not current
        if (userOwnsTheme(themeId)) {
            button.textContent = 'Apply Theme';
            button.classList.add('apply-theme');
            return;
        }
        
        // Can afford
        if (userData.points >= theme.price) {
            button.textContent = `Buy for ${theme.price} Points`;
            button.classList.add('can-afford');
            return;
        }
        
        // Cannot afford
        button.textContent = `Need ${theme.price} Points`;
        button.classList.add('cannot-afford');
        button.style.opacity = '0.5';
        button.disabled = true;
        button.style.cursor = 'not-allowed';
    });
}

// Update the updateTokenButtons function
function updateTokenButtons() {
    const user = auth.currentUser;
    
    document.querySelectorAll('.token-select-btn').forEach(button => {
        const tokenCard = button.closest('[data-token]');
        const tokenId = tokenCard.dataset.token;
        const token = TOKENS[tokenId];
        const equipButton = tokenCard.querySelector('.token-equip-btn');
        const sellButton = tokenCard.querySelector('.token-sell-btn');
        
        if (!token) return;
        
        // Reset button styling
        button.disabled = false;
        button.style.opacity = '';
        button.style.cursor = 'pointer';
        
        // Hide equip and sell buttons initially
        if (equipButton) {
            equipButton.style.display = 'none';
            equipButton.disabled = false;
            equipButton.style.opacity = '';
            equipButton.classList.remove('equipped', 'can-equip');
        }
        
        if (sellButton) {
            sellButton.style.display = 'none';
        }
        
        // Remove all state classes
        button.classList.remove('owned', 'can-afford', 'cannot-afford', 'sign-in');
        
        // Not logged in
        if (!user) {
            button.textContent = 'Sign in to Purchase';
            button.disabled = true;
            button.style.opacity = '0.7';
            button.classList.add('sign-in');
            return;
        }
        
        // Already owned
        if (userOwnsToken(tokenId)) {
            button.textContent = 'Owned';
            button.classList.add('owned');
            button.disabled = true;
            button.style.cursor = 'default';
            button.style.background = 'var(--success-color, #4CAF50)';
            
            // Show equip button
            if (equipButton) {
                equipButton.style.display = 'block';
                
                if (userHasTokenEquipped(tokenId)) {
                    equipButton.textContent = 'Equipped';
                    equipButton.classList.add('equipped');
                    equipButton.style.background = 'var(--accent-color, #2196F3)';
                    equipButton.style.cursor = 'pointer';
                } else {
                    equipButton.textContent = 'Equip';
                    equipButton.classList.add('can-equip');
                    equipButton.style.background = 'var(--info-color, #17a2b8)';
                    equipButton.style.cursor = 'pointer';
                }
            }
            
            // Show sell button for admins
            if (sellButton && userData.isAdmin) {
                sellButton.style.display = 'block';
            }
            
            return;
        }
        
        // Can afford
        if (userData.points >= token.price) {
            button.textContent = `Buy for ${token.price} Points`;
            button.classList.add('can-afford');
            button.style.background = '';
            return;
        }
        
        // Cannot afford
        button.textContent = `Need ${token.price} Points`;
        button.classList.add('cannot-afford');
        button.style.opacity = '0.5';
        button.disabled = true;
        button.style.cursor = 'not-allowed';
        button.style.background = 'var(--muted-color, #757575)';
    });
}

// Replace the current showMessage function with this enhanced version
function showMessage(text, type = 'info') {
    // Remove existing message
    const existingMessage = document.getElementById('store-message');
    if (existingMessage) {
        existingMessage.remove();
    }
    
    // Create message element
    const message = document.createElement('div');
    message.id = 'store-message';
    message.className = `store-message store-message-${type}`;
    
    message.textContent = text;
    document.body.appendChild(message);
    
    // Show message with animation
    requestAnimationFrame(() => {
        message.classList.add('visible');
    });
    
    // Hide message after delay
    setTimeout(() => {
        message.classList.remove('visible');
        
        // Remove after animation completes
        setTimeout(() => {
            if (message.parentNode) {
                message.remove();
            }
        }, 300);
    }, 4000);
}

// Export API for other modules
window.RedeemStore = {
    refreshUI: () => {
        updateThemeButtons();
        updateTokenButtons();
    },
    checkOwnership: userOwnsTheme,
    checkTokenOwnership: userOwnsToken,
    applyTheme,
    purchaseTheme,
    purchaseToken
};

console.log('🏪 Redeem store loaded');