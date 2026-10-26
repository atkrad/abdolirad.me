# Charts

`nix run .#charts` finds every `*.vl.json` under the Hugo content directories and writes an SVG next to it, then a 2x PNG. Language comes from the content directory (`content/en` or `content/fa`), not from the filename.

```sh
nix run .#charts
nix run .#charts -- --check
nix run .#charts -- --path content/en/articles/example
```

Shared style lives in `charts/theme.json`. Specs may override it. Keep `data.url` as a path relative to the spec. The renderer rejects `..`, absolute paths, and remote URLs.

Commit the spec, CSV, SVG, and PNG. `npm run build` does not re-render charts. On Cloudflare it only checks that each content SVG has a PNG companion. Inside `nix develop`, `npm run test:charts` compares a fresh render with the committed files.

The CLI is `vl-convert` 1.9.0, built in `charts/nix/vl-convert.nix`. Text uses Vazirmatn from Nixpkgs. Each SVG embeds a font subset as `Vazirmatn Embedded` so the chart keeps that face when shown as an image. PNG conversion maps that family back to the TTF files in `CHARTS_FONT_DIR`, because `svg2png` does not paint the embedded WOFF2 data. Vazirmatn is SIL OFL 1.1; see `charts/FONT-LICENSE.txt`.

Specs under `content/fa` use Persian digits on pure numeric labels. Specs under `content/en` keep ASCII digits.

Browsers ignore bidi isolates inside an SVG used as an `<img>`. The renderer therefore splits mixed labels, measures each run with `hb-shape`, and places them with explicit `x` values.

Hugo treats an SVG as a chart when the page bundle also has the matching `.vl.json`. Those pages load medium-zoom. Keep SVG in article Markdown. Use the PNG URL for publishers that cannot proxy SVG.
