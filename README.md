# Deckloom

A local HTML presentation viewer, renderer and layout diagnostics engine. Keep slide HTML, design systems and assets in your own project; share the presentation infrastructure through a versioned package.

Deckloom is MIT licensed. It includes no product slides, corporate assets or private dependencies. HTML/CSS authoring stays in your project; the engine supplies viewing, PNG rendering and layout diagnostics.

## Installation

```sh
npm install deckloom@0.1.0 --save-exact
npx playwright install chromium
```

Playwright is a peer dependency. Declare it in your application as well if you use its API directly. Node.js 22 or later is required. Installation from the public npm registry does not require an access token.

## Local development

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
  // await createRenderer(project).run(['--deck=all']);
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

PNG/HTML rendering is implemented. PDF, editable PPTX, a cross-project hub and a block editor are later modules; this package does not advertise those capabilities yet.

## Releasing

Run `npm run check`, `npm test` and `npm pack --dry-run` before release. Update the version and lockfile together. The package allowlist includes runtime code, neutral examples, validation scripts, tests and the license; generated output and dependencies are excluded.

The first release uses an npm maintainer's authenticated CLI session. The `publish.yml` GitHub Actions workflow supports subsequent releases through npm Trusted Publishing (OIDC), after configuring `ablepov/deckloom` and that workflow filename as a trusted publisher in npm package settings. No npm token is stored in this repository. Publishing permissions belong to maintainers; consumers do not need them.
