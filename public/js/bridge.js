// Talking to the iPhone shell (SpineApp/1.x). Everything here degrades to "not available" on the web.
const ver = () => +(navigator.userAgent.match(/SpineApp\/(\d+(?:\.\d+)?)/)?.[1] || 0);
const handler = () => window.webkit?.messageHandlers?.spine;
export const inApp = () => ver() > 0 && !!handler();

// Native HTTPS fetch through the shell (SpineApp/1.2+), for the few hosts that refuse browser calls.
// Resolves {status, body}; status 0 means the shell refused or could not reach it.
const pending = new Map();
let seq = 0;
window.__spineFetch = (res) => { const p = pending.get(res?.id); if (!p) return; pending.delete(res.id); clearTimeout(p.timer); p.resolve({ status: +res.status || 0, body: String(res.body || '') }); };
export const canNativeFetch = () => ver() >= 1.2 && !!handler();
export function nativeFetch(url, { timeout = 9000 } = {}) {
  if (!canNativeFetch()) return Promise.reject(new Error('Not running in the Spine app'));
  const id = `f${++seq}-${Date.now()}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { pending.delete(id); resolve({ status: 0, body: '' }); }, timeout);
    pending.set(id, { resolve, timer });
    try { handler().postMessage({ type: 'fetch', id, url }); } catch { clearTimeout(timer); pending.delete(id); resolve({ status: 0, body: '' }); }
  });
}
