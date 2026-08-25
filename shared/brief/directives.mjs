import { DIAL_KEYS } from '../design/dials.mjs';
import { findFontMentions, fontByName } from '../design/fonts.mjs';
import { paletteFromColours } from '../design/palette.mjs';

/**
 * Explicit design instructions in a brief.
 *
 * A brief is mostly description — what the business does, who it is for — and
 * the design system is free to interpret that. But some of it is not
 * description at all. "Our brand colour is #0B3D2E", "use Fraunces for the
 * headings", "we want big typography and lots of white space" are instructions,
 * and a tool that returns three concepts ignoring them has not read the brief.
 *
 * So instructions are extracted here, deterministically, and applied *on top of*
 * whatever the archetype and the quick style produced — for every concept, not
 * just one. Three options are three interpretations of the same constraints; a
 * stated colour is a constraint, not an axis to vary.
 *
 * The parser is deliberately literal. It only fires on wording that can only
 * mean the design instruction it maps to, because a false positive here silently
 * overrides a designed decision, which is far worse than missing a hint.
 */

const HEX = /#[0-9a-f]{3}(?:[0-9a-f]{3})?\b/gi;

/** Colour words a brief actually uses, with the hex a designer would reach for. */
const COLOUR_WORDS = Object.freeze([
  ['midnight blue', '#0B1F3A'], ['navy', '#0A2540'], ['royal blue', '#1F4FD8'], ['sky blue', '#3FA9F5'],
  ['teal', '#0E6E6E'], ['turquoise', '#12A5A5'], ['forest green', '#14452F'], ['olive', '#5A6B3B'],
  ['emerald', '#0F7B4F'], ['sage', '#8AA08A'], ['mint', '#9FD8C4'], ['lime', '#8CC63F'],
  ['burnt orange', '#C0522A'], ['terracotta', '#B75C3C'], ['coral', '#F2705B'], ['peach', '#F5C4A8'],
  ['mustard', '#D2A017'], ['gold', '#C9A227'], ['amber', '#E08A16'], ['yellow', '#F2C230'],
  ['burgundy', '#6B1F32'], ['maroon', '#6B1F1F'], ['crimson', '#B31232'], ['scarlet', '#D22B1E'],
  ['blush', '#F2D5D1'], ['pink', '#E36A9A'], ['magenta', '#C0246E'], ['purple', '#5B2A86'],
  ['lavender', '#B9A7D6'], ['charcoal', '#2A2D31'], ['graphite', '#33373C'], ['slate', '#4A5259'],
  ['stone', '#D9D4CA'], ['sand', '#E4D9C6'], ['cream', '#F7F2E7'], ['ivory', '#FAF6EC'],
  ['off white', '#F6F4EF'], ['black', '#111214'], ['white', '#FFFFFF'],
  // The plain words come last so "forest green" is not shortened to "green".
  ['blue', '#1B4F9C'], ['green', '#1F6F43'], ['orange', '#E2622A'], ['red', '#C22B26'], ['grey', '#6C7076'], ['gray', '#6C7076'],
]);

/** Which palette role a colour was named for, read from the words around it. */
const ROLE_CUES = Object.freeze([
  ['bg', ['background', 'canvas', 'page colour', 'page color', 'backdrop', 'base colour', 'base color']],
  ['ink', ['text colour', 'text color', 'body text', 'copy colour', 'copy color', 'type colour', 'type color', 'ink']],
  ['dark', ['dark band', 'dark section', 'dark tone', 'footer colour', 'footer color', 'inverted']],
  ['soft', ['border', 'divider', 'supporting colour', 'supporting color', 'soft tone', 'muted tone']],
  ['accent', ['brand colour', 'brand color', 'accent', 'primary colour', 'primary color', 'brand is', 'brand colours are', 'brand colors are', 'highlight']],
]);

/**
 * Instructions about *how much* rather than *what colour*.
 *
 * Each entry moves one dial to a stated value. The value is a position, not a
 * nudge: a brief that says "huge headlines" is not asking for slightly larger
 * than whatever the quick style chose.
 */
const DIAL_CUES = Object.freeze([
  { dial: 'headline', value: 92, note: 'Big typography', terms: ['big typography', 'large typography', 'huge type', 'huge headlines', 'big headlines', 'large headlines', 'big type', 'oversized type', 'oversized headlines', 'giant headlines', 'massive headlines', 'statement typography', 'typographic statement'] },
  { dial: 'headline', value: 22, note: 'Modest typography', terms: ['small typography', 'modest headlines', 'small headlines', 'understated type', 'quiet typography', 'restrained typography'] },
  { dial: 'density', value: 16, note: 'Generous space', terms: ['lots of white space', 'lots of whitespace', 'plenty of white space', 'plenty of whitespace', 'generous space', 'generous spacing', 'airy', 'spacious', 'breathing room', 'lots of space'] },
  { dial: 'density', value: 84, note: 'Compact layout', terms: ['compact', 'dense', 'information dense', 'tight layout', 'efficient layout', 'no wasted space'] },
  { dial: 'motion', value: 0, note: 'No movement', terms: ['no animation', 'no animations', 'without animation', 'no motion', 'static page', 'no movement'] },
  { dial: 'motion', value: 84, note: 'Lots of movement', terms: ['lots of animation', 'animated', 'plenty of motion', 'dynamic movement', 'lively motion', 'motion heavy', 'lots of movement'] },
  { dial: 'corner', value: 0, note: 'Square corners', terms: ['square corners', 'sharp corners', 'no rounded corners', 'hard edges', 'sharp edges'] },
  { dial: 'corner', value: 88, note: 'Rounded corners', terms: ['rounded corners', 'soft corners', 'pill shaped', 'pill-shaped', 'very rounded', 'friendly rounded'] },
  { dial: 'imagery', value: 90, note: 'Image led', terms: ['image led', 'image-led', 'photography led', 'photography-led', 'photo led', 'picture led', 'imagery heavy', 'big imagery', 'full bleed imagery', 'full-bleed imagery', 'lots of photography', 'visual first'] },
  { dial: 'imagery', value: 18, note: 'Few images', terms: ['no photography', 'no images', 'text only', 'text-only', 'minimal imagery', 'few images', 'without photography'] },
  { dial: 'accent', value: 88, note: 'Bold colour', terms: ['bold colour', 'bold color', 'colourful', 'colorful', 'lots of colour', 'lots of color', 'vibrant colour', 'vibrant color', 'saturated'] },
  { dial: 'accent', value: 14, note: 'Restrained colour', terms: ['monochrome', 'black and white', 'minimal colour', 'minimal color', 'muted palette', 'restrained colour', 'restrained color', 'almost no colour', 'almost no color'] },
  { dial: 'surface', value: 86, note: 'Defined surfaces', terms: ['cards with borders', 'defined edges', 'bordered cards', 'strong borders', 'boxed'] },
  { dial: 'surface', value: 12, note: 'Flat surfaces', terms: ['flat design', 'no borders', 'borderless', 'no shadows', 'no cards'] },
  { dial: 'measure', value: 82, note: 'Wide measure', terms: ['wide layout', 'full width', 'full-width', 'edge to edge', 'edge-to-edge'] },
  { dial: 'measure', value: 20, note: 'Narrow measure', terms: ['narrow layout', 'narrow column', 'centred column', 'centered column', 'contained layout'] },
  { dial: 'expressiveness', value: 88, note: 'Bold character', terms: ['bold and expressive', 'make it bold', 'striking', 'dramatic', 'high impact', 'high-impact'] },
  { dial: 'expressiveness', value: 18, note: 'Restrained character', terms: ['understated', 'conservative design', 'restrained', 'sober', 'no gimmicks', 'plain and simple'] },
]);

function corpus(text) {
  return ` ${String(text || '').toLowerCase().replace(/[‐-―]/g, '-').replace(/\s+/g, ' ')} `;
}

function normaliseHex(value) {
  const hex = String(value).toLowerCase();
  if (hex.length === 4) return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  return hex;
}

/**
 * The role named nearest a colour, on either side.
 *
 * Both orders are idiomatic — "the background should be cream" and "a burnt
 * orange accent" — so looking only backwards attaches half the colours in a
 * brief to the wrong role. Whichever cue is closest wins.
 */
function roleNear(haystack, at, length = 0) {
  // Clause boundaries are the whole trick. "The background should be cream and
  // the text colour charcoal" names two roles, and without cutting at the
  // conjunction the nearest-cue rule hands both colours to whichever role is
  // written closest — which is the wrong one exactly half the time.
  const boundary = /[,.;:—]|\band\b|\bwith\b/g;
  const trimBefore = (text) => {
    let cut = 0;
    for (const match of text.matchAll(boundary)) cut = match.index + match[0].length;
    return text.slice(cut);
  };
  const trimAfter = (text) => {
    const match = boundary.exec(text);
    boundary.lastIndex = 0;
    return match ? text.slice(0, match.index) : text;
  };
  const before = trimBefore(haystack.slice(Math.max(0, at - 64), at));
  const after = trimAfter(haystack.slice(at + length, at + length + 32));
  let best = null;
  const consider = (role, distance) => {
    if (distance < 0) return;
    if (!best || distance < best.distance) best = { role, distance };
  };
  for (const [role, cues] of ROLE_CUES) {
    for (const cue of cues) {
      const behind = before.lastIndexOf(cue);
      if (behind >= 0) consider(role, before.length - behind - cue.length);
      const ahead = after.indexOf(cue);
      if (ahead >= 0) consider(role, ahead);
    }
  }
  return best ? best.role : '';
}

/**
 * Colours the brief actually stated, keyed by palette role.
 *
 * Order matters and is deliberate: a colour with a role word beside it goes to
 * that role, and anything left over is the brand colour — which is what an
 * unqualified "our colour is teal" means every time.
 */
/**
 * Phrases that contain a colour word and are not about colour.
 *
 * "Lots of white space" is the common one, and reading it as "the background is
 * white" would repaint a page on the strength of a spacing instruction.
 */
const NOT_COLOURS = Object.freeze(['white space', 'whitespace', 'black and white', 'white label', 'white-label', 'blue chip', 'blue-chip', 'green field', 'greenfield', 'red flag', 'red tape']);

function readColours(text) {
  let haystack = corpus(text);
  for (const phrase of NOT_COLOURS) haystack = haystack.split(phrase).join(' '.repeat(phrase.length));
  const stated = [];

  for (const match of haystack.matchAll(HEX)) {
    stated.push({ hex: normaliseHex(match[0]), at: match.index, role: roleNear(haystack, match.index, match[0].length) });
  }

  for (const [word, hex] of COLOUR_WORDS) {
    // A brief is prose: the colour is as likely to be followed by a full stop or
    // a comma as by a space, so this matches on word boundaries rather than on
    // padding.
    const match = new RegExp(`\\b${word.replace(/\s+/g, '\\s+')}\\b`).exec(haystack);
    if (!match) continue;
    stated.push({ hex, at: match.index, role: roleNear(haystack, match.index, match[0].length) });
    // Blank the span so a compound name is not counted twice: "midnight blue"
    // must not also register as "blue" and claim a second palette role.
    haystack = `${haystack.slice(0, match.index)}${' '.repeat(match[0].length)}${haystack.slice(match.index + match[0].length)}`;
  }

  /*
   * Word order decides nothing here any more.
   *
   * The old rule was "first unqualified colour is the accent, second is the dark
   * band". That reads "our brand is teal and charcoal" correctly and destroys
   * "green and white": white became the inverted ground, so every dark band on
   * the page turned into white type on white. `paletteFromColours` reads the
   * colours themselves — a near-white can only be a canvas — so the sentence no
   * longer has to be written in the order the parser happened to expect.
   */
  return paletteFromColours(stated.sort((a, b) => a.at - b.at));
}

/**
 * Typefaces the brief named.
 *
 * "X for headings, Y for body" is read positionally: the family mentioned next
 * to the heading word is the display face. With one family named and no role
 * word, it is the display face — that is the one a brand is usually specific
 * about.
 */
function readFonts(text) {
  const haystack = corpus(text);
  const mentions = findFontMentions(text);
  if (!mentions.length) return {};
  const out = {};
  const roleFor = (at) => {
    const window = haystack.slice(Math.max(0, at - 48), at + 48);
    if (/(heading|headline|display|title)/.test(window)) return 'fontDisplay';
    if (/(body|paragraph|copy text|running text|body copy)/.test(window)) return 'fontBody';
    return '';
  };
  for (const mention of mentions) {
    const role = roleFor(mention.at);
    if (role && !out[role]) out[role] = mention.name;
  }
  if (!out.fontDisplay && !out.fontBody) out.fontDisplay = mentions[0].name;
  if (!out.fontBody && mentions.length > 1) {
    const spare = mentions.find((mention) => mention.name !== out.fontDisplay);
    if (spare) out.fontBody = spare.name;
  }
  return out;
}

function readDials(text) {
  const haystack = corpus(text);
  const dials = {};
  const notes = [];
  for (const cue of DIAL_CUES) {
    if (dials[cue.dial] !== undefined) continue;
    if (!cue.terms.some((term) => haystack.includes(` ${term}`))) continue;
    dials[cue.dial] = cue.value;
    notes.push(cue.note);
  }
  return { dials, notes };
}

/**
 * Everything a brief said about the design in so many words.
 *
 * Returns empty objects when the brief said nothing, which is the common case —
 * callers can apply the result unconditionally.
 */
export function extractBriefDirectives(text) {
  const source = String(text || '');
  const palette = readColours(source);
  const fonts = readFonts(source);
  const { dials, notes } = readDials(source);
  const all = [
    ...Object.entries(palette).map(([role, hex]) => `${role}: ${hex}`),
    ...Object.entries(fonts).map(([role, name]) => `${role === 'fontDisplay' ? 'headings' : 'body'}: ${name}`),
    ...notes,
  ];
  return {
    palette,
    fontDisplay: fonts.fontDisplay || '',
    fontBody: fonts.fontBody || '',
    dials,
    notes,
    summary: all,
    /** True when the brief stated anything at all that must be honoured. */
    any: all.length > 0,
  };
}

/**
 * Writes the directives onto one concept.
 *
 * Dials land in `dialOverrides` and colour and type in `designOverrides`, which
 * is exactly where a hand edit would have gone — so a directive behaves like a
 * decision the strategist already made, and `conceptFromDesign` keeps it when
 * they nudge something else later.
 */
export function applyDirectivesToConcept(concept, directives) {
  if (!concept || !directives || !directives.any) return concept;
  const dialOverrides = { ...(concept.dialOverrides || {}) };
  for (const [dial, value] of Object.entries(directives.dials || {})) {
    if (DIAL_KEYS.includes(dial)) dialOverrides[dial] = value;
  }
  const designOverrides = { ...(concept.designOverrides || {}) };
  if (Object.keys(directives.palette || {}).length) {
    designOverrides.palette = { ...(designOverrides.palette || {}), ...directives.palette };
  }
  if (directives.fontDisplay && fontByName(directives.fontDisplay)) designOverrides.fontDisplay = fontByName(directives.fontDisplay).name;
  if (directives.fontBody && fontByName(directives.fontBody)) designOverrides.fontBody = fontByName(directives.fontBody).name;
  return { ...concept, dialOverrides, designOverrides };
}

/** The same, for a whole set: a stated constraint applies to all three options. */
export function applyDirectivesToConcepts(concepts, directives) {
  if (!Array.isArray(concepts) || !directives?.any) return concepts || [];
  return concepts.map((concept) => applyDirectivesToConcept(concept, directives));
}

/** A line for the panel, so an overridden concept says why it looks like that. */
export function directiveSummary(directives) {
  if (!directives?.any) return '';
  return `Your brief asked for ${directives.summary.join(', ')} — applied to all three.`;
}
