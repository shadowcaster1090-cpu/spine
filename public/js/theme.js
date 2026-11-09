// Applies the saved theme before first paint, so the page never flashes the wrong colours.
try {
  var t = localStorage.getItem('spine-theme');
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  // The iPhone shell matches its status bar to the theme.
  if (window.webkit && webkit.messageHandlers && webkit.messageHandlers.spine) webkit.messageHandlers.spine.postMessage({ type: 'theme', value: t || 'system' });
} catch (e) { /* no storage */ }
