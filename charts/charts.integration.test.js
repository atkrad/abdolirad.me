import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderSpecFile } from "./render.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const theme = JSON.parse(readFileSync(path.join(repoRoot, "charts", "theme.json"), "utf8"));

function leftOf(inner, text) {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = inner.match(new RegExp(`x="([^"]+)"[^>]*>${escaped}<`));
  assert.ok(match, text);
  return Number(match[1]);
}

function requireRenderTools() {
  const missing = [];
  if (!process.env.CHARTS_FONT_DIR || !existsSync(process.env.CHARTS_FONT_DIR)) missing.push("CHARTS_FONT_DIR");
  for (const command of ["vl-convert", "pyftsubset", "hb-shape"]) {
    const result = spawnSync(command, ["--help"], { encoding: "utf8" });
    if (result.error) missing.push(command);
  }
  assert.equal(
    missing.length,
    0,
    `missing ${missing.join(", ")}; run npm run test:charts inside nix develop`,
  );
}

test("rendered fixtures embed the font, localize numbers, and stay deterministic", () => {
  requireRenderTools();
  const dir = mkdtempSync(path.join(repoRoot, ".chart-fixture-"));
  try {
    const faDir = path.join(dir, "content", "fa");
    mkdirSync(faDir, { recursive: true });
    const specPath = path.join(faDir, "widget.vl.json");
    const spec = {
      title: { text: "Go 1.28، Parking غیرفعال", anchor: "end" },
      data: { values: [{ label: "alpha", amount: 1000 }, { label: "beta", amount: 89.1 }] },
      layer: [
        { mark: "bar" },
        {
          mark: { type: "text", dy: -4 },
          encoding: {
            text: { field: "amount", format: ".1f" },
            color: { value: "#111111" },
          },
        },
      ],
      encoding: {
        x: { field: "label", type: "nominal", axis: { labelExpr: "datum.value == 'alpha' ? 'North' : 'South'" } },
        y: { field: "amount", type: "quantitative", axis: { labelExpr: "format(datum.value, ',')" } },
        color: {
          field: "label",
          type: "nominal",
          scale: { palette: "series", domain: ["alpha", "beta"] },
          legend: { labelExpr: "datum.value == 'alpha' ? 'Go 1.28، Parking غیرفعال' : 'Parking فعال'" },
        },
      },
    };
    writeFileSync(specPath, `${JSON.stringify(spec)}\n`);
    const fixtureTheme = {
      ...theme,
      palettes: { series: { alpha: "#112233", beta: "#445566" }, run: { 1: "#778899" } },
    };
    const first = renderSpecFile(specPath, fixtureTheme, process.env.CHARTS_FONT_DIR);
    const second = renderSpecFile(specPath, fixtureTheme, process.env.CHARTS_FONT_DIR);
    assert.equal(first.equals(second), true);
    const svg = first.toString("utf8");
    assert.match(svg, /^<svg\b/);
    assert.match(svg, /<\/svg>\s*$/);
    assert.match(svg, /font-family="Vazirmatn Embedded"/);
    assert.match(svg, /data:font\/woff2;base64,/);
    assert.equal(svg.includes("sans-serif"), false);
    assert.match(svg, /۱٬۰۰۰/);
    assert.match(svg, /۸۹٫۱/);
    assert.equal(svg.includes(">1000<"), false);
    assert.match(svg, /aria-label="Go 1\.28، Parking غیرفعال"/);
    const legend = svg.match(/<text\b[^>]*aria-label="Go 1\.28، Parking غیرفعال"[^>]*>[\s\S]*?<\/text>/);
    assert.ok(legend);
    assert.ok(leftOf(legend[0], "Go 1.28") > leftOf(legend[0], "Parking"));
    assert.match(svg, /#112233/i);
    assert.match(svg, /#445566/i);

    const woff = Buffer.from(svg.match(/base64,([^")]+)/)[1], "base64");
    const fontFile = path.join(dir, "subset.woff2");
    writeFileSync(fontFile, woff);
    const cmap = spawnSync(
      "python3",
      [
        "-c",
        "from fontTools.ttLib import TTFont; font = TTFont('subset.woff2'); cmap = font.getBestCmap(); missing = [hex(cp) for cp in [0x06F0, 0x06F1, 0x066C, 0x066B, 0x063A] if cp not in cmap]; print(','.join(missing))",
      ],
      { cwd: dir, encoding: "utf8" },
    );
    assert.equal(cmap.status, 0, cmap.stderr);
    assert.equal(cmap.stdout.trim(), "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check mode reports committed svgs that do not match a fresh render", () => {
  requireRenderTools();
  const result = spawnSync(process.execPath, [path.join(repoRoot, "charts", "render.mjs"), "--check"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /checked /);
});
