import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function readPage(publicDir, lang) {
  return readFileSync(path.join(publicDir, lang, "articles", "notes", "index.html"), "utf8");
}

test("chart images get a zoom link and ordinary images stay plain", () => {
  const built = buildFixture();
  try {
    assert.equal(built.result.status, 0, `${built.result.stdout}\n${built.result.stderr}`);
    const english = readPage(built.publicDir, "en");
    const persian = readPage(built.publicDir, "fa");
    for (const html of [english, persian]) {
      assert.match(html, /<img[^>]*alt="(?:Plain diagram|نمودار ساده)"[^>]*>/);
      assert.match(html, /class="chart-figure"/);
      assert.match(html, /class="chart-figure__open"[^>]*href="[^"]*widget\.(?:en|fa)\.svg"/);
      assert.match(html, /class="chart-viewer__stage"/);
      assert.match(html, /popstate/);
      assert.match(html, /preventDefault\(\)/);
    }
    assert.match(english, />View larger<span class="chart-figure__for">Widget counts for the north wing<\/span>/);
    assert.match(persian, />نمایش بزرگ‌تر<span class="chart-figure__for">شمارش ویجت برای بال شمالی<\/span>/);
    assert.match(english, /data-close="Close"/);
    assert.match(persian, /data-close="بستن"/);
    const plain = english.match(/<img[^>]*diagram\.png[^>]*>/)[0];
    assert.equal(plain.includes("chart-figure"), false);
    const plainArticle = readFileSync(path.join(built.publicDir, "en/articles/plain/index.html"), "utf8");
    assert.equal(plainArticle.includes('<figure class="chart-figure"'), false);
    assert.match(plainArticle, /chart-viewer__stage/);
  } finally {
    rmSync(built.dir, { recursive: true, force: true });
  }
});

function chromeAvailable() {
  const result = spawnSync("google-chrome", ["--version"], { encoding: "utf8" });
  return !result.error && result.status === 0;
}

test("the chart dialog opens, takes focus, zooms, and closes from Back", { skip: chromeAvailable() ? false : "google-chrome is not installed" }, async () => {
  const built = buildFixture();
  const userData = mkdtempSync(path.join(tmpdir(), "chart-chrome-"));
  let chrome;
  let server;
  try {
    assert.equal(built.result.status, 0, built.result.stderr);
    const pagePath = path.join(built.publicDir, "en", "articles", "notes", "index.html");
    assert.equal(existsSync(pagePath), true);
    server = createServer((request, response) => {
      const url = new URL(request.url, "http://127.0.0.1");
      let file = path.join(built.publicDir, decodeURIComponent(url.pathname));
      if (url.pathname.endsWith("/")) file = path.join(file, "index.html");
      if (!file.startsWith(built.publicDir) || !existsSync(file)) {
        response.writeHead(404);
        response.end("missing");
        return;
      }
      const type = file.endsWith(".svg") ? "image/svg+xml" : file.endsWith(".css") ? "text/css" : "text/html";
      response.writeHead(200, { "content-type": type });
      response.end(readFileSync(file));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const debugPort = port + 1;
    chrome = spawn(
      "google-chrome",
      [
        "--headless=new",
        "--disable-gpu",
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${userData}`,
        "about:blank",
      ],
      { stdio: "ignore" },
    );
    const target = await waitForTarget(debugPort, `http://127.0.0.1:${port}/en/articles/notes/`);
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve);
      ws.addEventListener("error", reject);
    });
    let id = 0;
    const pending = new Map();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    });
    const send = (method, params = {}) =>
      new Promise((resolve) => {
        id += 1;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });
    await send("Runtime.enable");
    const run = async (expression) => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const reply = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        if (reply.error?.message?.includes("Execution context was destroyed")) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          continue;
        }
        if (!reply.result) {
          throw new Error(JSON.stringify(reply));
        }
        if (reply.result.exceptionDetails) {
          const details = reply.result.exceptionDetails;
          throw new Error(details.exception?.description || details.text || "page error");
        }
        return reply.result.result.value;
      }
      throw new Error("page navigated away before the chart link was ready");
    };
    const ready = await run(`(async () => {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const link = document.querySelector(".chart-figure__open");
        if (link) return link.textContent;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return document.body ? document.body.innerText.slice(0, 120) : "no body";
    })()`);
    assert.match(ready, /View larger/);
    const opened = await run(`(() => {
      const link = document.querySelector(".chart-figure__open");
      link.click();
      const dialog = document.querySelector(".chart-viewer");
      const closeButton = dialog.querySelector("[data-action=close]");
      return {
        open: dialog.open,
        focused: document.activeElement === closeButton,
        label: dialog.querySelector(".chart-viewer__title").textContent,
        linkName: link.textContent.replace(/\\s+/g, " ").trim(),
      };
    })()`);
    assert.equal(opened.open, true);
    assert.equal(opened.focused, true);
    assert.equal(opened.label, "Widget counts for the north wing");
    assert.match(opened.linkName, /^View larger/);
    const zoomed = await run(`(async () => {
      const image = document.querySelector(".chart-viewer img");
      if (!image.complete) await new Promise((resolve) => image.addEventListener("load", resolve, { once: true }));
      const before = Number.parseFloat(image.style.width);
      document.querySelector("[data-action=in]").click();
      const after = Number.parseFloat(image.style.width);
      return { before, after };
    })()`);
    assert.ok(zoomed.after > zoomed.before, JSON.stringify(zoomed));
    const closed = await run(`(async () => {
      const dialog = document.querySelector(".chart-viewer");
      const done = new Promise((resolve) => window.addEventListener("popstate", () => resolve(dialog.open), { once: true }));
      history.back();
      return { open: await done };
    })()`);
    assert.equal(closed.open, false);
    const escaped = await run(`(async () => {
      document.querySelector(".chart-figure__open").click();
      const dialog = document.querySelector(".chart-viewer");
      const done = new Promise((resolve) => window.addEventListener("popstate", () => resolve(dialog.open), { once: true }));
      dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
      return { open: await done };
    })()`);
    assert.equal(escaped.open, false);
    ws.close();
  } finally {
    if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
      chrome.kill();
      await new Promise((resolve) => chrome.once("exit", resolve));
    }
    server?.close();
    rmSync(built.dir, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true, maxRetries: 5 });
  }
});

async function waitForTarget(port, url) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
      if (response.ok) return response.json();
    } catch {
      // Chrome is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("chrome did not open a debugging target");
}
