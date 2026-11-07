# Spine

A register of DVD editions, kept by collectors. It's like Discogs for DVDs, without the marketplace.

Spine treats the **edition** as the thing you collect: the label, spine number, region, video standard, transfer and supplements. Films group editions together, labels show their numbered run with the gaps, and every change to the catalogue is moderated and kept in history.

## What's in it

- **Catalogue:** films, editions, labels and directors. Search tolerates typos and also finds editions by barcode (UPC/EAN).
- **Adding editions:** scan a barcode with the phone camera or type it. Spine checks whether the edition already exists, then lets you pick the film (from the register or from TMDB) and enter the details printed on the case.
- **Moderation:** new members' additions and edits wait in a queue. After 10 approved contributions a member's edits go live straight away. Every change is stored with a before/after diff. Moderators can merge duplicate editions, which moves everyone's copies, wants, reviews, lists and photos.
- **Collection:** each copy you own has its own disc and case grade, price paid, date, tags and notes. View it as a shelf of spines, as covers, or as a table, with breakdowns by region, decade, label and condition. You can import and export it as CSV.
- **Wantlist:** you're notified when a new edition of a film you own or want is added.
- **Community:** ratings and reviews, ordered lists with notes, public profiles, and a private-collection setting.
- **Photos:** members upload their own scans of cases and discs. Until a scan exists, Spine draws an original placeholder cover.
- **Accounts:** sign-up and sign-in, password change, GDPR data export (JSON) and account deletion. The first account to sign up becomes the admin.

## Run it

You need **Node.js 22.13 or newer**. There are no npm dependencies: the server uses Node's built-in `http` and `node:sqlite`.

```sh
npm run seed     # optional: demo catalogue + two demo accounts
npm start        # http://localhost:3000
```

The demo sign-ins are `demo` / `spine-demo` (admin) and `cinephile` / `spine-demo` (member). The demo films are real, but the labels, catalogue numbers and barcodes are invented. **Do not seed a production database.**

To run the tests:

```sh
npm test         # API tests against a throwaway database
```

### Settings (environment variables)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | Where `spine.db` and `uploads/` live. Back this folder up. |
| `TMDB_API_KEY` | unset | Turns on film lookup when adding editions. Accepts a TMDB v3 key or a v4 read token. Without it, members type film details by hand. |
| `SECURE_COOKIES` | unset | Set to `1` when serving over HTTPS. |

## Deploy

Spine is a single process with a SQLite file, so any host that runs Node or Docker and gives you a persistent disk will work (Fly.io, Railway, Render, a small VPS).

```sh
docker build -t spine .
docker run -p 3000:3000 -v spine-data:/data -e TMDB_API_KEY=... spine
```

Put it behind HTTPS. Camera barcode scanning only works on HTTPS or on `localhost`. Back up `DATA_DIR` regularly; copying `spine.db` while the server is running is safe because Spine uses WAL mode.

## How it's built

```
server/
  index.js          starts the HTTP server
  app.js            router, static files, security headers, CSRF and error handling
  db.js             schema and migrations (append new ones to MIGRATIONS)
  auth.js           scrypt passwords and cookie sessions
  catalogue.js      validation, search, applying moderated submissions, merging
  routes/           auth, catalogue, submissions, collection, social, account
  seed.js           demo data
public/
  index.html        app shell (the server adds page titles and meta tags for /release pages)
  css/app.css       all styles
  js/app.js         client router and header
  js/views/         one module per page
test/api.test.js    end-to-end API tests
```

Every catalogue change goes through `submissions`. Trusted members' submissions are applied immediately; everyone else's wait for a moderator. Applying a submission writes a row to `revisions`, which is how each edition's history page is built.

## Before launch

- Have the privacy policy and terms (`public/js/views/pages.js`) reviewed for your jurisdiction.
- Add email delivery (password reset, notification digests). Spine has in-app notifications only, and no password reset by email yet.
- Consider an object store (S3 or R2) for `uploads/` if photos grow large, and a CDN in front.
- The camera scanner uses the browser's BarcodeDetector where it exists (Chrome on Android). Elsewhere, including iPhone Safari, it falls back to ZXing loaded from unpkg. Typing the barcode always works.
