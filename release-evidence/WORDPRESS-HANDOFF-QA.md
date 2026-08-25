# SBS WordPress handoff QA

## Release scope

This release adds two production handoff capabilities to the existing Mini SBS builder:

1. The **Complete project bundle** download is a ZIP containing exactly:
   - `navigation.json`
   - `footer.json`
   - `page.json`
   - `website.html`
2. The included **SBS Website Importer** WordPress plugin imports those artifacts into native Gutenberg/Digital Silk structures.

## Automated checks completed

### Project-bundle ZIP

- ZIP creation completed successfully.
- Archive integrity passed.
- Exact required entry names passed.
- All three JSON artifacts parsed successfully.
- `website.html` contained a valid HTML document.
- Generated test archive size: 342,942 bytes.

### WordPress importer conversion

- 19 of 19 focused importer assertions passed.
- Sample page converted to 120 native block nodes.
- Sample navigation converted to 13 native block nodes.
- Sample footer converted to 28 native block nodes.
- Camel-case Digital Silk block attributes were preserved.
- Nested block trees were preserved.
- A numeric WordPress navigation-menu ID was injected into imported navigation blocks.
- Footer shorthand expanded into editable Digital Silk blocks.
- Theme CSS was generated for both front-end and Gutenberg editor content.
- External `url()` values were rejected from generated theme CSS.
- No screenshot-module markup entered imported page content.

### Complete SBS pattern catalog

- 154 of 154 pattern trees serialized without a fatal error.
- 2,052 nested blocks were processed.
- 28 component types occurred across the pattern catalog.
- No pattern IDs were missing.
- The catalog sweep retained 11 known legacy/forward-compatible attribute warning groups rather than deleting source data. Normalized builder exports are stricter and the focused sample page produced no unknown-attribute failure.

### Syntax and package checks

- 80 JavaScript/MJS files passed `node --check`.
- 9 PHP files passed `php -l`.
- The WordPress plugin ZIP passed `unzip -t`.
- The plugin ZIP has the required top-level `sbs-website-importer/` folder.
- The release contains no `.env`, `node_modules`, `dist`, `.git`, or macOS metadata.

## Important acceptance boundary

The importer was tested through isolated WordPress-compatible serialization and service fixtures. It was not activated inside the team's exact live WordPress/Digital Silk environment during packaging.

The imported custom blocks expose their Gutenberg inspector controls only when the Digital Silk theme/block package that registers those `ds-blocks/*` blocks is active. Header and Footer template parts require a block theme that uses the standard `header` and `footer` template-part slugs.

The regular Vite production build was not rerun in this packaging container because its internal npm registry could not provide the requested dependency versions. The source syntax and all dependency-free handoff tests passed. Run `npm install`, `npm run test:handoff`, and `npm run build` on the target development machine.
