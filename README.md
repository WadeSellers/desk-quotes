# Desk Quotes

An always-on motivational slideshow for an unused tablet. Editorial-minimalist design, hand-curated quotes from forty thinkers, scientists, and writers, set-and-forget on any vertical Android tablet.

Live: `https://wadesellers.github.io/desk-quotes/`

---

## What it is

A static web app — pure HTML/CSS/JS, no framework, no backend. It crossfades through forty curated quotes, each paired with a B&W portrait of the speaker. Designed for portrait orientation on a Samsung Galaxy tablet, but works anywhere a modern browser does.

- 45-second slide cycle, 1.5-second crossfade
- Subtle Ken Burns zoom on photos to prevent OLED burn-in
- Random shuffle within each pass — no repeats until everything has been shown
- Service worker caches everything on first visit, so the slideshow keeps running even if Wi-Fi drops
- Self-hosted EB Garamond, no external font CDN dependency

## Tablet setup (one-time, ~5 minutes)

1. Plug the tablet in and mount it vertically. Keep it plugged in.
2. Enable Developer Options:
   **Settings → About tablet → Software information → tap "Build number" 7 times.**
3. Turn on stay-awake-while-charging:
   **Settings → Developer Options → Stay awake → ON.**
4. (Defense in depth) Set screen timeout high:
   **Settings → Display → Screen timeout → max value (often "10 minutes" or longer).**
5. Lock orientation:
   **Settings → Display → Auto-rotate → off, set portrait.**
6. Open Chrome and go to `https://wadesellers.github.io/desk-quotes/`.
7. Wait ~10 seconds for the first photo to load and the slideshow to start.
8. Tap the **⋮** menu in Chrome → **"Add to Home Screen"** → **"Install"**.
9. Close Chrome, open the new "Desk Quotes" icon from the home screen — it launches fullscreen.
10. Done. It runs forever as long as the tablet has power.

If the screen ever goes blank, just unlock the tablet and re-open the home-screen icon; slideshow resumes immediately.

## Adding or editing quotes

Edit `quotes.json`. Each entry needs:

```json
{
  "quote": "The quote itself.",
  "name": "Person Name",
  "dates": "1900–1980",
  "role": "Their Role or Title",
  "category": "tech | science | philosophy",
  "photoSlug": "lastname",
  "wikiTitle": "Wikipedia_Article_Name_With_Underscores",
  "source": "Optional source citation"
}
```

After editing, fetch any new photos:

```bash
./scripts/fetch-photos.sh
```

This skips photos already on disk, so it's safe to re-run.

Then commit and push — GitHub Pages picks up the change in ~1 minute.

## Local development

The app is fully static. To preview:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Use Chrome DevTools' device emulation toolbar to preview at portrait tablet dimensions (~800×1280 or ~1200×1920).

## Project structure

```
index.html              Entry point
styles.css              Design system, layout, transitions
slideshow.js            Cycle engine, shuffling, image preload, anti-burn-in
quotes.json             Hand-curated quote data
manifest.json           PWA install metadata
service-worker.js       Offline cache (app shell + photos)
assets/
  fonts/                Self-hosted EB Garamond (woff2)
  icons/                PWA install icons
  photos/               Portrait photos (auto-fetched from Wikipedia)
scripts/
  fetch-photos.sh       Re-fetch missing photos from Wikipedia
  make-icons.py         Regenerate PWA icons
```

## Photo credits

All photos are sourced from Wikimedia Commons via the Wikipedia API. Most are public domain or Creative Commons licensed. See `assets/photos/CREDITS.md` for per-image source links.

## Tweaking the design

- **Slide pacing** — `slideshow.js`, `CONFIG.slideDurationMs` (default `45_000`).
- **Crossfade duration** — `slideshow.js`, `CONFIG.crossfadeMs` and CSS `--crossfade`.
- **Ken Burns zoom strength** — CSS `.slide.is-active .photo__img { transform: scale(1.06); }`.
- **Color palette** — CSS `:root` custom properties at the top of `styles.css`.
- **Quote/photo split ratio** — CSS `.slide { grid-template-rows: 58fr 42fr; }`.
