async function loadMetadata() {
    try {
        const response = await fetch('../metadata.html');
        const metadataHTML = await response.text();
        
        // Create a temporary div to parse the HTML
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = metadataHTML;
        
        // Get all meta tags and links from the fetched content
        const metaTags = tempDiv.querySelectorAll('meta, link[rel="canonical"]');
        
        // Get the title if it exists
        const titleElement = tempDiv.querySelector('title');
        
        // Insert meta tags into the head
        metaTags.forEach(tag => {
            // Clone the tag to avoid issues
            const newTag = tag.cloneNode(true);
            document.head.appendChild(newTag);
        });
        
        // Set the title if it exists and current title is empty or default
        if (titleElement && (!document.title || document.title === 'Document')) {
            document.title = titleElement.textContent;
        }
        
        console.log('Metadata loaded successfully');
    } catch (error) {
        console.error('Error loading metadata:', error);
    }
}

// Load metadata when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadMetadata);
} else {
    loadMetadata();
}
