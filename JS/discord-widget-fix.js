/**
 * Discord Widget CORS Fix
 * Handles cross-origin issues with the Discord widget
 */
document.addEventListener('DOMContentLoaded', function() {
    // Reference to the Discord widget and toggle button
    const discordWidget = document.getElementById('discord-widget');
    const toggleButton = document.getElementById('toggle-discord');
    
    // Apply custom styles to improve widget appearance when images fail
    const styleEl = document.createElement('style');
    document.head.appendChild(styleEl);
    
    // Toggle widget visibility when button is clicked
    if (toggleButton && discordWidget) {
        toggleButton.addEventListener('click', function() {
            discordWidget.classList.toggle('collapsed');
        });
    }
    
    // Load Discord widget with improved settings
    function enhanceDiscordWidget() {
        const iframe = discordWidget?.querySelector('iframe');
        
        if (iframe) {
            // Set sandbox attributes to appropriate values
            iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
            
            // Add loading attribute for better performance
            iframe.setAttribute('loading', 'lazy');
            
            // Add title for accessibility
            iframe.setAttribute('title', 'RDL Discord Server');
            
            console.log('Discord widget enhanced for better performance');
        }
    }
    
    // Run enhancement after a short delay to ensure iframe is in the DOM
    setTimeout(enhanceDiscordWidget, 500);
});