import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertNoLanguageSuffixCollisions,
  discoverContentSvgs,
  isPngBuffer,
  pngPathFor,
  prepareSvgForRaster,
  selectSvgs,
} from "./png.mjs";
import { contentRoots } from "./render.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("content SVG discovery covers both languages and ignores non-content trees", () => {
  const root = mkdtempSync(path.join(tmpdir(), "png-discover-"));
  try {
    writeFileSync(
      path.join(root, "hugo.yaml"),
      "languages:\n  en:\n    contentDir: content/en\n  fa:\n    contentDir: content/fa\n",
    );
    const english = path.join(root, "content", "en", "articles", "notes", "chart.svg");
    const persian = path.join(root, "content", "fa", "articles", "notes", "chart.svg");
    const nested = path.join(root, "content", "en", "articles", "notes", "deep", "extra.svg");
    mkdirSync(path.dirname(english), { recursive: true });
    mkdirSync(path.dirname(persian), { recursive: true });
    mkdirSync(path.dirname(nested), { recursive: true });
    writeFileSync(english, "<svg></svg>\n");
    writeFileSync(persian, "<svg></svg>\n");
    writeFileSync(nested, "<svg></svg>\n");
    mkdirSync(path.join(root, "themes", "icons"), { recursive: true });
    mkdirSync(path.join(root, "static"), { recursive: true });
    writeFileSync(path.join(root, "themes", "icons", "logo.svg"), "<svg></svg>\n");
    writeFileSync(path.join(root, "static", "badge.svg"), "<svg></svg>\n");
    const found = discoverContentSvgs(contentRoots(root));
    assert.deepEqual(found, [nested, english, persian].sort());
    assert.throws(() => selectSvgs(found, path.join(root, "themes", "icons", "logo.svg")), /outside the Hugo content roots/);
    assert.deepEqual(selectSvgs(found, path.join(root, "content", "fa")), [persian]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("published content images use standardized filenames", () => {
  const svgs = discoverContentSvgs(contentRoots(repoRoot));
  assert.ok(svgs.length > 0);
  for (const svg of svgs) {
    assert.match(svg, /\.svg$/);
    assert.equal(/\.([a-z]{2})\.svg$/.test(svg), false, svg);
    assert.equal(pngPathFor(svg), `${svg.slice(0, -4)}.png`);
  }
  const markdown = [
    readFileSync(path.join(repoRoot, "content/en/articles/go-1-28-http2-parking-memory/index.md"), "utf8"),
    readFileSync(path.join(repoRoot, "content/fa/articles/go-1-28-http2-parking-memory/index.md"), "utf8"),
  ].join("\n");
  assert.equal(/01-rss-scaling\.(?:en|fa)\.svg/.test(markdown), false);
  assert.match(markdown, /01-rss-scaling\.svg/);
  assertNoLanguageSuffixCollisions(svgs);
});

test("language-suffix collisions are detected before rename targets clash", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "png-collide-"));
  try {
    const left = path.join(dir, "plot.en.svg");
    const right = path.join(dir, "plot.svg");
    writeFileSync(left, "<svg></svg>\n");
    writeFileSync(right, "<svg></svg>\n");
    assert.throws(() => assertNoLanguageSuffixCollisions([left, right]), /filename collision/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("raster preparation swaps the embedded family and drops WOFF2 faces", () => {
  const svg =
    '<svg><defs><style type="text/css"><![CDATA[\n@font-face{font-family:"Vazirmatn Embedded";src:url("data:font/woff2;base64,AA==")}\n]]></style></defs><text font-family="Vazirmatn Embedded">Hi</text></svg>';
  const prepared = prepareSvgForRaster(svg);
  assert.equal(prepared.includes("Vazirmatn Embedded"), false);
  assert.match(prepared, /font-family="Vazirmatn"/);
  assert.equal(prepared.includes("@font-face"), false);
  assert.equal(prepared.includes("data:font/woff2"), false);
  assert.equal(prepareSvgForRaster('<svg><text font-family="Other">x</text></svg>'), '<svg><text font-family="Other">x</text></svg>');
});

test("PNG signature helper accepts real PNG headers only", () => {
  const tiny = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  assert.equal(isPngBuffer(tiny), true);
  assert.equal(isPngBuffer(Buffer.from("not-a-png")), false);
  assert.equal(isPngBuffer(Buffer.from([0x89, 0x50])), false);
});

test("chart generation specs no longer carry language suffixes", () => {
  const names = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".vl.json")) names.push(entry.name);
    }
  };
  walk(path.join(repoRoot, "content"));
  assert.ok(names.length > 0);
  for (const name of names) assert.equal(/\.[a-z]{2}\.vl\.json$/.test(name), false, name);
});
