import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { canConvert, convertSvgToPng, isPngBuffer, pngPathFor } from "./png.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function requireConvertTools() {
  assert.equal(
    canConvert(),
    true,
    "missing Chromium browser; run npm run test:charts inside nix develop",
  );
}

function sampleSvg(label, fill = "#FAF9F6") {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="${fill}"/><text x="4" y="14" font-family="Vazirmatn" font-size="12" fill="#252B38">${label}</text></svg>\n`;
}

// Absolute tspans mirror the mixed RTL layout written into content SVGs. Chromium
// must keep those positions; a resvg-style pass would stack the runs.
function mixedRtlSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40">
<rect width="200" height="40" fill="#FAF9F6"/>
<text font-family="Vazirmatn" font-size="14" fill="#252B38" aria-label="Go فعال" text-anchor="start" direction="ltr" unicode-bidi="isolate" xml:space="preserve"><tspan x="40.00" text-anchor="start" direction="rtl" unicode-bidi="isolate">فعال</tspan><tspan x="0.00" text-anchor="start" direction="ltr" unicode-bidi="bidi-override">Go</tspan></text>
</svg>
`;
}

function pngSize(buffer) {
  assert.equal(isPngBuffer(buffer), true);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test("png conversion is deterministic, refreshes on change, and rejects bad input", () => {
  requireConvertTools();
  const dir = mkdtempSync(path.join(repoRoot, ".png-fixture-"));
  try {
    const article = path.join(dir, "content", "en", "articles", "demo");
    mkdirSync(article, { recursive: true });
    const svgPath = path.join(article, "sample.svg");
    writeFileSync(svgPath, sampleSvg("A"));
    const first = convertSvgToPng(svgPath);
    const second = convertSvgToPng(svgPath);
    assert.equal(isPngBuffer(first), true);
    assert.equal(first.equals(second), true);
    assert.deepEqual(pngSize(first), { width: 80, height: 40 });

    writeFileSync(svgPath, sampleSvg("B", "#08685A"));
    const third = convertSvgToPng(svgPath);
    assert.equal(first.equals(third), false);

    writeFileSync(path.join(article, "broken.svg"), "not-svg\n");
    assert.throws(
      () => convertSvgToPng(path.join(article, "broken.svg")),
      /not an SVG|width and height|browser screenshot failed/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mixed RTL absolute tspans rasterize at 2x without crashing", () => {
  requireConvertTools();
  const dir = mkdtempSync(path.join(repoRoot, ".png-rtl-"));
  try {
    const svgPath = path.join(dir, "mixed.svg");
    writeFileSync(svgPath, mixedRtlSvg());
    const png = convertSvgToPng(svgPath);
    assert.deepEqual(pngSize(png), { width: 400, height: 80 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check mode reports stale PNGs and accepts matching ones", () => {
  requireConvertTools();
  const dir = mkdtempSync(path.join(repoRoot, ".png-check-"));
  const previous = process.cwd();
  try {
    writeFileSync(path.join(dir, "hugo.yaml"), "languages:\n  en:\n    contentDir: content/en\n");
    const article = path.join(dir, "content", "en", "articles", "demo");
    mkdirSync(article, { recursive: true });
    const svgPath = path.join(article, "sample.svg");
    const pngPath = pngPathFor(svgPath);
    writeFileSync(svgPath, sampleSvg("A"));
    writeFileSync(pngPath, convertSvgToPng(svgPath));

    process.chdir(dir);
    let result = spawnSync(process.execPath, [path.join(repoRoot, "charts", "png.mjs"), "--check"], {
      encoding: "utf8",
      env: process.env,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    writeFileSync(svgPath, sampleSvg("B", "#08685A"));
    result = spawnSync(process.execPath, [path.join(repoRoot, "charts", "png.mjs"), "--check"], {
      encoding: "utf8",
      env: process.env,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /stale /);
  } finally {
    process.chdir(previous);
    rmSync(dir, { recursive: true, force: true });
  }
});
