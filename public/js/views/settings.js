import { patch, del, me, loadMe } from '../api.js';
import { esc, bindForm, toast, setTitle, field, area } from '../ui.js';

export default async function ({ el, needLogin, go, refreshHeader }) {
  if (!me.user) return needLogin();
  setTitle('Settings');
  const u = me.user;
  el.innerHTML = `<div class="wrap" style="max-width:760px"><div class="colhead"><div><div class="eyebrow">${esc(u.username)}</div><h1 class="big">Settings</h1></div></div>
    <section class="sec"><div class="hd"><h2>Profile</h2></div><form class="form" id="prof">${area('bio', 'About you', { value: u.bio, attrs: 'rows="3" maxlength="600"', hint: 'Shown on your profile' })}${field('email', 'Email', { type: 'email', value: u.email, attrs: 'required autocomplete="email"' })}
      <label class="check"><input type="checkbox" name="public_collection" value="1" ${u.public_collection ? 'checked' : ''}> Let other people see my collection and wantlist</label><div class="err"></div><div><button class="btn primary" type="submit">Save profile</button></div></form></section>
    <section class="sec"><div class="hd"><h2>Password</h2></div><form class="form" id="pw">${field('current_password', 'Current password', { type: 'password', attrs: 'required autocomplete="current-password"' })}${field('new_password', 'New password', { type: 'password', attrs: 'required minlength="8" autocomplete="new-password"', hint: 'At least 8 characters' })}<div class="err"></div><div><button class="btn primary" type="submit">Change password</button></div></form></section>
    <section class="sec"><div class="hd"><h2>Your data</h2></div><p class="prose">Download everything Spine holds about you, or your collection as a spreadsheet.</p>
      <div class="btns"><a class="btn" href="/api/me/export" download>Download my data (JSON)</a><a class="btn" href="/api/collection/export.csv" download>Download collection (CSV)</a></div></section>
    <section class="sec"><div class="hd"><h2>Delete account</h2></div><p class="prose">This removes your account, collection, wantlist, reviews and lists for good. Editions you added to the register stay, without your name.</p>
      <form class="form" id="delacc" style="max-width:420px">${field('password', 'Password to confirm', { type: 'password', attrs: 'required autocomplete="current-password"' })}<div class="err"></div><div><button class="btn danger" type="submit">Delete my account</button></div></form></section>
    <div style="height:60px"></div></div>`;
  bindForm(el.querySelector('#prof'), async (v) => { await patch('/api/me', { bio: v.bio, email: v.email, public_collection: !!v.public_collection }); await loadMe(); toast('Profile saved'); });
  bindForm(el.querySelector('#pw'), async (v, f) => { await patch('/api/me', v); f.reset(); toast('Password changed'); });
  bindForm(el.querySelector('#delacc'), async (v) => {
    await del('/api/me', { password: v.password });
    await loadMe(); refreshHeader(); toast('Your account has been deleted'); go('/');
  });
}
