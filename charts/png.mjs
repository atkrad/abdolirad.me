import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
import { contentRoots } from "./render.mjs";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SCALE = 2;
const BROWSER_CANDIDATES = ["chromium", "google-chrome", "chromium-browser", "chrome"];

const repoRoot = process.cwd();

function fail(message) {
  console.error(message);
  process.exit(1);
}

function help() {
  console.log(`Usage: node charts/png.mjs [options]

Write a 2x PNG next to every content SVG under the Hugo content roots.
Theme icons and other files outside those roots are ignored.

Needs a Chromium-based browser (CHARTS_BROWSER) to convert. Without one, the
command only checks that each SVG already has a PNG companion (Cloudflare builds).

Chromium screenshots the SVG as an <img>, so embedded fonts and the absolute
tspan layout used for mixed RTL labels match what browsers show.

Options:
  --help           Show this help
  --check          Compare a fresh PNG with the committed file. Needs a browser.
                   Does not modify the tree.
  --path <path>    Limit to one .svg or .vl.json file, or every SVG under a directory
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

function relative(file) {
  const rel = path.relative(repoRoot, file);
  return rel.startsWith("..") ? file : rel;
}

function walkSvgs(directory, found) {
  for (const name of readdirSync(directory)) {
    if (name === ".git" || name === "node_modules") continue;
    const full = path.join(directory, name);
    const info = statSync(full);
    if (info.isDirectory()) {
      walkSvgs(full, found);
      continue;
    }
    if (name.endsWith(".svg")) found.push(full);
  }
}

export function discoverContentSvgs(roots) {
  const found = [];
  for (const root of roots) {
    if (!existsSync(root)) throw new Error(`content root does not exist: ${path.relative(repoRoot, root)}`);
    walkSvgs(root, found);
  }
  found.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return found;
}

function resolveSelectionTarget(only) {
  let target = path.resolve(repoRoot, only);
  if (!existsSync(target)) throw new Error(`path not found: ${only}`);
  // charts --path may pass a .vl.json; the PNG lives next to the matching SVG.
  if (statSync(target).isFile() && target.endsWith(".vl.json")) {
    target = `${target.slice(0, -".vl.json".length)}.svg`;
  }
  return target;
}

export function selectSvgs(svgs, only) {
  if (!only) return svgs;
  const target = resolveSelectionTarget(only);
  if (statSync(target).isFile()) {
    if (!target.endsWith(".svg")) throw new Error(`not an SVG file: ${only}`);
    if (!svgs.includes(target)) throw new Error(`SVG is outside the Hugo content roots: ${only}`);
    return [target];
  }
  const prefix = target.endsWith(path.sep) ? target : `${target}${path.sep}`;
  const picked = svgs.filter((svg) => svg.startsWith(prefix));
  if (picked.length === 0) throw new Error(`no .svg files under ${only}`);
  return picked;
}

export function pngPathFor(svgPath) {
  if (!svgPath.endsWith(".svg")) throw new Error(`refusing non-SVG path: ${svgPath}`);
  return `${svgPath.slice(0, -".svg".length)}.png`;
}

export function svgPixelSize(svgText) {
  const width = Number((svgText.match(/\bwidth="([0-9.]+)"/) || [])[1]);
  const height = Number((svgText.match(/\bheight="([0-9.]+)"/) || [])[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("SVG is missing numeric width and height attributes");
  }
  return { width, height };
}

function which(command) {
  // `command -v` is a shell builtin; spawn through sh so PATH lookup works.
  const result = spawnSync("sh", ["-c", 'command -v "$1"', "sh", command], { encoding: "utf8" });
  if (result.error || result.status !== 0) return null;
  const resolved = (result.stdout || "").trim();
  return resolved || null;
}

export function resolveBrowser(explicit = process.env.CHARTS_BROWSER || "") {
  if (explicit) {
    if (!existsSync(explicit)) throw new Error(`CHARTS_BROWSER does not exist: ${explicit}`);
    return explicit;
  }
  for (const name of BROWSER_CANDIDATES) {
    const found = which(name);
    if (found) return found;
  }
  return null;
}

export function isPngBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE);
}

// Only convert when Nix (or the caller) sets CHARTS_BROWSER. A random Chrome on
// PATH would rewrite committed PNGs during plain `npm run build` and break --check.
export function canConvert({ browser = process.env.CHARTS_BROWSER || "" } = {}) {
  return Boolean(browser && existsSync(browser));
}

export function rasterPageHtml(svgFileName, cssWidth, cssHeight) {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
html,body{margin:0;width:${cssWidth}px;height:${cssHeight}px;background:#fff;overflow:hidden}
img{display:block;width:${cssWidth}px;height:${cssHeight}px}
</style></head>
<body><img src="${svgFileName}" width="${cssWidth}" height="${cssHeight}" alt=""></body></html>
`;
}

export function convertSvgToPng(
  svgPath,
  { browser = process.env.CHARTS_BROWSER || "", scale = SCALE, workDir } = {},
) {
  const binary = resolveBrowser(browser);
  if (!binary) {
    throw new Error("no Chromium browser found; set CHARTS_BROWSER or run inside nix develop");
  }
  const source = readFileSync(svgPath, "utf8");
  if (!source.includes("<svg")) throw new Error(`${relative(svgPath)} is not an SVG`);
  const { width, height } = svgPixelSize(source);
  const cssWidth = Math.round(width * scale);
  const cssHeight = Math.round(height * scale);

  const ownWork = !workDir;
  const work = workDir || mkdtempSync(path.join(tmpdir(), "abdolirad-png-"));
  try {
    const id = createHash("sha256").update(svgPath).digest("hex").slice(0, 16);
    const inputSvg = path.join(work, `${id}.svg`);
    const inputHtml = path.join(work, `${id}.html`);
    const output = path.join(work, `${id}.png`);
    writeFileSync(inputSvg, source);
    writeFileSync(inputHtml, rasterPageHtml(path.basename(inputSvg), cssWidth, cssHeight));

    const result = spawnSync(
      binary,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--hide-scrollbars",
        "--virtual-time-budget=5000",
        "--force-device-scale-factor=1",
        `--window-size=${cssWidth},${cssHeight}`,
        `--screenshot=${output}`,
        pathToFileURL(inputHtml).href,
      ],
      { encoding: "utf8" },
    );
    if (result.error) {
      throw new Error(`${relative(svgPath)}: failed to run browser: ${result.error.message}`);
    }
    if (result.status !== 0) {
      const detail = `${result.stderr || ""}${result.stdout || ""}`.trim();
      throw new Error(`${relative(svgPath)}: browser screenshot failed\n${detail}`);
    }
    if (!existsSync(output)) throw new Error(`${relative(svgPath)}: browser wrote no PNG`);
    const png = readFileSync(output);
    if (!isPngBuffer(png)) throw new Error(`${relative(svgPath)}: browser wrote a non-PNG file`);
    return png;
  } finally {
    if (ownWork) rmSync(work, { recursive: true, force: true });
  }
}

function requireCompanions(svgs) {
  let missing = false;
  for (const svg of svgs) {
    const dest = pngPathFor(svg);
    const label = relative(dest);
    if (!existsSync(dest) || !isPngBuffer(readFileSync(dest))) {
      console.error(`missing ${label}`);
      missing = true;
      continue;
    }
    console.log(`checked ${label}`);
  }
  if (missing) {
    fail(
      "content SVG files are missing PNG companions. Run `nix develop -c node charts/png.mjs` (or `nix run .#charts`) and commit the PNGs.",
    );
  }
}

function main() {
  const { check, only } = parseArgs(process.argv.slice(2));
  let svgs;
  try {
    svgs = selectSvgs(discoverContentSvgs(contentRoots()), only);
  } catch (error) {
    fail(error.message);
  }
  if (svgs.length === 0) {
    console.log("no content SVG files found");
    return;
  }

  if (check && !canConvert()) {
    fail("--check needs a Chromium browser; set CHARTS_BROWSER or run inside nix develop");
  }

  if (!canConvert()) {
    console.log("Chromium browser unavailable; verifying committed PNG companions");
    requireCompanions(svgs);
    return;
  }

  const work = mkdtempSync(path.join(tmpdir(), "abdolirad-png-"));
  try {
    let stale = false;
    for (const svg of svgs) {
      const dest = pngPathFor(svg);
      let png;
      try {
        png = convertSvgToPng(svg, { workDir: work });
      } catch (error) {
        fail(error.message);
      }
      const label = relative(dest);
      if (check) {
        if (!existsSync(dest) || !readFileSync(dest).equals(png)) {
          console.error(existsSync(dest) ? `stale ${label}` : `missing ${label}`);
          stale = true;
          continue;
        }
        console.log(`checked ${label}`);
        continue;
      }
      if (existsSync(dest) && readFileSync(dest).equals(png)) {
        console.log(`unchanged ${label}`);
        continue;
      }
      const temporary = `${dest}.tmp`;
      writeFileSync(temporary, png);
      renameSync(temporary, dest);
      console.log(`wrote ${label}`);
    }
    if (check && stale) process.exit(1);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
