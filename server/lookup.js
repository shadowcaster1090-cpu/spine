// Barcode → product → film. There is no public "complete database of DVDs": like Discogs, the register
// is built disc by disc. What this module does is make the first scan of any disc nearly free: it asks
// product-barcode services what the code is, reads the messy retail title ("Diaz, Cameron-the Holiday
// (uk Import) Dvd [region 2]"), works out the film, the label, the format and the region, and finds the
// film on TMDB for the real poster and credits. The member confirms and the edition joins the register
// with the retailer's cover image, so everyone's next scan of that disc is instant.
import { barcodeAlt } from './catalogue.js';
import { matchMovie } from './tmdb.js';

const env = (k) => process.env[k] || '';
const CACHE_HIT_DAYS = 90, CACHE_MISS_DAYS = 7;
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
  }
];

// Asks providers in turn; remembers answers (and misses) so a disc is looked up once.
export async function lookupProduct(db, rawCode, { fetchImpl = fetch, force = false } = {}) {
  const code = String(rawCode).replace(/\D/g, '');
  const codes = [...new Set([code, barcodeAlt(code)])];
  if (!force) {
    const row = db.prepare('SELECT data, fetched_at FROM barcode_cache WHERE code IN (' + codes.map(() => '?').join(',') + ') ORDER BY fetched_at DESC LIMIT 1').get(...codes);
    if (row) {
      const data = JSON.parse(row.data);
      const ttl = (data.product ? CACHE_HIT_DAYS : CACHE_MISS_DAYS) * 864e5;
      if (Date.now() - row.fetched_at < ttl) return { ...data, cached: true };
    }
  }
  let product = null;
  const errors = [];
  for (const p of PROVIDERS) {
    if (!p.enabled()) continue;
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
  return { ...data, cached: false };
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
  /\b(with|starring|stars|featuring)\b.*$/gi
];
const LABEL_WORDS = /\b(the criterion collection|criterion collection|criterion|arrow|eureka|kino|shout|masters of cinema|arrow video|arrow academy|arrow films|studio ?canal|warner (bros\.?|brothers|home video|archive)|sony pictures( home entertainment)?|columbia tristar|20th century fox|twentieth century fox|walt disney|buena vista|universal (pictures|studios)|paramount( pictures)?|kino lorber|shout! factory|scream factory|vinegar syndrome|second sight|indicator|powerhouse films|bfi|eureka( entertainment)?|artificial eye|curzon|optimum( releasing| home entertainment)?|momentum pictures|entertainment in video|tartan( video)?|anchor bay|lions ?gate|network|88 films|radiance films|severin|dogwoof|fabulous films|signal one|metrodome|mgm|hbo|bbc)\b/gi;

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

const tidy = (s) => s.replace(/\s+/g, ' ').replace(/[\s\-–—:,;·|/]+$/g, '').replace(/^[\s\-–—:,;·|/]+/g, '').trim();
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
export async function suggestFromBarcode(db, tmdb, code, { fetchImpl = fetch, force = false } = {}) {
  const looked = await lookupProduct(db, code, { fetchImpl, force });
  if (looked.errors?.length) console.warn(`barcode ${code}: ${looked.errors.join('; ')}`);
  return suggestFromProduct(db, tmdb, code, looked.product, { errors: looked.errors, cached: looked.cached });
}

// A product the phone fetched itself (each phone has its own daily allowance with the barcode
// services, where a server's shared address runs out). Cleaned, remembered, then treated like ours.
export function acceptClientProduct(db, code, raw) {
  if (!raw || typeof raw !== 'object') return null;
  const str = (x, n) => (typeof x === 'string' ? x.trim().slice(0, n) : '');
  const product = {
    source: ['upcitemdb', 'openproductsfacts', 'upcdatabase'].includes(raw.source) ? raw.source : 'client',
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
