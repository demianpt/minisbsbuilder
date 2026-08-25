# SBS Page Builder 2.2.2 — QA Summary

## Release scope

This release covers the requested Simple/Advanced parity, Shutterstock direct asset lookup, WordPress design-token handoff, and richer Brief Brain flow recommendations.

## Functional QA

### Upgrade contract — PASS (10/10)

`npm run test:upgrade`

- Full Shutterstock URLs with tracking parameters resolve the asset ID from the asset path.
- Bare Shutterstock IDs remain supported.
- Successful image lookup returns the watermarked preview and does not make a redundant video request.
- Brief Brain returns five unique flow recommendations.
- Five new rich journeys contain 10–11 modules each.
- The complete in-browser flow library totals 30 flows.
- Brief schemas accept five flow recommendations while concepts remain capped at three.
- Simple builder exposes the same Design Dial system and WordPress-ready exports.
- Page export includes `sbs-design-dials/1.0` resolved tokens.
- WordPress importer consumes the resolved dial-token contract.

See `upgrade-qa.json`.

### Real Chromium source QA — PASS (19/19)

The actual patched builder source was booted in system Chromium with API calls stubbed at the network boundary.

Verified:

- Simple builder renders all 9 Design Dial sliders.
- Quick styles and Design Dials are present in Simple Step 01.
- Moving Density from 48 to 88 updates canonical project state.
- The same edit changes resolved site spacing tokens (`10.31vmin` → `6.07vmin`).
- Five AI Brain flow recommendations render.
- Richer new flows are selectable.
- Simple review exposes navigation, footer, page, HTML, complete ZIP and optional concept exports.
- Page JSON exports all 9 dial inputs.
- Page JSON exports 46 resolved dial tokens.
- Simple and Advanced `page.json` are equivalent after normalising the generated timestamp.
- No page-level JavaScript errors occurred.

The harness records two non-application resource errors caused by the sandbox (an external font/DNS request and one synthetic-route 404). They do not originate from application JavaScript and did not affect any assertion.

See `browser-upgrade-qa.json`.

### WordPress handoff — PASS

`npm run test:handoff`

- Complete project ZIP contains exactly `navigation.json`, `footer.json`, `page.json`, `website.html`.
- WordPress importer unit suite: **23/23 assertions passed**.
- Full catalog sweep: **154 patterns / 2,052 blocks / 28 component types / 0 errors**.
- Page, navigation and footer serialize into editable Gutenberg/Digital Silk block comments.
- Resolved Design Dial values are mapped into the front end and Gutenberg editor canvas.
- Exact grid gap, reading measure and motion duration tokens are verified.
- Theme CSS contains no external `url()` values.

The catalog sweep still reports a small set of pre-existing forward-compatibility warnings for attributes that are present in builder artifacts but not registered by the active WordPress block-package fixture. They are deliberately preserved and the sweep has zero import errors. See `wordpress-catalog-sweep.json`.

### Syntax — PASS

- **66** JavaScript / MJS files passed `node --check`.
- **12** PHP files passed `php -l`.

See `syntax-qa.json`.

## Build-environment note

The uploaded project included macOS-installed `node_modules`. This Linux packaging environment cannot execute that copy of Vite/Rollup because its Linux native optional Rollup package is absent, and the environment cannot reach npm to reinstall dependencies. Therefore the clean release intentionally excludes both `node_modules` and stale `dist`.

On the target Mac, run `npm install` once (or double-click `START-MAC.command`) so npm installs the correct macOS native dependencies, then `npm run build` / `npm run dev` work against the clean source. This is a packaging-environment limitation, not an application test failure.

## Release versions

- SBS Page Builder: **2.2.2**
- SBS Website Importer: **1.0.1**
