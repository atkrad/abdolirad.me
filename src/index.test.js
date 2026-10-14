import assert from "node:assert/strict";
import test from "node:test";
import { handleRequest } from "./routing.js";

// In-memory requests. handleRequest is called directly with a mock ASSETS binding.
const files = {
  "/en/index.html": { body: "<html>en-home</html>", type: "text/html" },
  "/fa/index.html": { body: "<html>fa-home</html>", type: "text/html" },
  "/en/articles/index.html": { body: "<html>en-articles</html>", type: "text/html" },
  "/fa/articles/index.html": { body: "<html>fa-articles</html>", type: "text/html" },
  "/en/404.html": { body: "<html>en-404</html>", type: "text/html" },
  "/fa/404.html": { body: "<html>fa-404</html>", type: "text/html" },
  "/fa/assets/css/site.css": { body: "body{}", type: "text/css" },
  "/fa/only-fa.txt": { body: "persian-only", type: "text/plain" },
  "/en/100%25.txt": { body: "percent", type: "text/plain" },
  "/en/release..notes.txt": { body: "notes", type: "text/plain" },
  "/en/a%3Fb/index.html": { body: "<html>question</html>", type: "text/html" },
  "/fa/%D9%85%D9%82%D8%A7%D9%84%D9%87/index.html": { body: "<html>fa-slug</html>", type: "text/html" },
};

const ETAG = '"asset"';

function mockAssets() {
  const calls = [];
  return {
    calls,
    env: {
      ASSETS: {
        async fetch(request) {
          const url = new URL(request.url);
          calls.push({ pathname: url.pathname, ifNoneMatch: request.headers.get("if-none-match") });
          const file = files[url.pathname];
          if (!file) return new Response("missing", { status: 404 });
          const headers = new Headers({ "content-type": file.type, etag: ETAG });
          if (request.headers.get("if-none-match") === ETAG) return new Response(null, { status: 304, headers });
          if (request.method === "HEAD") return new Response(null, { status: 200, headers });
          return new Response(file.body, { status: 200, headers });
        },
      },
    },
  };
}

async function simulateRequest(url, { method = "GET", headers } = {}) {
  const { env, calls } = mockAssets();
  const response = await handleRequest(new Request(url, { method, headers }), env);
  const body = method === "HEAD" ? "" : await response.text();
  return { response, body, calls };
}

test("hosts select a language, page, asset, 404, and slash redirect", async () => {
  const english = await simulateRequest("https://abdolirad.me/");
  assert.equal(english.response.status, 200);
  assert.equal(english.body, "<html>en-home</html>");
  assert.deepEqual(english.calls.map((call) => call.pathname), ["/en/index.html"]);

  const persian = await simulateRequest("https://abdolirad.ir/articles/");
  assert.equal(persian.body, "<html>fa-articles</html>");

  const local = await simulateRequest("http://fa.localhost:8787/");
  assert.equal(local.body, "<html>fa-home</html>");

  const css = await simulateRequest("https://abdolirad.ir/assets/css/site.css?v=1");
  assert.equal(css.response.status, 200);
  assert.equal(css.response.headers.get("content-type"), "text/css");
  assert.equal(css.calls[0].pathname, "/fa/assets/css/site.css");

  const missing = await simulateRequest("https://abdolirad.ir/missing");
  assert.equal(missing.response.status, 404);
  assert.equal(missing.body, "<html>fa-404</html>");

  const redirect = await simulateRequest("https://abdolirad.me/articles?x=1");
  assert.equal(redirect.response.status, 308);
  assert.equal(redirect.response.headers.get("location"), "/articles/?x=1");

  const head = await simulateRequest("https://abdolirad.me/", { method: "HEAD" });
  assert.equal(head.response.status, 200);
  assert.equal(head.body, "");

  const isolated = await simulateRequest("https://abdolirad.me/fa/only-fa.txt");
  assert.equal(isolated.response.status, 404);
  assert.equal(isolated.body, "<html>en-404</html>");
  assert.ok(isolated.calls.every((call) => call.pathname.startsWith("/en/")));

  const unknown = await simulateRequest("https://example.com/");
  assert.equal(unknown.response.status, 404);
  assert.equal(unknown.calls.length, 0);
});

test("conditional requests stay 304, and slash probes ignore them", async () => {
  const home = await simulateRequest("https://abdolirad.me/", { headers: { "if-none-match": ETAG } });
  assert.equal(home.response.status, 304);
  assert.equal(home.body, "");
  assert.equal(home.response.headers.get("etag"), ETAG);

  const redirect = await simulateRequest("https://abdolirad.me/articles", { headers: { "if-none-match": ETAG } });
  assert.equal(redirect.response.status, 308);
  assert.equal(redirect.response.headers.get("location"), "/articles/");
  assert.equal(redirect.calls.at(-1).ifNoneMatch, null);
});

test("encoded paths and Persian slugs keep their public form", async () => {
  const slug = await simulateRequest("https://abdolirad.ir/مقاله");
  assert.equal(slug.response.status, 308);
  assert.equal(slug.response.headers.get("location"), "/%D9%85%D9%82%D8%A7%D9%84%D9%87/");
  const page = await simulateRequest("https://abdolirad.ir/مقاله/");
  assert.equal(page.response.status, 200);
  assert.equal(page.body, "<html>fa-slug</html>");

  const question = await simulateRequest("https://abdolirad.me/a%3Fb");
  assert.equal(question.response.headers.get("location"), "/a%3Fb/");

  const percent = await simulateRequest("https://abdolirad.me/100%25.txt");
  assert.equal(percent.response.status, 200);
  assert.equal(percent.body, "percent");

  const notes = await simulateRequest("https://abdolirad.me/release..notes.txt");
  assert.equal(notes.response.status, 200);
  assert.equal(notes.body, "notes");

  const traversal = await simulateRequest("https://abdolirad.me/%2e%2e%2fonly-fa.txt");
  assert.equal(traversal.response.status, 404);
  assert.notEqual(traversal.body, "persian-only");
  assert.ok(traversal.calls.every((call) => call.pathname.startsWith("/en/")));
});
