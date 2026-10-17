import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { rewritePreviewHref } from "./preview-links.js";

const PREVIEW = "https://switch-homepage-to-home-info-abdolirad.example.workers.dev";

test("preview hrefs map production hosts and keep everything else", () => {
  assert.equal(rewritePreviewHref("https://abdolirad.me/", "en"), "/en/");
  assert.equal(rewritePreviewHref("https://abdolirad.me", "en"), "/en/");
  assert.equal(rewritePreviewHref("https://abdolirad.me/articles/", "en"), "/en/articles/");
  assert.equal(rewritePreviewHref("https://abdolirad.ir/", "fa"), "/fa/");
  assert.equal(rewritePreviewHref("https://abdolirad.ir/articles/", "fa"), "/fa/articles/");
  assert.equal(rewritePreviewHref("http://abdolirad.me/articles/", "en"), "/en/articles/");
  assert.equal(rewritePreviewHref("//abdolirad.ir/archives/", "en"), "/fa/archives/");
  assert.equal(rewritePreviewHref("https://ABDOLIRAD.me/Articles/", "en"), "/en/Articles/");
  assert.equal(rewritePreviewHref("https://abdolirad.me:443/articles/", "en"), "/en/articles/");
  assert.equal(rewritePreviewHref("https://abdolirad.me./articles/", "en"), "/en/articles/");
  assert.equal(
    rewritePreviewHref("https://abdolirad.me/articles/?page=2#results", "fa"),
    "/en/articles/?page=2#results",
  );
  assert.equal(
    rewritePreviewHref("https://abdolirad.ir/%D9%85%D9%82%D8%A7%D9%84%D9%87/?q=a%20b#x", "en"),
    "/fa/%D9%85%D9%82%D8%A7%D9%84%D9%87/?q=a%20b#x",
  );
  assert.equal(rewritePreviewHref("  https://abdolirad.me/  ", "en"), "/en/");

  assert.equal(rewritePreviewHref("/", "fa"), "/fa/");
  assert.equal(rewritePreviewHref("/articles/", "fa"), "/fa/articles/");
  assert.equal(rewritePreviewHref("/index.xml", "en"), "/en/index.xml");
  assert.equal(rewritePreviewHref("/articles/?a=1&b=2#z", "en"), "/en/articles/?a=1&b=2#z");
  assert.equal(rewritePreviewHref("/en/articles/", "fa"), "/en/articles/");
  assert.equal(rewritePreviewHref("/fa/", "en"), "/fa/");
  assert.equal(rewritePreviewHref("/assets/css/site.css?v=1", "fa"), "/assets/css/site.css?v=1");
  assert.equal(rewritePreviewHref("/favicon.ico", "en"), "/favicon.ico");
  assert.equal(rewritePreviewHref("#top", "fa"), "#top");
  assert.equal(rewritePreviewHref("#2025-%da%98", "fa"), "#2025-%da%98");
  assert.equal(rewritePreviewHref("articles/", "en"), "articles/");
  assert.equal(rewritePreviewHref("mailto:m.abdolirad@gmail.com", "en"), "mailto:m.abdolirad@gmail.com");
  assert.equal(rewritePreviewHref("javascript:alert(1)", "en"), "javascript:alert(1)");
  assert.equal(rewritePreviewHref("https://github.com/atkrad", "en"), "https://github.com/atkrad");
  assert.equal(rewritePreviewHref("https://not-abdolirad.me/", "en"), "https://not-abdolirad.me/");
  assert.equal(rewritePreviewHref("https://abdolirad.me.evil.com/", "en"), "https://abdolirad.me.evil.com/");
  assert.equal(rewritePreviewHref("https://abdolirad.me:8443/articles/", "en"), "https://abdolirad.me:8443/articles/");
  assert.equal(rewritePreviewHref("https://user:pass@abdolirad.me/", "en"), "https://user:pass@abdolirad.me/");
  assert.equal(
    rewritePreviewHref("https://x.com/intent/tweet/?url=https%3a%2f%2fabdolirad.me%2f", "en"),
    "https://x.com/intent/tweet/?url=https%3a%2f%2fabdolirad.me%2f",
  );
  assert.equal(rewritePreviewHref("", "en"), "");
  assert.equal(rewritePreviewHref("/articles/", ""), "/articles/");
});

test("HTMLRewriter keeps preview navigation inside the deployment", async () => {
  const english = page("https://abdolirad.me/", "https://abdolirad.ir/");
  const persian = page("https://abdolirad.ir/", "https://abdolirad.me/");
  const files = {
    "/en/index.html": { body: english, type: "text/html; charset=utf-8" },
    "/fa/index.html": { body: persian, type: "text/html; charset=utf-8" },
    "/en/404.html": { body: "<a href=https://abdolirad.me/>home</a>", type: "text/html; charset=utf-8" },
    "/fa/404.html": { body: "<a href=https://abdolirad.ir/>home</a>", type: "text/html; charset=utf-8" },
    "/en/assets/css/site.css": { body: "body{}", type: "text/css" },
    "/en/data.json": { body: '{"url":"https://abdolirad.me/"}', type: "application/json" },
    "/en/feed.xml": { body: "<url>https://abdolirad.me/</url>", type: "application/xml" },
    "/en/note.txt": { body: "https://abdolirad.me/", type: "text/plain; charset=utf-8" },
    "/en/encoded.html": { body: "not-html", type: "text/html; charset=utf-8", encoding: "gzip" },
  };
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "preview",
          compatibilityDate: "2026-10-14",
          modules: [
            {
              type: "ESModule",
              path: "src/preview-harness.js",
              contents: harness(files),
            },
            { type: "ESModule", path: "src/hosts.js", contents: readFileSync("src/hosts.js", "utf8") },
            { type: "ESModule", path: "src/routing.js", contents: readFileSync("src/routing.js", "utf8") },
            {
              type: "ESModule",
              path: "src/preview-links.js",
              contents: readFileSync("src/preview-links.js", "utf8"),
            },
          ],
        },
      ],
    }),
  );

  try {
    const englishHome = await dispatch(mf, `${PREVIEW}/en/`);
    assert.equal(englishHome.status, 200);
    assert.equal(englishHome.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.equal(englishHome.headers.get("etag"), null);
    assert.equal(englishHome.headers.get("content-length"), null);
    assert.deepEqual(anchorHrefs(englishHome.body), expectedAnchors("en", "https://abdolirad.me/", "fa"));
    assertProductionMetadata(englishHome.body, "https://abdolirad.me/articles/welcome/");

    const bare = await dispatch(mf, `${PREVIEW}/`);
    assert.deepEqual(anchorHrefs(bare.body), expectedAnchors("en", "https://abdolirad.me/", "fa"));

    const persianHome = await dispatch(mf, `${PREVIEW}/fa/`);
    assert.equal(persianHome.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.deepEqual(anchorHrefs(persianHome.body), expectedAnchors("fa", "https://abdolirad.ir/", "en"));
    assertProductionMetadata(persianHome.body, "https://abdolirad.ir/articles/welcome/");

    const missing = await dispatch(mf, `${PREVIEW}/fa/missing`);
    assert.equal(missing.status, 404);
    assert.deepEqual(anchorHrefs(missing.body), ["/fa/"]);

    const production = await dispatch(mf, "https://abdolirad.me/");
    assert.equal(production.status, 200);
    assert.equal(production.body, english);
    assert.equal(production.headers.get("etag"), '"asset"');
    assert.equal(production.headers.get("x-robots-tag"), null);

    const css = await dispatch(mf, `${PREVIEW}/assets/css/site.css`);
    assert.equal(css.status, 200);
    assert.equal(css.headers.get("content-type"), "text/css");
    assert.equal(css.body, "body{}");
    assert.equal(css.headers.get("etag"), '"asset"');

    const json = await dispatch(mf, `${PREVIEW}/data.json`);
    assert.equal(json.body, '{"url":"https://abdolirad.me/"}');
    assert.equal(json.headers.get("etag"), '"asset"');
    const xml = await dispatch(mf, `${PREVIEW}/feed.xml`);
    assert.equal(xml.body, "<url>https://abdolirad.me/</url>");
    assert.equal(xml.headers.get("content-type"), "application/xml");
    const note = await dispatch(mf, `${PREVIEW}/note.txt`);
    assert.equal(note.body, "https://abdolirad.me/");

    const encoded = await dispatch(mf, `${PREVIEW}/encoded.html`);
    assert.equal(encoded.body, "not-html");
    assert.equal(encoded.headers.get("etag"), '"asset"');

    const head = await dispatch(mf, `${PREVIEW}/en/`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.body, "");
    assert.equal(head.headers.get("etag"), '"asset"');
    assert.equal(head.headers.get("content-type")?.split(";")[0], "text/html");

    const fresh = await dispatch(mf, `${PREVIEW}/fa/`, { headers: { "if-none-match": '"asset"' } });
    assert.equal(fresh.status, 304);
    assert.equal(fresh.body, "");
    assert.equal(fresh.headers.get("etag"), '"asset"');
  } finally {
    await mf.dispose();
  }
});

function page(home, other) {
  const article = `${home}articles/welcome-to-my-blog/`;
  const share = `https://x.com/intent/tweet/?url=${encodeURIComponent(article)}&amp;text=Hi`;
  const canonical = `${home}articles/welcome/`;
  return `<!doctype html><html><head>
<link rel=canonical href=${canonical}>
<link rel=alternate hreflang=en href=https://abdolirad.me/articles/welcome/>
<link rel=alternate hreflang=fa href=https://abdolirad.ir/articles/welcome/>
<meta property=og:url content=${canonical}>
<link rel=stylesheet href=/assets/css/site.css>
<script type=application/ld+json>{"url":"${canonical}"}</script>
</head><body>
<a href=${home}>logo</a>
<a href=${home}articles/>articles</a>
<a href=${home}archives/>archives</a>
<a href=${article}>post</a>
<a href=${other}articles/welcome-to-my-blog/>switch</a>
<a href="${home}articles/?page=2#results">page</a>
<a href="${home}%D9%85%D9%82%D8%A7%D9%84%D9%87/?q=a%20b#x">slug</a>
<a href="${home}articles/?a=1&amp;b=2#z">query</a>
<a href=/>crumb</a>
<a href=/articles/>crumb-articles</a>
<a href=/index.xml>rss</a>
<a href=/assets/css/site.css>asset</a>
<a href=#top>top</a>
<a href=https://github.com/atkrad>github</a>
<a href=mailto:m.abdolirad@gmail.com>mail</a>
<a href="${share}">share</a>
<a href=https://not-abdolirad.me/>lookalike</a>
<a href=https://abdolirad.me.evil.com/>suffix</a>
<a href="https://user:pass@${home.slice("https://".length)}secret">user</a>
</body></html>`;
}

function expectedAnchors(lang, home, otherLang) {
  const article = `${home}articles/welcome-to-my-blog/`;
  return [
    `/${lang}/`,
    `/${lang}/articles/`,
    `/${lang}/archives/`,
    `/${lang}/articles/welcome-to-my-blog/`,
    `/${otherLang}/articles/welcome-to-my-blog/`,
    `/${lang}/articles/?page=2#results`,
    `/${lang}/%D9%85%D9%82%D8%A7%D9%84%D9%87/?q=a%20b#x`,
    `/${lang}/articles/?a=1&b=2#z`,
    `/${lang}/`,
    `/${lang}/articles/`,
    `/${lang}/index.xml`,
    "/assets/css/site.css",
    "#top",
    "https://github.com/atkrad",
    "mailto:m.abdolirad@gmail.com",
    `https://x.com/intent/tweet/?url=${encodeURIComponent(article)}&text=Hi`,
    "https://not-abdolirad.me/",
    "https://abdolirad.me.evil.com/",
    `https://user:pass@${home.slice("https://".length)}secret`,
  ];
}

function assertProductionMetadata(html, canonical) {
  const links = tags(html, "link").map((tag) => ({
    rel: attribute(tag, "rel"),
    hreflang: attribute(tag, "hreflang"),
    href: attribute(tag, "href"),
  }));
  assert.deepEqual(
    links.find((link) => link.rel === "canonical"),
    { rel: "canonical", hreflang: null, href: canonical },
  );
  assert.equal(links.find((link) => link.hreflang === "en")?.href, "https://abdolirad.me/articles/welcome/");
  assert.equal(links.find((link) => link.hreflang === "fa")?.href, "https://abdolirad.ir/articles/welcome/");
  assert.equal(links.find((link) => link.rel === "stylesheet")?.href, "/assets/css/site.css");
  const og = tags(html, "meta").map((tag) => attribute(tag, "content"));
  assert.ok(og.includes(canonical));
  assert.match(html, new RegExp(canonical.replaceAll("/", "\\/")));
}

function anchorHrefs(html) {
  return tags(html, "a").map((tag) => attribute(tag, "href"));
}

function tags(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((match) => match[0]);
}

function attribute(tag, name) {
  const quoted = new RegExp(`\\b${name}="([^"]*)"`, "i").exec(tag);
  if (quoted) return quoted[1].replaceAll("&amp;", "&");
  const bare = new RegExp(`\\b${name}=([^\\s>]+)`, "i").exec(tag);
  return bare ? bare[1].replaceAll("&amp;", "&") : null;
}

function harness(files) {
  return `import { handleRequest } from "./routing.js";

const files = ${JSON.stringify(files)};

export default {
  async fetch(request) {
    return handleRequest(request, {
      ASSETS: {
        async fetch(assetRequest) {
          const file = files[new URL(assetRequest.url).pathname];
          if (!file) return new Response("missing", { status: 404 });
          const headers = new Headers({
            "content-type": file.type,
            etag: '"asset"',
            "content-length": String(new TextEncoder().encode(file.body).byteLength),
          });
          if (file.encoding) headers.set("content-encoding", file.encoding);
          if (assetRequest.headers.get("if-none-match") === '"asset"') {
            return new Response(null, { status: 304, headers });
          }
          if (assetRequest.method === "HEAD") return new Response(null, { status: 200, headers });
          return new Response(file.body, { status: 200, headers });
        },
      },
    });
  },
};
`;
}

async function dispatch(mf, url, { method = "GET", headers } = {}) {
  const response = await mf.dispatchFetch(url, { method, headers, redirect: "manual" });
  const body = method === "HEAD" || response.status === 304 ? "" : await response.text();
  return { status: response.status, headers: response.headers, body };
}
