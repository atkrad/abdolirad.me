import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyPalettes,
  applyTheme,
  coerce,
  contentRoots,
  discover,
  layoutBidirectionalSvg,
  localizeNumericLabel,
  localeOf,
  parseCsv,
  prepare,
  renderSpecFile,
  resolveDataUrl,
  rewriteMixedText,
  segmentMixedText,
  select,
} from "./render.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const themePath = path.join(repoRoot, "charts", "theme.json");
const theme = JSON.parse(readFileSync(themePath, "utf8"));

function textsOf(inner) {
  return [...inner.matchAll(/>([^<]*)</g)].map((match) => match[1]);
}

function leftOf(inner, text) {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = inner.match(new RegExp(`x="([^"]+)"[^>]*>${escaped}<`));
  assert.ok(match, text);
  return Number(match[1]);
}

test("editorial palette contract is disjoint and maps through the theme", () => {
  const series = theme.palettes.series;
  const runs = theme.palettes.run;
  assert.deepEqual(series, {
    go127: "#2F5F9A",
    go128off: "#A55A36",
    go128: "#08685A",
  });
  assert.equal(theme.config.background, "#FAF9F6");
  assert.equal(theme.config.title.color, "#252B38");
  assert.equal(theme.config.axis.labelColor, "#5B6574");
  assert.equal(theme.config.axisY.gridColor, "#E5E1DB");
  const seriesColors = new Set(Object.values(series));
  assert.equal(seriesColors.size, Object.keys(series).length);
  for (const color of Object.values(runs)) assert.equal(seriesColors.has(color), false);

  const mapped = applyPalettes(
    { encoding: { color: { scale: { palette: "series", domain: ["go128", "go127"] } } } },
    theme.palettes,
  );
  assert.deepEqual(mapped.encoding.color.scale.range, [series.go128, series.go127]);
  assert.equal(mapped.encoding.color.scale.palette, undefined);
});

test("unknown, missing, and mixed palette references fail clearly", () => {
  assert.throws(() => applyPalettes({ scale: { palette: "missing", domain: ["a"] } }, theme.palettes), /unknown palette missing/);
  assert.throws(
    () => applyPalettes({ scale: { palette: "series", domain: ["nope"] } }, theme.palettes),
    /no color for nope/,
  );
  assert.throws(
    () => applyPalettes({ scale: { palette: "series", domain: ["go127"], range: ["#000000"] } }, theme.palettes),
    /cannot be combined with scale.range/,
  );
  assert.throws(() => applyPalettes({ scale: { palette: "series" } }, theme.palettes), /requires scale.domain/);
});

test("a spec value overrides the shared theme", () => {
  const spec = {
    width: 222,
    padding: { left: 3 },
    config: { font: "Specimen", title: { fontSize: 11 } },
  };
  const themed = applyTheme(spec, theme);
  assert.equal(themed.width, 222);
  assert.equal(themed.height, theme.height);
  assert.deepEqual(themed.padding, { left: 3 });
  assert.equal(themed.config.font, "Specimen");
  assert.equal(themed.config.title.fontSize, 11);
  assert.equal(themed.config.background, theme.config.background);
  assert.deepEqual(themed.config.range.category, Object.values(theme.palettes.series));
});

function walkSpecs(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkSpecs(full, found);
    else if (entry.name.endsWith(".en.vl.json")) found.push(full);
  }
  return found;
}

function chartShape(spec) {
  const copy = structuredClone(spec);
  const visit = (value) => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    const next = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === "description" || key === "labelExpr" || key === "title") continue;
      next[key] = visit(item);
    }
    return next;
  };
  return visit(copy);
}

test("published locale pairs keep the same chart encoding", () => {
  const specs = walkSpecs(path.join(repoRoot, "content"));
  assert.ok(specs.length > 0);
  for (const englishPath of specs) {
    const persianPath = englishPath
      .replace(`${path.sep}content${path.sep}en${path.sep}`, `${path.sep}content${path.sep}fa${path.sep}`)
      .replace(/\.en\.vl\.json$/, ".fa.vl.json");
    assert.equal(existsSync(persianPath), true, persianPath);
    const english = JSON.parse(readFileSync(englishPath, "utf8"));
    const persian = JSON.parse(readFileSync(persianPath, "utf8"));
    assert.deepEqual(chartShape(english), chartShape(persian), englishPath);
    assert.equal(english.title.anchor, "start", englishPath);
    assert.equal(persian.title.anchor, "end", persianPath);
    assert.equal(localeOf(englishPath), "en");
    assert.equal(localeOf(persianPath), "fa");
  }
  assert.equal(localeOf("notes/wing.vl.json"), "en");
});

test("csv parsing keeps quoted commas and numeric columns", () => {
  const rows = parseCsv('city,score\n"Qom, old",1.5\nYazd,2\n');
  const records = coerce(rows);
  assert.equal(records[0].city, "Qom, old");
  assert.equal(records[0].score, 1.5);
  assert.equal(records[1].city, "Yazd");
  assert.throws(() => parseCsv('"open,1\n'), /unterminated quoted field/);
  assert.throws(() => coerce([[]]), /no header/);
});

test("local data resolution rejects remote, absolute, and missing files", () => {
  const spec = path.join(repoRoot, "charts", "theme.json");
  assert.throws(() => resolveDataUrl(spec, "https://example.com/rows.csv"), /non-local data url/);
  assert.throws(() => resolveDataUrl(spec, "/etc/passwd"), /unsafe data url/);
  assert.throws(() => resolveDataUrl(spec, "../hugo.yaml"), /unsafe data url/);
  assert.throws(() => resolveDataUrl(spec, "missing-rows.csv"), /missing data file/);
  assert.throws(() => resolveDataUrl(spec, ""), /empty/);
});

test("discovery stays inside the configured content roots", () => {
  const root = mkdtempSync(path.join(tmpdir(), "chart-root-"));
  try {
    mkdirSync(path.join(root, "stories", "nested"), { recursive: true });
    writeFileSync(path.join(root, "hugo.yaml"), "languages:\n  en:\n    contentDir: stories\n");
    const inside = path.join(root, "stories", "nested", "plot.en.vl.json");
    writeFileSync(inside, "{}\n");
    writeFileSync(path.join(root, "stories", "notes.txt"), "skip\n");
    const outside = path.join(root, "plot.en.vl.json");
    writeFileSync(outside, "{}\n");
    const specs = discover(contentRoots(root));
    assert.deepEqual(specs, [inside]);
    assert.throws(() => select(specs, outside), /outside the Hugo content roots/);
    assert.throws(() => select(specs, path.join(root, "stories", "notes.txt")), /not a Vega-Lite spec/);
    assert.deepEqual(select(specs, path.join(root, "stories")), [inside]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("persian numerals change only pure numeric labels", () => {
  const cases = [
    ["0", "۰"],
    ["1000", "۱٬۰۰۰"],
    ["1,000", "۱٬۰۰۰"],
    ["5000", "۵٬۰۰۰"],
    ["89.1", "۸۹٫۱"],
    ["99.0", "۹۹٫۰"],
    ["-12.5", "-۱۲٫۵"],
    ["Go 1.28", "Go 1.28"],
    ["HTTP/2", "HTTP/2"],
    ["RSS (MiB)", "RSS (MiB)"],
    ["1,000 connections", "1,000 connections"],
  ];
  for (const [input, expected] of cases) assert.equal(localizeNumericLabel(input), expected, input);
});

test("mixed labels keep logical runs and place them from the right", () => {
  const cases = [
    ["Go 1.28، Parking غیرفعال", ["غیرفعال", " ", "Parking", " ", "،", "Go 1.28"]],
    ["اتصال‌های HTTP/2", ["HTTP/2", " ", "اتصال‌های"]],
    ["کاهش RSS (MiB)", ["RSS (MiB)", " ", "کاهش"]],
    ["تعداد Goroutineها", ["ها", "Goroutine", " ", "تعداد"]],
    ["مقایسهٔ StackInuse و HeapAlloc در ۵۰۰۰ اتصال", ["در ۵۰۰۰ اتصال", " ", "HeapAlloc", " ", "و", " ", "StackInuse", " ", "مقایسهٔ"]],
  ];
  for (const [logical, visual] of cases) {
    const tokens = [...segmentMixedText(logical)].reverse().map((token) => token.text);
    assert.deepEqual(tokens, visual, logical);
  }
  assert.deepEqual(segmentMixedText("Go 1.27.2").map((token) => token.text), ["Go 1.27.2"]);

  const measure = (text) => [...text].length * 10;
  const rewritten = rewriteMixedText(' text-anchor="end" transform="translate(21,11)"', "Go 1.28، Parking غیرفعال", measure);
  assert.match(rewritten.attrs, /aria-label="Go 1\.28، Parking غیرفعال"/);
  assert.match(rewritten.attrs, /text-anchor="start"/);
  assert.match(rewritten.inner, /direction="rtl"/);
  assert.match(rewritten.inner, /unicode-bidi="bidi-override"/);
  const go = leftOf(rewritten.inner, "Go 1.28");
  const parking = leftOf(rewritten.inner, "Parking");
  assert.ok(go > parking);
  assert.equal(rewriteMixedText("", "89.1", measure), null);
  assert.equal(rewriteMixedText("", "Go 1.28", measure), null);
});

function toolsReady() {
  if (!process.env.CHARTS_FONT_DIR || !existsSync(process.env.CHARTS_FONT_DIR)) return false;
    for (const command of ["vl-convert", "pyftsubset", "hb-shape"]) {
    const result = spawnSync(command, ["--help"], { encoding: "utf8" });
    if (result.error) return false;
  }
  return true;
}

const canRender = toolsReady();
const renderRequirement = "vl-convert, pyftsubset, hb-shape, and CHARTS_FONT_DIR are required; run npm test inside nix develop";

test("rendered fixtures embed the font, localize numbers, and stay deterministic", () => {
  assert.ok(canRender, renderRequirement);
  const dir = mkdtempSync(path.join(repoRoot, ".chart-fixture-"));
  try {
    const specPath = path.join(dir, "widget.fa.vl.json");
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

test("a prepared spec inlines local csv and rejects a bad file", () => {
  const dir = path.join(repoRoot, ".chart-data-fixture");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir);
  try {
    writeFileSync(path.join(dir, "rows.csv"), "name,amount\nalpha,3.5\n");
    const specPath = path.join(dir, "rows.en.vl.json");
    writeFileSync(specPath, JSON.stringify({ data: { url: "rows.csv" }, mark: "bar" }));
    const prepared = prepare(specPath, theme);
    assert.deepEqual(prepared.data.values, [{ name: "alpha", amount: 3.5 }]);
    writeFileSync(specPath, JSON.stringify({ data: { url: "https://example.com/rows.csv" }, mark: "bar" }));
    assert.throws(() => prepare(specPath, theme), /non-local data url/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check mode reports committed svgs that do not match a fresh render", () => {
  assert.ok(canRender, renderRequirement);
  const result = spawnSync(process.execPath, [path.join(repoRoot, "charts", "render.mjs"), "--check"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /checked /);
});

test("layout helper leaves latin svg text untouched", () => {
  const svg = '<svg><text text-anchor="start">Go 1.28</text></svg>';
  assert.equal(layoutBidirectionalSvg(svg, process.env.CHARTS_FONT_DIR || "."), svg);
});
