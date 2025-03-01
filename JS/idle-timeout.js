// Configuration
const IDLE_TIMEOUT = 1.5 * 60 * 1000; // 1.5 minutes in milliseconds
let idleTimer = null;
let isSessionSuspended = false;
let networkErrorRetryCount = 0;
const MAX_NETWORK_RETRIES = 3;

// Create overlay elements
function createIdleOverlay() {
    // Check if overlay already exists
    if (document.getElementById('idle-overlay')) return;
    
    const overlay = document.createElement('div');
    overlay.id = 'idle-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.85);
        z-index: 9999;
        display: none;
        justify-content: center;
        align-items: center;
        flex-direction: column;
        backdrop-filter: blur(5px);
    `;
    
    const messageBox = document.createElement('div');
    messageBox.style.cssText = `
        background-color: #202020;
        padding: 30px;
        border-radius: 8px;
        max-width: 500px;
        text-align: center;
        box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
        border: 1px solid #444;
    `;
    
    const message = document.createElement('h2');
    message.textContent = 'Session Suspended Due to Inactivity';
    message.style.cssText = 'color: #50C878; margin-bottom: 20px; font-size: 24px;';
    
    const subMessage = document.createElement('p');
    subMessage.textContent = 'Your session has been suspended after 1.5 minutes of inactivity for security reasons.';
    subMessage.style.cssText = 'color: #fff; margin-bottom: 30px;';
    
    const button = document.createElement('button');
    button.id = 'resume-session-btn';
    button.textContent = 'Return to Website';
    button.style.cssText = `
        padding: 10px 20px;
        background-color: #50C878;
        color: #000;
        border: none;
        border-radius: 4px;
        font-size: 16px;
        cursor: pointer;
        transition: background-color 0.3s;
    `;
    button.onmouseover = function() {
        this.style.backgroundColor = '#3da05f';
    };
    button.onmouseout = function() {
        this.style.backgroundColor = '#50C878';
    };
    
    messageBox.appendChild(message);
    messageBox.appendChild(subMessage);
    messageBox.appendChild(button);
    overlay.appendChild(messageBox);
    document.body.appendChild(overlay);
    
    // Add click event to resume button
    button.addEventListener('click', resumeSession);

    // Create network error overlay
    createNetworkErrorOverlay();
}

// Create network error overlay
function createNetworkErrorOverlay() {
    if (document.getElementById('network-error-overlay')) return;
    
    const overlay = document.createElement('div');
    overlay.id = 'network-error-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.85);
        z-index: 9999;
        display: none;
        justify-content: center;
        align-items: center;
        flex-direction: column;
        backdrop-filter: blur(5px);
    `;
    
    const messageBox = document.createElement('div');
    messageBox.style.cssText = `
        background-color: #202020;
        padding: 30px;
        border-radius: 8px;
        max-width: 500px;
        text-align: center;
        box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
        border: 1px solid #444;
    `;
    
    const message = document.createElement('h2');
    message.textContent = 'Connection Error';
    message.style.cssText = 'color: #ff5555; margin-bottom: 20px; font-size: 24px;';
    
    const subMessage = document.createElement('p');
    subMessage.textContent = 'We\'re having trouble connecting to the server. This may be due to network issues or server maintenance.';
    subMessage.style.cssText = 'color: #fff; margin-bottom: 30px;';
    
    const button = document.createElement('button');
    button.id = 'retry-connection-btn';
    button.textContent = 'Retry Connection';
    button.style.cssText = `
        padding: 10px 20px;
        background-color: #ff5555;
        color: #000;
        border: none;
        border-radius: 4px;
        font-size: 16px;
        cursor: pointer;
        transition: background-color 0.3s;
        margin-right: 10px;
    `;
    
    const reloadButton = document.createElement('button');
    reloadButton.id = 'reload-page-btn';
    reloadButton.textContent = 'Reload Page';
    reloadButton.style.cssText = `
        padding: 10px 20px;
        background-color: #5555ff;
        color: #fff;
        border: none;
        border-radius: 4px;
        font-size: 16px;
        cursor: pointer;
        transition: background-color 0.3s;
    `;
    
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'display: flex; justify-content: center; gap: 10px;';
    buttonContainer.appendChild(button);
    buttonContainer.appendChild(reloadButton);
    
    messageBox.appendChild(message);
    messageBox.appendChild(subMessage);
    messageBox.appendChild(buttonContainer);
    overlay.appendChild(messageBox);
    document.body.appendChild(overlay);
    
    // Add event listeners
    button.addEventListener('click', retryConnection);
    reloadButton.addEventListener('click', () => window.location.reload());
}

// Reset the idle timer
function resetIdleTimer() {
    if (isSessionSuspended) return; // Don't reset if session is suspended
    
    clearTimeout(idleTimer);
    idleTimer = setTimeout(suspendSession, IDLE_TIMEOUT);
}

// Handle network error
function handleNetworkError() {
    clearTimeout(idleTimer);
    
    const overlay = document.getElementById('network-error-overlay');
    if (overlay) {
        overlay.style.display = 'flex';
    }
    
    // Set a flag to indicate network error
    window.RDL_NETWORK_ERROR = true;
    
    console.log('Network error detected, showing error overlay');
}

// Retry connection after network error
function retryConnection() {
    networkErrorRetryCount++;
    
    if (networkErrorRetryCount > MAX_NETWORK_RETRIES) {
        // Too many retry attempts, suggest reloading the page
        const subMessage = document.querySelector('#network-error-overlay p');
        if (subMessage) {
            subMessage.textContent = 'Multiple connection attempts failed. Please reload the page or try again later.';
        }
        
        const retryButton = document.getElementById('retry-connection-btn');
        if (retryButton) {
            retryButton.disabled = true;
            retryButton.style.opacity = '0.5';
            retryButton.style.cursor = 'not-allowed';
        }
        return;
    }
    
    const overlay = document.getElementById('network-error-overlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
    
    // Clear the error flag
    window.RDL_NETWORK_ERROR = false;
    
    // Reset idle timer
    resetIdleTimer();
    
    console.log('Retrying connection...');
    
    // Force a fresh Firebase request to test the connection
    try {
        const { rdlFirestore } = window;
        if (rdlFirestore) {
            // Make a simple query to test connection
            const testRef = rdlFirestore.collection('system');
            rdlFirestore.getDocs(testRef).catch(error => {
                console.error('Connection test failed:', error);
                handleNetworkError();
            });
        }
    } catch (error) {
        console.error('Failed to test connection:', error);
        handleNetworkError();
    }
}

// Suspend the session
function suspendSession() {
    isSessionSuspended = true;
    const overlay = document.getElementById('idle-overlay');
    if (overlay) {
        overlay.style.display = 'flex';
    }
    
    console.log('Session suspended due to inactivity');
    
    // We're not signing out the user, just preventing Firestore operations
    // by setting a flag that our Firestore wrapper will check
    window.RDL_SESSION_SUSPENDED = true;
}

// Resume the session
function resumeSession() {
    isSessionSuspended = false;
    window.RDL_SESSION_SUSPENDED = false;
    
    const overlay = document.getElementById('idle-overlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
    
    console.log('Session resumed');
    resetIdleTimer();
    
    // Force a page reload to ensure clean state if session was suspended for a long time
    if (idleTimer && Date.now() - (window.RDL_LAST_ACTIVITY || 0) > IDLE_TIMEOUT * 2) {
        console.log('Session was idle for too long, reloading page');
        window.location.reload();
    }
}

// Initialize the idle timeout system
function initIdleTimeout() {
    createIdleOverlay();
    
    // Reset timer on user activity
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    events.forEach(event => {
        document.addEventListener(event, () => {
            window.RDL_LAST_ACTIVITY = Date.now();
            resetIdleTimer();
        }, true);
    });
    
    // Global error handler for network-related errors
    window.addEventListener('error', function(event) {
        if (event.error && (
            (event.error.message && event.error.message.includes('network')) ||
            (event.error.code && (
                event.error.code === 'unavailable' || 
                event.error.code === 'resource-exhausted' ||
                event.error.code.includes('network')
            ))
        )) {
            handleNetworkError();
            
            // Prevent default handling for network errors
            event.preventDefault();
        }
    });
    
    // Initial timer start
    resetIdleTimer();
    
    console.log('Idle timeout initialized:', IDLE_TIMEOUT, 'ms');
}

// Export functions
export { initIdleTimeout, isSessionSuspended, handleNetworkError };

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initIdleTimeout);
} else {
    initIdleTimeout();
}