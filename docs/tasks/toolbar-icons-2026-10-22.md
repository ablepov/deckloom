# Viewer toolbar icons and export loading

22 October 2026. User requested replacing the toolbar's layers/grid/download artwork with downloaded SVG icons, without installing the full icon library, and visibly animating the download trigger while an export is running. This is a local correction to the existing viewer/download workflow; no new editor, navigation or export format is introduced.

Status: implemented and browser-verified. User explicitly authorized publishing0.2.1 and updating the installed Monq package on its ordinary3000 server. Release gates and rollout are in progress; until rollout finishes, Monq remains on0.2.0.

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

Release evidence: `output/validation/release-0.2.1/`. Runtime code is unchanged from the101/101 and browser-verified UI patch; package metadata/release notes identify0.2.1. Registry and installed consumer results are recorded after rollout.

Release gates on0.2.1: syntax63, independent PDF/PPTX acceptance, full baseline123 and external installed archive passed. Pack dry run includes87 entries and both Lucide attribution/license files. Backend/runtime dependencies are unchanged. Viewer SHA-256: `c724d568c89d6409cf8870322ae8a6f536d635539c537fd69045ea6b664964a8`.
