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

Article charts are Vega-Lite files that end in `.vl.json`. Put the spec in the article's page bundle. From the repository root:

```sh
nix run .#charts
nix run .#charts -- --check
nix run .#charts -- --path content/en/articles/go-1-28-http2-parking-memory
nix run .#charts -- --help
```

The command reads `contentDir` from `hugo.yaml` and finds every `.vl.json` under those trees. `01-rss-scaling.en.vl.json` becomes `01-rss-scaling.en.svg` in the same directory. The language tag is part of the filename. You do not register a chart, a language, or an article.

Shared size, color, and font defaults live in `charts/theme.json`. A value in the spec wins over the theme. Keep `data.url` as a normal local path, relative to the spec, such as `data/chart-data.csv`. The renderer reads that file itself. It rejects `..`, absolute paths, and remote URLs.

Commit the spec, its data file, and the SVG. Hugo only copies the SVG during the site build. Chart rendering is not part of `npm run build` or the Cloudflare deploy.

`--check` rebuilds into a temporary directory and compares the bytes with the committed SVGs. It does not write into the tree. A malformed spec or a missing data file stops the command before it replaces any SVG.

The renderer is the `vl-convert` 1.9.0 CLI, pinned in `charts/nix/vl-convert.nix`. Nixpkgs has the Python binding and not this command, so the flake builds the CLI and pins the same source and v8 library as that Python package. Text is measured with Vazirmatn from Nixpkgs. Each SVG then embeds a subset of those same files under the family name `Vazirmatn Embedded`, so the chart still uses Vazirmatn when it is shown as an image on a machine that does not have the font installed. Vazirmatn is SIL Open Font License 1.1. The copyright notice is in the SVG, and `charts/FONT-LICENSE.txt` records the same notice.

A spec named `*.fa.vl.json` gets Persian numerals on labels that are only numbers: digits `۰۱۲۳۴۵۶۷۸۹`, decimal separator `٫`, and thousands separator `٬`. Values in the data stay numeric. Identifiers such as `Go 1.28` and `HTTP/2` are left alone. Other filenames keep ASCII numerals.

Chrome and Firefox do not apply bidi isolate characters inside an SVG used as an `<img>`. An Arabic comma between two Latin phrases then lands on the wrong side of those phrases. The renderer splits mixed labels into directional runs, measures each run with `hb-shape`, and places the runs in reading order with their own `<tspan>` and an explicit `x`. The accessible name on the text element stays the logical string. Color names such as `series` and `run` in a spec are resolved from `charts/theme.json` before rendering. The same inputs and the same pinned renderer produce the same SVG bytes on this machine.

Hugo turns an image into a chart figure only when the page bundle also has the matching `.vl.json`. The figure keeps one SVG and adds a "View larger" link. With JavaScript, that link opens a dialog that can be panned, zoomed, closed from the keyboard, and dismissed with the Back button. Without JavaScript, the link opens the SVG itself. The dialog script lives in the shared footer, which Hugo caches across pages, and it returns immediately when a page has no chart link. Other images are unchanged.

## Deployment

`npm run build` writes the site. `npm run check` is a dry run. `npm run deploy` publishes the build.

Cloudflare builds the site and deploys the Worker. A branch preview gets its own URL.

## URLs

- English: <https://abdolirad.me/>
- Persian: <https://abdolirad.ir/>
- Local English: <http://localhost:8787/>
- Local Persian: <http://fa.localhost:8787/>
- Preview: the `*.workers.dev` URL Cloudflare generates for a branch
