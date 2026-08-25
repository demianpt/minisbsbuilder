/**
 * Concept workspaces.
 *
 * A project holds exactly three concept workspaces — V1, V2, V3. Each one is a
 * complete, independently editable website proposal: its own style, design
 * tokens, page flow, section list, header, footer, page metadata, media
 * placements and publish state. Switching between them is a pointer move, not a
 * copy, so no edit can be lost on the way out and none can leak on the way in.
 *
 * The rule this module exists to enforce
 * -------------------------------------
 * Before this, a concept owned a *slice* of `project.design` and switching
 * concepts meant reading values out of the live project and hoping to write them
 * back into the concept they came from (`captureConceptEdit`). Anything the
 * capture list did not name — a section, a pattern choice, a mobile column count
 * — was silently shared between all three concepts, and anything it named
 * incorrectly was silently lost.
 *
 * The fix is structural rather than procedural: `bindProject` installs accessors
 * on the project for every concept-owned key, and those accessors resolve
 * through `conceptSet.activeConceptId` on every read and every write. So
 * `project.sections.push(...)` in five-thousand lines of existing editor code
 * writes into the active concept and nowhere else, and there is no moment at
 * which a value exists in the project but not yet in a concept. Nothing has to
 * be captured because nothing was ever detached.
 *
 * What is shared and what is owned
 * --------------------------------
 * Shared, at project level: client identity, the original brief, the AI brief
 * analysis, the available media pool, project notes and recommendation results.
 * Those describe the *source material*, which is the same whichever proposal you
 * are looking at.
 *
 * Owned, per concept: everything that decides what the website looks like. See
 * `CONCEPT_SLICE_KEYS`.
 */

export const CONCEPT_SET_SCHEMA_VERSION = 'sbs-concept-set/1.0';

export const CONCEPT_SLOTS = Object.freeze(['V1', 'V2', 'V3']);
export const CONCEPT_IDS = Object.freeze(['v1', 'v2', 'v3']);

/** How each slot is initially derived from the one selected style. */
export const CONCEPT_VARIANTS = Object.freeze([
  Object.freeze({ id: 'v1', slot: 'V1', name: 'Core', variantType: 'core' }),
  Object.freeze({ id: 'v2', slot: 'V2', name: 'Brand-led', variantType: 'brand-led' }),
  Object.freeze({ id: 'v3', slot: 'V3', name: 'Expressive', variantType: 'expressive' }),
]);

export const CONCEPT_VARIANT_TYPES = Object.freeze(CONCEPT_VARIANTS.map((variant) => variant.variantType));

/**
 * The keys a concept owns.
 *
 * Every one of these is mirrored onto the project by `bindProject`, so existing
 * code that reads `project.design` or mutates `project.sections` is reading and
 * mutating the active concept. Adding a key here is the entire cost of making a
 * new piece of state concept-specific.
 */
export const CONCEPT_SLICE_KEYS = Object.freeze([
  'style',
  'design',
  'flowId',
  'sections',
  'header',
  'footer',
  'page',
  'manualOverrides',
]);

/**
 * Concept-owned state that lives inside a shared project object rather than
 * directly on the project. Media is the case that matters: the *pool* of
 * licensed-preview assets is project-level and shared, while which asset is
 * placed in which slot belongs to the concept that placed it.
 */
export const NESTED_CONCEPT_BINDINGS = Object.freeze([
  Object.freeze({ container: 'media', property: 'assignments', conceptKey: 'mediaAssignments', fallback: () => [] }),
]);

/** Project keys that are never concept-specific. */
export const PROJECT_SHARED_KEYS = Object.freeze([
  'schemaVersion', 'id', 'projectId', 'client', 'brief', 'brain', 'media', 'simple', 'notes', 'conceptSet',
]);

const CONCEPT_STATUSES = Object.freeze(['empty', 'generated']);

export function cloneValue(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value, max = 200) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function nowIso() {
  return new Date().toISOString();
}

function variantForIndex(index) {
  return CONCEPT_VARIANTS[index] || { id: `v${index + 1}`, slot: `V${index + 1}`, name: `Concept ${index + 1}`, variantType: 'core' };
}

/** Normalizes an id, a slot or an index into a concept id. */
export function conceptIdFrom(value, { fallback = '' } = {}) {
  if (Number.isInteger(value)) return CONCEPT_IDS[value] || fallback;
  const raw = text(value, 12).toLowerCase();
  if (!raw) return fallback;
  if (CONCEPT_IDS.includes(raw)) return raw;
  const slotIndex = CONCEPT_SLOTS.findIndex((slot) => slot.toLowerCase() === raw);
  if (slotIndex >= 0) return CONCEPT_IDS[slotIndex];
  const digits = raw.match(/^v?([1-9])$/);
  if (digits) return CONCEPT_IDS[Number(digits[1]) - 1] || fallback;
  return fallback;
}

export function conceptIndexOf(conceptId) {
  return CONCEPT_IDS.indexOf(conceptIdFrom(conceptId));
}

/** Blank publish metadata. A concept is unpublished until a snapshot exists. */
export function createPublishState() {
  return {
    shareId: '',
    status: 'unpublished',
    publishedRevision: 0,
    publishedAt: '',
    updatedAt: '',
    expiresAt: null,
  };
}

/** The style reference a concept resolves its design from. */
export function createStyleRef(overrides = {}) {
  const source = isObject(overrides) ? overrides : {};
  return {
    familyId: text(source.familyId, 60),
    styleId: text(source.styleId, 80),
    styleVersion: text(source.styleVersion, 20) || '1.0.0',
    variantType: CONCEPT_VARIANT_TYPES.includes(source.variantType) ? source.variantType : 'core',
    // Kept for the 13 A–M archetypes the current catalogue ships, which remain
    // the design source until a style profile is selected for the concept.
    archetypeKey: text(source.archetypeKey, 8).toUpperCase(),
    preset: text(source.preset, 40),
  };
}

/** Page-level metadata and SEO fields, owned per concept. */
export function createPageState(overrides = {}) {
  const source = isObject(overrides) ? overrides : {};
  return {
    title: text(source.title, 160),
    slug: text(source.slug, 96),
    metaTitle: text(source.metaTitle, 160),
    metaDescription: text(source.metaDescription, 320),
    ...(isObject(source.seo) ? { seo: cloneValue(source.seo) } : {}),
  };
}

/**
 * One concept workspace.
 *
 * Slices are taken by reference-free clone: a concept must never share a mutable
 * object with the concept it was derived from, or an edit to one would appear in
 * the other and the isolation guarantee would be a comment rather than a fact.
 */
export function createConcept({
  id = 'v1',
  slot = '',
  name = '',
  variantType = '',
  status = 'empty',
  style = {},
  design = {},
  flowId = '',
  sections = [],
  header = {},
  footer = {},
  page = {},
  mediaAssignments = [],
  manualOverrides = {},
  publish = null,
  revision = 1,
  createdAt = '',
  updatedAt = '',
  generatedFrom = null,
  why = '',
} = {}) {
  const resolvedId = conceptIdFrom(id, { fallback: 'v1' });
  const variant = variantForIndex(Math.max(0, conceptIndexOf(resolvedId)));
  const timestamp = createdAt || nowIso();
  return {
    id: resolvedId,
    slot: text(slot, 8) || variant.slot,
    name: text(name, 60) || variant.name,
    variantType: CONCEPT_VARIANT_TYPES.includes(variantType) ? variantType : variant.variantType,
    status: CONCEPT_STATUSES.includes(status) ? status : 'empty',
    style: createStyleRef(style),
    design: cloneValue(design) ?? {},
    flowId: text(flowId, 40),
    sections: Array.isArray(sections) ? cloneValue(sections) : [],
    header: cloneValue(header) ?? {},
    footer: cloneValue(footer) ?? {},
    page: createPageState(page),
    mediaAssignments: Array.isArray(mediaAssignments) ? cloneValue(mediaAssignments) : [],
    manualOverrides: cloneValue(manualOverrides) ?? {},
    publish: publish ? { ...createPublishState(), ...cloneValue(publish) } : createPublishState(),
    revision: Number.isFinite(Number(revision)) && Number(revision) > 0 ? Math.floor(Number(revision)) : 1,
    createdAt: timestamp,
    updatedAt: updatedAt || timestamp,
    // The exact workspace this concept was generated as, so "reset to the
    // generated version" is a real operation rather than a re-derivation that
    // would also discard the style the strategist has since chosen.
    generatedFrom: generatedFrom ? cloneValue(generatedFrom) : null,
    why: text(why, 400),
  };
}

/** Records an edit against a concept. Cheap enough to call on every mutation. */
export function touchConcept(concept) {
  if (!isObject(concept)) return concept;
  concept.revision = (Number(concept.revision) || 0) + 1;
  concept.updatedAt = nowIso();
  return concept;
}

/** True when the editor has moved past the revision that was last published. */
export function conceptHasDraftChanges(concept) {
  if (!isObject(concept) || !isObject(concept.publish)) return false;
  if (concept.publish.status !== 'published') return false;
  return Number(concept.publish.publishedRevision || 0) < Number(concept.revision || 0);
}

export function conceptPublishLabel(concept) {
  if (!isObject(concept) || !isObject(concept.publish)) return 'Not published';
  if (concept.publish.status !== 'published') return 'Not published';
  return conceptHasDraftChanges(concept) ? 'Draft changes' : 'Published';
}

/**
 * Creates the three-concept set. `base` seeds V1 — the working concept — and
 * V2/V3 start empty so a project migrated from an older version never presents
 * a client with three altered copies of work they already approved.
 */
export function createConceptSet({ base = {}, activeConceptId = 'v1', concepts = null } = {}) {
  const set = {
    schemaVersion: CONCEPT_SET_SCHEMA_VERSION,
    activeConceptId: 'v1',
    concepts: {},
  };
  if (isObject(concepts)) {
    for (const variant of CONCEPT_VARIANTS) {
      set.concepts[variant.id] = createConcept({ ...(concepts[variant.id] || {}), id: variant.id });
    }
  } else {
    set.concepts.v1 = createConcept({ ...base, id: 'v1', status: 'generated' });
    set.concepts.v2 = createConcept({ id: 'v2' });
    set.concepts.v3 = createConcept({ id: 'v3' });
  }
  set.activeConceptId = conceptIdFrom(activeConceptId, { fallback: 'v1' });
  if (set.concepts[set.activeConceptId]?.status !== 'generated') set.activeConceptId = 'v1';
  return set;
}

export function ensureConceptSet(project) {
  if (!isObject(project)) return null;
  if (!isObject(project.conceptSet) || !isObject(project.conceptSet.concepts)) {
    project.conceptSet = createConceptSet({ base: readLegacySlices(project) });
    return project.conceptSet;
  }
  const set = project.conceptSet;
  set.schemaVersion = CONCEPT_SET_SCHEMA_VERSION;
  for (const variant of CONCEPT_VARIANTS) {
    const existing = set.concepts[variant.id];
    set.concepts[variant.id] = isObject(existing)
      ? createConcept({ ...existing, id: variant.id })
      : createConcept({ id: variant.id });
  }
  // Drop anything that is not one of the three slots rather than carrying an
  // orphan workspace nothing can select.
  for (const key of Object.keys(set.concepts)) {
    if (!CONCEPT_IDS.includes(key)) delete set.concepts[key];
  }
  set.activeConceptId = conceptIdFrom(set.activeConceptId, { fallback: 'v1' });
  if (set.concepts[set.activeConceptId]?.status !== 'generated') {
    const firstGenerated = CONCEPT_IDS.find((id) => set.concepts[id]?.status === 'generated');
    set.activeConceptId = firstGenerated || 'v1';
    if (!firstGenerated) set.concepts.v1.status = 'generated';
  }
  return set;
}

/** The slices a pre-3.0 project carried directly on the project object. */
function readLegacySlices(project) {
  return {
    style: createStyleRef({
      archetypeKey: project?.design?.archetype,
      preset: project?.design?.preset,
    }),
    design: isObject(project?.design) ? project.design : {},
    flowId: project?.flowId || '',
    sections: Array.isArray(project?.sections) ? project.sections : [],
    header: isObject(project?.header) ? project.header : {},
    footer: isObject(project?.footer) ? project.footer : {},
    page: createPageState({
      title: project?.brief?.projectName || '',
      metaTitle: project?.brief?.projectName || '',
      metaDescription: project?.brief?.goal || '',
    }),
    mediaAssignments: Array.isArray(project?.media?.assignments) ? project.media.assignments : [],
    status: 'generated',
  };
}

export function getActiveConceptId(project) {
  const set = isObject(project) ? project.conceptSet : null;
  if (!isObject(set)) return '';
  return conceptIdFrom(set.activeConceptId, { fallback: 'v1' });
}

/**
 * The single selector every concept-sensitive operation must route through.
 *
 * Exporters, the preview renderer, the media editor and the advanced inspector
 * are forbidden from inferring which concept is active from anything else.
 */
export function getActiveConcept(project) {
  const set = isObject(project) ? project.conceptSet : null;
  if (!isObject(set) || !isObject(set.concepts)) return null;
  return set.concepts[getActiveConceptId(project)] || null;
}

export function getConcept(project, conceptId) {
  const set = isObject(project) ? project.conceptSet : null;
  if (!isObject(set) || !isObject(set.concepts)) return null;
  return set.concepts[conceptIdFrom(conceptId)] || null;
}

/** Every concept in slot order, whatever its status. */
export function listConcepts(project) {
  const set = isObject(project) ? project.conceptSet : null;
  if (!isObject(set) || !isObject(set.concepts)) return [];
  return CONCEPT_IDS.map((id) => set.concepts[id]).filter(Boolean);
}

/** The concepts a strategist can actually switch to. */
export function listGeneratedConcepts(project) {
  return listConcepts(project).filter((concept) => concept.status === 'generated');
}

export function hasGeneratedConceptSet(project) {
  return listGeneratedConcepts(project).length >= CONCEPT_IDS.length;
}

/**
 * Switches the active concept.
 *
 * There is nothing to save on the way out: the editor has been writing into this
 * concept all along. Returns the id actually activated, which may be the current
 * one if the requested concept does not exist or has not been generated.
 */
export function setActiveConcept(project, conceptId) {
  const set = ensureConceptSet(project);
  if (!set) return '';
  const next = conceptIdFrom(conceptId);
  const concept = next ? set.concepts[next] : null;
  if (!concept || concept.status !== 'generated') return set.activeConceptId;
  set.activeConceptId = next;
  return next;
}

/* ------------------------------------------------------------------ *
 * Binding: the project is a live view of the active concept
 * ------------------------------------------------------------------ */

const BOUND = Symbol.for('sbs.conceptSet.bound');

function defineConceptAccessor(project, key) {
  Object.defineProperty(project, key, {
    configurable: true,
    enumerable: true,
    get() {
      const concept = getActiveConcept(this);
      return concept ? concept[key] : undefined;
    },
    set(value) {
      const concept = getActiveConcept(this);
      if (!concept) return;
      concept[key] = value;
      touchConcept(concept);
    },
  });
}

function defineNestedAccessor(project, binding) {
  const container = project[binding.container];
  if (!isObject(container)) return;
  if (Object.getOwnPropertyDescriptor(container, binding.property)?.get) return;
  const seed = container[binding.property];
  const concept = getActiveConcept(project);
  if (concept && seed !== undefined && (concept[binding.conceptKey] === undefined || !concept[binding.conceptKey]?.length)) {
    concept[binding.conceptKey] = cloneValue(seed);
  }
  Object.defineProperty(container, binding.property, {
    configurable: true,
    enumerable: true,
    get() {
      const active = getActiveConcept(project);
      if (!active) return binding.fallback();
      if (active[binding.conceptKey] === undefined) active[binding.conceptKey] = binding.fallback();
      return active[binding.conceptKey];
    },
    set(value) {
      const active = getActiveConcept(project);
      if (!active) return;
      active[binding.conceptKey] = value;
      touchConcept(active);
    },
  });
}

/**
 * Installs the concept accessors. Idempotent, and safe to call again after any
 * operation that replaces a container object the nested bindings live inside.
 */
export function bindProject(project) {
  if (!isObject(project)) return project;
  ensureConceptSet(project);
  if (!project[BOUND]) {
    for (const key of CONCEPT_SLICE_KEYS) defineConceptAccessor(project, key);
    Object.defineProperty(project, BOUND, { value: true, enumerable: false, configurable: true, writable: true });
  }
  for (const binding of NESTED_CONCEPT_BINDINGS) defineNestedAccessor(project, binding);
  return project;
}

export function isBound(project) {
  return Boolean(isObject(project) && project[BOUND]);
}

/* ------------------------------------------------------------------ *
 * Migration
 * ------------------------------------------------------------------ */

/**
 * Brings a project of any earlier shape up to the concept-set model.
 *
 * A pre-3.0 project is one website. It becomes V1 exactly as it was — same
 * sections, same design, same globals, same ids — and the other two slots stay
 * empty. Nothing is re-derived, because a project saved months ago is somebody's
 * approved work and re-resolving it against today's defaults would change it.
 *
 * `project.simple.concepts` from 2.2.x is a different case: those *were* three
 * design proposals, so their palettes, fonts, buttons and dial nudges are
 * carried onto the matching slot and the workspace around each one is cloned
 * from V1, which is what they were previewing against anyway.
 */
export function migrateProject(project, { resolveConceptDesign = null } = {}) {
  if (!isObject(project)) return project;
  const report = { migrated: false, from: '', legacySimpleConcepts: 0 };
  if (!isObject(project.conceptSet)) {
    report.migrated = true;
    report.from = isObject(project.design) || Array.isArray(project.sections) ? 'sbs-project/2.x' : 'empty';
    const base = readLegacySlices(project);
    // Remove the legacy own-properties before binding, or the accessor install
    // would be shadowed by stale data that no longer has a writer.
    for (const key of CONCEPT_SLICE_KEYS) delete project[key];
    project.conceptSet = createConceptSet({ base });
  }
  ensureConceptSet(project);
  project.schemaVersion = project.schemaVersion || CONCEPT_SET_SCHEMA_VERSION;
  if (!project.projectId) project.projectId = project.id || '';
  bindProject(project);

  const legacy = Array.isArray(project?.simple?.concepts) ? project.simple.concepts : [];
  const alreadyGenerated = listGeneratedConcepts(project).length;
  if (legacy.length > 1 && alreadyGenerated < 2) {
    report.legacySimpleConcepts = legacy.length;
    adoptLegacyDesignConcepts(project, legacy, {
      activeIndex: Number.isInteger(project?.simple?.active) ? project.simple.active : null,
      resolveConceptDesign,
    });
  }
  return report;
}

/**
 * Turns 2.2.x design-slice concepts into full workspaces.
 *
 * V1 keeps the live project untouched. V2 and V3 are clones of it with their
 * recorded design applied, which is exactly what the pills used to show.
 */
export function adoptLegacyDesignConcepts(project, legacyConcepts, { activeIndex = null, resolveConceptDesign = null } = {}) {
  const set = ensureConceptSet(project);
  if (!set) return [];
  const adopted = [];
  legacyConcepts.slice(0, CONCEPT_IDS.length).forEach((legacy, index) => {
    const conceptId = CONCEPT_IDS[index];
    const target = set.concepts[conceptId];
    if (!target) return;
    const variant = variantForIndex(index);
    if (index > 0) {
      cloneWorkspaceInto(set.concepts.v1, target);
      target.status = 'generated';
    }
    target.name = text(legacy?.name, 60) || variant.name;
    target.why = text(legacy?.why, 400);
    target.style = createStyleRef({
      ...target.style,
      archetypeKey: legacy?.archetypeKey || target.style.archetypeKey,
      preset: legacy?.preset || target.style.preset,
      variantType: variant.variantType,
    });
    if (typeof resolveConceptDesign === 'function') {
      const design = resolveConceptDesign(legacy, { current: target.design });
      if (isObject(design)) target.design = { ...target.design, ...cloneValue(design) };
    } else {
      applyLegacyDesignOverrides(target, legacy);
    }
    target.generatedFrom = snapshotWorkspace(target);
    adopted.push(conceptId);
  });
  if (Number.isInteger(activeIndex) && CONCEPT_IDS[activeIndex]) setActiveConcept(project, CONCEPT_IDS[activeIndex]);
  return adopted;
}

/** The design values a 2.2.x concept recorded, applied without a style profile. */
function applyLegacyDesignOverrides(concept, legacy) {
  if (!isObject(concept) || !isObject(legacy)) return;
  const design = concept.design;
  if (legacy.archetypeKey) design.archetype = legacy.archetypeKey;
  if (legacy.buttonStyle) design.buttonStyle = legacy.buttonStyle;
  const dials = isObject(legacy.dialOverrides) ? legacy.dialOverrides : {};
  for (const [key, value] of Object.entries(dials)) {
    if (Number.isFinite(Number(value))) design[key] = Number(value);
  }
  const overrides = isObject(legacy.designOverrides) ? legacy.designOverrides : {};
  if (isObject(overrides.palette)) design.palette = { ...(design.palette || {}), ...cloneValue(overrides.palette) };
  for (const key of ['fontBody', 'fontDisplay']) {
    if (overrides[key]) design[key] = overrides[key];
  }
}

/* ------------------------------------------------------------------ *
 * Workspace operations
 * ------------------------------------------------------------------ */

/** Just the renderable workspace, with no identity or publish metadata. */
export function snapshotWorkspace(concept) {
  if (!isObject(concept)) return null;
  const out = {};
  for (const key of [...CONCEPT_SLICE_KEYS, 'mediaAssignments']) out[key] = cloneValue(concept[key]);
  return out;
}

/**
 * Deep-copies one concept's workspace into another. Identity, publish state and
 * revision belong to the target and are never overwritten: copying V1 into V2
 * must not hand V2 V1's public link.
 */
export function cloneWorkspaceInto(source, target) {
  if (!isObject(source) || !isObject(target)) return target;
  for (const key of [...CONCEPT_SLICE_KEYS, 'mediaAssignments']) {
    target[key] = cloneValue(source[key]);
  }
  // Section ids must stay unique per concept: two concepts sharing a section id
  // would let a selection made in one address a module in the other.
  reidentifySections(target);
  touchConcept(target);
  return target;
}

/**
 * Rewrites section and block ids so they carry the concept they belong to.
 *
 * `selectedSectionId` is editor state, not concept state, so the same id
 * appearing in two workspaces is a real ambiguity rather than a cosmetic one.
 */
export function reidentifySections(concept) {
  if (!isObject(concept) || !Array.isArray(concept.sections)) return concept;
  const suffix = conceptIdFrom(concept.id, { fallback: 'v1' });
  const seen = new Set();
  concept.sections.forEach((section, index) => {
    if (!isObject(section)) return;
    const previous = String(section.id || `section-${index}`);
    const stripped = previous.replace(/--(?:v[1-9])$/, '');
    let next = `${stripped}--${suffix}`;
    while (seen.has(next)) next = `${stripped}-${index}--${suffix}`;
    seen.add(next);
    section.id = next;
    rekeyBlockIds(section.node, next);
  });
  return concept;
}

function rekeyBlockIds(node, prefix) {
  if (!isObject(node)) return;
  let counter = 0;
  const walk = (current) => {
    if (!isObject(current)) return;
    current.id = `${prefix}-b${++counter}`;
    (Array.isArray(current.children) ? current.children : []).forEach(walk);
  };
  walk(node);
}

/**
 * Builds the three workspaces from the concept currently being edited.
 *
 * All three start from one common baseline — the same content, the same flow, the
 * same media — so a client comparing them is comparing design decisions and not
 * three different drafts. `applyVariant` is where the caller turns each one into
 * Core, Brand-led or Expressive.
 */
export function generateConceptSet(project, {
  baseConceptId = 'v1',
  variants = CONCEPT_VARIANTS,
  applyVariant = null,
  activate = 'v1',
} = {}) {
  const set = ensureConceptSet(project);
  if (!set) return [];
  const baseId = conceptIdFrom(baseConceptId, { fallback: 'v1' });
  const baseline = snapshotWorkspace(set.concepts[baseId]);
  if (!baseline) return [];
  const created = [];
  variants.slice(0, CONCEPT_IDS.length).forEach((variant, index) => {
    const conceptId = conceptIdFrom(variant.id || CONCEPT_IDS[index], { fallback: CONCEPT_IDS[index] });
    const concept = set.concepts[conceptId];
    if (!concept) return;
    for (const key of [...CONCEPT_SLICE_KEYS, 'mediaAssignments']) concept[key] = cloneValue(baseline[key]);
    concept.name = text(variant.name, 60) || variantForIndex(index).name;
    concept.variantType = CONCEPT_VARIANT_TYPES.includes(variant.variantType) ? variant.variantType : variantForIndex(index).variantType;
    concept.why = text(variant.why, 400);
    concept.style = createStyleRef({ ...concept.style, ...(isObject(variant.style) ? variant.style : {}), variantType: concept.variantType });
    concept.status = 'generated';
    reidentifySections(concept);
    if (typeof applyVariant === 'function') applyVariant(concept, variant, index);
    concept.generatedFrom = snapshotWorkspace(concept);
    touchConcept(concept);
    created.push(conceptId);
  });
  setActiveConcept(project, activate);
  return created;
}

/** Copies one concept over another, on deliberate request only. */
export function duplicateConcept(project, fromConceptId, toConceptId) {
  const set = ensureConceptSet(project);
  if (!set) return false;
  const from = set.concepts[conceptIdFrom(fromConceptId)];
  const to = set.concepts[conceptIdFrom(toConceptId)];
  if (!from || !to || from === to || from.status !== 'generated') return false;
  cloneWorkspaceInto(from, to);
  to.status = 'generated';
  to.name = `${from.name} copy`.slice(0, 60);
  to.generatedFrom = snapshotWorkspace(to);
  return true;
}

/** Restores a concept to the workspace it was generated as. */
export function resetConcept(project, conceptId) {
  const concept = getConcept(project, conceptId);
  if (!concept || !isObject(concept.generatedFrom)) return false;
  for (const key of [...CONCEPT_SLICE_KEYS, 'mediaAssignments']) {
    if (concept.generatedFrom[key] !== undefined) concept[key] = cloneValue(concept.generatedFrom[key]);
  }
  touchConcept(concept);
  return true;
}

/* ------------------------------------------------------------------ *
 * Serialization
 * ------------------------------------------------------------------ */

/**
 * The canonical project, without the mirrored active-concept keys.
 *
 * The mirrors are enumerable so that five thousand lines of existing code keep
 * working, which also means `JSON.stringify` would write the active concept
 * twice — once inside `conceptSet` and once beside it. Persisting that would put
 * a second, unowned copy of the live website in storage.
 */
export function serializeProject(project) {
  if (!isObject(project)) return project;
  const out = {};
  for (const key of Object.keys(project)) {
    if (CONCEPT_SLICE_KEYS.includes(key)) continue;
    out[key] = project[key];
  }
  if (isObject(project.media)) {
    const media = {};
    for (const key of Object.keys(project.media)) {
      if (NESTED_CONCEPT_BINDINGS.some((binding) => binding.container === 'media' && binding.property === key)) continue;
      media[key] = project.media[key];
    }
    out.media = media;
  }
  return out;
}

export function projectToJson(project) {
  return JSON.stringify(serializeProject(project));
}

/** Parses, migrates and binds in one step. Always returns a bound project. */
export function hydrateProject(raw, options = {}) {
  const project = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!isObject(project)) return null;
  migrateProject(project, options);
  return project;
}

/* ------------------------------------------------------------------ *
 * Isolation checking
 * ------------------------------------------------------------------ */

/**
 * Reports which concepts changed between two serialized project states.
 *
 * This is the assertion behind concept isolation: after editing V2, the diff
 * must name V2 and nothing else. Used by the QA scripts and the unit tests, and
 * cheap enough to call from a development build.
 */
export function conceptIsolationDiff(before, after) {
  const parse = (value) => (typeof value === 'string' ? JSON.parse(value) : value);
  const left = parse(before) || {};
  const right = parse(after) || {};
  const changed = [];
  const details = {};
  for (const id of CONCEPT_IDS) {
    const a = left?.conceptSet?.concepts?.[id];
    const b = right?.conceptSet?.concepts?.[id];
    const keys = [];
    for (const key of [...CONCEPT_SLICE_KEYS, 'mediaAssignments', 'name', 'status', 'publish']) {
      if (JSON.stringify(a?.[key] ?? null) !== JSON.stringify(b?.[key] ?? null)) keys.push(key);
    }
    if (keys.length) {
      changed.push(id);
      details[id] = keys;
    }
  }
  return { changed, details, isolated: changed.length <= 1 };
}
