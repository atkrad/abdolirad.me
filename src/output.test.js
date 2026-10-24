import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { jalaliYear, persianDate } from "./persian-dates.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SITES = [
  { lang: "en", origin: "https://abdolirad.me", direction: "ltr" },
  { lang: "fa", origin: "https://abdolirad.ir", direction: "rtl" },
];

// Menu pages that exist in both languages. Article pairs come from the sitemap.
const BILINGUAL_PATHS = ["/", "/about/", "/articles/", "/archives/"];

const PERSIAN_MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
const ENGLISH_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ISO_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;

function read(relative) {
  const file = path.join(root, relative);
  assert.equal(existsSync(file), true, `missing ${relative}; run npm run build`);
  return readFileSync(file, "utf8");
}

function otherSite(site) {
  return SITES.find((item) => item.lang !== site.lang);
}

function decode(value) {
  return value.replaceAll("&#43;", "+").replaceAll("&amp;", "&");
}

function assertArchiveFragments(html) {
  const anchors = [...html.matchAll(/<h[23]\b[^>]*class="?archive-(?:year|month)-header\b[^>]*>[\s\S]*?<\/h[23]>/g)].map(
    (match) => {
      const open = match[0].match(/<h[23]\b[^>]*>/)?.[0] ?? "";
      const link = match[0].match(/<a\b[^>]*>/)?.[0] ?? "";
      return { id: attributes(open).id, href: attributes(link).href };
    },
  );
  const ids = [...html.matchAll(/\bid=(?:"([^"]*)"|([^\s>]+))/g)].map((match) => match[1] ?? match[2]);
  assert.ok(anchors.length > 1);
  assert.equal(new Set(anchors.map((anchor) => anchor.id)).size, anchors.length);
  for (const anchor of anchors) {
    assert.equal(anchor.href.startsWith("#"), true, anchor.href);
    assert.equal(anchor.href.includes("/"), false, anchor.href);
    assert.equal(decodeURIComponent(anchor.href), `#${decode(anchor.id)}`);
    assert.equal(ids.filter((id) => id === anchor.id).length, 1, anchor.id);
  }
}

function times(html) {
  return [...html.matchAll(/<time\b([^>]*)>([^<]*)<\/time>/gi)].map((match) => ({
    datetime: decode(attributes(match[0]).datetime ?? ""),
    text: match[2],
  }));
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
      lastmod: block.match(/<lastmod>([^<]*)<\/lastmod>/)?.[1] ?? null,
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
  const decoded = decodeURIComponent(pathname);
  const relative = decoded === "/" ? "index.html" : `${decoded.slice(1)}index.html`;
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
        const fromPage = hreflang(html, lang);
        if (fromSitemap) {
          assert.equal(fromPage, fromSitemap, `${entry.loc} ${lang}`);
          continue;
        }
        // A term that exists in one language has no sitemap alternate. The page may still name itself.
        if (lang === site.lang) assert.ok(fromPage === null || fromPage === entry.loc, `${entry.loc} ${lang}`);
        else assert.equal(fromPage, null, `${entry.loc} ${lang}`);
      }
    }
  }
});

test("rss feeds list the published articles", () => {
  for (const site of SITES) {
    const xml = read(`public/${site.lang}/index.xml`);
    assert.match(xml, /<rss\b/);
    assert.match(xml, /<channel>/);
    if (site.lang === "fa") {
      assert.match(xml, /<description>مطالب تازه در /);
      assert.equal(xml.includes("Recent content"), false);
    } else {
      assert.match(xml, /<description>Recent content on /);
    }

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

function scriptNumber(text) {
  const compact = text.replaceAll("&nbsp;", "").replaceAll("&#160;", "").trim();
  const persian = [...compact].map((digit) => PERSIAN_DIGITS.indexOf(digit));
  if (persian.length > 0 && persian.every((digit) => digit >= 0)) return Number(persian.join(""));
  assert.match(compact, /^\d+$/, compact);
  return Number(compact);
}

function gregorianLong(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  assert.ok(match, iso);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}

function metaTags(html) {
  return [...html.matchAll(/<meta\b[^>]*>/gi)].map((match) => attributes(match[0]));
}

function metaContent(html, key) {
  const found = metaTags(html).find((attrs) => attrs.property === key || attrs.name === key);
  return found ? decode(found.content ?? "") : null;
}

function postTags(html) {
  const list = html.match(/<ul class="?post-tags"?[^>]*>[\s\S]*?<\/ul>/)?.[0] ?? "";
  return [...list.matchAll(/<a\b[^>]*href=(?:"([^"]*)"|([^\s>]+))[^>]*>([^<]*)<\/a>/g)].map((match) => ({
    href: match[1] ?? match[2],
    text: match[3].trim(),
  }));
}

function jsonField(html, name) {
  return html.match(new RegExp(`"${name}"\\s*:\\s*"([^"]+)"`))?.[1] ?? null;
}

function metaBlocks(html) {
  return [...html.matchAll(/<div class="?(?:post-meta|archive-meta)\b[^>]*>([\s\S]*?)<\/div>/g)].map((match) => match[1]);
}

function readingLabels(html) {
  return metaBlocks(html).flatMap((block) =>
    [...block.matchAll(/<span>([^<]+)<\/span>/g)]
      .map((match) => match[1])
      .filter((text) => text.endsWith(" min") || text.endsWith(" دقیقه")),
  );
}

function englishDateSpans(html) {
  return metaBlocks(html).flatMap((block) =>
    [...block.matchAll(/<span title=(?:"([^"]+)"|'([^']+)')>([^<]+)<\/span>/g)].map((match) => ({
      title: match[1] ?? match[2],
      text: match[3],
    })),
  );
}

function countText(html) {
  return html.match(/<sup\b[^>]*class="?archive-count\b[^>]*>([^<]*)<\/sup>/)?.[1] ?? "";
}

function archiveOutline(html) {
  return html
    .split(/<div class="?archive-year\b/)
    .slice(1)
    .map((yearHtml) => ({
      year: yearHtml.match(/<h2\b[^>]*class="?archive-year-header\b[^>]*>[\s\S]*?<a\b[^>]*>([^<]+)<\/a>/)?.[1] ?? "",
      count: countText(yearHtml.split(/<div class="?archive-month\b/)[0]),
      months: yearHtml
        .split(/<div class="?archive-month\b/)
        .slice(1)
        .map((monthHtml) => ({
          month: monthHtml.match(/<h3\b[^>]*class="?archive-month-header\b[^>]*>[\s\S]*?<a\b[^>]*>([^<]+)<\/a>/)?.[1] ?? "",
          count: countText(monthHtml),
          entries: monthHtml.split(/<div class="?archive-entry\b/).length - 1,
        })),
    }));
}

function archiveEntryDetails(html) {
  return html.split(/<div class="?archive-entry\b/).slice(1).map((entry) => {
    const link = entry.match(/<a\b[^>]*class="?entry-link\b[^>]*>/)?.[0] ?? "";
    return {
      title: entry.match(/<h3\b[^>]*class="?archive-entry-title\b[^>]*>([\s\S]*?)<\/h3>/)?.[1].replace(/<[^>]+>/g, "").trim() ?? "",
      label: attributes(link)["aria-label"] ?? "",
    };
  });
}

function rssPublications(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => {
    const link = match[1].match(/<link>([^<]+)<\/link>/)?.[1];
    const pubDate = match[1].match(/<pubDate>([^<]+)<\/pubDate>/)?.[1];
    assert.ok(link && pubDate, "rss item is missing a link or date");
    return { url: new URL(link), pubDate };
  });
}

function footerOf(html) {
  return html.match(/<footer class="?footer\b[\s\S]*?<\/footer>/)?.[0] ?? "";
}

test("published dates stay consistent without fixed article dates", () => {
  for (const site of SITES) {
    const sitemap = new Map(sitemapEntries(read(`public/${site.lang}/sitemap.xml`)).map((entry) => [entry.loc, entry]));
    const articles = new Set(publishedArticlePaths(site.lang));
    const publishedByPath = new Map();

    for (const [loc, entry] of sitemap) {
      const pathname = new URL(loc).pathname;
      const html = read(pageFile(site.lang, pathname));
      const published = metaContent(html, "article:published_time");
      const modified = metaContent(html, "article:modified_time");
      if (entry.lastmod) {
        assert.match(entry.lastmod, ISO_STAMP, loc);
        assert.equal(/[۰-۹]/.test(entry.lastmod), false, loc);
      }
      if (articles.has(pathname)) assert.ok(published && modified, loc);
      if (published) {
        assert.match(published, ISO_STAMP, loc);
        assert.equal(jsonField(html, "datePublished"), published, loc);
        if (site.lang === "fa") {
          assert.ok(
            times(html).some((item) => item.datetime === published && item.text === persianDate(published).display),
            loc,
          );
        } else {
          assert.ok(englishDateSpans(html).some((item) => item.text === gregorianLong(published)), loc);
        }
        publishedByPath.set(pathname, published);
      }
      if (modified) {
        assert.match(modified, ISO_STAMP, loc);
        assert.equal(jsonField(html, "dateModified"), modified, loc);
        assert.equal(entry.lastmod, modified, loc);
      }
      if (site.lang === "fa") {
        for (const item of times(html)) {
          assert.equal(item.text, persianDate(item.datetime).display, loc);
        }
      } else {
        for (const item of englishDateSpans(html)) {
          assert.equal(item.text, gregorianLong(item.title), loc);
        }
      }
    }

    for (const item of rssPublications(read(`public/${site.lang}/index.xml`))) {
      assert.match(item.pubDate, /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} [+-]\d{4}$/);
      assert.equal(/[\u0600-\u06FF]/.test(item.pubDate), false, item.url.href);
      assert.equal(Date.parse(item.pubDate), Date.parse(publishedByPath.get(item.url.pathname)), item.url.href);
    }
  }
});

test("archives group pages in descending order and local digits", () => {
  for (const site of SITES) {
    const html = read(`public/${site.lang}/archives/index.html`);
    const outline = archiveOutline(html);
    const monthNames = site.lang === "fa" ? PERSIAN_MONTHS : ENGLISH_MONTHS;
    for (let index = 1; index < outline.length; index += 1) {
      assert.ok(scriptNumber(outline[index].year) < scriptNumber(outline[index - 1].year));
    }
    let listed = 0;
    for (const group of outline) {
      assert.match(group.year, site.lang === "fa" ? /^[۰-۹]+$/ : /^\d+$/, group.year);
      const monthIndexes = group.months.map((month) => monthNames.indexOf(month.month));
      assert.ok(monthIndexes.every((index) => index >= 0), group.months.map((month) => month.month).join(","));
      for (let index = 1; index < monthIndexes.length; index += 1) {
        assert.ok(monthIndexes[index] < monthIndexes[index - 1], group.year);
      }
      assert.equal(scriptNumber(group.count), group.months.reduce((sum, month) => sum + month.entries, 0), group.year);
      for (const month of group.months) {
        assert.match(month.count.replaceAll("&nbsp;", "").replaceAll("&#160;", "").trim(), site.lang === "fa" ? /^[۰-۹]+$/ : /^\d+$/);
        assert.equal(scriptNumber(month.count), month.entries, month.month);
        listed += month.entries;
      }
    }
    assert.equal(listed, publishedArticlePaths(site.lang).length);
    if (listed > 0) assertArchiveFragments(html);
    const prefix = site.lang === "fa" ? "پیوند به " : "post link to ";
    for (const entry of archiveEntryDetails(html)) {
      assert.equal(entry.label.startsWith(prefix), true, entry.label);
      assert.equal(entry.label.endsWith(entry.title), true, entry.label);
    }
  }
});

test("reading time keeps its label and uses the language's digits", () => {
  for (const site of SITES) {
    const pattern = site.lang === "fa" ? /^[۰-۹]+ دقیقه$/ : /^\d+ min$/;
    const articles = new Set(publishedArticlePaths(site.lang));
    let seen = 0;
    for (const entry of sitemapEntries(read(`public/${site.lang}/sitemap.xml`))) {
      const pathname = new URL(entry.loc).pathname;
      const labels = readingLabels(read(pageFile(site.lang, pathname)));
      for (const label of labels) assert.match(label, pattern, entry.loc);
      if (!articles.has(pathname)) continue;
      assert.equal(labels.length, 1, entry.loc);
      seen += 1;
    }
    assert.equal(seen, articles.size);
  }
});

function publishedStylesheet(lang) {
  const html = read(`public/${lang}/index.html`);
  const href = html.match(/href="?(\/[^"\s>]+\.css)"?/)?.[1];
  assert.ok(href, `${lang} home page is missing a stylesheet`);
  return read(`public/${lang}${href}`);
}

test("breadcrumb separators follow the page direction", () => {
  for (const site of SITES) {
    const css = publishedStylesheet(site.lang);
    assert.match(css, /html\[dir=rtl\]\s*\.breadcrumbs svg\{transform:scaleX\(-1\)\}/);
    const sectionTitle = read(`public/${site.lang}/articles/index.html`).match(/<h1[^>]*>\s*([^<\n]+)/)?.[1]?.trim();
    assert.ok(sectionTitle, `${site.lang} articles section is missing a title`);

    let trail = null;
    for (const entry of sitemapEntries(read(`public/${site.lang}/sitemap.xml`))) {
      const pathname = new URL(entry.loc).pathname;
      if (!/^\/articles\/[^/]+\/$/.test(pathname)) continue;
      const html = read(pageFile(site.lang, pathname));
      const nav = html.match(/<nav class="?breadcrumbs"?[^>]*>[\s\S]*?<\/nav>/)?.[0];
      if (!nav) continue;
      const labels = [...nav.matchAll(/<a\b[^>]*>([^<]*)<\/a>/g)].map((match) => match[1].trim());
      if (labels.length < 2) continue;
      trail = { nav, labels };
      break;
    }
    assert.ok(trail, `${site.lang} has no multi-level breadcrumb`);
    assert.equal(trail.labels[0], site.lang === "fa" ? "خانه" : "Home");
    assert.equal(trail.labels[1], sectionTitle);
    assert.match(trail.nav, /feather-chevron-right/);
    assert.equal(trail.nav.includes("scaleX"), false);
  }
});

test("navigation and footer stay in the page language", () => {
  const persian = read("public/fa/index.html");
  assert.match(persian, /<span>بایگانی<\/span>/);
  assert.equal(persian.includes("آرشیو"), false);
  const persianFooter = footerOf(persian);
  assert.match(persianFooter, new RegExp(`&copy; ${jalaliYear()}`));
  assert.match(persianFooter, /ساخته شده با/);
  assert.match(persianFooter, /dir="?ltr"?[^>]*>Hugo</);
  assert.match(persianFooter, /dir="?ltr"?[^>]*>PaperMod</);
  assert.match(persianFooter, /https:\/\/gohugo\.io\/\?utm_source=abdolirad\.ir/);
  assert.equal(persianFooter.includes("Powered by"), false);
  assert.match(persian, /id="?top-link"?/);
  assert.match(persian, /aria-label="برو به بالا"/);
  assert.match(persian, /title="برو به بالا \(Alt \+ G\)"/);
  assert.match(persian, /aria-label="تغییر پوسته"/);

  const english = read("public/en/index.html");
  assert.match(english, /<span>Archives<\/span>/);
  assert.equal(english.includes("بایگانی"), false);
  const englishFooter = footerOf(english);
  assert.match(englishFooter, new RegExp(`&copy; ${new Date().getFullYear()}`));
  assert.match(englishFooter, /Powered by/);
  assert.match(englishFooter, /https:\/\/gohugo\.io\/\?utm_source=abdolirad\.me/);
  assert.equal(englishFooter.includes("ساخته شده با"), false);
  assert.match(english, /id="?top-link"?/);
  assert.match(english, /aria-label="go to top"/);
  assert.match(english, /title="Go to Top \(Alt \+ G\)"/);
  assert.match(english, /aria-label="Toggle theme"/);

  for (const site of SITES) {
    const label = site.lang === "fa" ? "<span>ترجمه‌ها:</span>" : "<span>Translations:</span>";
    for (const entry of sitemapEntries(read(`public/${site.lang}/sitemap.xml`))) {
      const html = read(pageFile(site.lang, new URL(entry.loc).pathname));
      if (!html.includes("i18n_list")) continue;
      assert.equal(html.includes(label), true, entry.loc);
    }
  }
});

test("page metadata stays singular and language-specific", () => {
  for (const site of SITES) {
    for (const entry of sitemapEntries(read(`public/${site.lang}/sitemap.xml`))) {
      const html = read(pageFile(site.lang, new URL(entry.loc).pathname));
      const rootTag = html.match(/<html\b[^>]*>/i)?.[0] ?? "";
      assert.equal(attributes(rootTag).lang, site.lang, entry.loc);
      assert.match(html, /<title>[^<]+<\/title>/, entry.loc);
      const tags = metaTags(html);
      assert.equal(tags.filter((attrs) => attrs.name === "description").length, 1, entry.loc);
      const keywords = tags.filter((attrs) => attrs.name === "keywords");
      assert.ok(keywords.length <= 1, entry.loc);
      assert.equal((keywords[0]?.content ?? "").includes("<"), false, entry.loc);
      const canonicals = [...html.matchAll(/<link\b[^>]*>/gi)].filter((match) => attributes(match[0]).rel === "canonical");
      assert.equal(canonicals.length, 1, entry.loc);
      const ogUrl = metaContent(html, "og:url");
      if (ogUrl) assert.equal(ogUrl, entry.loc, entry.loc);
      const locale = metaContent(html, "og:locale");
      if (locale) assert.equal(locale, site.lang === "fa" ? "fa_IR" : "en_US", entry.loc);
    }
  }
});

test("the parking article publishes its summary and tags in each language", () => {
  const articles = {
    en: {
      origin: "https://abdolirad.me",
      other: "https://abdolirad.ir/articles/go-1-28-http2-parking-memory/",
      description:
        "I benchmarked Go 1.28 HTTP/2 parking with 5,000 idle connections. Across three runs, the same server binary used 85-93 MiB less RSS with parking enabled.",
      keywords: "Go 1.28 HTTP/2 parking,Go,HTTP/2,Performance,Benchmarking,Goroutines",
      tags: ["Go", "HTTP/2", "Performance", "Benchmarking"],
    },
    fa: {
      origin: "https://abdolirad.ir",
      other: "https://abdolirad.me/articles/go-1-28-http2-parking-memory/",
      description:
        "در بنچمارکی با نسخه‌ای ساخته‌شده از کد در حال توسعهٔ Go 1.28، فعال‌بودن Parking در HTTP/2 با ۵۰۰۰ اتصال باز بدون درخواست فعال، مصرف RSS سرور را در سه اجرا حدود ۸۵ تا ۹۳ MiB کاهش داد.",
      keywords: "Go 1.28 HTTP/2 parking,Go,HTTP/2,کارایی,بنچمارک,Goroutine",
      tags: ["Go", "HTTP/2", "کارایی", "بنچمارک"],
    },
  };
  for (const [lang, spec] of Object.entries(articles)) {
    const html = read(`public/${lang}/articles/go-1-28-http2-parking-memory/index.html`);
    const page = `${spec.origin}/articles/go-1-28-http2-parking-memory/`;
    assert.equal(canonical(html), page, lang);
    assert.equal(hreflang(html, lang === "en" ? "fa" : "en"), spec.other, lang);
    assert.equal(attributes(html.match(/<html\b[^>]*>/i)[0]).lang, lang);
    assert.equal(metaContent(html, "description").replace(/\s+/g, " ").trim(), spec.description, lang);
    assert.equal(metaContent(html, "og:description").replace(/\s+/g, " ").trim(), spec.description, lang);
    assert.equal(metaContent(html, "keywords"), spec.keywords, lang);
    const articleTags = metaTags(html)
      .filter((attrs) => attrs.property === "article:tag")
      .map((attrs) => attrs.content);
    assert.deepEqual(articleTags, spec.tags, lang);
    const links = postTags(html);
    assert.deepEqual(links.map((link) => link.text), spec.tags, lang);
    for (const link of links) {
      assert.equal(link.href.startsWith(`${spec.origin}/`), true, link.href);
      const tagPage = read(pageFile(lang, new URL(link.href).pathname));
      assert.equal(canonical(tagPage), link.href.endsWith("/") ? link.href : `${link.href}/`, link.href);
      assert.match(tagPage, /go-1-28-http2-parking-memory/, link.href);
      assert.equal(attributes(tagPage.match(/<html\b[^>]*>/i)[0]).lang, lang, link.href);
      const crumb = tagPage.match(/<nav class="?breadcrumbs"?[^>]*>[\s\S]*?<\/nav>/)?.[0] ?? "";
      assert.match(crumb, lang === "fa" ? /برچسب‌ها/ : />Tags</, link.href);
    }
    assert.match(html, /src=(?:"\/js\/chart-zoom\.js"|\/js\/chart-zoom\.js)(?:[\s>]|$)/);
    assert.equal(html.includes("chart-viewer"), false);
  }
});
