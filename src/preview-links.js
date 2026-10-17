// Preview pages are built with production URLs. Rewrite navigation so it stays
// on the preview host. Canonical, hreflang, Open Graph, and JSON-LD are not
// anchors, so they keep the production domains.

import { PRODUCTION_HOSTS, normalizeHost } from "./hosts.js";

const ABSOLUTE_HTTP = /^(https?:)?\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i;
const HTTP_SCHEME = /^https?:/i;
const OTHER_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const URL_PARTS = /^([^?#]*)(\?[^#]*)?(#.*)?$/;
const LANGUAGES = new Set(["en", "fa"]);
const VALIDATOR_HEADERS = [
  "content-length",
  "etag",
  "content-md5",
  "digest",
  "content-digest",
  "repr-digest",
];
const SHARED_ASSETS = new Set([
  "/favicon.ico",
  "/favicon-16x16.png",
  "/favicon-32x32.png",
  "/apple-touch-icon.png",
  "/safari-pinned-tab.svg",
]);

export function rewritePreviewHref(value, lang) {
  if (typeof value !== "string" || value.length === 0) return value;
  const href = value.trim();
  if (OTHER_SCHEME.test(href) && !HTTP_SCHEME.test(href)) return value;

  const absolute = ABSOLUTE_HTTP.exec(href);
  if (absolute) {
    const language = languageForHost(absolute[2]);
    if (!language) return value;
    return assemble(language, absolute[3], absolute[4], absolute[5]);
  }

  if (!href.startsWith("/") || href.startsWith("//") || !LANGUAGES.has(lang)) return value;
  const parts = URL_PARTS.exec(href);
  const path = parts[1] || "/";
  if (isSharedAsset(path) || hasLanguagePrefix(path)) return value;
  return assemble(lang, path, parts[2], parts[3]);
}

export function rewritePreviewDocument(response, lang) {
  const headers = new Headers(response.headers);
  for (const name of VALIDATOR_HEADERS) headers.delete(name);
  const source = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  return new HTMLRewriter()
    .on("a", {
      element(element) {
        const href = element.getAttribute("href");
        if (href == null) return;
        const next = rewritePreviewHref(href, lang);
        if (next !== href) element.setAttribute("href", next);
      },
    })
    .transform(source);
}

function languageForHost(authority) {
  if (!authority || authority.includes("@") || authority.includes("\\") || authority.startsWith("[")) {
    return null;
  }
  let host = authority;
  const colon = host.lastIndexOf(":");
  if (colon !== -1) {
    const port = host.slice(colon + 1);
    if (port !== "80" && port !== "443") return null;
    host = host.slice(0, colon);
  }
  if (!host) return null;
  return PRODUCTION_HOSTS[normalizeHost(host)] ?? null;
}

function assemble(lang, path, search, hash) {
  const pathname = path === "" || path === "/" ? `/${lang}/` : `/${lang}${path.startsWith("/") ? path : `/${path}`}`;
  return `${pathname}${search || ""}${hash || ""}`;
}

function isSharedAsset(path) {
  return path === "/assets" || path.startsWith("/assets/") || SHARED_ASSETS.has(path);
}

function hasLanguagePrefix(path) {
  return path === "/en" || path === "/fa" || path.startsWith("/en/") || path.startsWith("/fa/");
}
