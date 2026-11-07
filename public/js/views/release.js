import { get, post, put, del, me, isMod } from '../api.js';
import { esc, num, cover, directors, regTag, regionText, stars, condTag, money, pad, when, modal, confirmDialog, toast, setTitle, shrinkImage, bindForm, $ } from '../ui.js';
import { copyModal } from '../forms.js';

const palRt = (rt) => Math.round(rt * 24 / 25);

export default async function view(ctx) {
  const { el, params, go, needLogin } = ctx;
  const d = await get(`/api/editions/${params.id}`);
  if (d.redirect) return go(`/release/${d.redirect}`, { replace: true });
  const { edition: e, film: f, label, stats, mine } = d;
  const card = { ...e, title: f.title, year: f.year, palette: f.palette, directors: f.directors, label: label?.name };
  setTitle(`${f.title} (${label?.name || 'DVD'})`);
  const rerender = () => view(ctx);
  const wide = f.aspect && parseFloat(f.aspect) >= 1.5;

  const notes = [];
  if (e.oop) notes.push('Out of print. Expect to pay more for a sealed copy.');
  if (e.standard === 'PAL' && f.runtime) notes.push(`PAL speed-up: runs about ${palRt(f.runtime)} min rather than ${f.runtime}, with the soundtrack pitched about 4% high unless corrected.`);
  if (wide && e.anamorphic === false) notes.push('Non-anamorphic transfer, letterboxed inside a 4:3 frame. It looks soft when zoomed on a 16:9 screen.');
  if (f.aspect && !wide) notes.push('Academy-ratio film, correctly shown 4:3 with pillarboxing on widescreen sets.');
  const best = [...d.siblings].sort((a, b) => b.extras_count - a.extras_count)[0];
  if (best && best.id !== e.id && best.extras_count > e.extras.length) notes.push(`The <a href="/release/${best.id}" class="link">${esc(best.label || '')} ${esc(best.cat_no)}</a> edition lists ${best.extras_count - e.extras.length} more supplements.`);
  if (e.discs > 1) notes.push(`${e.discs}-disc set.`);
  if (d.pending) notes.push(`${d.pending} suggested edit${d.pending > 1 ? 's are' : ' is'} waiting for review.`);

  const spec = (k, v, small = '') => `<div><div class="k">${k}</div><div class="v${v ? '' : ' unknown'}">${v || 'Not recorded'}${small ? `<small>${small}</small>` : ''}</div></div>`;
  const regionV = !e.region ? '' : e.region === '0' ? 'Region-free' : (e.region.includes(',') ? 'Regions ' : 'Region ') + regionText(e.region).replace(/\//g, ', ');
  const aspectSmall = e.anamorphic === true ? 'Anamorphic 16:9' : e.anamorphic === false ? (wide ? 'Letterboxed 4:3' : '4:3') : '';
  const runtimeV = f.runtime ? (e.standard === 'PAL' ? `${palRt(f.runtime)} min` : `${f.runtime} min`) : '';

  el.innerHTML = `<div class="wrap">
  <div class="crumb mono"><a href="/browse">Browse</a> / ${label ? `<a href="/label/${label.id}">${esc(label.name)}</a> / ` : ''}<a href="/film/${f.id}">${esc(f.title)}</a> / <span style="color:var(--paper)">${esc(e.cat_no || '#' + e.id)}</span></div>
  <div class="rel">
    <aside>
      ${cover(card)}
      <div class="btns">
        <button class="btn${mine?.copies.length ? ' on' : ''}" style="flex:1" data-act="add">${mine?.copies.length ? `✓ In your shelf${mine.copies.length > 1 ? ' ×' + mine.copies.length : ''}` : '+ Add to shelf'}</button>
        <button class="btn${mine?.want ? ' on' : ''}" style="flex:1" data-act="want" ${mine?.copies.length ? 'disabled title="You own this"' : ''}>${mine?.want ? '♥ Wanted' : '♡ Want'}</button>
      </div>
      ${mine?.copies.length ? `<div class="box"><h3>Your copies</h3>${mine.copies.map((c) => `<div class="mycopy"><span>${condTag(c.disc_cond) || '<span class="dim">Ungraded</span>'} ${condTag(c.case_cond)} <span class="dim">${esc(c.acquired)}${c.price != null ? ' · ' + money(c.price) : ''}</span></span><span class="btns"><button class="link" data-edit-copy="${c.id}">Edit</button><button class="link" data-del-copy="${c.id}">Remove</button></span></div>`).join('')}<button class="link" data-act="add" style="margin-top:8px">Add another copy</button></div>` : ''}
      <div class="box"><h3>Community</h3><dl class="kv">
        <dt>Have</dt><dd>${num(stats.have)}</dd><dt>Want</dt><dd>${num(stats.want)}</dd>
        <dt>Rating</dt><dd>${stats.rating ? `<span class="stars">${stars(stats.rating)}</span> ${stats.rating}` : '—'}</dd><dt>Reviews</dt><dd>${stats.votes}</dd></dl></div>
      <div class="box"><h3>The record</h3><div style="display:flex;flex-direction:column;gap:8px;align-items:flex-start">
        <a class="link" href="/release/${e.id}/edit">Suggest an edit</a>
        <button class="link" data-act="upload">Upload a photo of the case</button>
        <button class="link" data-act="list">Add to a list</button>
        <a class="link" href="/release/${e.id}/history">History (${d.revisions})</a>
        ${isMod() ? '<button class="link" data-act="merge">Merge as duplicate…</button>' : ''}
      </div></div>
    </aside>
    <div>
      <div class="eyebrow">${label ? `<a href="/label/${label.id}">${esc(label.name)}</a>` : 'Unknown label'}${label?.country ? ' · ' + esc(label.country) : ''}${e.spine_no != null ? ' · No. ' + pad(e.spine_no) : ''} ${e.oop ? '&nbsp;<span class="oop">OUT OF PRINT</span>' : ''}</div>
      <h1>${esc(f.title)}</h1>
      <div class="by">${directors(f.directors)}${f.country || f.year ? ' &nbsp;·&nbsp; ' : ''}${esc(f.country)}${f.year ? ', ' + f.year : ''}${f.language ? ' &nbsp;·&nbsp; ' + esc(f.language) : ''}</div>
      ${f.original_title ? `<div class="dim" style="margin-top:6px">${esc(f.original_title)}</div>` : ''}
      ${f.synopsis ? `<p class="prose" style="margin-top:16px">${esc(f.synopsis)}</p>` : ''}

      <section class="sec"><div class="hd"><h2>Disc specification</h2><span class="end">${regTag(e)}</span></div>
        <div class="specs">
          ${spec('Region', regionV)}
          ${spec('Standard', e.standard, e.standard === 'PAL' ? '576i · 25 fps' : e.standard === 'NTSC' ? '480i · 29.97 fps' : '')}
          ${spec('Aspect ratio', f.aspect, aspectSmall)}
          ${spec('Runtime', runtimeV, f.runtime && e.standard === 'PAL' ? `${f.runtime} min at film speed` : '')}
          ${spec('Audio', esc(e.audio))}
          ${spec('Subtitles', esc(e.subtitles))}
          ${spec('Discs', e.discs ? `${e.discs}${e.disc_type ? ' × ' + e.disc_type : ''}` : '')}
          ${spec('Packaging', esc(e.packaging))}
          ${spec('Released', e.release_year)}
          ${spec('Catalogue no.', esc(e.cat_no))}
          ${spec('Barcode', e.barcode ? `<span class="mono" style="font-size:14px">${esc(e.barcode)}</span>` : '')}
        </div></section>

      ${notes.length ? `<section class="sec"><div class="hd"><h2>Collector’s notes</h2></div><ul class="notes">${notes.map((n) => `<li><span>${n}</span></li>`).join('')}</ul></section>` : ''}
      ${e.notes ? `<section class="sec"><div class="hd"><h2>About this edition</h2></div><p class="prose" style="white-space:pre-wrap">${esc(e.notes)}</p></section>` : ''}

      <section class="sec"><div class="hd"><h2>Supplements</h2><span class="end eyebrow">${e.extras.length} listed</span></div>
        ${e.extras.length ? `<ul class="extras">${e.extras.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="dim">No supplements recorded. <a class="link" href="/release/' + e.id + '/edit">Add them</a> if you have the disc.</p>'}</section>

      <section class="sec"><div class="hd"><h2>Photos</h2><button class="end btn sm" data-act="upload">Upload</button></div>
        ${d.images.length ? `<div class="gallery">${d.images.map((i) => `<figure><img src="/uploads/${esc(i.file)}" alt="${esc(i.kind)} of ${esc(f.title)}" data-zoom="${esc(i.file)}" loading="lazy"><figcaption><span>${esc(i.kind)}${i.id === e.cover_image_id ? ' · cover' : ''}</span>${i.username ? `<span>by ${esc(i.username)}</span>` : ''}
          ${isMod() && i.id !== e.cover_image_id ? `<button class="link" data-cover="${i.id}">Make cover</button>` : ''}${me.user && (isMod() || i.username === me.user.username) ? `<button class="link" data-del-img="${i.id}">Remove</button>` : ''}</figcaption></figure>`).join('')}</div>`
          : '<p class="dim">No scans yet. Covers above are generated until someone uploads a photo of the real case.</p>'}</section>

      <section class="sec"><div class="hd"><h2>All editions of this film</h2><a class="end mono dim" href="/film/${f.id}">${d.siblings.length} on the register →</a></div>
        <div class="tbl"><table><thead><tr><th>Edition</th><th>Region</th><th>Year</th><th>16:9</th><th class="num">Discs</th><th class="num">Extras</th><th class="num">Have</th></tr></thead><tbody>
        ${d.siblings.map((s) => `<tr class="click${s.id === e.id ? ' cur' : ''}" data-go="/release/${s.id}" tabindex="0"><td><div class="cellt"><div class="thumb">${cover({ ...s })}</div><div><b>${esc(s.label || 'Unknown label')}</b><span>${esc(s.cat_no)}${s.packaging ? ' · ' + esc(s.packaging) : ''}${s.oop ? ' · <span class="oop">OOP</span>' : ''}</span></div></div></td><td>${regTag(s)}</td><td class="mono">${s.release_year ?? '—'}</td><td>${!wide ? '<span class="no">n/a</span>' : s.anamorphic === 1 ? '<span class="yes">Yes</span>' : s.anamorphic === 0 ? '<span class="no">No</span>' : '<span class="no">?</span>'}</td><td class="num">${s.discs}</td><td class="num">${s.extras_count}${best && s.id === best.id && d.siblings.length > 1 && s.extras_count ? ' ★' : ''}</td><td class="num">${s.have}</td></tr>`).join('')}
        </tbody></table></div>
        <p style="margin-top:12px"><a class="link" href="/add?film=${f.id}">Add another edition of this film</a></p></section>

      <section class="sec"><div class="hd"><h2>Reviews</h2><span class="end eyebrow">${d.reviews.length}</span></div>
        <div id="myreview"></div>
        ${d.reviews.filter((r) => !me.user || r.username !== me.user.username).map((r) => `<div class="review"><div class="who"><span class="stars">${stars(r.rating)}</span><a href="/u/${esc(r.username)}"><b>${esc(r.username)}</b></a><span class="mono dim">${when(r.updated_at)}</span></div>${r.body ? `<p>${esc(r.body)}</p>` : ''}</div>`).join('') || (me.user ? '' : '<p class="dim">No reviews yet.</p>')}
      </section>

      ${d.lists.length ? `<section class="sec"><div class="hd"><h2>In lists</h2></div><div class="labelgrid">${d.lists.map((l) => `<a href="/list/${l.id}"><b>${esc(l.title)}</b><span class="mono dim">${esc(l.username)}</span></a>`).join('')}</div></section>` : ''}
    </div>
  </div></div>`;

  // My review
  const mr = $('#myreview', el);
  if (me.user) {
    let rating = mine.review?.rating || 0;
    mr.innerHTML = `<form class="review form" id="rv"><div class="who"><b>Your review</b>${mine.review ? '<button type="button" class="link" data-del-review>Delete</button>' : ''}</div>
      <div class="ratepick" role="radiogroup" aria-label="Rating">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-r="${n}" aria-label="${n} star${n > 1 ? 's' : ''}" class="${n <= rating ? 'on' : ''}">★</button>`).join('')}</div>
      <textarea name="body" rows="3" placeholder="Transfer, extras, packaging: what should other collectors know?">${esc(mine.review?.body || '')}</textarea>
      <div class="err"></div><div><button class="btn sm primary" type="submit">${mine.review ? 'Update review' : 'Post review'}</button></div></form>`;
    mr.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => { rating = +b.dataset.r; mr.querySelectorAll('[data-r]').forEach((x) => x.classList.toggle('on', +x.dataset.r <= rating)); });
    bindForm($('#rv', mr), async (v) => {
      if (!rating) throw new Error('Pick a rating from 1 to 5 stars.');
      await put(`/api/editions/${e.id}/review`, { rating, body: v.body });
      toast('Review saved'); rerender();
    });
    mr.querySelector('[data-del-review]')?.addEventListener('click', async () => { await del(`/api/editions/${e.id}/review`); toast('Review deleted'); rerender(); });
  }

  el.onclick = async (ev) => {
    const t = ev.target.closest('button, tr[data-go], img[data-zoom]');
    if (!t) return;
    if (t.dataset.go) return go(t.dataset.go);
    if (t.dataset.zoom) return modal(`<img class="full" src="/uploads/${esc(t.dataset.zoom)}" alt="">`, { wide: true });
    const act = t.dataset.act;
    if ((act || t.dataset.editCopy || t.dataset.delCopy || t.dataset.cover || t.dataset.delImg) && !me.user) return needLogin();
    try {
      if (act === 'add') copyModal(card, null, rerender);
      if (t.dataset.editCopy) copyModal(card, mine.copies.find((c) => c.id === +t.dataset.editCopy), rerender);
      if (t.dataset.delCopy && await confirmDialog('Remove this copy from your shelf?', 'Remove', true)) {
        await del(`/api/copies/${t.dataset.delCopy}`);
        if (mine.copies.length === 1) me.copies.delete(e.id);
        toast('Removed from your shelf'); rerender();
      }
      if (act === 'want') {
        if (mine.want) { await del(`/api/wants/${e.id}`); me.wants.delete(e.id); toast('Removed from wantlist'); }
        else { await post('/api/wants', { edition_id: e.id }); me.wants.add(e.id); toast('Added to wantlist'); }
        rerender();
      }
      if (act === 'upload') uploadModal(e.id, rerender);
      if (act === 'list') listModal(e.id, mine.lists, rerender);
      if (act === 'merge') mergeModal(e, f, go);
      if (t.dataset.cover) { await post(`/api/images/${t.dataset.cover}/cover`); toast('Cover updated'); rerender(); }
      if (t.dataset.delImg && await confirmDialog('Remove this photo?', 'Remove', true)) { await del(`/api/images/${t.dataset.delImg}`); toast('Photo removed'); rerender(); }
    } catch (err) { toast(err.message, true); }
  };
  el.onkeydown = (ev) => { const tr = ev.target.closest('tr[data-go]'); if (tr && ev.key === 'Enter') go(tr.dataset.go); };
}

function uploadModal(id, done) {
  modal(`<h2>Upload a photo</h2><form class="form"><div class="field"><label for="f-file">Photo or scan</label><input id="f-file" name="file" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" required><small>Your own photo of the case or disc. JPEG, PNG or WebP. Large images are resized before upload.</small></div>
    <div class="field"><label for="f-kind">What it shows</label><select id="f-kind" name="kind"><option value="front">Front of case</option><option value="back">Back of case</option><option value="spine">Spine</option><option value="disc">Disc</option><option value="other">Other (booklet, insert)</option></select></div>
    <div class="err"></div><div class="btns"><button class="btn primary" type="submit">Upload</button></div></form>`, {
    onMount: (d, close) => bindForm(d.querySelector('form'), async (_, form) => {
      const file = form.file.files[0];
      if (!file) throw new Error('Choose an image first.');
      const img = await shrinkImage(file);
      await post(`/api/editions/${id}/images`, { ...img, kind: form.kind.value });
      close(); toast('Photo added'); done();
    })
  });
}

function listModal(id, lists, done) {
  modal(`<h2>Add to a list</h2>
    ${lists.length ? `<div class="pick">${lists.map((l) => `<label class="check" style="padding:10px 4px;border-bottom:1px solid var(--line)"><input type="checkbox" data-list="${l.id}" ${l.has ? 'checked' : ''}> ${esc(l.title)}</label>`).join('')}</div>` : '<p class="dim">You have no lists yet.</p>'}
    <form class="form" style="margin-top:18px"><div class="field"><label for="f-nl">New list</label><input id="f-nl" name="title" placeholder="e.g. Best Region 2 Tarkovsky"></div><div class="err"></div><div class="btns"><button class="btn primary" type="submit">Create and add</button></div></form>`, {
    onMount: (d, close) => {
      d.querySelectorAll('[data-list]').forEach((c) => c.onchange = async () => {
        try {
          if (c.checked) await post(`/api/lists/${c.dataset.list}/items`, { edition_id: id }); else await del(`/api/lists/${c.dataset.list}/items/${id}`);
          toast(c.checked ? 'Added to list' : 'Removed from list');
        } catch (err) { toast(err.message, true); c.checked = !c.checked; }
      });
      bindForm(d.querySelector('form'), async (v) => {
        const r = await post('/api/lists', { title: v.title, edition_id: id });
        close(); toast('List created'); done(); void r;
      });
    },
    onClose: done
  });
}

function mergeModal(e, f, go) {
  modal(`<h2>Merge duplicate</h2><p class="dim">Merging moves every copy, want, review, list entry and photo from this edition (#${e.id}) to the one you choose, then retires this page. It cannot be undone.</p>
    <form class="form"><div class="field"><label for="f-into">Keep this edition instead (id)</label><input id="f-into" name="into" type="number" inputmode="numeric" required></div><div id="mprev" class="dim"></div><div class="err"></div>
    <div class="btns"><button class="btn danger" type="submit">Merge into it</button></div></form>`, {
    onMount: (d, close) => {
      const inp = d.querySelector('#f-into'), prev = d.querySelector('#mprev');
      inp.oninput = async () => {
        prev.textContent = '';
        if (!inp.value) return;
        try { const r = await get(`/api/editions/${inp.value}`); prev.textContent = r.edition ? `→ ${r.film.title} · ${r.label?.name || ''} ${r.edition.cat_no} · Region ${r.edition.region}` : ''; } catch { prev.textContent = 'No edition with that id.'; }
      };
      bindForm(d.querySelector('form'), async (v) => {
        await post(`/api/editions/${e.id}/merge`, { into: +v.into });
        close(); toast('Merged'); go(`/release/${v.into}`);
      });
    }
  });
  void f;
}
