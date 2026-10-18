# TODO

- [ ] Remove the PaperMod language overrides

`layouts/_partials/post_meta.html` and `layouts/archives.fa.html` format Persian dates. `layouts/archives.html` groups English archive months by `.PublishDate`, because PaperMod groups those months by `.Date`. `layouts/_partials/footer.html` localizes the Persian footer. Leave these in place when you remove the language-method copies below.

PaperMod `v0.0.0-20260802175912-d3768854d00a` calls deprecated Hugo language methods. Commit `9f3738ce5d662b3cd73e7147f7cebac56592ca0a` copied five templates into this site and switched those calls to the supported methods. Remove the copies after the module in `go.mod` contains the same change.

Checked on 2026-10-16:

- [Issue #1856](https://github.com/adityatelange/hugo-PaperMod/issues/1856) is open.
- [Pull request #1857](https://github.com/adityatelange/hugo-PaperMod/pull/1857) was closed on 2026-05-03 and did not merge.
- Upstream `master` is still `d3768854d00ad003b0a8dbdba254ce9224377a01`, the commit this site pins. `layouts/baseof.html` on that commit still calls `.Language.LanguageDirection`.

A closed issue or pull request is not enough. The installed PaperMod module has to contain the new methods, and the checks below have to pass. This file does not watch upstream. Read it before you upgrade PaperMod.

A file under this site's `layouts/` replaces the theme file at the same path. These copies hide later PaperMod edits to those templates, including the deprecation fix and any other change to the same files, until you remove or merge them.

| File | Deprecated method | Replacement |
| --- | --- | --- |
| `layouts/baseof.html` | `.Language.LanguageDirection` | `.Language.Direction` |
| `layouts/rss.xml` | `site.Language.LanguageCode` | `site.Language.Locale` |
| `layouts/_partials/templates/opengraph.html` | `site.Language.LanguageCode` | `site.Language.Locale` |
| `layouts/_partials/header.html` | `.Language.LanguageName` | `.Language.Label` |
| `layouts/_partials/translation_list.html` | `.Language.LanguageName` | `.Language.Label` |

## Remove the copies

1. Confirm the fix is in [adityatelange/hugo-PaperMod](https://github.com/adityatelange/hugo-PaperMod) and that it replaces all three methods: `LanguageDirection`, `LanguageCode`, and `LanguageName`. A merged successor pull request or a direct commit on that repository counts. A closed issue, a closed pull request that did not merge, or a change that lives only on a fork does not.
2. Update the PaperMod module in `go.mod` to a revision that contains that fix and still builds with this site's Hugo version.
3. Compare each file in the table with the same path in the new module. Keep site-specific edits. Delete a copied template when the module template is the one this site should use.
4. Run `npm run build`, `npm test`, and `npm run check`.
5. Confirm Hugo prints none of the three deprecation warnings. Do not hide them with a quiet flag or a log filter. Compare the generated files with the previous build. Check Persian pages for right-to-left layout (`dir` is `rtl`), the language switcher, the RSS `<language>` element, and the OpenGraph `og:locale` tag.
6. Confirm the Cloudflare production deployment serves <https://abdolirad.me/> and <https://abdolirad.ir/>.
7. Change the checkbox above to done only after that cleanup and those checks succeed.
