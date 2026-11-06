# GrabList

A minimalist, mobile-first grocery list and price-comparison app.

## Status

Phase 1 prototype is complete locally; the source files still need to be imported into this repository before the Cloudflare deployment can serve the app. Live retailer prices and automatic store optimization are not yet connected.

## Cloudflare Pages configuration

- Framework preset: **None**
- Production branch: **main**
- Build command: **(leave empty)**
- Build output directory: **/** (repository root)

The prototype is a static Progressive Web App: `index.html`, `styles.css`, `app.js`, `manifest.webmanifest`, `sw.js`, and `icons/`. There is no npm build.

## Development

The app stores list data locally on the device, supports swipe-to-complete and swipe-to-delete, grouping by store, department inference, manual prices, and JSON backup. Any displayed sample prices are fictional, not live store prices.

## Deployment

Connect this GitHub repository to a new Cloudflare Pages project. Each push to `main` will automatically trigger a deployment after the Cloudflare integration is configured.

The project is independent of Tales Without End.
