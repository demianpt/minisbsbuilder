/**
 * Concept-aware undo/redo.
 *
 * A single history stack over the whole project is wrong once V1, V2 and V3 are
 * three independent websites: edit V1's headline, switch to V2, edit V2's cards,
 * press undo — a project-wide stack undoes whatever happened to be on top, which
 * may well be a change to a concept the strategist is not looking at.
 *
 * So each concept keeps its own stack. An entry records the concept it belongs to
 * plus the shared project state at the time, because a brief edit is genuinely
 * shared and must come back with the step that made it. Undo therefore restores
 * one concept and the shared slices, and provably cannot touch the other two —
 * their workspaces are not in the entry at all.
 *
 * Switching concepts is not an edit and does not push, clear or reorder anything.
 */

import {
  CONCEPT_SLICE_KEYS,
  cloneValue,
  conceptIdFrom,
  getActiveConcept,
  getActiveConceptId,
  serializeProject,
} from './workspace.mjs';

const DEFAULT_LIMIT = 40;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Everything on the project that is not a concept workspace. */
function sharedState(project) {
  const serialized = serializeProject(project);
  const out = {};
  for (const key of Object.keys(serialized)) {
    if (key === 'conceptSet') continue;
    out[key] = serialized[key];
  }
  return JSON.stringify(out);
}

function conceptState(project) {
  const concept = getActiveConcept(project);
  return concept ? JSON.stringify(concept) : '';
}

function captureEntry(project) {
  const conceptId = getActiveConceptId(project);
  if (!conceptId) return null;
  return { conceptId, concept: conceptState(project), shared: sharedState(project) };
}

function applyEntry(project, entry) {
  if (!isObject(project) || !isObject(entry)) return false;
  const conceptId = conceptIdFrom(entry.conceptId);
  const set = project.conceptSet;
  if (!conceptId || !isObject(set) || !isObject(set.concepts) || !set.concepts[conceptId]) return false;

  const concept = entry.concept ? JSON.parse(entry.concept) : null;
  if (concept) {
    // Replacing the object is safe: every mirrored accessor resolves through
    // `conceptSet.concepts[activeConceptId]` on each access, so nothing holds a
    // stale reference to the workspace being swapped out.
    set.concepts[conceptId] = concept;
  }
  const shared = entry.shared ? JSON.parse(entry.shared) : null;
  if (shared) {
    for (const key of Object.keys(shared)) {
      if (key === 'conceptSet' || CONCEPT_SLICE_KEYS.includes(key)) continue;
      project[key] = shared[key];
    }
  }
  set.activeConceptId = conceptId;
  return true;
}

/**
 * Per-concept undo/redo stacks.
 *
 * `onRestore` is called after a successful undo or redo with the concept id that
 * was restored, so the editor can rebind anything that lives outside the project
 * — the nested media accessor, the current selection, the rendered view.
 */
export function createConceptHistory({ limit = DEFAULT_LIMIT, onRestore = null } = {}) {
  const undoStacks = new Map();
  const redoStacks = new Map();

  const stack = (map, conceptId) => {
    if (!map.has(conceptId)) map.set(conceptId, []);
    return map.get(conceptId);
  };

  function checkpoint(project) {
    const entry = captureEntry(project);
    if (!entry) return false;
    const undoStack = stack(undoStacks, entry.conceptId);
    undoStack.push(entry);
    while (undoStack.length > limit) undoStack.shift();
    // A new edit invalidates the redo branch for this concept only.
    redoStacks.set(entry.conceptId, []);
    return true;
  }

  function step(project, fromMap, toMap) {
    const conceptId = getActiveConceptId(project);
    if (!conceptId) return false;
    const from = stack(fromMap, conceptId);
    if (!from.length) return false;
    const current = captureEntry(project);
    const entry = from.pop();
    if (!applyEntry(project, entry)) return false;
    if (current) stack(toMap, conceptId).push(current);
    if (typeof onRestore === 'function') onRestore(conceptId);
    return true;
  }

  return {
    checkpoint,
    undo: (project) => step(project, undoStacks, redoStacks),
    redo: (project) => step(project, redoStacks, undoStacks),
    canUndo: (project) => stack(undoStacks, getActiveConceptId(project)).length > 0,
    canRedo: (project) => stack(redoStacks, getActiveConceptId(project)).length > 0,
    depth: (project) => ({
      undo: stack(undoStacks, getActiveConceptId(project)).length,
      redo: stack(redoStacks, getActiveConceptId(project)).length,
    }),
    /** Called when a concept is regenerated: its old history no longer applies. */
    forget(conceptId) {
      const id = conceptIdFrom(conceptId);
      if (!id) return;
      undoStacks.delete(id);
      redoStacks.delete(id);
    },
    clear() {
      undoStacks.clear();
      redoStacks.clear();
    },
    /** Serializable depth report, for QA evidence. */
    report() {
      const out = {};
      for (const id of new Set([...undoStacks.keys(), ...redoStacks.keys()])) {
        out[id] = { undo: (undoStacks.get(id) || []).length, redo: (redoStacks.get(id) || []).length };
      }
      return cloneValue(out);
    },
  };
}
