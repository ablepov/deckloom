# Release 0.2.0 and Monq Slides update

22 October 2026. User explicitly requested publishing Deckloom and updating the installed package in Monq Slides so downloads work in its normal server, without the separate 4070 preview. This authorizes the release commit/push/publish on the current branch and the consumer dependency update; unrelated consumer changes are preserved. No new branch is needed.

Status: released to npm, installed in Monq Slides and checked on its normal localhost:3000 server. Preview4070 stopped. Local release gates, full Linux/Windows CI, registry archive consumer and actual Retail downloads passed. User confirmed both npm login and the separate publish authorization.

The release includes the already implemented engine A–G1/E4 and download functionality. It does not implement reload recovery, durable export storage or Google Slides upload. Release notes: [0.2.0](../releases/0.2.0.md).

Evidence directory: `output/validation/release-0.2.0/`. Local personal instructions, browser logs, experiments, generated validation output and Monq assets are not included in the engine release commit/package.

## Local release gate

- `npm run check`: 63 modules/viewer passed.
- `npm test`: 101/101 passed, no skips.
- `npm ci --prefix tools/pptx-backend --ignore-scripts`, dependency audit and `npm run check:pptx-backend`: passed; reproducible bundle SHA-256 `92f311ac1c6ea6268cb79bbd7e08b5b992831ca8097a39f72e02f56739412bd0`.
- `npm run check:export`: three pages, Unicode text/embedded fonts/raster comparison passed.
- `npm run check:pptx`: three slides, independent XML/ZIP/image/PDF parsers passed; Office UI/COM not repeated in this release gate.
- `npm run check:baseline`: all 123 neutral slides and viewer scenarios passed.
- `npm run check:package`: real 0.2.0 archive installed in an external temporary consumer, imports/CLI/render/export/API passed.
- `npm pack --dry-run`: 85 entries, only intended public package roots. Source font licenses and backend notices retained; consumer fonts/assets excluded.

`git diff --cached --check` reports pre-existing trailing blank lines and one space in the verbatim third-party DejaVu license. These are formatting observations, not runtime failures; the license text was preserved.

## Cross-platform release gate

The first Actions attempt stopped before publication: Git normalized mixed line endings in the generated upstream notices, so Linux reproducibility correctly rejected them. Added explicit LF rules for repository text and binary treatment for the generated notices to preserve upstream license bytes. Runtime code and the backend bundle are unchanged. Subsequent Actions results are recorded below.

- Release implementation commit: `e772aea`; cross-platform attributes/notices fixes: `430b8eb`, `ba0df4c`. Current branch remains `master`; pushed normally, no force push.
- [Full CI on ba0df4c](https://github.com/ablepov/deckloom/actions/runs/39751540445): Linux and Windows both passed, including external archive installation.
- [Publish workflow](https://github.com/ablepov/deckloom/actions/runs/39751551581): all validation steps passed; only `npm publish` failed with E404 PUT registry.npmjs.org/deckloom. Trusted publisher authorization is not confirmed. Local `npm whoami` also returned E401. No package was published and no release tag was created.
- Prepared clean-commit archive: `output/validation/release-0.2.0/candidate/deckloom-0.2.0.tgz`, SHA-1 `c8e043f64f6d7ee47ed098e91febcc8f13788730`, integrity `sha512-06xt/qdkfcyVbBQkLdResxIzqGLVanmG2Z/0fSEUNUSNxhW3tAI9fN+Nr19SZeJiuWCbNwqXnln3ciSW76ULVQ==`. It exactly matches the archive metadata produced by Actions. Publish this candidate after authentication, then verify actual registry metadata/tarball before installing Monq.
- Monq syntax precheck: 112 files passed. Pre-update package.json/lockfile backups are in `output/validation/release-0.2.0/monq-before/`; unrelated existing consumer changes are preserved.
- The initial npm browser login required owner confirmation; the user subsequently confirmed login and the separate publication challenge. No one-time URL or credentials are stored in project records. No local archive/file dependency was substituted for a released registry version.

## Published package and consumer acceptance checks

- Published the exact clean-commit candidate through the authenticated npm CLI after owner confirmation. npm processing completed; public version metadata and the actual tarball were downloaded independently and matched the candidate integrity above. `latest` is 0.2.0. Registry receipt: `registry.json`, downloaded bytes: `registry-deckloom-0.2.0.tgz` in the evidence directory.
- `npm run check:package:published` passed against the real registry 0.2.0 archive. [GitHub release v0.2.0](https://github.com/ablepov/deckloom/releases/tag/v0.2.0) targets tested source commit `ba0df4c`. This was a manual authenticated publication; future OIDC permission has not been fixed or asserted.
- Monq `package.json` and lockfile now pin registry `deckloom:0.2.0` with the matching integrity. An initial install saw stale package metadata; `--prefer-online` fetched the new version successfully. All unrelated manifest fields were compared with the pre-update backup and remained identical. New lockfile entries are Deckloom's public runtime dependencies.
- Monq's old `renderer.run()` call no longer passed process argv to 0.2.0. The first render probe therefore selected the default base deck. Updated `render-slides.js` to call the public object render API explicitly, preserve `--deck`/`--output`, print the CLI summary and set failure exit status. Existing exported `renderDocument`/`renderDeck` are preserved. Retested `npm run render:retail`: exactly 16 Retail slides, no diagnostics/layout/assets/console failures; invalid deck returns exit 1. The initial default-base render only regenerated canonical artifacts; authored sources were not changed.
- Added `.deckloom/` to Monq's ignore list because immutable generated build/deck metadata is new runtime output, not authored slide content.
- Monq syntax112 and viewer19 checks passed. Ordinary `npm run dev` was restarted on port3000 from the installed package. The previous owned4070 process was stopped; only3000 listens. Opened Retail08 and inspected the download menu in a real browser. Screenshot: `monq-menu-3000.png`.
- Real API exports through port3000: PDF16 pages; PPTX16 slides,210 editable text blocks,25 fills,45 pictures; ZIP with original licensed Manrope4.504 faces. Independent parsers verified embedded/ZIP font hashes, valid PDF fonts and all native PPTX text in the PDF. All16 PDF overview pages were visually reviewed. Receipts, individual PDF images, overview and independent report are in `monq-downloads/`.
- A separate real browser click on "Скачать PDF" on port3000 completed: status "PDF готов · Monq · Ритейл", repeat attachment link and an actual `retail.pdf` browser download observed. Final screenshot: `monq-download-success-3000.png`.

| Format | Bytes | SHA-256 |
| --- | ---: | --- |
| PDF | 18273096 | e7e2ee08d070e759641b463f5797b27221a0624a5f7b979066eaad1cba4d673e |
| PPTX | 14988677 | 0fb7116c6326299a4941048ae1af00a4d0073c36d1576135c2f40a2d92e1248e |
| ZIP | 15051981 | 1fada37b48c66fb33f0b39e9c56b91ea35dfaf0794f1f881c8a73ae9ae781c56 |

Consumer changes are saved locally alongside its pre-existing work; no unrelated Monq changes were committed. No new Google import or Office UI acceptance is claimed. Reload/restart job recovery, other Monq native PPTX profiles and full cross-application shaping remain outside this release.
