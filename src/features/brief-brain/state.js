import { SECTION_FAMILY_IDS, sectionFamilyLabel } from '../../../shared/brief/families.mjs';
import { BRIEF_FIELD_ORDER, BRIEF_TEXT_LIMIT, briefReadiness } from '../../../shared/brief/schemas.mjs';

export const BRAIN_SCHEMA_VERSION = 'sbs-brief-brain/1.0';

export { BRIEF_FIELD_ORDER, BRIEF_TEXT_LIMIT, briefReadiness, SECTION_FAMILY_IDS, sectionFamilyLabel };

/**
 * The Brief Brain's client state. It lives on the project so a strategist can
 * close the tab and still see what the brain read, what it recommended and
 * whether the draft on the page came from the model or the built-in planner.
 */
const BRAIN_DEFAULTS = Object.freeze({
  schemaVersion: BRAIN_SCHEMA_VERSION,
  status: 'idle',
  understanding: null,
  understoodAt: '',
  understoodFrom: '',
  contentDraft: null,
  contentAppliedAt: '',
  outline: '',
  outlinePlan: null,
  error: '',
  errorCode: '',
  liveMessage: '',
  // The typed-outline section reference starts open: a strategist who has not
  // written an outline yet is the one who needs to see what is available.
  outlineReferenceOpen: true,
});

const BRAIN_STATUSES = new Set(['idle', 'reading', 'writing', 'planning', 'ready', 'error']);

/**
 * Which state slices have a request genuinely in flight *right now*.
 *
 * The busy status is persisted with the project, so a reload used to be able to
 * leave a slice stuck on "reading" and disable its only button forever. The
 * guard against that used to run on every `ensure*` call — which also erased the
 * status a render was about to draw, so no job could ever show that it was
 * working. This registry is the missing distinction: it lives in memory only, so
 * a slice restored from storage is never in it, while a slice this session put to
 * work is. A WeakSet is safe because `ensure*` fills each slice in place and
 * never replaces the object.
 */
const BRAIN_BUSY_STATUSES = ['reading', 'writing', 'planning'];
const SIMPLE_BUSY_STATUSES = ['reading'];
const MEDIA_BUSY_STATUSES = ['searching'];

const LIVE_FLAG = '__jobInFlight';

/** Called when a request starts, so renders may draw the working state. */
export function beginJob(slice) {
  // Non-enumerable, so `JSON.stringify` never writes it to storage and a slice
  // restored from a previous session cannot come back claiming to be busy.
  if (slice) Object.defineProperty(slice, LIVE_FLAG, { value: true, enumerable: false, configurable: true, writable: true });
  return slice;
}

/** Called when a request settles, whichever way it went. */
export function endJob(slice) {
  if (slice) delete slice[LIVE_FLAG];
  return slice;
}

/** True when this slice is mid-flight in this session, not merely persisted so. */
function isLive(slice, busyStatuses) {
  return Boolean(slice?.[LIVE_FLAG]) && busyStatuses.includes(slice.status);
}

/** Drops a stale busy status left behind by a reload, and only that. */
function settleStaleStatus(slice, busyStatuses) {
  if (busyStatuses.includes(slice.status) && !slice[LIVE_FLAG]) {
    slice.status = 'idle';
    // The stage belongs to a run that is no longer happening.
    if (slice.stage) slice.stage = '';
  }
}

export function ensureBrainState(project) {
  if (!project || typeof project !== 'object') return null;
  // Filled in place, never replaced: a render happens while a request is still
  // in flight, and replacing the object would detach the pending write.
  const brain = project.brain && typeof project.brain === 'object' ? project.brain : (project.brain = {});
  for (const [key, value] of Object.entries(BRAIN_DEFAULTS)) {
    if (brain[key] === undefined) brain[key] = value;
  }
  brain.schemaVersion = BRAIN_SCHEMA_VERSION;
  if (!brain.provider || typeof brain.provider !== 'object') brain.provider = { configured: null, available: null, model: '' };
  if (!brain.provider.stock || typeof brain.provider.stock !== 'object') {
    brain.provider.stock = { configured: null, available: null, images: 0, videos: 0 };
  }
  if (!BRAIN_STATUSES.has(brain.status)) brain.status = 'idle';
  settleStaleStatus(brain, BRAIN_BUSY_STATUSES);
  return brain;
}

export function isBrainBusy(brain) {
  return isLive(brain, BRAIN_BUSY_STATUSES);
}

export function brainStatusLabel(brain) {
  if (!brain) return 'Not ready';
  if (brain.status === 'reading') return 'Reading the brief…';
  if (brain.status === 'writing') return 'Writing the page…';
  if (brain.status === 'planning') return 'Planning the flow…';
  if (brain.status === 'error') return 'Needs attention';
  if (brain.understanding) return brain.understanding.source === 'ai' ? 'Brief understood' : 'Planned without the model';
  if (brain.provider?.configured === false) return 'Model not configured';
  if (brain.provider?.available === false) return 'Model unreachable';
  return 'Ready to read the brief';
}

/** A stable signature of the brief, so we can tell the strategist it changed. */
export function briefSignature(brief) {
  return BRIEF_FIELD_ORDER.map(([key]) => String(brief?.[key] ?? '').trim()).join('');
}

export function understandingIsStale(brain, brief) {
  if (!brain?.understanding || !brain.understoodFrom) return false;
  return brain.understoodFrom !== briefSignature(brief);
}

/** The exact request payload for the "read my brief" job. */
export function buildUnderstandRequest({ project, archetypes, flows }) {
  return {
    brief: Object.fromEntries(BRIEF_FIELD_ORDER.map(([key]) => [key, String(project?.brief?.[key] ?? '')])),
    archetypes: Object.entries(archetypes || {}).map(([key, value]) => ({
      key,
      name: value?.name || key,
      polarity: value?.polarity || '',
      // The catalog notes carry internal handoff instructions. Send only the
      // first sentence plus the palette intent: that is the design contract.
      summary: [String(value?.notes || '').split(/(?<=\.)\s/)[0] || '', value?.paletteIntent || ''].filter(Boolean).join(' ').slice(0, 240),
      // The colours this archetype ships with. The brain designs a palette per
      // concept from the brief, and "different from the other two" and "still
      // recognisably this archetype" are both judgements it cannot make blind.
      palette: value?.palette && typeof value.palette === 'object'
        ? Object.fromEntries(['bg', 'ink', 'accent', 'soft', 'dark']
          .map((role) => [role, String(value.palette[role] || '')])
          .filter(([, hex]) => /^#[0-9a-fA-F]{6}$/.test(hex)))
        : undefined,
    })),
    flows: (flows || []).map((flow) => ({
      id: flow.id, name: flow.name, tagline: flow.tagline, bestFor: flow.bestFor, families: flow.families,
    })),
  };
}

export function buildContentRequest({ project, families }) {
  return {
    brief: Object.fromEntries(BRIEF_FIELD_ORDER.map(([key]) => [key, String(project?.brief?.[key] ?? '')])),
    families: (families || []).filter((family) => SECTION_FAMILY_IDS.includes(family)),
  };
}

export const SIMPLE_SCHEMA_VERSION = 'sbs-simple-builder/1.0';

/**
 * The simple builder's own project slice.
 *
 * It holds one paragraph of brief and the three concepts the brain produced from
 * it. Concepts live here — not in `design` — precisely so that switching between
 * V1, V2 and V3 replaces only the design slice and can never disturb sections,
 * content, flow or globals.
 */
export function ensureSimpleState(project) {
  if (!project || typeof project !== 'object') return null;
  const simple = project.simple && typeof project.simple === 'object' ? project.simple : (project.simple = {});
  const defaults = {
    schemaVersion: SIMPLE_SCHEMA_VERSION,
    briefText: '',
    // Documents the strategist attached rather than pasted. The words are the
    // brain's; the file name is the person's. See `briefSourceText`.
    briefFiles: [],
    status: 'idle',
    error: '',
    errorCode: '',
    liveMessage: '',
    // Which of the one button's four jobs is running, and what all four of them
    // achieved. The stage drives the progress list; the report is what the panel
    // shows afterwards instead of leaving the counts to a toast that has gone.
    stage: '',
    report: null,
    readback: null,
    fields: null,
    confidence: 0,
    missingFields: [],
    concepts: [],
    active: null,
    flows: [],
    // What the paragraph stated outright about colour, type and scale. Kept so
    // the panel can say which parts of the design were not the brain's choice.
    directives: null,
    source: '',
    degraded: null,
    model: '',
    generatedAt: '',
    generatedFrom: '',
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (simple[key] === undefined) simple[key] = value;
  }
  simple.schemaVersion = SIMPLE_SCHEMA_VERSION;
  if (!Array.isArray(simple.concepts)) simple.concepts = [];
  if (!Array.isArray(simple.flows)) simple.flows = [];
  if (!Array.isArray(simple.briefFiles)) simple.briefFiles = [];
  if (!['idle', 'reading', 'ready', 'error'].includes(simple.status)) simple.status = 'idle';
  settleStaleStatus(simple, SIMPLE_BUSY_STATUSES);
  // `null` means "nothing chosen yet", and that is the exit condition for the
  // first step. It has to be tested before any coercion, because `Number(null)`
  // is 0 and would silently pre-select the first concept.
  const active = simple.active === null || simple.active === undefined ? null : Number(simple.active);
  simple.active = Number.isInteger(active) && active >= 0 && active < simple.concepts.length ? active : null;
  return simple;
}

export function isSimpleBusy(simple) {
  return isLive(simple, SIMPLE_BUSY_STATUSES);
}

/** True once the strategist has actually chosen one of the three. */
export function hasChosenConcept(simple) {
  return Boolean(simple && simple.concepts.length && simple.active !== null);
}

/* ---------------------------------------------------------------- *
 * What "the brief" is
 *
 * A brief arrives two ways: typed into the box, or handed over as a PDF or a
 * Word document. Those are the same brief, and only one of them belongs in the
 * textarea — pasting three pages of a client's PDF into a box the strategist is
 * meant to read and edit buries their own words in it, and the box is not where
 * a document goes. A document is *attached*: it shows as its own name, and its
 * words go straight to the brain.
 *
 * So the typed paragraph and the attachments are stored separately and joined
 * here, in one place, because everything downstream has to agree on the answer:
 * the request the brain receives, the length the button is gated on, the counter,
 * and the comparison that decides whether the concepts have gone stale.
 * ---------------------------------------------------------------- */

/** The documents attached to the brief, oldest first. */
export function briefAttachments(project) {
  const files = project?.simple?.briefFiles;
  return Array.isArray(files) ? files.filter((entry) => entry && entry.name) : [];
}

/**
 * The whole brief, as the brain reads it.
 *
 * Each document is announced by name before its words. The model is being asked
 * to weigh several sources, and an unlabelled wall of concatenated text hides
 * which sentence came from the client's own brief and which from a rate card
 * that happened to be in the same folder.
 */
export function briefSourceText(project) {
  const typed = String(project?.simple?.briefText || '').trim();
  const parts = typed ? [typed] : [];
  for (const file of briefAttachments(project)) {
    const text = String(file.text || '').trim();
    if (text) parts.push(`--- ${file.name} ---\n${text}`);
  }
  return parts.join('\n\n').slice(0, BRIEF_TEXT_LIMIT);
}

/** How much brief there is, typed and attached together. */
export function briefSourceLength(project) {
  return briefSourceText(project).length;
}

/**
 * Whether the concepts predate the brief they were built from.
 *
 * Takes the project rather than the slice, because a brief is now a paragraph
 * *and* its attachments: removing a document has to make the concepts stale
 * exactly as editing the paragraph does. The slice is still accepted, so an
 * older caller keeps working on the typed text alone.
 */
export function conceptsAreStale(input) {
  const simple = input && input.simple ? ensureSimpleState(input) : input;
  if (!simple?.concepts.length || !simple.generatedFrom) return false;
  const source = input && input.simple ? briefSourceText(input) : String(simple.briefText || '').trim();
  return simple.generatedFrom !== source;
}

export function buildConceptsRequest({ project, archetypes, flows }) {
  const understand = buildUnderstandRequest({ project, archetypes, flows });
  return {
    briefText: briefSourceText(project),
    archetypes: understand.archetypes,
    flows: understand.flows,
  };
}

export function buildExpandRequest(briefText) {
  return { briefText: String(briefText || '').slice(0, BRIEF_TEXT_LIMIT) };
}

export const MEDIA_SCHEMA_VERSION = 'sbs-brief-media/1.0';

/**
 * The stock media slice.
 *
 * It holds the pool of watermarked previews the brain found for this brief and
 * which slot each one was placed in. It lives on the project — not on the
 * sections — so the editor's picker can offer the whole set on every module and
 * still show which pictures are already spoken for.
 */
export function ensureMediaState(project) {
  if (!project || typeof project !== 'object') return null;
  const media = project.media && typeof project.media === 'object' ? project.media : (project.media = {});
  const defaults = {
    schemaVersion: MEDIA_SCHEMA_VERSION,
    status: 'idle',
    error: '',
    errorCode: '',
    liveMessage: '',
    assets: [],
    assignments: [],
    unassigned: [],
    queries: null,
    source: '',
    degraded: null,
    provider: '',
    model: '',
    notice: '',
    generatedAt: '',
    generatedFrom: '',
    // The "I already found the shot" path: an id typed in by hand, and the state
    // of the single lookup it triggers. Kept apart from `status` so fetching one
    // asset never looks like the whole page is being re-imaged.
    assetIdQuery: '',
    lookupStatus: 'idle',
    lookupError: '',
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (media[key] === undefined) media[key] = value;
  }
  media.schemaVersion = MEDIA_SCHEMA_VERSION;
  if (!Array.isArray(media.assets)) media.assets = [];
  if (!Array.isArray(media.assignments)) media.assignments = [];
  if (!Array.isArray(media.unassigned)) media.unassigned = [];
  if (!['idle', 'searching', 'ready', 'error'].includes(media.status)) media.status = 'idle';
  // A reload mid-lookup must not leave the button spinning forever.
  if (media.lookupStatus === 'loading') media.lookupStatus = 'idle';
  if (!['idle', 'loading', 'error'].includes(media.lookupStatus)) media.lookupStatus = 'idle';
  settleStaleStatus(media, MEDIA_BUSY_STATUSES);
  return media;
}

export function isMediaBusy(media) {
  return isLive(media, MEDIA_BUSY_STATUSES);
}

export function hasStockMedia(media) {
  return Boolean(media?.assets?.length);
}

/** The brief the imagery was searched from, so we can say when it has moved on. */
export function mediaIsStale(media, brief) {
  if (!media?.assets?.length || !media.generatedFrom) return false;
  return media.generatedFrom !== briefSignature(brief);
}

export function buildMediaRequest({ project, slots }) {
  return {
    brief: Object.fromEntries(BRIEF_FIELD_ORDER.map(([key]) => [key, String(project?.brief?.[key] ?? '')])),
    // The simple builder has one paragraph and may have no fields yet; the
    // server splits it rather than searching on an empty brief.
    briefText: briefSourceText(project),
    slots: (slots || []).slice(0, 48),
  };
}

export function buildOutlineRequest({ project, outline }) {
  return {
    brief: Object.fromEntries(BRIEF_FIELD_ORDER.map(([key]) => [key, String(project?.brief?.[key] ?? '')])),
    outline: String(outline || '').slice(0, 2_000),
  };
}
