import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { generatePersianDates, jalaliYear, persianDate } from "./persian-dates.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function page(title, fields, body = title) {
  const lines = ["---", `title: ${JSON.stringify(title)}`];
  for (const [key, value] of Object.entries(fields)) lines.push(`${key}: ${JSON.stringify(value)}`);
  lines.push("---", body, "");
  return lines.join("\n");
}

function fixtureFiles() {
  return {
    "fa/archives.md": page("بایگانی", { layout: "archives", url: "/archives/" }),
    "en/archives.md": page("Archive", { layout: "archives", url: "/archives/" }),
    "fa/articles/aban.md": page("Aban post", { date: "2026-10-23T00:00:00Z" }),
    "fa/articles/mehr-late.md": page("Mehr late", { date: "2026-10-22T12:00:00+02:00" }),
    "fa/articles/mehr-early.md": page("Mehr early", { date: "2026-10-18T10:16:00+02:00" }),
    "fa/articles/split.md": page("Split dates", {
      date: "2025-03-20T10:00:00+03:30",
      publishDate: "2025-03-21T10:00:00+03:30",
      lastmod: "2025-04-01T10:00:00+03:30",
    }),
    "fa/articles/esfand.md": page("Esfand post", { date: "2025-03-20T23:30:00-05:00" }),
    "fa/articles/farvardin.md": page("Farvardin post", { date: "2024-03-20T00:00:00Z" }),
    "fa/articles/before-nowruz.md": page("Before Nowruz", { date: "2024-03-19T23:30:00-01:00" }),
    "fa/articles/draft.md": page("Draft post", { date: "2026-10-18T10:16:00+02:00", draft: true }),
    "en/articles/october.md": page("October post", { date: "2026-10-18T10:16:00+02:00" }),
    "en/articles/march.md": page("March post", { date: "2025-03-21T00:30:00+03:30" }),
    "en/articles/split-publication.md": page("Split publication", {
      date: "2026-01-15T12:00:00Z",
      publishDate: "2025-03-21T10:00:00+03:30",
      lastmod: "2025-04-01T10:00:00+03:30",
    }),
  };
}

function keywordConfig(keywords) {
  if (!keywords) return "";
  return `    params:\n      keywords:\n${keywords.map((keyword) => `        - ${JSON.stringify(keyword)}`).join("\n")}\n`;
}

function buildCase(files, hugoArgs = [], options = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "persian-html-"));
  const contentDir = path.join(dir, "content");
  const dataDir = path.join(dir, "data");
  const publicDir = path.join(dir, "public");
  for (const [relative, text] of Object.entries(files)) {
    const file = path.join(contentDir, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  const overlay = path.join(dir, "overlay.yaml");
  writeFileSync(
    overlay,
    [
      `dataDir: ${dataDir}`,
      "languages:",
      "  en:",
      `    contentDir: ${path.join(contentDir, "en")}`,
      keywordConfig(options.enKeywords).trimEnd(),
      "  fa:",
      `    contentDir: ${path.join(contentDir, "fa")}`,
      keywordConfig(options.faKeywords).trimEnd(),
      "",
    ].filter((line) => line !== "").join("\n"),
  );
  generatePersianDates({
    root,
    contentDir,
    configPath: path.join(root, "hugo.yaml"),
    outFile: path.join(dataDir, "persianDates.json"),
  });
  const result = spawnSync(
    "hugo",
    ["--destination", publicDir, "--config", `hugo.yaml,${overlay}`, ...hugoArgs],
    { cwd: root, encoding: "utf8" },
  );
  if (result.error) throw result.error;
  return { dir, publicDir, result };
}

function buildFixture() {
  const built = buildCase(fixtureFiles(), ["--buildFuture", "--quiet"]);
  assert.equal(built.result.status, 0, `${built.result.stdout}\n${built.result.stderr}`);
  return built;
}

function readPage(publicDir, lang, pathname) {
  const relative = pathname === "/" ? "index.html" : `${pathname.replace(/^\//, "")}index.html`;
  return readFileSync(path.join(publicDir, lang, relative), "utf8");
}

function attributes(tag) {
  const attrs = {};
  for (const match of tag.matchAll(/\b([^\s=/>]+)(?:=(?:"([^"]*)"|([^\s>]+)))?/g)) {
    attrs[match[1].toLowerCase()] = (match[2] ?? match[3] ?? "").replaceAll("&#43;", "+");
  }
  return attrs;
}

function jsonField(html, name) {
  return html.match(new RegExp(`"${name}"\\s*:\\s*"([^"]+)"`))?.[1] ?? null;
}

function times(html) {
  return [...html.matchAll(/<time\b([^>]*)>([^<]*)<\/time>/gi)].map((match) => ({
    datetime: attributes(match[0]).datetime,
    text: match[2],
  }));
}

function countText(html) {
  return html.match(/<sup\b[^>]*class="?archive-count\b[^>]*>([^<]*)<\/sup>/)?.[1].replaceAll("&nbsp;", "").replaceAll("&#160;", "").trim();
}

function archiveOutline(html) {
  return html
    .split(/<div class="?archive-year\b/)
    .slice(1)
    .map((yearHtml) => ({
      year: yearHtml.match(/<h2\b[^>]*class="?archive-year-header\b[^>]*>[\s\S]*?<a\b[^>]*>([^<]+)<\/a>/)?.[1],
      count: countText(yearHtml.split(/<div class="?archive-month\b/)[0]),
      months: yearHtml
        .split(/<div class="?archive-month\b/)
        .slice(1)
        .map((monthHtml) => ({
          month: monthHtml.match(/<h3\b[^>]*class="?archive-month-header\b[^>]*>[\s\S]*?<a\b[^>]*>([^<]+)<\/a>/)?.[1],
          count: countText(monthHtml),
          titles: [...monthHtml.matchAll(/<h3\b[^>]*class="?archive-entry-title\b[^>]*>([\s\S]*?)<\/h3>/g)].map(
            (match) => match[1].replace(/<[^>]+>/g, "").trim(),
          ),
        })),
    }));
}

function archiveAnchors(html) {
  return [...html.matchAll(/<h[23]\b[^>]*class="?archive-(?:year|month)-header\b[^>]*>[\s\S]*?<\/h[23]>/g)].map((match) => {
    const open = match[0].match(/<h[23]\b[^>]*>/)?.[0] ?? "";
    const link = match[0].match(/<a\b[^>]*>/)?.[0] ?? "";
    return { id: attributes(open).id, href: attributes(link).href };
  });
}

function assertFragments(html) {
  const anchors = archiveAnchors(html);
  const ids = [...html.matchAll(/\bid=(?:"([^"]*)"|([^\s>]+))/g)].map((match) => match[1] ?? match[2]);
  assert.ok(anchors.length > 1);
  assert.equal(new Set(anchors.map((anchor) => anchor.id)).size, anchors.length);
  for (const anchor of anchors) {
    assert.equal(anchor.href.startsWith("#"), true, anchor.href);
    assert.equal(anchor.href.includes("/"), false, anchor.href);
    assert.equal(decodeURIComponent(anchor.href), `#${anchor.id}`);
    assert.equal(ids.filter((id) => id === anchor.id).length, 1, anchor.id);
  }
  return anchors;
}

function archiveEntries(html) {
  return html.split(/<div class="?archive-entry\b/).slice(1).map((entry) => {
    const link = entry.match(/<a\b[^>]*class="?entry-link\b[^>]*>/)?.[0] ?? "";
    const attrs = attributes(link);
    return {
      title: entry.match(/<h3\b[^>]*class="?archive-entry-title\b[^>]*>([\s\S]*?)<\/h3>/)?.[1].replace(/<[^>]+>/g, "").trim(),
      href: attrs.href,
      label: attrs["aria-label"],
      times: times(entry),
    };
  });
}

function assertArticleLinks(publicDir, lang, html, origin) {
  const entries = archiveEntries(html);
  assert.equal(new Set(entries.map((entry) => entry.href)).size, entries.length);
  for (const entry of entries) {
    const url = new URL(entry.href);
    assert.equal(url.origin, origin, entry.href);
    assert.equal(url.pathname.includes("/fa/"), false, entry.href);
    assert.equal(url.pathname.includes("/en/"), false, entry.href);
    assert.equal(url.pathname.startsWith("/articles/"), true, entry.href);
    assert.equal(existsSync(path.join(publicDir, lang, url.pathname.slice(1), "index.html")), true, entry.href);
    assert.equal(entry.label.endsWith(entry.title), true, entry.label);
  }
  return entries;
}

const fixture = {};

test.before(() => {
  Object.assign(fixture, buildFixture());
});

test.after(() => {
  if (fixture.dir) rmSync(fixture.dir, { recursive: true, force: true });
});

test("Persian pages render Jalali dates and keep ISO timestamps", () => {
  const created = persianDate("2025-03-20T10:00:00+03:30").display;
  const modified = persianDate("2025-04-01T10:00:00+03:30").display;
  const article = readPage(fixture.publicDir, "fa", "/articles/split/");
  assert.deepEqual(times(article), [{ datetime: "2025-03-21T10:00:00+03:30", text: "۱ فروردین ۱۴۰۴" }]);
  assert.equal(article.includes(created), false);
  assert.equal(article.includes(modified), false);
  assert.match(article, /property="article:published_time" content="2025-03-21T10:00:00\+03:30"/);
  assert.match(article, /property="article:modified_time" content="2025-04-01T10:00:00\+03:30"/);
  assert.equal(jsonField(article, "datePublished"), "2025-03-21T10:00:00+03:30");
  assert.equal(jsonField(article, "dateModified"), "2025-04-01T10:00:00+03:30");
  assert.equal(article.includes('href="https://abdolirad.ir/fa/'), false);

  const home = readPage(fixture.publicDir, "fa", "/");
  assert.ok(times(home).some((item) => item.text === "۲۶ مهر ۱۴۰۵" && item.datetime === "2026-10-18T10:16:00+02:00"));
  assert.ok(times(home).some((item) => item.text === "۱ فروردین ۱۴۰۴" && item.datetime === "2025-03-21T10:00:00+03:30"));
  const list = readPage(fixture.publicDir, "fa", "/articles/");
  assert.ok(times(list).some((item) => item.text === "۳۰ اسفند ۱۴۰۳"));
  assert.ok(times(list).some((item) => item.text === "۱ فروردین ۱۴۰۴" && item.datetime === "2025-03-21T10:00:00+03:30"));

  const feed = readFileSync(path.join(fixture.publicDir, "fa", "index.xml"), "utf8");
  assert.match(feed, /<pubDate>Sun, 18 Oct 2026 10:16:00 \+0200<\/pubDate>/);
  assert.match(feed, /<pubDate>Thu, 20 Mar 2025 23:30:00 -0500<\/pubDate>/);
  assert.match(feed, /<pubDate>Fri, 21 Mar 2025 10:00:00 \+0330<\/pubDate>/);
  assert.equal(feed.includes("20 Mar 2025 10:00:00 +0330"), false);
  assert.equal(feed.includes("01 Apr 2025"), false);
  assert.equal(feed.includes("مهر"), false);
  const sitemap = readFileSync(path.join(fixture.publicDir, "fa", "sitemap.xml"), "utf8");
  assert.match(sitemap, /<lastmod>2026-10-18T10:16:00\+02:00<\/lastmod>/);
  assert.match(sitemap, /<lastmod>2025-04-01T10:00:00\+03:30<\/lastmod>/);
  assert.equal(sitemap.includes("۱۴۰۵"), false);
});

test("Persian archive groups by Jalali year and month in descending order", () => {
  const outline = archiveOutline(readPage(fixture.publicDir, "fa", "/archives/"));
  assert.deepEqual(outline, [
    {
      year: "۱۴۰۵",
      count: "۳",
      months: [
        { month: "آبان", count: "۱", titles: ["Aban post"] },
        { month: "مهر", count: "۲", titles: ["Mehr late", "Mehr early"] },
      ],
    },
    {
      year: "۱۴۰۴",
      count: "۱",
      months: [{ month: "فروردین", count: "۱", titles: ["Split dates"] }],
    },
    {
      year: "۱۴۰۳",
      count: "۲",
      months: [
        { month: "اسفند", count: "۱", titles: ["Esfand post"] },
        { month: "فروردین", count: "۱", titles: ["Farvardin post"] },
      ],
    },
    {
      year: "۱۴۰۲",
      count: "۱",
      months: [{ month: "اسفند", count: "۱", titles: ["Before Nowruz"] }],
    },
  ]);
  for (const year of outline) {
    assert.equal(year.months.reduce((sum, month) => sum + month.titles.length, 0), Number([...year.count].map((digit) => "۰۱۲۳۴۵۶۷۸۹".indexOf(digit)).join("")));
  }

  const html = readPage(fixture.publicDir, "fa", "/archives/");
  assert.equal(html.includes("Draft post"), false);
  const splitCard = html.slice(html.indexOf("Split dates"), html.indexOf("Split dates") + 700);
  assert.equal(splitCard.includes(persianDate("2025-03-20T10:00:00+03:30").display), false);
  assert.equal(splitCard.includes(persianDate("2025-04-01T10:00:00+03:30").display), false);
  const split = archiveEntries(html).find((entry) => entry.title === "Split dates");
  assert.deepEqual(split.times, [{ datetime: "2025-03-21T10:00:00+03:30", text: "۱ فروردین ۱۴۰۴" }]);

  const anchors = assertFragments(html);
  assert.ok(anchors.some((anchor) => anchor.id === "۱۴۰۵" && anchor.href.startsWith("#")));
  assert.ok(anchors.some((anchor) => anchor.id === "۱۴۰۵-مهر"));
  assert.ok(anchors.some((anchor) => anchor.id === "۱۴۰۳-اسفند"));
  assert.ok(anchors.some((anchor) => anchor.id === "۱۴۰۲-اسفند"));
  assert.match(html, /<h1[\s\S]*بایگانی/);
  assert.equal(html.includes("آرشیو"), false);
  assert.match(html, /href="https:\/\/abdolirad\.ir\/archives\/"/);
  const footer = html.match(/<footer class="footer"[\s\S]*?<\/footer>/)?.[0] ?? "";
  assert.match(footer, new RegExp(`&copy; ${jalaliYear()}`));
  assert.match(footer, /ساخته شده با/);
  assert.match(footer, /dir="ltr"[^>]*>Hugo</);
  assert.equal(footer.includes("Powered by"), false);
  const entries = assertArticleLinks(fixture.publicDir, "fa", html, "https://abdolirad.ir");
  assert.ok(entries.every((entry) => entry.label.startsWith("پیوند به ")));
  const titles = outline.flatMap((year) => year.months.flatMap((month) => month.titles));
  assert.deepEqual(entries.map((entry) => entry.title), titles);
});

test("English fixture pages keep Gregorian dates and archive groups", () => {
  const article = readPage(fixture.publicDir, "en", "/articles/october/");
  assert.match(article, /October 18, 2026/);
  assert.equal(article.includes("<time"), false);
  assert.equal(article.includes("۱۴۰۵"), false);
  assert.equal(article.includes("مهر"), false);
  assert.match(article, /property="article:published_time" content="2026-10-18T10:16:00\+02:00"/);
  assert.equal(jsonField(article, "datePublished"), "2026-10-18T10:16:00+02:00");

  const split = readPage(fixture.publicDir, "en", "/articles/split-publication/");
  assert.match(split, /March 21, 2025/);
  assert.equal(split.includes("January 15, 2026"), false);
  assert.match(split, /property="article:published_time" content="2025-03-21T10:00:00\+03:30"/);
  assert.match(split, /property="article:modified_time" content="2025-04-01T10:00:00\+03:30"/);
  assert.equal(jsonField(split, "datePublished"), "2025-03-21T10:00:00+03:30");
  assert.equal(jsonField(split, "dateModified"), "2025-04-01T10:00:00+03:30");

  const html = readPage(fixture.publicDir, "en", "/archives/");
  assert.deepEqual(archiveOutline(html), [
    { year: "2026", count: "1", months: [{ month: "October", count: "1", titles: ["October post"] }] },
    {
      year: "2025",
      count: "2",
      months: [{ month: "March", count: "2", titles: ["Split publication", "March post"] }],
    },
  ]);
  assert.equal(html.includes("January"), false);
  const anchors = assertFragments(html);
  assert.ok(anchors.some((anchor) => anchor.id === "2026-October"));
  assert.ok(anchors.some((anchor) => anchor.id === "2025-March"));
  const entries = assertArticleLinks(fixture.publicDir, "en", html, "https://abdolirad.me");
  assert.ok(entries.every((entry) => entry.label.startsWith("post link to ")));
  assert.match(html, /March 21, 2025/);
  assert.match(html, /<h1[\s\S]*Archive/);
  const footer = html.match(/<footer class="footer"[\s\S]*?<\/footer>/)?.[0] ?? "";
  assert.match(footer, new RegExp(`&copy; ${new Date().getFullYear()}`));
  assert.match(footer, /Powered by[\s\S]*Hugo[\s\S]*PaperMod/);
  assert.equal(footer.includes("ساخته شده با"), false);
});

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

function readingLabel(html) {
  return html.match(/<span>((?:\d+|[\u06F0-\u06F9]+) (?:min|دقیقه))<\/span>/)?.[1] ?? null;
}

test("reading time keeps its length and uses Persian digits on Persian pages", () => {
  const words = Array.from({ length: 2000 }, () => "word").join(" ");
  const built = buildCase(
    {
      "fa/articles/short.md": page("Short", { date: "2024-03-20T00:00:00Z" }, "سلام"),
      "en/articles/short.md": page("Short", { date: "2024-03-20T00:00:00Z" }, "Hello"),
      "fa/articles/long.md": page("Long", { date: "2024-03-21T00:00:00Z" }, words),
      "en/articles/long.md": page("Long", { date: "2024-03-21T00:00:00Z" }, words),
    },
    ["--quiet"],
  );
  try {
    assert.equal(built.result.status, 0, `${built.result.stdout}\n${built.result.stderr}`);
    const faShort = readPage(built.publicDir, "fa", "/articles/short/");
    const enShort = readPage(built.publicDir, "en", "/articles/short/");
    assert.equal(readingLabel(faShort), "۱ دقیقه");
    assert.equal(readingLabel(enShort), "1 min");
    assert.match(faShort, /<time\b[^>]*datetime="2024-03-20T00:00:00Z"/);

    const enLong = readingLabel(readPage(built.publicDir, "en", "/articles/long/"));
    const minutes = enLong?.match(/^(\d+) min$/)?.[1];
    assert.ok(minutes && minutes.length >= 2, enLong);
    const persianMinutes = minutes.replace(/[0-9]/g, (digit) => PERSIAN_DIGITS[Number(digit)]);
    assert.equal(readingLabel(readPage(built.publicDir, "fa", "/articles/long/")), `${persianMinutes} دقیقه`);
  } finally {
    rmSync(built.dir, { recursive: true, force: true });
  }
});

test("a published article without a publication date fails the build", () => {
  const built = buildCase({
    "fa/archives.md": page("بایگانی", { layout: "archives", url: "/archives/" }),
    "en/archives.md": page("Archive", { layout: "archives", url: "/archives/" }),
    "fa/articles/undated.md": page("Undated post", {}),
  });
  try {
    assert.notEqual(built.result.status, 0);
    const output = `${built.result.stdout}\n${built.result.stderr}`;
    assert.match(output, /no publication date/);
    assert.match(output, /undated/);
  } finally {
    rmSync(built.dir, { recursive: true, force: true });
  }
});

test("drafts and future articles follow Hugo publication rules", () => {
  const built = buildCase(
    {
      "fa/archives.md": page("بایگانی", { layout: "archives", url: "/archives/" }),
      "en/archives.md": page("Archive", { layout: "archives", url: "/archives/" }),
      "fa/articles/live.md": page("Live post", { date: "2024-03-20T00:00:00Z" }),
      "fa/articles/future.md": page("Future post", { publishDate: "2099-01-01T00:00:00Z" }),
      "fa/articles/draft.md": page("Draft post", { date: "2024-03-20T00:00:00Z", draft: true }),
    },
    ["--quiet"],
  );
  try {
    assert.equal(built.result.status, 0, `${built.result.stdout}\n${built.result.stderr}`);
    const html = readPage(built.publicDir, "fa", "/archives/");
    assert.match(html, /Live post/);
    assert.equal(html.includes("Future post"), false);
    assert.equal(html.includes("Draft post"), false);
    assert.equal(archiveEntries(html).length, 1);
  } finally {
    rmSync(built.dir, { recursive: true, force: true });
  }
});

function metaValues(html, attr, value) {
  return [...html.matchAll(/<meta\b[^>]*>/gi)]
    .map((match) => attributes(match[0]))
    .filter((attrs) => attrs[attr] === value)
    .map((attrs) => attrs.content ?? "");
}

function linkHref(html, where) {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    if (where(attrs)) return attrs.href ?? null;
  }
  return null;
}

test("keywords and descriptions follow PaperMod without copying page text", () => {
  const built = buildCase(
    {
      "en/about.md": page("About", {
        url: "/about/",
        description: "English about description",
        keywords: ["about-en"],
      }),
      "fa/about.md": page("درباره", {
        url: "/about/",
        summary: "خلاصه فارسی",
        keywords: ["درباره-فا"],
      }),
      "en/articles/shared.md": page("Shared", {
        date: "2024-03-20T00:00:00Z",
        lastmod: "2024-05-02T00:00:00Z",
        description: "English shared description",
        keywords: ["explicit-en", 'say "hi" & <b>'],
        tags: ["hidden-en"],
      }),
      "fa/articles/shared.md": page("مشترک", {
        date: "2024-03-20T00:00:00Z",
        lastmod: "2024-06-03T00:00:00Z",
        description: "توضیح مشترک",
        keywords: ["صریح-فا"],
        tags: ["پنهان-فا"],
      }),
      "en/articles/tagged.md": page("Tagged", {
        date: "2024-03-21T00:00:00Z",
        tags: ["tag-en", "a < b"],
      }),
      "en/articles/plain.md": page("Plain title", { date: "2024-03-22T00:00:00Z" }, ""),
      "en/archives.md": page("Archive", { layout: "archives", url: "/archives/" }),
      "fa/archives.md": page("بایگانی", { layout: "archives", url: "/archives/" }),
    },
    ["--quiet"],
    { enKeywords: ["home-en", "a < b"], faKeywords: ["خانه", "نیم‌فاصله"] },
  );
  try {
    assert.equal(built.result.status, 0, `${built.result.stdout}\n${built.result.stderr}`);
    const enHome = readPage(built.publicDir, "en", "/");
    const faHome = readPage(built.publicDir, "fa", "/");
    assert.deepEqual(metaValues(enHome, "name", "keywords"), ["home-en, a &lt; b"]);
    assert.deepEqual(metaValues(faHome, "name", "keywords"), ["خانه, نیم‌فاصله"]);
    assert.equal(attributes(enHome.match(/<html\b[^>]*>/)[0]).lang, "en");
    assert.equal(attributes(faHome.match(/<html\b[^>]*>/)[0]).lang, "fa");
    assert.match(enHome, /<title>Mohammad Abdolirad<\/title>/);
    assert.match(faHome, /<title>محمد عبدلی‌راد<\/title>/);

    const enShared = readPage(built.publicDir, "en", "/articles/shared/");
    const faShared = readPage(built.publicDir, "fa", "/articles/shared/");
    assert.deepEqual(metaValues(enShared, "name", "keywords"), ['explicit-en, say &#34;hi&#34; &amp; &lt;b&gt;']);
    assert.equal(metaValues(enShared, "name", "keywords")[0].includes("hidden-en"), false);
    assert.deepEqual(metaValues(faShared, "name", "keywords"), ["صریح-فا"]);
    assert.equal(metaValues(faShared, "name", "keywords")[0].includes("پنهان-فا"), false);
    assert.equal(metaValues(faShared, "name", "keywords")[0].includes("explicit-en"), false);
    assert.equal(metaValues(enShared, "name", "description")[0].trim(), "English shared description");
    assert.equal(metaValues(faShared, "name", "description")[0].trim(), "توضیح مشترک");
    assert.equal(metaValues(enShared, "property", "og:description")[0], "English shared description");
    assert.equal(metaValues(faShared, "property", "og:description")[0], "توضیح مشترک");
    assert.equal(linkHref(enShared, (attrs) => attrs.rel === "canonical"), "https://abdolirad.me/articles/shared/");
    assert.equal(linkHref(faShared, (attrs) => attrs.rel === "canonical"), "https://abdolirad.ir/articles/shared/");
    assert.equal(linkHref(enShared, (attrs) => attrs.hreflang === "fa"), "https://abdolirad.ir/articles/shared/");
    assert.equal(linkHref(faShared, (attrs) => attrs.hreflang === "en"), "https://abdolirad.me/articles/shared/");
    assert.equal(jsonField(enShared, "datePublished"), "2024-03-20T00:00:00Z");
    assert.equal(jsonField(enShared, "dateModified"), "2024-05-02T00:00:00Z");
    assert.equal(jsonField(faShared, "dateModified"), "2024-06-03T00:00:00Z");
    assert.match(enShared, /<title>Shared \| Mohammad Abdolirad<\/title>/);
    assert.match(faShared, /<title>مشترک \| محمد عبدلی‌راد<\/title>/);
    assert.match(enShared, /<span>Translations:<\/span>/);
    assert.match(faShared, /<span>ترجمه‌ها:<\/span>/);
    assert.equal(faShared.includes("ترجمه ها"), false);

    const about = readPage(built.publicDir, "en", "/about/");
    const faAbout = readPage(built.publicDir, "fa", "/about/");
    assert.deepEqual(metaValues(about, "name", "keywords"), ["about-en"]);
    assert.deepEqual(metaValues(faAbout, "name", "keywords"), ["درباره-فا"]);
    assert.equal(metaValues(about, "name", "description")[0].trim(), "English about description");
    assert.equal(metaValues(faAbout, "name", "description")[0].trim(), "خلاصه فارسی");

    const tagged = readPage(built.publicDir, "en", "/articles/tagged/");
    assert.deepEqual(metaValues(tagged, "name", "keywords"), ["tag-en, a &lt; b"]);
    const plain = readPage(built.publicDir, "en", "/articles/plain/");
    assert.deepEqual(metaValues(plain, "name", "keywords"), [""]);
    assert.equal(metaValues(plain, "name", "description")[0].replace(/\s+/g, " ").trim(), "Plain title - Mohammad Abdolirad");

    for (const [lang, origin] of [["en", "https://abdolirad.me"], ["fa", "https://abdolirad.ir"]]) {
      const archive = readPage(built.publicDir, lang, "/archives/");
      assert.deepEqual(metaValues(archive, "name", "keywords"), [""]);
      assert.equal(linkHref(archive, (attrs) => attrs.rel === "canonical"), `${origin}/archives/`);
      assert.equal(archive.includes("home-en"), false);
      assert.equal(archive.includes("نیم‌فاصله"), false);
    }
  } finally {
    rmSync(built.dir, { recursive: true, force: true });
  }
});

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("leaf bundles keep a stable date-free permalink and local images", () => {
  const shared = {
    date: "2024-03-20T00:00:00Z",
    slug: "kept-slug",
  };
  const layouts = [
    { dir: "kept-slug", enTitle: "First working title", faTitle: "عنوان نخست" },
    { dir: "2026/10/renamed-dir", enTitle: "A renamed title", faTitle: "عنوان دوم" },
  ];
  const canonicals = [];

  for (const layout of layouts) {
    const built = buildCase(
      {
        "en/articles/_index.md": page("Articles", {}),
        "fa/articles/_index.md": page("مقالات", {}),
        "en/archives.md": page("Archive", { layout: "archives", url: "/archives/" }),
        "fa/archives.md": page("بایگانی", { layout: "archives", url: "/archives/" }),
        [`en/articles/${layout.dir}/index.md`]: page(
          layout.enTitle,
          { ...shared, summary: "Stable summary", keywords: ["bundle-key"] },
          "English body stays.\n\n![Architecture diagram](diagram.png)\n",
        ),
        [`en/articles/${layout.dir}/diagram.png`]: TINY_PNG,
        [`fa/articles/${layout.dir}/index.md`]: page(
          layout.faTitle,
          { ...shared, summary: "خلاصه پایدار", keywords: ["کلید-بسته"] },
          "متن فارسی می‌ماند.\n\n![نمودار معماری](diagram.png)\n",
        ),
        [`fa/articles/${layout.dir}/diagram.png`]: TINY_PNG,
        "en/articles/older-note/index.md": page("Older note", { date: "2024-01-01T00:00:00Z", slug: "older-note" }, "older body"),
        "fa/articles/older-note/index.md": page("یادداشت قدیمی", { date: "2024-01-01T00:00:00Z", slug: "older-note" }, "متن قدیمی"),
        "en/articles/draft-note/index.md": page("Draft note", { date: "2024-02-01T00:00:00Z", slug: "draft-note", draft: true }, "draft body"),
        "fa/articles/draft-note/index.md": page("پیش نویس آزمایشی", { date: "2024-02-01T00:00:00Z", slug: "draft-note", draft: true }, "متن پیش نویس"),
        "en/articles/plain-bundle/index.md": page("A Completely Different Title", { date: "2024-05-01T00:00:00Z" }, "plain bundle body"),
        "fa/articles/plain-bundle/index.md": page("عنوانی کاملا متفاوت", { date: "2024-05-01T00:00:00Z" }, "بدنه بسته ساده"),
      },
      ["--buildDrafts", "--quiet"],
    );
    try {
      assert.equal(built.result.status, 0, `${layout.dir}\n${built.result.stdout}\n${built.result.stderr}`);
      for (const [lang, origin, home, section, alt] of [
        ["en", "https://abdolirad.me", "Home", "Articles", "Architecture diagram"],
        ["fa", "https://abdolirad.ir", "خانه", "مقالات", "نمودار معماری"],
      ]) {
        const permalink = `${origin}/articles/kept-slug/`;
        const html = readPage(built.publicDir, lang, "/articles/kept-slug/");
        const title = lang === "en" ? layout.enTitle : layout.faTitle;
        assert.match(html, new RegExp(`<title>${title} \\|`));
        assert.equal(linkHref(html, (attrs) => attrs.rel === "canonical"), permalink);
        assert.equal(html.includes("/2026/"), false, permalink);
        assert.equal(html.includes(`/${lang}/articles/`), false, permalink);
        assert.match(html, new RegExp(`<img[^>]*alt="${alt}"[^>]*>`));
        assert.match(html, /diagram\.png/);
        const image = path.join(built.publicDir, lang, "articles", "kept-slug", "diagram.png");
        assert.equal(existsSync(image), true, image);
        assert.equal(readFileSync(image).equals(TINY_PNG), true);

        const nav = html.match(/<nav class="breadcrumbs"[\s\S]*?<\/nav>/)?.[0] ?? "";
        const labels = [...nav.matchAll(/<a\b[^>]*>([^<]*)<\/a>/g)].map((match) => match[1].trim());
        assert.deepEqual(labels, [home, section]);
        assert.match(nav, /feather-chevron-right/);
        assert.equal(nav.includes("scaleX"), false);

        const list = readPage(built.publicDir, lang, "/articles/");
        const archive = readPage(built.publicDir, lang, "/archives/");
        const feed = readFileSync(path.join(built.publicDir, lang, "index.xml"), "utf8");
        const sitemap = readFileSync(path.join(built.publicDir, lang, "sitemap.xml"), "utf8");
        for (const surface of [list, archive, feed, sitemap]) assert.equal(surface.includes(permalink), true, permalink);
        const neighbor = readPage(built.publicDir, lang, "/articles/plain-bundle/");
        assert.match(html, /\/articles\/plain-bundle\//);
        assert.match(neighbor, /\/articles\/kept-slug\//);
        if (lang === "fa") {
          assert.match(archive, /title="پیش‌نویس"/);
          assert.match(html, /خلاصه پایدار/);
        } else {
          assert.match(archive, /title="Draft"/);
          assert.match(html, /Stable summary/);
        }
        canonicals.push(permalink);
      }
      const plain = readPage(built.publicDir, "en", "/articles/plain-bundle/");
      assert.equal(linkHref(plain, (attrs) => attrs.rel === "canonical"), "https://abdolirad.me/articles/plain-bundle/");
      assert.equal(plain.includes("/articles/a-completely-different-title/"), false);
      assert.equal(plain.includes("/articles/index/"), false);
    } finally {
      rmSync(built.dir, { recursive: true, force: true });
    }
  }

  assert.deepEqual(canonicals, [
    "https://abdolirad.me/articles/kept-slug/",
    "https://abdolirad.ir/articles/kept-slug/",
    "https://abdolirad.me/articles/kept-slug/",
    "https://abdolirad.ir/articles/kept-slug/",
  ]);
});

test("duplicate article urls fail the build", () => {
  const buildScript = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts.build;
  assert.match(buildScript, /hugo\s+.*--panicOnWarning\b/);

  const date = "2024-03-20T00:00:00Z";
  const cases = [
    {
      name: "same slug in one language",
      args: ["--panicOnWarning"],
      files: {
        "en/articles/one/index.md": page("One", { date, slug: "same-slug" }, "first"),
        "en/articles/two/index.md": page("Two", { date, slug: "same-slug" }, "second"),
        "fa/articles/other/index.md": page("دیگر", { date, slug: "other-slug" }, "متن"),
      },
      fail: /Duplicate target paths: \/en\/articles\/same-slug\/index\.html/,
    },
    {
      name: "url overrides different slugs",
      args: ["--panicOnWarning"],
      files: {
        "en/articles/alpha/index.md": page("Alpha", { date, slug: "alpha", url: "/articles/forced/" }, "a"),
        "en/articles/beta/index.md": page("Beta", { date, slug: "beta", url: "/articles/forced/" }, "b"),
        "fa/articles/other/index.md": page("دیگر", { date, slug: "other-slug" }, "متن"),
      },
      fail: /Duplicate target paths: \/en\/articles\/forced\/index\.html/,
    },
  ];

  for (const item of cases) {
    const built = buildCase(item.files, item.args);
    try {
      const output = `${built.result.stdout}\n${built.result.stderr}`;
      assert.notEqual(built.result.status, 0, `${item.name}\n${output}`);
      assert.match(output, item.fail, item.name);
      assert.equal(/Duplicate target paths: \/en\/articles\/(?:one|two|alpha|beta)\//.test(output), false, output);
    } finally {
      rmSync(built.dir, { recursive: true, force: true });
    }
  }

  const shared = buildCase(
    {
      "en/articles/english-dir/index.md": page("English title", { date, slug: "shared-slug" }, "english"),
      "fa/articles/persian-dir/index.md": page("عنوان فارسی", { date, slug: "shared-slug" }, "فارسی"),
    },
    ["--panicOnWarning", "--quiet"],
  );
  try {
    assert.equal(shared.result.status, 0, `${shared.result.stdout}\n${shared.result.stderr}`);
    assert.equal(
      linkHref(readPage(shared.publicDir, "en", "/articles/shared-slug/"), (attrs) => attrs.rel === "canonical"),
      "https://abdolirad.me/articles/shared-slug/",
    );
    assert.equal(
      linkHref(readPage(shared.publicDir, "fa", "/articles/shared-slug/"), (attrs) => attrs.rel === "canonical"),
      "https://abdolirad.ir/articles/shared-slug/",
    );
  } finally {
    rmSync(shared.dir, { recursive: true, force: true });
  }

  const distinct = buildCase(
    {
      "en/articles/left-dir/index.md": page("Left title", { date, slug: "same-slug", url: "/articles/left/" }, "left"),
      "en/articles/right-dir/index.md": page("Right title", { date, slug: "same-slug", url: "/articles/right/" }, "right"),
      "fa/articles/other/index.md": page("دیگر", { date, slug: "other-slug" }, "متن"),
    },
    ["--panicOnWarning", "--quiet"],
  );
  try {
    assert.equal(distinct.result.status, 0, `${distinct.result.stdout}\n${distinct.result.stderr}`);
    assert.equal(
      linkHref(readPage(distinct.publicDir, "en", "/articles/left/"), (attrs) => attrs.rel === "canonical"),
      "https://abdolirad.me/articles/left/",
    );
    assert.equal(
      linkHref(readPage(distinct.publicDir, "en", "/articles/right/"), (attrs) => attrs.rel === "canonical"),
      "https://abdolirad.me/articles/right/",
    );
    assert.equal(existsSync(path.join(distinct.publicDir, "en", "articles", "same-slug", "index.html")), false);
  } finally {
    rmSync(distinct.dir, { recursive: true, force: true });
  }
});

test("the article archetype creates a draft leaf bundle", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "article-archetype-"));
  const contentDir = path.join(dir, "en");
  const created = path.join(contentDir, "articles", "example-article", "index.md");
  const leaked = path.join(root, "content", "en", "articles", "example-article");
  mkdirSync(contentDir, { recursive: true });
  writeFileSync(path.join(dir, "overlay.yaml"), `languages:\n  en:\n    contentDir: ${JSON.stringify(contentDir)}\n`);
  try {
    const result = spawnSync(
      "hugo",
      ["new", "content", "articles/example-article/index.md", "--config", `hugo.yaml,${path.join(dir, "overlay.yaml")}`, "--quiet"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(existsSync(created), true);
    assert.equal(existsSync(leaked), false);
    const text = readFileSync(created, "utf8");
    assert.match(text, /^slug:\s*['"]example-article['"]$/m);
    assert.match(text, /^title:\s*['"]Example Article['"]$/m);
    assert.match(text, /^draft:\s*true$/m);
    assert.match(text, /^date:\s*['"]\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})['"]$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(leaked, { recursive: true, force: true });
  }
});
