/**
 * Discord Widget Enhancement
 * - Improves appearance even with CORS errors
 * - Handles widget toggle functionality
 */
document.addEventListener('DOMContentLoaded', function() {
    // Get widget elements
    const discordWidget = document.getElementById('discord-widget');
    const toggleButton = document.getElementById('toggle-discord');
    
    // Initialize toggle functionality
    if (toggleButton && discordWidget) {
        toggleButton.addEventListener('click', function() {
            discordWidget.classList.toggle('collapsed');
        });
    }
    
    // Apply better styling that works with CORS limitations
    const styleEl = document.createElement('style');
    styleEl.textContent = `
        /* Improved Discord widget styling */
        #discord-widget {
            background-color: #36393f;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            overflow: hidden;
            transition: all 0.3s ease;
        }
        
        #discord-widget.collapsed {
            max-height: 0;
            opacity: 0;
        }
        
        #discord-widget:not(.collapsed) {
            max-height: 500px;
            opacity: 1;
        }
        
        #discord-widget iframe {
            border: none !important;
            width: 100%;
            height: 500px;
        }
        
        /* Prevent widget from being cut off */
        .discord-container {
            margin-bottom: 30px;
            position: relative;
            z-index: 10;
        }
        
        /* Style toggle button */
        .discord-toggle {
            display: flex;
            align-items: center;
            gap: 8px;
            background-color: #5865F2;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
            transition: background-color 0.2s;
        }
        
        .discord-toggle:hover {
            background-color: #4752c4;
        }
    `;
    document.head.appendChild(styleEl);
    
    // Console error silencer - this won't fix CORS but will reduce console spam
    const originalError = console.error;
    console.error = function() {
        // Ignore CORS errors from Discord widget
        if (arguments[0] && 
            typeof arguments[0] === 'string' && 
            arguments[0].includes('cdn.discordapp.com/widget-avatars')) {
            return;
        }
        originalError.apply(console, arguments);
    };
});