// Check if we're already at the root URL
if (window.location.pathname.includes('/HTML/')) {
  // Replace the URL in browser history without refreshing
  const cleanUrl = window.location.href.replace('/HTML/index.html', '/').replace('/HTML/', '/');
  window.history.replaceState({}, document.title, cleanUrl);
}
