# Viewer toolbar icons and export loading

22 October 2026. User requested replacing the toolbar's layers/grid/download artwork with downloaded SVG icons, without installing the full icon library, and visibly animating the download trigger while an export is running. This is a local correction to the existing viewer/download workflow; no new editor, navigation or export format is introduced.

Status: published as0.2.1 and installed in Monq Slides from the public npm registry after explicit user authorization. Its ordinary3000 server was restarted and the installed UI verified in a real browser. Release and rollout are complete.

## Implementation

- Five individual Lucide SVG geometries: layers, layout-grid, download, loader-circle, chevron-down. Downloaded from pinned upstream commit `20aef31db93fe4d9f398dbb15b120d99c48eef95`; paths/rectangles are inlined in viewer/index.html. No icon runtime dependency, CDN request or full library was added. The original complete license and source URLs/SHA-256 are retained in viewer/icons/. Independent comparison confirmed all five geometries match the downloaded upstream SVGs.
- Busy download trigger: spinning loader, label "Готовим…", aria-busy/accessibility label, visible busy styling and disabled duplicate action. Fixed label width keeps the toolbar stable. Navigation remains available. Mobile retains the spinner while hiding the label; reduced-motion disables rotation. Success/failure restore the normal download icon, label and enabled state.
- Browser verification exposed an existing stacking defect: a ready/error notice covered the reopened menu. Raised the toolbar stacking level above the notice so menu items remain clickable; the notice's text and actions remain available when the menu closes.

## Checks and evidence

Evidence: `output/validation/toolbar-icons-2026-10-22/`.

- Syntax63 passed. Existing download tests2/2 passed; external installed package check passed. Real npm archive contains the two icon provenance/license files (87 total entries), with no new runtime dependency.
- Real browser using current source and unchanged Monq Retail data: idle header, overview/focus switching, real PDF export loading, stable button width, mobile375px/no horizontal overflow and reduced-motion checks passed. The PDF completed and browser download/ready link were observed; normal button state returned.
- Controlled POST500 browser response verified error/retry and normal button recovery. Reopening the menu with the notice visible passed hit testing and actual menu item clicks after the stacking fix.
- Screenshots: header.png, idle.png, loading-desktop.png, loading-mobile.png, success.png, error-menu.png. Source downloads, package and browser logs remain in the ignored evidence directory.

Full `npm test`:101/101 passed after the final stacking fix, no skips. The previous 0.2.0 release and font/editability acceptance boundaries remain unchanged. Subsequent release permission covers the0.2.1 commit/push/publish, exact Monq dependency update and restart of its normal server; no branch switch or unrelated consumer changes are needed.

## Release0.2.1

Release evidence: `output/validation/release-0.2.1/`. Runtime code is unchanged from the101/101 and browser-verified UI patch; package metadata/release notes identify0.2.1. Registry and installed consumer results follow below; the intermediate authentication/processing notes are historical.

Release gates on0.2.1: syntax63, independent PDF/PPTX acceptance, full baseline123 and external installed archive passed. Pack dry run includes87 entries and both Lucide attribution/license files. Backend/runtime dependencies are unchanged. Viewer SHA-256: `c724d568c89d6409cf8870322ae8a6f536d635539c537fd69045ea6b664964a8`.

Release source commit `a107527a1a9614a454b6c173b2aa3ec4219b812a` pushed on master. [CI](https://github.com/ablepov/deckloom/actions/runs/39758141900): Linux passed, Windows still running at this checkpoint. Clean-commit candidate: `output/validation/release-0.2.1/candidate/deckloom-0.2.1.tgz`, integrity `sha512-J5nkju2UquG4BZZQyeADHsHj9GZbGpTjmQEE5Qqq+9wvDut2G/JzKCcs82+h90vVVfMD5Srafomn+77io88YkQ==`. npm CLI is authenticated as package owner and has requested browser confirmation for publication; awaiting that external authentication step. No one-time authentication URL or credentials are stored here. Monq remains0.2.0 on3000 until registry0.2.1 and its tarball are verified. Pre-update consumer manifests are saved in `monq-before/` under the release evidence directory.

Next checkpoint: both Linux and Windows CI passed. The first publication confirmation expired; a fresh challenge was issued and the user confirmed it. npm returned success (`+ deckloom@0.2.1`, exit0). Waiting for npm processing to expose public version metadata and tarball; no duplicate publication is attempted. The normal Monq server remains on0.2.0 until that availability/integrity check succeeds.

During publication, registry processing was delayed. The official npm status API reported degraded performance for package publishing/installation and the website, incident "Degraded Publish, Install, and View Package" in monitoring. This may explain the delay; it does not prove the individual package's processing state. Public version0.2.1 and its tarball still returned404 at this checkpoint. Snapshot: `output/validation/release-0.2.1/npm-status.json`. Owner confirmation succeeded; another authentication challenge is not required at this stage.

## Rollout completed

- Both Linux and Windows CI passed on source commit `a107527`. The owner confirmed the fresh npm challenge; CLI publication returned exit0. After npm processing, public metadata and the actual826178-byte tarball became available. Both integrity checks matched the candidate above. `npm run check:package:published` passed against the real registry0.2.1 package.
- [GitHub release v0.2.1](https://github.com/ablepov/deckloom/releases/tag/v0.2.1) targets the tested source commit. No branch switch, private asset publication or dependency workaround was used.
- Monq package.json/lockfile/installed package all report0.2.1 from `https://registry.npmjs.org/deckloom/-/deckloom-0.2.1.tgz`. Installed viewer hash matches the release hash above. Manifest comparison preserved every unrelated field; lockfile changes are limited to the root Deckloom pin and `node_modules/deckloom`. Product-scenes remains0.4.1.
- Restarted the normal `npm run dev` Monq server on3000. Syntax112 and viewer19 checks passed. No4070/54000 server remains. Consumer changes are saved without committing its unrelated existing work.
- The first manual navigation reused a previously loaded document because the slide URL fragment did not force an HTTP reload. It still had the0.2.0 markup/token. A full page reload loaded the verified0.2.1 markup; subsequent checks below passed. Refresh an already-open viewer after a package upgrade.
- Actual installed UI: layers SVG, four grid rectangles, download/loader SVG and progress label are present. Real PDF export showed spinner/"Готовим…", aria-busy/disabled and stable130px width;375px mobile had no horizontal overflow and retained the spinner; reduced-motion removed rotation. Success restored "Скачать" and hid the loader; a controlled POST500 verified the same recovery with retry and clickable menu above the notice.
- Browser downloaded the whole16-page Retail PDF. Independently checked pages16, bytes19146706, SHA-256 `c101d7b69682cc2152b4e895c24cb2c39674b84db94e4c6ee918ff6c4428307e`. Receipt: `browser-pdf.json`; screenshots/logs: `idle.png`, `loading-desktop.png`, `loading-mobile.png`, `success.png`, `error.png`, `toolbar-3000.png`, `browser-loading.log`, `browser-completion.log`. Normal viewer left on Retail10.

No new Google import/Office UI/font shaping acceptance is claimed. Persistent export job recovery and other Monq native PPTX profiles remain outside this patch. Export engine, authored slide sources and fonts were not modified for0.2.1.
