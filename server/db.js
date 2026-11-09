import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// Each entry runs once, in order. Never edit a shipped migration; append a new one.
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','mod','admin')),
    bio TEXT NOT NULL DEFAULT '',
    public_collection INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires INTEGER NOT NULL
  );
  CREATE TABLE people (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
  );
  CREATE TABLE films (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    original_title TEXT NOT NULL DEFAULT '',
    year INTEGER,
    country TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT '',
    runtime INTEGER,
    aspect TEXT NOT NULL DEFAULT '',
    synopsis TEXT NOT NULL DEFAULT '',
    tmdb_id INTEGER UNIQUE,
    palette TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE film_directors (
    film_id INTEGER NOT NULL REFERENCES films(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (film_id, person_id)
  );
  CREATE TABLE labels (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    country TEXT NOT NULL DEFAULT '',
    website TEXT NOT NULL DEFAULT '',
    about TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE images (
    id INTEGER PRIMARY KEY,
    edition_id INTEGER NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    file TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'front' CHECK (kind IN ('front','back','spine','disc','other')),
    w INTEGER, h INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE editions (
    id INTEGER PRIMARY KEY,
    film_id INTEGER NOT NULL REFERENCES films(id),
    label_id INTEGER REFERENCES labels(id),
    cat_no TEXT NOT NULL DEFAULT '',
    spine_no INTEGER,
    region TEXT NOT NULL DEFAULT '',
    standard TEXT NOT NULL DEFAULT '',
    anamorphic INTEGER,
    release_year INTEGER,
    discs INTEGER NOT NULL DEFAULT 1,
    disc_type TEXT NOT NULL DEFAULT '',
    packaging TEXT NOT NULL DEFAULT '',
    barcode TEXT NOT NULL DEFAULT '',
    oop INTEGER NOT NULL DEFAULT 0,
    audio TEXT NOT NULL DEFAULT '',
    subtitles TEXT NOT NULL DEFAULT '',
    extras TEXT NOT NULL DEFAULT '[]',
    notes TEXT NOT NULL DEFAULT '',
    cover_image_id INTEGER REFERENCES images(id) ON DELETE SET NULL,
    merged_into INTEGER REFERENCES editions(id),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX editions_film ON editions(film_id);
  CREATE INDEX editions_label ON editions(label_id, spine_no);
  CREATE INDEX editions_barcode ON editions(barcode);
  CREATE INDEX images_edition ON images(edition_id);
  CREATE TABLE submissions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (kind IN ('edition','edition_edit','film_edit','label_edit')),
    target_id INTEGER,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    note TEXT NOT NULL DEFAULT '',
    result_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_at TEXT
  );
  CREATE INDEX submissions_status ON submissions(status, created_at);
  CREATE TABLE revisions (
    id INTEGER PRIMARY KEY,
    entity TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    submission_id INTEGER,
    summary TEXT NOT NULL DEFAULT '',
    before TEXT NOT NULL DEFAULT '{}',
    after TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX revisions_entity ON revisions(entity, entity_id);
  CREATE TABLE copies (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    edition_id INTEGER NOT NULL REFERENCES editions(id),
    disc_cond TEXT NOT NULL DEFAULT '',
    case_cond TEXT NOT NULL DEFAULT '',
    price REAL,
    acquired TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX copies_user ON copies(user_id);
  CREATE INDEX copies_edition ON copies(edition_id);
  CREATE TABLE wants (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    edition_id INTEGER NOT NULL REFERENCES editions(id),
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, edition_id)
  );
  CREATE INDEX wants_edition ON wants(edition_id);
  CREATE TABLE reviews (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    edition_id INTEGER NOT NULL REFERENCES editions(id),
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    body TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, edition_id)
  );
  CREATE TABLE lists (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    public INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE list_items (
    list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    edition_id INTEGER NOT NULL REFERENCES editions(id),
    position INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (list_id, edition_id)
  );
  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    link TEXT NOT NULL DEFAULT '',
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX notifications_user ON notifications(user_id, read);
  CREATE VIRTUAL TABLE search_index USING fts5(edition_id UNINDEXED, body, tokenize='trigram');
  `,
  // 2: the social layer. Film-level diary entries replace edition reviews; follows, watchlist, likes,
  // streaming connections and imports; richer profiles.
  `
  ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
  ALTER TABLE users ADD COLUMN favourites TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE users ADD COLUMN public_diary INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE users ADD COLUMN prompt_reviews INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'system';

  CREATE TABLE follows (
    follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followed_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (follower_id, followed_id)
  );
  CREATE INDEX follows_followed ON follows(followed_id);

  CREATE TABLE watches (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    film_id INTEGER NOT NULL REFERENCES films(id),
    watched_on TEXT NOT NULL DEFAULT '',
    via TEXT NOT NULL DEFAULT '' CHECK (via IN ('', 'dvd', 'netflix', 'prime', 'disney', 'apple', 'mubi', 'bfi', 'cinema', 'tv', 'other')),
    edition_id INTEGER REFERENCES editions(id),
    copy_id INTEGER REFERENCES copies(id) ON DELETE SET NULL,
    rewatch INTEGER NOT NULL DEFAULT 0,
    rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 10),
    liked INTEGER NOT NULL DEFAULT 0,
    review TEXT NOT NULL DEFAULT '',
    spoilers INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'manual',
    prompt_state TEXT NOT NULL DEFAULT 'none' CHECK (prompt_state IN ('none', 'pending', 'done', 'dismissed')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX watches_user ON watches(user_id, watched_on);
  CREATE INDEX watches_film ON watches(film_id);
  CREATE INDEX watches_edition ON watches(edition_id);
  CREATE INDEX watches_prompt ON watches(user_id, prompt_state);

  CREATE TABLE review_likes (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    watch_id INTEGER NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, watch_id)
  );
  CREATE TABLE likes (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    film_id INTEGER NOT NULL REFERENCES films(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, film_id)
  );
  CREATE TABLE watchlist (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    film_id INTEGER NOT NULL REFERENCES films(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, film_id)
  );
  CREATE TABLE streaming_accounts (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    service TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    access_token TEXT NOT NULL DEFAULT '',
    refresh_token TEXT NOT NULL DEFAULT '',
    token_expires INTEGER,
    last_sync_at TEXT,
    connected_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, service)
  );
  CREATE TABLE watch_imports (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    service TEXT NOT NULL,
    rows INTEGER NOT NULL DEFAULT 0,
    logged INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE VIRTUAL TABLE film_index USING fts5(film_id UNINDEXED, body, tokenize='trigram');
  INSERT INTO film_index (film_id, body)
    SELECT f.id, f.title || ' ' || f.original_title || ' ' || coalesce((SELECT group_concat(p.name, ' ') FROM film_directors fd JOIN people p ON p.id = fd.person_id WHERE fd.film_id = f.id), '')
    FROM films f;

  INSERT INTO watches (user_id, film_id, watched_on, via, edition_id, rating, review, created_at, updated_at)
    SELECT r.user_id, e.film_id, substr(r.created_at, 1, 10), 'dvd', r.edition_id, r.rating * 2, r.body, r.created_at, r.updated_at
    FROM reviews r JOIN editions e ON e.id = r.edition_id;
  DROP TABLE reviews;
  `,
  // Third-party sign-in (Google, Apple). An account made through a provider has pass = '' until it sets one.
  `
  CREATE TABLE identities (
    provider TEXT NOT NULL,
    subject TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (provider, subject)
  );
  CREATE INDEX identities_user ON identities(user_id);
  CREATE TABLE login_tokens (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL DEFAULT 'login',
    expires INTEGER NOT NULL
  );
  CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
  // Generated cover palettes moved to a curated film-stock set; stored palettes fall back to the generator on read.
  `
  UPDATE films SET palette = NULL;
  `,
  // Real artwork and barcode lookups: film posters (from TMDB), edition format and provenance, a cache of provider answers.
  `
  ALTER TABLE films ADD COLUMN poster TEXT NOT NULL DEFAULT '';
  ALTER TABLE films ADD COLUMN poster_path TEXT NOT NULL DEFAULT '';
  ALTER TABLE editions ADD COLUMN format TEXT NOT NULL DEFAULT '';
  ALTER TABLE editions ADD COLUMN provenance TEXT NOT NULL DEFAULT '';
  CREATE TABLE barcode_cache (
    code TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );
  `
];

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  const { user_version: v } = db.prepare('PRAGMA user_version').get();
  for (let i = v; i < MIGRATIONS.length; i++) {
    tx(db, () => {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    });
  }
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// node:sqlite rejects undefined and booleans as bind values.
export const v = (x) => (x === undefined ? null : typeof x === 'boolean' ? (x ? 1 : 0) : x);
