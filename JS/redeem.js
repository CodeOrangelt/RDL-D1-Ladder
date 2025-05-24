import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
  collection, 
  getDocs, 
  doc, 
  updateDoc, 
  getDoc, 
  setDoc,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Global variables for DOM elements
let authWarning, storeContent, userPointsElement;

// User's owned items (simulate with localStorage for now)
let userInventory = JSON.parse(localStorage.getItem('userInventory') || '{}');
let enabledFeatures = JSON.parse(localStorage.getItem('enabledFeatures') || '{}');

// Admin UI visibility state
let adminUIVisible = true;

// Initialize DOM elements
function initializeElements() {
    authWarning = document.getElementById('auth-warning');
    storeContent = document.getElementById('store-content');
    userPointsElement = document.getElementById('user-points');
    
    console.log('DOM Elements found:', {
        authWarning: !!authWarning,
        storeContent: !!storeContent,
        userPointsElement: !!userPointsElement
    });
    
    return authWarning && storeContent;
}

// Initialize the page
document.addEventListener('DOMContentLoaded', () => {
    console.log('Redeem page DOM loaded, initializing...');
    
    // Wait a bit for nav to load, then initialize
    setTimeout(() => {
        const elementsReady = initializeElements();
        
        if (!elementsReady) {
            console.error('Failed to initialize DOM elements, retrying...');
            // Retry after another delay
            setTimeout(() => {
                const retrySuccess = initializeElements();
                if (!retrySuccess) {
                    console.error('DOM elements still not found after retry');
                    // Show content anyway for debugging
                    showContentFallback();
                    return;
                }
                setupPage();
            }, 1000);
        } else {
            setupPage();
        }
    }, 500);
});

// Fallback to show content if auth detection fails
function showContentFallback() {
    console.log('Using fallback to show content...');
    const storeContentFallback = document.getElementById('store-content');
    const authWarningFallback = document.getElementById('auth-warning');
    
    if (storeContentFallback) {
        storeContentFallback.style.display = 'block';
        console.log('✅ Store content shown via fallback');
    }
    
    if (authWarningFallback) {
        authWarningFallback.style.display = 'none';
    }
    
    // Set up purchase buttons and load inventory
    setupPurchaseButtons();
    loadUserInventory();
    
    // Load placeholder points
    const userPointsElementFallback = document.getElementById('user-points');
    if (userPointsElementFallback) {
        userPointsElementFallback.textContent = '1,250';
    }
}

function setupPage() {
    console.log('Setting up redeem page functionality...');
    
    // Initialize store items first
    initializeStoreItems().then(() => {
        // Set up auth state listener
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                console.log('✅ User authenticated:', user.displayName);
                if (authWarning && storeContent) {
                    authWarning.style.display = 'none';
                    storeContent.style.display = 'block';
                    
                    // Load user points and inventory
                    loadUserPoints(user);
                    loadUserInventory();
                    
                    // Check if user is admin and show admin controls if they are
                    const admin = await isUserAdmin(user);
                    if (admin) {
                        showAdminControls();
                        console.log('👑 Admin controls enabled');
                    }
                }
            } else {
                console.log('❌ User not authenticated');
                if (authWarning && storeContent) {
                    authWarning.style.display = 'block';
                    storeContent.style.display = 'none';
                }
            }
        });
        
        // Always set up purchase buttons and load inventory
        setupPurchaseButtons();
        loadUserInventory();
        
        // Show content immediately for testing (remove this later)
        if (storeContent) {
            storeContent.style.display = 'block';
            console.log('🔧 DEBUG: Showing store content for testing');
        }
    });
}

// Load user inventory and update UI
function loadUserInventory() {
    console.log('📦 Loading user inventory:', userInventory);
    console.log('⚙️ Enabled features:', enabledFeatures);
    
    const storeItems = document.querySelectorAll('.store-item');
    
    storeItems.forEach(item => {
        const itemTitle = item.querySelector('.item-title')?.textContent;
        const button = item.querySelector('.purchase-btn');
        
        if (itemTitle && userInventory[itemTitle]) {
            // User owns this item
            updateItemAsOwned(item, button, itemTitle);
        }
    });
}

// Update item UI when user owns it
function updateItemAsOwned(item, button, itemTitle) {
    // Add owned badge if not present
    if (!item.querySelector('.owned-badge')) {
        const ownedBadge = document.createElement('div');
        ownedBadge.className = 'owned-badge';
        ownedBadge.textContent = 'OWNED';
        item.appendChild(ownedBadge);
    }
    
    // Check active state in both localStorage and purchased items
    const isEnabled = enabledFeatures[itemTitle] || false;
    
    // Update button to toggle functionality
    button.innerHTML = isEnabled 
        ? '<i class="fas fa-toggle-on"></i> Disable' 
        : '<i class="fas fa-toggle-off"></i> Enable';
    
    button.style.background = isEnabled 
        ? 'linear-gradient(135deg, #ff5722, #e64a19)' // Red for disable
        : 'linear-gradient(135deg, #4caf50, #388e3c)'; // Green for enable
    
    button.disabled = false;
    
    // Update click handler for toggle functionality
    button.onclick = (e) => {
        e.preventDefault();
        toggleFeature(itemTitle, button, item);
    };
    
    // Add status indicator
    updateFeatureStatusIndicator(item, itemTitle, isEnabled);
}

// Toggle feature on/off
async function toggleFeature(itemTitle, button, item) {
    const wasEnabled = enabledFeatures[itemTitle] || false;
    const newState = !wasEnabled;
    
    console.log(`🔄 Toggling ${itemTitle}: ${wasEnabled ? 'ON' : 'OFF'} → ${newState ? 'ON' : 'OFF'}`);
    
    // Show loading state
    const originalText = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';
    
    try {
        // Update Firestore for profile display
        const user = auth.currentUser;
        if (user) {
            const userRef = doc(db, "userProfiles", user.uid);
            const userDoc = await getDoc(userRef);
            
            if (userDoc.exists()) {
                const userData = userDoc.data();
                const purchasedItems = userData.purchasedItems || {};
                
                // Update the active state for this item
                if (purchasedItems[itemTitle]) {
                    purchasedItems[itemTitle].active = newState;
                    
                    // Update Firestore with the new active state
                    await updateDoc(userRef, {
                        purchasedItems: purchasedItems
                    });
                    
                    console.log(`✅ Updated ${itemTitle} active state in Firestore: ${newState}`);
                }
            }
        }
        
        // Update local storage
        enabledFeatures[itemTitle] = newState;
        localStorage.setItem('enabledFeatures', JSON.stringify(enabledFeatures));
        
        // Apply/remove the feature effect
        if (newState) {
            applyFeatureEffect(itemTitle);
            showTempMessage(`✅ ${itemTitle} enabled!`, 'success');
        } else {
            removeFeatureEffect(itemTitle);
            showTempMessage(`⚪ ${itemTitle} disabled`, 'info');
        }
        
        // Update button appearance
        button.innerHTML = newState 
            ? '<i class="fas fa-toggle-on"></i> Disable' 
            : '<i class="fas fa-toggle-off"></i> Enable';
        
        button.style.background = newState 
            ? 'linear-gradient(135deg, #ff5722, #e64a19)' 
            : 'linear-gradient(135deg, #4caf50, #388e3c)';
        
        button.disabled = false;
        
        // Update status indicator on the item
        updateFeatureStatusIndicator(item, itemTitle, newState);
        
    } catch (error) {
        console.error('❌ Toggle failed:', error);
        button.innerHTML = originalText;
        button.disabled = false;
        showTempMessage(`❌ Failed to toggle ${itemTitle}`, 'error');
    }
}
// Update visual indicator for feature status
function updateFeatureStatusIndicator(item, itemTitle, isEnabled) {
    // Remove existing status indicator
    const existingIndicator = item.querySelector('.feature-status');
    if (existingIndicator) {
        existingIndicator.remove();
    }
    
    // Add new status indicator
    const statusIndicator = document.createElement('div');
    statusIndicator.className = 'feature-status';
    statusIndicator.style.cssText = `
        position: absolute;
        top: 10px;
        left: ${item.querySelector('.limited-badge') ? '90px' : '10px'};
        padding: 5px 10px;
        border-radius: 15px;
        font-size: 11px;
        font-weight: bold;
        text-transform: uppercase;
        ${isEnabled 
            ? 'background: #4CAF50; color: white; animation: pulse-green 2s infinite;' 
            : 'background: #666; color: #ccc;'
        }
    `;
    statusIndicator.textContent = isEnabled ? 'ACTIVE' : 'INACTIVE';
    
    item.appendChild(statusIndicator);
}

// Apply feature effects to the website
function applyFeatureEffect(itemTitle) {
    console.log(`🎨 Applying effect for: ${itemTitle}`);
    
    switch (itemTitle) {
        case 'Dark Purple Theme':
            document.body.style.filter = 'hue-rotate(20deg) saturate(1.2)';
            break;
            
        case 'Glow Effects':
            addGlowEffects();
            break;
            
        case 'Animated Background Pack':
            addAnimatedBackground();
            break;
            
        case 'Golden Elite Theme':
            addGoldenTheme();
            break;
            
        case 'Hot Streak':
            addHotStreakEffect();
            break;
            
        case 'Destroyer':
            addDestroyerEffect();
            break;
            
        default:
            console.log(`No visual effect defined for: ${itemTitle}`);
    }
}

// Remove feature effects from the website
function removeFeatureEffect(itemTitle) {
    console.log(`🗑️ Removing effect for: ${itemTitle}`);
    
    switch (itemTitle) {
        case 'Dark Purple Theme':
            document.body.style.filter = '';
            break;
            
        case 'Glow Effects':
            removeGlowEffects();
            break;
            
        case 'Animated Background Pack':
            removeAnimatedBackground();
            break;
            
        case 'Golden Elite Theme':
            removeGoldenTheme();
            break;
            
        case 'Hot Streak':
            removeHotStreakEffect();
            break;
            
        case 'Destroyer':
            removeDestroyerEffect();
            break;
    }
}

// Feature effect implementations
function addGlowEffects() {
    const style = document.createElement('style');
    style.id = 'glow-effects';
    style.textContent = `
        .purchase-btn:hover:not(:disabled) {
            box-shadow: 0 0 20px rgba(156, 39, 176, 0.8) !important;
        }
        .store-item:hover {
            box-shadow: 0 8px 25px rgba(156, 39, 176, 0.4) !important;
        }
        .item-title {
            text-shadow: 0 0 10px rgba(156, 39, 176, 0.5) !important;
        }
    `;
    document.head.appendChild(style);
}

function removeGlowEffects() {
    const style = document.getElementById('glow-effects');
    if (style) style.remove();
}

function addAnimatedBackground() {
    const style = document.createElement('style');
    style.id = 'animated-bg';
    style.textContent = `
        body::before {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: 
                radial-gradient(circle at 20% 50%, rgba(156, 39, 176, 0.1) 0%, transparent 50%),
                radial-gradient(circle at 80% 20%, rgba(103, 58, 183, 0.1) 0%, transparent 50%),
                radial-gradient(circle at 40% 80%, rgba(156, 39, 176, 0.1) 0%, transparent 50%);
            animation: float 6s ease-in-out infinite;
            z-index: -1;
            pointer-events: none;
        }
        
        @keyframes float {
            0%, 100% { transform: translate(0px, 0px) scale(1); }
            33% { transform: translate(30px, -30px) scale(1.1); }
            66% { transform: translate(-20px, 20px) scale(0.9); }
        }
    `;
    document.head.appendChild(style);
}

function removeAnimatedBackground() {
    const style = document.getElementById('animated-bg');
    if (style) style.remove();
}

function addGoldenTheme() {
    const style = document.createElement('style');
    style.id = 'golden-theme';
    style.textContent = `
        .store-item {
            border-color: #ffd700 !important;
            background: linear-gradient(135deg, rgba(255, 215, 0, 0.1), rgba(255, 215, 0, 0.05)) !important;
        }
        .item-icon {
            color: #ffd700 !important;
        }
        .purchase-btn {
            background: linear-gradient(135deg, #ffd700, #ffb300) !important;
            color: #000 !important;
        }
    `;
    document.head.appendChild(style);
}

function removeGoldenTheme() {
    const style = document.getElementById('golden-theme');
    if (style) style.remove();
}

function addHotStreakEffect() {
    const style = document.createElement('style');
    style.id = 'hot-streak';
    style.textContent = `
        .page-title::after {
            content: '🔥';
            animation: fire 1s ease-in-out infinite alternate;
            margin-left: 10px;
        }
        @keyframes fire {
            0% { transform: scale(1) rotate(-5deg); }
            100% { transform: scale(1.2) rotate(5deg); }
        }
    `;
    document.head.appendChild(style);
}

function removeHotStreakEffect() {
    const style = document.getElementById('hot-streak');
    if (style) style.remove();
}

function addDestroyerEffect() {
    const style = document.createElement('style');
    style.id = 'destroyer-effect';
    style.textContent = `
        .page-title {
            color: #ff1744 !important;
            text-shadow: 0 0 10px rgba(255, 23, 68, 0.5) !important;
        }
        .store-item:hover {
            border-color: #ff1744 !important;
        }
    `;
    document.head.appendChild(style);
}

function removeDestroyerEffect() {
    const style = document.getElementById('destroyer-effect');
    if (style) style.remove();
}

// Load user points
async function loadUserPoints(user) {
    try {
        if (userPointsElement && user) {
            // Get user points from Firestore
            const userRef = doc(db, "userProfiles", user.uid);
            const userDoc = await getDoc(userRef);
            
            if (userDoc.exists()) {
                // Get points from user profile, default to 0 if doesn't exist
                const points = userDoc.data().points || 0;
                userPointsElement.textContent = points.toLocaleString();
                console.log(`Loaded ${points} points for user:`, user.displayName);
            } else {
                // If user document doesn't exist, create it with 0 points
                await setDoc(userRef, { points: 0 });
                userPointsElement.textContent = '0';
                console.log(`Created new profile with 0 points for user:`, user.displayName);
            }
        }
    } catch (error) {
        console.error('Error loading user points:', error);
        // Fallback to 0 on error
        if (userPointsElement) userPointsElement.textContent = '0';
    }
}

// Function to show temporary messages to the user
function showTempMessage(message, type = 'info') {
    console.log(`Message (${type}): ${message}`);
    
    // Remove any existing message
    const existingMessage = document.querySelector('.temp-message');
    if (existingMessage) {
        existingMessage.remove();
    }
    
    // Create new message element
    const messageElement = document.createElement('div');
    messageElement.className = `temp-message message-${type}`;
    messageElement.innerHTML = message;
    
    // Style the message based on type
    let backgroundColor, textColor, borderColor;
    switch (type) {
        case 'success':
            backgroundColor = 'rgba(76, 175, 80, 0.9)';
            textColor = 'white';
            borderColor = '#2e7d32';
            break;
        case 'error':
            backgroundColor = 'rgba(244, 67, 54, 0.9)';
            textColor = 'white';
            borderColor = '#c62828';
            break;
        case 'info':
        default:
            backgroundColor = 'rgba(33, 150, 243, 0.9)';
            textColor = 'white';
            borderColor = '#1565c0';
            break;
    }
    
    // Apply styles
    messageElement.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        padding: 12px 24px;
        border-radius: 8px;
        font-size: 16px;
        font-weight: 500;
        z-index: 9999;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        animation: fadeInOut 4s forwards;
        background-color: ${backgroundColor};
        color: ${textColor};
        border: 2px solid ${borderColor};
    `;
    
    // Add animation styles if not already added
    if (!document.getElementById('message-animations')) {
        const animationStyle = document.createElement('style');
        animationStyle.id = 'message-animations';
        animationStyle.textContent = `
            @keyframes fadeInOut {
                0% { opacity: 0; transform: translate(-50%, -20px); }
                10% { opacity: 1; transform: translate(-50%, 0); }
                80% { opacity: 1; transform: translate(-50%, 0); }
                100% { opacity: 0; transform: translate(-50%, -20px); }
            }
        `;
        document.head.appendChild(animationStyle);
    }
    
    // Add to document and set timeout to remove
    document.body.appendChild(messageElement);
    
    // Remove after animation completes
    setTimeout(() => {
        if (messageElement.parentNode) {
            messageElement.remove();
        }
    }, 4000);
}

// Set up purchase button functionality
function setupPurchaseButtons() {
    const purchaseButtons = document.querySelectorAll('.purchase-btn');
    
    purchaseButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            e.preventDefault();
            
            const storeItem = button.closest('.store-item');
            const itemTitle = storeItem.querySelector('.item-title')?.textContent || 'Unknown Item';
            const itemPrice = storeItem.querySelector('.item-price')?.textContent || '0 Points';
            
            // Check if user already owns this item
            if (userInventory[itemTitle]) {
                // This is now handled by the toggle function
                return;
            }
            
            handlePurchase(itemTitle, itemPrice, button);
        });
    });
    
    console.log(`✅ Set up ${purchaseButtons.length} purchase buttons`);
}

// Handle purchase logic
async function handlePurchase(itemTitle, itemPrice, button) {
    console.log(`🛒 Attempting to purchase: ${itemTitle} for ${itemPrice}`);
    
    // Disable button during purchase
    const originalText = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    
    try {
        // Parse price amount
        const priceAmount = parseInt(itemPrice.replace(/[^0-9]/g, ''));
        
        // Get current user
        const user = auth.currentUser;
        if (!user) {
            throw new Error('You must be logged in to make purchases');
        }
        
        // Get user document
        const userRef = doc(db, "userProfiles", user.uid);
        const userDoc = await getDoc(userRef);
        
        if (!userDoc.exists()) {
            throw new Error('User profile not found');
        }
        
        // Get current points
        const currentPoints = userDoc.data().points || 0;
        
        // Check if user has enough points
        if (currentPoints < priceAmount) {
            throw new Error(`Not enough points! Need ${priceAmount}, but you have ${currentPoints}`);
        }
        
        // Deduct points from user account
        const newPoints = currentPoints - priceAmount;
        
        // Get existing purchased items or create empty object
        const existingData = userDoc.data();
        const purchasedItems = existingData.purchasedItems || {};
        
        // Add item to purchased items with timestamp and state
        purchasedItems[itemTitle] = {
            purchasedAt: new Date(),
            price: priceAmount,
            owned: true,
            active: true
        };
        
        // Update user profile with points and purchased items
        await updateDoc(userRef, { 
            points: newPoints,
            purchasedItems: purchasedItems
        });
        
        // Also update localStorage for client-side tracking
        userInventory[itemTitle] = {
            purchaseDate: new Date().toISOString(),
            price: itemPrice
        };
        localStorage.setItem('userInventory', JSON.stringify(userInventory));
        
        // Enable the feature by default
        enabledFeatures[itemTitle] = true;
        localStorage.setItem('enabledFeatures', JSON.stringify(enabledFeatures));
        
        // Apply the feature effect
        applyFeatureEffect(itemTitle);
        
        // Show success message
        showTempMessage(`✅ Successfully purchased ${itemTitle}! It will appear on your profile.`, 'success');
        
        // Update the item UI
        const storeItem = button.closest('.store-item');
        updateItemAsOwned(storeItem, button, itemTitle);
        
        // Update UI with new points value
        if (userPointsElement) {
            userPointsElement.textContent = newPoints.toLocaleString();
        }
        
    } catch (error) {
        console.error('❌ Purchase failed:', error);
        button.innerHTML = originalText;
        button.disabled = false;
        showTempMessage(`❌ ${error.message || 'Failed to purchase. Please try again.'}`, 'error');
    }
}

// Check if user is an admin
async function isUserAdmin(user) {
    if (!user) return false;
    
    try {
        const userRef = doc(db, "userProfiles", user.uid);
        const userDoc = await getDoc(userRef);
        
        if (userDoc.exists()) {
            return userDoc.data().isAdmin === true;
        }
        return false;
    } catch (error) {
        console.error("Error checking admin status:", error);
        return false;
    }
}

// Global variable to store item prices
let storeItemPrices = {};

// Update initializeStoreItems function to include all item data
async function initializeStoreItems() {
    try {
        const storeItemsRef = collection(db, "storeItems");
        const querySnapshot = await getDocs(storeItemsRef);
        
        // If no items exist yet, create default entries
        if (querySnapshot.empty) {
            console.log("Creating default store items...");
            const defaultItems = [
                { id: "darkPurpleTheme", title: "Dark Purple Theme", price: 500, 
                  description: "Unlock a sleek dark purple color scheme for the entire website.",
                  features: ["Deep purple gradients", "Enhanced contrast", "Custom purple accents"] },
                { id: "animatedBackgroundPack", title: "Animated Background Pack", price: 750,
                  description: "Collection of 5 animated space-themed backgrounds.",
                  features: ["Parallax star fields", "Floating particles", "Smooth animations"] },
                { id: "glowEffects", title: "Glow Effects", price: 300,
                  description: "Add subtle glow effects to buttons and interactive elements.",
                  features: ["Button hover glows", "Text shadow effects", "Customizable intensity"] },
                { id: "goldenEliteTheme", title: "Golden Elite Theme", price: 1000 },
                { id: "veteranPlayer", title: "Veteran Player", price: 100 },
                { id: "hotStreak", title: "Hot Streak", price: 250 },
                { id: "destroyer", title: "Destroyer", price: 350 },
                { id: "tournamentChampion", title: "Tournament Champion", price: 500 },
                { id: "risingStar", title: "Rising Star", price: 150 },
                { id: "legendary", title: "Legendary", price: 1200 }
            ];
            
            for (const item of defaultItems) {
                await setDoc(doc(storeItemsRef, item.id), item);
            }
            
            // Fetch the newly created items
            return await initializeStoreItems();
        }
        
        // Build store items from database
        let allStoreItems = {};
        
        querySnapshot.forEach(doc => {
            const itemData = doc.data();
            // Store complete item data, not just prices
            allStoreItems[itemData.title] = itemData;
            // Also maintain backward compatibility with existing code
            storeItemPrices[itemData.title] = itemData.price;
        });
        
        console.log("📦 Store items loaded:", allStoreItems);
        
        // Update the UI with loaded data
        updateStoreItemsFromDatabase(allStoreItems);
        
        return allStoreItems;
        
    } catch (error) {
        console.error("Error initializing store items:", error);
        return {};
    }
}

// Update store items in the UI with data from database
function updateStoreItemsFromDatabase(storeItems) {
    const storeItemElements = document.querySelectorAll('.store-item');
    
    storeItemElements.forEach(itemElement => {
        const titleElement = itemElement.querySelector('.item-title');
        if (!titleElement) return;
        
        const itemTitle = titleElement.textContent;
        const itemData = storeItems[itemTitle];
        
        if (!itemData) return; // No data for this item
        
        // Update price
        const priceElement = itemElement.querySelector('.item-price');
        if (priceElement && itemData.price) {
            priceElement.textContent = `${itemData.price} Points`;
        }
        
        // Update description
        const descElement = itemElement.querySelector('.item-description');
        if (descElement && itemData.description) {
            descElement.textContent = itemData.description;
        }
        
        // Update features
        const featuresList = itemElement.querySelector('.item-features');
        if (featuresList && itemData.features && Array.isArray(itemData.features)) {
            // Clear existing features
            featuresList.innerHTML = '';
            
            // Add features from database
            itemData.features.forEach(feature => {
                const li = document.createElement('li');
                li.textContent = feature;
                featuresList.appendChild(li);
            });
        }
    });
}

// Add admin styles to the page
function addAdminStyles() {
    const styleElement = document.createElement('style');
    styleElement.id = 'admin-styles';
    styleElement.textContent = `
        .admin-badge {
            animation: pulse-admin 2s infinite alternate;
        }
        
        .admin-price-editor {
            margin-top: 15px;
            padding-top: 10px;
            border-top: 1px dashed rgba(255, 255, 255, 0.2);
        }
        
        .admin-save-btn:hover {
            background: #2e7d32 !important;
            transform: scale(1.05);
        }
        
        .points-action-button.active {
            box-shadow: 0 0 0 2px white;
        }
        
        @keyframes pulse-admin {
            0% { opacity: 0.8; }
            100% { opacity: 1; }
        }
    `;
    document.head.appendChild(styleElement);
}

// Call this at the beginning of showAdminControls
function showAdminControls() {
    // Add admin styles first
    addAdminStyles();
    
    // Initialize admin UI visibility
    initializeAdminUIVisibility();
    
    // Add admin badge to the page
    const pageTitle = document.querySelector('.page-title');
    if (pageTitle && !document.querySelector('.admin-badge')) {
        const adminBadge = document.createElement('span');
        adminBadge.className = 'admin-badge';
        adminBadge.innerHTML = ' <span style="background:#ff5722;color:white;padding:5px 10px;border-radius:15px;font-size:14px;margin-left:10px;">Admin Mode</span>';
        pageTitle.appendChild(adminBadge);
    }
    
    // Add edit controls to each store item
    const storeItems = document.querySelectorAll('.store-item');
    storeItems.forEach(item => {
        const itemTitle = item.querySelector('.item-title');
        const itemDesc = item.querySelector('.item-description');
        const priceElement = item.querySelector('.item-price');
        const featuresList = item.querySelector('.item-features');
        
        // Make the title editable
        if (itemTitle) {
            makeElementEditable(itemTitle, 'title', item);
        }
        
        // Make the description editable
        if (itemDesc) {
            makeElementEditable(itemDesc, 'description', item);
        }
        
        // Make each feature list item editable
        if (featuresList) {
            const features = featuresList.querySelectorAll('li');
            features.forEach((feature, index) => {
                makeElementEditable(feature, `feature-${index}`, item);
            });
        }
        
        // Add price editor
        if (priceElement) {
            // Get current price
            const currentPrice = storeItemPrices[itemTitle.textContent] || parseInt(priceElement.textContent.replace(/[^0-9]/g, ''));
            
            // Add edit button and input field
            const priceContainer = document.createElement('div');
            priceContainer.className = 'admin-price-editor';
            priceContainer.style.cssText = 'display:flex;align-items:center;margin:10px 0;';
            
            // Create input for price
            const priceInput = document.createElement('input');
            priceInput.type = 'number';
            priceInput.value = currentPrice;
            priceInput.min = 0;
            priceInput.max = 10000;
            priceInput.style.cssText = 'width:80px;padding:5px;border-radius:4px;border:1px solid #673ab7;margin-right:5px;';
            
            // Create save button
            const saveButton = document.createElement('button');
            saveButton.innerHTML = '<i class="fas fa-save"></i>';
            saveButton.className = 'admin-save-btn';
            saveButton.style.cssText = 'padding:5px 10px;border-radius:4px;background:#4CAF50;border:none;color:white;cursor:pointer;';
            saveButton.title = 'Save price';
            
            // Add event listener to save button
            saveButton.addEventListener('click', () => {
                saveItemPrice(itemTitle.textContent, parseInt(priceInput.value), priceElement);
            });
            
            // Append elements to the container
            priceContainer.appendChild(document.createTextNode('Set price: '));
            priceContainer.appendChild(priceInput);
            priceContainer.appendChild(saveButton);
            
            // Add container to the item
            item.appendChild(priceContainer);
        }
    });
    
    // Add global controls at the top
    addGlobalAdminControls();
}

// Add global admin controls to the top of the store
function addGlobalAdminControls() {
    // Check if already exists
    if (document.querySelector('.admin-global-controls')) return;
    
    const storeContent = document.getElementById('store-content');
    const userPoints = document.querySelector('.user-points');
    
    if (storeContent && userPoints) {
        const controlsContainer = document.createElement('div');
        controlsContainer.className = 'admin-global-controls';
        controlsContainer.style.cssText = `
            background: rgba(0, 0, 0, 0.7);
            border-radius: 10px;
            padding: 15px 20px;
            margin-bottom: 20px;
            border: 2px solid #ff5722;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
        `;
        
        // Update the HTML here
        controlsContainer.innerHTML = `
            <div style="display:flex;align-items:center">
                <h3 style="margin:0;color:#ff5722"><i class="fas fa-shield-alt"></i> Admin Controls</h3>
            </div>
            <div style="display:flex;gap:10px;margin-top:10px">
                <button id="toggle-admin-btn" style="padding:8px 15px;border-radius:5px;background:#673ab7;border:none;color:white;cursor:pointer">
                    <i class="fas fa-eye-slash"></i> Hide Admin UI
                </button>
                <button id="save-all-btn" style="padding:8px 15px;border-radius:5px;background:#4CAF50;border:none;color:white;cursor:pointer">
                    <i class="fas fa-save"></i> Save All Changes
                </button>
                <button id="add-points-btn" style="padding:8px 15px;border-radius:5px;background:#2196F3;border:none;color:white;cursor:pointer">
                    <i class="fas fa-coins"></i> Modify User Points
                </button>
            </div>
        `;
        
        // Insert before the user points display
        storeContent.insertBefore(controlsContainer, userPoints);
        
        // Add event listeners
        document.getElementById('save-all-btn').addEventListener('click', saveAllChanges);
        document.getElementById('add-points-btn').addEventListener('click', showPointsModifierDialog);
        document.getElementById('toggle-admin-btn').addEventListener('click', toggleAdminUI);
    }
}

// Save item price to Firestore
async function saveItemPrice(itemTitle, price, priceElement) {
    try {
        // Find the item in the database
        const storeItemsRef = collection(db, "storeItems");
        const q = query(storeItemsRef, where("title", "==", itemTitle));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            // Create new item if it doesn't exist
            const newItemId = itemTitle.toLowerCase().replace(/\s+/g, '');
            await setDoc(doc(storeItemsRef, newItemId), {
                id: newItemId,
                title: itemTitle,
                price: price
            });
        } else {
            // Update existing item
            const itemDoc = querySnapshot.docs[0];
            await updateDoc(doc(storeItemsRef, itemDoc.id), {
                price: price
            });
        }
        
        // Update local cache
        storeItemPrices[itemTitle] = price;
        
        // Update displayed price
        if (priceElement) {
            priceElement.textContent = `${price} Points`;
        }
        
        showTempMessage(`✅ Price updated for ${itemTitle}`, 'success');
    } catch (error) {
        console.error('Error saving item price:', error);
        showTempMessage(`❌ Failed to save price: ${error.message}`, 'error');
    }
}

// Update the saveAllPrices function name and functionality
async function saveAllChanges() {
    try {
        // Save prices
        const priceInputs = document.querySelectorAll('.admin-price-editor input');
        let updateCount = 0;
        
        for (const input of priceInputs) {
            const item = input.closest('.store-item');
            const itemTitle = item.querySelector('.item-title').textContent;
            const priceElement = item.querySelector('.item-price');
            const price = parseInt(input.value);
            
            // Only update if price changed
            if (price !== storeItemPrices[itemTitle]) {
                await saveItemPrice(itemTitle, price, priceElement);
                updateCount++;
            }
        }
        
        showTempMessage(`✅ Updated ${updateCount} item prices`, 'success');
    } catch (error) {
        console.error('Error saving all changes:', error);
        showTempMessage(`❌ Failed to save all changes: ${error.message}`, 'error');
    }
}

// Show dialog to modify user points
function showPointsModifierDialog() {
    // Create dialog overlay
    const overlay = document.createElement('div');
    overlay.className = 'points-modifier-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.7);
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
    `;
    
    // Create dialog content
    const dialog = document.createElement('div');
    dialog.className = 'points-modifier-dialog';
    dialog.style.cssText = `
        background: #212121;
        border: 2px solid #9c27b0;
        border-radius: 10px;
        padding: 20px;
        width: 400px;
        max-width: 90%;
    `;
    
    dialog.innerHTML = `
        <h3 style="margin-top:0;color:#9c27b0;text-align:center">
            <i class="fas fa-coins"></i> Modify User Points
        </h3>
        <div style="margin-bottom:15px">
            <label style="display:block;margin-bottom:5px;color:#ccc">User ID or Email:</label>
            <input id="user-lookup" type="text" style="width:100%;padding:8px;border-radius:5px;background:#333;color:white;border:1px solid #555" placeholder="User ID or email address">
        </div>
        <div style="margin-bottom:15px" id="points-controls" style="display:none">
            <label style="display:block;margin-bottom:5px;color:#ccc">Points Action:</label>
            <div style="display:flex;gap:10px;margin-bottom:10px">
                <button id="points-add" style="flex:1;padding:8px;border-radius:5px;background:#4CAF50;border:none;color:white;cursor:pointer">
                    <i class="fas fa-plus"></i> Add
                </button>
                <button id="points-set" style="flex:1;padding:8px;border-radius:5px;background:#2196F3;border:none;color:white;cursor:pointer">
                    <i class="fas fa-edit"></i> Set
                </button>
                <button id="points-subtract" style="flex:1;padding:8px;border-radius:5px;background:#FF5722;border:none;color:white;cursor:pointer">
                    <i class="fas fa-minus"></i> Subtract
                </button>
            </div>
            <div>
                <label style="display:block;margin-bottom:5px;color:#ccc">Amount:</label>
                <input id="points-amount" type="number" min="0" value="100" style="width:100%;padding:8px;border-radius:5px;background:#333;color:white;border:1px solid #555">
            </div>
        </div>
        <div id="user-info" style="margin-bottom:15px;padding:10px;border-radius:5px;background:#333;display:none">
            <p id="user-name" style="margin:0 0 5px 0;color:#fff"></p>
            <p id="user-current-points" style="margin:0;color:#aaa"></p>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:20px">
            <button id="lookup-user-btn" style="padding:8px 15px;border-radius:5px;background:#9c27b0;border:none;color:white;cursor:pointer">
                <i class="fas fa-search"></i> Look Up User
            </button>
            <button id="cancel-btn" style="padding:8px 15px;border-radius:5px;background:#666;border:none;color:white;cursor:pointer">
                Cancel
            </button>
            <button id="apply-points-btn" style="padding:8px 15px;border-radius:5px;background:#4CAF50;border:none;color:white;cursor:pointer;display:none">
                <i class="fas fa-check"></i> Apply
            </button>
        </div>
    `;
    
    // Append dialog to overlay
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    
    // Setup event listeners
    let currentUser = null;
    
    document.getElementById('lookup-user-btn').addEventListener('click', async () => {
        const userLookup = document.getElementById('user-lookup').value.trim();
        if (!userLookup) {
            showTempMessage('❌ Please enter a user ID or email', 'error');
            return;
        }
        
        try {
            // Look up user by email or ID
            let userRef;
            
            if (userLookup.includes('@')) {
                // Search by email
                const usersRef = collection(db, "userProfiles");
                const q = query(usersRef, where("email", "==", userLookup));
                const querySnapshot = await getDocs(q);
                
                if (!querySnapshot.empty) {
                    userRef = querySnapshot.docs[0].ref;
                    currentUser = { id: querySnapshot.docs[0].id, ...querySnapshot.docs[0].data() };
                }
            } else {
                // Try direct ID lookup
                userRef = doc(db, "userProfiles", userLookup);
                const userDoc = await getDoc(userRef);
                
                if (userDoc.exists()) {
                    currentUser = { id: userDoc.id, ...userDoc.data() };
                }
            }
            
            if (currentUser) {
                // Show user info
                document.getElementById('user-info').style.display = 'block';
                document.getElementById('user-name').textContent = currentUser.displayName || currentUser.email || currentUser.id;
                document.getElementById('user-current-points').textContent = `Current Points: ${currentUser.points || 0}`;
                
                // Show points controls
                document.getElementById('points-controls').style.display = 'block';
                document.getElementById('apply-points-btn').style.display = 'inline-block';
                document.getElementById('lookup-user-btn').style.display = 'none';
            } else {
                showTempMessage('❌ User not found', 'error');
            }
        } catch (error) {
            console.error('Error looking up user:', error);
            showTempMessage(`❌ Error: ${error.message}`, 'error');
        }
    });
    
    document.getElementById('apply-points-btn').addEventListener('click', async () => {
        if (!currentUser) return;
        
        const amount = parseInt(document.getElementById('points-amount').value);
        
        if (isNaN(amount) || amount < 0) {
            showTempMessage('❌ Please enter a valid amount', 'error');
            return;
        }
        
        try {
            let newPoints = currentUser.points || 0;
            let action = '';
            
            // Determine which action button was clicked
            if (document.getElementById('points-add').classList.contains('active')) {
                newPoints += amount;
                action = 'added';
            } else if (document.getElementById('points-subtract').classList.contains('active')) {
                newPoints = Math.max(0, newPoints - amount);
                action = 'subtracted';
            } else {
                newPoints = amount;
                action = 'set to';
            }
            
            // Update points in database
            const userRef = doc(db, "userProfiles", currentUser.id);
            await updateDoc(userRef, { points: newPoints });
            
            showTempMessage(`✅ ${amount} points ${action} for ${currentUser.displayName || currentUser.email}`, 'success');
            
            // Close the dialog
            overlay.remove();
            
        } catch (error) {
            console.error('Error updating points:', error);
            showTempMessage(`❌ Error: ${error.message}`, 'error');
        }
    });
    
    // Set active state for point action buttons
    const pointsButtons = [
        document.getElementById('points-add'),
        document.getElementById('points-set'),
        document.getElementById('points-subtract')
    ];
    
    pointsButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            pointsButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });
    
    // Set "add" as default active
    document.getElementById('points-add').classList.add('active');
    
    // Cancel button
    document.getElementById('cancel-btn').addEventListener('click', () => {
        overlay.remove();
    });
}

// Function to toggle admin editing UI
async function toggleAdminUI() {
    // Security check - only admins can toggle admin UI
    if (!auth.currentUser) return;
    
    const isAdmin = await isUserAdmin(auth.currentUser);
    if (!isAdmin) {
        showTempMessage('❌ Admin privileges required', 'error');
        return;
    }
    
    adminUIVisible = !adminUIVisible;
    
    // Toggle button text
    const toggleBtn = document.getElementById('toggle-admin-btn');
    if (toggleBtn) {
        toggleBtn.innerHTML = adminUIVisible ? 
            '<i class="fas fa-eye-slash"></i> Hide Admin UI' : 
            '<i class="fas fa-eye"></i> Show Admin UI';
    }
    
    // Toggle admin editor visibility
    const adminEditors = document.querySelectorAll('.admin-price-editor, .admin-text-editor');
    adminEditors.forEach(editor => {
        editor.style.display = adminUIVisible ? 'flex' : 'none';
    });
    
    // Show message
    showTempMessage(
        adminUIVisible ? 
        '👁️ Admin UI elements are now visible' : 
        '🙈 Admin UI elements are now hidden', 
        'info'
    );
    
    // Store preference
    localStorage.setItem('adminUIVisible', adminUIVisible);
}

// Initialize admin UI visibility from local storage
function initializeAdminUIVisibility() {
    const storedVisibility = localStorage.getItem('adminUIVisible');
    if (storedVisibility !== null) {
        adminUIVisible = storedVisibility === 'true';
        // Apply visibility right away if admin controls are present
        setTimeout(() => {
            if (document.getElementById('toggle-admin-btn')) {
                toggleAdminUI();
            }
        }, 100);
    }
}

// Make an element editable for admin - add admin check
function makeElementEditable(element, fieldType, itemContainer) {
    // Security check - verify user is admin
    if (!auth.currentUser) return;
    
    // Add additional safety check to ensure only admins can edit
    isUserAdmin(auth.currentUser).then(isAdmin => {
        if (!isAdmin) return;
        
        // Mark the original text
        const originalText = element.innerHTML;
        element.dataset.originalText = originalText;
        
        // Add edit styling
        element.style.position = 'relative';
        
        // Create edit indicator
        const editIndicator = document.createElement('span');
        editIndicator.className = 'admin-edit-indicator';
        editIndicator.innerHTML = '<i class="fas fa-pencil-alt"></i>';
        editIndicator.style.cssText = `
            position: absolute;
            top: -8px;
            right: -8px;
            background: #673ab7;
            color: white;
            width: 18px;
            height: 18px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            cursor: pointer;
            opacity: 0.7;
            transition: opacity 0.2s;
        `;
        editIndicator.addEventListener('mouseenter', () => {
            editIndicator.style.opacity = '1';
        });
        editIndicator.addEventListener('mouseleave', () => {
            editIndicator.style.opacity = '0.7';
        });
        element.appendChild(editIndicator);
        
        // Add click listener to make element editable
        editIndicator.addEventListener('click', async (e) => {
            // Double-check admin status before editing (added security)
            const stillAdmin = await isUserAdmin(auth.currentUser);
            if (!stillAdmin) {
                showTempMessage('❌ Admin privileges required', 'error');
                return;
            }
            
            // Create edit UI
            const editContainer = document.createElement('div');
            editContainer.className = 'admin-text-editor';
            editContainer.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.8);
                z-index: 10;
                padding: 10px;
                border-radius: 5px;
                display: flex;
                flex-direction: column;
            `;
            
            // Create editor based on field type
            let editor;
            if (fieldType === 'description') {
                editor = document.createElement('textarea');
                editor.style.height = '80px';
            } else {
                editor = document.createElement('input');
                editor.type = 'text';
            }
            
            editor.value = element.textContent.trim();
            editor.style.cssText = `
                width: 100%;
                padding: 5px;
                margin-bottom: 5px;
                background: #333;
                color: white;
                border: 1px solid #673ab7;
                border-radius: 3px;
            `;
            
            // Create buttons container
            const buttonsContainer = document.createElement('div');
            buttonsContainer.style.cssText = `
                display: flex;
                justify-content: space-between;
            `;
            
            // Save button
            const saveBtn = document.createElement('button');
            saveBtn.innerHTML = '<i class="fas fa-check"></i> Save';
            saveBtn.style.cssText = `
                padding: 3px 8px;
                background: #4CAF50;
                color: white;
                border: none;
                border-radius: 3px;
                cursor: pointer;
            `;
            
            // Cancel button
            const cancelBtn = document.createElement('button');
            cancelBtn.innerHTML = '<i class="fas fa-times"></i> Cancel';
            cancelBtn.style.cssText = `
                padding: 3px 8px;
                background: #F44336;
                color: white;
                border: none;
                border-radius: 3px;
                cursor: pointer;
                margin-left: 5px;
            `;
            
            // Add event listeners
            saveBtn.addEventListener('click', () => {
                const itemTitle = itemContainer.querySelector('.item-title').textContent;
                saveItemText(itemTitle, fieldType, editor.value, element);
                editContainer.remove();
            });
            
            cancelBtn.addEventListener('click', () => {
                editContainer.remove();
            });
            
            // Assemble UI
            buttonsContainer.appendChild(saveBtn);
            buttonsContainer.appendChild(cancelBtn);
            editContainer.appendChild(editor);
            editContainer.appendChild(buttonsContainer);
            
            // Add to the element
            element.style.position = 'relative';
            element.appendChild(editContainer);
            
            // Focus the editor
            editor.focus();
        });
    });
}

// Helper function to apply edit functionality with predefined text
function makeElementEditableWithText(element, fieldType, itemContainer, text) {
    // Create edit UI
    const editContainer = document.createElement('div');
    editContainer.className = 'admin-text-editor';
    editContainer.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.8);
        z-index: 10;
        padding: 10px;
        border-radius: 5px;
        display: flex;
        flex-direction: column;
    `;
    
    // Create editor based on field type
    let editor;
    if (fieldType === 'description') {
        editor = document.createElement('textarea');
        editor.style.height = '80px';
    } else {
        editor = document.createElement('input');
        editor.type = 'text';
    }
    
    editor.value = text || element.textContent.trim();
    editor.style.cssText = `
        width: 100%;
        padding: 5px;
        margin-bottom: 5px;
        background: #333;
        color: white;
        border: 1px solid #673ab7;
        border-radius: 3px;
    `;
    
    // Create buttons container
    const buttonsContainer = document.createElement('div');
    buttonsContainer.style.cssText = `
        display: flex;
        justify-content: space-between;
    `;
    
    // Save button
    const saveBtn = document.createElement('button');
    saveBtn.innerHTML = '<i class="fas fa-check"></i> Save';
    saveBtn.style.cssText = `
        padding: 3px 8px;
        background: #4CAF50;
        color: white;
        border: none;
        border-radius: 3px;
        cursor: pointer;
    `;
    
    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.innerHTML = '<i class="fas fa-times"></i> Cancel';
    cancelBtn.style.cssText = `
        padding: 3px 8px;
        background: #F44336;
        color: white;
        border: none;
        border-radius: 3px;
        cursor: pointer;
        margin-left: 5px;
    `;
    
    // Add event listeners
    saveBtn.addEventListener('click', () => {
        const itemTitle = itemContainer.querySelector('.item-title').textContent;
        saveItemText(itemTitle, fieldType, editor.value, element);
        editContainer.remove();
    });
    
    cancelBtn.addEventListener('click', () => {
        editContainer.remove();
    });
    
    // Assemble UI
    buttonsContainer.appendChild(saveBtn);
    buttonsContainer.appendChild(cancelBtn);
    editContainer.appendChild(editor);
    editContainer.appendChild(buttonsContainer);
    
    // Add to the element
    element.style.position = 'relative';
    element.appendChild(editContainer);
    
    // Focus the editor
    editor.focus();
}

// Save item text changes - add admin check
async function saveItemText(itemTitle, fieldType, newText, element) {
    // Security check - verify user is admin before saving
    if (!auth.currentUser) {
        showTempMessage('❌ You must be logged in to make changes', 'error');
        return;
    }
    
    const isAdmin = await isUserAdmin(auth.currentUser);
    if (!isAdmin) {
        showTempMessage('❌ Admin privileges required to save changes', 'error');
        return;
    }
    
    try {
        // Find the item in the database
        const storeItemsRef = collection(db, "storeItems");
        const q = query(storeItemsRef, where("title", "==", itemTitle));
        const querySnapshot = await getDocs(q);
        
        let itemId;
        
        if (querySnapshot.empty) {
            // Create new item if it doesn't exist
            itemId = itemTitle.toLowerCase().replace(/\s+/g, '');
        } else {
            itemId = querySnapshot.docs[0].id;
        }
        
        // Prepare update data
        const updateData = {};
        
        // Set the correct field based on the field type
        if (fieldType === 'title') {
            // Special handling for title changes
            const oldItemTitle = element.dataset.originalText;
            if (oldItemTitle && oldItemTitle !== newText) {
                // Update the title in the database
                updateData.title = newText;
                
                // Update local cache
                const oldPrice = storeItemPrices[oldItemTitle];
                if (oldPrice) {
                    storeItemPrices[newText] = oldPrice;
                    delete storeItemPrices[oldItemTitle];
                }
            }
        } else if (fieldType === 'description') {
            updateData.description = newText;
        } else if (fieldType.startsWith('feature-')) {
            // Handle feature list items
            const index = parseInt(fieldType.split('-')[1]);
            
            // Get all features
            const itemDocRef = doc(storeItemsRef, itemId);
            const itemDoc = await getDoc(itemDocRef);
            let features = [];
            
            if (itemDoc.exists() && itemDoc.data().features) {
                features = [...itemDoc.data().features];
            }
            
            // Update the specific feature
            while (features.length <= index) {
                features.push('');
            }
            features[index] = newText;
            
            updateData.features = features;
        }
        
        // Update the item in the database
        await setDoc(doc(storeItemsRef, itemId), updateData, { merge: true });
        
        // Update the UI - FIX HERE
        // Remove all child elements first
        while (element.firstChild) {
            element.removeChild(element.firstChild);
        }
        
        // Set the new text content
        element.textContent = newText;
        
        // Recreate the edit indicator
        const editIndicator = document.createElement('span');
        editIndicator.className = 'admin-edit-indicator';
        editIndicator.innerHTML = '<i class="fas fa-pencil-alt"></i>';
        editIndicator.style.cssText = `
            position: absolute;
            top: -8px;
            right: -8px;
            background: #673ab7;
            color: white;
            width: 18px;
            height: 18px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            cursor: pointer;
            opacity: 0.7;
            transition: opacity 0.2s;
        `;
        
        // Add hover effects
        editIndicator.addEventListener('mouseenter', () => {
            editIndicator.style.opacity = '1';
        });
        editIndicator.addEventListener('mouseleave', () => {
            editIndicator.style.opacity = '0.7';
        });
        
        // Add click event to make it editable again
        editIndicator.addEventListener('click', async () => {
            // Re-add the edit functionality
            const stillAdmin = await isUserAdmin(auth.currentUser);
            if (!stillAdmin) {
                showTempMessage('❌ Admin privileges required', 'error');
                return;
            }
            
            makeElementEditableWithText(element, fieldType, itemContainer, newText);
        });
        
        // Update data attribute and append indicator
        element.dataset.originalText = newText;
        element.appendChild(editIndicator);
        
        showTempMessage(`✅ Updated ${fieldType} for ${itemTitle}`, 'success');
    } catch (error) {
        console.error('Error saving item text:', error);
        showTempMessage(`❌ Failed to save text: ${error.message}`, 'error');
    }
}

