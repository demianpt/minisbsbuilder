/**
 * The typeface catalogue.
 *
 * One list, shared by the editor's two font selects, the concept resolver and
 * the brief reader. It used to be inlined in the builder twice, which meant a
 * brief asking for "Fraunces" could only be honoured if somebody remembered to
 * keep three copies of the same array in step.
 *
 * Every family here is available from Google Fonts at the weights the rendered
 * page requests (400–700), because the export links them by name — a font this
 * list invents would render as a fallback and quietly change the design.
 */

export const FONT_CHOICES = Object.freeze([
  Object.freeze({ name: 'Inter', category: 'sans', character: 'neutral' }),
  Object.freeze({ name: 'Manrope', category: 'sans', character: 'geometric' }),
  Object.freeze({ name: 'DM Sans', category: 'sans', character: 'friendly' }),
  Object.freeze({ name: 'Space Grotesk', category: 'sans', character: 'technical' }),
  Object.freeze({ name: 'Work Sans', category: 'sans', character: 'neutral' }),
  Object.freeze({ name: 'Barlow', category: 'sans', character: 'industrial' }),
  Object.freeze({ name: 'IBM Plex Mono', category: 'mono', character: 'technical' }),
  Object.freeze({ name: 'Nunito Sans', category: 'sans', character: 'friendly' }),
  Object.freeze({ name: 'Lora', category: 'serif', character: 'editorial' }),
  Object.freeze({ name: 'Fraunces', category: 'serif', character: 'expressive' }),
  Object.freeze({ name: 'Cormorant Garamond', category: 'serif', character: 'classical' }),
  Object.freeze({ name: 'Source Serif 4', category: 'serif', character: 'editorial' }),
  Object.freeze({ name: 'Libre Franklin', category: 'sans', character: 'institutional' }),
  Object.freeze({ name: 'Archivo Black', category: 'display', character: 'loud' }),
]);

export const FONT_NAMES = Object.freeze(FONT_CHOICES.map((font) => font.name));

/** The `{value,label}` shape the editor's `field(..., {type:'select'})` wants. */
export function fontOptions() {
  return FONT_CHOICES.map((font) => ({ value: font.name, label: font.name }));
}

function normalise(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function isFontName(value) {
  const wanted = normalise(value);
  return FONT_CHOICES.some((font) => normalise(font.name) === wanted);
}

/** The catalogue entry for a name, however loosely it was typed. */
export function fontByName(value) {
  const wanted = normalise(value);
  if (!wanted) return null;
  return FONT_CHOICES.find((font) => normalise(font.name) === wanted)
    // "Plex Mono", "Cormorant", "Source Serif" are all how people actually write
    // these names; a brief is prose, not a font picker.
    || FONT_CHOICES.find((font) => normalise(font.name).startsWith(wanted) || wanted.startsWith(normalise(font.name)))
    || null;
}

/**
 * Every catalogue font named anywhere in a piece of prose, in the order it
 * appears. A brief that says "Fraunces for headings, Inter for body" has to
 * survive as two separate decisions, so this returns the sequence rather than
 * the first hit.
 */
export function findFontMentions(text) {
  const haystack = ` ${normalise(text)} `;
  const found = [];
  for (const font of FONT_CHOICES) {
    const needle = ` ${normalise(font.name)} `;
    const at = haystack.indexOf(needle);
    if (at >= 0) found.push({ font, at });
  }
  return found.sort((a, b) => a.at - b.at).map((entry) => ({ ...entry.font, at: entry.at }));
}
