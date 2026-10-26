# abdolirad.me

Source for The Other Branch, a bilingual personal blog built with Hugo and PaperMod and hosted on Cloudflare Workers.

## Development

The Nix shell provides Hugo, Go, and Node.js. With direnv, run `direnv allow` once.

```sh
nix develop
npm ci
npm run build
npm test
npm run dev
```

`npm test` reads `public/`, so build first. Cloudflare runs the same build. It does not render charts; it only checks that each content SVG has a committed PNG. `npm run dev` serves the build.

`npm run test:charts` needs `vl-convert`, `pyftsubset`, `hb-shape`, and `CHARTS_FONT_DIR` from the Nix shell:

```sh
nix develop -c npm run test:charts
```

GitHub Actions runs that on pull requests that change charts, specs, data, Nix files, or those tests.

## Charts

A chart is a `*.vl.json` file in an article bundle, next to its CSV. Language comes from `content/en` or `content/fa`.

```sh
nix run .#charts
nix run .#charts -- --check
```

`chart.vl.json` becomes `chart.svg` and `chart.png` in the same directory. Commit all four: spec, CSV, SVG, and PNG. See `docs/charts.md` for fonts, RTL text, and PNG details.

On the site, an SVG with a matching `.vl.json` can be enlarged with [medium-zoom](https://github.com/francoischalifour/medium-zoom). Keep SVG in Markdown. Use the PNG URL when a publisher cannot proxy SVG.

## Deployment

`npm run build` writes the site. `npm run check` is a dry run. `npm run deploy` publishes it. Cloudflare builds and deploys the Worker; branch previews get their own URL.

## URLs

- English: <https://abdolirad.me/>
- Persian: <https://abdolirad.ir/>
- Local English: <http://localhost:8787/>
- Local Persian: <http://fa.localhost:8787/>
- Preview: the `*.workers.dev` URL Cloudflare generates for a branch
