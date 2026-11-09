// Runs before first paint: applies the saved theme so the page never flashes the wrong colours,
// and draws the film grain tile that the stylesheet prints on the page and on every sleeve (--grain).
try {
  var t = localStorage.getItem('spine-theme');
  if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
  // The iPhone shell matches its status bar to the theme.
  if (window.webkit && webkit.messageHandlers && webkit.messageHandlers.spine) webkit.messageHandlers.spine.postMessage({ type: 'theme', value: t === 'light' ? 'light' : 'dark' });
} catch (e) { /* no storage */ }
try {
  var c = document.createElement('canvas'); c.width = c.height = 140;
  var x = c.getContext('2d'), d = x.createImageData(140, 140), p = d.data;
  for (var i = 0; i < p.length; i += 4) { var v = Math.random() * 255; p[i] = p[i + 1] = p[i + 2] = v; p[i + 3] = 255; }
  x.putImageData(d, 0, 0);
  document.documentElement.style.setProperty('--grain', 'url(' + c.toDataURL() + ')');
} catch (e) { /* no canvas */ }
