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

`npm test` reads `public/`, so build first. Cloudflare runs this command. It does not render charts. It does verify that every content SVG has a committed PNG companion. `npm run dev` serves the build.

`npm run test:charts` checks rendered SVG and PNG output. It needs `vl-convert`, `pyftsubset`, `hb-shape`, and `CHARTS_FONT_DIR`, which the Nix shell provides. Run it with `nix develop -c npm run test:charts`. GitHub Actions runs that command on pull requests that change the chart renderer, theme, specs, data, Nix files, or those tests.

## Charts

A chart is a Vega-Lite file named `*.vl.json` in the article bundle, next to its CSV. Language comes from the content directory (`content/en` or `content/fa`), not from the filename. From the repository root:

```sh
nix run .#charts
nix run .#charts -- --check
nix develop -c node charts/png.mjs
nix develop -c npm run test:charts
```

`01-rss-scaling.vl.json` becomes `01-rss-scaling.svg` and `01-rss-scaling.png` in the same directory. Commit the spec, the CSV, the SVG, and the PNG. `npm run build` runs `charts/png.mjs` before Hugo. Inside the Nix shell that refreshes PNGs; on Cloudflare it only checks that companions already exist. `--check` compares a fresh render with the committed SVG and PNG and does not write them.

Specs under `content/fa` print Persian digits on labels that are only numbers. Specs under `content/en` keep ASCII digits. `docs/charts.md` covers fonts, RTL text, PNG conversion, and how a spec is found.

On the site, an SVG with a matching `.vl.json` can be enlarged with [medium-zoom](https://github.com/francoischalifour/medium-zoom). Other images are left alone. Keep SVG in article Markdown. Use the PNG URL when an external publisher cannot proxy SVG.

## Deployment

`npm run build` writes the site. `npm run check` is a dry run. `npm run deploy` publishes the build.

Cloudflare builds the site and deploys the Worker. A branch preview gets its own URL.

## URLs

- English: <https://abdolirad.me/>
- Persian: <https://abdolirad.ir/>
- Local English: <http://localhost:8787/>
- Local Persian: <http://fa.localhost:8787/>
- Preview: the `*.workers.dev` URL Cloudflare generates for a branch
