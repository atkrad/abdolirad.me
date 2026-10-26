import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverContentSvgs, prepareSvgForRaster, selectSvgs } from "./png.mjs";
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

test("raster preparation rewrites embedded fonts without dropping other style rules", () => {
  const svg = [
    "<svg>",
    '<defs><style type="text/css"><![CDATA[',
    '@font-face{font-family:"Vazirmatn Embedded";src:url("data:font/woff2;base64,AA==") format("woff2");}',
    ".mark{opacity:0.9}",
    "]]></style></defs>",
    '<text font-family="Vazirmatn Embedded">Hi</text>',
    "</svg>",
  ].join("");
  const prepared = prepareSvgForRaster(svg);
  assert.equal(prepared.includes("Vazirmatn Embedded"), false);
  assert.match(prepared, /font-family="Vazirmatn"/);
  assert.equal(prepared.includes("data:font/woff2"), false);
  assert.match(prepared, /\.mark\{opacity:0\.9\}/);
  assert.equal(prepareSvgForRaster('<svg><text font-family="Other">x</text></svg>'), '<svg><text font-family="Other">x</text></svg>');
});
