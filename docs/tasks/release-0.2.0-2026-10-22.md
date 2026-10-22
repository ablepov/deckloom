# Release 0.2.0 and Monq Slides update

22 October 2026. User explicitly requested publishing Deckloom and updating the installed package in Monq Slides so downloads work in its normal server, without the separate 4070 preview. This authorizes the release commit/push/publish on the current branch and the consumer dependency update; unrelated consumer changes are preserved. No new branch is needed.

Status: local release checks passed; registry publication and consumer installation are next. Target: Deckloom 0.2.0, exact registry dependency in Monq Slides, normal localhost:3000 startup and real Retail PDF/PPTX/font ZIP downloads.

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
