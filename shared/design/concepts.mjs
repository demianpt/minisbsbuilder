import { BUTTON_STYLE_IDS, DEFAULT_BUTTON_STYLE, normalizeButtonStyle } from './button-styles.mjs';
import { DIAL_DEFAULTS, DIAL_KEYS, DIAL_PRESETS, ensureDials, radiusToCorner } from './dials.mjs';
import { paletteDistance, repairPalette } from './palette.mjs';

/**
 * Design concepts.
 *
 * A concept is one complete visual proposal: an archetype, a quick style, a
 * button family, and any dial nudges on top. The simple builder generates three
 * of them from a single paragraph so a strategist can put three finished-looking
 * options in front of a client in one sitting.
 *
 * Resolution lives here, shared by the editor, the preview, the export and the
 * tests, because a concept must resolve to exactly the same design everywhere.
 * The rule that makes the V1/V2/V3 pills safe: a concept describes *only* the
 * design slice. It never touches sections, content, flow or globals, so
 * switching concepts can never discard work done in a later step.
 */

export const CONCEPT_SLOTS = Object.freeze(['V1', 'V2', 'V3']);
export const PRESET_IDS = Object.freeze(DIAL_PRESETS.map((preset) => preset.id));

/** The design keys a concept owns. Anything not listed here is shared state. */
export const CONCEPT_DESIGN_KEYS = Object.freeze([
  // `paletteRepairs` travels with the palette that produced it. Leaving it out
  // would let V1's repair notes describe V2's colours after a pill switch.
  'archetype', 'palette', 'paletteRepairs', 'fontBody', 'fontDisplay', 'radius', 'buttonStyle', ...DIAL_KEYS,
]);

function clean(value, max = 200) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

const PALETTE_ROLES = Object.freeze(['bg', 'ink', 'accent', 'soft', 'dark']);
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Explicit design values a concept carries on top of its archetype.
 *
 * A strategist who nudges the accent colour on V1 must find that nudge still
 * there after previewing V2 and coming back. The archetype supplies the starting
 * palette and type; anything they change by hand is recorded here so re-resolving
 * the concept cannot quietly undo it.
 */
function normalizeDesignOverrides(value) {
  const source = value && typeof value === 'object' ? value : {};
  const out = {};
  const palette = source.palette && typeof source.palette === 'object' ? source.palette : null;
  if (palette) {
    const roles = {};
    for (const role of PALETTE_ROLES) {
      const colour = clean(palette[role], 32);
      if (HEX.test(colour)) roles[role] = colour;
    }
    if (Object.keys(roles).length) out.palette = roles;
  }
  for (const key of ['fontBody', 'fontDisplay']) {
    const font = clean(source[key], 64);
    if (font) out[key] = font;
  }
  return out;
}

function normalizePreset(value) {
  const id = clean(value, 40).toLowerCase();
  if (PRESET_IDS.includes(id)) return id;
  // The model sometimes answers with the label rather than the id.
  const byLabel = DIAL_PRESETS.find((preset) => preset.label.toLowerCase() === id
    || preset.label.toLowerCase().startsWith(id)
    || id.startsWith(preset.id));
  return byLabel ? byLabel.id : '';
}

export function presetById(value) {
  return DIAL_PRESETS.find((preset) => preset.id === normalizePreset(value)) || null;
}

/**
 * Fills in a concept, dropping anything that is not a real archetype key, quick
 * style or button family. `slot` is positional and never comes from the model.
 */
export function normalizeConcept(value, index = 0, { archetypeKeys = [] } = {}) {
  const raw = value && typeof value === 'object' ? value : {};
  const key = clean(raw.archetypeKey || raw.archetype, 8).toUpperCase().match(/\b([A-M])\b/);
  const archetype = key && (!archetypeKeys.length || archetypeKeys.includes(key[1])) ? key[1] : '';
  if (!archetype) return null;
  const preset = normalizePreset(raw.preset) || PRESET_IDS[index % PRESET_IDS.length];
  const overrides = {};
  const source = raw.dialOverrides && typeof raw.dialOverrides === 'object' ? raw.dialOverrides : {};
  for (const dial of DIAL_KEYS) {
    const number = Number(source[dial]);
    if (Number.isFinite(number)) overrides[dial] = Math.max(0, Math.min(100, Math.round(number)));
  }
  /*
   * A palette proposed for this concept is a hand edit that has not been made
   * yet: it belongs in `designOverrides`, which is exactly where a strategist's
   * own colour change goes. Folding it in here means one path — the model, the
   * brief parser and the colour picker all write to the same place, so a later
   * nudge cannot be silently undone by re-resolving the concept.
   */
  const designOverrides = normalizeDesignOverrides(raw.designOverrides);
  const proposed = normalizeDesignOverrides({ palette: raw.palette });
  if (proposed.palette) designOverrides.palette = { ...proposed.palette, ...(designOverrides.palette || {}) };

  return {
    slot: CONCEPT_SLOTS[index] || `V${index + 1}`,
    name: clean(raw.name, 60) || `Concept ${index + 1}`,
    archetypeKey: archetype,
    preset,
    buttonStyle: BUTTON_STYLE_IDS.includes(clean(raw.buttonStyle, 40)) ? clean(raw.buttonStyle, 40) : DEFAULT_BUTTON_STYLE,
    dialOverrides: overrides,
    designOverrides,
    paletteWhy: clean(raw.paletteWhy, 240),
    why: clean(raw.why, 400),
  };
}

export function normalizeConceptList(value, options = {}) {
  const list = Array.isArray(value) ? value : [];
  const out = [];
  for (const entry of list) {
    if (out.length >= CONCEPT_SLOTS.length) break;
    const concept = normalizeConcept(entry, out.length, options);
    if (concept) out.push(concept);
  }
  return out;
}

/**
 * Resolves a concept into the design slice.
 *
 * `archetypeStyle` is the palette/type record from the pattern catalog, which
 * only the browser has, so it is passed in rather than imported. When it is
 * missing the concept still resolves — it simply keeps the current palette,
 * which is the honest outcome for an unknown archetype.
 */
export function resolveConceptDesign(concept, { archetypeStyle, current = {} } = {}) {
  const normalized = normalizeConcept(concept, 0) || null;
  if (!normalized) return null;
  const preset = presetById(normalized.preset);
  const dials = { ...DIAL_DEFAULTS, ...(preset ? preset.values : {}), ...normalized.dialOverrides };
  const palette = archetypeStyle
    ? {
      bg: archetypeStyle.bg, ink: archetypeStyle.ink, accent: archetypeStyle.accent,
      soft: archetypeStyle.soft, dark: archetypeStyle.dark,
    }
    : (current.palette ? { ...current.palette } : undefined);

  const overrides = normalized.designOverrides || {};
  const design = {
    archetype: normalized.archetypeKey,
    buttonStyle: normalizeButtonStyle(normalized.buttonStyle),
    ...(palette ? { palette } : {}),
    ...(archetypeStyle ? { fontBody: archetypeStyle.fontBody, fontDisplay: archetypeStyle.fontDisplay } : {}),
    ...dials,
    // Hand edits win over the archetype's own palette and type.
    ...(overrides.fontBody ? { fontBody: overrides.fontBody } : {}),
    ...(overrides.fontDisplay ? { fontDisplay: overrides.fontDisplay } : {}),
  };
  if (overrides.palette) design.palette = { ...(design.palette || {}), ...overrides.palette };
  /*
   * The last gate before anything is painted.
   *
   * Colours reach this line from four places — a catalogue palette, a model that
   * invented five hexes, a sentence in a brief, a colour picker — and only the
   * first was ever designed as a set. `repairPalette` moves lightness and
   * nothing else, so a brand colour survives as itself while the page stops
   * shipping cream type on a cream band. What it changed is recorded on the
   * design so the editor can say so rather than quietly disagreeing with the
   * strategist.
   */
  if (design.palette) {
    const repaired = repairPalette(design.palette);
    design.palette = repaired.palette;
    design.paletteRepairs = repaired.repairs;
  }
  // The corner dial is authoritative over the archetype's own radius: a concept
  // that asked for "friendly and soft" must not be squared off by its archetype.
  ensureDials(design);
  return design;
}

/** The subset of a live design that should be written back into a concept. */
export function conceptFromDesign(design, { slot = 'V1', name = '', why = '', preset = '', archetypeStyle = null } = {}) {
  const source = design && typeof design === 'object' ? design : {};
  const overrides = {};
  const base = presetById(preset);
  for (const dial of DIAL_KEYS) {
    const number = Number(source[dial]);
    if (!Number.isFinite(number)) continue;
    // Only record a dial that actually departs from the named quick style, so a
    // concept stays readable as "this mood, with these three deliberate nudges".
    if (base && Number(base.values[dial]) === Math.round(number)) continue;
    overrides[dial] = Math.max(0, Math.min(100, Math.round(number)));
  }
  // Same rule for palette and type: record only what the archetype did not give.
  const designOverrides = {};
  if (source.palette && typeof source.palette === 'object') {
    const roles = {};
    for (const role of PALETTE_ROLES) {
      const colour = clean(source.palette[role], 32);
      if (!HEX.test(colour)) continue;
      if (archetypeStyle && String(archetypeStyle[role] || '').toLowerCase() === colour.toLowerCase()) continue;
      roles[role] = colour;
    }
    if (Object.keys(roles).length) designOverrides.palette = roles;
  }
  for (const key of ['fontBody', 'fontDisplay']) {
    const font = clean(source[key], 64);
    if (!font) continue;
    if (archetypeStyle && String(archetypeStyle[key] || '') === font) continue;
    designOverrides[key] = font;
  }
  return {
    slot,
    name: clean(name, 60) || slot,
    archetypeKey: clean(source.archetype, 8).toUpperCase() || 'A',
    preset: normalizePreset(preset) || '',
    buttonStyle: normalizeButtonStyle(source.buttonStyle),
    dialOverrides: overrides,
    designOverrides: normalizeDesignOverrides(designOverrides),
    paletteWhy: clean(source.paletteWhy, 240),
    why: clean(why, 400),
  };
}

/** A short human summary for a concept card: what a client would notice. */
export function conceptSummary(concept, { archetypeName = '' } = {}) {
  const normalized = normalizeConcept(concept, 0);
  if (!normalized) return '';
  const preset = presetById(normalized.preset);
  return [archetypeName || normalized.archetypeKey, preset ? preset.label : null]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Three concepts have to look like three concepts. This reports the axes on
 * which a set actually differs, so the editor can warn instead of presenting
 * three near-identical options as a choice.
 */
export function conceptDistinctness(concepts) {
  const list = normalizeConceptList(concepts);
  const axis = (pluck) => new Set(list.map(pluck)).size;
  return {
    count: list.length,
    archetypes: axis((concept) => concept.archetypeKey),
    presets: axis((concept) => concept.preset),
    buttons: axis((concept) => concept.buttonStyle),
    // Colour is the axis a client sees first. Three concepts on three archetypes
    // that all resolve to the same five hexes are one option shown three times,
    // however different their dials are.
    palettes: axis((concept) => JSON.stringify((concept.designOverrides || {}).palette || {})),
    paletteSpread: list.length > 1
      ? Math.round(list.slice(1).reduce((total, concept, index) => total
        + paletteDistance((list[index].designOverrides || {}).palette, (concept.designOverrides || {}).palette), 0) / (list.length - 1) * 100) / 100
      : 0,
    distinct: list.length > 1
      && (axis((concept) => concept.archetypeKey) > 1 || axis((concept) => concept.preset) > 1),
  };
}

export { DIAL_KEYS, radiusToCorner };
