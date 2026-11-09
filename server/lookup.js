// Barcode → product → film. There is no public "complete database of DVDs": like Discogs, the register
// is built disc by disc. What this module does is make the first scan of any disc nearly free: it asks
// product-barcode services what the code is, reads the messy retail title ("Diaz, Cameron-the Holiday
// (uk Import) Dvd [region 2]"), works out the film, the label, the format and the region, and finds the
// film on TMDB for the real poster and credits. The member confirms and the edition joins the register
// with the retailer's cover image, so everyone's next scan of that disc is instant.
import { barcodeAlt } from './catalogue.js';
import { matchMovie } from './tmdb.js';

const env = (k) => process.env[k] || '';
// barcode_cache is Spine's own barcode database: a product found once is kept for good (the register itself
// takes over once the disc is added), and a disc no source knows is asked about again only after a month.
const CACHE_HIT_DAYS = 36500, CACHE_MISS_DAYS = 30;
const UA = 'Spine/1.0 (+https://github.com/shadowcaster1090-cpu/spine)';

/* ---------- providers ---------- */
// Each returns a normalised product or null. Order: richest data first.
export const PROVIDERS = [
  {
    id: 'upcitemdb',
    name: 'UPCitemdb',
    enabled: () => env('UPCITEMDB_OFF') !== '1',
    async lookup(code, fetchImpl) {
      const key = env('UPCITEMDB_KEY');
      const base = env('UPCITEMDB_BASE') || (key ? 'https://api.upcitemdb.com/prod/v1' : 'https://api.upcitemdb.com/prod/trial');
      const headers = { accept: 'application/json', 'user-agent': UA };
      if (key) { headers.user_key = key; headers.key_type = '3scale'; }
      const res = await fetchImpl(`${base}/lookup?upc=${encodeURIComponent(code)}`, { headers, signal: AbortSignal.timeout(7000) });
      if (res.status === 404) return null;
      if (res.status === 429) throw new Error('rate limited');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const it = (data.items || [])[0];
      if (!it) return null;
      return {
        source: 'upcitemdb', code: it.ean || it.upc || code,
        title: it.title || '', brand: it.brand || '', description: it.description || '', category: it.category || '',
        images: (it.images || []).filter((u) => /^https?:\/\//.test(u)),
        titles: (it.offers || []).map((o) => o.title).filter(Boolean)
      };
    }
  },
  {
    id: 'openproductsfacts',
    name: 'Open Products Facts',
    enabled: () => env('OPF_OFF') !== '1',
    async lookup(code, fetchImpl) {
      const base = env('OPF_BASE') || 'https://world.openproductsfacts.org';
      const res = await fetchImpl(`${base}/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,brands,image_front_url,generic_name`, { headers: { accept: 'application/json', 'user-agent': UA }, signal: AbortSignal.timeout(7000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const p = data.product;
      if (!p || !(p.product_name || p.generic_name)) return null;
      return { source: 'openproductsfacts', code, title: p.product_name || p.generic_name || '', brand: p.brands || '', description: p.generic_name || '', category: '', images: p.image_front_url ? [p.image_front_url] : [], titles: [] };
    }
  },
  {
    id: 'upcdatabase',
    name: 'UPCdatabase.org',
    enabled: () => !!env('UPCDATABASE_KEY'),
    async lookup(code, fetchImpl) {
      const res = await fetchImpl(`${env('UPCDATABASE_BASE') || 'https://api.upcdatabase.org'}/product/${encodeURIComponent(code)}?apikey=${encodeURIComponent(env('UPCDATABASE_KEY'))}`, { headers: { accept: 'application/json', 'user-agent': UA }, signal: AbortSignal.timeout(7000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const p = await res.json();
      if (!p || !p.success || !(p.title || p.description)) return null;
      return { source: 'upcdatabase', code, title: p.title || p.description || '', brand: p.brand || '', description: p.description || '', category: p.category || '', images: (p.images || []).filter((u) => /^https?:\/\//.test(u)), titles: [] };
    }
  },
  {
    // EAN-Search.org (ean-search.org/ean-api-intro.html): a paid, token-based API with wide European
    // coverage; product names only, no images. Asked last, so its monthly quota goes only on discs the
    // free sources lack. Server-side only: the token must never reach the page or the phone.
    id: 'eansearch',
    name: 'EAN-Search.org',
    enabled: () => !!env('EANSEARCH_TOKEN'),
    async lookup(code, fetchImpl) {
      if (code.length === 12) return null;   // the same code as EAN-13 (leading 0) is asked as well; one query is enough
      const base = env('EANSEARCH_BASE') || 'https://api.ean-search.org';
      const res = await fetchImpl(`${base}/api?token=${encodeURIComponent(env('EANSEARCH_TOKEN'))}&op=barcode-lookup&format=json&ean=${encodeURIComponent(code)}`, { headers: { accept: 'application/json', 'user-agent': UA }, signal: AbortSignal.timeout(7000) });
      if (res.status === 404) return null;
      if (res.status === 429) throw new Error('rate limited');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { if (/not found/i.test(text)) return null; throw new Error('unreadable answer'); }
      const p = Array.isArray(data) ? data[0] : data;
      if (!p) return null;
      // A miss and a failure look alike ({error: "…"}); only "not found" is a clean miss worth remembering.
      if (p.error) { if (/not found/i.test(p.error)) return null; throw new Error(String(p.error).slice(0, 80)); }
      if (!p.name) return null;
      return { source: 'eansearch', code, title: String(p.name), brand: '', description: '', category: String(p.categoryName || ''), images: [], titles: [] };
    }
  }
];

// Asks providers in turn; remembers answers (and misses) so a disc is looked up once.
// cachedOnly: answer from Spine's own records alone (known: false when they have nothing to say).
// skip: provider ids already asked elsewhere, e.g. 'upcitemdb' when the phone has just been told "no items".
export async function lookupProduct(db, rawCode, { fetchImpl = fetch, force = false, cachedOnly = false, skip = [] } = {}) {
  const code = String(rawCode).replace(/\D/g, '');
  const codes = [...new Set([code, barcodeAlt(code)])];
  if (!force) {
    const row = db.prepare('SELECT data, fetched_at FROM barcode_cache WHERE code IN (' + codes.map(() => '?').join(',') + ') ORDER BY fetched_at DESC LIMIT 1').get(...codes);
    if (row) {
      const data = JSON.parse(row.data);
      const ttl = (data.product ? CACHE_HIT_DAYS : CACHE_MISS_DAYS) * 864e5;
      if (Date.now() - row.fetched_at < ttl) return { ...data, cached: true, known: true };
    }
  }
  if (cachedOnly) return { product: null, errors: [], cached: false, known: false };
  let product = null;
  const errors = [];
  for (const p of PROVIDERS) {
    if (!p.enabled() || skip.includes(p.id)) continue;
    for (const c of codes) {
      try {
        product = await p.lookup(c, fetchImpl);
        if (product) break;
      } catch (e) { errors.push(`${p.id}: ${e.message}`); break; }
    }
    if (product) break;
  }
  const data = { product, errors };
  // Don't cache a miss caused by provider trouble; the next scan should try again.
  if (product || !errors.length) {
    db.prepare('INSERT INTO barcode_cache (code, data, fetched_at) VALUES (?, ?, ?) ON CONFLICT(code) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at').run(code, JSON.stringify(data), Date.now());
  }
  return { ...data, cached: false, known: !!product || !errors.length };
}

/* ---------- Spine's barcode database on your own computer: export, import, counts ---------- */
const putCache = (db) => db.prepare('INSERT INTO barcode_cache (code, data, fetched_at) VALUES (?, ?, ?) ON CONFLICT(code) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at');

// Barcodes on the register, in both spellings: their own row wins over anything a lookup once said about them.
const registerCodes = (db) => {
  const set = new Set();
  for (const { barcode } of db.prepare("SELECT barcode FROM editions WHERE barcode != '' AND merged_into IS NULL").all()) { set.add(barcode); set.add(barcodeAlt(barcode)); }
  return set;
};

export function barcodeStats(db) {
  const reg = registerCodes(db);
  const register = db.prepare("SELECT count(*) n FROM editions WHERE barcode != '' AND merged_into IS NULL").get().n;
  let products = 0, unknown = 0, imported = 0;
  for (const r of db.prepare('SELECT code, data FROM barcode_cache').all()) {
    if (reg.has(r.code)) continue;
    const p = JSON.parse(r.data).product;
    if (!p) unknown++; else { products++; if (p.source === 'import') imported++; }
  }
  return { register, products, unknown, imported };
}

// Every barcode Spine knows: discs on the register, products found by a lookup or imported, and codes no source has.
export function exportBarcodes(db) {
  const rows = [['barcode', 'status', 'title', 'label_or_brand', 'source', 'updated']];
  for (const e of db.prepare(`SELECT e.barcode, f.title, f.year, l.name label, e.updated_at FROM editions e JOIN films f ON f.id = e.film_id
      LEFT JOIN labels l ON l.id = e.label_id WHERE e.barcode != '' AND e.merged_into IS NULL ORDER BY e.id`).all()) {
    rows.push([e.barcode, 'on the register', e.year ? `${e.title} (${e.year})` : e.title, e.label || '', 'register', String(e.updated_at || '').slice(0, 10)]);
  }
  const reg = registerCodes(db);
  for (const c of db.prepare('SELECT code, data, fetched_at FROM barcode_cache ORDER BY code').all()) {
    if (reg.has(c.code)) continue;
    const p = JSON.parse(c.data).product;
    rows.push([c.code, p ? 'product' : 'no source has it', p?.title || '', p?.brand || '', p?.source || '', new Date(c.fetched_at).toISOString().slice(0, 10)]);
  }
  return rows;
}

// Barcodes from a spreadsheet on your computer (this export, or another collection app's) join Spine's own records,
// so scanning those discs needs no outside lookup. Columns are found by name (barcode/upc/ean, title/name,
// label/brand/studio), or taken as barcode, title, label when there is no header row. Known products are kept.
export function importBarcodes(db, rows) {
  if (!rows.length) return { added: 0, already: 0, skipped: 0 };
  const head = rows[0].map((h) => String(h).trim().toLowerCase());
  const col = (...names) => head.findIndex((h) => names.includes(h));
  let ci = col('barcode', 'upc', 'ean', 'ean13', 'ean-13', 'gtin', 'code'), ti = col('title', 'name', 'product', 'film', 'movie');
  let li = col('label', 'label_or_brand', 'brand', 'studio', 'distributor', 'publisher');
  const header = ci >= 0 && ti >= 0;
  if (!header) { ci = 0; ti = 1; li = 2; }
  const onRegister = db.prepare('SELECT 1 FROM editions WHERE barcode IN (?, ?) AND merged_into IS NULL');
  const cached = db.prepare('SELECT data FROM barcode_cache WHERE code IN (?, ?)');
  const put = putCache(db);
  let added = 0, already = 0, skipped = 0;
  for (const r of rows.slice(header ? 1 : 0, 200001)) {
    const code = String(r[ci] ?? '').replace(/\D/g, '');
    const title = String(r[ti] ?? '').trim().slice(0, 200);
    if (code.length < 8 || code.length > 14 || !title) { skipped++; continue; }
    const alt = barcodeAlt(code);
    if (onRegister.get(code, alt)) { already++; continue; }
    const prev = cached.get(code, alt);
    if (prev && JSON.parse(prev.data).product) { already++; continue; }
    const brand = li >= 0 ? String(r[li] ?? '').trim().slice(0, 100) : '';
    put.run(code, JSON.stringify({ product: { source: 'import', code, title, brand, description: '', category: '', images: [], titles: [] }, errors: [] }), Date.now());
    added++;
  }
  return { added, already, skipped };
}

/* ---------- reading a retail title ---------- */
// Labels and distributors as they appear in retail titles and brand fields → the name used on the register.
export const LABELS = [
  [/\bcriterion\b/i, 'The Criterion Collection'], [/\barrow (video|films|academy)\b|\barrow\b/i, 'Arrow Video'], [/\bbfi\b|british film institute/i, 'BFI'],
  [/masters of cinema|\beureka\b/i, 'Eureka Entertainment'], [/second sight/i, 'Second Sight'], [/\bindicator\b|powerhouse films/i, 'Indicator'],
  [/studio ?canal|optimum (releasing|home)|\boptimum\b/i, 'StudioCanal'], [/warner (bros|brothers|home)|\bwarner\b|\bwb\b/i, 'Warner Bros.'], [/warner archive/i, 'Warner Archive'],
  [/\buniversal\b/i, 'Universal'], [/sony pictures|columbia tristar|\bcolumbia\b|\bsony\b/i, 'Sony Pictures'], [/\bparamount\b/i, 'Paramount'],
  [/20th century fox|twentieth century fox|\bfox\b/i, '20th Century Fox'], [/walt disney|\bdisney\b|buena vista/i, 'Disney'], [/\bmgm\b|metro[- ]goldwyn/i, 'MGM'],
  [/kino lorber|\bkino\b/i, 'Kino Lorber'], [/shout! factory|shout factory|scream factory/i, 'Shout! Factory'], [/vinegar syndrome/i, 'Vinegar Syndrome'],
  [/\bseverin\b/i, 'Severin Films'], [/\b88 films\b/i, '88 Films'], [/radiance films/i, 'Radiance Films'], [/artificial eye|\bcurzon\b/i, 'Curzon'],
  [/\bdogwoof\b/i, 'Dogwoof'], [/\bnetwork\b/i, 'Network'], [/momentum pictures|\bmomentum\b/i, 'Momentum Pictures'], [/entertainment in video|\beiv\b/i, 'Entertainment in Video'],
  [/\btartan\b/i, 'Tartan'], [/anchor bay/i, 'Anchor Bay'], [/lions ?gate/i, 'Lionsgate'], [/\bfabulous films\b/i, 'Fabulous Films'], [/signal one/i, 'Signal One'],
  [/\bmetrodome\b/i, 'Metrodome'], [/soda pictures/i, 'Soda Pictures'], [/\bpeccadillo\b/i, 'Peccadillo'], [/\bicon\b/i, 'Icon'], [/\bpath[eé]\b/i, 'Pathé'],
  [/\bfilm ?4\b/i, 'Film4'], [/\bitv\b/i, 'ITV Studios'], [/simply media/i, 'Simply Media'], [/\b101 films\b/i, '101 Films'], [/\bimprint\b/i, 'Imprint'],
  [/\bumbrella\b/i, 'Umbrella Entertainment'], [/\bmadman\b/i, 'Madman'], [/via vision/i, 'Via Vision'], [/\bcarlotta\b/i, 'Carlotta'], [/\bgaumont\b/i, 'Gaumont'],
  [/\bpotemkine\b/i, 'Potemkine'], [/wild side/i, 'Wild Side'], [/studio ghibli/i, 'Studio Ghibli'], [/manga entertainment/i, 'Manga Entertainment'], [/\bfunimation\b/i, 'Funimation'],
  [/cohen media|cohen film/i, 'Cohen Media Group'], [/\bmilestone\b/i, 'Milestone'], [/olive films/i, 'Olive Films'], [/twilight time/i, 'Twilight Time'], [/flicker alley/i, 'Flicker Alley'],
  [/\bsynapse\b/i, 'Synapse Films'], [/blue underground/i, 'Blue Underground'], [/mondo macabro/i, 'Mondo Macabro'], [/cult epics/i, 'Cult Epics'], [/grindhouse releasing/i, 'Grindhouse Releasing'],
  [/\btroma\b/i, 'Troma'], [/\boscilloscope\b/i, 'Oscilloscope'], [/\bjanus\b/i, 'Janus Films'], [/\bzeitgeist\b/i, 'Zeitgeist'], [/strand releasing/i, 'Strand Releasing'],
  [/music box films/i, 'Music Box Films'], [/\bmagnolia\b/i, 'Magnolia'], [/\bifc\b/i, 'IFC Films'], [/\ba24\b/i, 'A24'], [/\bneon\b/i, 'Neon'], [/well go/i, 'Well Go USA'],
  [/mill creek/i, 'Mill Creek'], [/\bhbo\b/i, 'HBO'], [/\bbbc\b/i, 'BBC'], [/\bacorn\b/i, 'Acorn Media'], [/\bpbs\b/i, 'PBS'], [/image entertainment/i, 'Image Entertainment'],
  [/new line/i, 'New Line'], [/dream ?works/i, 'DreamWorks'], [/\bpixar\b/i, 'Pixar'], [/\bmiramax\b/i, 'Miramax'], [/\bfocus features\b/i, 'Focus Features'],
  [/\bartisan\b/i, 'Artisan'], [/\bpalisades\b/i, 'Palisades Tartan'], [/\bodyssey\b/i, 'Odyssey'], [/\bscreenbound\b/i, 'Screenbound'], [/\bmediumrare\b/i, 'Mediumrare'],
  [/final cut/i, 'Final Cut Entertainment'], [/\bgeneon\b|\bpioneer\b/i, 'Pioneer'], [/\bbandai\b/i, 'Bandai'], [/\bviz\b/i, 'VIZ Media'], [/\bcrunchyroll\b/i, 'Crunchyroll'],
  [/\bentertainment one\b|\beone\b/i, 'Entertainment One'], [/\bsignature\b/i, 'Signature Entertainment'], [/\bthunderbird\b/i, 'Thunderbird'], [/\bkaleidoscope\b/i, 'Kaleidoscope']
];

const FORMAT_WORDS = /\b(4k( ultra hd)?( blu[- ]?ray)?|uhd( bd)?|ultra hd( blu[- ]?ray)?|blu[- ]?ray|\bbd\b|dvd|hd[- ]dvd|laserdisc|vhs|no standard)\b/gi;
const NOISE = [
  /\b(uk|us|usa|import|imports|uk import|region[- ]?free|region ?[0-9abc](?:\/[0-9abc])*|all regions|multi[- ]region|ntsc|pal|widescreen|full ?screen|fullscreen|letterbox(ed)?|anamorphic|1080p|2160p|hdr|dolby|dts)\b/gi,
  /\b(new|sealed|brand new|used|very good|like new|pre-?owned|free (uk )?(p&p|shipping|postage)|fast dispatch)\b/gi,
  /\b(\d+|two|three|four|five|six)[- ]disc(s)?( set| edition)?\b/gi,
  /\b(disc|discs|box ?set|boxset|collection|the complete( series| collection)?|season \d+|series \d+)\b/gi,
  /\b(special|collector'?s|limited|deluxe|ultimate|definitive|anniversary|\d+(st|nd|rd|th)[- ]anniversary|restored|remastered|digitally remastered|extended|unrated|uncut|theatrical|director'?s cut|final cut|steelbook|digibook|digipak|slipcase|slipcover|keep ?case)\s*(edition|cut|version|release)?\b/gi,
  /\b(feature film|the movie|the film|motion picture)\s*$/gi,
  // Combo-pack extras ("4K + Blu-ray + Digital", "Includes Digital Copy", "Double Play") and retailer exclusives.
  /(\+\s*|\b(?:includes?|with|plus)\s+)digital\b(?: (?:hd|copy|download|code|version|ultraviolet))?|\bdigital (?:hd|copy|download|code|version)\b|\bultraviolet\b|\buv copy\b|\bcombo(?: pack)?\b|\bdouble play\b|\btriple play\b|\bbonus disc\b/gi,
  /\b(?:zavvi|hmv|amazon|best buy|target|walmart|fnac)\s+exclusive\b|\b(?:zavvi|hmv)\b/gi,
  /\b(with|starring|stars|featuring)\b.*$/gi
];
const LABEL_WORDS = /\b(the criterion collection|criterion collection|criterion|arrow|eureka|kino|shout|masters of cinema|arrow video|arrow academy|arrow films|studio ?canal|warner (bros\.?|brothers|home video|archive)|sony pictures( home entertainment)?|columbia tristar|20th century fox|twentieth century fox|walt disney|buena vista|universal (pictures|studios)|paramount( pictures)?|kino lorber|shout! factory|scream factory|vinegar syndrome|second sight|indicator|powerhouse films|bfi|eureka( entertainment)?|artificial eye|curzon|optimum( releasing| home entertainment)?|momentum pictures|entertainment in video|tartan( video)?|anchor bay|lions ?gate|network|88 films|radiance films|severin|dogwoof|fabulous films|signal one|metrodome|mgm|hbo|bbc)\b/gi;

// GS1 company prefixes of home-video distributors: even a disc no database knows tells us its label.
// Prefixes are the first 7 digits of the EAN-13 (US UPCs with a leading 0). Every entry was checked against
// complete barcodes of real discs in Nov 2026 (test/lookup.test.js names one disc per prefix). A prefix several
// labels share is left out rather than guessed: MVD's 0760137 (Arrow US, Radiance, Severin…), 0191329 (Universal's,
// also on Paramount discs since 2023), 5037899 (Anime Limited, Indicator, 88 Films, 101 Films), 5060105 (Altitude,
// Sparky Pictures), 5060952 (Fabulous Films, Altitude). The member can always change the label.
export const COMPANY_PREFIXES = [
  // United States and Canada
  ['0715515', 'The Criterion Collection'], ['0025192', 'Universal'], ['0025193', 'Universal'], ['0043396', 'Sony Pictures'],
  ['0883929', 'Warner Bros.'], ['0085391', 'Warner Bros.'], ['0012569', 'Warner Bros.'], ['0888574', 'Warner Archive'], ['0794043', 'New Line'], ['0026359', 'HBO'],
  ['0097361', 'Paramount'], ['0032429', 'Paramount'], ['0024543', '20th Century Fox'], ['0786936', 'Disney'], ['0027616', 'MGM'], ['0667068', 'DreamWorks'],
  ['0031398', 'Lionsgate'], ['0012236', 'Lionsgate'],   // 0012236: the Artisan / LIVE catalogue, now Lionsgate's
  ['0738329', 'Kino Lorber'], ['0826663', 'Shout! Factory'], ['0654930', 'Synapse Films'], ['0827058', 'Blue Underground'], ['0814456', 'Vinegar Syndrome'],
  ['0663390', 'Severin Films'], ['0887090', 'Olive Films'], ['0811956', 'Twilight Time'], ['0617311', 'Flicker Alley'], ['0876964', 'Magnolia'], ['0810180', 'A24'],
  ['0812491', 'Well Go USA'], ['0683904', 'Mill Creek'], ['0014381', 'Image Entertainment'], ['0013132', 'Anchor Bay'], ['0841887', 'PBS'], ['0054961', 'Acorn Media'],
  ['0843276', 'Mondo Macabro'], ['0881190', 'Cult Epics'], ['0790357', 'Troma'], ['0795975', 'Zeitgeist'], ['0720229', 'First Run Features'],
  ['0704400', 'Funimation'], ['0782009', 'VIZ Media'], ['0669198', 'Bandai'], ['0013023', 'Pioneer'], ['0814131', 'Sentai Filmworks'], ['0816726', 'Sentai Filmworks'], ['0875707', 'Discotek Media'],
  // United Kingdom. UK Warner discs also carry Swedish-registered 7321900 codes, and Disney's Dutch 8717418 ones.
  ['5050582', 'Universal'], ['5053083', 'Universal'], ['5050629', 'Sony Pictures'], ['5050630', 'Sony Pictures'], ['5035822', 'Sony Pictures'],
  ['5051892', 'Warner Bros.'], ['7321900', 'Warner Bros.'], ['5014437', 'Paramount'], ['5051368', 'Paramount'], ['5017188', 'Disney'], ['8717418', 'Disney'],
  ['5039036', '20th Century Fox'], ['5050070', 'MGM'], ['5055761', 'Lionsgate'], ['5060052', 'Lionsgate'], ['5060223', 'Lionsgate'],
  ['5030305', 'Entertainment One'], ['5055744', 'Entertainment One'], ['5017239', 'Entertainment in Video'], ['5051429', 'Icon'],
  ['5060116', 'Momentum Pictures'], ['5060049', 'Momentum Pictures'], ['5055201', 'StudioCanal'],   // 5055201: Optimum Releasing, now StudioCanal UK
  ['5027035', 'Arrow Video'], ['5035673', 'BFI'], ['5022655', 'BFI'], ['5060000', 'Eureka Entertainment'], ['5028836', 'Second Sight'], ['5060697', 'Indicator'],
  ['5060710', '88 Films'], ['5060496', '88 Films'], ['5060974', 'Radiance Films'], ['5060114', 'Second Run'], ['5060148', 'Third Window Films'],
  ['5027626', 'Network'], ['5021866', 'Curzon'], ['5036193', 'Acorn Media'], ['5050968', 'Dogwoof'], ['5019322', 'Simply Media'], ['5060020', 'Anchor Bay'],
  ['5023965', 'Tartan'], ['5060262', 'Signature Entertainment'], ['5030697', 'Fabulous Films'], ['5060758', 'Kaleidoscope'], ['5060018', 'Peccadillo'], ['5060265', 'Peccadillo'],
  ['5022366', 'Manga Entertainment'], ['5060067', 'MVM Entertainment'],
  // Germany
  ['4030521', 'Sony Pictures'], ['4010232', '20th Century Fox'], ['4011976', 'Constantin Film'],
  // Australia and New Zealand (Roadshow also releases Warner Bros. films there)
  ['9398700', 'Roadshow Entertainment'], ['9398710', 'Roadshow Entertainment'], ['9398711', 'Roadshow Entertainment'], ['9325336', 'Warner Bros.'],
  ['9321337', '20th Century Fox'], ['9324915', 'Paramount'], ['9398540', 'Disney'], ['9398580', 'Disney'], ['9344256', 'Umbrella Entertainment'],
  ['9322225', 'Madman'], ['9345228', 'Shock Entertainment']
];
export function labelFromBarcode(code) {
  const c = String(code).replace(/\D/g, '');
  const ean = c.length === 12 ? '0' + c : c;
  const hit = COMPANY_PREFIXES.find(([p]) => ean.startsWith(p));
  return hit ? hit[1] : '';
}

// What the barcode alone says about a disc, for prefilling a manual add.
export function hintFromBarcode(code) {
  const { region, standard } = regionFromBarcode(code);
  return { label: labelFromBarcode(code), region, standard };
}

export function regionFromBarcode(code) {
  const c = String(code).replace(/\D/g, '');
  const ean = c.length === 12 ? '0' + c : c;
  if (ean.length !== 13) return { region: '', standard: '' };
  const p3 = +ean.slice(0, 3);
  const R = (region, standard) => ({ region, standard });
  if (p3 <= 139) return R('1', 'NTSC');                       // US & Canada
  if (p3 >= 300 && p3 <= 379) return R('2', 'PAL');           // France
  if (p3 >= 400 && p3 <= 440) return R('2', 'PAL');           // Germany
  if (p3 >= 450 && p3 <= 459 || p3 >= 490 && p3 <= 499) return R('2', 'NTSC'); // Japan
  if (p3 >= 460 && p3 <= 469) return R('5', 'PAL');           // Russia
  if (p3 === 489) return R('3', 'NTSC');                      // Hong Kong
  if (p3 >= 500 && p3 <= 509) return R('2', 'PAL');           // UK
  if (p3 >= 520 && p3 <= 521) return R('2', 'PAL');           // Greece
  if (p3 === 539) return R('2', 'PAL');                       // Ireland
  if (p3 >= 540 && p3 <= 549) return R('2', 'PAL');           // Belgium & Luxembourg
  if (p3 === 560 || p3 === 569 || p3 === 570 || p3 === 571 || p3 === 572 || p3 === 573) return R('2', 'PAL'); // Portugal, Iceland, Denmark
  if (p3 >= 570 && p3 <= 579) return R('2', 'PAL');
  if (p3 === 590 || p3 === 594 || p3 === 599) return R('2', 'PAL'); // Poland, Romania, Hungary
  if (p3 >= 600 && p3 <= 601) return R('2', 'PAL');           // South Africa
  if (p3 >= 640 && p3 <= 649) return R('2', 'PAL');           // Finland
  if (p3 >= 690 && p3 <= 699) return R('6', 'NTSC');          // China
  if (p3 >= 700 && p3 <= 709) return R('2', 'PAL');           // Norway
  if (p3 === 729) return R('2', 'PAL');                       // Israel
  if (p3 >= 730 && p3 <= 739) return R('2', 'PAL');           // Sweden
  if (p3 === 750) return R('4', 'NTSC');                      // Mexico
  if (p3 >= 754 && p3 <= 755) return R('1', 'NTSC');          // Canada
  if (p3 >= 760 && p3 <= 769) return R('2', 'PAL');           // Switzerland
  if (p3 === 770 || p3 === 771) return R('4', 'NTSC');        // Colombia
  if (p3 >= 773 && p3 <= 780) return R('4', 'NTSC');          // Uruguay, Peru, Bolivia, Argentina, Chile
  if (p3 === 789 || p3 === 790) return R('4', 'NTSC');        // Brazil
  if (p3 >= 800 && p3 <= 839) return R('2', 'PAL');           // Italy
  if (p3 >= 840 && p3 <= 849) return R('2', 'PAL');           // Spain
  if (p3 >= 850 && p3 <= 851) return R('4', 'NTSC');          // Cuba? (rare) → fall through
  if (p3 === 859) return R('2', 'PAL');                       // Czech Republic
  if (p3 === 860) return R('2', 'PAL');                       // Serbia
  if (p3 === 868 || p3 === 869) return R('2', 'PAL');         // Turkey
  if (p3 >= 870 && p3 <= 879) return R('2', 'PAL');           // Netherlands
  if (p3 === 880) return R('3', 'NTSC');                      // South Korea
  if (p3 === 885) return R('3', 'PAL');                       // Thailand
  if (p3 === 888) return R('3', 'PAL');                       // Singapore
  if (p3 === 890) return R('5', 'PAL');                       // India
  if (p3 >= 900 && p3 <= 919) return R('2', 'PAL');           // Austria
  if (p3 >= 930 && p3 <= 939) return R('4', 'PAL');           // Australia
  if (p3 >= 940 && p3 <= 949) return R('4', 'PAL');           // New Zealand
  if (p3 === 955) return R('3', 'PAL');                       // Malaysia
  if (p3 === 958) return R('3', 'NTSC');                      // Macau
  return { region: '', standard: '' };
}

export function formatOf(text) {
  const t = String(text || '');
  if (/\b(4k|uhd|ultra hd)\b/i.test(t)) return 'uhd';
  if (/blu[- ]?ray|\bbd\b/i.test(t)) return 'bluray';
  return 'dvd';
}

export function labelOf(...texts) {
  for (const t of texts) {
    if (!t) continue;
    for (const [re, name] of LABELS) if (re.test(t)) return name;
  }
  return '';
}

const tidy = (s) => s.replace(/\s+/g, ' ').replace(/[\s\-–—:,;·|/+]+$/g, '').replace(/^[\s\-–—:,;·|/+]+/g, '').trim();
const titleCase = (s) => s.replace(/\S+/g, (w) => (w.length > 1 && w === w.toUpperCase() && /[A-Z]{3,}/.test(w)) || w === w.toLowerCase() ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w);

// Turns a retail product title into a film title plus edition facts.
export function parseProductTitle(raw, { brand = '', code = '', alternatives = [] } = {}) {
  let s = String(raw || '').replace(/[“”"]/g, '').replace(/&amp;/g, '&');
  const facts = { year: null, format: formatOf(s), label: '', region: '', discs: null, edition: [] };
  // Facts first, then strip.
  // A year in brackets is the film's; a bare one only counts if it could be a real year ("2049" is a title).
  const yearM = s.match(/[(\[]\s*((?:19|20)\d{2})\s*[)\]]/) || s.match(/(?:^|[\s,-])((?:19|20)\d{2})\s*$/);
  if (yearM && +yearM[1] <= new Date().getFullYear() + 1) facts.year = +yearM[1];
  const regionM = s.match(/region\s*([0-9abc])/i);
  if (regionM) facts.region = regionM[1].toUpperCase();
  const discsM = s.match(/\b(\d+|two|three|four|five|six)[- ]disc/i);
  if (discsM) facts.discs = ({ two: 2, three: 3, four: 4, five: 5, six: 6 })[discsM[1].toLowerCase()] || +discsM[1] || null;
  for (const m of s.matchAll(/\b((?:\d+(?:st|nd|rd|th)[- ])?(?:special|collector'?s|limited|deluxe|ultimate|definitive|anniversary|extended|unrated|uncut|theatrical|director'?s cut|final cut|steelbook|digibook|restored|remastered)(?: edition| cut)?)\b/gi)) facts.edition.push(titleCase(m[1]));
  facts.label = labelOf(s, brand);
  // "Surname, Firstname-Title" (a retailer habit) → drop the name.
  s = s.replace(/^[A-Z][\w'.]+,\s*[A-Z][\w'.]+(?: [A-Z][\w'.]+)?-(?=\S)/, '');
  // Bracketed chunks are nearly always packaging facts; keep one only if it is the whole title.
  // An unclosed bracket (retail titles get truncated) takes the rest of the line with it.
  const stripped = s.replace(/\s*[\[(][^\])]*[\])]\s*/g, ' ').replace(/\s*[\[(][^\])]*$/, ' ');
  if (tidy(stripped)) s = stripped;
  s = s.replace(LABEL_WORDS, ' ');
  s = s.replace(FORMAT_WORDS, ' ');
  for (const re of NOISE) s = s.replace(re, ' ');
  s = s.replace(/(?:\s*\+\s*){2,}/g, ' + ');   // "Title + + " once the formats and digital copies are gone; "Romeo + Juliet" keeps its plus
  if (facts.year) s = s.replace(new RegExp('(?:^|[\\s,-])' + facts.year + '\\s*$'), ' ');
  s = s.replace(/\s[-–—:|/]\s.*$/, (m) => (m.length > s.length * .6 ? ' ' : m)); // a long tail after a dash is usually a subtitle: keep; a short one is noise
  s = tidy(s).replace(/\s*[-–—:,;]+\s*$/, '');
  // A trailing "the" from "Holiday, The"
  s = s.replace(/^(.*),\s*(the|a|an)$/i, '$2 $1');
  let title = tidy(s);
  if (/^[a-z0-9 ,'&!?.-]+$/.test(title) && title === title.toLowerCase()) title = titleCase(title);
  else if (/^[a-z]/.test(title)) title = title[0].toUpperCase() + title.slice(1);
  // Retailer offer titles can be cleaner than the main one; prefer the shortest sensible alternative that agrees.
  const alts = alternatives.map((a) => tidy(String(a).replace(/\s*[\[(][^\])]*[\])]\s*/g, ' ').replace(FORMAT_WORDS, ' '))).filter((a) => a.length >= 2 && a.length <= 60);
  if (title.length < 2 && alts.length) title = alts[0];
  const regionGuess = facts.region ? { region: facts.region, standard: facts.region === '1' ? 'NTSC' : facts.region === '2' ? 'PAL' : '' } : regionFromBarcode(code);
  return { title, year: facts.year, format: facts.format, label: facts.label, region: regionGuess.region, standard: regionGuess.standard, discs: facts.discs, edition: [...new Set(facts.edition)], alternatives: alts };
}

/* ---------- the whole thing ---------- */
export async function suggestFromBarcode(db, tmdb, code, { fetchImpl = fetch, force = false, cachedOnly = false, skip = [] } = {}) {
  const looked = await lookupProduct(db, code, { fetchImpl, force, cachedOnly, skip });
  if (looked.errors?.length) console.warn(`barcode ${code}: ${looked.errors.join('; ')}`);
  return { ...(await suggestFromProduct(db, tmdb, code, looked.product, { errors: looked.errors, cached: looked.cached })), known: looked.known };
}

// A product the phone fetched itself (each phone has its own daily allowance with the barcode
// services, where a server's shared address runs out). Cleaned, remembered, then treated like ours.
export function acceptClientProduct(db, code, raw) {
  if (!raw || typeof raw !== 'object') return null;
  const str = (x, n) => (typeof x === 'string' ? x.trim().slice(0, n) : '');
  const product = {
    source: ['upcitemdb', 'openproductsfacts', 'upcdatabase', 'eansearch'].includes(raw.source) ? raw.source : 'client',
    code, title: str(raw.title, 200), brand: str(raw.brand, 100), description: str(raw.description, 2000), category: str(raw.category, 200),
    images: (Array.isArray(raw.images) ? raw.images : []).filter((u) => typeof u === 'string' && /^https?:\/\/[^\s"']+$/.test(u) && u.length < 600).slice(0, 8),
    titles: (Array.isArray(raw.titles) ? raw.titles : []).filter((t) => typeof t === 'string').map((t) => t.trim().slice(0, 200)).filter(Boolean).slice(0, 10)
  };
  if (!product.title && !product.titles.length) return null;
  db.prepare('INSERT INTO barcode_cache (code, data, fetched_at) VALUES (?, ?, ?) ON CONFLICT(code) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at')
    .run(String(code).replace(/\D/g, ''), JSON.stringify({ product, errors: [] }), Date.now());
  return product;
}

export async function suggestFromProduct(db, tmdb, code, product, { errors = [], cached = false } = {}) {
  if (!product) return { product: null, parsed: null, film: null, errors, cached };
  const parsed = parseProductTitle(product.title, { brand: product.brand, code, alternatives: product.titles });
  let film = null;
  if (tmdb.enabled && parsed.title) {
    try {
      film = await matchMovie(tmdb, parsed.title, parsed.year);
      if (!film) for (const alt of parsed.alternatives.slice(0, 2)) { film = await matchMovie(tmdb, alt, parsed.year); if (film) break; }
    } catch { film = null; }
  }
  return { product: { source: product.source, title: product.title, brand: product.brand, description: product.description, images: product.images.slice(0, 6) }, parsed, film, errors, cached };
}
