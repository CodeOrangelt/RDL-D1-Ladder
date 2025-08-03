import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
    getFirestore, collection, getDocs, query, where 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { firebaseConfig } from './firebase-config.js';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

class SitemapGenerator {
    constructor() {
        this.baseUrl = 'https://rdl.descentnexus.com';
    }
    
    async generateUserProfileSitemap() {
        try {
            // Get all active players from all ladders
            const [d1Players, d2Players, d3Players] = await Promise.all([
                getDocs(collection(db, 'players')),
                getDocs(collection(db, 'playersD2')),
                getDocs(collection(db, 'playersD3'))
            ]);
            
            // Collect unique usernames
            const uniqueUsers = new Set();
            
            d1Players.forEach(doc => {
                const username = doc.data().username;
                if (username) uniqueUsers.add(username);
            });
            
            d2Players.forEach(doc => {
                const username = doc.data().username;
                if (username) uniqueUsers.add(username);
            });
            
            d3Players.forEach(doc => {
                const username = doc.data().username;
                if (username) uniqueUsers.add(username);
            });
            
            // Generate sitemap entries
            let sitemapEntries = '';
            const currentDate = new Date().toISOString().split('T')[0];
            
            uniqueUsers.forEach(username => {
                const encodedUsername = encodeURIComponent(username);
                
                // Add entries for each ladder the user might be in
                sitemapEntries += `
  <url>
    <loc>${this.baseUrl}/HTML/profile.html?username=${encodedUsername}</loc>
    <lastmod>${currentDate}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>
  <url>
    <loc>${this.baseUrl}/HTML/profile.html?username=${encodedUsername}&amp;ladder=d1</loc>
    <lastmod>${currentDate}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>
  <url>
    <loc>${this.baseUrl}/HTML/profile.html?username=${encodedUsername}&amp;ladder=d2</loc>
    <lastmod>${currentDate}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>
  <url>
    <loc>${this.baseUrl}/HTML/profile.html?username=${encodedUsername}&amp;ladder=d3</loc>
    <lastmod>${currentDate}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`;
            });
            
            const fullSitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${sitemapEntries}
</urlset>`;
            
            return fullSitemap;
            
        } catch (error) {
            console.error('Error generating user profile sitemap:', error);
            return null;
        }
    }
    
    // Method to download the sitemap
    async downloadUserSitemap() {
        const sitemap = await this.generateUserProfileSitemap();
        if (sitemap) {
            const blob = new Blob([sitemap], { type: 'application/xml' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'user-profiles-sitemap.xml';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    }
}

// Usage
const sitemapGen = new SitemapGenerator();

// Add this to your admin panel or run manually
window.generateUserSitemap = () => sitemapGen.downloadUserSitemap();