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

async function generateProfileMetadata(username, ladder = 'D1') {
    try {
        // Get player data
        const playersCollection = ladder === 'D1' ? 'players' : 
                                 (ladder === 'D2' ? 'playersD2' : 'playersD3');
        const playersRef = collection(db, playersCollection);
        const q = query(playersRef, where('username', '==', username));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            return getDefaultProfileMetadata(username, ladder);
        }
        
        const playerData = querySnapshot.docs[0].data();
        const eloRating = playerData.eloRating || 0;
        
        // Get rank
        let rank = 'Unranked';
        if (eloRating >= 2000) rank = 'Emerald';
        else if (eloRating >= 1800) rank = 'Gold';
        else if (eloRating >= 1600) rank = 'Silver';
        else if (eloRating >= 1400) rank = 'Bronze';
        
        // Generate dynamic metadata
        const title = `${username} - ${rank} Player | ${ladder} Ladder | RDL`;
        const description = `View ${username}'s profile on the Redux Descent League ${ladder} ladder. Current rank: ${rank} (${eloRating} ELO). See match history, stats, and achievements.`;
        const canonicalUrl = `https://rdl.descentnexus.com/HTML/profile.html?username=${encodeURIComponent(username)}&ladder=${ladder.toLowerCase()}`;
        
        return {
            title,
            description,
            canonicalUrl,
            keywords: `${username}, RDL profile, Descent player, ${ladder} ladder, ${rank} rank, gaming profile`,
            ogTitle: title,
            ogDescription: description,
            ogUrl: canonicalUrl,
            twitterTitle: `${username} - ${rank} Player | RDL`,
            twitterDescription: description
        };
        
    } catch (error) {
        console.error('Error generating profile metadata:', error);
        return getDefaultProfileMetadata(username, ladder);
    }
}

function getDefaultProfileMetadata(username, ladder) {
    const title = `${username} - Player Profile | ${ladder} Ladder | RDL`;
    const description = `View ${username}'s profile on the Redux Descent League ${ladder} ladder. See player stats, match history, and achievements.`;
    const canonicalUrl = `https://rdl.descentnexus.com/HTML/profile.html?username=${encodeURIComponent(username)}&ladder=${ladder.toLowerCase()}`;
    
    return {
        title,
        description,
        canonicalUrl,
        keywords: `${username}, RDL profile, Descent player, ${ladder} ladder, gaming profile`,
        ogTitle: title,
        ogDescription: description,
        ogUrl: canonicalUrl,
        twitterTitle: `${username} | RDL`,
        twitterDescription: description
    };
}

// Function to apply metadata to the page
async function applyProfileMetadata() {
    const urlParams = new URLSearchParams(window.location.search);
    const username = urlParams.get('username');
    const ladder = urlParams.get('ladder')?.toUpperCase() || 'D1';
    
    if (username) {
        const metadata = await generateProfileMetadata(username, ladder);
        
        // Update title
        document.title = metadata.title;
        
        // Update or create meta tags
        const metaTags = [
            { name: 'description', content: metadata.description },
            { name: 'keywords', content: metadata.keywords },
            { property: 'og:title', content: metadata.ogTitle },
            { property: 'og:description', content: metadata.ogDescription },
            { property: 'og:url', content: metadata.ogUrl },
            { name: 'twitter:title', content: metadata.twitterTitle },
            { name: 'twitter:description', content: metadata.twitterDescription }
        ];
        
        metaTags.forEach(({ name, property, content }) => {
            const selector = name ? `meta[name="${name}"]` : `meta[property="${property}"]`;
            let metaTag = document.querySelector(selector);
            
            if (!metaTag) {
                metaTag = document.createElement('meta');
                if (name) metaTag.name = name;
                if (property) metaTag.property = property;
                document.head.appendChild(metaTag);
            }
            
            metaTag.content = content;
        });
        
        // Update canonical URL
        let canonicalLink = document.querySelector('link[rel="canonical"]');
        if (!canonicalLink) {
            canonicalLink = document.createElement('link');
            canonicalLink.rel = 'canonical';
            document.head.appendChild(canonicalLink);
        }
        canonicalLink.href = metadata.canonicalUrl;
    }
}

// Load metadata when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadMetadata);
} else {
    loadMetadata();
}

// Auto-apply on profile pages
if (window.location.pathname.includes('profile.html')) {
    document.addEventListener('DOMContentLoaded', applyProfileMetadata);
}
