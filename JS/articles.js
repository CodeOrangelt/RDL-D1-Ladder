// filepath: c:\Descent Nexus Repo\RDL-D1-Ladder\JS\articles.js
import { db } from './firebase-config.js';
import { collection, getDocs, query, orderBy, Timestamp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

// Basic HTML escaping (Keep this)
function escapeHtml(unsafe) {
    if (!unsafe) return ''; // Return empty string if input is null/undefined
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

// Basic URL sanitization (Keep this)
function sanitizeUrl(url) {
    if (!url) return ''; // Return empty string if input is null/undefined
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.startsWith('http://') || lowerUrl.startsWith('https://')) {
        // Basic check, could be improved (e.g., check for valid characters)
        return url;
    }
    console.warn('Blocked potentially unsafe URL:', url);
    return ''; // Block non-http(s) URLs
}

// Basic HTML sanitization (Replace your existing one with this OR remove its usage)
// WARNING: This is VERY basic and likely INSECURE. Use DOMPurify for production.
function sanitizeHtml(dirtyHtml) {
    if (!dirtyHtml) return ''; // Return empty string if input is null/undefined

    // Option 2: Simpler & Safer (for now) - Escape ALL HTML from content
    // This prevents rendering any HTML tags entered by the user in the content field.
    // If you *want* users to use basic HTML, you NEED a proper sanitizer library.
    return escapeHtml(dirtyHtml);
}

async function loadArticles() {
    const articlesContainer = document.getElementById('articles-container'); // Ensure this ID exists in articles.html
    if (!articlesContainer) {
        console.error('Articles container not found!');
        return;
    }

    articlesContainer.innerHTML = '<p class="loading-message">Loading news...</p>';

    try {
        const articlesRef = collection(db, 'articles');
        const q = query(articlesRef, orderBy('createdAt', 'desc')); // Order by newest first
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            articlesContainer.innerHTML = '<p class="empty-message">No news articles found.</p>';
            return;
        }

        articlesContainer.innerHTML = ''; // Clear loading message

        snapshot.forEach(doc => {
            const article = doc.data();
            const articleId = doc.id;
            const createdAt = article.createdAt?.toDate ? article.createdAt.toDate().toLocaleDateString() : 'Date unknown';
            const author = article.author || 'Anonymous';

            const articleCard = document.createElement('div');
            articleCard.className = 'article-card';
            articleCard.dataset.id = articleId;

            let headerHtml = '';
            if (article.imageUrl) {
                // Use sanitizeUrl for the image source
                const safeImageUrl = sanitizeUrl(article.imageUrl);
                if (safeImageUrl) {
                     headerHtml = `
                        <div class="article-header">
                            <img src="${safeImageUrl}" alt="${escapeHtml(article.title)} Header">
                        </div>`;
                }
            }

            // *** Use sanitizeHtml for the content ***
            const safeContent = sanitizeHtml(article.content);

            articleCard.innerHTML = `
                ${headerHtml}
                <div class="article-body">
                    <h2>${escapeHtml(article.title)}</h2>
                    <div class="article-meta">
                        <span>By ${escapeHtml(author)}</span> | <span>${createdAt}</span>
                    </div>
                    <div class="article-content">
                        ${safeContent} 
                    </div>
                </div>
            `;
            // Note: If using Option 2 (escapeHtml) for sanitizeHtml, the content will show HTML tags as plain text.
            // If using Option 3 (no sanitization), ensure your CSS doesn't hide the content.

            articlesContainer.appendChild(articleCard);
        });

    } catch (error) {
        console.error("Error loading articles:", error);
        articlesContainer.innerHTML = '<p class="error-message">Failed to load articles. Please try again later.</p>';
    }
}

// Load articles when the page is ready
document.addEventListener('DOMContentLoaded', loadArticles);