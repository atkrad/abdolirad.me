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
const EMBEDDED_FAMILY = "Vazirmatn Embedded";
const RASTER_FAMILY = "Vazirmatn";

const repoRoot = process.cwd();

function fail(message) {
  console.error(message);
  process.exit(1);
}

function help() {
  console.log(`Usage: node charts/png.mjs [options]

Write a 2x PNG next to every content SVG under the Hugo content roots.
Theme icons and other files outside those roots are ignored.

Needs vl-convert and CHARTS_FONT_DIR to convert. Without them, the command
only checks that each SVG already has a PNG companion (Cloudflare builds).

Options:
  --help           Show this help
  --check          Compare a fresh PNG with the committed file. Needs conversion
                   tools. Does not modify the tree.
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

// vl-convert svg2png does not paint WOFF2 data URLs. Point text at the TTF
// files in CHARTS_FONT_DIR instead, and drop only the embedded @font-face rules.
export function prepareSvgForRaster(svgText) {
  if (!svgText.includes(EMBEDDED_FAMILY)) return svgText;
  let next = svgText.replaceAll(EMBEDDED_FAMILY, RASTER_FAMILY);
  next = next.replace(/@font-face\{[^}]*data:font\/woff2;base64,[^}]*\}/g, "");
  next = next.replace(/<defs><style type="text\/css"><!\[CDATA\[\s*\]\]><\/style><\/defs>/g, "");
  return next;
}

export function isPngBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE);
}

export function canConvert({ fontDir = process.env.CHARTS_FONT_DIR || "", vlConvert = "vl-convert" } = {}) {
  if (!fontDir || !existsSync(fontDir)) return false;
  const result = spawnSync(vlConvert, ["--help"], { encoding: "utf8" });
  return !result.error && result.status === 0;
}

export function convertSvgToPng(svgPath, { fontDir, vlConvert = "vl-convert", scale = SCALE, workDir } = {}) {
  if (!fontDir || !existsSync(fontDir)) {
    throw new Error("CHARTS_FONT_DIR is not set or does not exist");
  }
  const source = readFileSync(svgPath, "utf8");
  if (!source.includes("<svg")) throw new Error(`${relative(svgPath)} is not an SVG`);
  const prepared = prepareSvgForRaster(source);
  const ownWork = !workDir;
  const work = workDir || mkdtempSync(path.join(tmpdir(), "abdolirad-png-"));
  try {
    const id = createHash("sha256").update(svgPath).digest("hex").slice(0, 16);
    const input = path.join(work, `${id}.svg`);
    const output = path.join(work, `${id}.png`);
    writeFileSync(input, prepared);
    const result = spawnSync(
      vlConvert,
      ["svg2png", "--input", input, "--output", output, "--scale", String(scale), "--font-dir", fontDir],
      { encoding: "utf8" },
    );
    if (result.error) throw new Error(`${relative(svgPath)}: failed to run vl-convert: ${result.error.message}`);
    if (result.status !== 0) {
      const detail = `${result.stderr || ""}${result.stdout || ""}`.trim();
      throw new Error(`${relative(svgPath)}: vl-convert svg2png failed\n${detail}`);
    }
    if (!existsSync(output)) throw new Error(`${relative(svgPath)}: vl-convert wrote no PNG`);
    const png = readFileSync(output);
    if (!isPngBuffer(png)) throw new Error(`${relative(svgPath)}: vl-convert wrote a non-PNG file`);
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
    fail("--check needs vl-convert and CHARTS_FONT_DIR; run inside nix develop");
  }

  if (!canConvert()) {
    console.log("vl-convert or CHARTS_FONT_DIR unavailable; verifying committed PNG companions");
    requireCompanions(svgs);
    return;
  }

  const fontDir = process.env.CHARTS_FONT_DIR;
  const work = mkdtempSync(path.join(tmpdir(), "abdolirad-png-"));
  try {
    let stale = false;
    for (const svg of svgs) {
      const dest = pngPathFor(svg);
      let png;
      try {
        png = convertSvgToPng(svg, { fontDir, workDir: work });
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
