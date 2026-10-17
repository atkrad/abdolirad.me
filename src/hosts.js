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

export function normalizeHost(hostname) {
  let host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "::1") host = "[::1]";
  return host;
}
