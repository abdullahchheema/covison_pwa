# Covison Pocket

Covison Pocket is a private, single-user CRM for iPhone that works offline. It is a port of the web Covison CRM (the `web/` app in the main CRM repo).

- All data stays on the device, in IndexedDB.
- No server, no account, no analytics, no third-party scripts.
- It works in airplane mode once it has loaded one time.
- Install it from Safari to get a full-screen app with its own Home Screen icon.

Supporting docs:
- `ANALYSIS.md` explains what was ported or dropped and why, and documents the import field mapping.
- Stack: Vite + Preact + TypeScript + Dexie. The build is plain static files with relative paths.

## Requirements

- Node.js 20 or newer (built and tested on Node 24)

## Run locally

```bash
cd covison_pwa
npm install
npm run dev
```

Open the URL Vite prints. Notes on dev mode:
- Dev mode turns off the service worker.
- Dev mode removes the CSP meta tag, because the Vite dev server injects inline styles.

To try the real offline build, use preview mode:

```bash
npm run build
npm run preview
```

This serves `dist/` at http://localhost:4173.

To open it on your iPhone over Wi-Fi:

```bash
npx vite preview --host
```

Then visit `http://<your-pc-ip>:4173` in Safari on the phone.

> iOS only enables service workers and "Add to Home Screen" offline mode on **HTTPS** (or `localhost`). For real use, deploy it as described below. Both free hosts serve HTTPS.

## Build

```bash
npm run build
```

The build runs four steps:
1. `tsc --noEmit`: type check.
2. `scripts/check-safety.mjs`: fails the build if the source uses `eval`, `new Function`, `innerHTML`, `dangerouslySetInnerHTML`, `document.write` or remote fetches.
3. `vite build`: writes to `dist/`.
4. A small Vite plugin (`scripts/sw-plugin.ts`): writes `dist/sw.js` with a precache list of every file in `dist/`. The cache is versioned by a content hash.

`dist/` is a fully static site. Every URL in it is relative, so it works at a domain root or under a subpath such as `/covison/`.

App icons and iOS launch images are pre-rendered into `public/icons/` and `public/splash/` from the real Covison mark, `public/logo-mark.png` (copied from `web/public/logo-mark.png`). After changing the logo, re-render them:

```bash
npm run icons
```

## Tests

```bash
npx playwright install chromium
npm run build
npm test
```

The first command is a one-time download. The tests run headless Chromium with an iPhone 14 Pro Max viewport, against the built app served under `/covison/`.

| Test | What it checks |
|---|---|
| Security | The CSP meta tag is present. There are no inline scripts and no CSP violations. No request goes to any other host. |
| Service worker | Every built file is in the versioned cache. |
| Offline | Goes offline, reloads, deep-links, and creates a contact while offline. |
| Backup round-trip | Seeds 200+ records with unicode and hostile `<script>`/`<img onerror>` strings, then exports through the UI, erases, rejects a corrupted backup, and restores. Every table must be identical before and after. It also checks that no injected script ran and that `javascript:` URLs never reach an `href`. |
| Legacy import | Imports web-CRM CSV exports and checks the field mapping, tag creation, stage matching, ticket skipping, and de-duplication. |
| Launch | The static splash is shown first, then fades into the app. |
| Money | Checks the Home totals for "People owe you" and "You owe", the WhatsApp deep link format, recording a partial payment, and the won-on-credit receivable for a new lead. |

## Deploy for free

### Option A: Cloudflare Pages

1. Push this repo to GitHub.
2. In Cloudflare, go to **Workers & Pages → Create → Pages → Connect to Git**, then pick the repo.
3. Use these build settings:

   | Setting | Value |
   |---|---|
   | Framework preset | None |
   | Root directory | (leave empty) |
   | Build command | `npm install && npm run build` |
   | Build output directory | `dist` |

4. Deploy. You get `https://<project>.pages.dev`.

You can also skip Git and upload a local build from this folder:

```bash
npm run build
npx wrangler pages deploy dist --project-name covison-pocket
```

### Option B: GitHub Pages

1. The workflow is already included at `.github/workflows/pages.yml`.
2. In GitHub, go to **Settings → Pages → Source** and choose **GitHub Actions**.
3. Push. The site appears at `https://<user>.github.io/<repo>/`. The subpath works because all paths are relative.

> Privacy: the URL is public, but the page holds **no data**. Your data only ever lives in IndexedDB on your iPhone. Anyone else who opens the URL gets an empty app on their own device.

## Install on iPhone (iPhone 12 Pro Max, iOS 16.4+)

1. Open **Safari**. Other browsers on iOS can't install web apps with full offline support.
2. Go to your deployed URL, e.g. `https://covison-pocket.pages.dev`.
3. Wait for the dashboard to appear. This first load caches the whole app.
4. Tap the **Share** button (the square with an up arrow) in the toolbar.
5. Scroll down and tap **Add to Home Screen**.
6. Leave the name as **Covison** and tap **Add**.
7. Open **Covison** from the Home Screen. It runs full-screen with no browser bars, and works in airplane mode from now on.

### Important iOS notes

- **Back up regularly.** Go to **Settings → Export backup** and save the JSON to Files or iCloud Drive. The app reminds you when the last backup is more than 7 days old.
  - Safari can delete website data that hasn't been used for a long time. Data in an app installed to the Home Screen is kept much more reliably, and the app asks for persistent storage on first run.
- **Deleting the Home Screen icon deletes its data.** Export first.
- **Updates:** when a new version is deployed, the app shows a "A new version is ready" toast. Tap **Update**.

## Moving your data over from the web CRM

In the web CRM, export CSVs from the Contacts, Companies, Pipeline (deals) and Tasks pages.

For a full-fidelity move, export instead from the Supabase table editor:
- Export `contacts`, `companies`, `pipelines`, `pipeline_stages`, `deals`, `tasks`, `activities`, `tags`, `contact_tags`, `lead_types`, `projects`, `project_columns` and `project_todos`.
- Use CSV or JSON, and keep the table name as the file name.

Then in the app, go to **Settings → Import from existing CRM** and select all the files at once. The mapping is described in `ANALYSIS.md` §6.

## Project layout

```
covison_pwa/
  index.html             CSP + iOS meta tags, no inline script
  public/                manifest, logo-mark.png, icons, splash, boot.css, theme-init.js
  scripts/               icon renderer, SW plugin + template, safety check
  src/
    db/                  Dexie schema, repo (all writes), seed, backup, CSV, legacy import
    lib/                 router, hooks, format, sanitize, theme, pwa
    ui/                  kit (Screen, rows, sheets...), overlays, charts, drag, icons
    screens/             Dashboard, Contacts, Companies, Pipeline, Tasks, Projects, More, ...
    styles/              tokens (ported from web/), base, components, motion
  tests/                 Playwright end-to-end tests
  .github/workflows/     GitHub Pages deploy workflow
```
