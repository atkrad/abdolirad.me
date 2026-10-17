# abdolirad.me

English is at <https://abdolirad.me/> and Persian at <https://abdolirad.ir/>. One Hugo build writes both languages. One Worker serves them. Public URLs have no `/en` or `/fa` prefix.

## Develop

```sh
nix develop
npm ci
npm run build
npm test
npm run dev
```

The Nix shell provides Hugo, Go, and Node.js. `npm ci` installs Wrangler. The shell adds `node_modules/.bin` to `PATH` and does not install npm packages itself. With direnv, run `direnv allow` once. `.envrc` loads the same shell.

`npm run dev` uses `wrangler.dev.toml`, which has no custom domains. Wrangler would otherwise rewrite every local request to `abdolirad.me`.

| Host | Language |
| --- | --- |
| `http://en.localhost:8787`, `http://abdolirad.me:8787`, `http://localhost:8787` | English |
| `http://fa.localhost:8787`, `http://abdolirad.ir:8787` | Persian |

`localhost` is English. Any other hostname returns 404.

A `*.workers.dev` preview URL opens English. `/en/` and `/fa/` select the language, and `?lang=fa` still selects Persian. Links in those pages stay on the preview host. `X-Blog-Host: abdolirad.me` or `X-Blog-Host: abdolirad.ir` still works. Preview responses send `X-Robots-Tag: noindex, nofollow`, and `robots.txt` disallows crawling. Canonical and hreflang URLs stay on the production domains. Production hosts ignore the query, the language prefix, and that header.

## Deploy

`npm run build` runs Hugo once. `npm run deploy` publishes that output and does not run Hugo again. `npm run check` is a dry run.

`wrangler.toml` holds the Worker config. The Git connection, build commands, and hosted Hugo and Go versions are set once in Cloudflare, to match `hugo version` and `go version` from this shell. Node.js comes from `.node-version`. Workers Builds does not read `flake.nix`.

Requests run Worker code before a file is served, so they count toward the Workers plan. Past the limit, Cloudflare returns HTTP 429.
