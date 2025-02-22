document.addEventListener('DOMContentLoaded', function() {
    // Load placeholders
    $("#nav-placeholder").load("nav.html");
    $("#footer-placeholder").load("footer.html");

    // Get DOM elements
    const collapsible = document.querySelector('.collapsible');
    const content = document.querySelector('.content');
    const regularContent = document.querySelector('.regular-content');
    const ruleButtons = document.querySelectorAll('.rule-button');
    const ruleContents = document.querySelectorAll('.rule-content');

    // Rule button click handler
    ruleButtons.forEach(button => {
        button.addEventListener('click', () => {
            // Remove active class from all buttons and contents
            ruleButtons.forEach(btn => btn.classList.remove('active'));
            ruleContents.forEach(content => content.classList.remove('active'));
            
            // Add active class to clicked button and corresponding content
            button.classList.add('active');
            const contentId = button.getAttribute('data-content');
            document.getElementById(contentId).classList.add('active');
        });
    });

    // Settings toggle handler
    if (collapsible && content) {
        collapsible.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            this.classList.toggle('active');
            content.classList.toggle('active');

            // Toggle regular content visibility
            if (regularContent) {
                if (content.classList.contains('active')) {
                    content.style.position = 'relative';
                    content.style.opacity = '1';
                    content.style.visibility = 'visible';
                    regularContent.style.position = 'absolute';
                    regularContent.style.opacity = '0';
                    regularContent.style.visibility = 'hidden';
                } else {
                    content.style.position = 'absolute';
                    content.style.opacity = '0';
                    content.style.visibility = 'hidden';
                    regularContent.style.position = 'relative';
                    regularContent.style.opacity = '1';
                    regularContent.style.visibility = 'visible';
                }
            }
        });

        // Prevent closing when clicking inside content
        content.addEventListener('click', function(e) {
            e.stopPropagation();
        });
    }
});

// Close settings function
window.closeSettings = function() {
    const content = document.querySelector('.content');
    const collapsible = document.querySelector('.collapsible');
    const regularContent = document.querySelector('.regular-content');
    
    if (collapsible && content && regularContent) {
        collapsible.classList.remove('active');
        content.style.position = 'absolute';
        content.style.opacity = '0';
        content.style.visibility = 'hidden';
        regularContent.style.position = 'relative';
        regularContent.style.opacity = '1';
        regularContent.style.visibility = 'visible';
    }
};