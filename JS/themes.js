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
    CHRISTMAS: 'christmas'
};

// Theme storage key
const THEME_STORAGE_KEY = 'rdl_theme';

// Theme expiration dates
const THEME_EXPIRATION = {
    christmas: new Date('2025-12-31T23:59:59')
};

// Check if theme is expired
function isThemeExpired(theme) {
    if (!THEME_EXPIRATION[theme]) {
        return false; // No expiration date = never expires
    }
    
    const now = new Date();
    return now > THEME_EXPIRATION[theme];
}

// Get current theme from storage with expiration check
function getCurrentTheme() {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || THEMES.DEFAULT;
    
    // Check if theme is expired
    if (isThemeExpired(savedTheme)) {
        console.log(`Theme ${savedTheme} has expired, reverting to default`);
        localStorage.setItem(THEME_STORAGE_KEY, THEMES.DEFAULT);
        return THEMES.DEFAULT;
    }
    
    return savedTheme;
}

// Apply theme to document with expiration check
function applyTheme(theme) {
    // Check if theme is expired
    if (isThemeExpired(theme)) {
        console.log(`Cannot apply expired theme: ${theme}`);
        theme = THEMES.DEFAULT;
    }
    
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
    applyTheme,
    getCurrentTheme,
    isThemeExpired, // Add this
    THEMES
};

console.log('Theme system loaded');

// Realistic Snowfall Effect for Christmas Theme

class SnowfallEffect {
    constructor() {
        this.container = null;
        this.snowflakes = [];
        this.isActive = false;
        this.animationFrame = null;
        this.snowflakeChars = ['❄', '❅', '❆', '•', '∗'];
    }

    init() {
        // Only run for Christmas theme
        if (!document.body.classList.contains('theme-christmas')) {
            this.stop();
            return;
        }

        if (this.isActive) return;

        this.createContainer();
        this.isActive = true;
        this.spawnSnowflakes();
        this.animate();
    }

    createContainer() {
        // Remove existing container if present
        const existing = document.getElementById('snowfall-container');
        if (existing) existing.remove();

        this.container = document.createElement('div');
        this.container.id = 'snowfall-container';
        this.container.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 9999;
            overflow: hidden;
        `;
        document.body.appendChild(this.container);
    }

    createSnowflake() {
        const snowflake = document.createElement('div');
        const size = Math.random() * 20 + 10; // 10-30px
        const startX = Math.random() * window.innerWidth;
        const char = this.snowflakeChars[Math.floor(Math.random() * this.snowflakeChars.length)];
        const opacity = Math.random() * 0.6 + 0.2; // 0.2-0.8
        const duration = Math.random() * 5 + 5; // 5-10 seconds fall time

        snowflake.textContent = char;
        snowflake.style.cssText = `
            position: absolute;
            color: rgba(255, 255, 255, ${opacity});
            font-size: ${size}px;
            left: ${startX}px;
            top: -30px;
            text-shadow: 0 0 5px rgba(255, 255, 255, 0.5);
            user-select: none;
        `;

        const snowflakeData = {
            element: snowflake,
            x: startX,
            y: -30,
            size: size,
            speedY: Math.random() * 1.5 + 0.5, // Fall speed
            speedX: Math.random() * 0.5 - 0.25, // Horizontal drift
            wobbleSpeed: Math.random() * 0.02 + 0.01,
            wobbleAmount: Math.random() * 30 + 10,
            rotation: 0,
            rotationSpeed: Math.random() * 2 - 1,
            time: 0
        };

        this.container.appendChild(snowflake);
        this.snowflakes.push(snowflakeData);
    }

    spawnSnowflakes() {
        // Initial burst of snowflakes
        for (let i = 0; i < 30; i++) {
            setTimeout(() => {
                if (this.isActive) this.createSnowflake();
            }, i * 100);
        }

        // Continue spawning at random intervals
        this.spawnInterval = setInterval(() => {
            if (this.isActive && this.snowflakes.length < 80) {
                this.createSnowflake();
            }
        }, Math.random() * 300 + 200); // 200-500ms between spawns
    }

    animate() {
        if (!this.isActive) return;

        this.snowflakes.forEach((flake, index) => {
            flake.time += 0.016; // ~60fps

            // Update position with wobble
            flake.y += flake.speedY;
            flake.x += flake.speedX + Math.sin(flake.time * flake.wobbleSpeed * 100) * 0.3;
            flake.rotation += flake.rotationSpeed;

            // Apply transforms
            flake.element.style.transform = `
                translate(${Math.sin(flake.time * flake.wobbleSpeed * 100) * flake.wobbleAmount}px, 0)
                rotate(${flake.rotation}deg)
            `;
            flake.element.style.top = `${flake.y}px`;
            flake.element.style.left = `${flake.x}px`;

            // Remove if off screen
            if (flake.y > window.innerHeight + 50) {
                flake.element.remove();
                this.snowflakes.splice(index, 1);
            }
        });

        this.animationFrame = requestAnimationFrame(() => this.animate());
    }

    stop() {
        this.isActive = false;
        
        if (this.spawnInterval) {
            clearInterval(this.spawnInterval);
            this.spawnInterval = null;
        }
        
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        if (this.container) {
            this.container.remove();
            this.container = null;
        }

        this.snowflakes = [];
    }
}

// Create global instance
window.Snowfall = new SnowfallEffect();

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    window.Snowfall.init();
});

// Watch for theme changes
const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class') {
            if (document.body.classList.contains('theme-christmas')) {
                window.Snowfall.init();
            } else {
                window.Snowfall.stop();
            }
        }
    });
});

observer.observe(document.body, { attributes: true });

console.log('Snowfall effect loaded');

