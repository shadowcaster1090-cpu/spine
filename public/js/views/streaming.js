import { get, post, del, patch, me } from '../api.js';
import { esc, num, setTitle, toast, when, confirmDialog, modal, poster, dateWords, VIA_NAMES, $ } from '../ui.js';
import { logSheet } from '../forms.js';

const LOGO = { netflix: '#e50914', prime: '#00a8e1', disney: '#113ccf', apple: '#8e8e93', mubi: '#001489', trakt: '#ed1c24' };

export default async function view(ctx) {
  const { el, needLogin, query, go } = ctx;
  if (!me.user) return needLogin();
  setTitle('Streaming services');
  const d = await get('/api/streaming');
  const byId = Object.fromEntries(d.accounts.map((a) => [a.service, a]));
  if (query.get('connected')) toast('Trakt connected. Pulling your history…');
  if (query.get('error')) toast(query.get('error'), true);
  const rerender = () => go('/streaming', { replace: true });

  el.innerHTML = `<div class="wrap narrow">
    <div class="colhead"><div><div class="eyebrow">Log what you stream</div><h1 class="big">Streaming services</h1></div></div>
    <p class="prose" style="margin-bottom:22px">Netflix, Prime Video and the others don’t tell apps what you watch, so Spine takes the viewing-history file they let you download, or a live feed from Trakt. Either way, films land in your diary and Spine asks for a rating the next time you open the app.</p>
    ${d.pending ? `<div class="note-banner info" style="margin-bottom:18px;display:flex;gap:12px;align-items:center;flex-wrap:wrap"><span><b>${d.pending}</b> imported ${d.pending === 1 ? 'film is' : 'films are'} waiting for a rating.</span><button class="btn sm primary" id="rate-now">Rate them now</button></div>` : ''}
    <div class="inset">${d.services.map((s) => serviceRow(s, byId[s.id])).join('')}</div>
    <div class="inset" style="margin-top:14px"><label class="row"><span class="grow"><span class="t">Ask me to rate imported films</span><span class="s">A sheet when you open the app, for anything logged from a service</span></span><span class="switch"><input type="checkbox" id="pr" ${d.prompt_reviews ? 'checked' : ''}><span></span></span></label></div>
    ${d.imports.length ? `<section class="sec"><div class="hd"><h2>Imports</h2></div><div class="inset">${d.imports.map((i) => `<div class="row"><span class="grow"><span class="t">${esc(d.services.find((s) => s.id === i.service)?.name || i.service)}</span><span class="s">${num(i.logged)} logged · ${num(i.skipped)} skipped · ${when(i.created_at)}</span></span></div>`).join('')}</div></section>` : ''}
    <section class="sec"><div class="hd"><h2>Recently logged from services</h2></div><div id="recent" class="rows"></div></section>
    <div style="height:40px"></div></div>`;

  const recent = await get('/api/streaming/recent');
  $('#recent', el).innerHTML = recent.items.length ? recent.items.map((w) => `<div class="wrow"><a href="/film/${w.film.id}">${poster(w.film)}</a><div><a class="t" href="/film/${w.film.id}">${esc(w.film.title)}</a><div class="s"><span>${esc(VIA_NAMES[w.via] || w.via)}</span><span>${dateWords(w.watched_on)}</span>${w.rating ? `<span>${w.rating / 2}★</span>` : '<span class="pill warn">unrated</span>'}</div></div><button class="btn sm" data-edit="${w.id}">${w.rating || w.review ? 'Edit' : 'Rate'}</button></div>`).join('') : '<div class="empty">Nothing imported yet.</div>';

  $('#pr', el).onchange = async (e) => { await patch('/api/me', { prompt_reviews: e.target.checked }); toast(e.target.checked ? 'Spine will ask you to rate imports' : 'Imports go straight to your diary'); };
  $('#rate-now', el)?.addEventListener('click', async () => { const { promptSheet } = await import('../forms.js'); const r = await get('/api/prompts'); if (r.items.length) promptSheet(r.items, rerender); });
  el.onclick = async (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    try {
      if (b.dataset.import) return importSheet(b.dataset.import, d.services.find((s) => s.id === b.dataset.import), rerender);
      if (b.dataset.edit) { const w = recent.items.find((x) => x.id === +b.dataset.edit); return logSheet({ watch: w, onSaved: rerender }); }
      if (b.hasAttribute('data-trakt')) { const r = await get('/api/streaming/trakt/connect'); location.assign(r.url); return; }
      if (b.hasAttribute('data-sync')) { b.disabled = true; const r = await post('/api/streaming/trakt/sync'); toast(r.logged ? `${r.logged} new ${r.logged === 1 ? 'film' : 'films'} logged` : 'Nothing new on Trakt'); return rerender(); }
      if (b.dataset.disconnect && await confirmDialog('Disconnect this service? Your diary entries stay.', 'Disconnect', true)) { await del(`/api/streaming/${b.dataset.disconnect}`); return rerender(); }
    } catch (e) { toast(e.message, true); b.disabled = false; }
  };
}

function serviceRow(s, acc) {
  const color = LOGO[s.id] || '#888';
  let status;
  if (acc) status = acc.last_sync_at ? 'Last import ' + when(acc.last_sync_at) : 'Connected';
  else if (s.kind === 'api') status = s.available ? 'Connect once, then it keeps itself up to date' : 'Not set up on this server';
  else status = s.url ? 'Import the history file' : 'No history download; log by hand';
  let actions;
  if (s.kind === 'api') actions = acc ? '<button class="btn sm" data-sync>Sync now</button><button class="btn sm ghost" data-disconnect="' + esc(s.id) + '">Disconnect</button>' : '<button class="btn sm primary" data-trakt ' + (s.available ? '' : 'disabled') + '>Connect</button>';
  else actions = (s.url ? '<button class="btn sm ' + (acc ? '' : 'primary') + '" data-import="' + esc(s.id) + '">' + (acc ? 'Import again' : 'Import') + '</button>' : '') + (acc ? '<button class="btn sm ghost" data-disconnect="' + esc(s.id) + '" aria-label="Disconnect">×</button>' : '');
  return '<div class="row"><span class="avatar" style="--av-a:' + color + ';--av-b:' + color + ';border-radius:10px;font-size:14px">' + esc(s.name[0]) + '</span>' +
    '<span class="grow"><span class="t">' + esc(s.name) + (s.kind === 'api' ? ' <span class="pill accent">live</span>' : '') + '</span><span class="s">' + esc(status) + '</span></span>' +
    '<span class="btns">' + actions + '</span></div>';
}

function importSheet(service, info, done) {
  let preview = null, order = 'dmy';
  modal(`<h2>Import from ${esc(info.name)}</h2><div id="imp"></div>`, { wide: true, onMount: (d, close) => {
    const box = d.querySelector('#imp');
    const step1 = () => {
      box.innerHTML = `<div class="panel" style="padding:16px 18px;margin-bottom:16px;box-shadow:none;background:var(--surface-2)"><h3 style="margin-bottom:6px">How to get the file</h3><p class="dim" style="margin:0;font-size:14px">${esc(info.how)}</p>${info.url ? `<p style="margin:10px 0 0"><a class="link" href="${esc(info.url)}" target="_blank" rel="noopener">Open ${esc(info.name)} ↗</a></p>` : ''}</div>
        <form class="form"><div class="field"><label for="hf">History file (CSV)</label><input id="hf" type="file" accept=".csv,text/csv,text/plain" required></div>
        <div class="field"><label>Dates in the file are</label><div class="seg"><button type="button" class="on" data-o="dmy">Day / Month / Year</button><button type="button" data-o="mdy">Month / Day / Year</button></div><small>Netflix writes dates in your account’s locale. UK accounts use day first.</small></div>
        <div class="err"></div><div class="btns"><button class="btn primary" type="submit">Check the file</button></div></form>`;
      box.querySelectorAll('[data-o]').forEach((b) => b.onclick = () => { order = b.dataset.o; box.querySelectorAll('[data-o]').forEach((x) => x.classList.toggle('on', x === b)); });
      const form = box.querySelector('form');
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        const f = form.querySelector('#hf').files[0]; if (!f) return;
        const err = form.querySelector('.err'); err.textContent = ''; form.querySelector('[type=submit]').disabled = true;
        try { preview = await post('/api/streaming/import/preview', { service, csv: await f.text(), order }); step2(); }
        catch (e) { err.textContent = e.message; form.querySelector('[type=submit]').disabled = false; }
      };
    };
    const step2 = () => {
      const rows = preview.rows;
      const decided = rows.map((r) => ({ film_id: r.film?.id || null, date: r.date, new_title: null, skip: !!r.duplicate }));
      const paint = () => {
        const n = decided.filter((x) => !x.skip && (x.film_id || x.new_title)).length;
        box.innerHTML = `<p class="dim" style="font-size:14px">Found <b>${rows.length}</b> film viewings${preview.skipped.tv ? `, skipped ${preview.skipped.tv} TV episodes` : ''}${preview.skipped.previews ? ` and ${preview.skipped.previews} previews` : ''}. <b>${preview.summary.matched}</b> matched films on the register${preview.summary.duplicates ? `, ${preview.summary.duplicates} already in your diary` : ''}${preview.summary.unmatched ? `, <b>${preview.summary.unmatched}</b> need a decision` : ''}.</p>
          <div class="tbl" style="max-height:50vh;overflow:auto"><table><thead><tr><th>Title in file</th><th>Date</th><th>Logs as</th><th></th></tr></thead><tbody>${rows.map((r, i) => {
            const dcd = decided[i];
            const status = r.duplicate ? '<span class="pill">already logged</span>' : dcd.film_id ? `<span class="pill ok">${esc((r.film && r.film.id === dcd.film_id ? r.film : r.candidates.find((c) => c.id === dcd.film_id) || r.film)?.title || '')}${r.rewatch ? ' · rewatch' : ''}</span>` : dcd.new_title ? `<span class="pill warn">new film “${esc(dcd.new_title)}”</span>` : r.candidates.length ? `<select data-pick="${i}" style="min-width:180px"><option value="">Choose a match…</option>${r.candidates.map((c) => `<option value="${c.id}">${esc(c.title)} ${c.year || ''}</option>`).join('')}</select>` : '<span class="pill bad">not on the register</span>';
            return `<tr style="${dcd.skip ? 'opacity:.5' : ''}"><td>${esc(r.title)}</td><td class="mono">${r.date || '—'}</td><td>${status}</td><td class="num" style="white-space:nowrap">${!dcd.film_id && !dcd.new_title && !r.duplicate ? `<button class="link" data-new="${i}">Add as new film</button> · ` : ''}<button class="link dim" data-skip="${i}">${dcd.skip ? 'Include' : 'Skip'}</button></td></tr>`;
          }).join('')}</tbody></table></div>
          <div class="btns" style="margin-top:16px"><button class="btn primary" id="commit" ${n ? '' : 'disabled'}>Log ${n} ${n === 1 ? 'film' : 'films'}</button><button class="btn ghost" id="back">Back</button></div>`;
        box.querySelectorAll('[data-pick]').forEach((s) => s.onchange = () => { decided[+s.dataset.pick].film_id = +s.value || null; paint(); });
        box.querySelectorAll('[data-new]').forEach((b) => b.onclick = () => { decided[+b.dataset.new].new_title = rows[+b.dataset.new].title; paint(); });
        box.querySelectorAll('[data-skip]').forEach((b) => b.onclick = () => { decided[+b.dataset.skip].skip = !decided[+b.dataset.skip].skip; paint(); });
        box.querySelector('#back').onclick = step1;
        box.querySelector('#commit').onclick = async () => {
          box.querySelector('#commit').disabled = true;
          try {
            const r = await post('/api/streaming/import/commit', { service, rows: decided.map((x) => ({ ...x, skip: x.skip || (!x.film_id && !x.new_title) })) });
            close(); toast(`${r.logged} ${r.logged === 1 ? 'film' : 'films'} added to your diary`); done();
          } catch (e) { toast(e.message, true); box.querySelector('#commit').disabled = false; }
        };
      };
      paint();
    };
    step1();
  } });
}
