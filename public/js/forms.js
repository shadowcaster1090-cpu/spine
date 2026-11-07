// Forms shared by several views: a copy on your shelf, an edition, a film.
import { post, patch, get, me } from './api.js';
import { esc, modal, bindForm, field, area, select, toast, CONDITIONS } from './ui.js';

export function copyModal(edition, copy, onSaved) {
  const c = copy || {};
  modal(`<h2>${copy ? 'Edit your copy' : 'Add to your shelf'}</h2>
    <p class="dim" style="margin-top:-8px">${esc(edition.title)} · ${esc(edition.label || '')} ${esc(edition.cat_no || '')}</p>
    <form class="form cols" novalidate>
      ${select('disc_cond', 'Disc condition', CONDITIONS, c.disc_cond)}
      ${select('case_cond', 'Case condition', CONDITIONS, c.case_cond)}
      ${field('price', 'Price paid (£)', { type: 'number', value: c.price ?? '', attrs: 'min="0" step="0.01" inputmode="decimal"' })}
      ${field('acquired', 'Acquired', { value: c.acquired, attrs: 'placeholder="YYYY-MM-DD" pattern="\\d{4}(-\\d{2}(-\\d{2})?)?"', hint: 'Year, month or full date' })}
      ${field('tags', 'Tags', { value: c.tags, cls: 'full', hint: 'Comma separated, e.g. tarkovsky, to rewatch', attrs: 'list="tag-suggest"' })}
      ${area('notes', 'Notes', { value: c.notes, cls: 'full', attrs: 'rows="3" placeholder="Bought at… / disc 2 has a scratch…"' })}
      <div class="full err"></div>
      <div class="full btns"><button class="btn primary" type="submit">${copy ? 'Save copy' : 'Add to shelf'}</button></div>
    </form>`, {
    onMount: (d, close) => bindForm(d.querySelector('form'), async (v) => {
      const body = { ...v, price: v.price === '' ? null : Number(v.price) };
      const r = copy ? await patch(`/api/copies/${copy.id}`, body) : await post('/api/copies', { ...body, edition_id: edition.id });
      me.copies.add(edition.id); me.wants.delete(edition.id);
      close(); toast(copy ? 'Copy updated' : 'Added to your shelf');
      onSaved?.(r.copy);
    })
  });
}

const REGION_HINT = 'Number printed on the case. 0 for region-free; several as 2,4.';

export function editionFields(e = {}, labels = []) {
  return `
    <div class="field"><label for="f-label_name">Label</label><input id="f-label_name" name="label_name" list="label-list" value="${esc(e.label_name ?? e.label ?? '')}" required autocomplete="off"><datalist id="label-list">${labels.map((l) => `<option value="${esc(l.name)}">`).join('')}</datalist></div>
    ${field('cat_no', 'Catalogue number', { value: e.cat_no, hint: 'As printed on the spine or back' })}
    ${field('spine_no', 'Spine number', { type: 'number', value: e.spine_no ?? '', attrs: 'min="0" inputmode="numeric"' })}
    ${field('region', 'Region', { value: e.region, hint: REGION_HINT, attrs: 'required inputmode="numeric" pattern="0|[1-8](,[1-8])*"' })}
    ${select('standard', 'Video standard', [['', 'Unknown'], ['PAL', 'PAL'], ['NTSC', 'NTSC']], e.standard)}
    ${select('anamorphic', 'Anamorphic 16:9', [['', 'Unknown / n.a.'], ['1', 'Yes'], ['0', 'No (letterboxed)']], e.anamorphic == null ? '' : e.anamorphic ? '1' : '0')}
    ${field('release_year', 'Release year', { type: 'number', value: e.release_year ?? '', attrs: 'min="1995" max="2100" inputmode="numeric"' })}
    ${field('discs', 'Discs', { type: 'number', value: e.discs ?? 1, attrs: 'min="1" max="50" inputmode="numeric"' })}
    ${select('disc_type', 'Disc type', [['', 'Unknown'], ['DVD-5', 'DVD-5 (single layer)'], ['DVD-9', 'DVD-9 (dual layer)'], ['DVD-10', 'DVD-10'], ['DVD-18', 'DVD-18']], e.disc_type)}
    ${field('packaging', 'Packaging', { value: e.packaging, attrs: 'list="pack-list"', hint: 'Keep case, Snapper, Digipak…' })}<datalist id="pack-list">${['Keep case', 'Snapper', 'Digipak', 'Slim case', 'Slipcase + keep case', 'Steelbook', 'Box set', 'Card sleeve'].map((p) => `<option value="${p}">`).join('')}</datalist>
    ${field('barcode', 'Barcode', { value: e.barcode, attrs: 'inputmode="numeric" pattern="\\d{8,14}"', hint: 'Digits under the barcode on the back' })}
    <div class="field"><span class="lbl">Availability</span><label class="check"><input type="checkbox" name="oop" value="1" ${e.oop ? 'checked' : ''}> Out of print</label></div>
    ${field('audio', 'Audio', { value: e.audio, cls: 'full', hint: 'e.g. Russian mono (Dolby Digital 1.0); English commentary' })}
    ${field('subtitles', 'Subtitles', { value: e.subtitles, cls: 'full', hint: 'e.g. English (optional), French' })}
    ${area('extras', 'Supplements', { value: (e.extras || []).join('\n'), cls: 'full', hint: 'One per line, as listed on the case', attrs: 'rows="6"' })}
    ${area('notes', 'Notes', { value: e.notes, cls: 'full', hint: 'Transfer quality, variants, how to tell pressings apart', attrs: 'rows="3"' })}`;
}

export function readEdition(v) {
  return {
    label_name: v.label_name, cat_no: v.cat_no, spine_no: v.spine_no, region: v.region.replace(/\s/g, ''), standard: v.standard,
    anamorphic: v.anamorphic === '' ? null : v.anamorphic === '1', release_year: v.release_year, discs: v.discs || 1, disc_type: v.disc_type,
    packaging: v.packaging, barcode: v.barcode.replace(/\s/g, ''), oop: v.oop === '1', audio: v.audio, subtitles: v.subtitles,
    extras: v.extras.split('\n').map((s) => s.trim()).filter(Boolean), notes: v.notes
  };
}

export function filmFields(f = {}) {
  return `
    ${field('title', 'Title', { value: f.title, cls: 'full', attrs: 'required', hint: 'Usual English-language title' })}
    ${field('original_title', 'Original title', { value: f.original_title })}
    ${field('directors', 'Director(s)', { value: (f.directors || []).map((d) => d.name || d).join(', '), hint: 'Comma separated' })}
    ${field('year', 'Year', { type: 'number', value: f.year ?? '', attrs: 'min="1888" max="2100" inputmode="numeric"' })}
    ${field('country', 'Country', { value: f.country })}
    ${field('language', 'Original language', { value: f.language })}
    ${field('runtime', 'Runtime (min, at film speed)', { type: 'number', value: f.runtime ?? '', attrs: 'min="1" inputmode="numeric"' })}
    ${field('aspect', 'Original aspect ratio', { value: f.aspect, attrs: 'placeholder="1.85:1" pattern="\\d\\.\\d{2}:1"' })}
    ${area('synopsis', 'Synopsis', { value: f.synopsis, cls: 'full', attrs: 'rows="3"', hint: 'One or two sentences, in your own words' })}`;
}

export function readFilm(v) {
  return {
    title: v.title, original_title: v.original_title, directors: v.directors.split(',').map((s) => s.trim()).filter(Boolean),
    year: v.year, country: v.country, language: v.language, runtime: v.runtime, aspect: v.aspect, synopsis: v.synopsis
  };
}

export const loadLabels = () => get('/api/labels').then((r) => r.items);

// Only send fields that differ from the current record.
export function changed(current, next) {
  const out = {};
  for (const [k, val] of Object.entries(next)) {
    const a = current[k], b = val;
    const norm = (x) => Array.isArray(x) ? JSON.stringify(x) : x === true ? '1' : x === false ? '0' : x == null ? '' : String(x);
    if (norm(a) !== norm(b)) out[k] = val;
  }
  return out;
}
