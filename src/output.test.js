import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relative) {
  const file = path.join(root, relative);
  assert.equal(existsSync(file), true, `missing ${relative}; run npm run build`);
  return readFileSync(file, "utf8");
}

function canonical(html) {
  return html.match(/rel="canonical" href="([^"]+)"/)?.[1] ?? html.match(/rel=canonical href=([^ >]+)/)?.[1];
}

test("both language trees use their public domains", () => {
  const english = read("public/en/index.html");
  const persian = read("public/fa/index.html");

  assert.equal(existsSync(path.join(root, "public", "index.html")), false);
  assert.equal(canonical(english), "https://abdolirad.me/");
  assert.equal(canonical(persian), "https://abdolirad.ir/");
  assert.match(english, /\bdir="?ltr\b/);
  assert.match(persian, /\bdir="?rtl\b/);
  assert.equal(/https:\/\/abdolirad\.me\/en(\/|"|>|\s)/.test(english), false);
  assert.equal(/https:\/\/abdolirad\.ir\/fa(\/|"|>|\s)/.test(persian), false);
  assert.match(read("public/en/robots.txt"), /Sitemap: https:\/\/abdolirad\.me\/sitemap\.xml/);
  assert.match(read("public/fa/robots.txt"), /Sitemap: https:\/\/abdolirad\.ir\/sitemap\.xml/);
  assert.match(read("public/en/sitemap.xml"), /<loc>https:\/\/abdolirad\.me\//);
  assert.match(read("public/fa/sitemap.xml"), /<loc>https:\/\/abdolirad\.ir\//);
});

test("homepages show the blog name and a separate professional title", () => {
  const english = read("public/en/index.html");
  const persian = read("public/fa/index.html");

  assert.match(english, /The Other Branch/);
  assert.match(persian, /شاخهٔ دیگر/);
  assert.match(english, /<h1>Mohammad Abdolirad<\/h1>/);
  assert.match(persian, /<h1>محمد عبدلی‌راد<\/h1>/);
  assert.match(english, /<h2[^>]*>Software & Platform Engineer<\/h2>/);
  assert.match(persian, /<h2[^>]*>مهندس نرم‌افزار و پلتفرم<\/h2>/);
  assert.match(english, /I build software and developer tools with a focus on simplicity, reliability, and developer experience\. Here, I write about engineering decisions, real-world challenges, and lessons learned along the way\./);
  assert.match(persian, /من نرم‌افزار و ابزارهایی برای توسعه‌دهندگان می‌سازم\. در طراحی آن‌ها، سادگی، قابل‌اعتماد بودن و تجربهٔ توسعه‌دهنده برایم اهمیت زیادی دارد\. اینجا دربارهٔ تصمیم‌های مهندسی، چالش‌های واقعی و چیزهایی که در این مسیر یاد می‌گیرم، می‌نویسم\./);
  assert.equal(english.includes('class="profile"') || english.includes("class=profile"), false);
  assert.equal(persian.includes('class="profile"') || persian.includes("class=profile"), false);
});
