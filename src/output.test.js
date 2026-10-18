import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SITES = [
  { lang: "en", origin: "https://abdolirad.me", direction: "ltr" },
  { lang: "fa", origin: "https://abdolirad.ir", direction: "rtl" },
];

// Pages published in both languages at the same path.
// The article is one intentional pair, not a rule for every future article.
const BILINGUAL_PATHS = ["/", "/about/", "/articles/", "/archives/", "/articles/the-decisions-behind-the-code/"];
const RETIRED_ARTICLE = "welcome-to-my-blog";

function read(relative) {
  const file = path.join(root, relative);
  assert.equal(existsSync(file), true, `missing ${relative}; run npm run build`);
  return readFileSync(file, "utf8");
}

function otherSite(site) {
  return SITES.find((item) => item.lang !== site.lang);
}

function attributes(tag) {
  const attrs = {};
  for (const match of tag.matchAll(/\b([^\s=/>]+)(?:=(?:"([^"]*)"|([^\s>]+)))?/g)) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? "";
  }
  return attrs;
}

function linkHref(html, where) {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    if (where(attrs)) return attrs.href ?? null;
  }
  return null;
}

function canonical(html) {
  return linkHref(html, (attrs) => attrs.rel === "canonical");
}

function hreflang(html, lang) {
  return linkHref(html, (attrs) => attrs.rel === "alternate" && attrs.hreflang === lang);
}

function sitemapEntries(xml) {
  return xml
    .split(/<url>/)
    .slice(1)
    .map((block) => ({
      loc: block.match(/<loc>([^<]+)<\/loc>/)?.[1],
      alternates: [...block.matchAll(/hreflang="([^"]+)" href="([^"]+)"/g)].map((match) => ({
        locale: match[1],
        href: match[2],
      })),
    }))
    .filter((entry) => entry.loc);
}

function langOfLocale(locale) {
  const code = locale.toLowerCase().split("-")[0];
  return SITES.some((site) => site.lang === code) ? code : null;
}

function pageFile(lang, pathname) {
  const relative = pathname === "/" ? "index.html" : `${pathname.slice(1)}index.html`;
  return path.join("public", lang, relative);
}

// Hugo's built article pages. The paginator lives at articles/page/1/, so it has no index here.
function publishedArticlePaths(lang) {
  const dir = path.join(root, "public", lang, "articles");
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(dir, entry.name, "index.html")))
    .map((entry) => `/articles/${entry.name}/`)
    .sort();
}

function destinationExists(lang, pathname) {
  if (/\.[a-z0-9]+$/i.test(pathname)) return existsSync(path.join(root, "public", lang, pathname.slice(1)));
  const directory = pathname === "/" ? "/" : pathname.endsWith("/") ? pathname : `${pathname}/`;
  return existsSync(path.join(root, pageFile(lang, directory)));
}

function headerHrefs(html) {
  const header = html.match(/<header\b[\s\S]*?<\/header>/i)?.[0] ?? "";
  return [...header.matchAll(/\bhref=(?:"([^"]*)"|([^\s>]+))/g)].map((match) => match[1] ?? match[2]);
}

// archive-entry is the post list. The header menu uses ordinary links.
function archiveEntryUrls(html) {
  const urls = [];
  for (const entry of html.split(/<div class="?archive-entry\b/).slice(1)) {
    const tag = entry.match(/<a\b[^>]*\bclass="?entry-link\b[^>]*>/)?.[0];
    const href = tag ? attributes(tag).href : null;
    if (href) urls.push(new URL(href, "https://example.test"));
  }
  return urls;
}

function rssItems(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => {
    const link = match[1].match(/<link>([^<]+)<\/link>/)?.[1];
    assert.ok(link, "rss item is missing a link");
    return new URL(link);
  });
}

test("language homepages use their domain and link to the other site", () => {
  assert.equal(existsSync(path.join(root, "public", "index.html")), false);

  for (const site of SITES) {
    const other = otherSite(site);
    const home = read(`public/${site.lang}/index.html`);
    assert.equal(canonical(home), `${site.origin}/`);
    assert.match(home, new RegExp(`\\bdir="?${site.direction}\\b`));
    assert.equal(new RegExp(`${site.origin.replaceAll(".", "\\.")}/${site.lang}(/|"|>|\\s)`).test(home), false);
    assert.match(read(`public/${site.lang}/robots.txt`), new RegExp(`Sitemap: ${site.origin}/sitemap\\.xml`));

    const hrefs = headerHrefs(home);
    assert.ok(hrefs.length > 0, site.lang);
    for (const href of hrefs) {
      if (href.startsWith("#") || /^(mailto|javascript):/i.test(href)) continue;
      const url = new URL(href, `${site.origin}/`);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      const target = SITES.find((item) => item.origin === url.origin);
      if (!target) continue;
      assert.equal(/^\/(en|fa)(\/|$)/.test(url.pathname), false, href);
      assert.equal(destinationExists(target.lang, url.pathname), true, href);
    }
    assert.ok(hrefs.some((href) => new URL(href, `${site.origin}/`).href === `${other.origin}/`));
  }
});

test("sitemaps stay on their domain and translations are reciprocal", () => {
  const published = new Map();

  for (const site of SITES) {
    const xml = read(`public/${site.lang}/sitemap.xml`);
    const entries = sitemapEntries(xml);
    assert.ok(entries.length > 0, site.lang);
    assert.equal(xml.includes(RETIRED_ARTICLE), false);
    assert.equal(existsSync(path.join(root, "public", site.lang, "articles", RETIRED_ARTICLE, "index.html")), false);

    for (const entry of entries) {
      const page = new URL(entry.loc);
      assert.equal(page.origin, site.origin, entry.loc);
      assert.equal(existsSync(path.join(root, pageFile(site.lang, page.pathname))), true, entry.loc);
      published.set(entry.loc, entry);
    }
  }

  for (const [loc, entry] of published) {
    for (const alternate of entry.alternates) {
      const target = published.get(alternate.href);
      assert.ok(target, `${loc} links to unpublished ${alternate.href}`);
      assert.ok(
        target.alternates.some((back) => back.href === loc),
        `${alternate.href} does not link back to ${loc}`,
      );
    }
  }

  for (const pathname of BILINGUAL_PATHS) {
    for (const site of SITES) {
      const other = otherSite(site);
      const loc = `${site.origin}${pathname}`;
      const expected = `${other.origin}${pathname}`;
      const entry = published.get(loc);
      assert.ok(entry, `missing sitemap entry ${loc}`);
      assert.ok(
        entry.alternates.some((alternate) => langOfLocale(alternate.locale) === other.lang && alternate.href === expected),
        `${loc} should translate to ${expected}`,
      );
    }
  }
});

test("pages publish the canonical url and hreflang links from the sitemap", () => {
  for (const site of SITES) {
    for (const entry of sitemapEntries(read(`public/${site.lang}/sitemap.xml`))) {
      const html = read(pageFile(site.lang, new URL(entry.loc).pathname));
      assert.equal(canonical(html), entry.loc);

      for (const lang of SITES.map((item) => item.lang)) {
        const fromSitemap = entry.alternates.find((alternate) => langOfLocale(alternate.locale) === lang)?.href ?? null;
        assert.equal(hreflang(html, lang), fromSitemap, `${entry.loc} ${lang}`);
      }
    }
  }
});

test("each language publishes at least one article", () => {
  for (const site of SITES) {
    assert.ok(publishedArticlePaths(site.lang).length > 0, `${site.lang} has no published articles`);
  }
});

test("rss feeds list the published articles", () => {
  for (const site of SITES) {
    const xml = read(`public/${site.lang}/index.xml`);
    assert.match(xml, /<rss\b/);
    assert.match(xml, /<channel>/);
    assert.equal(xml.includes(RETIRED_ARTICLE), false);

    const channelLink = xml.split("<item>")[0].match(/<link>([^<]+)<\/link>/)?.[1];
    assert.equal(new URL(channelLink).origin, site.origin);

    const items = rssItems(xml);
    for (const item of items) assert.equal(item.origin, site.origin, item.href);
    assert.deepEqual(
      items.map((item) => item.pathname).sort(),
      publishedArticlePaths(site.lang),
    );
  }
});

test("archives list the published articles", () => {
  for (const site of SITES) {
    const entries = archiveEntryUrls(read(`public/${site.lang}/archives/index.html`));
    for (const entry of entries) assert.equal(entry.origin, site.origin, entry.href);
    assert.deepEqual(
      entries.map((entry) => entry.pathname).sort(),
      publishedArticlePaths(site.lang),
    );
  }
});
