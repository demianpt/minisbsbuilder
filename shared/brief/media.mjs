import { z } from 'zod';
import { isSectionFamily } from './families.mjs';

/**
 * Media direction contracts.
 *
 * The media job runs in two halves. First the brain turns the brief into stock
 * search phrases; then, once the server has real assets in hand, the brain
 * assigns one asset to each media slot on the page. Only the second half can
 * repeat itself into nonsense, so the rule from every other job holds here too:
 * the model chooses *which* asset goes *where*, and this module owns the
 * structure — the slot list, the no-repeat guarantee and the video placement.
 *
 * As everywhere else, each schema appears twice — a Zod validator and a flat
 * `*JsonSchema` for the model's `format` constraint — with a `coerce*` step in
 * front that repairs the shapes the hosted model actually produces.
 */

export const MEDIA_SCHEMA_VERSION = 'sbs-brief-media/1.0';

/**
 * People are not stock. A testimonial portrait or a team headshot has to be the
 * client's own photograph of their own colleague, so those slots keep the
 * built-in placeholder library and are never sent to the stock search.
 */
export const PEOPLE_FAMILIES = Object.freeze(['team', 'testimonial']);

/** Where a slot sits in a section, which decides whether video is possible. */
export const MEDIA_SLOT_ROLES = Object.freeze(['background', 'feature', 'card']);

export function isPeopleFamily(family) {
  return PEOPLE_FAMILIES.includes(String(family || ''));
}

/* ------------------------------------------------------------------ *
 * Shared helpers (same intent as schemas.mjs, kept local to this file)
 * ------------------------------------------------------------------ */

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value, max = 200) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map((entry) => text(entry, max)).filter(Boolean).join(' ').slice(0, max);
  if (isObject(value)) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

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
  if (isObject(value)) return [value];
  return [];
}

/* ------------------------------------------------------------------ *
 * Media slots — the page's demand for imagery
 * ------------------------------------------------------------------ */

const optionalText = (max) => z.string().max(max).optional().transform((value) => (value || '').trim());

export const MediaSlotSchema = z.object({
  key: z.string().min(1).max(120),
  sectionId: z.string().min(1).max(120),
  family: z.string().refine(isSectionFamily, 'family must be a registered DST section family'),
  role: z.enum(MEDIA_SLOT_ROLES),
  index: z.number().int().min(0).max(48),
  label: optionalText(160),
  allowsVideo: z.boolean().default(false),
});

/**
 * A hero's background and the lead visual of a full-height CTA are the two
 * places a moving image earns its bandwidth. Everything else reads better as a
 * still, so only these ask for one.
 */
export function slotPrefersVideo(slot) {
  if (!slot?.allowsVideo) return false;
  if (slot.family === 'hero') return slot.role === 'background' || (slot.role === 'feature' && slot.index === 0);
  if (slot.family === 'cta') return slot.role === 'background' && slot.index === 0;
  return false;
}

/** Video first, then the biggest surfaces, then document order. */
function slotPriority(slot) {
  const role = slot.role === 'background' ? 0 : slot.role === 'feature' ? 1 : 2;
  return [slotPrefersVideo(slot) ? 0 : 1, role, slot.index];
}

function bySlotPriority(a, b) {
  const left = slotPriority(a);
  const right = slotPriority(b);
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return String(a.key).localeCompare(String(b.key));
}

/* ------------------------------------------------------------------ *
 * Half one — search phrases
 * ------------------------------------------------------------------ */

export const MediaQueriesSchema = z.object({
  images: z.string().min(2).max(200).transform((value) => value.trim()),
  videos: z.string().min(2).max(200).transform((value) => value.trim()),
  avoid: optionalText(200),
});

export const MediaQueriesJsonSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['images', 'videos'],
  properties: {
    images: { type: 'string' },
    videos: { type: 'string' },
    avoid: { type: 'string' },
  },
});

export function coerceMediaQueries(value) {
  const raw = isObject(value) ? value : {};
  const asPhrase = (candidate) => (Array.isArray(candidate)
    ? candidate.map((entry) => text(entry, 60)).filter(Boolean).join(' ').slice(0, 200)
    : text(candidate, 200));
  return {
    images: asPhrase(pick(raw, 'images', 'imageQuery', 'imageQueries', 'photos', 'query')),
    videos: asPhrase(pick(raw, 'videos', 'videoQuery', 'videoQueries', 'footage', 'clips')),
    avoid: asPhrase(pick(raw, 'avoid', 'exclude', 'negative')),
  };
}

export function parseMediaQueries(value) {
  return MediaQueriesSchema.parse(coerceMediaQueries(value));
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'their', 'they', 'our', 'your', 'who', 'want', 'wants',
  'need', 'needs', 'will', 'have', 'has', 'are', 'was', 'were', 'about', 'into', 'more', 'most', 'very',
  'company', 'business', 'client', 'clients', 'customer', 'customers', 'page', 'website', 'site', 'brand',
]);

function keywordsOf(value, limit) {
  const seen = new Set();
  const out = [];
  for (const word of String(value || '').toLowerCase().split(/[^a-z0-9']+/)) {
    if (word.length < 4 || STOP_WORDS.has(word) || seen.has(word)) continue;
    seen.add(word);
    out.push(word);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * The deterministic twin of half one. Industry and offer describe the subject;
 * the strategist's own keywords sharpen it. Good enough that a missing model
 * never blocks the button.
 */
export function mediaQueriesFromBrief(brief = {}) {
  const subject = keywordsOf([brief.industry, brief.offer].filter(Boolean).join(' '), 4);
  const flavour = keywordsOf(brief.keywords, 2);
  // Three words is the ceiling, not a target. A stock library requires every
  // word to match, so a fourth adjective is how a search returns nothing.
  const words = [...new Set([...subject, ...flavour])].slice(0, 3);
  const phrase = words.join(' ') || text(brief.industry, 60).split(' ').slice(0, 3).join(' ') || 'professional business';
  return {
    images: phrase,
    // Footage searches reward one motion word; a still-life phrase returns
    // stock slideshows of photographs.
    videos: `${words.slice(0, 2).join(' ') || phrase} aerial`.trim().slice(0, 200),
    avoid: '',
  };
}

/**
 * Searches a stock library, widening the phrase until it finds something.
 *
 * A stock library requires *every* word in the query to match, so one adjective
 * too many returns an empty page rather than a looser match: "golf course
 * fairway sunrise" finds nothing where "golf course fairway" finds hundreds. A
 * photo researcher would drop the last word and look again, so that is what this
 * does — down to two words, reporting whichever phrase actually answered.
 */
export async function broadeningSearch(search, phrase, count) {
  const words = String(phrase || '').trim().split(/\s+/).filter(Boolean);
  for (let length = words.length; length >= 2; length -= 1) {
    const query = words.slice(0, length).join(' ');
    const results = await search(query, count);
    if (results.length) return { results, query, broadened: length !== words.length };
  }
  // A single word is the last thing worth trying; below that there is no query.
  if (words.length === 1) {
    const results = await search(words[0], count);
    if (results.length) return { results, query: words[0], broadened: false };
  }
  return { results: [], query: words.join(' '), broadened: false };
}

/* ------------------------------------------------------------------ *
 * Half two — one asset per slot
 * ------------------------------------------------------------------ */

export const MediaAssignmentSchema = z.object({
  assignments: z.array(z.object({
    slot: z.string().min(1).max(120),
    asset: z.string().min(1).max(120),
    reason: optionalText(200),
  })).max(64).default([]),
});

export const MediaAssignmentJsonSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['assignments'],
  properties: {
    assignments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['slot', 'asset'],
        properties: {
          slot: { type: 'string' },
          asset: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  },
});

export function coerceMediaAssignment(value) {
  const raw = isObject(value) ? value : Array.isArray(value) ? { assignments: value } : {};
  const assignments = list(pick(raw, 'assignments', 'plan', 'slots', 'media'), 64).map((entry) => {
    if (!isObject(entry)) return null;
    const slot = text(pick(entry, 'slot', 'slotKey', 'key', 'target'), 120);
    const asset = text(pick(entry, 'asset', 'assetId', 'id', 'media'), 120);
    if (!slot || !asset) return null;
    return { slot, asset, reason: text(pick(entry, 'reason', 'why', 'note'), 200) };
  }).filter(Boolean);
  return { assignments };
}

export function parseMediaAssignment(value) {
  return MediaAssignmentSchema.parse(coerceMediaAssignment(value));
}

/**
 * Resolve a final plan.
 *
 * `preferred` is the model's opinion and is honoured wherever it is legal: the
 * asset has to exist, a still may not land in a video-only decision the model
 * invented, and — the rule the whole feature turns on — **no asset may appear
 * twice**. Anything the model left out, duplicated or invented is filled in by
 * priority order, and slots left over once the assets run out are reported
 * rather than padded with a repeat.
 */
export function assignMedia({ slots = [], assets = [], preferred = [] } = {}) {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const slotByKey = new Map(slots.map((slot) => [slot.key, slot]));
  const usedAssets = new Set();
  const assignments = new Map();

  const take = (slotKey, assetId, reason) => {
    const slot = slotByKey.get(slotKey);
    const asset = byId.get(assetId);
    if (!slot || !asset) return false;
    if (assignments.has(slotKey) || usedAssets.has(assetId)) return false;
    if (asset.kind === 'video' && !slot.allowsVideo) return false;
    usedAssets.add(assetId);
    assignments.set(slotKey, { slotKey, assetId, kind: asset.kind, reason: text(reason, 200) });
    return true;
  };

  for (const entry of preferred) take(entry?.slot, entry?.asset, entry?.reason);

  const ordered = [...slots].sort(bySlotPriority);
  const videos = assets.filter((asset) => asset.kind === 'video' && !usedAssets.has(asset.id));
  const images = assets.filter((asset) => asset.kind === 'image' && !usedAssets.has(asset.id));

  // Videos are scarce and only some slots can hold one; place them before the
  // stills take the good positions.
  for (const slot of ordered) {
    if (!videos.length) break;
    if (assignments.has(slot.key) || !slotPrefersVideo(slot)) continue;
    take(slot.key, videos.shift().id, 'Motion suits the lead surface.');
  }
  for (const slot of ordered) {
    if (assignments.has(slot.key)) continue;
    const pool = images.length ? images : (slot.allowsVideo ? videos : []);
    if (!pool.length) continue;
    take(slot.key, pool.shift().id, 'Filled in slot order.');
  }

  const resolved = slots.map((slot) => assignments.get(slot.key)).filter(Boolean);
  return {
    assignments: resolved,
    unassigned: slots.filter((slot) => !assignments.has(slot.key)).map((slot) => slot.key),
  };
}
