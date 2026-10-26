import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  canConvert,
  convertSvgToPng,
  discoverContentSvgs,
  isPngBuffer,
  pngDimensions,
  pngPathFor,
} from "./png.mjs";
import { contentRoots } from "./render.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function requireConvertTools() {
  assert.equal(
    canConvert(),
    true,
    "missing vl-convert or CHARTS_FONT_DIR; run npm run test:charts inside nix develop",
  );
}

test("content SVGs rasterize to valid 2x PNGs without changing the SVG", () => {
  requireConvertTools();
  const svgs = discoverContentSvgs(contentRoots(repoRoot));
  assert.ok(svgs.length >= 2);
  const english = svgs.find((file) => file.includes(`${path.sep}content${path.sep}en${path.sep}`));
  const persian = svgs.find((file) => file.includes(`${path.sep}content${path.sep}fa${path.sep}`));
  assert.ok(english);
  assert.ok(persian);

  for (const svg of [english, persian]) {
    const before = readFileSync(svg);
    const png = convertSvgToPng(svg, { fontDir: process.env.CHARTS_FONT_DIR });
    assert.equal(readFileSync(svg).equals(before), true, svg);
    assert.equal(isPngBuffer(png), true, svg);
    const { width, height } = pngDimensions(png);
    assert.equal(width % 2, 0, `${svg} width ${width}`);
    assert.equal(height % 2, 0, `${svg} height ${height}`);
    assert.ok(width >= 2, svg);
    assert.ok(height >= 2, svg);
  }
});

test("png conversion is idempotent and refreshes when the SVG changes", () => {
  requireConvertTools();
  const dir = mkdtempSync(path.join(repoRoot, ".png-fixture-"));
  try {
    const article = path.join(dir, "content", "en", "articles", "demo");
    mkdirSync(article, { recursive: true });
    writeFileSync(path.join(dir, "hugo.yaml"), "languages:\n  en:\n    contentDir: content/en\n");
    const svgPath = path.join(article, "sample.svg");
    writeFileSync(
      svgPath,
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#FAF9F6"/><text x="4" y="14" font-family="Vazirmatn" font-size="12" fill="#252B38">A</text></svg>\n',
    );
    const first = convertSvgToPng(svgPath, { fontDir: process.env.CHARTS_FONT_DIR });
    const second = convertSvgToPng(svgPath, { fontDir: process.env.CHARTS_FONT_DIR });
    assert.equal(first.equals(second), true);
    writeFileSync(
      svgPath,
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#08685A"/><text x="4" y="14" font-family="Vazirmatn" font-size="12" fill="#FAF9F6">B</text></svg>\n',
    );
    const third = convertSvgToPng(svgPath, { fontDir: process.env.CHARTS_FONT_DIR });
    assert.equal(first.equals(third), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("conversion failures are thrown and deleted SVGs do not force PNG deletion", () => {
  requireConvertTools();
  const dir = mkdtempSync(path.join(repoRoot, ".png-fail-"));
  try {
    const article = path.join(dir, "content", "en", "articles", "demo");
    mkdirSync(article, { recursive: true });
    const bad = path.join(article, "broken.svg");
    writeFileSync(bad, "not-svg\n");
    assert.throws(() => convertSvgToPng(bad, { fontDir: process.env.CHARTS_FONT_DIR }), /not an SVG|svg2png failed/);

    const good = path.join(article, "ok.svg");
    writeFileSync(
      good,
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#000"/></svg>\n',
    );
    const orphanPng = pngPathFor(good);
    writeFileSync(orphanPng, convertSvgToPng(good, { fontDir: process.env.CHARTS_FONT_DIR }));
    rmSync(good);
    assert.equal(existsSync(good), false);
    assert.equal(existsSync(orphanPng), true);
    // Companion discovery only walks SVGs, so a deleted SVG does not delete its PNG.
    const svgs = discoverContentSvgs([path.join(dir, "content", "en")]);
    assert.equal(svgs.includes(good), false);
    assert.equal(
      svgs.some((file) => pngPathFor(file) === orphanPng),
      false,
    );

    const missing = spawnSync(process.execPath, [path.join(repoRoot, "charts", "png.mjs"), "--require"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, CHARTS_FONT_DIR: "" },
    });
    assert.equal(missing.status, 0, `${missing.stdout}\n${missing.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check mode accepts committed content PNGs", () => {
  requireConvertTools();
  const result = spawnSync(process.execPath, [path.join(repoRoot, "charts", "png.mjs"), "--check"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /checked /);
});

test("mtime alone does not mark a matching PNG stale", () => {
  requireConvertTools();
  const svg = discoverContentSvgs(contentRoots(repoRoot))[0];
  const dest = pngPathFor(svg);
  assert.equal(existsSync(dest), true, `missing ${dest}; run node charts/png.mjs`);
  const before = readFileSync(dest);
  const staleTime = new Date(Date.now() - 60_000);
  utimesSync(dest, staleTime, staleTime);
  const fresh = convertSvgToPng(svg, { fontDir: process.env.CHARTS_FONT_DIR });
  assert.equal(before.equals(fresh), true);
});
