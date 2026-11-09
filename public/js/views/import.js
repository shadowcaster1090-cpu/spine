import { post, me, loadMe } from '../api.js';
import { esc, num, setTitle, toast, $ } from '../ui.js';

// Letterboxd export → diary. letterboxd.com → Settings → Data → Export your data gives a zip; upload it here.
export default async function ({ el, needLogin, go, refreshHeader }) {
  if (!me.user) return needLogin();
  setTitle('Import from Letterboxd');
  el.innerHTML = `<div class="wrap narrow">
    <div class="colhead"><div><div class="eyebrow">Bring your history with you</div><h1 class="big">Import from Letterboxd</h1></div></div>
    <div class="panel" style="margin-bottom:18px"><h3>How to get your export</h3><p class="dim" style="margin:6px 0 0;font-size:14px">On letterboxd.com open <b>Settings → Data</b> and press <b>Export your data</b>. You get a small zip file. Upload the whole zip below: Spine reads your diary, ratings, reviews, likes and watchlist from it. Nothing is imported until you confirm.</p>
      <p style="margin:10px 0 0"><a class="link" href="https://letterboxd.com/settings/data/" target="_blank" rel="noopener">Open Letterboxd settings ↗</a></p></div>
    <form class="form panel" id="f" novalidate>
      <div class="field"><label for="zip">Letterboxd export (.zip)</label><input id="zip" type="file" accept=".zip,application/zip,.csv,text/csv" multiple required><small>You can also pick diary.csv, watched.csv, ratings.csv, reviews.csv, watchlist.csv from the unzipped folder.</small></div>
      <div id="plan"></div><div class="err"></div>
      <div class="btns"><button class="btn primary" type="submit">Check the export</button></div></form>
    <p class="dim" style="font-size:13px;margin-top:16px">Letterboxd lists aren’t imported (Spine lists hold DVD editions, not films). Films Spine doesn’t know yet are added with their title and year; you can fill in the rest later.</p>
    <div style="height:40px"></div></div>`;
  const form = $('#f', el), plan = $('#plan', el), err = form.querySelector('.err'), btn = form.querySelector('[type=submit]');
  let payload = null, checked = false;
  form.querySelector('#zip').onchange = () => { checked = false; payload = null; plan.innerHTML = ''; btn.textContent = 'Check the export'; };
  form.onsubmit = async (ev) => {
    ev.preventDefault(); err.textContent = '';
    const files = [...form.querySelector('#zip').files];
    if (!files.length) { err.textContent = 'Choose the export zip first.'; return; }
    btn.disabled = true;
    try {
      if (!payload) {
        const zipFile = files.find((f) => /\.zip$/i.test(f.name));
        if (zipFile) {
          const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(zipFile); });
          payload = { zip: b64 };
        } else {
          const map = {};
          for (const f of files) map[f.name.toLowerCase().includes('films') ? 'likes/films.csv' : f.name.toLowerCase()] = await f.text();
          payload = { files: map };
        }
      }
      if (!checked) {
        const p = await post('/api/import/letterboxd', { ...payload, dry_run: true });
        plan.innerHTML = `<div class="tiles" style="grid-template-columns:repeat(3,1fr)"><div><div class="n">${num(p.watches)}</div><div class="l">Diary entries</div></div><div><div class="n">${num(p.reviews)}</div><div class="l">Reviews</div></div><div><div class="n">${num(p.films)}</div><div class="l">Films</div></div></div>
          <p class="dim" style="font-size:14px">${num(p.matched)} films are already on the register; ${num(p.created)} will be added with title and year${p.sample.length ? ` (e.g. ${p.sample.slice(0, 4).map(esc).join(', ')})` : ''}. Also ${num(p.likes)} likes and ${num(p.watchlist)} watchlist films.</p>`;
        checked = true; btn.textContent = `Import ${num(p.watches)} diary entries`;
        if (!p.watches && !p.watchlist && !p.likes) { btn.textContent = 'Nothing to import'; }
      } else {
        const p = await post('/api/import/letterboxd', payload);
        await loadMe(); refreshHeader();
        toast(`Imported ${num(p.watches)} diary entries`); go('/diary');
      }
    } catch (e) { err.textContent = e.message; }
    finally { btn.disabled = false; }
  };
}
