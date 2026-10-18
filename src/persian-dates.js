import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toJalaali } from "jalaali-js";

// Index 1 is Farvardin. jalaali-js returns months in that range.
const PERSIAN_MONTHS = [
  "",
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
];

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

// The copyright year follows the civil date in Iran, so it changes at Nowruz.
export const COPYRIGHT_TIME_ZONE = "Asia/Tehran";

// Hugo's default front matter date fields, including aliases.
const DATE_FIELDS = new Set([
  "date",
  "publishdate",
  "pubdate",
  "published",
  "lastmod",
  "modified",
  "expirydate",
  "unpublishdate",
]);

const CONTENT_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".html",
  ".htm",
  ".org",
  ".adoc",
  ".asciidoc",
  ".rst",
]);

// The civil date is the year, month, and day written with the offset.
// Moving the instant to UTC first puts timestamps near midnight on the wrong day.
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/;

function persianDigits(value) {
  return String(value).replace(/[0-9]/g, (digit) => PERSIAN_DIGITS[Number(digit)]);
}

function normalizeOffset(offset) {
  if (!offset || offset === "Z") return "Z";
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(offset);
  if (!match) throw new Error(`invalid UTC offset ${offset}`);
  const [, sign, hours, minutes] = match;
  if (Number(hours) > 23 || Number(minutes) > 59) throw new Error(`invalid UTC offset ${offset}`);
  if (hours === "00" && minutes === "00") return "Z";
  return `${sign}${hours}:${minutes}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

// Hugo prints page dates with layout 2006-01-02T15:04:05Z07:00.
// Date-only values and zero offsets become midnight UTC (Z). Fractional seconds are dropped.
export function hugoDateKey(input) {
  const raw = String(input).trim();
  const match = ISO_DATE.exec(raw);
  if (!match) {
    throw new Error(`unsupported date ${JSON.stringify(raw)}; use YYYY-MM-DD or an ISO 8601 timestamp`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? "0");
  const minute = Number(match[5] ?? "0");
  const second = Number(match[6] ?? "0");
  if (month < 1 || month > 12) throw new Error(`invalid month in ${raw}`);
  if (hour > 23 || minute > 59 || second > 59) throw new Error(`invalid time in ${raw}`);

  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new Error(`invalid Gregorian date ${raw}`);
  }

  return {
    key: `${match[1]}-${match[2]}-${match[3]}T${pad(hour)}:${pad(minute)}:${pad(second)}${normalizeOffset(match[7])}`,
    year,
    month,
    day,
  };
}

function civilDate(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const fields = {};
  for (const part of parts) {
    if (part.type === "year" || part.type === "month" || part.type === "day") fields[part.type] = part.value;
  }
  if (!fields.year || !fields.month || !fields.day) {
    throw new Error(`could not read the civil date in ${timeZone}`);
  }
  return `${fields.year}-${fields.month.padStart(2, "0")}-${fields.day.padStart(2, "0")}`;
}

export function jalaliYear(instant = new Date(), timeZone = COPYRIGHT_TIME_ZONE) {
  return persianDate(civilDate(instant, timeZone)).year;
}

export function persianDate(input) {
  const civil = hugoDateKey(input);
  const converted = toJalaali(civil.year, civil.month, civil.day);
  const monthName = PERSIAN_MONTHS[converted.jm];
  if (!monthName) throw new Error(`Jalaali month ${converted.jm} is outside 1-12 for ${input}`);

  return {
    key: civil.key,
    display: `${persianDigits(converted.jd)} ${monthName} ${persianDigits(converted.jy)}`,
    year: persianDigits(converted.jy),
    month: monthName,
    ysort: String(converted.jy).padStart(4, "0"),
    msort: String(converted.jm).padStart(2, "0"),
  };
}

export function assertHugoDateConfig(configText) {
  const unsupported = [];
  if (/^enableGitInfo:\s*true\b/m.test(configText)) unsupported.push("enableGitInfo");
  if (/^frontmatter:/m.test(configText)) unsupported.push("frontmatter");
  if (/^timeZone:/m.test(configText)) unsupported.push("timeZone");
  if (unsupported.length === 0) return;
  throw new Error(
    `Persian date generation follows Hugo's default date rules. Unsupported hugo.yaml settings: ${unsupported.join(", ")}.`,
  );
}

function closingDoubleQuote(value) {
  let escaped = false;
  for (let index = 1; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') return index;
  }
  throw new Error(`unterminated string ${JSON.stringify(value)}`);
}

function scalarValue(raw) {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "~" || /^null$/i.test(trimmed)) return "";
  if (trimmed.startsWith("|") || trimmed.startsWith(">")) {
    throw new Error("date values must be a single line");
  }
  if (trimmed.startsWith("'")) {
    const end = trimmed.indexOf("'", 1);
    if (end < 1) throw new Error(`unterminated string ${JSON.stringify(trimmed)}`);
    return trimmed.slice(1, end);
  }
  if (trimmed.startsWith('"')) {
    const end = closingDoubleQuote(trimmed);
    return JSON.parse(trimmed.slice(0, end + 1));
  }
  const commentAt = trimmed.search(/\s+#/);
  return (commentAt === -1 ? trimmed : trimmed.slice(0, commentAt)).trim();
}

function yamlDateValues(body) {
  const values = [];
  for (const line of body.split("\n")) {
    if (!line || line.startsWith(" ") || line.startsWith("\t") || line.startsWith("#")) continue;
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!match || !DATE_FIELDS.has(match[1].toLowerCase())) continue;
    const value = scalarValue(match[2]);
    if (value) values.push(value);
  }
  return values;
}

function tomlDateValues(body) {
  const values = [];
  let inTable = false;
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("[")) {
      inTable = true;
      continue;
    }
    if (inTable) continue;
    const match = /^([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(trimmed);
    if (!match || !DATE_FIELDS.has(match[1].toLowerCase())) continue;
    const value = scalarValue(match[2]);
    if (value) values.push(value);
  }
  return values;
}

function leadingJsonObject(source) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(0, index + 1);
    }
  }
  throw new Error("unterminated JSON front matter");
}

function jsonDateValues(source) {
  const parsed = JSON.parse(leadingJsonObject(source));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const values = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (!DATE_FIELDS.has(key.toLowerCase())) continue;
    if (typeof value !== "string") throw new Error(`${key} must be a string`);
    if (value.trim()) values.push(value.trim());
  }
  return values;
}

function delimitedBlock(source, marker) {
  if (!source.startsWith(marker)) return null;
  const lineEnd = source.indexOf("\n");
  if (lineEnd === -1) throw new Error("unterminated front matter");
  const closeAt = source.indexOf(`\n${marker}`, lineEnd);
  if (closeAt === -1) throw new Error("unterminated front matter");
  return source.slice(lineEnd + 1, closeAt);
}

export function frontMatterDates(text) {
  const source = text.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const trimmed = source.trimStart();
  const leading = source.slice(source.indexOf(trimmed));
  if (leading.startsWith("---")) return yamlDateValues(delimitedBlock(leading, "---"));
  if (leading.startsWith("+++")) return tomlDateValues(delimitedBlock(leading, "+++"));
  if (leading.startsWith("{")) return jsonDateValues(leading);
  return [];
}

function contentFiles(contentDir) {
  const files = [];
  const pending = [contentDir];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile() && CONTENT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(full);
    }
  }
  return files.sort();
}

export function collectPersianDates(contentDir) {
  const records = {};
  for (const file of contentFiles(contentDir)) {
    let values;
    try {
      values = frontMatterDates(readFileSync(file, "utf8"));
    } catch (error) {
      throw new Error(`${file}: ${error.message}`, { cause: error });
    }
    for (const value of values) {
      let record;
      try {
        record = persianDate(value);
      } catch (error) {
        throw new Error(`${file}: ${error.message}`, { cause: error });
      }
      records[record.key] = record;
    }
  }
  return records;
}

export function generatePersianDates({
  root,
  contentDir = path.join(root, "content"),
  configPath = path.join(root, "hugo.yaml"),
  outFile = path.join(root, "data", "persianDates.json"),
  now = new Date(),
}) {
  assertHugoDateConfig(readFileSync(configPath, "utf8"));
  const records = collectPersianDates(contentDir);
  const body = {};
  for (const key of Object.keys(records).sort()) {
    const record = records[key];
    body[key] = {
      display: record.display,
      year: record.year,
      month: record.month,
      ysort: record.ysort,
      msort: record.msort,
    };
  }
  body.copyrightYear = jalaliYear(now);
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(body, null, 2)}\n`);
  return body;
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  generatePersianDates({ root: path.resolve(path.dirname(modulePath), "..") });
}
