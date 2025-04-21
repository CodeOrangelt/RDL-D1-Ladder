// Announcement Lightbox System V2

// Configuration
const ANNOUNCEMENT = {
    id: "beta-release 1.1", // Change this ID when you want to show a new announcement
    title: "Redux Descent League Beta Release 1.1",
    content: `
        <h2>News, Trophies, Comments and more!</h2>
        <p>Beta Release 1.1 - April 21st 2025</p>
        <ul>
            <p>FEATURES ADDED</p> 
                <li>User roles, wanna get involved? Contact me!</li>
                <li>Complete recent matches re-design.</li>
                <li>Match result community comments.</li>
                <li>Event/accomodation trophy case.</li>
                <li>Custom profile pictures.</li>
                <li>News/events Page.</li> <br>
            <p3>KNOWN BUGS</p>
                <li>Username discrepancies, contact me if affected.</li>
                <li>Bad nav loading</li>
                <li>Login button dissapears randomly.</li> 
        </ul>

        <p><span style="color:#ffffff; font-weight: bold;">- Code</span></p>
    `,
    buttonText: "Let me in!"
};

// Create and show lightbox when document is ready
document.addEventListener('DOMContentLoaded', function() {
    if (shouldShowAnnouncement()) {
        createAnnouncementLightbox();
    }
});

// Check if we should show the announcement
function shouldShowAnnouncement() {
    // Check if user has dismissed this specific announcement
    const dismissedAnnouncements = JSON.parse(localStorage.getItem('dismissedAnnouncements') || '{}');
    return !dismissedAnnouncements[ANNOUNCEMENT.id];
}

// Create the lightbox elements
function createAnnouncementLightbox() {
    // Create overlay and container
    const overlay = document.createElement('div');
    overlay.className = 'announcement-overlay';
    
    const lightbox = document.createElement('div');
    lightbox.className = 'announcement-lightbox';
    
    // Update the lightbox.innerHTML to remove the image section
    lightbox.innerHTML = `
        <div class="announcement-header">
            <h2>${ANNOUNCEMENT.title}</h2>
            <button class="announcement-close" aria-label="Close">&times;</button>
        </div>
        <div class="announcement-content">
            <div class="announcement-text">
                ${ANNOUNCEMENT.content}
            </div>
        </div>
        <div class="announcement-footer">
            <label class="announcement-never-show">
                <input type="checkbox" id="never-show-again"> 
                <span>Don't show again</span>
            </label>
            <button class="announcement-button">${ANNOUNCEMENT.buttonText}</button>
        </div>
    `;
    
    // Add elements to DOM
    overlay.appendChild(lightbox);
    document.body.appendChild(overlay);
    
    // Add event listeners
    const closeButton = lightbox.querySelector('.announcement-close');
    const actionButton = lightbox.querySelector('.announcement-button');
    const neverShowCheckbox = lightbox.querySelector('#never-show-again');
    
    // Close functions
    closeButton.addEventListener('click', () => closeAnnouncement(neverShowCheckbox.checked));
    actionButton.addEventListener('click', () => closeAnnouncement(neverShowCheckbox.checked));
    
    // Close when clicking outside (optional - uncomment if wanted)
    // overlay.addEventListener('click', (e) => {
    //     if (e.target === overlay) {
    //         closeAnnouncement(neverShowCheckbox.checked);
    //     }
    // });
    
    // Add CSS
    addAnnouncementStyles();
    
    // Add fade-in animation
    setTimeout(() => {
        overlay.style.opacity = '1';
        lightbox.style.transform = 'translateY(0)';
    }, 10);
}

// Close the lightbox and save preference
function closeAnnouncement(neverShowAgain) {
    const overlay = document.querySelector('.announcement-overlay');
    
    // Add fade-out animation
    overlay.style.opacity = '0';
    document.querySelector('.announcement-lightbox').style.transform = 'translateY(-20px)';
    
    // Remove after animation completes
    setTimeout(() => {
        document.body.removeChild(overlay);
    }, 300);
    
    // Save preference if "never show again" is checked
    if (neverShowAgain) {
        const dismissedAnnouncements = JSON.parse(localStorage.getItem('dismissedAnnouncements') || '{}');
        dismissedAnnouncements[ANNOUNCEMENT.id] = true;
        localStorage.setItem('dismissedAnnouncements', JSON.stringify(dismissedAnnouncements));
    }
}

// Add the required CSS
function addAnnouncementStyles() {
    const styleEl = document.createElement('style');
    styleEl.textContent = `
        .announcement-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 9999;
            opacity: 0;
            transition: opacity 0.3s ease;
        }
        
        .announcement-lightbox {
            background: rgb(0, 0, 0);
            border-radius: 8px;
            max-width: 850px;
            width: 40%;
            padding: 0;
            box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
            transform: translateY(-20px);
            transition: transform 0.3s ease;
            border: 3px solid white;
        }
        
        .announcement-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 20px;
            border-bottom: 1px solid #333;
        }
        
        .announcement-header h2 {
            margin: 0;
            font-size: 1.4rem;
            color:rgb(168, 19, 206); /* Matching site's orange theme */
        }
        
        .announcement-close {
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            color: #888;
            padding: 0;
            line-height: 24px;
            width: 24px;
            height: 24px;
        }
        
        .announcement-close:hover {
            color: #fff;
        }
        
        .announcement-content {
            padding: 20px;
            color: #ccc;
            line-height: 1.5;
        }
        
        .announcement-text {
            overflow-wrap: break-word;
            line-height: 1.5;
        }
        
        .announcement-footer {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 20px;
            border-top: 1px solid #333;
        }
        
        .announcement-never-show {
            color: #ccc;
            font-size: 0.9rem;
            display: flex;
            align-items: center;
            cursor: pointer;
        }
        
        .announcement-never-show input {
            margin-right: 6px;
        }
        
        .announcement-button {
            background:rgb(204, 29, 189);
            border: none;
            color: white;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
        }
        
        .announcement-button:hover {
            background:rgb(204, 29, 189);
        }
        
        @media (max-width: 600px) {
            .announcement-lightbox {
                width: 95%;
            }
        }
    `;
    document.head.appendChild(styleEl);
}