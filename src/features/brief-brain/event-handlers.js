import { SECTION_FAMILY_IDS, sectionFamily } from '../../../shared/brief/families.mjs';
import { outlineFamilies } from '../../../shared/brief/planner.mjs';
import { briefBrainApi, normalizeApiError } from './api.js';
import { BRIEF_TEXT_LIMIT, beginJob, briefSignature, briefAttachments, briefSourceLength, briefSourceText, buildConceptsRequest, buildContentRequest, buildExpandRequest, buildMediaRequest, buildOutlineRequest, buildUnderstandRequest, endJob, ensureBrainState, ensureMediaState, ensureSimpleState, isBrainBusy, isMediaBusy, isSimpleBusy } from './state.js';

/**
 * The Brief Brain's event layer.
 *
 * It owns network state and the brain's own project slice. Everything that
 * changes the page itself — sections, archetype, flow, history — is delegated
 * back to the builder through the context callbacks, so undo, autosave and the
 * live preview keep exactly one owner.
 */

function setBusy(brain, status, message, context) {
  // Registering the job is what allows a render to draw the working state; the
  // status alone is treated as stale left-over from a reload.
  beginJob(brain);
  brain.status = status;
  brain.liveMessage = message;
  brain.error = '';
  brain.errorCode = '';
  context.renderAll();
}

function settle(brain, message, context) {
  endJob(brain);
  brain.status = 'ready';
  brain.liveMessage = message;
  context.queueSave();
  context.renderAll();
  if (message) context.announce(message);
}

function fail(brain, error, context) {
  const normalized = normalizeApiError(error);
  endJob(brain);
  brain.status = 'error';
  brain.error = normalized.message;
  brain.errorCode = normalized.code;
  brain.liveMessage = normalized.message;
  context.queueSave();
  context.renderAll();
  context.announce(normalized.message);
}

async function refreshProvider(context, { announce = false } = {}) {
  const status = await briefBrainApi.status();
  // Re-read after the await: a render may have run while the probe was open.
  const brain = ensureBrainState(context.project);
  brain.provider = {
    configured: Boolean(status.configured),
    available: Boolean(status.available),
    model: String(status.model || ''),
    // Stock media is a second, independently configured service: the model can
    // be reachable while the picture library is not.
    stock: {
      configured: Boolean(status.media?.configured),
      available: Boolean(status.media?.available),
      images: Number(status.media?.images) || 0,
      videos: Number(status.media?.videos) || 0,
    },
  };
  context.queueSave();
  context.renderAll();
  if (announce) {
    context.announce(brain.provider.available
      ? `AI model reachable${brain.provider.model ? ` · ${brain.provider.model}` : ''}`
      : brain.provider.configured
        ? 'AI model is configured but unreachable. The built-in planner will answer.'
        : 'AI model is not configured. The built-in planner will answer.');
  }
}

async function runUnderstand(brain, context) {
  if (isBrainBusy(brain)) return;
  setBusy(brain, 'reading', 'Reading the brief…', context);
  try {
    const result = await briefBrainApi.understand(buildUnderstandRequest({
      project: context.project,
      archetypes: context.archetypes,
      flows: context.flows,
    }));
    brain.understanding = result;
    brain.understoodAt = new Date().toISOString();
    brain.understoodFrom = briefSignature(context.project.brief);
    if (result.degraded) {
      brain.liveMessage = result.degraded.message;
      settle(brain, result.degraded.message, context);
      return;
    }
    settle(brain, 'Brief understood. Check the readback, then apply what you agree with.', context);
  } catch (error) {
    fail(brain, error, context);
  }
}

/** The families the current page flow actually contains, in page order. */
function currentFamilies(context) {
  return (context.project.sections || [])
    .filter((section) => section.visible !== false)
    .map((section) => section.family)
    .filter((family) => SECTION_FAMILY_IDS.includes(family));
}

/**
 * The copywriting call, and optionally putting it on the page.
 *
 * Two callers with two different promises share it. The advanced builder writes
 * a draft and shows it for review, because overwriting hand-edited copy without
 * asking is exactly what its extra step exists to prevent. The simple builder's
 * one button applies it, because there is nothing yet to overwrite and a second
 * button to confirm the obvious is a step for its own sake.
 *
 * Reporting belongs to the caller: one of them owns a panel with a spinner on
 * it, the other is one stage of three.
 */
async function contentPass(context, { apply = false } = {}) {
  const families = currentFamilies(context);
  if (!families.length) return { skipped: 'the page has no sections to write for' };
  const result = await briefBrainApi.content(buildContentRequest({ project: context.project, families }));
  const brain = ensureBrainState(context.project);
  brain.contentDraft = result;
  if (apply) {
    context.applyContentDraft(result);
    brain.contentAppliedAt = new Date().toISOString();
  }
  return { result, written: (result.sections || []).length };
}

async function runContent(brain, context) {
  if (isBrainBusy(brain)) return;
  setBusy(brain, 'writing', 'Writing the first draft of every section…', context);
  try {
    const pass = await contentPass(context);
    if (pass.skipped) {
      settle(brain, 'Choose a page flow first, then generate the content.', context);
      return;
    }
    const result = pass.result;
    settle(brain, result.degraded
      ? result.degraded.message
      : `Draft ready for ${result.sections.length} section${result.sections.length === 1 ? '' : 's'}. Review it, then apply.`, context);
  } catch (error) {
    fail(brain, error, context);
  }
}

async function runOutline(brain, context) {
  if (isBrainBusy(brain)) return;
  const outline = String(brain.outline || '').trim();
  if (outline.length < 3) {
    context.announce('Type the sections you want before building the flow.');
    return;
  }
  setBusy(brain, 'planning', 'Mapping your outline to DST sections…', context);
  try {
    const result = await briefBrainApi.outline(buildOutlineRequest({ project: context.project, outline }));
    brain.outlinePlan = result;
    const unresolved = (result.steps || []).filter((step) => !step.family).length;
    settle(brain, unresolved
      ? `${unresolved} line${unresolved === 1 ? '' : 's'} still need a section. Choose one for each.`
      : 'Outline mapped. Review the sequence, then create the flow.', context);
  } catch (error) {
    fail(brain, error, context);
  }
}

/* ---------------------------------------------------------------- *
 * Stock imagery
 * ---------------------------------------------------------------- */

/**
 * Finds on-brief stock imagery and places it across the page.
 *
 * The builder owns the slot list, because only it knows which pattern is on each
 * section and therefore how many pictures that section can hold. This handler
 * owns the request and the resulting project slice; applying the plan to the
 * sections is delegated back so undo, autosave and the preview keep one owner.
 */
async function mediaPass(context) {
  // Only an explicit "no" skips: the flag is null until the status probe answers,
  // and a probe that has not landed yet is not a reason to refuse to search.
  const stock = ensureBrainState(context.project).provider?.stock || {};
  if (stock.configured === false) return { skipped: 'stock imagery is not configured on this server' };
  const slots = context.mediaSlots();
  if (!slots.length) return { skipped: 'this page has no picture slots yet' };
  const result = await briefBrainApi.media(buildMediaRequest({ project: context.project, slots }));
  // Re-read after the await: a render may have run while the search was open.
  const next = ensureMediaState(context.project);
  next.status = 'ready';
  next.assets = result.assets || [];
  next.assignments = result.assignments || [];
  next.unassigned = result.unassigned || [];
  next.queries = result.queries || null;
  next.source = result.source || '';
  next.degraded = result.degraded || null;
  next.provider = result.provider || '';
  next.model = result.model || '';
  next.notice = result.notice || '';
  next.generatedAt = new Date().toISOString();
  next.generatedFrom = briefSignature(context.project.brief);
  context.applyMediaPlan({ assets: next.assets, assignments: next.assignments });
  const videos = next.assets.filter((asset) => asset.kind === 'video').length;
  const short = next.unassigned.length
    ? ` ${next.unassigned.length} slot${next.unassigned.length === 1 ? '' : 's'} kept the placeholder — the search did not return enough distinct assets to fill them without repeating one.`
    : '';
  return {
    placed: next.assignments.length,
    found: next.assets.length,
    unassigned: next.unassigned.length,
    videos,
    message: result.degraded
      ? `${result.degraded.message} Imagery was placed in slot order.${short}`
      : `${next.assets.length} previews found (${videos} video${videos === 1 ? '' : 's'}) and ${next.assignments.length} placed.${short}`,
  };
}

/**
 * Finds on-brief stock imagery and places it across the page.
 *
 * The builder owns the slot list, because only it knows which pattern is on each
 * section and therefore how many pictures that section can hold. This handler
 * owns the request and the resulting project slice; applying the plan to the
 * sections is delegated back so undo, autosave and the preview keep one owner.
 */
async function runMedia(context) {
  const media = ensureMediaState(context.project);
  if (isMediaBusy(media)) return;
  beginJob(media);
  media.status = 'searching';
  media.error = '';
  media.errorCode = '';
  media.liveMessage = 'Searching the stock library for this brief…';
  context.renderAll();
  try {
    const pass = await mediaPass(context);
    const next = endJob(ensureMediaState(context.project));
    if (pass.skipped) {
      next.status = 'idle';
      next.liveMessage = '';
      context.renderAll();
      context.announce(pass.skipped === 'this page has no picture slots yet'
        ? 'This page has no picture slots yet. Add a section that carries an image first.'
        : 'Stock imagery is not configured on this server.');
      return;
    }
    next.liveMessage = pass.message;
    context.queueSave();
    context.renderAll();
    context.announce(pass.message);
  } catch (error) {
    const next = endJob(ensureMediaState(context.project));
    const normalized = normalizeApiError(error);
    next.status = 'error';
    next.error = normalized.message;
    next.errorCode = normalized.code;
    next.liveMessage = normalized.message;
    context.queueSave();
    context.renderAll();
    context.announce(normalized.message);
  }
}

/**
 * Fetches one named asset and adds it to the pool.
 *
 * Nothing is placed. The strategist asked for a specific picture, not for a
 * decision about where it goes, so it joins the pool and the module pickers pick
 * it up on the next render — the same shape and the same watermark as everything
 * the search found.
 */
async function runMediaAsset(context) {
  const media = ensureMediaState(context.project);
  if (media.lookupStatus === 'loading') return;
  const query = String(media.assetIdQuery || '').trim();
  if (!query) {
    context.announce('Paste a Shutterstock id or asset URL first.');
    return;
  }
  media.lookupStatus = 'loading';
  media.lookupError = '';
  context.renderAll();
  try {
    const result = await briefBrainApi.mediaAsset({ assetId: query });
    // Re-read after the await: a render may have replaced the slice meanwhile.
    const next = ensureMediaState(context.project);
    next.lookupStatus = 'idle';
    next.lookupError = '';
    const asset = result.asset;
    const already = next.assets.some((entry) => entry.id === asset.id);
    if (!already) next.assets = next.assets.concat([asset]);
    next.assetIdQuery = '';
    // The pool is what the pickers read, and a hand-picked asset is still a
    // watermarked comp, so the licence notice has to survive an empty search.
    if (!next.notice) next.notice = result.notice || '';
    if (!next.provider) next.provider = result.provider || '';
    const message = already
      ? `#${asset.assetId} is already in your imagery.`
      : `#${asset.assetId} added — pick it on any module's Media tab.`;
    next.liveMessage = message;
    context.queueSave();
    context.renderAll();
    context.announce(message);
  } catch (error) {
    const next = ensureMediaState(context.project);
    const normalized = normalizeApiError(error);
    next.lookupStatus = 'error';
    next.lookupError = normalized.message;
    context.queueSave();
    context.renderAll();
    context.announce(normalized.message);
  }
}

/* ---------------------------------------------------------------- *
 * The simple builder
 * ---------------------------------------------------------------- */

/**
 * The one button: read the brief, write the page, find the pictures.
 *
 * This used to be three buttons on three steps, and the middle one needed a
 * fourth press to actually apply what it had written. Everything it does is
 * something that has to happen before a page can be shown to anybody, and none
 * of it is a decision — so it is one press.
 *
 * The order is the interesting part, and it is not the order the buttons were in:
 *
 *   1. read the brief — the readback, the fields, the three concept designs;
 *   2. write the copy and put it on the page;
 *   3. find the imagery and place it;
 *   4. *then* fork the page into V1, V2 and V3.
 *
 * Forking last is what makes the three concepts comparable. The workspaces are
 * clones of the page as it stands, so dressing the page first means all three
 * carry the real copy and the real pictures and differ only in design — which is
 * the entire point of showing a client three of them. Generating them first, as
 * the old flow did, left the copy in whichever one happened to be active.
 *
 * Stages two and three are best-effort by design. A brief that produced three
 * concepts is worth keeping even if the copywriter timed out, and stock imagery
 * is a separately configured service that most servers do not have — neither is
 * a reason to throw away the concepts, and both say what happened.
 */
async function runConcepts(context) {
  const simple = ensureSimpleState(context.project);
  if (isSimpleBusy(simple)) return;
  // The brief is the paragraph and the attachments together, so a client's PDF
  // dropped in on its own is enough to press the button with.
  const briefText = briefSourceText(context.project);
  if (briefSourceLength(context.project) < 20) {
    context.announce('Write a few sentences about the project, or drop the client\u2019s brief in first.');
    return;
  }
  const stage = (name, message) => {
    const slice = ensureSimpleState(context.project);
    slice.stage = name;
    slice.liveMessage = message;
    context.renderAll();
  };
  beginJob(simple);
  simple.status = 'reading';
  simple.error = '';
  simple.errorCode = '';
  simple.report = null;
  stage('brief', 'Reading the brief and designing three concepts…');
  try {
    const result = await briefBrainApi.concepts(buildConceptsRequest({
      project: context.project,
      archetypes: context.archetypes,
      flows: context.flows,
    }));
    const next = ensureSimpleState(context.project);
    const previousActive = next.active;
    const previousSlot = previousActive !== null ? next.concepts[previousActive]?.slot : null;
    next.readback = result.readback;
    next.fields = result.fields;
    next.confidence = result.confidence;
    next.missingFields = result.missingFields || [];
    next.concepts = context.normalizeConcepts(result.concepts);
    next.flows = result.flows || [];
    next.source = result.source;
    next.directives = result.directives || null;
    next.degraded = result.degraded || null;
    next.model = result.model || '';
    next.generatedAt = new Date().toISOString();
    next.generatedFrom = briefText;
    // The brief text is also the advanced builder's brief, so mirror the fields
    // across now rather than at export time — and before the copywriter runs,
    // since that is the brief it writes from.
    context.applyBriefFields(result.fields, { briefText });

    /* --- Stage two: the copy --- */
    const report = { concepts: next.concepts.length, written: 0, placed: 0, notes: [] };
    stage('content', 'Writing the copy for every section…');
    try {
      const pass = await contentPass(context, { apply: true });
      if (pass.skipped) report.notes.push(`No copy was written: ${pass.skipped}.`);
      else {
        report.written = pass.written;
        if (pass.result.degraded) report.notes.push(pass.result.degraded.message);
      }
    } catch (error) {
      report.notes.push(`The copywriter could not be reached: ${normalizeApiError(error).message}`);
    }

    /* --- Stage three: the pictures --- */
    stage('media', 'Finding imagery for this brief…');
    try {
      const pass = await mediaPass(context);
      if (pass.skipped) report.notes.push(`No imagery was placed: ${pass.skipped}.`);
      else {
        report.placed = pass.placed;
        report.found = pass.found;
        report.videos = pass.videos;
        // Finding more previews than there are slots is the normal case, not a
        // warning. A slot left on a placeholder is the thing worth saying.
        if (pass.unassigned) {
          report.notes.push(`${pass.unassigned} slot${pass.unassigned === 1 ? '' : 's'} kept a placeholder rather than repeat a picture.`);
        }
      }
    } catch (error) {
      const normalized = normalizeApiError(error);
      const media = ensureMediaState(context.project);
      media.status = 'error';
      media.error = normalized.message;
      media.errorCode = normalized.code;
      report.notes.push(`No imagery was placed: ${normalized.message}`);
    }

    /* --- Stage four: fork the dressed page into three workspaces --- */
    stage('concepts', 'Building the three concept workspaces…');
    const settled = endJob(ensureSimpleState(context.project));
    settled.status = 'ready';
    settled.stage = '';
    /*
     * Three concepts are three real workspaces from here on. The builder clones
     * the concept currently being edited into all three slots — same content,
     * same flow, same media — then resolves each one's own design, so a client
     * comparing them compares design decisions and not three different drafts.
     *
     * It returns an empty list when the set already exists, because rebuilding
     * over work already done in V2 or V3 is never something to do silently.
     */
    const generatedConcepts = typeof context.generateConcepts === 'function'
      ? context.generateConcepts(settled.concepts)
      : [];
    // Re-reading a brief should not silently abandon the concept already on
    // screen: keep the same slot selected and re-apply it.
    const sameSlot = previousSlot ? settled.concepts.findIndex((concept) => concept.slot === previousSlot) : -1;
    settled.active = sameSlot >= 0 ? sameSlot : null;
    if (settled.active !== null) context.applyConcept(settled.active, { silent: true });
    if (!generatedConcepts.length) {
      report.notes.push('Your existing V1/V2/V3 workspaces were kept — reset a concept to take its new design.');
    }
    settled.report = report;

    const done = [
      `${report.concepts} concepts`,
      report.written ? `${report.written} sections written` : '',
      report.placed ? `${report.placed} pictures placed` : '',
    ].filter(Boolean).join(', ');
    const message = result.degraded ? result.degraded.message : `${done}. Pick a concept to continue.`;
    settled.liveMessage = message;
    context.queueSave();
    context.renderAll();
    context.announce(message);
  } catch (error) {
    const next = endJob(ensureSimpleState(context.project));
    const normalized = normalizeApiError(error);
    next.status = 'error';
    next.stage = '';
    next.error = normalized.message;
    next.errorCode = normalized.code;
    next.liveMessage = normalized.message;
    context.queueSave();
    context.renderAll();
    context.announce(normalized.message);
  }
}

/**
 * Handles every `data-brain-*` interaction. Returns true when the event was
 * consumed so the builder's own delegated listeners do not also act on it.
 */
export function handleBriefBrainEvent(event, context = {}) {
  const project = context.project;
  if (!project) return false;
  const brain = ensureBrainState(project);

  if (event.type === 'input' || event.type === 'change') {
    const field = event.target?.closest?.('[data-brain-field]');
    // The media slice has one typed field of its own. It is stored without a
    // re-render for the same reason the brief textarea is: the panel must not
    // rebuild itself under a cursor that is still typing.
    if (field && field.dataset.brainScope === 'media') {
      const media = ensureMediaState(project);
      media[field.dataset.brainField] = event.target.value;
      if (media.lookupError) media.lookupError = '';
      context.queueSave();
      return true;
    }
    if (field && field.dataset.brainScope === 'simple') {
      const simple = ensureSimpleState(project);
      simple[field.dataset.brainField] = event.target.value;
      context.queueSave();
      // Only the one primary button depends on this value; patch it rather than
      // re-rendering the textarea the strategist is typing into.
      const trigger = document.querySelector('[data-brain-action="build-concepts"]');
      if (trigger) {
        const blocked = briefSourceLength(context.project) < 20;
        trigger.disabled = blocked;
        if (blocked) trigger.setAttribute('aria-disabled', 'true');
        else trigger.removeAttribute('aria-disabled');
      }
      const counter = document.querySelector('.brief-checklist em');
      if (counter) {
        const attached = briefAttachments(context.project).length;
        counter.textContent = `${briefSourceLength(context.project).toLocaleString()} / ${BRIEF_TEXT_LIMIT.toLocaleString()} characters${attached ? ` · ${attached} attached` : ''}`;
      }
      return true;
    }
    if (field) {
      brain[field.dataset.brainField] = event.target.value;
      context.queueSave();
      // Only the primary button's disabled state depends on this value, so
      // patch it in place instead of re-rendering the textarea mid-typing.
      // `aria-disabled` has to move with it, or the button is announced as
      // disabled while being clickable.
      const trigger = document.querySelector('[data-brain-action="plan-outline"]');
      if (trigger) {
        const blocked = String(brain.outline || '').trim().length < 3;
        trigger.disabled = blocked;
        if (blocked) trigger.setAttribute('aria-disabled', 'true');
        else trigger.removeAttribute('aria-disabled');
      }
      return true;
    }
    const familyPicker = event.target?.closest?.('[data-brain-action="outline-step-family"]');
    if (familyPicker) {
      const index = Number(familyPicker.dataset.brainIndex);
      const step = brain.outlinePlan?.steps?.[index];
      if (step) {
        step.family = SECTION_FAMILY_IDS.includes(familyPicker.value) ? familyPicker.value : null;
        step.reason = step.family ? 'Chosen by you.' : 'No section chosen yet.';
        context.queueSave();
        context.renderAll();
      }
      return true;
    }
    return false;
  }

  if (event.type !== 'click') return false;
  const trigger = event.target?.closest?.('[data-brain-action]');
  if (!trigger) return false;
  const action = trigger.dataset.brainAction;

  switch (action) {
    case 'check-provider':
      refreshProvider(context, { announce: true });
      return true;
    case 'understand':
      runUnderstand(brain, context);
      return true;
    case 'write-content':
      runContent(brain, context);
      return true;
    case 'plan-outline':
      runOutline(brain, context);
      return true;
    case 'build-concepts':
      runConcepts(context);
      return true;
    case 'find-media':
      runMedia(context);
      return true;
    case 'clear-media':
      context.clearMediaPlan();
      return true;
    case 'add-media-asset':
      runMediaAsset(context);
      return true;
    case 'copy-asset-id': {
      const id = String(trigger.dataset.brainAssetId || '');
      if (!id) return true;
      Promise.resolve(navigator.clipboard?.writeText(id))
        .then(() => context.announce(`Shutterstock id ${id} copied`))
        .catch(() => context.announce(`Shutterstock id ${id}`));
      return true;
    }
    case 'use-concept':
      context.applyConcept(Number(trigger.dataset.brainIndex));
      return true;
    case 'apply-archetype':
      context.applyArchetype(trigger.dataset.brainArchetype);
      return true;
    case 'apply-flow':
      context.applyFlow(trigger.dataset.brainFlow);
      return true;
    /*
     * Appending rather than toggling.
     *
     * A page flow is a sequence and the same family legitimately appears twice — two
     * card bands, a statement early and another late. Removing on a second click
     * would make that impossible to express.
     */
    case 'toggle-outline-reference':
      // The browser would also toggle this natively, and the re-render below would
      // then disagree with it.
      event.preventDefault();
      brain.outlineReferenceOpen = brain.outlineReferenceOpen === false;
      context.queueSave();
      context.renderAll();
      return true;
    case 'insert-section': {
      const family = sectionFamily(trigger.dataset.brainFamily);
      if (!family) return true;
      const lines = String(brain.outline || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      lines.push(family.label);
      // Renumbered on every insert, so adding a section after a hand edit cannot
      // leave a broken sequence behind.
      brain.outline = lines
        .map((line, index) => `${index + 1}. ${line.replace(/^\s*(?:\d+[.)]|[-*\u2022])\s*/, '')}`)
        .join('\n');
      brain.liveMessage = `${family.label} added to the outline.`;
      context.queueSave();
      context.renderAll();
      // The strategist is mid-thought: put the cursor back where they were typing.
      const textarea = document.getElementById('brain-outline');
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      }
      return true;
    }
    case 'apply-content': {
      const draft = brain.contentDraft;
      if (!draft?.sections?.length) return true;
      context.applyContentDraft(draft);
      brain.contentAppliedAt = new Date().toISOString();
      brain.liveMessage = 'Draft applied to every module in the flow.';
      context.queueSave();
      context.renderAll();
      return true;
    }
    case 'discard-content':
      brain.contentDraft = null;
      brain.liveMessage = 'Draft discarded.';
      context.queueSave();
      context.renderAll();
      return true;
    case 'apply-outline': {
      const families = outlineFamilies(brain.outlinePlan);
      if (!families.length) {
        context.announce('Choose a section for at least one line first.');
        return true;
      }
      context.applyCustomFlow({
        name: brain.outlinePlan?.name || 'Custom outline',
        rationale: brain.outlinePlan?.rationale || '',
        families,
      });
      brain.liveMessage = `Created a ${families.length}-section flow from your outline.`;
      context.queueSave();
      context.renderAll();
      return true;
    }
    case 'discard-outline':
      brain.outlinePlan = null;
      brain.liveMessage = 'Outline cleared.';
      context.queueSave();
      context.renderAll();
      return true;
    case 'outline-step-remove': {
      const index = Number(trigger.dataset.brainIndex);
      if (brain.outlinePlan?.steps?.length > index) {
        brain.outlinePlan.steps.splice(index, 1);
        context.queueSave();
        context.renderAll();
      }
      return true;
    }
    default:
      return false;
  }
}

/**
 * Splits the simple builder's paragraph into the advanced builder's fields.
 * Used by the import path, so it resolves rather than rendering.
 */
export async function expandBriefForImport(briefText) {
  try {
    return await briefBrainApi.expand(buildExpandRequest(briefText));
  } catch (error) {
    return { source: 'unavailable', error: normalizeApiError(error) };
  }
}

/** Called once at start-up so the panel can show the real provider state. */
export function initBriefBrain(context = {}) {
  const project = context.project;
  if (!project) return;
  ensureBrainState(project);
  refreshProvider(context).catch(() => {});
}
