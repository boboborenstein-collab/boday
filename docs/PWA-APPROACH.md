# The PWA Approach (how BoDay avoids Xcode entirely)

**PWA = Progressive Web App.** It's a normal website with a few extra pieces of
configuration that let an iPhone treat it like a real app: you open it in
Safari once, tap **Share → Add to Home Screen**, and from then on it launches
full-screen with its own icon — no browser bar, no App Store, no Xcode.

## Why we do it this way

| Native app (Xcode/Swift) | PWA |
|---|---|
| $99/year Apple Developer account, or re-sign the app every 7 days | Free forever |
| Build in Xcode, install via cable/TestFlight | Deploy to a URL, updates arrive instantly |
| Swift/SwiftUI | Plain web tech (React, or anything) |
| App Store review for every update | Just redeploy |

Tradeoffs to know about (iOS-specific):
- Push notifications **do work** on iOS 16.4+, but only after the app is added
  to the Home Screen (BoDay does this — it works).
- No background location / geofencing ("remind me when I arrive" is impossible).
- Storage can theoretically be evicted if the app is unused for months — use a
  synced backend (we use Supabase) so data isn't only on-device.

## The recipe (what BoDay actually does)

1. **Build a normal web app.** BoDay is React + TypeScript + Vite + Tailwind.
   Any stack works — the PWA part is a thin layer on top.

2. **Add a web app manifest** — a small JSON file declaring the app name,
   icons (192px and 512px PNGs), theme color, and `"display": "standalone"`
   (that's what hides the browser UI). With Vite the easiest path is the
   `vite-plugin-pwa` package, which generates the manifest **and** the service
   worker for you from a few lines of config in `vite.config.ts`.

3. **Add a service worker** — a script the browser installs that caches the
   app's files so it opens instantly and works offline. `vite-plugin-pwa`
   generates this automatically; you don't hand-write it.

4. **Add the iOS-specific meta tags** in `index.html` (Apple ignores parts of
   the manifest and wants these instead):
   ```html
   <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
   <meta name="apple-mobile-web-app-capable" content="yes" />
   <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
   <meta name="apple-mobile-web-app-title" content="AppName" />
   <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
   ```

5. **Deploy to a free HTTPS host.** BoDay uses Cloudflare Workers static
   assets (`npm run build && npx wrangler deploy`) — free tier, HTTPS
   included (HTTPS is required for PWAs). Cloudflare Pages, Netlify, or
   Vercel all work equally well.

6. **On the iPhone:** open the URL in Safari → Share → **Add to Home Screen**.
   Done. It now looks and behaves like an installed app.

7. **(Optional) Data + push, still free:** Supabase free tier for the database
   and auth; a tiny Cloudflare Worker on a cron for Web Push notifications.
   BoDay does both — see this repo for a working reference.

## Prompt to give an AI working on the other app

> Convert this project into a PWA the way BoDay does it: keep it a normal
> web app (React + Vite is fine), add `vite-plugin-pwa` with a manifest
> (name, 192/512 icons, `display: standalone`, theme color) and an
> auto-generated service worker, add the Apple meta tags to `index.html`
> (`apple-touch-icon`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-title`,
> `viewport-fit=cover`), and deploy it to a free HTTPS host (Cloudflare
> Workers/Pages, Netlify, or Vercel). I'll install it on my iPhone via
> Safari → Add to Home Screen. No Xcode, no native code, no paid developer
> account.
