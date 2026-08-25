#!/usr/bin/env node
/**
 * Takes the DST staging site out of the pattern library.
 *
 * The 156 patterns were exported from a live WordPress install, so each one
 * carried that install's own decisions: its media library URLs, and the overlay
 * colours whoever built the page happened to pick. Both are wrong here.
 *
 *   Media       A pattern's card pointed at
 *               `dst.dsstaging1.com/wp-content/uploads/…/exterior-facade.jpg`.
 *               That is somebody else's photograph of somebody else's building,
 *               and it wins over the imagery the builder found for *this* brief,
 *               because an attribute that is present is never replaced. Removing
 *               it lets every slot fall back to the project's own media — which
 *               is the imagery pass's output once it has run, and a labelled
 *               placeholder before that.
 *
 *   Overlays    `backgroundOverlay: '#f5f5f5'` at opacity 1 over a photograph is
 *               a flat grey rectangle where the photograph was. So were
 *               `var(--dst--secondary-color1)` (white), `#dddddd`, and a
 *               bright green gradient. The renderer already has a scrim for the
 *               one case that needs one — a title sitting on a picture — and it
 *               is a soft bottom-up gradient that darkens the type's ground
 *               without hiding the image.
 *
 *   Marquee     The logo rail listed seven real client logos by URL from that
 *               same install. Replaced with inline SVG placeholders that draw in
 *               `currentColor`, so they are legible on a dark banner and on a
 *               light one, and nothing is fetched from anywhere.
 *
 *   Columns     A `c-cards` with no column count fell back to one column, so a
 *               thirteen-card pattern rendered as thirteen full-width bands.
 *               The count is written from what the pattern actually holds.
 *
 *   Overlay     One hero faded a pale *blue* across 60% of the band. Made white,
 *   tone        which is what it was meant to be, and the band's text tone now
 *               follows the overlay rather than the family's preset.
 *
 *   node scripts/clean-patterns.mjs [--check]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DATA = join(ROOT, 'src/data/dst-data.json');

/** Hosts whose media belongs to the site the patterns were exported from. */
const FOREIGN_HOST = /^https?:\/\/[a-z0-9.-]*dsstaging[0-9]*\.(?:com|local)\//i;

/*
 * Placeholder logos.
 *
 * Abstract marks rather than imitations of real brands: a logo rail's job in a
 * concept is to say "recognisable clients go here", and a fake Google wordmark
 * says something the client has not agreed to. Drawn in `currentColor` so one
 * set works on a dark banner and a light one.
 */
const LOGO_MARKS = [
  { name: 'Orbit', svg: '<circle cx="14" cy="14" r="9"/><circle cx="14" cy="14" r="3.2" fill="currentColor" stroke="none"/><path d="M44 8h10M44 14h16M44 20h7"/>' },
  { name: 'Prism', svg: '<path d="M14 5 23 22H5z"/><path d="M44 8h14M44 14h9M44 20h16"/>' },
  { name: 'Meridian', svg: '<rect x="5" y="5" width="18" height="18" rx="4"/><path d="M9 14h10"/><path d="M44 8h8M44 14h17M44 20h11"/>' },
  { name: 'Cadence', svg: '<path d="M5 18c4-11 10-11 14 0"/><path d="M5 10h14"/><path d="M44 8h16M44 14h7M44 20h13"/>' },
  { name: 'Northwood', svg: '<path d="M14 4 5 23h18z"/><path d="M14 12 9 23h10z" fill="currentColor" stroke="none"/><path d="M44 8h11M44 14h15M44 20h8"/>' },
  { name: 'Quadrant', svg: '<path d="M5 5h8v8H5zM15 15h8v8h-8z"/><path d="M44 8h13M44 14h8M44 20h16"/>' },
];

function logoImages() {
  return LOGO_MARKS.map((mark, index) => ({
    // No `url`: nothing is fetched, and the export turns this into a data URI so
    // WordPress receives a real image rather than an empty slot.
    svg: `<svg viewBox="0 0 68 28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="${mark.name}">${mark.svg}</svg>`,
    alt: `${mark.name} — client logo placeholder`,
    placeholder: true,
    instanceId: `logo-placeholder-${index + 1}`,
  }));
}

const CARD_SURFACES = new Set(['ds-blocks/c-cards', 'ds-blocks/c-card-item', 'ds-blocks/c-list', 'ds-blocks/c-list-item']);
const OVERLAY_KEYS = ['backgroundOverlay', 'backgroundOverlayEnabled', 'backgroundOverlayOpacity', 'mediaOverlay', 'mediaOverlayOpacity', 'backgroundOverlayBlur', 'backgroundOverlayMixBlend'];

/** Whether anything under this value still names a file. */
function namesAFile(value) {
  if (Array.isArray(value)) return value.some(namesAFile);
  if (!value || typeof value !== 'object') return false;
  if (typeof value.url === 'string' && value.url) return true;
  if (typeof value.src === 'string' && value.src) return true;
  return Object.values(value).some(namesAFile);
}

/** Every URL under this value that belongs to the exporting site. */
function stripForeignMedia(value, tally) {
  if (Array.isArray(value)) {
    const kept = value.map((entry) => stripForeignMedia(entry, tally)).filter((entry) => entry !== null);
    return kept.length ? kept : null;
  }
  if (!value || typeof value !== 'object') return value;
  const url = typeof value.url === 'string' ? value.url : (typeof value.src === 'string' ? value.src : '');
  if (url && FOREIGN_HOST.test(url)) { tally.media += 1; return null; }
  const out = {};
  let empty = true;
  for (const [key, entry] of Object.entries(value)) {
    const cleaned = stripForeignMedia(entry, tally);
    if (cleaned === null) continue;
    out[key] = cleaned;
    empty = false;
  }
  if (empty) return null;
  /*
   * A background layer that lost its file is not a background.
   *
   * The layer's other keys — `fixed`, `focal`, `size`, `width` — survive the
   * strip and leave an object that looks like a layer, renders nothing, and is
   * not empty enough to be refilled. A third of the catalogue's photographs went
   * missing that way. If it named a file and no longer does, it goes.
   */
  if (namesAFile(value) && !namesAFile(out)) return null;
  return out;
}

/*
 * A scrim has to be strong enough for the words that sit in it.
 *
 * Both floors below are derived rather than chosen, because an overlay of colour
 * C at alpha a over a photograph pixel P paints a*C + (1-a)*P — and a photograph
 * can hold any pixel, so the guarantee has to hold for the worst one.
 *
 *   Light copy is #f7f5ef, relative luminance .93. At 4.5:1 the ground may not
 *   be lighter than luminance .168, which is channel value 113. The worst pixel
 *   is white, and a near-black scrim (channel 33) gives 33a + 255(1-a) <= 113,
 *   so a >= .64.
 *
 *   Dark copy is the palette's dark role, luminance about .014. At 4.5:1 the
 *   ground may not be darker than luminance .24, which is channel 135. The worst
 *   pixel is black, and a white scrim gives 255a >= 135, so a >= .53. Rounded up
 *   to .58 for the grey the subtitles use, which is lighter than the heading.
 *
 * The alternative — leaving the scrim as authored and hoping the photograph is
 * mid-tone — is what put white headings on a bright warehouse photograph at
 * 1.1:1 and dark quotes on a dark one.
 */
const SCRIM_FOR_LIGHT_COPY = 0.64;
const SCRIM_FOR_DARK_COPY = 0.58;

/* The palette roles a scrim is painted from, so it follows the chosen palette. */
const SCRIM_DARK_TOKEN = 'var(--dst--primary-color1)';
const SCRIM_LIGHT_TOKEN = 'var(--dst--secondary-color1)';

/*
 * The components that can be the ground a band's copy sits on.
 *
 * A banner is the obvious one, but fifteen wrappers and two column groups carry
 * a background slot too — that is where the testimonial, FAQ and contact bands
 * put their photograph — and six of them had no wash at all. Restricting the
 * guarantee to banners left exactly the families whose quotes were reported as
 * unreadable.
 */
const MEDIA_GROUNDS = new Set(['ds-blocks/dst-banner', 'ds-blocks/dst-wrapper', 'ds-blocks/ds-columns']);

/* Families whose preset carries light copy — see SECTION_PRESETS in the runtime. */
const LIGHT_COPY_FAMILIES = new Set(['hero', 'cta', 'logo', 'timeline', 'contact']);

/** A CSS colour's channels and alpha, for the literals these patterns use. */
function readColor(text) {
  const value = String(text || '').trim();
  let match = /^#([0-9a-f]{3,8})$/i.exec(value);
  if (match) {
    let hex = match[1];
    if (hex.length === 3 || hex.length === 4) hex = hex.split('').map((c) => c + c).join('');
    const alpha = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return { rgb: [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)), alpha };
  }
  match = /^rgba?\(([^)]+)\)$/i.exec(value);
  if (match) {
    const parts = match[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    if (parts.length >= 3) return { rgb: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 };
  }
  if (/^transparent$/i.test(value)) return { rgb: [0, 0, 0], alpha: 0 };
  if (/^white$/i.test(value)) return { rgb: [255, 255, 255], alpha: 1 };
  if (/^black$/i.test(value)) return { rgb: [0, 0, 0], alpha: 1 };
  /* A palette token: dark roles carry the copy, light roles sit under it. */
  if (/secondary-color1|secondary-color7/.test(value)) return { rgb: [255, 255, 255], alpha: 1, token: value };
  if (/primary-color1|primary-color3|body-bg-alt/.test(value)) return { rgb: [20, 20, 22], alpha: 1, token: value };
  return null;
}

function relativeLuminance([r, g, b]) {
  const channel = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Whether an overlay value reads as a dark wash, a light one, or neither. */
function washTone(value) {
  const text = String(value || '');
  if (!text) return null;
  const stops = text.match(/#[0-9a-f]{3,8}|rgba?\([^)]*\)|var\(--[a-z0-9-]+\)|transparent|white|black/gi) || [];
  const weighted = stops
    .map(readColor)
    .filter((entry) => entry && entry.alpha > 0.02);
  if (!weighted.length) return null;
  const mean = weighted.reduce((total, entry) => total + relativeLuminance(entry.rgb), 0) / weighted.length;
  return mean < 0.22 ? 'dark' : 'light';
}

/** A trimmed attribute value, treating an empty string as absent. */
function cleanValue(value) {
  return typeof value === 'string' ? value.trim() : (value == null ? '' : String(value));
}

/** The least opaque point of a wash, once the opacity attribute is folded in. */
function weakestAlpha(text, fold) {
  const stops = String(text).match(/#[0-9a-f]{3,8}|rgba?\([^)]*\)|var\(--[a-z0-9-]+\)|transparent|white|black/gi) || [];
  const alphas = stops.map(readColor).filter(Boolean).map((entry) => entry.alpha * fold);
  if (!alphas.length) return 0;
  return Math.min(...alphas);
}

/**
 * The same wash, guaranteed to carry the copy.
 *
 * The authored alpha is remapped onto [floor, 1] rather than clamped, so a
 * gradient that faded from clear to solid still fades — it fades from the floor
 * to solid. Direction, hue and shape survive; the transparent end no longer
 * hands the words straight to the photograph.
 */
function raiseWash(value, opacity, floor, toneToken) {
  const fold = Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1;
  const remap = (alpha) => Math.round((floor + (1 - floor) * alpha * fold) * 1000) / 1000;
  const text = String(value || '').trim();

  if (!text) return { overlay: toneToken, opacity: floor };

  /*
   * A wash that already clears the floor is left exactly as it is.
   *
   * Without this the remap is a ratchet: it maps [0,1] onto [floor,1], so a
   * second pass over its own output lifts .64 to .87 and a third to .95, and
   * re-running the script would keep dimming the photographs.
   */
  if (weakestAlpha(text, fold) >= floor - 0.001) return { overlay: value, opacity: fold };

  if (!/gradient/i.test(text)) {
    const parsed = readColor(text);
    if (!parsed) return { overlay: toneToken, opacity: floor };
    /*
     * A flat wash keeps its hue and moves all of its strength into the opacity
     * attribute, which is the control the editor exposes and the importer reads.
     */
    const strength = remap(parsed.alpha);
    const hue = parsed.token || `rgb(${parsed.rgb.map(Math.round).join(',')})`;
    return { overlay: hue, opacity: strength };
  }

  const rewritten = text.replace(/#[0-9a-f]{3,8}|rgba?\([^)]*\)|transparent|white|black/gi, (stop) => {
    const parsed = readColor(stop);
    if (!parsed) return stop;
    const alpha = remap(parsed.alpha);
    /* A stop with nothing in it takes the band's own tone rather than black. */
    const rgb = parsed.alpha < 0.02 ? readColor(toneToken).rgb : parsed.rgb;
    return `rgba(${rgb.map(Math.round).join(',')},${alpha})`;
  });
  return { overlay: rewritten, opacity: 1 };
}

/**
 * Whether this banner paints a photograph behind its own content.
 *
 * The slot is what matters, not what is in it. Every one of these banners now
 * carries `backgroundImage: []` — the foreign media was stripped so the imagery
 * pass can put this project's own photograph there — so testing for a named file
 * finds nothing and the scrim never gets built for the picture that arrives.
 */
function holdsBackgroundMedia(attrs) {
  if (!Object.prototype.hasOwnProperty.call(attrs, 'backgroundImage')) return false;
  const layers = attrs.backgroundImage;
  return Array.isArray(layers) || (layers && typeof layers === 'object');
}

function countCards(node) {
  let total = 0;
  for (const child of node.children || []) {
    if (child.component === 'ds-blocks/c-card-item') total += 1;
  }
  return total;
}

function clean(node, pattern, tally) {
  const attrs = node.attributes || {};

  /*
   * Attribute names this theme does not have.
   *
   * The patterns were exported from an older install, so some of them name
   * controls that have since been renamed or removed. WordPress keeps an
   * unregistered attribute in the markup and ignores it, which means the setting
   * silently does not happen — `enableLightSlider` is why a slider imported as a
   * plain grid of cards. Checked against the theme's own `block.json` files by
   * `scripts/verify-catalog-against-theme.mjs`.
   */
  if (node.component === 'ds-blocks/c-cards' || node.component === 'ds-blocks/dst-banner-slider') {
    if ('enableLightSlider' in attrs) {
      attrs.enableDstSlider = !!attrs.enableLightSlider || !!attrs.enableDstSlider;
      delete attrs.enableLightSlider;
      tally.legacyAttributes += 1;
    }
    if ('lightSliderSettings' in attrs) {
      const carried = attrs.lightSliderSettings;
      if (carried && typeof carried === 'object' && !attrs.dstSliderSettings) attrs.dstSliderSettings = carried;
      delete attrs.lightSliderSettings;
      tally.legacyAttributes += 1;
    }
  }
  if (node.component === 'ds-blocks/c-heading') {
    /*
     * A heading's description is inner blocks, not an attribute — the renderer
     * has always read it from the children. Where the attribute holds copy it
     * becomes a `simple-text` child so the words survive; where it is empty it
     * just goes.
     */
    if ('description' in attrs) {
      const copy = typeof attrs.description === 'string' ? attrs.description.trim() : '';
      if (copy) {
        node.children = node.children || [];
        node.children.push({
          id: `${node.id || 'heading'}-description`,
          component: 'ds-blocks/simple-text',
          usage: 'copy',
          confidence: 'confirmed',
          attributes: {},
          text: copy,
          children: [],
        });
      }
      delete attrs.description;
      tally.legacyAttributes += 1;
    }
    // Neither exists on this block; `showButtons` belongs to a card item.
    for (const key of ['showText', 'showButtons']) {
      if (key in attrs) { delete attrs[key]; tally.legacyAttributes += 1 }
    }
  }
  if (node.component === 'ds-blocks/c-btn' && 'btnVariant' in attrs) {
    // `btnType` is the registered control; the variant was never read.
    if (!attrs.btnType && typeof attrs.btnVariant === 'string' && attrs.btnVariant) attrs.btnType = attrs.btnVariant;
    delete attrs.btnVariant;
    tally.legacyAttributes += 1;
  }


  for (const key of ['media', 'backgroundImage', 'imagePrimary', 'video', 'posterImage']) {
    if (!(key in attrs)) continue;
    const cleaned = stripForeignMedia(attrs[key], tally);
    if (cleaned !== null) { attrs[key] = cleaned; continue; }
    /*
     * Emptied, not deleted.
     *
     * The file was the exporting site's; the *slot* is the pattern's. Deleting
     * the attribute deleted the pattern's intent along with the photograph, and
     * a thirteen-card band came back with no pictures at all. An empty object
     * means "this card has a picture and does not have a file yet", which is
     * what the builder fills from the imagery it found for the brief.
     */
    if (key === 'media' || key === 'imagePrimary') attrs[key] = {};
    // A background layer list is the same story: the list being *present* is the
    // band saying it is photo-backed. Emptied, it is filled from the project at
    // sync; deleted, the band came back a flat colour and the catalogue lost a
    // third of its photographs.
    else if (key === 'backgroundImage') attrs[key] = [];
    else delete attrs[key];
  }

  if (CARD_SURFACES.has(node.component)) {
    for (const key of OVERLAY_KEYS) {
      if (key in attrs) { delete attrs[key]; tally.overlays += 1; }
    }
  }

  // A button pointing at the exporting site's own contact page is a dead link on
  // every page built from the pattern.
  for (const key of ['link', 'button']) {
    const value = attrs[key];
    if (value && typeof value === 'object' && typeof value.url === 'string' && /dsstaging[0-9]*\.(?:com|local)/i.test(value.url)) {
      value.url = '#contact';
      delete value.id;
      delete value.kind;
      tally.links += 1;
    }
    if (value && typeof value === 'object' && value.link && typeof value.link.url === 'string' && /dsstaging[0-9]*\.(?:com|local)/i.test(value.link.url)) {
      value.link.url = '#contact';
      delete value.link.id;
      delete value.link.kind;
      tally.links += 1;
    }
  }

  if (node.component === 'ds-blocks/marquee' && Array.isArray(attrs.images)) {
    attrs.images = logoImages();
    tally.marquees += 1;
  }

  if (node.component === 'ds-blocks/c-cards') {
    const held = countCards(node);
    if (held && !Number(attrs.columnsDesktop) && !Number(attrs.columns)) {
      // Three across is the shape a card grid is designed around, and it is what
      // the renderer already falls back to; anything holding fewer than three
      // gets one column per card rather than a row with holes in it.
      const across = pattern.family === 'slider' || pattern.family === 'testimonial' ? 3 : Math.min(3, held);
      attrs.columnsDesktop = across;
      attrs.columnsTablet = Math.min(2, across);
      attrs.columnsMobile = 1;
      tally.columns += 1;
    }
    // A slider shows three at a time. Two of these patterns said two and one
    // said nothing at all, which the renderer read as one — the same card at
    // full width that made them look identical. The count lives under `columns`
    // on some patterns and `columnsDesktop` on others, so both are written.
    //
    // Testimonials are deliberately not swept with them: a pull-quote band shows
    // one large quote and a card band shows two or three, and which it is is a
    // property of the pattern rather than of the family. Those are named in
    // CORRECTIONS below.
    if (pattern.family === 'slider') {
      const across = Math.max(3, Number(attrs.columnsDesktop) || Number(attrs.columns) || 0);
      if (across !== Number(attrs.columnsDesktop) || across !== Number(attrs.columns)) tally.sliders += 1;
      attrs.columns = across;
      attrs.columnsDesktop = across;
      attrs.columnsTablet = 2;
      attrs.columnsMobile = 1;
      const settings = attrs.dstSliderSettings && typeof attrs.dstSliderSettings === 'object' ? attrs.dstSliderSettings : null;
      if (settings && Number(settings.bleedRightVisibleItems)) settings.bleedRightVisibleItems = across;
    }
  }

  // The one hero that faded pale blue across the band. It reads as a mistake
  // rather than a decision, and the band's words sit in it.
  if (node.component === 'ds-blocks/dst-banner' && typeof attrs.backgroundOverlay === 'string' && /#E3F8FF/i.test(attrs.backgroundOverlay)) {
    attrs.backgroundOverlay = attrs.backgroundOverlay.replace(/#E3F8FF/gi, '#ffffff');
    tally.heroOverlays += 1;
  }

  /*
   * A band whose words sit on a photograph gets a scrim that can carry them.
   *
   * Twenty-six of the forty-seven banners in this catalogue painted a photograph
   * and no wash at all, and several of the rest used a gradient that was clear
   * at exactly the height the heading occupies. Which of the two failures you
   * see depends only on the picture: a bright photograph swallowed the light
   * headings, a dark one swallowed the dark quotes.
   *
   * Only a band that already paints a wash is touched. A band that paints none
   * is the runtime's business: `fidelityApplySection` gives any photograph with
   * no wash the brand's dark at 60% and inverts the copy to suit, and filling
   * the blank here would take that decision away from it and turn fifteen dark
   * media bands pale — a design change nobody asked for. What the runtime cannot
   * see is a wash that *exists* and is too thin, or is clear at exactly the
   * height the heading occupies, because to it those count as painted.
   *
   * The tone is taken from the wash the designer authored — a dark wash is a
   * decision to put light copy in it — and from the family's preset only as a
   * fallback for a wash whose colour cannot be read.
   */
  if (MEDIA_GROUNDS.has(node.component) && holdsBackgroundMedia(attrs) && cleanValue(attrs.backgroundOverlay)) {
    const authored = washTone(attrs.backgroundOverlay);
    const lightCopy = authored ? authored === 'dark' : LIGHT_COPY_FAMILIES.has(pattern.family);
    const floor = lightCopy ? SCRIM_FOR_LIGHT_COPY : SCRIM_FOR_DARK_COPY;
    const token = lightCopy ? SCRIM_DARK_TOKEN : SCRIM_LIGHT_TOKEN;
    const before = `${attrs.backgroundOverlay ?? ''}@${attrs.backgroundOverlayOpacity ?? ''}@${attrs.backgroundOverlayEnabled ?? ''}`;
    const raised = raiseWash(attrs.backgroundOverlay, attrs.backgroundOverlayOpacity, floor, token);
    attrs.backgroundOverlay = raised.overlay;
    attrs.backgroundOverlayOpacity = raised.opacity;
    // Switched off is the same as absent to a reader of the page.
    attrs.backgroundOverlayEnabled = true;
    if (`${attrs.backgroundOverlay}@${attrs.backgroundOverlayOpacity}@true` !== before) tally.scrims += 1;
  }

  for (const child of node.children || []) clean(child, pattern, tally);
}

/*
 * Per-pattern corrections.
 *
 * Everything above is a rule; these are decisions about individual patterns that
 * no rule can derive — how many quotes a pull-quote band shows, where a column
 * sits in its row, whether a picture should hold still while the copy beside it
 * scrolls. Kept here rather than hand-edited into the data so they survive a
 * re-ingest and can be read as a list.
 *
 *   across      how many cards the grid shows at once (`--dst-slider-cols`)
 *   valign      the row's vertical alignment, which becomes each column's
 *               `align-self`
 *   stickyMedia the column holding the picture stays put while the column beside
 *               it scrolls
 *   stickyHeading the same, for the column holding the heading
 *   fullList    the list is not a container: no `c-default`, no side padding
 *   buttons     which button treatment the band asks for: `standard` is the
 *               ordinary filled primary rather than the white-on-dark ghost a
 *               dark band would otherwise get
 */
const CORRECTIONS = {
  'sbs-testimonial-p15-v1': { across: 1 },
  'sbs-testimonial-p15-v2': { across: 1, valign: 'start' },
  'sbs-testimonial-p43-v1': { across: 1 },
  'sbs-testimonial-p43-v2': { across: 2 },
  'sbs-testimonial-p10-v1': { across: 2 },
  'sbs-timeline-p1-v2': { stickyHeading: true },
  'sbs-hero-p1-v1': { buttons: 'standard' },
  'sbs-stats-p31-v2': { valign: 'start', stickyMedia: true, fullList: true },
  'sbs-stats-p31-v3': { valign: 'start', stickyMedia: true },
};

function holds(node, component) {
  if (node.component === component) return true;
  return (node.children || []).some((child) => holds(child, component));
}

function correct(pattern) {
  const fix = CORRECTIONS[pattern.id];
  if (!fix) return 0;
  let changed = 0;
  const walk = (node) => {
    const attrs = node.attributes || (node.attributes = {});
    /*
     * The band keeps its light copy and loses the ghost primary.
     *
     * On a dark band the primary is drawn white-filled with a dark label, which
     * reads as a secondary action rather than the main one. `standard` asks for
     * the accent fill instead; the renderer leaves the outlined secondary
     * following the band, since an outline has to be the band's own ink.
     */
    if (fix.buttons && node.component === 'ds-blocks/c-btn') {
      attrs.groupTheme = fix.buttons;
      changed += 1;
    }
    if (fix.across && node.component === 'ds-blocks/c-cards') {
      attrs.columns = fix.across;
      attrs.columnsDesktop = fix.across;
      attrs.columnsTablet = Math.min(2, fix.across);
      attrs.columnsMobile = 1;
      const settings = attrs.dstSliderSettings;
      if (settings && typeof settings === 'object' && Number(settings.bleedRightVisibleItems)) {
        settings.bleedRightVisibleItems = fix.across;
      }
      changed += 1;
    }
    if (fix.valign && node.component === 'ds-blocks/ds-columns') {
      attrs.verticalAlign = fix.valign;
      changed += 1;
    }
    /*
     * A column's own `alignVertical` beats the row's.
     *
     * `sbs-testimonial-p15-v2` set the row to `end` *and* pinned its first column
     * to `bottom`, so correcting the row alone left the heading sitting on the
     * floor of the band beside a column of quotes. The column is the one that
     * actually renders `align-self`, so both are written.
     */
    if (fix.valign && node.component === 'ds-blocks/ds-column' && attrs.alignVertical) {
      attrs.alignVertical = fix.valign === 'start' ? 'top' : fix.valign;
      changed += 1;
    }
    /*
     * The heading column holds still while the entries scroll past it.
     *
     * Same mechanism as `stickyMedia`, different subject: a two-column timeline
     * puts its heading beside a list twice its height, and letting the heading
     * scroll away leaves the entries unlabelled halfway down the band.
     */
    if (fix.stickyHeading && node.component === 'ds-blocks/ds-column' && holds(node, 'ds-blocks/c-heading')) {
      const marks = String(attrs.class || '').split(/\s+/).filter(Boolean);
      if (!marks.includes('is-sticky-heading')) marks.push('is-sticky-heading');
      attrs.class = marks.join(' ');
      changed += 1;
    }
    if (fix.stickyMedia && node.component === 'ds-blocks/ds-column' && holds(node, 'ds-blocks/c-media')) {
      // `class` is a registered attribute on every DST block, so this survives
      // the export allow-list and reaches WordPress as a real class.
      const marks = String(attrs.class || '').split(/\s+/).filter(Boolean);
      if (!marks.includes('is-sticky-media')) marks.push('is-sticky-media');
      attrs.class = marks.join(' ');
      changed += 1;
    }
    if (fix.fullList && node.component === 'ds-blocks/c-list') {
      // An empty container name resolves to `c-full` for a nested block: no
      // max-width, no side padding, no container class the band already has.
      attrs.dsContainer = '';
      changed += 1;
    }
    (node.children || []).forEach(walk);
  };
  walk(pattern.tree);
  return changed;
}

const check = process.argv.includes('--check');
const data = JSON.parse(readFileSync(DATA, 'utf8'));
const tally = { media: 0, overlays: 0, marquees: 0, columns: 0, sliders: 0, heroOverlays: 0, links: 0, corrections: 0, scrims: 0, legacyAttributes: 0 };
for (const pattern of data.patterns) clean(pattern.tree, pattern, tally);
for (const pattern of data.patterns) tally.corrections += correct(pattern);

// The media library and the decorations are the builder's own, not the staging
// site's — but the host repair belongs here too rather than only at boot.
const rewritten = JSON.stringify(data).replace(/dst(-dev)?\.dsstaging1\.local/g, 'dst.dsstaging1.com');
const out = JSON.parse(rewritten);

if (!check) writeFileSync(DATA, `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify({ ...tally, wrote: !check }, null, 2));
