# Deckloom

A local HTML presentation viewer, renderer and layout diagnostics engine. Keep slide HTML, design systems and assets in your own project; share the presentation infrastructure through a versioned package.

Deckloom is MIT licensed. It includes no product slides, corporate assets or private dependencies. HTML/CSS authoring stays in your project; the engine supplies viewing, PNG rendering and layout diagnostics.

## Installation

```sh
npm install deckloom@0.2.0 --save-exact
npx playwright install chromium
```

Playwright is a peer dependency. Declare it in your application as well if you use its API directly. Node.js 22 or later is required. Installation from the public npm registry does not require an access token.

## Local development

For ongoing roadmap work, start with [the project state and continuation guide](docs/current-state.md), then follow its links to decisions and acceptance records.

For development and the bundled demo, clone the source repository. Requires Node.js 22+ and Playwright 1.57+ with Chromium installed.

```sh
git clone https://github.com/ablepov/deckloom.git
cd deckloom
npm ci
npx playwright install chromium
npm run check
npm test
npm run render:example
npm run dev
```

The example contains landscape and portrait decks using system fonts. Render output is written to `output/example`. No registry token or neighboring source checkout is required.

## Consumer integration

Install the package from npm and create your project's own `deckloom.config.cjs`. The package contains the viewer itself; consumers do not copy or build viewer sources. The neutral `examples/deckloom.config.cjs` in this repository shows a complete configuration. Pin the package version and commit your application's lockfile for reproducible rendering.

```js
const { createRenderer, startReviewServer } = require('deckloom/node');
const project = require('./deckloom.config.cjs');
async function main() {
  await startReviewServer(project);
  // In a separate render command, use:
  // const result = await createRenderer(project).render({ deckId: 'all' });
}
main().catch(console.error);
```

CLI: `deckloom dev --config=deckloom.config.cjs` or `deckloom render --config=deckloom.config.cjs --deck=all --output=output/render`.

A project exports `root`, `decks`, and `renderDocument(deck, slide, {baseUrl})`. Use an absolute `root` computed from your config's `__dirname`; relative roots resolve from the process working directory. Decks have unique `id` and `artifactPrefix`, `label`, optional `width`/`height`, and authored `slides` with safe `no` identifiers. The default canvas is 1920 × 1080; each deck can override it. Rendered artifacts retain `<prefix>-<no>/<prefix>-<no>-render.html` and `generated-html.png`. The viewer serves generated HTML with selectable text and isolated CSS.

For isolated output, `baseUrl` points at the corresponding original artifact directory so relative assets continue to resolve. Include it in a `<base>` tag when nonempty, or resolve asset URLs yourself.

Optional project hooks: `validateDocument(html, deck, slide)`, `renderSpec(deck, slide)`, `renderQa(context)`, `reportName(deck)`, `measureLayout` and `issueCount`. `renderDeck(browser, deck, {outputRoot})` is available for consumers that manage their own Playwright browser. Runtime page errors and missing images fail CLI rendering through the report.

`viewer` config supports `title`, `favicon`, `storagePrefix`, and optional `legacyDeckId` for migrating older saved state. `staticMounts` maps explicit URL prefixes or exact files to filesystem resources. The server serves these mounts and registered artifact directories; it does not expose the entire project checkout. It listens on localhost by default.

```js
const { createLayoutMeasure, issueCount } = require('deckloom/qa');
const measureLayout = createLayoutMeasure({
  expectedFrames: 1,
  requireFlow: true,
  ignoreTextWithin: '[data-artwork][role="img"]',
});
// measureLayout is self-contained and can be passed directly to page.evaluate.
```

The default diagnostic reports overflow, text collisions, clipped/outside text and marked region capacity. Flow-only positioning and a single layout frame are optional policies. Ignoring decorative text never disables checks of its outer capacity box.

Version 0.2.0 adds portable HTML/PNG/PDF export, bounded editable PPTX profiles, viewer downloads and presentation/catalog/editing/storage APIs. See the [release notes](docs/releases/0.2.0.md) for scope and limitations. A cross-project hub and visual block editor remain later modules.

The platform direction, ownership boundaries, phased milestones and validation gates are documented in the [development roadmap](docs/roadmap.md), with the original findings in the [architecture review](docs/reviews/platform-review-2026-10-19.md). These documents distinguish implemented capabilities from planned modules.

## Baseline and compatibility

The [0.1 baseline](docs/baseline-0.1.md) separates supported behavior from known limitations. The [compatibility policy](docs/compatibility.md) defines versioning, regressions, migrations and rollback; breaking changes are allowed through an explicit migration.

The [Project/Deck/Slide contract](docs/contracts/project-deck-slide-v1.md) and [transition from 0.1](docs/migrations/project-contract-v1.md) document the versioned configuration available in 0.2.0.

[B2](docs/tasks/b2-normalization-2026-10-20.md) adds internal normalization and shared preflight. Legacy slide `no` values must be digit strings; errors include a code and field path. Report names are resolved before rendering and must be pure synchronous basenames.

[B3 read projections](docs/contracts/read-api-v1.md) connect the registry to scanners, server and viewer. Registered decks use authored membership/order, including placeholders, and ignore leftover directories. Discovery is a separate read-only mode. Unversioned input keeps the legacy response shape and file keys; explicit `contractVersion: 1` selects the versioned payload.

[B4 runtime](docs/contracts/render-v1.md) opens v1 rendering through the existing exports. Per-axis dimensions are shared by PNG viewport, API and viewer. HTML/PNG availability is independent; unreadable files and failed previews stay visible. The current PNG profile allows sides up to 16384 px and 64 × 1024 × 1024 pixels.

Stage C adds a [static HTML profile](docs/contracts/static-html-v1.md), [object render API and bounded hooks](docs/contracts/programmatic-render-v1.md), and [versioned build publication](docs/contracts/build-publication-v1.md) in 0.2.0. V1 previews preserve the full document in a separate frame. `renderer.render({deckId, signal, onProgress})` returns a structured status without changing argv, console output or exitCode. Generated artifacts are published as one immutable deck generation; scanner URLs pin its build ID. Legacy canonical files remain compatibility mirrors. Read the [C migration guide](docs/migrations/runtime-c.md) before updating a consumer; dynamic HTML needs static preparation for v1, and library run() no longer controls CLI output/exit status.

Render the full neutral v1 example with `node bin/deckloom.cjs render --config=examples/render-v1.config.cjs --deck=all`, then view it with `node bin/deckloom.cjs dev --config=examples/render-v1.config.cjs`. It covers landscape, portrait and individual axis overrides.

Stage D adds [export v1](docs/contracts/export-v1.md) and an [export migration guide](docs/migrations/export-d.md). `renderer.export({deckId, outputRoot, formats: ['png','pdf','html']})` uses one prepared deck, preserves its order, supports exact PNG scale/alpha and mixed PDF page sizes, and packages local resources into offline HTML. Use a destination physically separate from the source and resource mounts. Strict mode requires file-backed web fonts; permitted platform substitution must be selected explicitly and is recorded. This export API is included in 0.2.0.

```sh
node bin/deckloom.cjs export --config=examples/export.config.cjs --deck=demo --output=output/portable --format=png,pdf,html --scale=2
```

Read requested files from `result.outputs`; copy the complete `result.bundle.directory` for portable HTML. Check `result.status` and diagnostics before delivery. The neutral export example includes a licensed DejaVu font and its notice. No consumer migration is required just to retain the existing render API.

E3 connects the [selected backend](docs/decisions/pptx-backend-e2.md) to the common export pipeline. The [PPTX contract](docs/contracts/pptx-e3.md) and [migration guide](docs/migrations/pptx-e3.md) define marked HTML, native text/solid rectangles, PNG/SVG resources, a uniform 960×540 canvas and explicit Windows installed-Arial reference fonts. Unsupported HTML is rejected; embedding and hybrid are deferred. Real PowerPoint 16 COM rendering and native edit/save/reopen pass. A fresh computer-use session confirmed visible opening without repair and reviewed all three slides. The user checked the file in Google Slides and explicitly accepted E3 as complete on 21 October 2026. Interactive PowerPoint UI editing and saving remain unobserved because the installed Office is unactivated; the user accepted E3 with this limitation. [Acceptance record](docs/tasks/e3-export-2026-10-21.md).

```sh
node bin/deckloom.cjs export --config=examples/pptx.config.cjs --deck=main --output=output/pptx-example --format=pptx,pdf,png,html --allow-font-substitution --pptx-profile=windows-installed-v1
```

The development checkout also implements the first E4 increment: [restricted Grid cards and a conversion report](docs/contracts/pptx-e4-grid.md). Use `examples/pptx-grid.config.cjs` with the same export command to produce the three E3 slides plus two Grid examples. Card backgrounds and text stay native; the report maps source IDs to verified PPTX shapes and links the intact prepared HTML. Tests and PowerPoint COM checks pass. The user confirmed appearance and text/fill editing on slides 4–5 in Google Slides and explicitly accepted this first E4 increment on 21 October 2026. Visible E4 PowerPoint no-repair opening and interactive Office UI editing remain unobserved. [E4 validation record](docs/tasks/e4-scope-2026-10-21.md).

The development checkout adds a separate [F1 presentation document](docs/contracts/presentation-document-v1.md), independent of executable Project configs. `presentation` is available from both `deckloom` and `deckloom/node`. It validates plain JSON data, preserves slide IDs/order and template/local/authored content, and provides in-memory round trips plus immutable slide rename/duplicate helpers. Existing configs and exports require no migration. F2–F4/G1 now add pinned library resolution, composition rendering, programmatic editing and local storage; UI remains deferred. See the [F1 example](examples/presentation-document.cjs) and [migration notes](docs/migrations/presentation-f1.md).

```js
const { presentation } = require('deckloom');
const document = require('./examples/presentation-document.cjs'); // local example data
const restored = presentation.deserialize(presentation.serialize(document));
const renamed = presentation.renameSlide(restored, 'cover', 'New title');
const copied = presentation.duplicateSlide(renamed, 'cards', 'cards-copy');
```

F2–F4/G1 provide [immutable template catalogs](docs/contracts/templates-v1.md), [typed composition/editing APIs](docs/contracts/compositions-editing-v1.md) and [local storage](docs/contracts/storage-v1.md). Save requires an explicit previous token (`null` for create); conflicts, missing references and corrupt files preserve the last good copy. `npm run check:engine` exercises create, two independent instances, authored table/connector/crop/opacity, save/autosave/recovery/reopen and the common export pipeline. See `examples/engine-library.cjs`, `examples/engine-authoring.cjs` and `scripts/check-engine.cjs` for usage.

The [extended E4 profile](docs/contracts/pptx-e4-matrix.md) adds restricted Flex, native tables/connectors, center-cover crop, native leaf transparency, light/dark and a separate portrait deck. Complex gradients/shadows require an explicit decorative raster declaration; text stays native. `node scripts/check-e4.cjs --office` checks the neutral matrix in actual PowerPoint COM. Technical checks pass; the user verified the new PPTX files in Google Slides and explicitly accepted E4 on 21 October 2026. Interactive Office no-repair/edit/save/reopen remains unobserved. Visual templates and editor UI are now being scoped jointly.

Try `node bin/deckloom.cjs dev --config=examples/read-v1.config.cjs` after `npm run render:example` to view the same neutral artifacts through v1. The example also opens as a registered draft before any rendering. See the [migration guide](docs/migrations/project-contract-v1.md) for expected composition, URL and bookmark changes.

```sh
npm run check:baseline
npm run check:package
npm run check:package:published
npm run check:export
npm run check:pptx
```

The baseline renders the small landscape/portrait examples and a neutral 120-slide deck, then checks the viewer. Use `npm run check:baseline:ci` for a shorter run. Timings and Node RSS are measurements, not a performance guarantee. The package check installs a real tarball into a temporary consumer outside the checkout and exercises installed imports, CLI, API, local resources and viewer. It requires registry access and the Chromium build for the pinned development Playwright version. Generated evidence stays in `output/validation/stage-a`; no command publishes a package.

The independent export acceptance check requires Python 3.12 with `pypdf==6.9.2 PyMuPDF==1.27.2.2 Pillow==12.3.0`. It extracts full Unicode text, verifies font streams/page boxes and compares PDF rasters with PNG, using Poppler when available and PyMuPDF otherwise. Python is only a validation dependency; the export runtime is Node/Chromium. Export evidence stays in `output/validation/d`.

The browser test suite limits file concurrency to two; assertions and stage deadlines remain unchanged. E3 also records an observed boundary when `newPage` itself exceeds a short deadline: late page creation is eventually closed, and a borrowed browser may still expose that context briefly after the timed-out call returns. See the [E3 validation record](docs/tasks/e3-export-2026-10-21.md).

## Releasing

Run `npm run check`, `npm test`, `npm run check:export`, `npm run check:pptx`, `npm run check:baseline`, `npm run check:package` and `npm pack --dry-run` before release. Vendor changes additionally require `npm ci --prefix tools/pptx-backend --ignore-scripts`, its dependency audit and `npm run check:pptx-backend`. The pinned bundle includes inventory and full third-party notices; build tools/experiments and node_modules are excluded from the archive. Update the version and lockfile together. CI runs the reduced baseline, independent export acceptance, vendor reproducibility/audit and real external package installation; actual visible PowerPoint acceptance remains a separate check.

The first release uses an npm maintainer's authenticated CLI session. The `publish.yml` GitHub Actions workflow supports subsequent releases through npm Trusted Publishing (OIDC), after configuring `ablepov/deckloom` and that workflow filename as a trusted publisher in npm package settings. No npm token is stored in this repository. Publishing permissions belong to maintainers; consumers do not need them.
