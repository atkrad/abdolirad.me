# abdolirad.me

Source code for The Other Branch, my bilingual personal blog built with Hugo and PaperMod and hosted on Cloudflare Workers.

## Development

The Nix shell provides Hugo, Go, and Node.js. With direnv, run `direnv allow` once.

```sh
nix develop
npm ci
npm run build
npm test
npm run dev
```

`npm test` reads `public/`, so build first. `npm run dev` serves that build.

## Deployment

`npm run build` writes the site. `npm run check` is a dry run. `npm run deploy` publishes the build.

Cloudflare builds the site and deploys the Worker. A branch preview gets its own URL.

## URLs

- English: <https://abdolirad.me/>
- Persian: <https://abdolirad.ir/>
- Local English: <http://localhost:8787/>
- Local Persian: <http://fa.localhost:8787/>
- Preview: the `*.workers.dev` URL Cloudflare generates for a branch
