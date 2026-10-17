// Hugo writes each language under public/<lang>. Production and local URLs have no prefix.
// Preview hosts on *.workers.dev may use /en or /fa. Redirects keep that prefix only there.

export const PRODUCTION_HOSTS = {
  "abdolirad.me": "en",
  "abdolirad.ir": "fa",
};

// localhost is English so the default wrangler URL works. fa.localhost is Persian.
export const LOCAL_HOSTS = {
  "en.localhost": "en",
  "fa.localhost": "fa",
  localhost: "en",
  "127.0.0.1": "en",
  "[::1]": "en",
};

// Optional on *.workers.dev. Ignored on production and local hosts.
export const PREVIEW_HOST_HEADER = "x-blog-host";
const PREVIEW_LANG_QUERY = "lang";
const PREVIEW_ROBOTS = "User-agent: *\nDisallow: /\n";

const LANGUAGE_PREFIXES = new Set(["en", "fa"]);
const CONDITIONAL_HEADERS = [
  "if-none-match",
  "if-modified-since",
  "if-match",
  "if-unmodified-since",
  "if-range",
];

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "access-control-allow-origin": "*",
};

const HTML_CACHE = "public, max-age=0, must-revalidate";

export function normalizeHost(hostname) {
  let host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "::1") host = "[::1]";
  return host;
}

export function isPreviewHost(hostname) {
  return normalizeHost(hostname).endsWith(".workers.dev");
}

export function resolveLanguage(url, request) {
  const host = normalizeHost(url.hostname);
  if (PRODUCTION_HOSTS[host]) return PRODUCTION_HOSTS[host];
  if (LOCAL_HOSTS[host]) return LOCAL_HOSTS[host];
  if (!isPreviewHost(host)) return null;
  return previewLanguage(url, request);
}

// Path prefix wins, then ?lang=, then X-Blog-Host. No signal means English.
function previewLanguage(url, request) {
  const canonical = canonicalizePath(url.pathname);
  if (canonical.ok) {
    const prefixed = firstLanguage(canonical.segments);
    if (prefixed) return prefixed;
  }
  if (url.searchParams.has(PREVIEW_LANG_QUERY)) {
    return knownLanguage(url.searchParams.get(PREVIEW_LANG_QUERY));
  }
  if (!request.headers.has(PREVIEW_HOST_HEADER)) return "en";
  return PRODUCTION_HOSTS[previewHost(request.headers.get(PREVIEW_HOST_HEADER))] || null;
}

function knownLanguage(value) {
  const lang = String(value || "").toLowerCase();
  return lang === "en" || lang === "fa" ? lang : null;
}

function firstLanguage(segments) {
  if (segments.length === 0) return null;
  return knownLanguage(segments[0]);
}

function stripPreviewPrefix(canonical) {
  const prefix = firstLanguage(canonical.segments);
  if (!prefix) return null;
  const parts = canonical.pathname.split("/").filter((part) => part !== "");
  parts.shift();
  let pathname = "/";
  if (parts.length > 0) {
    pathname = `/${parts.join("/")}`;
    if (canonical.pathname.endsWith("/")) pathname += "/";
  }
  return { prefix, pathname, segments: canonical.segments.slice(1) };
}

function previewHost(value) {
  if (!value) return "";
  let host = value.trim().toLowerCase().replace(/\.$/, "");
  if (host.includes("/") || host.includes("\\") || host.includes(" ")) return "";
  const bracket = host.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracket) return normalizeHost(bracket[1]);
  const colon = host.lastIndexOf(":");
  if (colon > -1 && host.indexOf(":") === colon) host = host.slice(0, colon);
  return normalizeHost(host);
}

// Decode each segment once. A second pass would reject a literal "%" or a name containing "..".
export function canonicalizePath(pathname) {
  if (pathname.includes("\\") || pathname.includes("\0")) return { ok: false };

  const trailing = pathname.length > 1 && pathname.endsWith("/");
  const encoded = [];
  const segments = [];
  for (const segment of pathname.split("/")) {
    if (segment === "") continue;
    let value;
    try {
      value = decodeURIComponent(segment);
    } catch {
      return { ok: false };
    }
    if (value === ".") continue;
    if (value === ".." || value.includes("/") || value.includes("\\") || value.includes("\0")) {
      return { ok: false };
    }
    encoded.push(segment);
    segments.push(value);
  }

  let path = "/";
  if (encoded.length > 0) {
    path = `/${encoded.join("/")}`;
    if (trailing) path += "/";
  }
  return { ok: true, pathname: path, segments };
}

function languagePrefix(segments) {
  return segments.length > 0 && LANGUAGE_PREFIXES.has(segments[0].toLowerCase());
}

function indexCanonical(pathname) {
  const bare = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const match = bare.match(/^(.*)\/index(?:\.html)?$/i);
  if (!match) return null;
  if (match[1] === "") return "/";
  return `${match[1]}/`;
}

function languageFile(lang, publicPath) {
  if (!publicPath.startsWith("/")) return null;
  if (publicPath === "/") return `/${lang}/`;
  return `/${lang}${publicPath}`;
}

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  const preview = { enabled: isPreviewHost(url.hostname), prefix: "" };
  const lang = resolveLanguage(url, request);
  if (!lang) return textResponse(404, "Not found\n", {}, request.method, preview);

  if (request.method !== "GET" && request.method !== "HEAD") {
    return textResponse(405, "Method not allowed\n", { allow: "GET, HEAD" }, request.method, preview);
  }

  const canonical = canonicalizePath(url.pathname);
  if (!canonical.ok) return notFound(request, env, lang, preview);

  let pathname = canonical.pathname;
  let segments = canonical.segments;
  if (preview.enabled) {
    const stripped = stripPreviewPrefix(canonical);
    if (stripped) {
      preview.prefix = stripped.prefix;
      pathname = stripped.pathname;
      segments = stripped.segments;
    }
  }
  if (languagePrefix(segments)) return notFound(request, env, lang, preview);
  if (preview.enabled && pathname === "/robots.txt") {
    return textResponse(200, PREVIEW_ROBOTS, { "cache-control": "no-store" }, request.method, preview);
  }

  return serve(request, env, lang, pathname, preview);
}

function found(status) {
  return status === 200 || status === 304;
}

async function serve(request, env, lang, pathname, preview) {
  const canonicalIndex = indexCanonical(pathname);
  if (canonicalIndex && canonicalIndex !== pathname) {
    const indexFile = languageFile(lang, pathname.endsWith("/index") ? `${pathname}.html` : pathname);
    const existing = indexFile ? await fetchAsset(env, request, indexFile, { probe: true, preview }) : null;
    if (found(existing?.status)) {
      await cancel(existing);
      return redirect(request, canonicalIndex, undefined, preview);
    }
    await cancel(existing);
    return notFound(request, env, lang, preview);
  }

  if (pathname.endsWith("/")) {
    const indexFile = languageFile(lang, `${pathname}index.html`);
    const indexed = await fetchAsset(env, request, indexFile, { preview });
    if (indexed.status === 404) {
      await cancel(indexed);
      return notFound(request, env, lang, preview);
    }
    return finish(indexed, request.method, indexed.status, {}, preview);
  }

  const exactFile = languageFile(lang, pathname);
  const exact = await fetchAsset(env, request, exactFile, { preview });
  if (exact.status === 200) {
    if (pathname === "/404.html") {
      return finish(exact, request.method, 404, { "cache-control": "no-store" }, preview);
    }
    return finish(exact, request.method, 200, {}, preview);
  }
  if (exact.status === 304) return finish(exact, request.method, 304, {}, preview);
  if (exact.status !== 404) return finish(exact, request.method, exact.status, {}, preview);
  await cancel(exact);

  const nestedIndex = languageFile(lang, `${pathname}/index.html`);
  const nested = await fetchAsset(env, request, nestedIndex, { probe: true, preview });
  if (found(nested.status)) {
    await cancel(nested);
    return redirect(request, `${pathname}/`, undefined, preview);
  }
  if (nested.status !== 404) return finish(nested, request.method, nested.status, {}, preview);
  await cancel(nested);
  return notFound(request, env, lang, preview);
}

async function fetchAsset(env, request, assetPath, { probe = false, preview = { enabled: false, prefix: "" } } = {}) {
  if (!env?.ASSETS?.fetch) throw new Error("ASSETS binding is not configured");
  if (!assetPath) return new Response(null, { status: 404 });
  const url = new URL(request.url);
  url.pathname = assetPath;
  const headers = new Headers(request.headers);
  // A 304 from a conditional probe looks like a missing file.
  if (probe) {
    for (const name of CONDITIONAL_HEADERS) headers.delete(name);
  }
  const assetRequest = new Request(url, {
    method: probe ? "GET" : request.method,
    headers,
  });
  const response = await env.ASSETS.fetch(assetRequest);
  if (response.status === 304) return response;
  if (response.status >= 300 && response.status < 400) {
    const rewritten = publicRedirect(response, request, assetPath, preview);
    await cancel(response);
    return rewritten ?? textResponse(404, "Not found\n", {}, request.method, preview);
  }
  return response;
}

function publicRedirect(response, request, assetPath, preview) {
  const location = response.headers.get("location");
  if (!location) return null;
  const lang = assetPath.split("/").find((segment) => segment !== "");
  let dest;
  try {
    dest = new URL(location, request.url);
  } catch {
    return null;
  }
  const requestUrl = new URL(request.url);
  if (dest.host !== requestUrl.host) return null;
  const stripped = stripLanguage(dest.pathname, lang);
  if (!stripped) return null;
  if (`${stripped.pathname}${dest.search}` === `${requestUrl.pathname}${requestUrl.search}`) return null;
  return redirect(request, stripped.pathname, dest.search || requestUrl.search, preview);
}

function stripLanguage(pathname, lang) {
  const prefix = `/${lang}`;
  if (pathname === prefix) return { pathname: "/" };
  if (pathname.startsWith(`${prefix}/`)) {
    const rest = pathname.slice(prefix.length);
    return { pathname: rest.startsWith("/") ? rest : `/${rest}` };
  }
  return null;
}

function redirect(request, pathname, search, preview = { enabled: false, prefix: "" }) {
  const current = new URL(request.url);
  if (preview.prefix) {
    pathname = pathname === "/" ? `/${preview.prefix}/` : `/${preview.prefix}${pathname}`;
  }
  const target = new URL(current.origin);
  target.pathname = pathname;
  target.search = search === undefined ? current.search : search;
  const location = `${target.pathname}${target.search}`;
  if (location === `${current.pathname}${current.search}`) {
    return textResponse(404, "Not found\n", {}, request.method, preview);
  }
  if (!preview.prefix && exposesLanguagePrefix(target.pathname)) {
    return textResponse(404, "Not found\n", {}, request.method, preview);
  }
  const headers = new Headers({ location });
  applySecurity(headers);
  markPreview(headers, preview);
  return new Response(null, { status: 308, headers });
}

function exposesLanguagePrefix(pathname) {
  return pathname === "/en" || pathname === "/fa" || pathname.startsWith("/en/") || pathname.startsWith("/fa/");
}

async function notFound(request, env, lang, preview) {
  const file = languageFile(lang, "/404.html");
  const response = await fetchAsset(env, request, file, { probe: true, preview });
  if (response.status !== 200) {
    await cancel(response);
    return textResponse(404, "Not found\n", { "cache-control": "no-store" }, request.method, preview);
  }
  return finish(response, request.method, 404, { "cache-control": "no-store" }, preview);
}

async function finish(response, method, status, overrides = {}, preview = { enabled: false }) {
  const headers = new Headers(response.headers);
  applySecurity(headers);
  markPreview(headers, preview);
  if (status === 200 && !headers.has("cache-control")) headers.set("cache-control", HTML_CACHE);
  for (const [key, value] of Object.entries(overrides)) headers.set(key, value);
  if (method === "HEAD" || status === 304) {
    await cancel(response);
    return new Response(null, { status, headers });
  }
  return new Response(response.body, { status, headers });
}

function textResponse(status, body, extra = {}, method = "GET", preview = { enabled: false }) {
  const headers = new Headers({ "content-type": "text/plain; charset=utf-8", ...extra });
  applySecurity(headers);
  markPreview(headers, preview);
  return new Response(method === "HEAD" ? null : body, { status, headers });
}

function markPreview(headers, preview) {
  if (preview?.enabled) headers.set("x-robots-tag", "noindex, nofollow");
}

function applySecurity(headers) {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(key)) headers.set(key, value);
  }
}

async function cancel(response) {
  if (!response?.body) return;
  try {
    await response.body.cancel();
  } catch {
    // Already consumed.
  }
}
