import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// vl-convert 1.9.0 defaults to Vega-Lite 5.21. Pass it explicitly so a newer
// CLI cannot change the SVG by changing that default.
const VL_VERSION = "5.21";

const repoRoot = process.cwd();

function fail(message) {
  console.error(message);
  process.exit(1);
}

function help() {
  console.log(`Usage: nix run .#charts -- [options]

Render every *.vl.json under the Hugo content roots to SVG, then refresh the
matching PNG. Language comes from the content directory (content/en, content/fa).

Options:
  --help           Show this help
  --check          Compare a fresh render with the committed SVG and PNG files.
                   Do not modify the tree.
  --path <path>    Limit to one .vl.json file, or every spec under a directory
`);
}

function parseArgs(argv) {
  let check = false;
  let only = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      help();
      process.exit(0);
    } else if (arg === "--check") {
      check = true;
    } else if (arg === "--path") {
      only = argv[index + 1];
      if (!only || only.startsWith("--")) fail("missing value for --path");
      index += 1;
    } else {
      fail(`unknown argument ${arg}`);
    }
  }
  return { check, only };
}

export function contentRoots(root = repoRoot) {
  const configPath = path.join(root, "hugo.yaml");
  if (!existsSync(configPath)) throw new Error("hugo.yaml was not found in the current directory");
  const config = readFileSync(configPath, "utf8");
  const roots = [];
  for (const match of config.matchAll(/^\s*contentDir:\s*["']?([^"'\s#]+)["']?\s*(?:#.*)?$/gm)) {
    roots.push(path.resolve(root, match[1]));
  }
  if (roots.length === 0) throw new Error("hugo.yaml has no contentDir entries");
  return roots;
}

function walkSpecs(directory, found) {
  for (const name of readdirSync(directory)) {
    if (name === ".git" || name === "node_modules") continue;
    const full = path.join(directory, name);
    const info = statSync(full);
    if (info.isDirectory()) {
      walkSpecs(full, found);
      continue;
    }
    if (name.endsWith(".vl.json")) found.push(full);
  }
}

export function discover(roots) {
  const found = [];
  for (const root of roots) {
    if (!existsSync(root)) throw new Error(`content root does not exist: ${path.relative(repoRoot, root)}`);
    walkSpecs(root, found);
  }
  found.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return found;
}

export function select(specs, only) {
  if (!only) return specs;
  const target = path.resolve(repoRoot, only);
  if (!existsSync(target)) throw new Error(`path not found: ${only}`);
  const info = statSync(target);
  if (info.isFile()) {
    if (!target.endsWith(".vl.json")) throw new Error(`not a Vega-Lite spec: ${only}`);
    if (!specs.includes(target)) throw new Error(`spec is outside the Hugo content roots: ${only}`);
    return [target];
  }
  const prefix = target.endsWith(path.sep) ? target : `${target}${path.sep}`;
  const picked = specs.filter((spec) => spec.startsWith(prefix));
  if (picked.length === 0) throw new Error(`no .vl.json files under ${only}`);
  return picked;
}

function svgPath(specPath) {
  const suffix = ".vl.json";
  if (!specPath.endsWith(suffix)) fail(`refusing malformed spec name: ${specPath}`);
  return `${specPath.slice(0, -suffix.length)}.svg`;
}

function relative(file) {
  const rel = path.relative(repoRoot, file);
  return rel.startsWith("..") ? file : rel;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, override) {
  if (Array.isArray(override) || !isObject(override)) return structuredClone(override);
  const merged = isObject(base) ? structuredClone(base) : {};
  for (const [key, value] of Object.entries(override)) {
    merged[key] = key in merged && isObject(value) ? deepMerge(merged[key], value) : structuredClone(value);
  }
  return merged;
}

export function applyTheme(spec, theme) {
  const next = structuredClone(spec);
  const composed = next.facet || next.hconcat || next.vconcat || next.concat;
  if (!composed && next.width == null && theme.width != null) next.width = theme.width;
  if (!composed && next.height == null && theme.height != null) next.height = theme.height;
  if (next.padding == null && theme.padding != null) next.padding = structuredClone(theme.padding);
  if (next.autosize == null && theme.autosize != null) next.autosize = structuredClone(theme.autosize);
  const config = deepMerge(theme.config ?? {}, next.config ?? {});
  if (isObject(theme.palettes) && isObject(theme.palettes.series)) {
    config.range = {
      ...(isObject(config.range) ? config.range : {}),
      category: Object.values(theme.palettes.series),
    };
  }
  next.config = config;
  return next;
}

export function applyPalettes(node, palettes) {
  if (Array.isArray(node)) return node.map((item) => applyPalettes(item, palettes));
  if (!isObject(node)) return node;
  const next = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "scale" && isObject(value) && typeof value.palette === "string") {
      const palette = palettes[value.palette];
      if (!isObject(palette)) throw new Error(`unknown palette ${value.palette}`);
      if (value.range != null) {
        throw new Error(`palette ${value.palette} cannot be combined with scale.range`);
      }
      if (!Array.isArray(value.domain)) throw new Error(`palette ${value.palette} requires scale.domain`);
      const range = value.domain.map((item) => {
        const color = palette[String(item)];
        if (typeof color !== "string") {
          throw new Error(`palette ${value.palette} has no color for ${item}`);
        }
        return color;
      });
      const { palette: _name, ...rest } = value;
      next.scale = { ...structuredClone(rest), range };
      continue;
    }
    next[key] = applyPalettes(value, palettes);
  }
  return next;
}

export function resolveDataUrl(specPath, url) {
  if (typeof url !== "string" || url === "") {
    throw new Error("data.url is empty");
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) {
    throw new Error(`refusing non-local data url ${url}`);
  }
  if (path.isAbsolute(url) || url.includes("\0")) {
    throw new Error(`refusing unsafe data url ${url}`);
  }
  const parts = url.split(/[\\/]/);
  if (parts.includes("..") || parts.includes("")) {
    throw new Error(`refusing unsafe data url ${url}`);
  }
  const resolved = path.resolve(path.dirname(specPath), url);
  if (resolved !== repoRoot && !resolved.startsWith(`${repoRoot}${path.sep}`)) {
    throw new Error(`data url escapes the repository: ${url}`);
  }
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    throw new Error(`missing data file ${relative(resolved)}`);
  }
  return resolved;
}

export function parseCsv(text) {
  const source = text.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error("unterminated quoted field in csv");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((item) => item.some((value) => value !== ""));
}

export function coerce(rows) {
  const [header, ...records] = rows;
  if (!header || header.length === 0) throw new Error("data file has no header");
  const numeric = header.map((_, column) =>
    records.every((record) => {
      const value = record[column] ?? "";
      return value === "" || /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value);
    }),
  );
  return records.map((record) => {
    const item = {};
    header.forEach((name, column) => {
      const value = record[column] ?? "";
      if (value === "") item[name] = null;
      else if (numeric[column]) item[name] = Number(value);
      else item[name] = value;
    });
    return item;
  });
}

function readTable(file) {
  const text = readFileSync(file, "utf8");
  if (file.endsWith(".json")) {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (isObject(parsed) && Array.isArray(parsed.values)) return parsed.values;
    throw new Error(`JSON data must be an array or an object with values: ${relative(file)}`);
  }
  return coerce(parseCsv(text));
}

function injectData(node, specPath) {
  if (Array.isArray(node)) return node.map((item) => injectData(item, specPath));
  if (!isObject(node)) return node;
  const next = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "data" && isObject(value) && typeof value.url === "string") {
      const file = resolveDataUrl(specPath, value.url);
      const { url, format, ...rest } = value;
      next.data = { ...structuredClone(rest), values: readTable(file) };
      continue;
    }
    next[key] = injectData(value, specPath);
  }
  return next;
}

function loadTheme() {
  const themePath = path.join(repoRoot, "charts", "theme.json");
  if (!existsSync(themePath)) fail("missing charts/theme.json");
  try {
    return JSON.parse(readFileSync(themePath, "utf8"));
  } catch (error) {
    fail(`charts/theme.json is not valid JSON: ${error.message}`);
  }
  return null;
}

export function prepare(specPath, theme) {
  let spec;
  try {
    spec = JSON.parse(readFileSync(specPath, "utf8"));
  } catch (error) {
    throw new Error(`${relative(specPath)} is not valid JSON: ${error.message}`);
  }
  if (!isObject(spec)) throw new Error(`${relative(specPath)} must be a JSON object`);
  return injectData(applyPalettes(applyTheme(spec, theme), theme.palettes ?? {}), specPath);
}

function renderOne(vlConvert, specPath, prepared, work, fontDir, configPath) {
  const id = Buffer.from(specPath).toString("hex").slice(-24);
  const input = path.join(work, `${id}.vl.json`);
  const output = path.join(work, `${id}.svg`);
  writeFileSync(input, `${JSON.stringify(prepared)}\n`);
  const args = [
    "vl2svg",
    "--input",
    input,
    "--output",
    output,
    "--vl-version",
    VL_VERSION,
    "--config",
    configPath,
  ];
  if (fontDir) args.push("--font-dir", fontDir);
  const result = spawnSync(vlConvert, args, { encoding: "utf8" });
  if (result.error) {
    throw new Error(`${relative(specPath)}: failed to run vl-convert: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = `${result.stderr || ""}${result.stdout || ""}`.trim();
    throw new Error(`${relative(specPath)}: vl-convert failed\n${detail}`);
  }
  if (!existsSync(output)) throw new Error(`${relative(specPath)}: vl-convert wrote no SVG`);
  const svg = readFileSync(output);
  if (svg.length === 0 || !svg.includes("<svg")) {
    throw new Error(`${relative(specPath)}: vl-convert wrote an empty SVG`);
  }
  return embedFonts(svg, fontDir, work, relative(specPath), localeOf(specPath));
}

export function renderSpecFile(specPath, theme, fontDir, vlConvert = "vl-convert") {
  const prepared = prepare(specPath, theme);
  const work = mkdtempSync(path.join(tmpdir(), "abdolirad-charts-"));
  try {
    const configPath = path.join(work, "empty-config.json");
    writeFileSync(configPath, "{}\n");
    return renderOne(vlConvert, specPath, prepared, work, fontDir, configPath);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// vl-convert measures with the pinned Vazirmatn files but writes only the family
// name. A private family plus an embedded subset keeps that face when the SVG is
// loaded as an image on a machine that does not have Vazirmatn installed.
const EMBEDDED_FAMILY = "Vazirmatn Embedded";
const WEIGHT_FILES = new Map([
  [400, "Vazirmatn-Regular.ttf"],
  [500, "Vazirmatn-Medium.ttf"],
  [600, "Vazirmatn-SemiBold.ttf"],
  [700, "Vazirmatn-Bold.ttf"],
]);
function fontWeightNumber(value) {
  if (value == null || value === "" || value === "normal") return 400;
  if (value === "bold") return 700;
  if (value === "medium") return 500;
  const parsed = Number(value);
  if (WEIGHT_FILES.has(parsed)) return parsed;
  throw new Error(`unsupported font-weight ${value}`);
}

function weightsIn(svg) {
  const found = new Set([400]);
  for (const match of svg.matchAll(/font-weight="([^"]+)"/g)) {
    found.add(fontWeightNumber(match[1]));
  }
  return [...found].sort((left, right) => left - right);
}

function decodeXml(text) {
  return text
    .replaceAll(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replaceAll(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function charactersIn(svg) {
  const chars = new Set([" "]);
  const add = (text) => {
    for (const char of decodeXml(text)) {
      if (char === "\u2067" || char === "\u2069" || char === "\n" || char === "\r") continue;
      chars.add(char);
    }
  };
  for (const match of svg.matchAll(/>([^<]+)</g)) add(match[1]);
  for (const match of svg.matchAll(/aria-label="([^"]*)"/g)) add(match[1]);
  return [...chars].join("");
}

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ASCII_NUMBER = /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;
const LOCALIZED_NUMBER = /^-?(?:[0-9۰-۹]{1,3}(?:[,\u066C][0-9۰-۹]{3})+|[0-9۰-۹]+)(?:[.\u066B][0-9۰-۹]+)?$/;

// Language comes from content/<lang>/ in the path. Outside that layout, default to en.
export function localeOf(filePath) {
  const parts = path.resolve(filePath).split(path.sep);
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (parts[index] === "content" && /^[a-z]{2}$/.test(parts[index + 1])) {
      return parts[index + 1];
    }
  }
  return "en";
}

export function localizeNumericLabel(text) {
  if (!ASCII_NUMBER.test(text)) return text;
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction] = unsigned.split(".");
  const grouped = whole.replaceAll(",", "").replace(/\B(?=(\d{3})+(?!\d))/g, "\u066C");
  const digits = (value) => value.replace(/\d/g, (digit) => PERSIAN_DIGITS[digit]);
  const body = fraction == null ? digits(grouped) : `${digits(grouped)}\u066B${digits(fraction)}`;
  return `${negative ? "-" : ""}${body}`;
}

function isNumericLabel(text) {
  return LOCALIZED_NUMBER.test(text);
}

function isArabicPunctuation(char) {
  return char === "\u060C" || char === "\u061B" || char === "\u061F";
}

function isRtlCore(char) {
  if (isArabicPunctuation(char)) return false;
  return /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(char);
}

function isLtrCore(char) {
  return /[A-Za-z0-9]/.test(char);
}

function isAsciiPunctuation(char) {
  return char.charCodeAt(0) < 128 && !isLtrCore(char) && !/\s/.test(char);
}

function pushToken(tokens, kind, text) {
  const last = tokens.at(-1);
  if (last && last.kind === kind) last.text += text;
  else tokens.push({ kind, text });
}

function nextStrong(chars, index) {
  for (let cursor = index + 1; cursor < chars.length; cursor += 1) {
    const char = chars[cursor];
    if (isArabicPunctuation(char)) return "punct";
    if (isRtlCore(char)) return "rtl";
    if (isLtrCore(char) || isAsciiPunctuation(char)) return "ltr";
  }
  return "end";
}

// Split mixed text into runs the browser must not reorder.
// An Arabic comma is bidi class AL, so a single SVG text node paints
// "Go 1.28، Parking غیرفعال" with Parking on the wrong side. Latin identifiers
// such as "Go 1.28" and "HTTP/2" stay intact, including their internal spaces.
export function segmentMixedText(text) {
  const chars = [...text];
  const tokens = [];
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    if (isArabicPunctuation(char)) {
      pushToken(tokens, "punct", char);
      continue;
    }
    if (char === "\u200C" || char === "\u200D") {
      pushToken(tokens, "rtl", char);
      continue;
    }
    if (isRtlCore(char)) {
      pushToken(tokens, "rtl", char);
      continue;
    }
    if (isLtrCore(char) || isAsciiPunctuation(char)) {
      pushToken(tokens, "ltr", char);
      continue;
    }
    if (/\s/.test(char)) {
      const previous = tokens.at(-1)?.kind;
      const upcoming = nextStrong(chars, index);
      if (previous === "ltr" && upcoming === "ltr") pushToken(tokens, "ltr", char);
      else if (previous === "rtl" && upcoming === "rtl") pushToken(tokens, "rtl", char);
      else pushToken(tokens, "space", char);
      continue;
    }
    pushToken(tokens, "ltr", char);
  }
  return tokens;
}

function escapeXml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function attrValue(attrs, name) {
  return (attrs.match(new RegExp(`\\s${name}="([^"]*)"`)) || [])[1] ?? null;
}

function fontSizeOf(attrs) {
  const raw = attrValue(attrs, "font-size");
  if (!raw) return 14;
  const size = Number.parseFloat(raw);
  return Number.isFinite(size) ? size : 14;
}

// Place each run explicitly. Chrome and Firefox, when the SVG is an <img>,
// ignore bidi isolate characters inside one <text> node and still apply the
// Unicode algorithm, which mis-orders this mix. Absolute x positions are not
// reordered across tspans. An RTL run is anchored at its right edge so its
// glyphs grow left into the box instead of back out of it.
export function rewriteMixedText(attrs, text, measureWidth) {
  if (isNumericLabel(text) || ![...text].some((char) => isRtlCore(char))) return null;
  const tokens = segmentMixedText(text);
  if (!tokens.some((token) => token.kind === "rtl")) return null;
  const visual = [...tokens].reverse();
  const widths = visual.map((token) => measureWidth(token.text, token.kind === "rtl" ? "rtl" : "ltr"));
  const total = widths.reduce((sum, width) => sum + width, 0);
  const anchor = attrValue(attrs, "text-anchor") || "start";
  const origin = Number(attrValue(attrs, "x") || 0);
  let cursor = anchor === "end" ? origin - total : anchor === "middle" ? origin - total / 2 : origin;
  const parts = visual.map((token, index) => {
    const width = widths[index];
    const rtl = token.kind === "rtl";
    const at = rtl ? cursor + width : cursor;
    cursor += width;
    const bidi = rtl
      ? 'direction="rtl" unicode-bidi="isolate" style="direction:rtl;unicode-bidi:isolate"'
      : 'direction="ltr" unicode-bidi="bidi-override" style="direction:ltr;unicode-bidi:bidi-override"';
    return `<tspan x="${at.toFixed(2)}" text-anchor="start" ${bidi}>${escapeXml(token.text)}</tspan>`;
  });
  let next = attrs
    .replace(/\sdirection="[^"]*"/g, "")
    .replace(/\sunicode-bidi="[^"]*"/g, "")
    .replace(/\stext-anchor="[^"]*"/g, "")
    .replace(/\sxml:space="[^"]*"/g, "");
  if (!attrValue(attrs, "aria-label")) next += ` aria-label="${escapeXml(text)}"`;
  next += ' text-anchor="start" direction="ltr" unicode-bidi="isolate" xml:space="preserve"';
  return { attrs: next, inner: parts.join("") };
}

function localizeSvgNumbers(svg) {
  return svg.replace(/<text\b([^>]*)>([^<]*)<\/text>/g, (full, attrs, raw) => {
    const text = decodeXml(raw);
    const localized = localizeNumericLabel(text);
    let nextAttrs = attrs;
    const label = attrs.match(/\saria-label="([^"]*)"/);
    if (label) {
      const decoded = decodeXml(label[1]);
      const localLabel = localizeNumericLabel(decoded);
      if (localLabel !== decoded) {
        nextAttrs = attrs.replace(label[0], ` aria-label="${escapeXml(localLabel)}"`);
      }
    }
    if (localized === text && nextAttrs === attrs) return full;
    return `<text${nextAttrs}>${escapeXml(localized)}</text>`;
  });
}

function shapeWidth(fontFile, text, direction, fontSize) {
  const result = spawnSync(
    "hb-shape",
    ["--output-format=json", "--font-size=1000", `--direction=${direction}`, fontFile, "--", text],
    { encoding: "utf8" },
  );
  if (result.error) throw new Error(`hb-shape failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = `${result.stderr || ""}${result.stdout || ""}`.trim();
    throw new Error(`hb-shape failed\n${detail}`);
  }
    const glyphs = JSON.parse(result.stdout);
  const units = glyphs.reduce((sum, glyph) => sum + (Number(glyph.ax) || 0), 0);
  return (units / 1000) * fontSize;
}

export function layoutBidirectionalSvg(svg, fontDir) {
  const cache = new Map();
  return svg.replace(/<text\b([^>]*)>([^<]*)<\/text>/g, (full, attrs, raw) => {
    const text = decodeXml(raw);
    const fontSize = fontSizeOf(attrs);
    const weight = fontWeightNumber(attrValue(attrs, "font-weight"));
    const fontFile = path.join(fontDir, WEIGHT_FILES.get(weight));
    const rewritten = rewriteMixedText(attrs, text, (sample, direction) => {
      if (sample === "") return 0;
      const key = `${fontFile}\0${fontSize}\0${direction}\0${sample}`;
      if (cache.has(key)) return cache.get(key);
      const width = shapeWidth(fontFile, sample, direction, fontSize);
      cache.set(key, width);
      return width;
    });
    if (!rewritten) return full;
    return `<text${rewritten.attrs}>${rewritten.inner}</text>`;
  });
}

function subsetFont(source, characters, work, weight) {
  const textFile = path.join(work, `chars-${weight}.txt`);
  const output = path.join(work, `vazirmatn-${weight}.woff2`);
  writeFileSync(textFile, characters);
  const result = spawnSync(
    "pyftsubset",
    [
      source,
      `--output-file=${output}`,
      "--flavor=woff2",
      `--text-file=${textFile}`,
      "--layout-features=*",
      "--name-IDs=*",
      "--recommended-glyphs",
    ],
    { encoding: "utf8" },
  );
  if (result.error) throw new Error(`pyftsubset failed to start: ${result.error.message}`);
  if (result.status !== 0 || !existsSync(output)) {
    const detail = `${result.stderr || ""}${result.stdout || ""}`.trim();
    throw new Error(`pyftsubset failed for weight ${weight}\n${detail}`);
  }
  return readFileSync(output);
}

function fontFaceCss(weight, woff2) {
  const encoded = woff2.toString("base64");
  return `@font-face{font-family:"${EMBEDDED_FAMILY}";font-style:normal;font-weight:${weight};src:url("data:font/woff2;base64,${encoded}") format("woff2");}`;
}

function embedFonts(svgBuffer, fontDir, work, label, locale) {
  let svg = svgBuffer.toString("utf8");
  if (locale === "fa") svg = localizeSvgNumbers(svg);
  svg = layoutBidirectionalSvg(svg, fontDir);
  const weights = weightsIn(svg);
  const characters = charactersIn(svg);
  const faces = [];
  for (const weight of weights) {
    const fileName = WEIGHT_FILES.get(weight);
    const source = path.join(fontDir, fileName);
    if (!existsSync(source)) throw new Error(`${label}: missing chart font ${fileName}`);
    faces.push(fontFaceCss(weight, subsetFont(source, characters, work, weight)));
  }
  const rewritten = svg.replaceAll('font-family="Vazirmatn"', `font-family="${EMBEDDED_FAMILY}"`);
  if (rewritten === svg) throw new Error(`${label}: SVG did not reference Vazirmatn`);
  svg = rewritten;
  if (svg.includes('font-family="Vazirmatn"') || svg.includes("Noto Naskh") || svg.includes("sans-serif")) {
    throw new Error(`${label}: SVG still references a fallback font`);
  }
  const notice =
    "<!-- Vazirmatn subset. Copyright 2015 The Vazirmatn Project Authors (https://github.com/rastikerdar/vazirmatn). Licensed under the SIL Open Font License 1.1. https://scripts.sil.org/OFL -->";
  const style = `<defs><style type="text/css"><![CDATA[\n${faces.join("\n")}\n]]></style></defs>`;
  svg = svg.replace(/(<svg\b[^>]*>)/, `$1${notice}${style}`);
  if (!svg.includes(`font-family="${EMBEDDED_FAMILY}"`) || !svg.includes("data:font/woff2;base64,")) {
    throw new Error(`${label}: font embedding did not land in the SVG`);
  }
  return Buffer.from(svg);
}

function main() {
  const { check, only } = parseArgs(process.argv.slice(2));
  const fontDir = process.env.CHARTS_FONT_DIR || "";
  if (!fontDir) {
    fail("CHARTS_FONT_DIR is not set. Run nix run .#charts so text is measured with the pinned font.");
  }
  if (!existsSync(fontDir)) fail(`CHARTS_FONT_DIR does not exist: ${fontDir}`);

  let specs;
  try {
    specs = select(discover(contentRoots()), only);
  } catch (error) {
    fail(error.message);
  }
  if (specs.length === 0) fail("no .vl.json files found");

  const outputs = new Map();
  for (const specPath of specs) {
    const dest = svgPath(specPath);
    const previous = outputs.get(dest);
    if (previous) {
      fail(`output collision: ${relative(previous)} and ${relative(specPath)} both write ${relative(dest)}`);
    }
    outputs.set(dest, specPath);
  }

  const theme = loadTheme();
  const prepared = new Map();
  for (const specPath of specs) {
    try {
      prepared.set(specPath, prepare(specPath, theme));
    } catch (error) {
      fail(error.message);
    }
  }

  const vlConvert = "vl-convert";
  const work = mkdtempSync(path.join(tmpdir(), "abdolirad-charts-"));
  const rendered = [];
  try {
    const configPath = path.join(work, "empty-config.json");
    // An explicit config stops vl-convert from reading ~/.config/vl-convert/config.json.
    writeFileSync(configPath, "{}\n");
    for (const specPath of specs) {
      try {
        rendered.push({
          specPath,
          dest: svgPath(specPath),
          svg: renderOne(vlConvert, specPath, prepared.get(specPath), work, fontDir, configPath),
        });
      } catch (error) {
        fail(error.message);
      }
    }

    let svgStale = false;
    if (check) {
      for (const item of rendered) {
        const label = relative(item.dest);
        if (!existsSync(item.dest)) {
          console.error(`missing ${label}`);
          svgStale = true;
          continue;
        }
        if (!readFileSync(item.dest).equals(item.svg)) {
          console.error(`stale ${label}`);
          svgStale = true;
          continue;
        }
        console.log(`checked ${label}`);
      }
    } else {
      for (const item of rendered) {
        const temporary = `${item.dest}.tmp`;
        writeFileSync(temporary, item.svg);
        renameSync(temporary, item.dest);
        console.log(`rendered ${relative(item.dest)}`);
      }
    }

    const pngArgs = [path.join(repoRoot, "charts", "png.mjs")];
    if (only) pngArgs.push("--path", only);
    if (check) pngArgs.push("--check");
    const png = spawnSync(process.execPath, pngArgs, {
      cwd: repoRoot,
      encoding: "utf8",
      env: process.env,
      stdio: "inherit",
    });
    if (png.error) fail(`failed to run charts/png.mjs: ${png.error.message}`);
    if (svgStale || png.status !== 0) process.exit(1);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
