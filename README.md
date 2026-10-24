# abdolirad.me

Source code for The Other Branch, my bilingual personal blog built with Hugo and PaperMod and hosted on Cloudflare Workers.

## Development

The Nix shell provides Hugo, Go, and Node.js. With direnv, run `direnv allow` once.

```sh
nix develop
npm ci
npm run build
npm test
npm run dev
```

`npm test` reads `public/`, so build first. `npm run dev` serves that build.

## Charts

A chart is a Vega-Lite file named `*.vl.json` in the article bundle, next to its CSV. From the repository root:

```sh
nix run .#charts
nix run .#charts -- --check
```

`01-rss-scaling.en.vl.json` becomes `01-rss-scaling.en.svg` in the same directory. Commit the spec, the CSV, and the SVG. `npm run build` does not render charts. `--check` compares a fresh render with the committed SVG and does not write it.

A `*.fa.vl.json` spec prints Persian digits on labels that are only numbers. Other specs keep ASCII digits. `docs/charts.md` covers fonts, RTL text, and how a spec is found.

On the site, an SVG with a matching `.vl.json` can be enlarged with [medium-zoom](https://github.com/francoischalifour/medium-zoom). Other images are left alone.

## Deployment

`npm run build` writes the site. `npm run check` is a dry run. `npm run deploy` publishes the build.

Cloudflare builds the site and deploys the Worker. A branch preview gets its own URL.

## URLs

- English: <https://abdolirad.me/>
- Persian: <https://abdolirad.ir/>
- Local English: <http://localhost:8787/>
- Local Persian: <http://fa.localhost:8787/>
- Preview: the `*.workers.dev` URL Cloudflare generates for a branch
