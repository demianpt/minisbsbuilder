=== SBS Website Importer ===
Contributors: digitalsilk
Tags: gutenberg, blocks, site-editor, template-parts, importer
Requires at least: 6.4
Requires PHP: 8.0
Stable tag: 3.0.0
License: GPLv2 or later

Import SBS Page Builder projects as native Digital Silk Gutenberg blocks, pages, and Header/Footer template parts.

== Description ==

SBS Website Importer imports the Page Builder's page, navigation, and footer JSON artifacts. A complete project ZIP can be uploaded in one step.

The imported page remains fully editable because the plugin preserves registered `ds-blocks/*` block names, attributes, and nested block structure. Header and Footer artifacts are saved as `wp_template_part` records in the active theme's Header and Footer areas.

The Digital Silk theme/block package must be active for its custom block inspector options to be available.

== Installation ==

1. Upload and activate the plugin.
2. Open SBS Importer in the WordPress admin.
3. Upload a complete SBS project ZIP or individual JSON artifact.
4. Review destinations and import.

== Changelog ==

= 1.0.1 =
* Consume the complete resolved SBS Design Dial token contract so WordPress matches the builder more closely.
* Preserve container rhythm, reading measure, component spacing, imagery treatment and motion tokens in the front end and Gutenberg editor canvas.

= 1.0.0 =
* Initial MVP handoff importer.

