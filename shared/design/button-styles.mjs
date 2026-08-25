/**
 * Button styles.
 *
 * Ten complete button systems. A style is not a colour choice: it defines the
 * primary action, the secondary action and the text link together, including the
 * hover behaviour that makes them feel like one family.
 *
 * Constraints that shaped these:
 *
 * - They must render on the existing DST markup and nothing else. Every rule
 *   below targets `.c-btn`, `.c-btn__txt` and `.sbs-btn-arrow`, which is exactly
 *   what the registered `ds-blocks/c-btn` component emits. No style may require
 *   a new element, because a new element would not survive the WordPress import.
 * - They must read from the palette and dial tokens, never hard-coded colour, so
 *   a style keeps working after the archetype or the corner dial changes.
 * - Every hover effect must respect `prefers-reduced-motion` and keep a visible
 *   non-hover state, so the page is usable with motion switched off.
 */

export const DEFAULT_BUTTON_STYLE = 'solid-shift';

export const BUTTON_STYLES = Object.freeze([
  Object.freeze({
    id: 'solid-shift',
    label: 'Solid Shift',
    summary: 'The dependable one. A solid button that swaps to the dark tone and deepens its shadow on hover.',
    hover: 'Colour inverts and the shadow deepens',
    bestFor: 'Any page. Start here if you are not sure.',
  }),
  Object.freeze({
    id: 'sweep-fill',
    label: 'Sweep Fill',
    summary: 'The colour wipes across from the left as the cursor arrives.',
    hover: 'A fill sweeps in from the left edge',
    bestFor: 'Confident commercial pages that want the action to feel deliberate.',
  }),
  Object.freeze({
    id: 'offset-block',
    label: 'Offset Block',
    summary: 'A hard offset shadow behind a square button. On hover the button slides into its own shadow.',
    hover: 'The button slides into its shadow',
    bestFor: 'Editorial, architectural and design-led brands.',
  }),
  Object.freeze({
    id: 'pill-glow',
    label: 'Pill Glow',
    summary: 'Fully rounded with a soft coloured glow that blooms under the cursor.',
    hover: 'A soft glow blooms and the button grows a little in place',
    bestFor: 'Friendly, human, consumer and healthcare brands.',
  }),
  Object.freeze({
    id: 'magnetic-arrow',
    label: 'Magnetic Arrow',
    summary: 'A minimal button with a small brand dot that expands to flood the whole shape.',
    hover: 'A brand-coloured circle floods outward from the dot',
    bestFor: 'Modern technology, product and studio brands.',
  }),
  /* --- The second five. Different mechanics, not different colours. --- */
  Object.freeze({
    id: 'split-reveal',
    label: 'Split Reveal',
    summary: 'The fill arrives from the top and the bottom at once and closes in the middle.',
    hover: 'Two halves meet across the centre line',
    bestFor: 'Precise, engineered and editorial-technical brands.',
  }),
  Object.freeze({
    id: 'corner-cut',
    label: 'Corner Cut',
    summary: 'A notched corner with an accent wedge in the cut. On hover the notch crosses to the far corner.',
    hover: 'The cut corner travels diagonally across the button',
    bestFor: 'Architecture, industrial, motorsport and defence.',
  }),
  Object.freeze({
    id: 'neon-trace',
    label: 'Neon Trace',
    summary: 'A hairline that lights up and runs the perimeter, leaving a low glow behind it.',
    hover: 'A light traces the outline and settles into a glow',
    bestFor: 'Dark-ground product, gaming, fintech and AI brands.',
  }),
  Object.freeze({
    id: 'depth-press',
    label: 'Depth Press',
    summary: 'A soft, physically stacked button that compresses under the cursor like a real key.',
    hover: 'The button sinks into its own base',
    bestFor: 'Consumer apps, family services and anything that should feel tactile.',
  }),
  Object.freeze({
    id: 'ink-wipe',
    label: 'Ink Wipe',
    summary: 'A slanted block of colour rises diagonally through the button, like a brush pass.',
    hover: 'Ink sweeps up from the lower-left corner',
    bestFor: 'Culture, sport, hospitality and editorial brands with energy.',
  }),
]);

export const BUTTON_STYLE_IDS = Object.freeze(BUTTON_STYLES.map((style) => style.id));

const STYLE_BY_ID = new Map(BUTTON_STYLES.map((style) => [style.id, style]));

export function isButtonStyle(value) {
  return STYLE_BY_ID.has(String(value || ''));
}

export function buttonStyle(value) {
  return STYLE_BY_ID.get(String(value || '')) || STYLE_BY_ID.get(DEFAULT_BUTTON_STYLE);
}

export function normalizeButtonStyle(value) {
  return isButtonStyle(value) ? String(value) : DEFAULT_BUTTON_STYLE;
}

/**
 * Shared geometry every style inherits. `--sbs-btn-radius` is the corner dial's
 * value unless the style overrides it (a pill is a pill at any dial setting).
 */
const BASE = `
#sbs-site .c-btn{position:relative;isolation:isolate;overflow:hidden;border-radius:var(--sbs-btn-radius,var(--dst--default-radius));padding:var(--sbs-btn-pad,1.02em 1.8em);font-weight:var(--sbs-btn-weight,650);letter-spacing:var(--sbs-btn-ls,0);text-decoration:none;transition-property:transform,color,background-color,border-color,box-shadow,letter-spacing;transition-duration:var(--sbs-motion-duration);transition-timing-function:var(--sbs-motion-ease)}
#sbs-site .c-btn__txt,#sbs-site .sbs-btn-arrow{position:relative;z-index:2}
#sbs-site .sbs-btn-arrow{transition:transform var(--sbs-motion-duration) var(--sbs-motion-ease)}
#sbs-site .c-btn:focus-visible{outline:2px solid var(--dst--primary-color2);outline-offset:3px}
#sbs-site .c-btn.-link{overflow:visible;padding-inline:0;border:0;background:transparent}
`;

/**
 * One CSS block per style. Written out in full rather than generated from a
 * table: a hover effect is a designed thing, and the differences between these
 * ten are the point.
 */
const STYLE_CSS = Object.freeze({
  'solid-shift': `
#sbs-site .c-btn.-primary,#sbs-site .c-btn.-primary-inverted{border:1px solid transparent}
#sbs-site .c-btn.-primary:hover,#sbs-site .c-btn.-secondary:hover,#sbs-site .c-btn.-primary-inverted:hover,#sbs-site .c-btn.-secondary-inverted:hover{transform:none;box-shadow:0 calc(var(--sbs-hover-lift) + 6px) calc(var(--sbs-hover-lift) * 3 + 18px) color-mix(in srgb,var(--dst--primary-color3) 30%,transparent)}
#sbs-site .c-btn.-secondary{border-width:var(--sbs-border-width)}
#sbs-site .c-btn.-link{border-bottom:2px solid color-mix(in srgb,currentColor 35%,transparent);text-decoration:none;padding-bottom:.2em}
#sbs-site .c-btn.-link:hover{border-bottom-color:currentColor;color:var(--dst--primary-color2)}
#sbs-site .c-btn:hover .sbs-btn-arrow{transform:translate(2px,-2px)}
`,
  'sweep-fill': `
#sbs-site .c-btn:not(.-link):before{content:"";position:absolute;inset:0;z-index:1;background:var(--sbs-btn-sweep,var(--dst--primary-color3));transform:scaleX(0);transform-origin:left center;transition:transform var(--sbs-motion-duration) var(--sbs-motion-ease)}
#sbs-site .c-btn:not(.-link):hover:before{transform:scaleX(1)}
#sbs-site .c-btn.-primary{--sbs-btn-sweep:var(--dst--primary-color3)}
#sbs-site .c-btn.-primary:hover{color:var(--sbs-on-ink,#fff);background:var(--dst--primary-color2)}
#sbs-site .c-btn.-secondary{--sbs-btn-sweep:var(--dst--base-text-color);border-width:var(--sbs-border-width)}
#sbs-site .c-btn.-secondary:hover{color:var(--dst--body-bg)}
#sbs-site .c-btn.-primary-inverted{--sbs-btn-sweep:var(--dst--primary-color2)}
#sbs-site .c-btn.-primary-inverted:hover{color:var(--sbs-on-accent,#fff)}
#sbs-site .c-btn.-secondary-inverted{--sbs-btn-sweep:#fff}
#sbs-site .c-btn.-secondary-inverted:hover{color:var(--sbs-on-white,var(--dst--primary-color3))}
#sbs-site .c-btn.-link{padding-bottom:.28em}
#sbs-site .c-btn.-link:after{content:"";position:absolute;left:0;right:0;bottom:0;height:2px;background:currentColor;transform:scaleX(0);transform-origin:left center;transition:transform var(--sbs-motion-duration) var(--sbs-motion-ease)}
#sbs-site .c-btn.-link:hover:after{transform:scaleX(1)}
#sbs-site .c-btn:hover .sbs-btn-arrow{transform:translateX(3px)}
`,
  'offset-block': `
#sbs-site .c-btn:not(.-link){--sbs-btn-radius:0px;--sbs-btn-ls:.02em;overflow:visible;border:var(--sbs-border-width) solid currentColor;box-shadow:var(--sbs-btn-offset,6px) var(--sbs-btn-offset,6px) 0 var(--sbs-btn-block,var(--dst--base-text-color))}
#sbs-site .c-btn.-primary{border-color:var(--dst--primary-color3);--sbs-btn-block:var(--dst--primary-color3)}
#sbs-site .c-btn.-secondary{--sbs-btn-block:var(--dst--primary-color2)}
#sbs-site .c-btn.-primary-inverted,#sbs-site .c-btn.-secondary-inverted{--sbs-btn-block:var(--dst--primary-color2)}
#sbs-site .c-btn:not(.-link):hover{transform:translate(var(--sbs-btn-offset,6px),var(--sbs-btn-offset,6px));box-shadow:0 0 0 var(--sbs-btn-block,var(--dst--base-text-color))}
#sbs-site .c-btn:not(.-link):active{transform:translate(var(--sbs-btn-offset,6px),var(--sbs-btn-offset,6px))}
#sbs-site .c-btn.-link{--sbs-btn-ls:.02em;border-bottom:2px solid currentColor;padding-bottom:.18em}
#sbs-site .c-btn.-link:hover{transform:translate(3px,3px)}
#sbs-site .c-btn:hover .sbs-btn-arrow{transform:none}
`,
  'pill-glow': `
#sbs-site .c-btn:not(.-link){--sbs-btn-radius:999px;--sbs-btn-pad:1.05em 2.05em;overflow:visible}
#sbs-site .c-btn.-primary{box-shadow:0 6px 18px color-mix(in srgb,var(--dst--primary-color2) 26%,transparent)}
#sbs-site .c-btn.-primary:hover{transform:scale(1.03);box-shadow:0 calc(var(--sbs-hover-lift) + 10px) calc(var(--sbs-hover-lift) * 3 + 26px) color-mix(in srgb,var(--dst--primary-color2) 46%,transparent)}
#sbs-site .c-btn.-secondary{background:color-mix(in srgb,var(--dst--primary-color2) 9%,transparent);border-color:transparent}
#sbs-site .c-btn.-secondary:hover{background:color-mix(in srgb,var(--dst--primary-color2) 20%,transparent);color:var(--dst--base-text-color);border-color:transparent;transform:scale(1.03)}
#sbs-site .c-btn.-primary-inverted:hover,#sbs-site .c-btn.-secondary-inverted:hover{transform:scale(1.03);box-shadow:0 calc(var(--sbs-hover-lift) + 10px) calc(var(--sbs-hover-lift) * 3 + 26px) rgba(255,255,255,.28)}
#sbs-site .c-btn.-link{padding:.42em .95em;margin-inline:-.95em;border-radius:999px}
#sbs-site .c-btn.-link:before{content:"";position:absolute;inset:0;z-index:0;border-radius:999px;background:color-mix(in srgb,var(--dst--primary-color2) 14%,transparent);transform:scale(.6);opacity:0;transition:transform var(--sbs-motion-duration) var(--sbs-motion-ease),opacity var(--sbs-motion-duration) var(--sbs-motion-ease)}
#sbs-site .c-btn.-link:hover:before{transform:scale(1);opacity:1}
#sbs-site .c-btn:hover .sbs-btn-arrow{transform:translateX(4px)}
`,
  'magnetic-arrow': `
#sbs-site .c-btn:not(.-link){--sbs-btn-pad:1em 1.75em 1em 2.95em;--sbs-btn-weight:600;background:transparent;border:var(--sbs-border-width) solid color-mix(in srgb,currentColor 28%,transparent)}
#sbs-site .c-btn:not(.-link):before{content:"";position:absolute;inset:0;z-index:1;background:var(--sbs-btn-flood,var(--dst--primary-color2));clip-path:circle(.42em at 1.62em 50%);transition:clip-path var(--sbs-motion-duration) var(--sbs-motion-ease)}
#sbs-site .c-btn:not(.-link):hover:before{clip-path:circle(150% at 1.62em 50%)}
#sbs-site .c-btn.-primary{color:var(--dst--base-text-color)}
#sbs-site .c-btn.-primary:hover{color:var(--sbs-on-accent,#fff);background:transparent;border-color:var(--dst--primary-color2)}
#sbs-site .c-btn.-secondary{--sbs-btn-flood:var(--dst--primary-color3)}
#sbs-site .c-btn.-secondary:hover{color:var(--sbs-on-ink,#fff);background:transparent;border-color:var(--dst--primary-color3)}
#sbs-site .c-btn.-primary-inverted,#sbs-site .c-btn.-secondary-inverted{color:#fff;--sbs-btn-flood:#fff}
#sbs-site .c-btn.-primary-inverted:hover,#sbs-site .c-btn.-secondary-inverted:hover{color:var(--sbs-on-white,var(--dst--primary-color3));background:transparent}
#sbs-site .c-btn.-link{--sbs-btn-weight:600;padding-bottom:.3em}
#sbs-site .c-btn.-link:after{content:"";position:absolute;left:50%;right:50%;bottom:0;height:2px;background:var(--dst--primary-color2);transition:left var(--sbs-motion-duration) var(--sbs-motion-ease),right var(--sbs-motion-duration) var(--sbs-motion-ease)}
#sbs-site .c-btn.-link:hover{letter-spacing:.02em}
#sbs-site .c-btn.-link:hover:after{left:0;right:0}
#sbs-site .c-btn:hover .sbs-btn-arrow{transform:translate(4px,-4px)}
`,
  /* Two halves, one transform each. The seam lands on the text's centre line,
     which is why the label needs the higher stacking context BASE gives it. */
  'split-reveal': `
#sbs-site .c-btn:not(.-link){--sbs-btn-radius:0px;border:var(--sbs-border-width) solid currentColor}
#sbs-site .c-btn:not(.-link):before,#sbs-site .c-btn:not(.-link):after{content:"";position:absolute;left:0;right:0;height:50%;z-index:1;background:var(--sbs-btn-split,var(--dst--primary-color3));transition:transform var(--sbs-motion-duration) var(--sbs-motion-ease)}
#sbs-site .c-btn:not(.-link):before{top:0;transform:translateY(-101%)}
#sbs-site .c-btn:not(.-link):after{bottom:0;transform:translateY(101%)}
#sbs-site .c-btn:not(.-link):hover:before,#sbs-site .c-btn:not(.-link):hover:after{transform:translateY(0)}
#sbs-site .c-btn.-primary{--sbs-btn-split:var(--dst--primary-color3);border-color:var(--dst--primary-color2)}
#sbs-site .c-btn.-primary:hover{color:var(--sbs-on-ink,#fff);background:var(--dst--primary-color2);border-color:var(--dst--primary-color3)}
#sbs-site .c-btn.-secondary{--sbs-btn-split:var(--dst--base-text-color)}
#sbs-site .c-btn.-secondary:hover{color:var(--dst--body-bg)}
#sbs-site .c-btn.-primary-inverted{--sbs-btn-split:var(--dst--primary-color2)}
#sbs-site .c-btn.-primary-inverted:hover{color:var(--sbs-on-accent,#fff)}
#sbs-site .c-btn.-secondary-inverted{--sbs-btn-split:#fff}
#sbs-site .c-btn.-secondary-inverted:hover{color:var(--sbs-on-white,var(--dst--primary-color3))}
#sbs-site .c-btn.-link{padding-bottom:.28em;border-bottom:2px solid color-mix(in srgb,currentColor 28%,transparent)}
#sbs-site .c-btn.-link:hover{border-bottom-color:currentColor;color:var(--dst--primary-color2)}
#sbs-site .c-btn:hover .sbs-btn-arrow{transform:translateY(-2px)}
`,
  /* The notch is a clip-path corner; hover swaps which corner is cut, so the
     wedge appears to travel across the button rather than merely toggling. */
  'corner-cut': `
#sbs-site .c-btn:not(.-link){--sbs-btn-radius:0px;--sbs-btn-cut:1.1em;--sbs-btn-ls:.04em;--sbs-btn-pad:1em 1.9em;text-transform:uppercase;font-size:.92em;border:var(--sbs-border-width) solid currentColor;clip-path:polygon(var(--sbs-btn-cut) 0,100% 0,100% calc(100% - var(--sbs-btn-cut)),calc(100% - var(--sbs-btn-cut)) 100%,0 100%,0 var(--sbs-btn-cut));transition-property:transform,color,background-color,border-color,clip-path,letter-spacing}
#sbs-site .c-btn:not(.-link):before{content:"";position:absolute;inset:0;z-index:1;background:var(--sbs-btn-wedge,var(--dst--primary-color2));transform:translateX(-101%);transition:transform var(--sbs-motion-duration) var(--sbs-motion-ease)}
#sbs-site .c-btn:not(.-link):hover{clip-path:polygon(0 0,calc(100% - var(--sbs-btn-cut)) 0,100% var(--sbs-btn-cut),100% 100%,var(--sbs-btn-cut) 100%,0 calc(100% - var(--sbs-btn-cut)))}
#sbs-site .c-btn:not(.-link):hover:before{transform:translateX(0)}
#sbs-site .c-btn.-primary{color:var(--sbs-on-ink,#fff);background:var(--dst--primary-color3);border-color:var(--dst--primary-color3);--sbs-btn-wedge:var(--dst--primary-color2)}
#sbs-site .c-btn.-primary:hover{color:var(--sbs-on-accent,#fff);background:var(--dst--primary-color3);border-color:var(--dst--primary-color2)}
#sbs-site .c-btn.-secondary{--sbs-btn-wedge:var(--dst--base-text-color)}
#sbs-site .c-btn.-secondary:hover{color:var(--dst--body-bg)}
#sbs-site .c-btn.-primary-inverted{--sbs-btn-wedge:var(--dst--primary-color2)}
#sbs-site .c-btn.-primary-inverted:hover{color:var(--sbs-on-accent,#fff)}
#sbs-site .c-btn.-secondary-inverted{--sbs-btn-wedge:#fff}
#sbs-site .c-btn.-secondary-inverted:hover{color:var(--sbs-on-white,var(--dst--primary-color3))}
#sbs-site .c-btn.-link{--sbs-btn-ls:.04em;text-transform:uppercase;font-size:.92em;padding-bottom:.26em;border-bottom:2px solid currentColor}
#sbs-site .c-btn.-link:hover{color:var(--dst--primary-color2)}
#sbs-site .c-btn:hover .sbs-btn-arrow{transform:translate(3px,-3px)}
`,
  /* A rotating conic gradient masked to the border box: the light runs the
     perimeter rather than the whole shape lighting up at once. */
  'neon-trace': `
@property --sbs-trace{syntax:"<angle>";inherits:false;initial-value:0deg}
#sbs-site .c-btn:not(.-link){--sbs-btn-radius:var(--dst--default-radius);--sbs-glow:var(--dst--primary-color2);overflow:visible;background:transparent;border:var(--sbs-border-width) solid color-mix(in srgb,var(--sbs-glow) 34%,transparent)}
#sbs-site .c-btn:not(.-link):before{content:"";position:absolute;inset:0;z-index:0;border-radius:inherit;padding:1px;background:conic-gradient(from var(--sbs-trace),transparent 0deg,var(--sbs-glow) 60deg,transparent 130deg,transparent 360deg);-webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);mask-composite:exclude;opacity:0;transition:opacity var(--sbs-motion-duration) var(--sbs-motion-ease)}
#sbs-site .c-btn:not(.-link):hover{background:color-mix(in srgb,var(--sbs-glow) 12%,transparent);border-color:color-mix(in srgb,var(--sbs-glow) 62%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,var(--sbs-glow) 22%,transparent),0 8px 30px -8px color-mix(in srgb,var(--sbs-glow) 60%,transparent)}
#sbs-site .c-btn:not(.-link):hover:before{opacity:1;animation:sbs-neon-trace 1.6s linear infinite}
@keyframes sbs-neon-trace{to{--sbs-trace:360deg}}
#sbs-site .c-btn.-primary{color:var(--dst--base-text-color)}
#sbs-site .c-btn.-primary:hover{color:var(--dst--base-text-color)}
#sbs-site .c-btn.-secondary{--sbs-glow:var(--dst--primary-color3)}
#sbs-site .c-btn.-primary-inverted,#sbs-site .c-btn.-secondary-inverted{color:#fff;--sbs-glow:#fff}
#sbs-site .c-btn.-primary-inverted:hover,#sbs-site .c-btn.-secondary-inverted:hover{color:#fff}
#sbs-site .c-btn.-link{padding-bottom:.3em}
#sbs-site .c-btn.-link:after{content:"";position:absolute;left:0;right:0;bottom:0;height:1px;background:var(--dst--primary-color2);box-shadow:0 0 8px var(--dst--primary-color2);opacity:0;transition:opacity var(--sbs-motion-duration) var(--sbs-motion-ease)}
#sbs-site .c-btn.-link:hover:after{opacity:1}
#sbs-site .c-btn:hover .sbs-btn-arrow{transform:translateX(3px)}
`,
  /* A stack of hard shadows is the "base" the key sits on; pressing shortens the
     stack by exactly the distance the button travels, so nothing detaches. */
  'depth-press': `
#sbs-site .c-btn:not(.-link){--sbs-btn-radius:calc(var(--dst--default-radius) + 8px);--sbs-btn-lift:5px;--sbs-btn-base:var(--dst--primary-color3);--sbs-btn-pad:1em 1.9em;border:0;box-shadow:0 var(--sbs-btn-lift) 0 var(--sbs-btn-base),0 calc(var(--sbs-btn-lift) + 7px) 18px -6px color-mix(in srgb,var(--sbs-btn-base) 55%,transparent)}
#sbs-site .c-btn:not(.-link):hover{transform:translateY(calc(var(--sbs-btn-lift) - 2px));box-shadow:0 2px 0 var(--sbs-btn-base),0 4px 10px -6px color-mix(in srgb,var(--sbs-btn-base) 45%,transparent)}
#sbs-site .c-btn:not(.-link):active{transform:translateY(var(--sbs-btn-lift));box-shadow:0 0 0 var(--sbs-btn-base)}
#sbs-site .c-btn.-primary{--sbs-btn-base:color-mix(in srgb,var(--dst--primary-color2) 45%,var(--dst--primary-color3))}
#sbs-site .c-btn.-secondary{background:var(--dst--body-bg);color:var(--dst--base-text-color);--sbs-btn-base:color-mix(in srgb,var(--dst--base-text-color) 26%,transparent)}
#sbs-site .c-btn.-secondary:hover{background:var(--dst--body-bg);color:var(--dst--base-text-color)}
#sbs-site .c-btn.-primary-inverted{--sbs-btn-base:rgba(0,0,0,.45)}
#sbs-site .c-btn.-secondary-inverted{background:rgba(255,255,255,.1);--sbs-btn-base:rgba(255,255,255,.3)}
#sbs-site .c-btn.-secondary-inverted:hover{background:rgba(255,255,255,.16);color:#fff}
#sbs-site .c-btn.-link{padding:.4em .2em;border-bottom:2px solid color-mix(in srgb,currentColor 32%,transparent)}
#sbs-site .c-btn.-link:hover{transform:translateY(2px);border-bottom-color:currentColor}
#sbs-site .c-btn:hover .sbs-btn-arrow{transform:translateY(2px)}
`,
  /* One skewed block, over-sized so the slant never exposes a corner, sweeping
     bottom-left to top-right. The skew is the whole idea — a straight wipe is
     already Sweep Fill. */
  'ink-wipe': `
#sbs-site .c-btn:not(.-link){--sbs-btn-radius:0px;--sbs-btn-ink:var(--dst--primary-color3);border:var(--sbs-border-width) solid currentColor}
#sbs-site .c-btn:not(.-link):before{content:"";position:absolute;left:-30%;right:-30%;top:-20%;bottom:-20%;z-index:1;background:var(--sbs-btn-ink);transform:translate(-118%,60%) skewX(-18deg);transition:transform var(--sbs-motion-duration) var(--sbs-motion-ease)}
#sbs-site .c-btn:not(.-link):hover:before{transform:translate(0,0) skewX(-18deg)}
#sbs-site .c-btn.-primary{--sbs-btn-ink:var(--dst--primary-color3)}
#sbs-site .c-btn.-primary:hover{color:var(--sbs-on-ink,#fff);background:var(--dst--primary-color2);border-color:var(--dst--primary-color3)}
#sbs-site .c-btn.-secondary{--sbs-btn-ink:var(--dst--primary-color2)}
#sbs-site .c-btn.-secondary:hover{color:var(--sbs-on-accent,#fff);border-color:var(--dst--primary-color2)}
#sbs-site .c-btn.-primary-inverted{--sbs-btn-ink:var(--dst--primary-color2)}
#sbs-site .c-btn.-primary-inverted:hover{color:var(--sbs-on-accent,#fff)}
#sbs-site .c-btn.-secondary-inverted{--sbs-btn-ink:#fff}
#sbs-site .c-btn.-secondary-inverted:hover{color:var(--sbs-on-white,var(--dst--primary-color3))}
#sbs-site .c-btn.-link{padding-bottom:.26em;overflow:hidden}
#sbs-site .c-btn.-link:after{content:"";position:absolute;left:0;right:0;bottom:0;height:3px;background:var(--dst--primary-color2);transform:translateX(-101%) skewX(-18deg);transition:transform var(--sbs-motion-duration) var(--sbs-motion-ease)}
#sbs-site .c-btn.-link:hover:after{transform:translateX(0) skewX(-18deg)}
#sbs-site .c-btn:hover .sbs-btn-arrow{transform:translate(3px,-3px)}
`,
});

const REDUCED_MOTION = `
@media(prefers-reduced-motion:reduce){
#sbs-site .c-btn,#sbs-site .c-btn:before,#sbs-site .c-btn:after,#sbs-site .sbs-btn-arrow{transition:none!important;animation:none!important}
#sbs-site .c-btn:hover{transform:none!important}
#sbs-site .c-btn:not(.-link):hover:before,#sbs-site .c-btn:not(.-link):hover:after{transform:none;clip-path:none;opacity:1}
#sbs-site .c-btn.-link:hover:after{transform:none;left:0;right:0}
}
`;

/** The complete CSS for one button style, scoped to the rendered page. */
export function buttonStyleCss(styleId) {
  const id = normalizeButtonStyle(styleId);
  return `${BASE}${STYLE_CSS[id]}${REDUCED_MOTION}/* button-style:${id} */`;
}

/**
 * A self-contained preview of the three button roles for the editor panel.
 * It reuses the real class names and the real CSS so the swatch cannot drift
 * from what the page will actually render.
 */
export function buttonStylePreviewMarkup(styleId, { primary = 'Book a call', secondary = 'See pricing', link = 'Read the guide' } = {}) {
  const id = normalizeButtonStyle(styleId);
  return `<div class="btn-style-preview" data-button-style="${id}">
    <span class="c-btn -primary" aria-hidden="true"><span class="c-btn__txt">${primary}</span><span class="sbs-btn-arrow">&#8599;</span></span>
    <span class="c-btn -secondary" aria-hidden="true"><span class="c-btn__txt">${secondary}</span></span>
    <span class="c-btn -link" aria-hidden="true"><span class="c-btn__txt">${link}</span><span class="sbs-btn-arrow">&#8594;</span></span>
  </div>`;
}

/**
 * The editor swatch has no `dst-shared.css`, so the role colours it needs are
 * declared here rather than duplicated in the editor stylesheet. The caller
 * supplies the palette and dial tokens as inline custom properties.
 */
const EDITOR_BASE = `
.btn-style-preview{display:flex;flex-wrap:wrap;align-items:center;gap:10px;font-size:11px;--sbs-on-accent:#fff;--sbs-on-ink:#fff}
.btn-style-preview .c-btn{display:inline-flex;align-items:center;justify-content:center;gap:.55em;font-family:inherit;font-size:1em;line-height:1;cursor:default;text-decoration:none;color:var(--dst--base-text-color,#181a1d);white-space:nowrap}
.btn-style-preview .c-btn.-primary{color:var(--sbs-on-accent,#fff);background:var(--dst--primary-color2,#ed5b38);border-color:var(--dst--primary-color2,#ed5b38)}
.btn-style-preview .c-btn.-primary:hover{color:var(--sbs-on-ink,#fff);background:var(--dst--primary-color3,#181a1d)}
.btn-style-preview .c-btn.-secondary{color:var(--dst--base-text-color,#181a1d);background:transparent;border-color:var(--dst--base-text-color,#181a1d)}
.btn-style-preview .c-btn.-secondary:hover{color:var(--sbs-on-ink,var(--dst--body-bg,#fff));background:var(--dst--base-text-color,#181a1d)}
.btn-style-preview .c-btn.-link{background:transparent;border:0;color:var(--dst--primary-color2,#ed5b38)}
`;

/**
 * The same rules, re-scoped for the editor chrome so the swatches in Step 02
 * behave exactly like the live page. `#sbs-site` is rewritten to the swatch
 * container selector rather than duplicated by hand.
 */
export function buttonStyleEditorCss() {
  return EDITOR_BASE + BUTTON_STYLES.map((style) => {
    const scope = `.btn-style-preview[data-button-style="${style.id}"]`;
    return `${BASE}${STYLE_CSS[style.id]}`.replace(/#sbs-site\b/g, scope);
  }).join('\n') + REDUCED_MOTION.replace(/#sbs-site\b/g, '.btn-style-preview');
}
