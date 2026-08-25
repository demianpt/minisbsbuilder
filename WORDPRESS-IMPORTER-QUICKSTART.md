# SBS WordPress Importer — quick start

## 1. Export from Mini SBS

Open **Review & export → Advanced handoff** and download **Complete project bundle**.

The downloaded ZIP contains:

```text
navigation.json
footer.json
page.json
website.html
```

`website.html` is a visual-review file. The plugin never inserts it into WordPress.

## 2. Install the plugin

In WordPress:

1. Open **Plugins → Add New → Upload Plugin**.
2. Upload `sbs-website-importer.zip`.
3. Activate **SBS Website Importer**.
4. Confirm the Digital Silk theme/block package is active.

For Header and Footer template parts to control the live site, use the Digital Silk block theme or another block theme that references the standard `header` and `footer` template-part slugs.

## 3. Import

1. Open **SBS Importer** in the WordPress admin menu.
2. Drop the complete project ZIP into the upload area.
3. Review the detected page, navigation, footer, and missing-block report.
4. Choose a new page or an existing page.
5. Choose **Replace** or **Append** for existing page content.
6. Leave Header and Footer enabled when importing the complete website.
7. Leave design tokens enabled to carry the builder palette, typography, spacing, containers, and button values into WordPress.
8. Leave media sideloading enabled when WordPress should copy supported remote images into its Media Library.
9. Select **Import project**.

## 4. Edit after import

- Page: use the success-screen **Edit imported page** link.
- Header: **Appearance → Editor → Design → Patterns → Header**.
- Footer: **Appearance → Editor → Design → Patterns → Footer**.

Imported page modules are native `ds-blocks/*` blocks. Selecting a block in Gutenberg loads the inspector options registered by the Digital Silk block package, including its layout, background, overlay, responsive, media, and effects controls.

## Requirements

- WordPress 6.4 or newer.
- PHP 8.0 or newer.
- Active Digital Silk block registrations.
- A block theme for live Header/Footer template-part usage.

The importer uses `ZipArchive` when available and falls back to WordPress's bundled PclZip reader.

## Logo behavior

Digital Silk's navigation-logo block uses the WordPress Site Logo. When the builder export includes a real logo URL and **Use exported logo as Site Logo** is enabled, the plugin copies it into WordPress and assigns it. A text-only builder logo does not replace the Site Logo automatically.
