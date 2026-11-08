// Thin JSON client. Errors carry the server's message so views can show it as-is.
export class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }

export async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method, credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new ApiError(0, 'Could not reach Spine. Check your connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status}).`);
  return data;
}
export const get = (u) => api('GET', u);
export const post = (u, b = {}) => api('POST', u, b);
export const patch = (u, b = {}) => api('PATCH', u, b);
export const put = (u, b = {}) => api('PUT', u, b);
export const del = (u, b) => api('DELETE', u, b);

// Signed-in member, unread count, and what they own or want.
export const me = { user: null, unread: 0, pending: 0, prompts: 0, copies: new Set(), wants: new Set(), watched: new Set(), liked: new Set(), watchlist: new Set(), following: new Set() };
export async function loadMe() {
  const r = await get('/api/me');
  me.user = r.user; me.unread = r.unread || 0; me.pending = r.pending || 0; me.prompts = r.prompts || 0;
  const ids = me.user ? await get('/api/me/ids') : {};
  for (const k of ['copies', 'wants', 'watched', 'liked', 'watchlist', 'following']) me[k] = new Set(ids[k] || []);
  return me;
}
export const isMod = () => me.user && (me.user.role === 'mod' || me.user.role === 'admin');
