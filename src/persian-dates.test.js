import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isLeapJalaaliYear } from "jalaali-js";
import {
  assertHugoDateConfig,
  collectPersianDates,
  frontMatterDates,
  generatePersianDates,
  hugoDateKey,
  jalaliYear,
  persianDate,
} from "./persian-dates.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("converts the known Gregorian dates", () => {
  assert.equal(persianDate("2026-10-18").display, "۲۶ مهر ۱۴۰۵");
  assert.equal(persianDate("2026-10-18T10:16:00+02:00").display, "۲۶ مهر ۱۴۰۵");
  assert.equal(persianDate("2025-03-20").display, "۳۰ اسفند ۱۴۰۳");
  assert.equal(persianDate("2025-03-21").display, "۱ فروردین ۱۴۰۴");
  assert.equal(persianDate("2024-03-20").display, "۱ فروردین ۱۴۰۳");
  assert.equal(persianDate("2024-03-19").display, "۲۹ اسفند ۱۴۰۲");
  assert.equal(persianDate("2026-03-20").display, "۲۹ اسفند ۱۴۰۴");
  assert.equal(persianDate("2026-03-21").display, "۱ فروردین ۱۴۰۵");
});

test("uses Persian digits and Persian month names", () => {
  const record = persianDate("2026-10-18T10:16:00+02:00");
  assert.equal(record.display, "۲۶ مهر ۱۴۰۵");
  assert.equal(record.year, "۱۴۰۵");
  assert.equal(record.month, "مهر");
  assert.equal(record.ysort, "1405");
  assert.equal(record.msort, "07");
  assert.equal(record.display.codePointAt(0), 0x06f2);
});

test("marks the leap day at the end of Esfand and the next New Year", () => {
  assert.equal(isLeapJalaaliYear(1403), true);
  assert.equal(isLeapJalaaliYear(1404), false);
  assert.equal(isLeapJalaaliYear(1402), false);
  assert.equal(persianDate("2025-03-20T23:59:59+03:30").display, "۳۰ اسفند ۱۴۰۳");
  assert.equal(persianDate("2025-03-21T00:00:00+03:30").display, "۱ فروردین ۱۴۰۴");
  assert.equal(persianDate("2026-03-20T23:59:59Z").display, "۲۹ اسفند ۱۴۰۴");
  assert.equal(persianDate("2026-03-21T00:00:00Z").display, "۱ فروردین ۱۴۰۵");
});

test("crosses month boundaries on the civil date", () => {
  assert.equal(persianDate("2026-10-22T00:00:00+02:00").display, "۳۰ مهر ۱۴۰۵");
  assert.equal(persianDate("2026-10-23T00:00:00+02:00").display, "۱ آبان ۱۴۰۵");
  assert.equal(persianDate("2026-10-22").month, "مهر");
  assert.equal(persianDate("2026-10-23").month, "آبان");
  assert.equal(persianDate("2026-10-22").ysort, persianDate("2026-10-23").ysort);
});

test("keeps the civil date for offsets on either side of midnight", () => {
  const behind = persianDate("2024-03-19T23:30:00-01:00");
  assert.equal(behind.key, "2024-03-19T23:30:00-01:00");
  assert.equal(behind.display, "۲۹ اسفند ۱۴۰۲");

  const ahead = persianDate("2024-03-20T00:30:00+14:00");
  assert.equal(ahead.key, "2024-03-20T00:30:00+14:00");
  assert.equal(ahead.display, "۱ فروردین ۱۴۰۳");

  const esfand = persianDate("2025-03-20T23:30:00-05:00");
  assert.equal(esfand.key, "2025-03-20T23:30:00-05:00");
  assert.equal(esfand.display, "۳۰ اسفند ۱۴۰۳");

  const nowruz = persianDate("2025-03-21T00:30:00+03:30");
  assert.equal(nowruz.key, "2025-03-21T00:30:00+03:30");
  assert.equal(nowruz.display, "۱ فروردین ۱۴۰۴");
});

test("normalizes timestamps the way Hugo formats them", () => {
  assert.equal(hugoDateKey("2026-10-18").key, "2026-10-18T00:00:00Z");
  assert.equal(hugoDateKey("2026-10-18T10:16:00+00:00").key, "2026-10-18T10:16:00Z");
  assert.equal(hugoDateKey("2026-10-18T10:16:00Z").key, "2026-10-18T10:16:00Z");
  assert.equal(hugoDateKey("2026-10-18T10:16:00+0000").key, "2026-10-18T10:16:00Z");
  assert.equal(hugoDateKey("2024-03-20T01:02:03-0700").key, "2024-03-20T01:02:03-07:00");
  assert.equal(hugoDateKey("2026-10-18 10:16:00+02:00").key, "2026-10-18T10:16:00+02:00");
  assert.equal(hugoDateKey("2026-10-18T10:16+02:00").key, "2026-10-18T10:16:00+02:00");
  assert.equal(hugoDateKey("2026-10-18T10:16:00.9+02:00").key, "2026-10-18T10:16:00+02:00");
  assert.equal(persianDate("2026-10-18T10:16:00+02:00").key, "2026-10-18T10:16:00+02:00");
});

test("publication and modification timestamps stay independent", () => {
  const published = persianDate("2026-10-18T10:16:00+02:00");
  const modified = persianDate("2023-06-15T08:00:00+02:00");
  assert.equal(published.display, "۲۶ مهر ۱۴۰۵");
  assert.equal(modified.display, "۲۵ خرداد ۱۴۰۲");
  assert.notEqual(published.key, modified.key);
});

test("rejects missing and invalid dates", () => {
  assert.throws(() => persianDate(""), /unsupported date/);
  assert.throws(() => persianDate("yesterday"), /unsupported date/);
  assert.throws(() => persianDate("15 Oct 2023"), /unsupported date/);
  assert.throws(() => persianDate("2025-02-31"), /invalid Gregorian date/);
  assert.throws(() => persianDate("2026-10-18T25:00:00Z"), /invalid time/);
  assert.deepEqual(frontMatterDates("---\ntitle: Undated\n---\n"), []);
});

test("reads top-level date fields and ignores nested ones", () => {
  const yaml = `---
title: Example
date: '2026-10-18T10:16:00+02:00'
publishDate: 2025-03-21T00:30:00+03:30
lastmod: "2023-06-15T08:00:00+02:00"
params:
  date: 1999-01-01T00:00:00Z
---
date: 1999-01-01 should stay in the body
`;
  assert.deepEqual(frontMatterDates(yaml), [
    "2026-10-18T10:16:00+02:00",
    "2025-03-21T00:30:00+03:30",
    "2023-06-15T08:00:00+02:00",
  ]);

  const toml = `+++
date = 2024-03-20T00:00:00Z
modified = '2024-03-19T23:30:00-01:00'
[params]
date = 1999-01-01
+++
`;
  assert.deepEqual(frontMatterDates(toml), ["2024-03-20T00:00:00Z", "2024-03-19T23:30:00-01:00"]);

  const json = `{
  "date": "2026-10-18",
  "params": { "date": "1999-01-01" }
}
Body
`;
  assert.deepEqual(frontMatterDates(json), ["2026-10-18"]);
});

test("collects fixture files without dropping publish and modification dates", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "persian-dates-"));
  try {
    writeFileSync(
      path.join(dir, "post.md"),
      "---\ndate: '2026-10-18T10:16:00+02:00'\nlastmod: '2023-06-15T08:00:00+02:00'\n---\n",
    );
    writeFileSync(path.join(dir, "empty.md"), "---\ntitle: Empty\n---\n");
    const records = collectPersianDates(dir);
    assert.equal(records["2026-10-18T10:16:00+02:00"].display, "۲۶ مهر ۱۴۰۵");
    assert.equal(records["2023-06-15T08:00:00+02:00"].display, "۲۵ خرداد ۱۴۰۲");
    assert.equal(Object.keys(records).length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("repository content dates convert without naming pages", () => {
  const records = collectPersianDates(path.join(root, "content"));
  assert.equal(typeof records, "object");
  for (const [key, record] of Object.entries(records)) {
    assert.equal(record.key, key);
    assert.equal(record.display, persianDate(key).display);
    assert.match(record.display, /^[۰-۹]{1,2} \S+ [۰-۹]{4}$/);
  }
});

test("rejects Hugo settings that would synthesize dates", () => {
  assert.doesNotThrow(() => assertHugoDateConfig(readFileSync(path.join(root, "hugo.yaml"), "utf8")));
  assert.throws(() => assertHugoDateConfig("enableGitInfo: true\n"), /enableGitInfo/);
  assert.throws(() => assertHugoDateConfig("frontmatter:\n  date:\n    - date\n"), /frontmatter/);
  assert.throws(() => assertHugoDateConfig('timeZone: "Europe/Amsterdam"\n'), /timeZone/);
});

test("copyright year changes at Nowruz in Tehran", () => {
  assert.equal(jalaliYear(new Date("2026-01-01T00:00:00Z")), "۱۴۰۴");
  assert.equal(jalaliYear(new Date("2025-03-20T20:29:59Z")), "۱۴۰۳");
  assert.equal(jalaliYear(new Date("2025-03-20T20:30:00Z")), "۱۴۰۴");
  assert.equal(jalaliYear(new Date("2026-03-20T20:29:59Z")), "۱۴۰۴");
  assert.equal(jalaliYear(new Date("2026-03-20T20:30:00Z")), "۱۴۰۵");
});

test("writes a deterministic data file", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "persian-dates-out-"));
  const now = new Date("2026-01-01T00:00:00Z");
  try {
    const contentDir = path.join(dir, "content");
    const nested = path.join(contentDir, "fa");
    writeFileSync(path.join(dir, "hugo.yaml"), "title: fixture\n");
    mkdirSync(nested, { recursive: true });
    writeFileSync(
      path.join(nested, "b.md"),
      "---\ndate: 2025-03-21T00:00:00Z\n---\n",
    );
    writeFileSync(
      path.join(nested, "a.md"),
      "---\ndate: 2026-10-18T10:16:00+02:00\n---\n",
    );
    const outFile = path.join(dir, "data", "persianDates.json");
    generatePersianDates({ root: dir, contentDir, configPath: path.join(dir, "hugo.yaml"), outFile, now });
    assert.equal(
      readFileSync(outFile, "utf8"),
      `${JSON.stringify(
        {
          "2025-03-21T00:00:00Z": {
            display: "۱ فروردین ۱۴۰۴",
            year: "۱۴۰۴",
            month: "فروردین",
            ysort: "1404",
            msort: "01",
          },
          "2026-10-18T10:16:00+02:00": {
            display: "۲۶ مهر ۱۴۰۵",
            year: "۱۴۰۵",
            month: "مهر",
            ysort: "1405",
            msort: "07",
          },
          copyrightYear: jalaliYear(now),
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("jalaali-js stays out of the Worker", () => {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(typeof pkg.devDependencies["jalaali-js"], "string");
  assert.equal(pkg.dependencies?.["jalaali-js"], undefined);
  for (const file of ["src/index.js", "src/routing.js", "src/hosts.js", "src/preview-links.js"]) {
    const source = readFileSync(path.join(root, file), "utf8");
    assert.equal(source.includes("jalaali"), false, file);
    assert.equal(source.includes("medium-zoom"), false, file);
  }
  assert.match(readFileSync(path.join(root, ".gitignore"), "utf8"), /^data\/persianDates\.json$/m);
});
