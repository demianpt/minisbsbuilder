import { z } from 'zod';
import { SECTION_FAMILY_IDS, isSectionFamily } from './families.mjs';

/**
 * Brief Brain contracts.
 *
 * One AI model performs three jobs, and each job has exactly one schema here.
 * Each schema appears twice: as a Zod validator, and — via the `*JsonSchema`
 * exports — as Ollama's `format` constraint.
 *
 * Important reality check: the hosted model this project targets does **not**
 * reliably honour `format`. It answers with a Markdown-fenced object in roughly
 * the right shape, flattening nested objects and renaming fields. So every job
 * has a `coerce*` function that repairs the plausible variants before validation
 * runs. The `format` payload and the prompt examples use the *flattest* legal
 * shape for the same reason: a flat object is what the model actually produces.
 *
 * The rule this preserves: the model may influence content and ranking, never
 * structure. Anything that does not survive coercion plus validation is dropped
 * and the deterministic planner answers instead.
 */

/**
 * How much brief the model is given.
 *
 * A strategist types a paragraph; a document *is* the brief, and a ten-page
 * meeting-notes PDF runs to twelve thousand characters of it. Capping at four
 * thousand meant a dropped document lost its last two thirds — which in a
 * discovery document is the audience, the scope and the budget, the whole reason
 * to read it in the first place. Sixteen thousand characters is about four
 * thousand tokens: a full discovery document, and still a small fraction of the
 * context the model has.
 *
 * Stated once, here beside the schema that enforces it, and taken from here by
 * the browser, the server and the file reader.
 */
export const BRIEF_TEXT_LIMIT = 16_000;

/** The document itself, kept verbatim on the brief as the internal note. */
export const BRIEF_NOTES_LIMIT = 6_000;

export const BRIEF_SCHEMA_VERSION = 'sbs-brief-brain/1.0';

const trimmed = (max) => z.string().transform((value) => value.trim()).pipe(z.string().max(max));
const optionalText = (max) => z.string().max(max).optional().transform((value) => (value || '').trim());

/* ------------------------------------------------------------------ *
 * Shared coercion helpers
 * ------------------------------------------------------------------ */

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value, max = 600) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map((entry) => text(entry, max)).filter(Boolean).join(' ').slice(0, max);
  if (isObject(value)) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

/** First non-empty value among a set of field-name aliases. */
function pick(source, ...keys) {
  for (const key of keys) {
    if (!isObject(source)) break;
    const value = source[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function list(value, limit) {
  if (Array.isArray(value)) return value.slice(0, limit);
  if (typeof value === 'string') return value.split(/[,\n;]/).map((entry) => entry.trim()).filter(Boolean).slice(0, limit);
  if (isObject(value)) return [value];
  return [];
}

/** Models express 0–1 scores as 0–1, as percentages, and as "85%". */
function ratio(value, fallback) {
  const number = Number(String(value ?? '').replace('%', ''));
  if (!Number.isFinite(number)) return fallback;
  if (number > 1) return Math.max(0, Math.min(1, number / 100));
  return Math.max(0, Math.min(1, number));
}

function familyOf(value) {
  const candidate = text(value, 40).toLowerCase();
  if (isSectionFamily(candidate)) return candidate;
  // "cards (services)" and "family: cards" both appear in practice.
  const token = candidate.split(/[^a-z]+/).find((part) => isSectionFamily(part));
  return token || null;
}

/* ------------------------------------------------------------------ *
 * Job 0 — the brief itself
 * ------------------------------------------------------------------ */

export const BriefFieldsSchema = z.object({
  projectName: optionalText(200),
  clientName: optionalText(200),
  industry: optionalText(600),
  audience: optionalText(1_200),
  goal: optionalText(1_200),
  offer: optionalText(1_200),
  tone: optionalText(1_200),
  keywords: optionalText(600),
  notes: optionalText(BRIEF_NOTES_LIMIT),
});

export const BRIEF_FIELD_ORDER = Object.freeze([
  ['projectName', 'Project name'],
  ['clientName', 'Client / brand'],
  ['industry', 'Industry / context'],
  ['audience', 'Primary audience'],
  ['goal', 'Primary page goal'],
  ['offer', 'Core offer'],
  ['tone', 'Voice and tone'],
  ['keywords', 'Useful words / themes'],
  ['notes', 'Internal notes'],
]);

/** Fields the brain must demonstrably have read back before we trust it. */
export const BRIEF_REQUIRED_FIELDS = Object.freeze(['industry', 'audience', 'goal', 'offer']);

/* ------------------------------------------------------------------ *
 * Job 1 — Understand the brief
 * ------------------------------------------------------------------ */

export const BriefUnderstandingSchema = z.object({
  readback: z.object({
    business: trimmed(400),
    audience: trimmed(400),
    offer: trimmed(400),
    goal: trimmed(400),
    voice: trimmed(240),
  }),
  confidence: z.number().min(0).max(1),
  missingFields: z.array(z.string().max(40)).max(9).default([]),
  keywords: z.array(trimmed(48)).max(10).default([]),
  archetype: z.object({
    key: z.string().regex(/^[A-M]$/),
    reason: trimmed(400),
  }),
  flows: z.array(z.object({
    id: z.string().max(12),
    reason: trimmed(400),
    fit: z.number().min(0).max(1),
  })).min(1).max(5),
});

/**
 * The flat shape the model is asked for. Every nested object in the internal
 * contract is one top-level key here, because that is what the model returns
 * even when a nested schema is supplied.
 */
export const BriefUnderstandingJsonSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['business', 'audience', 'offer', 'goal', 'voice', 'archetypeKey', 'archetypeReason', 'flows'],
  properties: {
    business: { type: 'string' },
    audience: { type: 'string' },
    offer: { type: 'string' },
    goal: { type: 'string' },
    voice: { type: 'string' },
    confidence: { type: 'number' },
    missingFields: { type: 'array', items: { type: 'string' } },
    keywords: { type: 'array', items: { type: 'string' } },
    archetypeKey: { type: 'string' },
    archetypeReason: { type: 'string' },
    flows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'reason', 'fit'],
        properties: { id: { type: 'string' }, reason: { type: 'string' }, fit: { type: 'number' } },
      },
    },
  },
});

/** Accepts the flat model answer, the nested contract, or a mixture of both. */
export function coerceBriefUnderstanding(value) {
  const raw = isObject(value) ? value : {};
  const readback = isObject(raw.readback) ? raw.readback : raw;
  const archetypeValue = raw.archetype;
  const archetypeObject = isObject(archetypeValue) ? archetypeValue : {};
  const keySource = pick(raw, 'archetypeKey', 'archetype_key')
    ?? (typeof archetypeValue === 'string' ? archetypeValue : undefined)
    ?? pick(archetypeObject, 'key', 'id');
  const keyMatch = text(keySource, 40).toUpperCase().match(/\b([A-M])\b/);

  const flows = list(pick(raw, 'flows', 'pageFlows', 'recommendedFlows'), 6).map((entry) => {
    if (!isObject(entry)) return { id: text(entry, 12), reason: '', fit: 0.6 };
    return {
      id: text(pick(entry, 'id', 'flowId', 'flow', 'flowID'), 12),
      reason: text(pick(entry, 'reason', 'why', 'rationale', 'justification'), 400),
      fit: ratio(pick(entry, 'fit', 'score', 'confidence', 'match'), 0.6),
    };
  }).filter((entry) => entry.id);

  return {
    readback: {
      business: text(pick(readback, 'business', 'whatTheBusinessDoes', 'company', 'industry'), 400),
      audience: text(pick(readback, 'audience', 'primaryAudience', 'who'), 400),
      offer: text(pick(readback, 'offer', 'coreOffer', 'proposition'), 400),
      goal: text(pick(readback, 'goal', 'primaryGoal', 'pageGoal', 'action'), 400),
      voice: text(pick(readback, 'voice', 'tone', 'voiceAndTone'), 240),
    },
    confidence: ratio(pick(raw, 'confidence', 'certainty'), 0.6),
    missingFields: list(pick(raw, 'missingFields', 'missing'), 9).map((entry) => text(entry, 40)).filter(Boolean),
    keywords: list(pick(raw, 'keywords', 'themes', 'usefulWords'), 10).map((entry) => text(entry, 48)).filter(Boolean),
    archetype: {
      key: keyMatch ? keyMatch[1] : '',
      reason: text(pick(raw, 'archetypeReason', 'archetype_reason') ?? pick(archetypeObject, 'reason', 'why'), 400),
    },
    flows,
  };
}

/* ------------------------------------------------------------------ *
 * Job 2 — Write the page content
 * ------------------------------------------------------------------ */

const ContentItemSchema = z.object({
  title: optionalText(140),
  description: optionalText(400),
  value: optionalText(40),
});

const ContentButtonSchema = z.object({
  text: optionalText(60),
  type: z.enum(['primary', 'secondary', 'link']).default('primary'),
});

export const SectionContentSchema = z.object({
  family: z.enum(SECTION_FAMILY_IDS),
  pretitle: optionalText(80),
  title: optionalText(200),
  subtitle: optionalText(400),
  body: optionalText(900),
  items: z.array(ContentItemSchema).max(8).default([]),
  buttons: z.array(ContentButtonSchema).max(2).default([]),
});

export const FooterContentSchema = z.object({
  statement: optionalText(160),
  description: optionalText(300),
  ctaText: optionalText(60),
});

export const PageContentSchema = z.object({
  sections: z.array(SectionContentSchema).min(1).max(14),
  footer: FooterContentSchema.nullable().default(null),
});

export const PageContentJsonSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['sections', 'footer'],
  properties: {
    footer: {
      type: 'object',
      additionalProperties: false,
      required: ['statement'],
      properties: {
        statement: { type: 'string' },
        description: { type: 'string' },
        ctaText: { type: 'string' },
      },
    },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['family', 'title'],
        properties: {
          family: { type: 'string', enum: [...SECTION_FAMILY_IDS] },
          pretitle: { type: 'string' },
          title: { type: 'string' },
          subtitle: { type: 'string' },
          body: { type: 'string' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { title: { type: 'string' }, description: { type: 'string' }, value: { type: 'string' } },
            },
          },
          buttons: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['text'],
              properties: { text: { type: 'string' }, type: { type: 'string', enum: ['primary', 'secondary', 'link'] } },
            },
          },
        },
      },
    },
  },
});

const BUTTON_TYPES = new Set(['primary', 'secondary', 'link']);

function footerCta(raw) {
  const value = pick(raw, 'ctaText', 'cta', 'buttonText', 'action', 'button');
  return isObject(value) ? pick(value, 'text', 'label', 'title') : value;
}

export function coercePageContent(value) {
  const raw = isObject(value) ? value : Array.isArray(value) ? { sections: value } : {};
  const sections = list(pick(raw, 'sections', 'page', 'blocks', 'modules'), 14).map((entry) => {
    if (!isObject(entry)) return null;
    const family = familyOf(pick(entry, 'family', 'section', 'type', 'sectionType'));
    if (!family) return null;
    return {
      family,
      pretitle: text(pick(entry, 'pretitle', 'eyebrow', 'kicker', 'label'), 80),
      title: text(pick(entry, 'title', 'heading', 'headline', 'h2'), 200),
      subtitle: text(pick(entry, 'subtitle', 'subheading', 'sub', 'supporting'), 400),
      body: text(pick(entry, 'body', 'paragraph', 'copy', 'text', 'description'), 900),
      items: list(pick(entry, 'items', 'cards', 'list', 'entries', 'questions', 'steps', 'tiers', 'quotes'), 8).map((item) => {
        if (!isObject(item)) return { title: text(item, 140), description: '', value: '' };
        return {
          // Each family names its own fields; the renderer owns the real names,
          // so everything is normalised to one neutral triple here.
          title: text(pick(item, 'title', 'question', 'name', 'label', 'heading', 'role'), 140),
          description: text(pick(item, 'description', 'answer', 'text', 'body', 'detail', 'quote'), 400),
          value: text(pick(item, 'value', 'number', 'price', 'metric', 'step'), 40),
        };
      }).filter((item) => item.title || item.description),
      buttons: list(pick(entry, 'buttons', 'ctas', 'actions'), 2).map((button) => {
        if (!isObject(button)) return { text: text(button, 60), type: 'primary' };
        const type = text(pick(button, 'type', 'style', 'variant'), 20).toLowerCase();
        return { text: text(pick(button, 'text', 'label', 'title'), 60), type: BUTTON_TYPES.has(type) ? type : 'primary' };
      }).filter((button) => button.text),
    };
  }).filter(Boolean);
  const footerRaw = pick(raw, 'footer', 'closing', 'signoff');
  const footer = isObject(footerRaw) ? {
    statement: text(pick(footerRaw, 'statement', 'closing', 'headline', 'title', 'heading'), 160),
    description: text(pick(footerRaw, 'description', 'subtitle', 'body', 'supporting', 'sub'), 300),
    // `cta` is sometimes answered as an object, sometimes as a string. Only the
    // label is wanted either way — the builder owns every link on the page.
    ctaText: text(footerCta(footerRaw), 60),
  } : null;
  return { sections, footer: footer && footer.statement ? footer : null };
}

/* ------------------------------------------------------------------ *
 * Job 3 — Turn a typed outline into a DST page flow
 * ------------------------------------------------------------------ */

export const OutlinePlanSchema = z.object({
  name: optionalText(80),
  rationale: optionalText(500),
  steps: z.array(z.object({
    requested: optionalText(160),
    family: z.enum(SECTION_FAMILY_IDS),
    reason: optionalText(240),
  })).min(1).max(20),
  added: z.array(z.object({
    family: z.enum(SECTION_FAMILY_IDS),
    reason: optionalText(240),
  })).max(4).default([]),
});

export const OutlinePlanJsonSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['steps'],
  properties: {
    name: { type: 'string' },
    rationale: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['requested', 'family'],
        properties: {
          requested: { type: 'string' },
          family: { type: 'string', enum: [...SECTION_FAMILY_IDS] },
          reason: { type: 'string' },
        },
      },
    },
    added: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['family'],
        properties: { family: { type: 'string', enum: [...SECTION_FAMILY_IDS] }, reason: { type: 'string' } },
      },
    },
  },
});

export function coerceOutlinePlan(value) {
  const raw = isObject(value) ? value : Array.isArray(value) ? { steps: value } : {};
  const steps = list(pick(raw, 'steps', 'sections', 'flow', 'sequence'), 20).map((entry) => {
    if (!isObject(entry)) {
      const family = familyOf(entry);
      return family ? { requested: text(entry, 160), family, reason: '' } : null;
    }
    const family = familyOf(pick(entry, 'family', 'section', 'type'));
    if (!family) return null;
    return {
      requested: text(pick(entry, 'requested', 'line', 'input', 'label', 'title'), 160),
      family,
      reason: text(pick(entry, 'reason', 'why', 'note'), 240),
    };
  }).filter(Boolean);
  const added = list(pick(raw, 'added', 'additions', 'extra'), 4).map((entry) => {
    const family = familyOf(isObject(entry) ? pick(entry, 'family', 'section', 'type') : entry);
    if (!family) return null;
    return { family, reason: isObject(entry) ? text(pick(entry, 'reason', 'why'), 240) : '' };
  }).filter(Boolean);
  return {
    name: text(pick(raw, 'name', 'flowName', 'title'), 80),
    rationale: text(pick(raw, 'rationale', 'reason', 'summary'), 500),
    steps,
    added,
  };
}

/* ------------------------------------------------------------------ *
 * Parsers
 * ------------------------------------------------------------------ */

export function parseBriefFields(value) {
  return BriefFieldsSchema.parse(value && typeof value === 'object' ? value : {});
}

export function parseBriefUnderstanding(value) {
  return BriefUnderstandingSchema.parse(coerceBriefUnderstanding(value));
}

export function parsePageContent(value) {
  return PageContentSchema.parse(coercePageContent(value));
}

export function parseOutlinePlan(value) {
  return OutlinePlanSchema.parse(coerceOutlinePlan(value));
}

/**
 * How much of the brief is actually usable. The editor shows this before any
 * request is sent, so a strategist never spends model time on an empty brief.
 */
export function briefReadiness(fields) {
  const brief = parseBriefFields(fields);
  const filled = BRIEF_FIELD_ORDER.filter(([key]) => brief[key].length >= 3).map(([key]) => key);
  const missingRequired = BRIEF_REQUIRED_FIELDS.filter((key) => brief[key].length < 12);
  return {
    filled,
    missingRequired,
    // Two of the four load-bearing fields is the floor for a coherent page.
    ready: missingRequired.length <= 2,
    score: Math.round((filled.length / BRIEF_FIELD_ORDER.length) * 100),
  };
}

/* ------------------------------------------------------------------ *
 * Job 4 — Three design concepts from one paragraph of brief
 * ------------------------------------------------------------------ *
 * The simple builder asks a strategist for one textarea and nothing else, then
 * asks the model for three complete, visibly different concepts.
 *
 * A concept does not carry nine raw dial numbers. It names a quick style and may
 * nudge individual dials from there. Two reasons: the model picks a named mood
 * far more reliably than it invents nine coherent integers, and the named quick
 * styles are the vocabulary the advanced builder already exposes, so a concept
 * stays inspectable and editable after the handoff.
 */

export const CONCEPT_COUNT = 3;

const DIAL_NAMES = Object.freeze([
  'density', 'measure', 'headline', 'accent', 'surface', 'corner', 'imagery', 'motion', 'expressiveness',
]);

/*
 * A concept carries its own colours.
 *
 * It did not, and that was the single biggest gap between what a brief says and
 * what the three previews show: the palette came entirely from the archetype, so
 * a brief that asked for green and white produced whatever thirteen fixed
 * palettes happened to contain. The model now proposes five real colours per
 * concept, the deterministic brief parser still outranks it on anything the
 * strategist stated outright, and both go through the contrast repair before
 * they are allowed to paint anything.
 */
const HEX_COLOUR = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);

export const ConceptPaletteSchema = z.object({
  bg: HEX_COLOUR, ink: HEX_COLOUR, accent: HEX_COLOUR, soft: HEX_COLOUR, dark: HEX_COLOUR,
}).partial();

export const ConceptSchema = z.object({
  name: trimmed(60),
  archetypeKey: z.string().regex(/^[A-M]$/),
  preset: trimmed(40),
  buttonStyle: trimmed(40),
  dialOverrides: z.record(z.string(), z.number().min(0).max(100)).default({}),
  palette: ConceptPaletteSchema.default({}),
  paletteWhy: trimmed(240).default(''),
  why: trimmed(400),
});

export const ConceptSetSchema = z.object({
  readback: z.object({
    business: trimmed(400),
    audience: trimmed(400),
    offer: trimmed(400),
    goal: trimmed(400),
    voice: trimmed(240),
  }),
  fields: z.object({
    industry: optionalText(600),
    audience: optionalText(1_200),
    goal: optionalText(1_200),
    offer: optionalText(1_200),
    tone: optionalText(1_200),
    keywords: optionalText(600),
    clientName: optionalText(200),
  }),
  confidence: z.number().min(0).max(1),
  missingFields: z.array(z.string().max(40)).max(9).default([]),
  concepts: z.array(ConceptSchema).min(1).max(3),
  flows: z.array(z.object({
    id: z.string().max(12),
    reason: trimmed(400),
    fit: z.number().min(0).max(1),
  })).min(1).max(5),
});

/** Flat and enumerated: the shape the model reliably returns. */
export function buildConceptSetJsonSchema({ presets = [], buttonStyles = [], archetypes = [] } = {}) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['business', 'audience', 'offer', 'goal', 'voice', 'concepts', 'flows'],
    properties: {
      business: { type: 'string' },
      audience: { type: 'string' },
      offer: { type: 'string' },
      goal: { type: 'string' },
      voice: { type: 'string' },
      clientName: { type: 'string' },
      keywords: { type: 'array', items: { type: 'string' } },
      confidence: { type: 'number' },
      missingFields: { type: 'array', items: { type: 'string' } },
      concepts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'archetypeKey', 'preset', 'buttonStyle', 'palette', 'why'],
          properties: {
            name: { type: 'string' },
            archetypeKey: archetypes.length ? { type: 'string', enum: [...archetypes] } : { type: 'string' },
            preset: presets.length ? { type: 'string', enum: [...presets] } : { type: 'string' },
            buttonStyle: buttonStyles.length ? { type: 'string', enum: [...buttonStyles] } : { type: 'string' },
            why: { type: 'string' },
            paletteWhy: { type: 'string' },
            // Five named roles rather than a list, so the model cannot hand back
            // four colours and leave the page to guess which one is the ground.
            palette: {
              type: 'object',
              additionalProperties: false,
              required: ['bg', 'ink', 'accent', 'soft', 'dark'],
              properties: Object.fromEntries(['bg', 'ink', 'accent', 'soft', 'dark']
                .map((role) => [role, { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }])),
            },
            dialOverrides: {
              type: 'object',
              additionalProperties: false,
              properties: Object.fromEntries(DIAL_NAMES.map((name) => [name, { type: 'number' }])),
            },
          },
        },
      },
      flows: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'reason', 'fit'],
          properties: { id: { type: 'string' }, reason: { type: 'string' }, fit: { type: 'number' } },
        },
      },
    },
  };
}

/**
 * The five colour roles, from whatever shape the model chose to answer in.
 *
 * A partial answer is kept rather than thrown away: four good roles plus one
 * missing is far more useful than nothing, because the archetype fills the gap
 * and the repair pass guarantees the result is legible either way.
 */
function coerceConceptPalette(value) {
  const source = isObject(value) ? value : {};
  const alias = {
    bg: ['bg', 'background', 'canvas', 'page', 'base'],
    ink: ['ink', 'text', 'textColor', 'textColour', 'body', 'foreground'],
    accent: ['accent', 'brand', 'primary', 'highlight'],
    soft: ['soft', 'surface', 'muted', 'secondary', 'support'],
    dark: ['dark', 'inverted', 'deep', 'contrast', 'footer'],
  };
  const out = {};
  for (const [role, keys] of Object.entries(alias)) {
    const hex = text(pick(source, ...keys), 9).trim();
    const match = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
    if (!match) continue;
    out[role] = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  }
  return out;
}

function coerceDialOverrides(value) {
  const source = isObject(value) ? value : {};
  const out = {};
  for (const name of DIAL_NAMES) {
    const number = Number(source[name]);
    if (Number.isFinite(number)) out[name] = Math.max(0, Math.min(100, Math.round(number)));
  }
  return out;
}

export function coerceConceptSet(value) {
  const raw = isObject(value) ? value : {};
  const readback = isObject(raw.readback) ? raw.readback : raw;
  const business = text(pick(readback, 'business', 'whatTheBusinessDoes', 'company', 'industry'), 600);
  const audience = text(pick(readback, 'audience', 'primaryAudience', 'who'), 1_200);
  const offer = text(pick(readback, 'offer', 'coreOffer', 'proposition'), 1_200);
  const goal = text(pick(readback, 'goal', 'primaryGoal', 'pageGoal', 'action'), 1_200);
  const voice = text(pick(readback, 'voice', 'tone', 'voiceAndTone'), 1_200);
  const keywords = list(pick(raw, 'keywords', 'themes'), 12).map((entry) => text(entry, 48)).filter(Boolean);

  const concepts = list(pick(raw, 'concepts', 'versions', 'options', 'directions'), 3).map((entry) => {
    if (!isObject(entry)) return null;
    const key = text(pick(entry, 'archetypeKey', 'archetype', 'archetype_key'), 40).toUpperCase().match(/\b([A-M])\b/);
    return {
      name: text(pick(entry, 'name', 'title', 'label'), 60),
      archetypeKey: key ? key[1] : '',
      preset: text(pick(entry, 'preset', 'quickStyle', 'style', 'mood'), 40).toLowerCase().replace(/[^a-z-]/g, ''),
      buttonStyle: text(pick(entry, 'buttonStyle', 'buttons', 'buttonFamily'), 40).toLowerCase().replace(/[^a-z-]/g, ''),
      dialOverrides: coerceDialOverrides(pick(entry, 'dialOverrides', 'dials', 'overrides')),
      palette: coerceConceptPalette(pick(entry, 'palette', 'colours', 'colors')),
      paletteWhy: text(pick(entry, 'paletteWhy', 'colourWhy', 'colorWhy'), 240),
      why: text(pick(entry, 'why', 'reason', 'rationale'), 400),
    };
  }).filter((entry) => entry && entry.archetypeKey);

  const flows = list(pick(raw, 'flows', 'pageFlows', 'recommendedFlows'), 6).map((entry) => {
    if (!isObject(entry)) return { id: text(entry, 12), reason: '', fit: 0.6 };
    return {
      id: text(pick(entry, 'id', 'flowId', 'flow'), 12),
      reason: text(pick(entry, 'reason', 'why', 'rationale'), 400),
      fit: ratio(pick(entry, 'fit', 'score', 'match'), 0.6),
    };
  }).filter((entry) => entry.id);

  return {
    readback: { business, audience, offer, goal, voice: text(voice, 240) },
    // The advanced builder needs the same paragraph split into its own fields.
    fields: {
      industry: business,
      audience,
      goal,
      offer,
      tone: voice,
      keywords: keywords.join(', '),
      clientName: text(pick(raw, 'clientName', 'client', 'brand'), 200),
    },
    confidence: ratio(pick(raw, 'confidence', 'certainty'), 0.6),
    missingFields: list(pick(raw, 'missingFields', 'missing'), 9).map((entry) => text(entry, 40)).filter(Boolean),
    concepts,
    flows,
  };
}

export function parseConceptSet(value) {
  return ConceptSetSchema.parse(coerceConceptSet(value));
}

/* ------------------------------------------------------------------ *
 * Job 5 — Split one paragraph into the advanced builder's brief fields
 * ------------------------------------------------------------------ */

export const BriefExpansionSchema = z.object({
  projectName: optionalText(200),
  clientName: optionalText(200),
  industry: optionalText(600),
  audience: optionalText(1_200),
  goal: optionalText(1_200),
  offer: optionalText(1_200),
  tone: optionalText(1_200),
  keywords: optionalText(600),
  notes: optionalText(BRIEF_NOTES_LIMIT),
});

export const BriefExpansionJsonSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['industry', 'audience', 'goal', 'offer', 'tone'],
  properties: {
    projectName: { type: 'string' },
    clientName: { type: 'string' },
    industry: { type: 'string' },
    audience: { type: 'string' },
    goal: { type: 'string' },
    offer: { type: 'string' },
    tone: { type: 'string' },
    keywords: { type: 'string' },
    notes: { type: 'string' },
  },
});

export function coerceBriefExpansion(value) {
  const raw = isObject(value) ? value : {};
  const asText = (...keys) => text(pick(raw, ...keys), 1_200);
  const keywords = pick(raw, 'keywords', 'themes', 'usefulWords');
  return {
    projectName: text(pick(raw, 'projectName', 'project', 'name'), 200),
    clientName: text(pick(raw, 'clientName', 'client', 'brand'), 200),
    industry: asText('industry', 'context', 'business', 'sector'),
    audience: asText('audience', 'primaryAudience', 'who'),
    goal: asText('goal', 'pageGoal', 'primaryGoal', 'action'),
    offer: asText('offer', 'coreOffer', 'proposition', 'services'),
    tone: asText('tone', 'voice', 'voiceAndTone'),
    keywords: Array.isArray(keywords) ? keywords.map((entry) => text(entry, 48)).filter(Boolean).join(', ') : text(keywords, 600),
    notes: text(pick(raw, 'notes', 'internalNotes', 'extra'), 2_000),
  };
}

export function parseBriefExpansion(value) {
  return BriefExpansionSchema.parse(coerceBriefExpansion(value));
}
