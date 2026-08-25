# SBS Website Importer

## 3.0.0 — What the theme actually accepts, and a way back

### The importer was asking the wrong question

Before writing an attribute the importer asked `WP_Block_Type_Registry` whether
the block accepted it. On a real site that answer comes from `block.json` alone —
and this theme adds a second set of controls from JavaScript, through editor
filters keyed on `supports`:

    dsGapControl      ->  dsPadding, dsMargin
    dsContainers      ->  dsContainer, dsContainerCustom, dsContainerSideGap, …
    dsEffects         ->  dsEffects
    dsClassVariants   ->  classVariant
    dsClassList       ->  class

None of those names is in `block.json`, so PHP answered "no" to every one of
them. Any of those settings that the export carried on a *node* rather than
inside `attributes` was silently refused — which is every section's scroll effect
and every band's padding. The same wrong answer was then shown to the strategist
as *"contains attributes not registered by the active block package"*, naming
attributes the theme applies on every page it renders.

`SBS_Importer_Block_Contract` is now the single answer to that question, for both
the writer and the warning. It reads `block.json` **and** derives the HOC names
from `supports`, and where it cannot tell it allows: this class may never be the
reason a real setting is dropped.

This could not have been caught by the plugin's own tests — their fixture
registry is built from the builder's snapshot, which already lists the HOC names.
`tests/wordpress/importer-contract.php` now registers a block the way WordPress
does, declared attributes plus supports flags, and fails without the contract.

### Undo an import

Every import is recorded: the posts it created, the posts it overwrote (with
their previous title, content and status kept verbatim), the options and theme
mods it changed, and the menus it built. **Undo this import** puts the site back
— overwritten pages and template parts restored, created posts moved to the
trash, options and menu locations returned to their previous values.
**Re-apply** reverses the undo. Both directions are stored, so neither is
inferred after the fact.

Twenty imports are kept. Attachments are recorded only when this import created
them: one matched to an existing file may be in use by a page nobody touched.

The one honest limit: a navigation menu deleted by an undo is not recreated by a
re-apply. A menu's items belong to it, and inventing new ones would be a
different menu wearing the same name. The screen says so rather than leaving it
to be discovered.

### The scrim under a media-background card

The preview draws a dark gradient between a card's photograph and its white
title. The block package has no element and no attribute for it — neither
`dst-cards/render.php` nor `dst-card-item/render.php` reads an overlay, and
`c-block__scrim` appears nowhere in the theme — so an imported card put white
type straight onto the picture. The plugin's stylesheet now paints it into the
layer the theme already reserves for it (`.media-bg .dst-card` declares
`--zIndex-overlay: 1` between the picture and the body).

### The fonts the concept was designed in

`build_css` wrote `--dst--font-primary: 'Inter', system-ui, sans-serif`, which
names a typeface without fetching it, so every heading fell back to the next
family in the stack. Families the export marks `google: true` are now enqueued,
with each name checked against a conservative pattern before it reaches a URL.

A Digital Silk–specific WordPress importer for the SBS Page Builder.

## What it imports

- `page.json` into an existing or new WordPress page as native Gutenberg block comments.
- `navigation.json` into a native WordPress menu and a Header `wp_template_part`.
- `footer.json` into an editable Footer `wp_template_part`.
- A complete project ZIP containing `navigation.json`, `footer.json`, `page.json`, and `website.html`.

`website.html` is never inserted into WordPress. It is included only for standalone review.

## Requirements

- WordPress 6.4 or newer.
- PHP 8.0 or newer.
- A block theme for Header/Footer template parts to be active on the front end.
- The Digital Silk theme/block package that registers the exported `ds-blocks/*` blocks.
- No PHP Zip extension is required. The importer uses `ZipArchive` when available and falls back to WordPress's bundled PclZip reader.

## Installation

1. Upload `sbs-website-importer.zip` through **Plugins → Add New → Upload Plugin**.
2. Activate **SBS Website Importer**.
3. Open **SBS Importer** in the WordPress admin menu.
4. Upload the complete project ZIP or an individual JSON artifact.
5. Review the detected artifacts and choose their destinations.
6. Import and open the resulting page, Header, or Footer directly from the success screen.

## Editable block options

The importer preserves each block's original registered name, attributes, and child hierarchy. The Gutenberg editor therefore loads the same Digital Silk inspector controls for containers, spacing, overlays, responsive columns, card direction, effects, media, and other registered block properties.

The importer does not re-register or imitate the Digital Silk blocks. If the Digital Silk block package is inactive, WordPress will mark those blocks as missing until it is activated.

## Security

- Capability and nonce checks on every action.
- ZIP path traversal protection.
- Entry count and uncompressed-size limits.
- JSON validation.
- Sanitized `core/html` content.
- Allowlisted design-token CSS values; external `url()` and executable CSS are rejected.
- Optional media sideloading through WordPress APIs with source URL deduplication.

## Header and Footer location

Header and Footer imports are saved as `wp_template_part` records in the active theme's `header` and `footer` areas. In a block theme they are available from **Appearance → Editor → Design → Patterns**. The default slugs are `header` and `footer`, which lets themes that reference those standard slugs use the imported parts immediately.

## Complete project bundle

The plugin accepts the browser-generated four-file project ZIP. It uses `ZipArchive` when available and WordPress's bundled PclZip reader as a fallback. Duplicate artifact filenames, unsafe paths, oversized entries, and malformed JSON are rejected.
