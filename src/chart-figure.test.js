import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { generatePersianDates } from "./persian-dates.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const SAMPLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="200"><rect width="640" height="200" fill="#faf9f6"/><text x="20" y="40" font-size="18">Widget</text></svg>\n';

function page(title, fields, body) {
  const lines = ["---", `title: ${JSON.stringify(title)}`];
  for (const [key, value] of Object.entries(fields)) lines.push(`${key}: ${JSON.stringify(value)}`);
  lines.push("---", body, "");
  return lines.join("\n");
}

function buildFixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "chart-figure-"));
  const contentDir = path.join(dir, "content");
  const publicDir = path.join(dir, "public");
  const files = {
    "en/archives.md": page("Archive", { layout: "archives", url: "/archives/" }, "Archive"),
    "fa/archives.md": page("بایگانی", { layout: "archives", url: "/archives/" }, "بایگانی"),
    "en/articles/notes/index.md": page(
      "Notes",
      { date: "2024-05-01T00:00:00Z", slug: "notes" },
      "A paragraph.\n\n![Plain diagram](diagram.png)\n\n![Widget counts for the north wing](widget.en.svg)\n",
    ),
    "en/articles/notes/diagram.png": TINY_PNG,
    "en/articles/notes/widget.en.svg": SAMPLE_SVG,
    "en/articles/notes/widget.en.vl.json": "{}\n",
    "en/articles/plain/index.md": page("Plain", { date: "2024-04-01T00:00:00Z", slug: "plain" }, "No chart here.\n"),
    "fa/articles/notes/index.md": page(
      "یادداشت",
      { date: "2024-05-01T00:00:00Z", slug: "notes" },
      "یک پاراگراف.\n\n![نمودار ساده](diagram.png)\n\n![شمارش ویجت برای بال شمالی](widget.fa.svg)\n",
    ),
    "fa/articles/notes/diagram.png": TINY_PNG,
    "fa/articles/notes/widget.fa.svg": SAMPLE_SVG,
    "fa/articles/notes/widget.fa.vl.json": "{}\n",
  };
  for (const [relative, text] of Object.entries(files)) {
    const file = path.join(contentDir, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  const overlay = path.join(dir, "overlay.yaml");
  writeFileSync(
    overlay,
    [
      `dataDir: ${path.join(dir, "data")}`,
      "languages:",
      "  en:",
      `    contentDir: ${path.join(contentDir, "en")}`,
      "  fa:",
      `    contentDir: ${path.join(contentDir, "fa")}`,
      "",
    ].join("\n"),
  );
  generatePersianDates({
    root,
    contentDir,
    configPath: path.join(root, "hugo.yaml"),
    outFile: path.join(dir, "data", "persianDates.json"),
  });
  const result = spawnSync("hugo", ["--destination", publicDir, "--config", `hugo.yaml,${overlay}`, "--quiet"], {
    cwd: root,
    encoding: "utf8",
  });
  return { dir, publicDir, result };
}

test("chart images use medium-zoom and ordinary images stay plain", () => {
  const built = buildFixture();
  try {
    assert.equal(built.result.status, 0, `${built.result.stdout}\n${built.result.stderr}`);
    const english = readFileSync(path.join(built.publicDir, "en/articles/notes/index.html"), "utf8");
    const persian = readFileSync(path.join(built.publicDir, "fa/articles/notes/index.html"), "utf8");
    for (const html of [english, persian]) {
      assert.match(html, /<img[^>]*alt="(?:Plain diagram|نمودار ساده)"[^>]*>/);
      assert.equal(/<figure\b/.test(html), false);
      assert.match(html, /<p>\s*<img\b[^>]*class="chart-figure"[^>]*>\s*<\/p>/);
      assert.match(html, /<img[^>]*alt="(?:Widget counts for the north wing|شمارش ویجت برای بال شمالی)"[^>]*>/);
      assert.match(html, /src="[^"]*widget\.(?:en|fa)\.svg"/);
      assert.match(html, /src=(?:"\/js\/chart-zoom\.js"|\/js\/chart-zoom\.js)(?:[\s>]|$)/);
      assert.equal(html.includes("chart-figure__full"), false);
      assert.equal(html.includes("View larger"), false);
      assert.equal(html.includes("نمایش بزرگ‌تر"), false);
      assert.equal(html.includes("chart-viewer"), false);
      assert.equal(html.includes("data-zoom-in"), false);
      assert.equal(html.includes("showModal"), false);
    }
    const plainImage = english.match(/<img[^>]*diagram\.png[^>]*>/)[0];
    assert.equal(plainImage.includes("chart-figure"), false);
    const plainArticle = readFileSync(path.join(built.publicDir, "en/articles/plain/index.html"), "utf8");
    assert.equal(plainArticle.includes("chart-figure"), false);
    assert.equal(plainArticle.includes("chart-zoom"), false);
  } finally {
    rmSync(built.dir, { recursive: true, force: true });
  }
});
