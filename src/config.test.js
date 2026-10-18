import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PRODUCTION_HOSTS } from "./hosts.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(name) {
  return readFileSync(path.join(root, name), "utf8");
}

// Wrangler has no stable API for the resolved config. These checks read the keys the Worker uses.
function assetSettings(toml) {
  return {
    directory: toml.match(/directory\s*=\s*"([^"]+)"/)?.[1],
    binding: toml.match(/binding\s*=\s*"([^"]+)"/)?.[1],
    runWorkerFirst: /run_worker_first\s*=\s*true/.test(toml),
    htmlHandling: toml.match(/html_handling\s*=\s*"([^"]+)"/)?.[1],
    notFoundHandling: toml.match(/not_found_handling\s*=\s*"([^"]+)"/)?.[1],
  };
}

test("development and production use the same asset settings", () => {
  const prod = assetSettings(read("wrangler.toml"));
  const dev = assetSettings(read("wrangler.dev.toml"));
  assert.deepEqual(dev, prod);
  assert.equal(prod.runWorkerFirst, true);
  assert.equal(prod.htmlHandling, "none");
  assert.equal(prod.notFoundHandling, "none");
});

test("production routes match the host map and previews stay unrouted", () => {
  const prod = read("wrangler.toml");
  const dev = read("wrangler.dev.toml");
  const domains = [...prod.matchAll(/\{\s*pattern\s*=\s*"([^"]+)"\s*,\s*custom_domain\s*=\s*true\s*\}/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(domains, Object.keys(PRODUCTION_HOSTS));
  assert.equal(/custom_domain\s*=\s*true/.test(dev), false);
  assert.match(prod, /previews\s*=\s*\{\s*\}/);
  assert.equal(/\[\[previews\.routes\]\]|previews_enabled\s*=\s*true/.test(prod), false);
});
