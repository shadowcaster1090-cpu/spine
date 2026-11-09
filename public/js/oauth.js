import { post } from './api.js';
import { esc, toast } from './ui.js';

// The iPhone shell (SpineApp/1.1+) opens provider sign-in in the system sheet, because Google refuses
// to sign in inside an embedded web view. Older shells and the web just navigate.
const appVersion = () => +(navigator.userAgent.match(/SpineApp\/(\d+(?:\.\d+)?)/)?.[1] || 0);
export const inApp = () => appVersion() > 0;
export const appCanOAuth = () => appVersion() >= 1.1 && !!window.webkit?.messageHandlers?.spine;

export function providerButton(p, verb = 'Continue') {
  return `<button type="button" class="btn block provider ${esc(p.id)}" data-provider="${esc(p.id)}">${mark(p.id)}<span>${verb} with ${esc(p.name)}</span></button>`;
}

// Plain marks, not the companies' logos.
function mark(id) {
  if (id === 'apple') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="3"/><path d="M10 17.5h4"/></svg>';
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c3 3.2 3 13.8 0 17M12 3.5c-3 3.2-3 13.8 0 17"/></svg>';
}

// Starts a sign-in (or, when `link` is set and the user is signed in, links the provider to this account).
export async function startProviderSignIn(provider, { next = '/', link = false } = {}) {
  const q = new URLSearchParams({ next });
  if (inApp()) {
    if (!appCanOAuth()) { toast('Update the Spine app to sign in with ' + provider[0].toUpperCase() + provider.slice(1), true); return; }
    q.set('app', '1');
    if (link) {
      try { const { token } = await post('/api/auth/oauth/link'); q.set('link', token); } catch (e) { toast(e.message, true); return; }
    }
    window.webkit.messageHandlers.spine.postMessage({ type: 'oauth', url: `${location.origin}/api/auth/oauth/${provider}/start?${q}` });
    return;
  }
  location.href = `/api/auth/oauth/${provider}/start?${q}`;
}
