# Spine

Films, the discs they came on, and the people who keep them.

Spine is a film diary in the Letterboxd mould, joined to a Discogs-style register of DVD editions. You log what you watch (and whether it was your own disc, a stream or a cinema), rate and review it, follow friends, keep a shelf of the exact editions you own, and hunt for the ones you don't. No marketplace yet; that comes later.

## What's in it

**Diary and reviews**
- Log a film in a sheet: date, where you watched it (your own DVD, picked from your shelf; Netflix; Prime Video; Disney+; Apple TV; MUBI; cinema; TV), half-star rating, like, rewatch, review, spoiler flag.
- Diary by month and year, films grid, reviews with permalinks and likes, watchlist, liked films, four favourite films on your profile.
- Reviews written on a specific disc appear on that edition's page as well as the film's.

**Friends**
- Follow people. The Friends tab shows their activity (watches, reviews, discs added, lists), who you follow, who follows you, and suggestions ranked by the films and discs you have in common.
- Film pages show which friends have watched it, how they rated it, which of them own it on disc and which edition. Edition pages show which friends have that disc or want it.
- Public profiles with a collection, diary, watchlist and lists; each can be made private in settings.
- Compare two members: taste match, films you've both seen with both ratings, films they've seen that you haven't, discs on their shelf that aren't on yours.

**Letterboxd import**
- Upload the export zip from letterboxd.com → Settings → Data and Spine brings over the diary (dates, half-star ratings, rewatches), reviews, likes and watchlist, matching films to the register and adding the ones it doesn't know by title and year. Importing twice adds nothing.

**Streaming services**
- Netflix, Prime Video and the rest offer no API for viewing history, so Spine takes the history file they let you download (Netflix: *Account → Viewing activity → Download all*; Amazon: *Request your data*). It skips TV episodes, trailers and autoplayed previews, matches titles to films on the register (with fuzzy matching and a review step), and logs each viewing with the right date.
- Trakt is a real API. Connect it once (set `TRAKT_CLIENT_ID` and `TRAKT_CLIENT_SECRET`) and Spine pulls new movie history every time you open the app. Trakt's free scrobbler extensions record what you play on Netflix, Prime Video, Disney+ and others.
- Anything logged from a service waits for a rating: the next time you open Spine, a sheet asks you to rate or review it, skip it, or say you didn't watch it.

**The register**
- Films, editions, labels and directors. Search tolerates typos and finds editions by barcode.
- Scan to shelf: point your phone at the barcode on the back of a case and the exact edition lands on your shelf; keep scanning through a stack. Works in every browser; a photo of the barcode or typing it also works.
- Adding and editing editions goes through moderation for new members; after ten approved contributions edits go live immediately. Every change is kept with a before/after diff. Moderators can merge duplicates.
- Collection with disc and case grades, price paid, tags and notes; shelf, cover and table views; CSV import and export.

**App**
- An Apple-style interface: system type, light and dark (follows the device or your choice), translucent bars, a bottom tab bar on phones.
- Scan a barcode the register has never seen and Spine asks the product-barcode services and TMDB what it is: the film, its real poster and credits, the label, format and region, and the retailer's cover image, ready to add with one tap. Every confirmed disc joins the shared register, so the next scan is instant.
- Sign in with Google or Apple as well as a password; provider accounts can add a password later, and a member can link or unlink providers in Settings.
- Installable on iPhone from Safari's share sheet ("Add to Home Screen"); the app shell works offline.
- Accounts, password change, data export (JSON) and account deletion. The first account to sign up becomes the admin.

## Run it

You need **Node.js 22.13 or newer**. There are no npm dependencies.

```sh
npm run seed     # optional: demo catalogue and four demo members who follow each other
npm start        # http://localhost:3000
npm test         # API, scanner and import tests against throwaway databases
```

Demo sign-ins (password `spine-demo`): `demo` (admin, has a Netflix import waiting for ratings), `cinephile`, `nour`, `tomas`. The demo films are real; labels, catalogue numbers and barcodes are invented. **Don't seed a production database.**

### Settings (environment variables)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | Where `spine.db` and `uploads/` live. Back this folder up. |
| `TMDB_API_KEY` | unset | Film details, credits and real posters from The Movie Database (free: themoviedb.org → Settings → API; a v3 key or v4 read token). Also used to identify scanned discs. |
| `TRAKT_CLIENT_ID`, `TRAKT_CLIENT_SECRET` | unset | Turns on the Trakt connection. Create an app at trakt.tv/oauth/applications with redirect URI `https://your-host/api/streaming/trakt/callback`. |
| `SECURE_COOKIES` | unset | Set to `1` when serving over HTTPS. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | unset | Turns on "Sign in with Google". Make an OAuth client (type: Web application) at console.cloud.google.com → APIs & Services → Credentials, with authorised redirect URI `https://your-host/api/auth/oauth/google/callback`. |
| `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | unset | Turns on "Sign in with Apple" (needs the Apple Developer Program). `APPLE_CLIENT_ID` is a Services ID with Sign in with Apple enabled and return URL `https://your-host/api/auth/oauth/apple/callback`; the key is a Sign in with Apple private key, pasted as PEM (`\n` escapes are fine). |
| `UPCITEMDB_KEY` | unset | Barcode lookups use UPCitemdb's free trial endpoint (about 100 lookups a day per server) without a key; a paid key lifts the limit. `UPCDATABASE_KEY` adds UPCdatabase.org as a further source. |
| `PUBLIC_URL` | derived from the request | Set when the app sits behind a proxy that hides the public host, so provider redirect URIs are right. |

## Deploy

One Node process and a SQLite file. Any host with Node or Docker and a persistent disk works (Fly.io, Railway, Render, a small VPS).

```sh
docker build -t spine .
docker run -p 3000:3000 -v spine-data:/data -e SECURE_COOKIES=1 -e TMDB_API_KEY=... spine
```

Serve it over HTTPS: the camera scanner and the service worker need it, and iPhone home-screen installs expect it.

### Live instance (Railway)

The production copy runs on Railway from this repo's `main` branch:

- URL: **https://spine-production-88dc.up.railway.app**
- Project `friendly-alignment` → service `spine`, region US West. Auto-deploys on every push to `main` (Dockerfile build, `railway.json`).
- Persistent volume `spine-volume` mounted at `/data` (the SQLite file and uploaded images live there).
- Service variable `PORT=3000` pinned to match the public domain's target port. Railway otherwise injects its own `PORT`, and the domain would point at the wrong port.
- Railway rejects a `VOLUME` instruction in the Dockerfile, so the volume is attached in the dashboard instead, and the container runs as root so the mounted disk is writable.
- The first account to sign up becomes the admin.

## iPhone

A native shell lives in the separate `ios/Spine` Xcode project (WKWebView, camera permission, pull-to-refresh, app icon). It opens the live URL above by default and can be re-pointed from Settings → This iPhone. For a handful of people without the App Store, run it from Xcode onto each phone (free Apple ID; re-run every 7 days) or, with the Apple Developer Program, distribute it through TestFlight.

The web app also installs straight from Safari: Share → Add to Home Screen. It runs full-screen with the tab bar, remembers sign-in, and the camera scanner works.

## How it's built

```
server/
  index.js            starts the HTTP server
  app.js              router, static files, security headers, CSRF, error handling
  db.js               schema and migrations (append new ones to MIGRATIONS)
  auth.js             scrypt passwords and cookie sessions
  catalogue.js        validation, search, applying moderated submissions, merging, diary and film queries
  viewing.js          parsing Netflix/Prime history files and matching titles to films
  routes/
    auth.js           sign up, sign in, profile settings
    catalogue.js      home, films, editions, labels, people, images, TMDB lookup
    diary.js          watches, review prompts, likes, watchlist, a member's diary/reviews/films
    friends.js        follow, friends, activity feed, people search, compare
    streaming.js      service connections, history import, Trakt OAuth and sync
    submissions.js    moderation queue
    collection.js     shelf, wants, CSV import/export, profiles
    social.js         lists, notifications
    account.js        data export, deletion, admin
  seed.js             demo data
public/
  index.html          app shell; the server adds titles and meta tags for /film and /release pages
  css/app.css         the design system
  js/app.js           client router, header, review prompts
  js/ui.js            components: posters, stars, rating input, cards, sheets
  js/forms.js         the log sheet, prompt sheet, copy and edition forms
  js/scan.js          barcode scanning (BarcodeDetector, ZXing, built-in decoder)
  js/views/           one module per page
  sw.js               service worker
test/                 api.test.js, viewing.test.js, scan.test.js
```

Ratings are stored as 1–10 (half stars). A diary entry (`watches`) carries `via` (where it was watched) and, for `dvd`, the `copy_id` and `edition_id` it was watched on. Imported entries carry `source` (`import:netflix`, `trakt:<id>`) and a `prompt_state` that drives the "rate it?" sheet.

## Before launch

- Privacy policy and terms are placeholders; have them reviewed.
- Email isn't wired up (no password reset, no digests). Notifications are in-app only.
- Consider object storage for `uploads/` once photos grow, and a CDN in front.
- Trakt OAuth is implemented from the API docs but could not be exercised here (no network); test it once with real credentials.
