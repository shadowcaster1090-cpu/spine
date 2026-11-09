// Talking to the iPhone shell (SpineApp/1.x). Everything here degrades to "not available" on the web,
// and the module loads under Node too (the lookup tests import it), where there is no window at all.
const ua = () => (typeof navigator !== 'undefined' && navigator.userAgent) || '';
export const appVersion = () => ua().match(/SpineApp\/(\d+(?:\.\d+)?)/)?.[1] || '';
const ver = () => +appVersion() || 0;
const handler = () => globalThis.webkit?.messageHandlers?.spine;
export const hasBridge = () => !!handler();
export const inApp = () => ver() > 0 && hasBridge();

// Native HTTPS fetch through the shell (SpineApp/1.2+), for the few hosts that refuse browser calls.
// Resolves {status, body, error, ms}. status 0 means no answer came back, and `error` says why:
// 'timeout' (the shell never replied), 'refused' (this build of the shell does not allow that host),
// 'bridge' (the message handler is missing), or the shell's own network error text (SpineApp/1.3+).
const pending = new Map();
let seq = 0;
const now = () => (globalThis.performance?.now ? performance.now() : Date.now());
globalThis.__spineFetch = (res) => {
  const p = pending.get(res?.id); if (!p) return;
  pending.delete(res.id); clearTimeout(p.timer);
  p.resolve({ status: +res.status || 0, body: String(res.body || ''), error: res.refused ? 'refused' : String(res.error || ''), ms: Math.round(now() - p.t0) });
};
export const canNativeFetch = () => ver() >= 1.2 && hasBridge();
export function nativeFetch(url, { timeout = 9000 } = {}) {
  const t0 = now();
  if (!canNativeFetch()) return Promise.resolve({ status: 0, body: '', error: 'bridge', ms: 0 });
  const id = `f${++seq}-${Date.now()}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { pending.delete(id); resolve({ status: 0, body: '', error: 'timeout', ms: Math.round(now() - t0) }); }, timeout);
    pending.set(id, { resolve, timer, t0 });
    try { handler().postMessage({ type: 'fetch', id, url }); } catch { clearTimeout(timer); pending.delete(id); resolve({ status: 0, body: '', error: 'bridge', ms: Math.round(now() - t0) }); }
  });
}
