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
  "/en/assets/css/site.css": { body: "body{}", type: "text/css" },
  "/fa/assets/css/site.css": { body: "body{}", type: "text/css" },
  "/en/linked.html": {
    body: '<a href="https://abdolirad.me/articles/?q=a%20b#x">post</a>',
    type: "text/html",
  },
  "/fa/only-fa.txt": { body: "persian-only", type: "text/plain" },
  "/en/100%25.txt": { body: "percent", type: "text/plain" },
  "/en/release..notes.txt": { body: "notes", type: "text/plain" },
  "/en/a%3Fb/index.html": { body: "<html>question</html>", type: "text/html" },
  "/fa/%D9%85%D9%82%D8%A7%D9%84%D9%87/index.html": { body: "<html>fa-slug</html>", type: "text/html" },
  "/en/articles/the-decisions-behind-the-code/index.html": {
    body: "<html>en-post</html>",
    type: "text/html",
  },
  "/fa/articles/the-decisions-behind-the-code/index.html": {
    body: "<html>fa-post</html>",
    type: "text/html",
  },
  "/en/articles/bundle-note/diagram.png": { body: "png-en", type: "image/png" },
  "/fa/articles/bundle-note/diagram.png": { body: "png-fa", type: "image/png" },
};

const ETAG = '"asset"';
const PREVIEW = "https://switch-homepage-to-home-info-abdolirad.example.workers.dev";

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

test("production and local hosts serve the selected language", async () => {
  const english = await simulateRequest("https://abdolirad.me/");
  assert.equal(english.response.status, 200);
  assert.equal(english.body, "<html>en-home</html>");
  assert.deepEqual(english.calls.map((call) => call.pathname), ["/en/index.html"]);
  assert.equal(english.response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(english.response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.equal(english.response.headers.get("access-control-allow-origin"), "*");

  const persian = await simulateRequest("https://abdolirad.ir/articles/");
  assert.equal(persian.body, "<html>fa-articles</html>");

  const local = await simulateRequest("http://fa.localhost:8787/");
  assert.equal(local.body, "<html>fa-home</html>");

  const head = await simulateRequest("https://abdolirad.me/", { method: "HEAD" });
  assert.equal(head.response.status, 200);
  assert.equal(head.body, "");
});

test("assets and directory redirects stay on the host language", async () => {
  const css = await simulateRequest("https://abdolirad.ir/assets/css/site.css?v=1");
  assert.equal(css.response.status, 200);
  assert.equal(css.response.headers.get("content-type"), "text/css");
  assert.equal(css.calls[0].pathname, "/fa/assets/css/site.css");

  const redirect = await simulateRequest("https://abdolirad.me/articles?x=1");
  assert.equal(redirect.response.status, 308);
  assert.equal(redirect.response.headers.get("location"), "/articles/?x=1");
});

test("unknown paths and hosts stay inside one language", async () => {
  const missing = await simulateRequest("https://abdolirad.ir/missing");
  assert.equal(missing.response.status, 404);
  assert.equal(missing.body, "<html>fa-404</html>");

  const isolated = await simulateRequest("https://abdolirad.me/fa/only-fa.txt");
  assert.equal(isolated.response.status, 404);
  assert.equal(isolated.body, "<html>en-404</html>");
  assert.ok(isolated.calls.every((call) => call.pathname.startsWith("/en/")));

  const unknown = await simulateRequest("https://example.com/");
  assert.equal(unknown.response.status, 404);
  assert.equal(unknown.calls.length, 0);
});

test("bundle assets stay on the requesting host", async () => {
  const english = await simulateRequest("https://abdolirad.me/articles/bundle-note/diagram.png");
  assert.equal(english.response.status, 200);
  assert.equal(english.body, "png-en");
  assert.equal(english.response.headers.get("content-type"), "image/png");
  assert.equal(english.calls[0].pathname, "/en/articles/bundle-note/diagram.png");
  assert.equal(english.response.headers.get("location"), null);

  const persian = await simulateRequest("https://abdolirad.ir/articles/bundle-note/diagram.png");
  assert.equal(persian.response.status, 200);
  assert.equal(persian.body, "png-fa");
  assert.equal(persian.calls[0].pathname, "/fa/articles/bundle-note/diagram.png");
  assert.equal(persian.response.headers.get("location"), null);
});

test("unsupported methods are rejected", async () => {
  const post = await simulateRequest("https://abdolirad.me/", { method: "POST" });
  assert.equal(post.response.status, 405);
  assert.equal(post.response.headers.get("allow"), "GET, HEAD");
  assert.match(post.body, /Method not allowed/);
  assert.equal(post.calls.length, 0);

  const preview = await simulateRequest(`${PREVIEW}/`, { method: "POST" });
  assert.equal(preview.response.status, 405);
  assert.equal(preview.response.headers.get("x-robots-tag"), "noindex, nofollow");
});

test("published welcome article paths redirect permanently", async () => {
  const english = await simulateRequest("https://abdolirad.me/articles/welcome-to-my-blog/");
  assert.equal(english.response.status, 301);
  assert.equal(english.response.headers.get("location"), "/articles/the-decisions-behind-the-code/");
  assert.equal(english.calls.length, 0);

  const persian = await simulateRequest("https://abdolirad.ir/articles/welcome-to-my-blog");
  assert.equal(persian.response.status, 301);
  assert.equal(persian.response.headers.get("location"), "/articles/the-decisions-behind-the-code/");
  assert.equal(persian.calls.length, 0);

  const query = await simulateRequest("https://abdolirad.me/articles/welcome-to-my-blog/?utm=old");
  assert.equal(query.response.headers.get("location"), "/articles/the-decisions-behind-the-code/?utm=old");

  const head = await simulateRequest("https://abdolirad.ir/articles/welcome-to-my-blog/", { method: "HEAD" });
  assert.equal(head.response.status, 301);
  assert.equal(head.body, "");

  const prefixed = await simulateRequest(`${PREVIEW}/fa/articles/welcome-to-my-blog/`);
  assert.equal(prefixed.response.status, 301);
  assert.equal(prefixed.response.headers.get("location"), "/fa/articles/the-decisions-behind-the-code/");
  assert.equal(prefixed.response.headers.get("x-robots-tag"), "noindex, nofollow");

  const current = await simulateRequest("https://abdolirad.me/articles/the-decisions-behind-the-code/");
  assert.equal(current.response.status, 200);
  assert.equal(current.body, "<html>en-post</html>");

  const nested = await simulateRequest("https://abdolirad.me/articles/welcome-to-my-blog/extra");
  assert.equal(nested.response.status, 404);
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

test("preview hosts serve both languages and stay out of search indexes", async () => {
  const english = await simulateRequest(`${PREVIEW}/`);
  assert.equal(english.body, "<html>en-home</html>");
  assert.equal(english.response.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.equal(english.calls[0].pathname, "/en/index.html");

  const query = await simulateRequest(`${PREVIEW}/articles/?lang=fa`);
  assert.equal(query.body, "<html>fa-articles</html>");
  assert.equal(query.calls[0].pathname, "/fa/articles/index.html");

  const prefixed = await simulateRequest(`${PREVIEW}/fa/articles`);
  assert.equal(prefixed.response.status, 308);
  assert.equal(prefixed.response.headers.get("location"), "/fa/articles/");
  assert.equal(prefixed.response.headers.get("x-robots-tag"), "noindex, nofollow");
  const prefixedPage = await simulateRequest(`${PREVIEW}/fa/articles/`);
  assert.equal(prefixedPage.body, "<html>fa-articles</html>");

  const header = await simulateRequest(`${PREVIEW}/`, { headers: { "x-blog-host": "abdolirad.ir" } });
  assert.equal(header.body, "<html>fa-home</html>");

  const pathWins = await simulateRequest(`${PREVIEW}/fa/?lang=en`);
  assert.equal(pathWins.body, "<html>fa-home</html>");

  const invalid = await simulateRequest(`${PREVIEW}/?lang=de`);
  assert.equal(invalid.response.status, 404);
  assert.equal(invalid.response.headers.get("x-robots-tag"), "noindex, nofollow");

  const badHeader = await simulateRequest(`${PREVIEW}/`, { headers: { "x-blog-host": "example.com" } });
  assert.equal(badHeader.response.status, 404);

  const robots = await simulateRequest(`${PREVIEW}/robots.txt`);
  assert.equal(robots.response.status, 200);
  assert.match(robots.body, /Disallow:\s*\//);
  assert.equal(robots.calls.length, 0);

  const production = await simulateRequest("https://abdolirad.me/?lang=fa");
  assert.equal(production.body, "<html>en-home</html>");
  assert.equal(production.response.headers.get("x-robots-tag"), null);

  const hidden = await simulateRequest("https://abdolirad.me/fa/");
  assert.equal(hidden.response.status, 404);
  assert.equal(hidden.response.headers.get("x-robots-tag"), null);
});

test("preview assets, redirects, and validators stay valid", async () => {
  const css = await simulateRequest(`${PREVIEW}/assets/css/site.css`);
  assert.equal(css.response.status, 200);
  assert.equal(css.response.headers.get("content-type"), "text/css");
  assert.equal(css.body, "body{}");
  assert.equal(css.response.headers.get("etag"), ETAG);
  assert.equal(css.calls[0].pathname, "/en/assets/css/site.css");

  const persianCss = await simulateRequest(`${PREVIEW}/fa/assets/css/site.css`);
  assert.equal(persianCss.response.status, 200);
  assert.equal(persianCss.body, "body{}");
  assert.equal(persianCss.calls[0].pathname, "/fa/assets/css/site.css");

  const head = await simulateRequest(`${PREVIEW}/`, { method: "HEAD" });
  assert.equal(head.response.status, 200);
  assert.equal(head.body, "");
  assert.equal(head.response.headers.get("etag"), ETAG);
  assert.equal(head.response.headers.get("content-type"), "text/html");

  const fresh = await simulateRequest(`${PREVIEW}/`, { headers: { "if-none-match": ETAG } });
  assert.equal(fresh.response.status, 304);
  assert.equal(fresh.body, "");
  assert.equal(fresh.response.headers.get("etag"), ETAG);

  const redirect = await simulateRequest(`${PREVIEW}/en/articles`);
  assert.equal(redirect.response.status, 308);
  assert.equal(redirect.response.headers.get("location"), "/en/articles/");
  const page = await simulateRequest(`${PREVIEW}/en/articles/`);
  assert.equal(page.response.status, 200);
  assert.equal(page.body, "<html>en-articles</html>");

  const linked = await simulateRequest("https://abdolirad.me/linked.html");
  assert.equal(linked.response.status, 200);
  assert.equal(linked.body, '<a href="https://abdolirad.me/articles/?q=a%20b#x">post</a>');
  assert.equal(linked.response.headers.get("etag"), ETAG);
  assert.equal(linked.response.headers.get("x-robots-tag"), null);
});
