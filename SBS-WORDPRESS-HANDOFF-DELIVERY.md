# SBS WordPress handoff delivery

## Builder

Start the builder:

```bash
npm install
npm run dev
```

Open the local address printed by Vite, normally `http://127.0.0.1:5173`.

The **Review & export** screen provides separate downloads for Navigation, Footer, Page, and HTML. **Complete project bundle** now downloads one ZIP containing all four files.

## WordPress plugin

A ready-to-upload plugin ZIP is included at:

```text
deliverables/sbs-website-importer.zip
```

Install it through:

```text
WordPress Admin → Plugins → Add New → Upload Plugin
```

Activate **SBS Website Importer**, then open **SBS Importer** in the WordPress admin menu.

## Import workflow

1. Upload the complete project ZIP, or upload an individual JSON artifact.
2. Review detected artifacts and compatibility warnings.
3. Choose an existing page or create a new page.
4. Choose Replace or Append for existing page content.
5. Import the Header and Footer template parts when required.
6. Apply the exported design tokens.
7. Optionally copy supported images into the Media Library.
8. Open the imported page or template parts from the success screen.

## Editing after import

The plugin stores page sections as native Gutenberg block comments using the original Digital Silk block names, attributes, and child hierarchy. The Digital Silk block package must be active for the same Gutenberg inspector controls to appear.

Header and Footer imports are saved as `wp_template_part` records in the active theme's Header and Footer areas. With a compatible block theme, edit them from:

```text
Appearance → Editor → Design → Patterns → Header
Appearance → Editor → Design → Patterns → Footer
```

## Requirements

- WordPress 6.4+
- PHP 8.0+
- Active Digital Silk block registrations
- A block theme for live Header/Footer template-part usage

The importer uses `ZipArchive` when available and falls back to WordPress's bundled PclZip implementation.

## Verification

```bash
npm run test:handoff
npm run build
```

See `release-evidence/WORDPRESS-HANDOFF-QA.md` for completed checks and the remaining real-environment acceptance boundary.
