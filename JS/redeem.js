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

// Initialize Firebase
const auth = getAuth();
const db = getFirestore();

// Theme configuration
const THEMES = {
    default: { price: 0, name: "Classic RDL", description: "Rock texture with a sleek nav and footer" },
    purple: { price: 150, name: "Purple", description: "Can't get enough" },
    cyberpunk: { price: 400, name: "Yellow Orange", description: "This theme makes me happy" },
    emerald: { price: 1000, name: "Emerald", description: "Emerald City!" },
    gold: { price: 800, name: "Gold", description: "Only the best get this one" },
    contrast: { price: 0, name: "Black & White", description: "You can see better!" },
    ocean: { price: 300, name: "Blue", description: "This one is really pretty" },
    volcanic: { price: 500, name: "Red", description: "For the angry type." }
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
                isAdmin: data.isAdmin || false
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
            
            console.log(`User data loaded - Points: ${userData.points}, Inventory: ${userData.inventory.length} items`);
            
        } else {
            // Create new user profile
            await setDoc(userRef, {
                points: 0,
                inventory: [],
                createdAt: serverTimestamp(),
                username: user.displayName || user.email?.split('@')[0] || 'User'
            });
            
            userData = {
                points: 0,
                inventory: [],
                isAdmin: false
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
        if (currentPoints < theme.price) {
            showMessage('Insufficient points', 'error');
            return false;
        }
        
        if (currentInventory.includes(`theme_${themeId}`)) {
            showMessage('You already own this theme', 'info');
            return false;
        }
        
        // Update user profile
        const newPoints = currentPoints - theme.price;
        const newInventory = [...currentInventory, `theme_${themeId}`];
        
        await updateDoc(userRef, {
            points: newPoints,
            inventory: newInventory,
            lastPurchase: serverTimestamp()
        });
        
        // Log transaction
        await addDoc(collection(db, "transactions"), {
            userId: user.uid,
            userEmail: user.email,
            itemId: `theme_${themeId}`,
            itemTitle: `${theme.name} Theme`,
            price: theme.price,
            type: 'purchase',
            category: 'theme',
            timestamp: serverTimestamp()
        });
        
        // Update local data
        userData.points = newPoints;
        userData.inventory = newInventory;
        
        // Update points display
        if (pointsDisplay) {
            pointsDisplay.textContent = userData.points.toLocaleString();
        }
        
        console.log(`✅ Purchased ${theme.name} theme for ${theme.price} points`);
        return true;
        
    } catch (error) {
        console.error('Purchase failed:', error);
        showMessage('Purchase failed. Please try again.', 'error');
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
    },
    checkOwnership: userOwnsTheme,
    applyTheme,
    purchaseTheme
};

console.log('🏪 Redeem store loaded');