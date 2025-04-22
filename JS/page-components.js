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
                
                // Hide the Nexus link in navigation after it's loaded
                const nexusNavLinks = document.querySelectorAll('.nav-link[href="nexus.html"], .nav-item a[href="nexus.html"]');
                nexusNavLinks.forEach(link => {
                    if (link.closest('li')) {
                        link.closest('li').style.display = 'none';
                    } else {
                        link.style.display = 'none';
                    }
                });
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

// Function to create and add Nexus footer link
function createNexusFooterLink() {
    // Check if the link already exists
    if (document.querySelector('.nexus-footer-link')) {
        return;
    }
    
    // Create the CSS for the footer link
    const style = document.createElement('style');
    style.textContent = `
        /* Fix horizontal scrolling */
        html, body {
            overflow-x: hidden;
            width: 100%;
            position: relative;
            margin: 0;
            padding: 0;
        }

        /* Nexus footer link styling */
        .nexus-footer-link {
            position: fixed;
            left: 15px;
            bottom: 15px;
            z-index: 100;
        }

        .nexus-footer-link a {
            display: flex;
            align-items: center;
            gap: 5px;
            background: rgba(0, 0, 0, 0.75);
            color: rgba(255, 255, 255, 0.75);
            text-decoration: none;
            padding: 6px 12px;
            font-size: 0.85rem;
            border-radius: 4px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            transition: all 0.2s ease;
        }

        .nexus-footer-link a:hover {
            background: rgba(0, 0, 0, 0.85);
            color: rgba(255, 255, 255, 1);
            transform: translateY(-2px);
            box-shadow: 0 3px 8px rgba(0, 0, 0, 0.2);
        }

        .nexus-footer-link a img {
            width: 16px;
            height: 16px;
            object-fit: contain;
        }
    `;
    document.head.appendChild(style);
    
    // Create the footer link element
    const nexusFooter = document.createElement('div');
    nexusFooter.className = 'nexus-footer-link';
    nexusFooter.innerHTML = `
        <a href="https://codeorangelt.github.io/Descent-Nexus/">
            <img src="../images/cloak.ico" alt="Nexus" width="16" height="16"> Nexus
        </a>
    `;
    document.body.appendChild(nexusFooter);
}