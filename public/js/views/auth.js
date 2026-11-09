import { post, get, me, loadMe } from '../api.js';
import { bindForm, setTitle, field, toast, esc } from '../ui.js';
import { startProviderSignIn, providerButton } from '../oauth.js';

export default async function ({ el, params, query, go, refreshHeader }) {
  const signup = params.mode === 'signup';
  const next = (query.get('next') || '/').startsWith('/') ? query.get('next') || '/' : '/';
  if (me.user) return go(next, { replace: true });
  setTitle(signup ? 'Join' : 'Sign in');
  const error = query.get('error') || '';
  el.innerHTML = `<div class="wrap"><div class="authbox"><div class="eyebrow">${signup ? 'Free for collectors' : 'Welcome back'}</div><h1 class="big">${signup ? 'Join Spine' : 'Sign in'}</h1>
    <div class="providers" id="providers" hidden></div>
    <form class="form" style="margin-top:24px" novalidate>
      ${signup ? field('username', 'Username', { attrs: 'required autocomplete="username" pattern="[A-Za-z0-9_.\\-]{3,24}"', hint: '3 to 24 letters, numbers, dots, dashes or underscores. Shown publicly.' }) + field('email', 'Email', { type: 'email', attrs: 'required autocomplete="email"' })
        : field('login', 'Username or email', { attrs: 'required autocomplete="username"' })}
      ${field('password', 'Password', { type: 'password', attrs: `required autocomplete="${signup ? 'new-password' : 'current-password'}" ${signup ? 'minlength="8"' : ''}`, hint: signup ? 'At least 8 characters' : '' })}
      ${signup ? '<p class="dim" style="font-size:13px;margin:0">By joining you agree to the <a class="link" href="/terms">terms</a> and <a class="link" href="/privacy">privacy policy</a>.</p>' : ''}
      <div class="err">${esc(error)}</div>
      <button class="btn primary" type="submit">${signup ? 'Create account' : 'Sign in'}</button>
      <p class="dim" style="margin:0">${signup ? 'Already a member? <a class="link" href="/login">Sign in</a>' : 'New here? <a class="link" href="/signup">Create an account</a>'}</p>
    </form></div></div>`;
  bindForm(el.querySelector('form'), async (v) => {
    await post(signup ? '/api/auth/signup' : '/api/auth/login', v);
    await loadMe(); refreshHeader();
    toast(signup ? `Welcome, ${me.user.username}` : 'Signed in');
    go(next, { replace: true });
    import('../app.js').then((m) => m.checkPrompts()).catch(() => {});
  });

  // Google / Apple buttons appear only when the server has credentials for them.
  try {
    const { providers } = await get('/api/auth/providers');
    const box = el.querySelector('#providers');
    if (providers.length && box) {
      box.innerHTML = providers.map((p) => providerButton(p, signup ? 'Continue' : 'Sign in')).join('') + '<div class="or"><span>or with a password</span></div>';
      box.hidden = false;
      box.querySelectorAll('[data-provider]').forEach((b) => b.onclick = () => startProviderSignIn(b.dataset.provider, { next }));
    }
  } catch {}
}
