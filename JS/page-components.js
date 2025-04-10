/**
 * Combined page components script
 * - Loads navigation and footer
 * - Enhances Discord widget
 */
document.addEventListener('DOMContentLoaded', function() {
    // --- Component Loading ---
    
    // Load navigation
    const navPlaceholder = document.getElementById('nav-placeholder');
    if (navPlaceholder) {
        fetch('../HTML/nav.html')
            .then(response => response.text())
            .then(html => {
                navPlaceholder.innerHTML = html;
            })
            .catch(error => {
                console.error('Error loading navigation:', error);
            });
    }
    
    // Load footer
    const footerPlaceholder = document.getElementById('footer-placeholder');
    if (footerPlaceholder) {
        fetch('../HTML/footer.html')
            .then(response => response.text())
            .then(html => {
                footerPlaceholder.innerHTML = html;
            })
            .catch(error => {
                console.error('Error loading footer:', error);
            });
    }
    
    // --- Discord Widget Enhancement ---
    
    // Get widget elements
    const discordWidget = document.getElementById('discord-widget');
    const toggleButton = document.getElementById('toggle-discord');
    
    // Initialize toggle functionality
    if (toggleButton && discordWidget) {
        toggleButton.addEventListener('click', function() {
            discordWidget.classList.toggle('collapsed');
        });
    }
    
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