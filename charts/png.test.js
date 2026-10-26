import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  discoverContentSvgs,
  rasterPageHtml,
  selectSvgs,
  svgPixelSize,
} from "./png.mjs";
import { contentRoots } from "./render.mjs";

test("discovery stays inside content roots and accepts svg or vl.json paths", () => {
  const root = mkdtempSync(path.join(tmpdir(), "png-discover-"));
  try {
    writeFileSync(
      path.join(root, "hugo.yaml"),
      "languages:\n  en:\n    contentDir: content/en\n  fa:\n    contentDir: content/fa\n",
    );
    const english = path.join(root, "content", "en", "articles", "notes", "chart.svg");
    const persian = path.join(root, "content", "fa", "articles", "notes", "chart.svg");
    const nested = path.join(root, "content", "en", "articles", "notes", "deep", "extra.svg");
    const spec = path.join(root, "content", "en", "articles", "notes", "chart.vl.json");
    mkdirSync(path.dirname(english), { recursive: true });
    mkdirSync(path.dirname(persian), { recursive: true });
    mkdirSync(path.dirname(nested), { recursive: true });
    writeFileSync(english, "<svg></svg>\n");
    writeFileSync(persian, "<svg></svg>\n");
    writeFileSync(nested, "<svg></svg>\n");
    writeFileSync(spec, "{}\n");
    mkdirSync(path.join(root, "themes", "icons"), { recursive: true });
    writeFileSync(path.join(root, "themes", "icons", "logo.svg"), "<svg></svg>\n");

    const found = discoverContentSvgs(contentRoots(root));
    assert.deepEqual(found, [nested, english, persian].sort());
    assert.deepEqual(selectSvgs(found, path.join(root, "content", "fa")), [persian]);
    assert.deepEqual(selectSvgs(found, spec), [english]);
    assert.throws(
      () => selectSvgs(found, path.join(root, "themes", "icons", "logo.svg")),
      /outside the Hugo content roots/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("svg size parsing and raster page keep a 2x <img> layout", () => {
  assert.deepEqual(svgPixelSize('<svg width="699" height="482"></svg>'), { width: 699, height: 482 });
  assert.throws(() => svgPixelSize("<svg></svg>"), /width and height/);
  const html = rasterPageHtml("chart.svg", 1398, 964);
  assert.match(html, /src="chart\.svg"/);
  assert.match(html, /width:1398px/);
  assert.match(html, /height:964px/);
  assert.match(html, /<img src="chart\.svg" width="1398" height="964"/);
});
