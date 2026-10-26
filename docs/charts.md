# Charts

`nix run .#charts` reads `contentDir` from `hugo.yaml` and renders every `*.vl.json` under those trees. Language comes from the content directory (`content/en`, `content/fa`), not from the filename. You do not register a chart, a language, or an article.

`nix run .#charts -- --path content/en/articles/go-1-28-http2-parking-memory` limits the run to one directory. `--help` lists the flags.

Shared size, color, and font defaults live in `charts/theme.json`. A value in the spec wins over the theme. Keep `data.url` as a path relative to the spec, such as `data/chart-data.csv`. The renderer reads that file itself and rejects `..`, absolute paths, and remote URLs. A bad spec or a missing data file stops the command before it replaces any SVG.

After each SVG is written, `charts/png.mjs` refreshes the matching PNG at 2x scale. The same command also discovers any other content SVG under the Hugo content roots, so a hand-authored SVG gets a PNG without a separate list. Theme icons and files outside those content directories are ignored.

`--check` renders into a temporary directory and compares the bytes with the committed SVGs and PNGs. `npm run test:charts`, inside `nix develop`, runs the same check and the font and numeral checks. `npm test` does not. Pull requests that change those inputs run `nix develop -c npm run test:charts` in GitHub Actions. The Cloudflare build does not render charts; it runs `node charts/png.mjs`, which verifies that every content SVG already has a committed PNG companion.

The renderer is the `vl-convert` 1.9.0 CLI, pinned in `charts/nix/vl-convert.nix`. Nixpkgs has the Python binding and not this command, so the flake builds the CLI and pins the same source and v8 library as that Python package. Text is measured with Vazirmatn from Nixpkgs. Each SVG then embeds a subset of those files under the family name `Vazirmatn Embedded`, so the chart still uses Vazirmatn when it is shown as an image. PNG conversion rewrites that family back to `Vazirmatn` and passes `--font-dir`, because `vl-convert svg2png` does not rasterize the embedded WOFF2 faces. Vazirmatn is SIL Open Font License 1.1. The copyright notice is in the SVG, and `charts/FONT-LICENSE.txt` records the same notice.

Persian digits are `۰۱۲۳۴۵۶۷۸۹`, with `٫` as the decimal separator and `٬` as the thousands separator. Values in the data stay numeric. Identifiers such as `Go 1.28` and `HTTP/2` are left alone. Specs under `content/fa` get Persian digits; specs under `content/en` keep ASCII digits.

Chrome and Firefox do not apply bidi isolate characters inside an SVG used as an `<img>`. An Arabic comma between two Latin phrases then lands on the wrong side of those phrases. The renderer splits mixed labels into directional runs, measures each run with `hb-shape`, and places the runs in reading order with their own `<tspan>` and an explicit `x`. The accessible name on the text element stays the logical string. Color names such as `series` and `run` are resolved from `charts/theme.json` before rendering. The same inputs and the same pinned renderer produce the same SVG bytes.

Hugo treats an SVG as a chart only when the page bundle has the matching `.vl.json`. That page loads `medium-zoom` from `assets/js/chart-zoom.js`, built with Hugo's `js.Build`. Clicking the image enlarges it. The blog keeps SVG in Markdown. PNG files are companions for external publishers that mishandle SVG.
