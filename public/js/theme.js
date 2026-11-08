// Applies the saved theme before first paint, so the page never flashes the wrong colours.
try { var t = localStorage.getItem('spine-theme'); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch (e) { /* no storage */ }
