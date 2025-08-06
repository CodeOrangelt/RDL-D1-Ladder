// Simple theme system for RDL

// Available themes
const THEMES = {
    DEFAULT: 'default',
    PURPLE: 'purple',
    CYBERPUNK: 'cyberpunk',
    EMERALD: 'emerald',
    GOLD: 'gold',
    CONTRAST: 'contrast',
    OCEAN: 'ocean',
    VOLCANIC: 'volcanic',
    COCKPIT: 'cockpit',
};

// Theme storage key
const THEME_STORAGE_KEY = 'rdl_theme';

// Get current theme from storage
function getCurrentTheme() {
    return localStorage.getItem(THEME_STORAGE_KEY) || THEMES.DEFAULT;
}

// Apply theme to document
function applyTheme(theme) {
    // Remove all existing theme classes
    document.body.classList.forEach(cls => {
        if (cls.startsWith('theme-')) {
            document.body.classList.remove(cls);
        }
    });
    
    // Add new theme class
    document.body.classList.add(`theme-${theme}`);
    
    // Store in localStorage
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    
    console.log(`Theme applied: ${theme}`);
    return true;
}

// Switch theme with permissions check
function switchTheme(theme) {
    // Check if theme exists
    if (!Object.values(THEMES).includes(theme)) {
        console.error(`Invalid theme: ${theme}`);
        return false;
    }
    
    // Check ownership if RedeemStore exists
    if (window.RedeemStore && typeof window.RedeemStore.checkOwnership === 'function') {
        if (!window.RedeemStore.checkOwnership(theme)) {
            console.error(`User does not own theme: ${theme}`);
            return false;
        }
    }
    
    // Apply theme
    const success = applyTheme(theme);
    
    // Update UI if RedeemStore exists
    if (success && window.RedeemStore && typeof window.RedeemStore.refreshUI === 'function') {
        window.RedeemStore.refreshUI();
    }
    
    return success;
}

// Initialize theme
function initTheme() {
    const currentTheme = getCurrentTheme();
    applyTheme(currentTheme);
    console.log('Theme system initialized');
}

// Apply initial theme
document.addEventListener('DOMContentLoaded', initTheme);

// Apply theme immediately if document is already loaded
if (document.readyState !== 'loading') {
    initTheme();
}

// Export ThemeSystem globally
window.ThemeSystem = {
    switchTheme,
    getCurrentTheme,
    THEMES
};

console.log('Theme system loaded');