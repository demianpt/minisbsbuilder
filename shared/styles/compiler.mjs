/**
 * The style compiler.
 *
 * Turns a style profile into the values the engine already knows how to apply:
 *
 *   STYLE PROFILE → VARIATION → BRAND DIRECTIVES → MANUAL EDITS → RESOLVED DESIGN
 *
 * The precedence is fixed (§41) and manual edits are last, so a strategist's own
 * change is never undone by re-resolving. The compiler never invents a DST
 * attribute: it emits palette, type, radius, the nine dials, a button family, a
 * per-section recipe and a pattern-preference weighting, all of which the existing
 * runtime already consumes.
 *
 * A style that only changed colour would be a palette preset, so the three things
 * that matter most here are the dials, the component recipes and the pattern
 * weighting — those are what make one style lay a page out differently from
 * another rather than merely paint it differently.
 */

import { DIAL_KEYS, ensureDials } from '../design/dials.mjs';
import { normalizeButtonStyle } from '../design/button-styles.mjs';
import { repairPalette } from '../design/palette.mjs';
import { CONCEPT_VARIANT_TYPES } from '../concepts/workspace.mjs';

const PALETTE_ROLES = Object.freeze(['bg', 'ink', 'accent', 'soft', 'dark']);

function clampDial(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 50;
  return Math.max(0, Math.min(100, Math.round(number)));
}

/**
 * How each slot departs from the authored style.
 *
 * V1 is the style as written. V2 lets the client's brand in as far as the style's
 * own `brandMapping` allows and lifts brand emphasis. V3 pushes the axes the style
 * is already expressive on rather than adding new ones, so it stays recognisably
 * the same visual language (§22).
 */
export const VARIANT_RULES = Object.freeze({
  core: Object.freeze({ label: 'Core', dialDelta: {}, brand: 'none' }),
  'brand-led': Object.freeze({
    label: 'Brand-led',
    dialDelta: { accent: 24, surface: 6 },
    brand: 'mapped',
  }),
  expressive: Object.freeze({
    label: 'Expressive',
    dialDelta: { expressiveness: 22, headline: 14, motion: 16, imagery: 10, density: -6, corner: 0 },
    brand: 'accent',
  }),
});

export function variantRule(variantType) {
  return VARIANT_RULES[CONCEPT_VARIANT_TYPES.includes(variantType) ? variantType : 'core'];
}

/**
 * Which palette roles a brand colour may take, given the style's own rules.
 *
 * A gallery style whose canvas turns burgundy has stopped being a gallery style, so
 * `protectedRoles` wins over the client's palette and the strategist can still
 * override by hand afterwards.
 */
function brandRoles(profile, variantType) {
  const mapping = profile.brandMapping || { strategy: 'accentOnly', protectedRoles: [] };
  const rule = variantRule(variantType);
  if (rule.brand === 'none') return [];
  const byStrategy = {
    accentOnly: ['accent'],
    accentAndSurface: ['accent', 'soft'],
    full: ['accent', 'soft', 'dark', 'ink', 'bg'],
  };
  const allowed = rule.brand === 'accent' ? ['accent'] : (byStrategy[mapping.strategy] || ['accent']);
  const protectedRoles = new Set(mapping.protectedRoles || []);
  return allowed.filter((role) => !protectedRoles.has(role));
}

/**
 * Resolves a style into the design slice.
 *
 * `brand` is what the brief stated about colour and type — already parsed by
 * `briefDirectives` — and `manual` is whatever the strategist changed by hand on
 * this concept. Both are layered in that order, after the variation.
 */
export function compileStyle(profile, {
  variantType = 'core',
  brand = null,
  manual = null,
  current = null,
} = {}) {
  if (!profile || typeof profile !== 'object') return null;
  const rule = variantRule(variantType);

  const palette = {};
  for (const role of PALETTE_ROLES) palette[role] = profile.palette[role];

  // The variation, then the brief's own colours where the style permits them.
  const brandPalette = brand && typeof brand.palette === 'object' ? brand.palette : {};
  for (const role of brandRoles(profile, variantType)) {
    if (brandPalette[role]) palette[role] = brandPalette[role];
  }
  // A brand that stated only one colour still gets to own the accent, whatever
  // role it was written down as: that is the colour the client recognises.
  if (rule.brand !== 'none' && !brandPalette.accent && brandPalette.brand) palette.accent = brandPalette.brand;

  const dials = {};
  for (const key of DIAL_KEYS) {
    dials[key] = clampDial(Number(profile.dials[key]) + Number(rule.dialDelta[key] || 0));
  }

  const design = {
    ...(current && typeof current === 'object' ? current : {}),
    styleSource: 'style-library',
    styleFamilyId: profile.familyId,
    styleId: profile.id,
    styleVersion: profile.version,
    styleVariant: rule.label,
    archetype: '',
    palette,
    fontDisplay: profile.typography.display,
    fontBody: profile.typography.body,
    radius: profile.radius,
    buttonStyle: normalizeButtonStyle(profile.buttonStyle),
    typeScale: profile.typography.scale,
    displayCase: profile.typography.displayCase,
    displayTracking: profile.typography.displayTracking,
    composition: { ...profile.composition },
    ...dials,
  };

  // The brief's stated typeface beats the style's, because a brand's own type is a
  // fact about the client and the style is a proposal about the design.
  if (brand?.fontDisplay) design.fontDisplay = brand.fontDisplay;
  if (brand?.fontBody) design.fontBody = brand.fontBody;
  for (const [dial, value] of Object.entries(brand?.dials || {})) {
    if (DIAL_KEYS.includes(dial)) design[dial] = clampDial(value);
  }

  // Manual edits are authoritative and go on last.
  const manualSource = manual && typeof manual === 'object' ? manual : {};
  if (manualSource.palette) Object.assign(design.palette, manualSource.palette);
  for (const key of ['fontDisplay', 'fontBody', 'radius', 'buttonStyle']) {
    if (manualSource[key]) design[key] = manualSource[key];
  }
  for (const dial of DIAL_KEYS) {
    if (Number.isFinite(Number(manualSource[dial]))) design[dial] = clampDial(manualSource[dial]);
  }

  // The same last gate every other palette passes: a page nobody can read is not
  // a style, and what was moved is recorded rather than hidden.
  const repaired = repairPalette(design.palette);
  design.palette = repaired.palette;
  design.paletteRepairs = repaired.repairs;
  ensureDials(design);
  return design;
}

/**
 * The style's own composition for one section family, over the engine's preset.
 *
 * This is where a style stops being a colour scheme: containers, vertical rhythm,
 * inversion, arrival effect, column counts and the decorative motif are all
 * decisions the style gets to make per band.
 */
export function compileSectionRecipe(profile, family, { base = null } = {}) {
  const preset = { ...(base && typeof base === 'object' ? base : {}) };
  if (!profile || typeof profile !== 'object') return preset;
  const recipe = (profile.componentRecipes || {})[family];
  const composition = profile.composition || {};

  // A style with no recipe for this family still has a position on containers and
  // full bleed, so the band is composed in its language rather than the demo's.
  if (!recipe) {
    if (composition.containerBias && preset.container && preset.container !== 'full') {
      preset.container = composition.containerBias;
    }
    return preset;
  }
  for (const key of ['container', 'paddingTop', 'paddingBottom', 'viewport']) {
    if (recipe[key] !== undefined) preset[key] = recipe[key];
  }
  if (recipe.inverted !== undefined) preset.inverted = recipe.inverted;
  if (recipe.decoration) {
    preset.decoration = {
      motif: recipe.decoration,
      position: 'cover',
      opacity: recipe.decorationOpacity ?? 0.1,
      scale: 1,
    };
  }
  if (recipe.columns || recipe.columnsMobile) {
    preset.styleColumns = { desktop: recipe.columns, mobile: recipe.columnsMobile };
  }
  return preset;
}

/**
 * How strongly this style wants a pattern, from the text profile the ranker already
 * builds out of the catalogue's own `look`, `bestFor`, `container` and `flags`.
 *
 * Terms rather than pattern ids on purpose: an id would pin a style to one
 * catalogue revision, and the point is a selection pressure that survives the
 * catalogue growing.
 */
export function compilePatternWeight(profile, family, patternProfileText, { strength = 4 } = {}) {
  if (!profile || typeof profile !== 'object') return { delta: 0, why: [] };
  const text = String(patternProfileText || '').toLowerCase();
  if (!text) return { delta: 0, why: [] };
  const preferences = profile.patternPreferences || {};
  const perFamily = (preferences.byFamily || {})[family] || {};
  const prefer = [...new Set([...(preferences.prefer || []), ...(perFamily.prefer || [])])];
  const avoid = [...new Set([...(preferences.avoid || []), ...(perFamily.avoid || [])])];

  let delta = 0;
  const why = [];
  for (const termValue of prefer) {
    if (!text.includes(String(termValue).toLowerCase())) continue;
    // A per-family preference is a sharper instruction than a whole-style one.
    const weight = (perFamily.prefer || []).includes(termValue) ? strength + 2 : strength;
    delta += weight;
    why.push(`+${weight} the style prefers ${termValue}`);
  }
  for (const termValue of avoid) {
    if (!text.includes(String(termValue).toLowerCase())) continue;
    const weight = (perFamily.avoid || []).includes(termValue) ? strength + 2 : strength;
    delta -= weight;
    why.push(`-${weight} the style avoids ${termValue}`);
  }
  return { delta, why };
}

/** A one-line summary for a concept card or a review row. */
export function styleSummary(profile, variantType = 'core') {
  if (!profile) return '';
  return `${profile.name} · ${variantRule(variantType).label}`;
}
