/**
 * Design dials.
 *
 * A dial is a single 0–100 control that a digital strategist can move without
 * knowing what a padding token is. Each dial owns a named set of CSS custom
 * properties and, where a continuous value would be too subtle to notice, a
 * discrete *level* that switches whole rules on. Both live here so the editor
 * panel, the live preview, the standalone HTML and the WordPress theme export
 * can never disagree about what a dial does.
 *
 * Design rule: a dial must produce a change a strategist can see at a glance.
 * The ranges below are deliberately wide for that reason. A dial must never be
 * able to break layout — it may change rhythm, scale, colour weight, surface
 * definition and motion, never whether a component is structurally correct.
 */

export const DIAL_DEFAULTS = Object.freeze({
  density: 48,
  expressiveness: 58,
  motion: 42,
  headline: 52,
  corner: 8,
  accent: 45,
  surface: 40,
  imagery: 55,
  measure: 50,
});

/** Dial groups drive the editor layout: five short, legible sections. */
export const DIAL_GROUPS = Object.freeze([
  Object.freeze({
    id: 'space',
    label: 'Space and rhythm',
    hint: 'How much room the page gives every idea.',
    dials: Object.freeze(['density', 'measure']),
  }),
  Object.freeze({
    id: 'type',
    label: 'Typography',
    hint: 'How loudly the headings speak.',
    dials: Object.freeze(['headline']),
  }),
  Object.freeze({
    id: 'surface',
    label: 'Colour and surface',
    hint: 'How present the brand colour and the edges of things are.',
    dials: Object.freeze(['accent', 'surface', 'corner']),
  }),
  Object.freeze({
    id: 'media',
    label: 'Imagery',
    hint: 'How much of the page the pictures own.',
    dials: Object.freeze(['imagery']),
  }),
  Object.freeze({
    id: 'motion',
    label: 'Movement',
    hint: 'How much the page moves as you scroll and hover.',
    dials: Object.freeze(['motion']),
  }),
  Object.freeze({
    id: 'character',
    label: 'Overall character',
    hint: 'One dial that moves several things together.',
    dials: Object.freeze(['expressiveness']),
  }),
]);

function bands(...pairs) {
  return (value) => pairs.find(([limit]) => value < limit)?.[1] ?? pairs[pairs.length - 1][1];
}

export const DIALS = Object.freeze({
  density: Object.freeze({
    key: 'density',
    label: 'Density',
    min: 'Spacious',
    max: 'Compact',
    help: 'Space between sections, padding inside cards, gaps in grids, line height and header height.',
    band: bands([34, 'Spacious'], [67, 'Balanced'], [101, 'Compact']),
  }),
  measure: Object.freeze({
    key: 'measure',
    label: 'Reading width',
    min: 'Narrow',
    max: 'Wide',
    help: 'How wide a paragraph is allowed to run before it wraps. Narrow is easier to read; wide fits more per line.',
    band: bands([34, 'Narrow'], [67, 'Comfortable'], [101, 'Wide']),
  }),
  headline: Object.freeze({
    key: 'headline',
    label: 'Headline size',
    min: 'Modest',
    max: 'Huge',
    help: 'Scales every heading together, keeping the size relationship between them intact.',
    band: bands([30, 'Modest'], [60, 'Confident'], [85, 'Large'], [101, 'Huge']),
  }),
  accent: Object.freeze({
    key: 'accent',
    label: 'Brand colour emphasis',
    min: 'Sparing',
    max: 'Saturated',
    help: 'How often the accent colour appears: hairline rules and links only, or filled bands and blocks.',
    band: bands([25, 'Sparing'], [55, 'Measured'], [80, 'Strong'], [101, 'Saturated']),
  }),
  surface: Object.freeze({
    key: 'surface',
    label: 'Surface definition',
    min: 'Flat',
    max: 'Defined',
    help: 'How visible the edges of cards and bands are: invisible, hairline, bordered, or raised with shadow.',
    band: bands([25, 'Flat'], [55, 'Hairline'], [80, 'Bordered'], [101, 'Raised']),
  }),
  corner: Object.freeze({
    key: 'corner',
    label: 'Corner softness',
    min: 'Square',
    max: 'Pill',
    help: 'Corner rounding on cards, images, inputs and buttons.',
    band: bands([6, 'Square'], [20, 'Slightly soft'], [50, 'Rounded'], [101, 'Pill']),
  }),
  imagery: Object.freeze({
    key: 'imagery',
    label: 'Image presence',
    min: 'Restrained',
    max: 'Dominant',
    help: 'How tall images are, how much of the hero they cover, and how saturated they look.',
    band: bands([30, 'Restrained'], [60, 'Balanced'], [85, 'Generous'], [101, 'Dominant']),
  }),
  motion: Object.freeze({
    key: 'motion',
    label: 'Movement',
    min: 'Still',
    max: 'Dynamic',
    help: 'Reveal distance and speed, stagger between items, hover lift, image zoom and logo marquee speed. Zero switches motion off completely.',
    band: bands([5, 'Still'], [45, 'Subtle'], [75, 'Active'], [101, 'Dynamic']),
  }),
  expressiveness: Object.freeze({
    key: 'expressiveness',
    label: 'Expression',
    min: 'Restrained',
    max: 'Bold',
    help: 'The overall confidence of the design: hero height, heading tightness, decoration strength, contrast and image treatment.',
    band: bands([34, 'Restrained'], [67, 'Designed'], [101, 'Bold']),
  }),
});

export const DIAL_KEYS = Object.freeze(Object.keys(DIALS));

/** One-click starting points. A strategist should never face nine cold sliders. */
export const DIAL_PRESETS = Object.freeze([
  Object.freeze({
    id: 'calm',
    label: 'Calm and spacious',
    summary: 'Lots of air, quiet colour, gentle movement.',
    values: Object.freeze({ density: 14, measure: 30, headline: 40, accent: 22, surface: 24, corner: 10, imagery: 40, motion: 22, expressiveness: 30 }),
  }),
  Object.freeze({
    id: 'editorial',
    label: 'Editorial authority',
    summary: 'Square corners, large serif headlines, hairline surfaces.',
    values: Object.freeze({ density: 40, measure: 42, headline: 74, accent: 30, surface: 42, corner: 0, imagery: 58, motion: 30, expressiveness: 62 }),
  }),
  Object.freeze({
    id: 'bold',
    label: 'Bold and modern',
    summary: 'Huge type, strong accent, confident motion.',
    values: Object.freeze({ density: 52, measure: 58, headline: 92, accent: 78, surface: 62, corner: 4, imagery: 84, motion: 78, expressiveness: 92 }),
  }),
  Object.freeze({
    id: 'efficient',
    label: 'Compact and efficient',
    summary: 'More on screen, defined surfaces, minimal movement.',
    values: Object.freeze({ density: 84, measure: 76, headline: 34, accent: 40, surface: 78, corner: 6, imagery: 34, motion: 12, expressiveness: 34 }),
  }),
  Object.freeze({
    id: 'friendly',
    label: 'Friendly and soft',
    summary: 'Rounded corners, warm accent, lively hover.',
    values: Object.freeze({ density: 38, measure: 46, headline: 52, accent: 62, surface: 50, corner: 72, imagery: 62, motion: 62, expressiveness: 56 }),
  }),
]);

function clamp01(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return clamp01(fallback, 50);
  return Math.max(0, Math.min(100, number)) / 100;
}

/** Fills in every dial, and derives `corner` from a legacy radius string. */
export function ensureDials(design) {
  const target = design && typeof design === 'object' ? design : {};
  for (const key of DIAL_KEYS) {
    if (key === 'corner') continue;
    const number = Number(target[key]);
    target[key] = Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : DIAL_DEFAULTS[key];
  }
  // `radius` predates the corner dial and is still the exported token, so it
  // stays authoritative: a project saved before this dial existed keeps its
  // rounding, and applying an archetype keeps working unchanged.
  const cornerNumber = Number(target.corner);
  if (Number.isFinite(cornerNumber)) {
    target.corner = Math.max(0, Math.min(100, Math.round(cornerNumber)));
    target.radius = `${cornerToRadius(target.corner)}px`;
  } else {
    target.corner = radiusToCorner(target.radius);
    target.radius = target.radius || `${cornerToRadius(target.corner)}px`;
  }
  return target;
}

/** 0 → square, 100 → pill. Non-linear so the useful 0–16px range has room. */
export function cornerToRadius(corner) {
  const value = Math.max(0, Math.min(100, Number(corner) || 0)) / 100;
  return Math.round(value ** 1.7 * 44);
}

export function radiusToCorner(radius) {
  const px = Number.parseFloat(String(radius ?? '').replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(px)) return DIAL_DEFAULTS.corner;
  return Math.round(Math.min(1, (Math.min(44, Math.max(0, px)) / 44) ** (1 / 1.7)) * 100);
}

export function dialBand(key, value) {
  return DIALS[key]?.band?.(Math.max(0, Math.min(100, Number(value) || 0))) || '';
}

export function dialLabel(key, value) {
  const number = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  return `${number} · ${dialBand(key, number)}`;
}

/**
 * Discrete levels. Continuous interpolation alone is not noticeable enough to
 * feel like a control, so each dial also names a band that switches whole rules
 * on in `dialCss`. Moving a dial across a band boundary is unmistakable.
 */
export function dialLevels(design) {
  const dials = ensureDials({ ...(design || {}) });
  const level = (key) => dialBand(key, dials[key]).toLowerCase().replace(/\s+/g, '-');
  return {
    density: level('density'),
    expression: level('expressiveness'),
    motion: level('motion'),
    headline: level('headline'),
    accent: level('accent'),
    surface: level('surface'),
    corner: level('corner'),
    imagery: level('imagery'),
    measure: level('measure'),
  };
}

const round = (value, places = 2) => Number(value.toFixed(places));

/**
 * The complete token set for a dial configuration. Returned as a plain object
 * so both the CSS writer and the theme export read the same numbers.
 */
export function dialTokens(design) {
  const d = ensureDials({ ...(design || {}) });
  const den = clamp01(d.density, DIAL_DEFAULTS.density);
  const exp = clamp01(d.expressiveness, DIAL_DEFAULTS.expressiveness);
  const mot = clamp01(d.motion, DIAL_DEFAULTS.motion);
  const type = clamp01(d.headline, DIAL_DEFAULTS.headline);
  const acc = clamp01(d.accent, DIAL_DEFAULTS.accent);
  const sur = clamp01(d.surface, DIAL_DEFAULTS.surface);
  const img = clamp01(d.imagery, DIAL_DEFAULTS.imagery);
  const mea = clamp01(d.measure, DIAL_DEFAULTS.measure);
  const radius = cornerToRadius(d.corner);
  // The headline dial scales the display sizes; expression pushes the same
  // family further. Combining them keeps one dial from cancelling the other.
  const scale = round(0.78 + type * 0.62 + exp * 0.18, 3);
  const still = mot < 0.05;

  return {
    // Space and rhythm
    sectionGap: `${round(15.4 - 10.6 * den)}vmin`,
    sectionGapSmall: `${round(8.6 - 6.0 * den)}vmin`,
    sectionGapLarge: `${round(21.0 - 14.4 * den)}vmin`,
    mobileGap: `${Math.round(78 - 30 * den)}px`,
    headerHeight: `${Math.round(108 - 44 * den)}px`,
    cardPadding: `${round(5.6 - 3.9 * den)}rem`,
    cardBodyPadding: `${round(4.2 - 2.9 * den)}rem`,
    gridGap: `${round(4.8 - 3.8 * den)}rem`,
    stackGap: `${round(3.4 - 2.2 * den)}rem`,
    bodyLineHeight: `${round(1.86 - 0.44 * den)}`,
    containerWidth: `${Math.round(1340 + 240 * den)}px`,

    // Reading measure
    measure: `${Math.round(50 + 40 * mea)}ch`,
    altContainerWidth: `${Math.round(900 + 340 * mea)}px`,

    // Type
    typeScale: `${scale}`,
    h1: `clamp(${round(3.6 + 0.9 * type)}rem, ${round(4.2 + 7.4 * type + 1.6 * exp)}vw, ${round(5.8 + 7.6 * type + 1.4 * exp)}rem)`,
    h2: `clamp(${round(2.7 + 0.6 * type)}rem, ${round(2.8 + 4.0 * type + 0.9 * exp)}vw, ${round(4.2 + 4.6 * type + 0.9 * exp)}rem)`,
    h3: `clamp(${round(2.0 + 0.4 * type)}rem, ${round(1.9 + 1.6 * type)}vw, ${round(2.9 + 1.9 * type)}rem)`,
    h4: `clamp(${round(1.7 + 0.2 * type)}rem, ${round(1.4 + 0.8 * type)}vw, ${round(2.1 + 0.9 * type)}rem)`,
    titleTracking: `${round(-0.008 - 0.05 * exp, 4)}em`,
    titleLineHeight: `${round(1.14 - 0.16 * type)}`,
    pretitleTracking: `${round(0.1 + 0.16 * exp, 3)}em`,

    // Colour and surface
    radius: `${radius}px`,
    accentStrength: `${round(acc, 3)}`,
    accentRule: `${round(1 + 6 * acc, 1)}px`,
    accentTintAlpha: `${round(3 + 15 * acc, 1)}%`,
    borderAlpha: `${round(3 + 21 * sur, 1)}%`,
    borderWidth: `${sur > 0.8 ? 2 : 1}px`,
    cardShadow: sur < 0.55
      ? 'none'
      : `0 ${round(6 + 22 * sur)}px ${round(18 + 52 * sur)}px rgba(16, 22, 30, ${round(0.03 + 0.11 * sur, 3)})`,
    cardSurfaceMix: `${Math.round(30 + 55 * sur)}%`,

    // Imagery
    mediaMinHeight: `${Math.round(24 + 40 * img)}rem`,
    mediaSaturate: `${round(0.5 + 0.7 * img, 2)}`,
    mediaContrast: `${round(0.95 + 0.2 * exp, 2)}`,
    heroMinHeight: `${Math.round(58 + 42 * Math.max(img, exp))}vh`,
    heroMediaWidth: `${Math.round(44 + 26 * img)}%`,
    heroOverlayAlpha: `${round(0.9 - 0.25 * img, 2)}`,

    // Motion
    motionDuration: still ? '0s' : `${round(0.18 + 0.78 * mot)}s`,
    motionDistance: still ? '0px' : `${Math.round(6 + 86 * mot)}px`,
    motionScale: still ? '1' : `${round(1 - 0.07 * mot, 3)}`,
    motionStagger: still ? '0ms' : `${Math.round(10 + 120 * mot)}ms`,
    motionEase: mot > 0.7 ? 'cubic-bezier(.16,.84,.24,1)' : 'cubic-bezier(.25,.8,.35,1)',
    hoverLift: still ? '0px' : `${Math.round(1 + 13 * mot)}px`,
    mediaHoverZoom: still ? '1' : `${round(1 + 0.09 * mot, 3)}`,
    marqueeDuration: `${Math.round(96 - 82 * mot)}s`,
    scrollBehavior: still ? 'auto' : 'smooth',

    // Decoration
    decorScale: `${round(0.58 + 1.15 * exp, 2)}`,
    decorOpacity: `${round(0.3 + 0.7 * exp, 2)}`,
  };
}

const CSS_VARIABLE_NAMES = Object.freeze({
  sectionGap: '--dst--desktop-vertical-gap',
  sectionGapSmall: '--dst--vgap-s',
  sectionGapLarge: '--dst--vgap-l',
  headerHeight: '--dst--header-height',
  containerWidth: '--dst--default-container-width',
  altContainerWidth: '--dst--alt-container-width',
  radius: '--dst--default-radius',
  h1: '--dst--fs-h1',
  h2: '--dst--fs-h2',
  h3: '--dst--fs-h3',
  h4: '--dst--fs-h4',
  cardPadding: '--sbs-card-pad',
  cardBodyPadding: '--sbs-card-body-pad',
  gridGap: '--sbs-grid-gap',
  stackGap: '--sbs-stack-gap',
  bodyLineHeight: '--sbs-body-lh',
  measure: '--sbs-measure',
  typeScale: '--sbs-type-scale',
  titleTracking: '--sbs-title-tracking',
  titleLineHeight: '--sbs-title-lh',
  pretitleTracking: '--sbs-pretitle-ls',
  accentStrength: '--sbs-accent-strength',
  accentRule: '--sbs-accent-rule',
  accentTintAlpha: '--sbs-accent-tint',
  borderAlpha: '--sbs-border-alpha',
  borderWidth: '--sbs-border-width',
  cardShadow: '--sbs-card-shadow',
  cardSurfaceMix: '--sbs-card-surface-mix',
  mediaMinHeight: '--sbs-media-min',
  mediaSaturate: '--sbs-media-saturate',
  mediaContrast: '--sbs-media-contrast',
  heroMinHeight: '--sbs-hero-min',
  heroMediaWidth: '--sbs-hero-media-w',
  heroOverlayAlpha: '--sbs-hero-overlay-a',
  motionDuration: '--sbs-motion-duration',
  motionDistance: '--sbs-motion-distance',
  motionScale: '--sbs-motion-scale',
  motionStagger: '--sbs-motion-stagger',
  motionEase: '--sbs-motion-ease',
  hoverLift: '--sbs-hover-lift',
  mediaHoverZoom: '--sbs-media-zoom',
  marqueeDuration: '--sbs-marquee-dur',
  decorScale: '--sbs-decor-scale',
  decorOpacity: '--sbs-decor-opacity',
});

/** The `#sbs-site.ver` custom-property block for a dial configuration. */
export function dialVariables(design) {
  const tokens = dialTokens(design);
  return Object.entries(CSS_VARIABLE_NAMES)
    .map(([token, name]) => `${name}:${tokens[token]}`)
    .join(';');
}

/**
 * Rules that consume the dial variables, plus the discrete level rules that
 * make a band change unmistakable. Scoped to `#sbs-site` so nothing here can
 * leak into the editor chrome.
 */
export function dialCss(design) {
  const tokens = dialTokens(design);
  const levels = dialLevels(design);
  return `
#sbs-site.ver{${dialVariables(design)}}
html{scroll-behavior:${tokens.scrollBehavior}}

/* Space and rhythm */
#sbs-site{line-height:var(--sbs-body-lh)}
#sbs-site .sbs-rich-text{max-width:var(--sbs-measure)}
#sbs-site .c-heading__sub,#sbs-site .c-heading__description p{max-width:var(--sbs-measure)}
/* .c-heading stays in normal flow: it hosts an absolutely positioned
   backtitle and an optional split grid, so its rhythm is tuned through the
   existing margins rather than by turning it into a flex container. */
#sbs-site .c-heading__title{margin-bottom:calc(var(--sbs-stack-gap) * .38)}
#sbs-site .c-heading__description{margin-top:var(--sbs-stack-gap);gap:calc(var(--sbs-stack-gap) * .7)}
@media(max-width:680px){#sbs-site.ver{--dst--desktop-vertical-gap:${tokens.mobileGap};--dst--vgap-s:${tokens.mobileGap};--dst--vgap-l:${tokens.mobileGap}}}

/* Type */
#sbs-site .c-heading__title{letter-spacing:var(--sbs-title-tracking);line-height:var(--sbs-title-lh);text-wrap:balance}
#sbs-site .c-heading__pre{letter-spacing:var(--sbs-pretitle-ls)}
#sbs-site .c-block__title{font-size:calc(var(--dst--fs-h3) * .74)}
#sbs-site .sbs-stat-value{font-size:calc(var(--dst--fs-h1) * .52);color:var(--dst--primary-color2)}

/* Colour and surface */
#sbs-site .c-block{box-shadow:var(--sbs-card-shadow);border:var(--sbs-border-width) solid color-mix(in srgb,var(--dst--base-text-color) var(--sbs-border-alpha),transparent)}
#sbs-site .sbs-band-tint{background:color-mix(in srgb,var(--dst--primary-color2) var(--sbs-accent-tint),var(--dst--body-bg))}
#sbs-site .c-heading__pre{color:color-mix(in srgb,var(--dst--primary-color2) calc(55% + var(--sbs-accent-strength) * 45%),var(--dst--base-text-color))}
#sbs-site .dst-accordion__item,#sbs-site .dst-list[data-counter] .dst-list__item,#sbs-site .sbs-quote-card{border-color:color-mix(in srgb,var(--dst--base-text-color) var(--sbs-border-alpha),transparent)}
#sbs-site .dst-marquee{border-block:var(--sbs-border-width) solid color-mix(in srgb,var(--dst--base-text-color) var(--sbs-border-alpha),transparent)}

/* Imagery */
#sbs-site .ph,#sbs-site .c-block__media{border-radius:var(--dst--default-radius);overflow:hidden}
#sbs-site .sbs-feature-media{min-height:var(--sbs-media-min)}
#sbs-site .ph img,#sbs-site .c-bg__layer{filter:saturate(var(--sbs-media-saturate)) contrast(var(--sbs-media-contrast));transition:transform var(--sbs-motion-duration) var(--sbs-motion-ease),filter var(--sbs-motion-duration) var(--sbs-motion-ease)}
#sbs-site .sbs-hero{min-height:var(--sbs-hero-min)}
#sbs-site .sbs-hero.hero-media-split-right .c-bg,#sbs-site .sbs-hero.hero-media-split-left .c-bg{width:var(--sbs-hero-media-w)!important}

/* Movement */
#sbs-site .c-btn,#sbs-site .c-block,#sbs-site .dst-slider__arrows{transition-duration:var(--sbs-motion-duration);transition-timing-function:var(--sbs-motion-ease)}
#sbs-site .c-block:hover{transform:translateY(calc(-1 * var(--sbs-hover-lift)))}
#sbs-site .c-block:hover .ph img,#sbs-site .sbs-feature-media:hover img{transform:scale(var(--sbs-media-zoom))}
#sbs-site .dst-marquee__track{--dur:var(--sbs-marquee-dur);animation-duration:var(--sbs-marquee-dur)}
.has-inview-a #sbs-site [data-viewport-effect^="fade"]>*{transition-duration:var(--sbs-motion-duration);transition-timing-function:var(--sbs-motion-ease);transform:translate3d(0,var(--sbs-motion-distance),0) scale(var(--sbs-motion-scale))}
.has-inview-a #sbs-site [data-viewport-effect="fade-down"]>*{transform:translate3d(0,calc(-1 * var(--sbs-motion-distance)),0) scale(var(--sbs-motion-scale))}
.has-inview-a #sbs-site [data-viewport-effect="fade-left"]>*{transform:translate3d(var(--sbs-motion-distance),0,0) scale(var(--sbs-motion-scale))}
.has-inview-a #sbs-site [data-viewport-effect="fade-right"]>*{transform:translate3d(calc(-1 * var(--sbs-motion-distance)),0,0) scale(var(--sbs-motion-scale))}
.has-inview-a #sbs-site [data-viewport-effect].in-view>*{transform:none}
${[1, 2, 3, 4, 5, 6].map((index) => `.has-inview-a #sbs-site [data-viewport-effect] .dst-cards__item:nth-child(${index}),.has-inview-a #sbs-site [data-viewport-effect] .dst-list__item:nth-child(${index}){transition-delay:calc(var(--sbs-motion-stagger) * ${index - 1})}`).join('')}

/* Discrete bands. These exist so crossing a band is visible without measuring. */
#sbs-site[data-motion-level="still"] *,#sbs-site[data-motion-level="still"] *:before,#sbs-site[data-motion-level="still"] *:after{animation:none!important;transition:none!important}
#sbs-site[data-motion-level="still"] [data-viewport-effect]>*{opacity:1!important;transform:none!important;visibility:visible!important}
#sbs-site[data-motion-level="dynamic"] .dst-marquee__track{animation-timing-function:linear}
#sbs-site[data-expression-level="bold"] .c-heading__pre{display:inline-flex;align-items:center;gap:.9rem}
#sbs-site[data-expression-level="bold"] .c-heading__pre:before{content:"";width:calc(var(--sbs-accent-rule) * 6);height:var(--sbs-accent-rule);background:var(--dst--primary-color2);flex:0 0 auto}
#sbs-site[data-expression-level="bold"] .c-heading__title{font-weight:650}
#sbs-site[data-expression-level="restrained"] .c-heading__title{font-weight:500}
#sbs-site[data-accent-level="saturated"] .sbs-band-soft{background:color-mix(in srgb,var(--dst--primary-color2) 14%,var(--dst--body-bg))}
#sbs-site[data-accent-level="saturated"] .sbs-stat-value,#sbs-site[data-accent-level="strong"] .sbs-stat-value{color:var(--dst--primary-color2)}
#sbs-site[data-surface-level="flat"] .c-block{border-color:transparent;background:transparent;padding-inline:0}
#sbs-site[data-surface-level="raised"] .c-block{background:color-mix(in srgb,#fff var(--sbs-card-surface-mix),var(--dst--body-bg))}
#sbs-site[data-density-level="compact"] .dst-banner__container{padding-block:clamp(5rem,7vw,10rem)}
#sbs-site[data-density-level="spacious"] .dst-banner__container{padding-block:clamp(10rem,15vw,22rem)}

@media(prefers-reduced-motion:reduce){#sbs-site.ver{--sbs-motion-duration:0s;--sbs-motion-distance:0px;--sbs-motion-scale:1;--sbs-motion-stagger:0ms;--sbs-hover-lift:0px;--sbs-media-zoom:1}}
/* dials:${levels.density}/${levels.expression}/${levels.motion} */`;
}

/** Attributes the preview and export documents carry for the band rules. */
export function dialDocumentAttributes(design) {
  const dials = ensureDials({ ...(design || {}) });
  const levels = dialLevels(dials);
  return {
    'data-motion-level': levels.motion,
    'data-expression-level': levels.expression,
    'data-density-level': levels.density,
    'data-accent-level': levels.accent,
    'data-surface-level': levels.surface,
    'data-imagery-level': levels.imagery,
    'data-headline-level': levels.headline,
  };
}
