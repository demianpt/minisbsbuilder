/**
 * The style profile contract — `sbs-style/1.0`.
 *
 * A style profile is the canonical description of one design language. It is data,
 * not prose: the runtime resolves a project's design from it, so every field has to
 * be a value the engine can actually apply. Nothing here is free text that some
 * later stage has to interpret.
 *
 * The hard rule this schema exists to enforce is §86 of the product spec: a style
 * may not be a palette preset. A profile therefore has to state its position on
 * every axis the engine can vary — the nine dials, composition, container bias,
 * media dominance, surface treatment, the button family, and which of the 154
 * patterns it prefers per section family. `styleDistance` in
 * `shared/styles/distinctness.mjs` measures exactly those axes, and the build
 * refuses near-clones.
 */

import { z } from 'zod';
import { BUTTON_STYLE_IDS } from '../design/button-styles.mjs';
import { DIAL_KEYS } from '../design/dials.mjs';
import { FONT_NAMES } from '../design/fonts.mjs';

export const STYLE_SCHEMA_VERSION = 'sbs-style/1.0';

/** The ten style families, in the order the picker shows them. */
export const STYLE_FAMILIES = Object.freeze([
  Object.freeze({ id: 'technology', name: 'Technology', blurb: 'Product-led, precise, engineered.' }),
  Object.freeze({ id: 'luxury', name: 'Luxury', blurb: 'Restraint, materials, quiet confidence.' }),
  Object.freeze({ id: 'editorial', name: 'Editorial', blurb: 'Type-first, journalistic, read at length.' }),
  Object.freeze({ id: 'corporate', name: 'Corporate', blurb: 'Institutional authority, clear structure.' }),
  Object.freeze({ id: 'commerce', name: 'Commerce', blurb: 'Product forward, built to convert.' }),
  Object.freeze({ id: 'hospitality', name: 'Hospitality', blurb: 'Place, welcome, atmosphere.' }),
  Object.freeze({ id: 'automotive-mobility', name: 'Automotive / Mobility', blurb: 'Engineering, motion, machine presence.' }),
  Object.freeze({ id: 'health-wellness', name: 'Health / Wellness', blurb: 'Calm, clinical clarity, care.' }),
  Object.freeze({ id: 'creative-culture', name: 'Creative / Culture', blurb: 'Work first, gallery discipline.' }),
  Object.freeze({ id: 'experimental', name: 'Experimental', blurb: 'Deliberate rule-breaking, on purpose.' }),
]);

export const STYLE_FAMILY_IDS = Object.freeze(STYLE_FAMILIES.map((family) => family.id));

/** The lifecycle from §47. Only `production` reaches the strategist's picker. */
export const STYLE_STATUSES = Object.freeze(['draft', 'generated', 'validated', 'visual-qa', 'production']);

export const PALETTE_ROLES = Object.freeze(['bg', 'ink', 'accent', 'soft', 'dark']);

/** Section families the engine can build. A recipe may only name one of these. */
export const RECIPE_FAMILIES = Object.freeze([
  'hero', 'text', 'logo', 'stats', 'split', 'cards', 'tabs', 'timeline', 'testimonial',
  'cta', 'faq', 'slider', 'pricing', 'gallery', 'contact', 'blog', 'team', 'accordion', 'haccordion',
]);

export const CONTAINERS = Object.freeze(['full', 'wide', 'default', 'alt']);
export const PADDINGS = Object.freeze(['none', 'small', 'default', 'large']);
export const VIEWPORT_EFFECTS = Object.freeze(['', 'fade-up', 'fade-in-seq', 'animate-headings']);

/**
 * Composition vocabulary, defined once in `STYLE-CONSTITUTION.md` and constrained
 * here so two styles cannot mean different things by the same word.
 */
export const ALIGNMENTS = Object.freeze(['left', 'centered', 'split', 'asymmetric']);
export const MEDIA_DOMINANCE = Object.freeze(['none', 'supporting', 'balanced', 'dominant', 'immersive']);
export const SURFACE_TREATMENTS = Object.freeze(['flat', 'bordered', 'raised', 'layered', 'glass']);
export const POLARITIES = Object.freeze(['light', 'dark']);

const hex = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'must be a hex colour');
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lower-case slug');
const dial = z.number().int().min(0).max(100);
const term = z.string().min(2).max(40);

const DialsSchema = z.object(Object.fromEntries(DIAL_KEYS.map((key) => [key, dial]))).strict();

/**
 * How the client's own brand colours enter this style.
 *
 * `accentOnly` keeps a restrained language restrained when the brand is loud;
 * `full` lets a brand-led interpretation take the whole palette. Without this a
 * "brand-led" variation is just a recolour, which is the failure §21 names.
 */
const BrandMappingSchema = z.object({
  strategy: z.enum(['accentOnly', 'accentAndSurface', 'full']),
  // Roles the brand may never take, whatever the client's palette says. A gallery
  // style whose canvas turns burgundy has stopped being a gallery style.
  protectedRoles: z.array(z.enum(PALETTE_ROLES)).max(5).default([]),
}).strict();

const TypographySchema = z.object({
  display: z.enum(FONT_NAMES),
  body: z.enum(FONT_NAMES),
  // Multiplier on the resolved type scale. The headline dial moves size; this is
  // the style's own posture, so a style can be large-headed at a low dial value.
  scale: z.number().min(0.8).max(1.35),
  displayCase: z.enum(['none', 'upper']),
  displayTracking: z.number().min(-0.05).max(0.24),
}).strict();

const CompositionSchema = z.object({
  alignment: z.enum(ALIGNMENTS),
  containerBias: z.enum(CONTAINERS),
  mediaDominance: z.enum(MEDIA_DOMINANCE),
  surfaceTreatment: z.enum(SURFACE_TREATMENTS),
  // 0 = every band symmetrical, 100 = deliberately off-axis throughout.
  asymmetry: dial,
  fullBleedBias: dial,
}).strict();

/**
 * Which of the 154 patterns this style reaches for.
 *
 * Terms are matched against the same pattern profile the ranker already builds
 * from the catalogue's own `look`, `bestFor`, `container`, `components` and
 * `flags`, so a preference is a real selection pressure rather than a hard-coded
 * pattern id that would break the moment the catalogue changed.
 */
const PatternPreferenceSchema = z.object({
  prefer: z.array(term).max(24).default([]),
  avoid: z.array(term).max(24).default([]),
  byFamily: z.record(
    z.enum(RECIPE_FAMILIES),
    z.object({ prefer: z.array(term).max(12).default([]), avoid: z.array(term).max(12).default([]) }).strict(),
  ).default({}),
}).strict();

/**
 * Per-family layout, so a style decides how a band is composed and not only what
 * colour it is. Anything a style leaves out keeps the engine's own preset.
 */
const ComponentRecipeSchema = z.object({
  container: z.enum(CONTAINERS).optional(),
  paddingTop: z.enum(PADDINGS).optional(),
  paddingBottom: z.enum(PADDINGS).optional(),
  inverted: z.boolean().optional(),
  viewport: z.enum(VIEWPORT_EFFECTS).optional(),
  columns: z.number().int().min(1).max(6).optional(),
  columnsMobile: z.number().int().min(1).max(2).optional(),
  decoration: z.string().max(40).optional(),
  decorationOpacity: z.number().min(0).max(0.4).optional(),
}).strict();

export const StyleProfileSchema = z.object({
  schemaVersion: z.literal(STYLE_SCHEMA_VERSION),
  id: slug,
  familyId: z.enum(STYLE_FAMILY_IDS),
  name: z.string().min(2).max(48),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  status: z.enum(STYLE_STATUSES),
  description: z.string().min(20).max(400),
  philosophy: z.string().min(20).max(600),
  polarity: z.enum(POLARITIES),
  tags: z.array(slug).min(3).max(12),
  useCases: z.array(z.string().min(3).max(60)).min(2).max(8),
  industries: z.array(slug).min(1).max(10),
  palette: z.object(Object.fromEntries(PALETTE_ROLES.map((role) => [role, hex]))).strict(),
  brandMapping: BrandMappingSchema,
  typography: TypographySchema,
  radius: z.string().regex(/^\d+px$/),
  buttonStyle: z.enum(BUTTON_STYLE_IDS),
  dials: DialsSchema,
  composition: CompositionSchema,
  patternPreferences: PatternPreferenceSchema,
  componentRecipes: z.record(z.enum(RECIPE_FAMILIES), ComponentRecipeSchema).default({}),
  dos: z.array(z.string().min(6).max(140)).min(2).max(8),
  donts: z.array(z.string().min(6).max(140)).min(2).max(8),
}).strict();

/** The full style id a concept records: `family/style`. */
export function styleKey(profile) {
  if (!profile) return '';
  return `${profile.familyId}/${profile.id}`;
}

export function parseStyleKey(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  const [familyId, id] = raw.split('/');
  if (!STYLE_FAMILY_IDS.includes(familyId) || !id) return null;
  return { familyId, id };
}

export function familyById(familyId) {
  return STYLE_FAMILIES.find((family) => family.id === familyId) || null;
}

/**
 * Validates a profile, returning the parsed value or the reasons it failed.
 *
 * The build refuses to emit an invalid profile rather than shipping one the
 * compiler would then have to guess about at render time.
 */
export function validateStyleProfile(value) {
  const result = StyleProfileSchema.safeParse(value);
  if (result.success) return { ok: true, profile: result.data, issues: [] };
  return {
    ok: false,
    profile: null,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join('.') || '(root)',
      message: issue.message,
    })),
  };
}
