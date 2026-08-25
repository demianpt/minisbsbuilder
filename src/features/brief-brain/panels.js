import { directiveSummary } from '../../../shared/brief/directives.mjs';
import { SECTION_FAMILIES, sectionFamilyLabel } from '../../../shared/brief/families.mjs';
import { BRIEF_FIELD_ORDER, briefReadiness } from '../../../shared/brief/schemas.mjs';
import { BRIEF_TEXT_LIMIT, briefAttachments, briefSourceLength, brainStatusLabel, conceptsAreStale, ensureBrainState, ensureMediaState, ensureSimpleState, hasChosenConcept, isBrainBusy, isMediaBusy, isSimpleBusy, mediaIsStale, understandingIsStale } from './state.js';

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

function off(value) {
  return value ? ' disabled aria-disabled="true"' : '';
}

function percent(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value || 0) * 100)));
}

/**
 * The working cue, next to the control that started the job.
 *
 * Every AI job in this feature is a network round trip of a few seconds, and
 * without a cue the editor looks broken rather than busy. It used to sit at the
 * top of the panel, which meant that pressing a button near the bottom of a long
 * step produced feedback off screen — the one place it cannot do its job. It now
 * renders inside the action row it belongs to, so the answer to "did that
 * register?" is always within a few pixels of where the cursor already is.
 */
function thinking(busy, message) {
  if (!busy) return '';
  return `<span class="brain-thinking" role="status" aria-live="polite">
    <span class="brain-thinking-orb" aria-hidden="true"><i></i><i></i><i></i></span>
    <span class="brain-thinking-copy"><b>${esc(message || 'Working…')}</b></span>
  </span>`;
}

/**
 * A button that starts an AI job.
 *
 * While its own job runs it holds the spinner and says what it is doing, rather
 * than going quietly dead: the button that was pressed is the thing a person is
 * looking at, so it is the thing that has to answer.
 */
function jobButton({ action, label, workingLabel = '', busy = false, disabled = false, variant = 'primary', index = null }) {
  const className = variant === 'secondary' ? 'brain-secondary-button' : 'brain-primary-button';
  return `<button type="button" class="${className}${busy ? ' is-working' : ''}" data-brain-action="${esc(action)}"${index === null ? '' : ` data-brain-index="${index}"`}${off(busy || disabled)}>
    ${busy ? '<span class="brain-btn-spin" aria-hidden="true"></span>' : ''}<span>${esc(busy ? (workingLabel || 'Working…') : label)}</span>
  </button>`;
}

/** Which of a panel's several buttons owns the job currently in flight. */
function busyAction(slice, busy) {
  if (!busy) return '';
  return { reading: 'understand', writing: 'write-content', planning: 'plan-outline', searching: 'find-media' }[slice?.status] || '';
}

/** Panel shell class, so a working panel is visibly the one you are waiting on. */
function panelClass(base, busy) {
  return busy ? `${base} is-thinking` : base;
}

function familyChips(families) {
  return `<div class="brain-chips">${(families || []).map((family) => `<span>${esc(sectionFamilyLabel(family))}</span>`).join('')}</div>`;
}

function familySelect(index, selected, busy) {
  return `<select class="brain-step-family" data-brain-action="outline-step-family" data-brain-index="${index}"${off(busy)} aria-label="Section for step ${index + 1}">
    <option value=""${selected ? '' : ' selected'}>Choose a section…</option>
    ${SECTION_FAMILIES.map((family) => `<option value="${family.id}"${family.id === selected ? ' selected' : ''}>${esc(family.label)}</option>`).join('')}
  </select>`;
}

function sourceNote(result) {
  if (!result) return '';
  if (result.source === 'ai') return `<span class="brain-source is-ai">Written by ${esc(result.model || 'the AI model')}</span>`;
  return `<span class="brain-source is-local">Built-in planner${result.degraded ? ` · ${esc(result.degraded.message)}` : ''}</span>`;
}

function providerLine(brain) {
  const provider = brain.provider || {};
  const state = provider.configured === false ? 'is-off' : provider.available === false ? 'is-warn' : 'is-on';
  const label = provider.configured === false
    ? 'AI model not configured — the built-in planner will answer'
    : provider.available === false
      ? 'AI model unreachable — the built-in planner will answer'
      : `AI model ready${provider.model ? ` · ${provider.model}` : ''}`;
  return `<div class="brain-provider ${state}"><i aria-hidden="true"></i><b>${esc(label)}</b><button type="button" class="brain-text-button" data-brain-action="check-provider">Check again</button></div>`;
}

/* ------------------------------------------------------------------ *
 * Stock imagery
 * ------------------------------------------------------------------ */

/**
 * Where an asset is bought, from the id the API returned.
 *
 * The provider hands back a `url` for every result; this is only the fallback
 * for a stored asset from before that field existed, so a licence link is never
 * missing on a page somebody is about to hand to a client.
 */
export function assetPurchaseUrl(asset) {
  // A pool asset carries `url`; one already written into a section carries the
  // same address as `licenceUrl`, because `asMedia` renames it on the way in.
  if (asset?.url) return String(asset.url);
  if (asset?.licenceUrl) return String(asset.licenceUrl);
  const id = String(asset?.assetId || '').replace(/\D/g, '');
  if (!id) return '';
  return asset?.kind === 'video'
    ? `https://www.shutterstock.com/video/clip-${id}`
    : `https://www.shutterstock.com/image-photo/-${id}`;
}

/*
 * The id is the whole point of a comp. A watermarked preview on a concept page
 * is worthless to the person who has to buy it unless they can get from the
 * picture back to the asset, so every tile carries its number and a link to the
 * page that sells it — copyable, and one click from here.
 */
function assetTile(asset, used) {
  const badge = asset.kind === 'video' ? '<span class="brain-asset-kind">Video</span>' : '';
  const thumb = asset.thumb || asset.poster || asset.src;
  const purchase = assetPurchaseUrl(asset);
  const id = esc(asset.assetId || '');
  // `data-media-drag`, not `data-project-media`: the builder's picker uses that
  // second name for "click to place", and a gallery tile with a copy-id button
  // inside it must not place anything when it is clicked.
  return `<figure class="brain-asset${used ? ' is-used' : ''}" data-media-drag="${esc(asset.id || '')}" title="${esc(asset.alt)}">
    <img loading="lazy" src="${esc(thumb)}" alt="">
    ${badge}
    <figcaption>${used ? 'Placed' : 'Spare'}</figcaption>
    ${id ? `<div class="brain-asset-licence">
      <button type="button" class="brain-asset-id" data-brain-action="copy-asset-id" data-brain-asset-id="${id}" title="Copy this Shutterstock id">#${id}</button>
      ${purchase ? `<a class="brain-asset-buy" href="${esc(purchase)}" target="_blank" rel="noreferrer noopener" title="Open this asset on Shutterstock">Licence</a>` : ''}
    </div>` : ''}
  </figure>`;
}

/**
 * Adding one asset by its id.
 *
 * The search job is a good editor and a poor mind reader. Someone who has been
 * through Shutterstock themselves and found the exact shot should not have to
 * describe it back to a model and hope: they paste the number — or the whole
 * asset URL, since that is what is actually on the clipboard — and it joins the
 * pool as another watermarked preview, pickable on any module.
 */
function assetIdForm(media, { disabled = false } = {}) {
  const loading = media.lookupStatus === 'loading';
  return `<div class="brain-asset-add">
    <label for="brain-asset-id-input">Already know the one you want?</label>
    <div class="brain-asset-add-row">
      <input id="brain-asset-id-input" type="text" inputmode="text" autocomplete="off"
        placeholder="Shutterstock asset URL or numeric ID"
        value="${esc(media.assetIdQuery || '')}"
        data-brain-field="assetIdQuery" data-brain-scope="media"${off(disabled)}>
      ${jobButton({ action: 'add-media-asset', label: 'Add to imagery', workingLabel: 'Fetching…', busy: loading, disabled, variant: 'secondary' })}
    </div>
    ${media.lookupError ? `<p class="brain-error" role="alert">${esc(media.lookupError)}</p>` : ''}
    <p class="brain-hint">Paste the full Shutterstock asset URL or its numeric ID. The builder detects the asset ID automatically and adds the watermarked preview to your imagery library.</p>
  </div>`;
}

/**
 * The stock imagery panel. Shown in both builders, because the page needs
 * pictures whichever way it was assembled.
 *
 * It never applies silently and never hides what it did: the counts, the search
 * phrases the brain wrote and the licence status are all on screen, so the
 * strategist can see that these are comps and not licensed downloads.
 */
export function renderMediaPanel(context = {}) {
  const project = context.project || {};
  const brain = ensureBrainState(project);
  const media = ensureMediaState(project);
  const stock = brain.provider?.stock || {};
  // Two different questions. `busy` is "this panel's own job is running", and it
  // alone draws the spinner — a panel must never claim to be working on someone
  // else's job. `locked` is "some AI job is running", which is what disables the
  // buttons, because two jobs writing the page at once is what we are avoiding.
  const busy = isMediaBusy(media);
  const locked = busy || isBrainBusy(brain);
  const slots = typeof context.mediaSlots === 'function' ? context.mediaSlots() : [];
  const placed = new Set(media.assignments.map((entry) => entry.assetId));
  const stale = mediaIsStale(media, project.brief);
  const notConfigured = stock.configured === false;
  // The simple builder's one button already did the search; here the panel is
  // the library and the re-run, not a step somebody has to remember.
  const simpleBuilder = context.builderMode === 'simple';

  return `<section class="${panelClass('brain-panel is-compact', busy)}" data-brain-panel>
    <header class="brain-panel-head">
      <div>
        <span class="brain-kicker">AI picture editor</span>
        <h2>Find imagery for this brief</h2>
        <p>${simpleBuilder
          ? `Step 01's button already searched for these and placed them across the ${slots.length} media slot${slots.length === 1 ? '' : 's'} on the page. Search again for a different set, drag any picture below onto a module to move it, or add one you found yourself.`
          : `Searches the stock library for what this business actually looks like, then places one picture in each of the ${slots.length} media slot${slots.length === 1 ? '' : 's'} on the page — no picture twice.`} Team photos and testimonial portraits are left alone: those have to be the client's own people.</p>
      </div>
    </header>
    ${notConfigured ? '<p class="brain-hint is-warn">Stock search is not configured on this server. Add the Shutterstock credentials to <code>.env</code> and restart it.</p>' : ''}
    ${!slots.length && !notConfigured ? '<p class="brain-hint">Add a section that carries an image first — a hero, a split or a set of cards.</p>' : ''}
    ${stale ? '<p class="brain-hint is-warn">The brief changed after this imagery was found. Search again to match it.</p>' : ''}
    ${media.error ? `<p class="brain-error" role="alert">${esc(media.error)}</p>` : ''}
    <div class="brain-actions">
      ${jobButton({
        action: 'find-media',
        label: media.assets.length ? 'Search again' : simpleBuilder ? 'Search for imagery now' : 'Find imagery',
        workingLabel: 'Searching…',
        busy,
        disabled: locked || notConfigured || !slots.length,
      })}
      ${thinking(busy, media.liveMessage)}
      ${media.assets.length ? `<button type="button" class="brain-text-button" data-brain-action="clear-media"${off(locked)}>Restore placeholders</button>` : ''}
    </div>
    ${assetIdForm(media, { disabled: locked || notConfigured })}
    ${media.assets.length ? `
      <div class="brain-media-summary">
        ${sourceNote(media)}
        <span class="brain-source is-local">${esc(String(media.notice || 'Watermarked previews for client review.'))}</span>
        ${media.queries ? `<span class="brain-source is-local">Searched: “${esc(media.queries.images)}”${media.queries.videos ? ` · “${esc(media.queries.videos)}”` : ''}</span>` : ''}
        ${media.queries?.broadened ? `<span class="brain-source is-local">“${esc(media.queries.requested?.images || '')}” found nothing, so the search was widened.</span>` : ''}
        ${media.unassigned.length ? `<span class="brain-source is-local">${media.unassigned.length} slot${media.unassigned.length === 1 ? '' : 's'} kept a placeholder rather than repeat a picture.</span>` : ''}
      </div>
      <div class="brain-asset-grid">${media.assets.map((asset) => assetTile(asset, placed.has(asset.id))).join('')}</div>
    ` : ''}
  </section>`;
}

/* ------------------------------------------------------------------ *
 * Step 01 — the brief reader
 * ------------------------------------------------------------------ */

function readinessMarkup(brief) {
  const readiness = briefReadiness(brief);
  const rows = BRIEF_FIELD_ORDER.map(([key, label]) => {
    const filled = readiness.filled.includes(key);
    const required = readiness.missingRequired.includes(key);
    return `<li class="${filled ? 'is-filled' : required ? 'is-missing' : ''}"><span aria-hidden="true">${filled ? '✓' : required ? '!' : '·'}</span>${esc(label)}</li>`;
  }).join('');
  return `<div class="brain-readiness">
    <div class="brain-readiness-head"><b>${readiness.filled.length} of ${BRIEF_FIELD_ORDER.length} fields filled in</b><span>${readiness.ready ? 'Enough to work with' : 'Fill in a little more first'}</span></div>
    <ul>${rows}</ul>
    ${readiness.missingRequired.length ? `<p class="brain-hint">Add more detail to <b>${readiness.missingRequired.map((key) => esc(BRIEF_FIELD_ORDER.find(([field]) => field === key)[1])).join(', ')}</b> and the recommendations get much better.</p>` : ''}
  </div>`;
}

function readbackMarkup(brief, understanding) {
  const pairs = [
    ['What the business does', 'industry', understanding.readback.business],
    ['Who the page is for', 'audience', understanding.readback.audience],
    ['The core offer', 'offer', understanding.readback.offer],
    ['The one action this page must produce', 'goal', understanding.readback.goal],
    ['How the copy should sound', 'tone', understanding.readback.voice],
  ];
  return `<div class="brain-readback">
    <p class="brain-hint">This is what the brain took from your brief. Read it once: if a line is wrong, fix that field and read the brief again — everything below is built on these five sentences.</p>
    <dl>${pairs.map(([label, field, value]) => `<div${String(brief?.[field] || '').trim() ? '' : ' class="is-empty"'}>
      <dt>${esc(label)}</dt>
      <dd><b>${esc(value)}</b><small>Your ${esc(BRIEF_FIELD_ORDER.find(([key]) => key === field)[1])}: ${esc(String(brief?.[field] || '').trim() || 'left empty')}</small></dd>
    </div>`).join('')}</dl>
    <div class="brain-confirm-row">
      <div class="brain-meter" role="img" aria-label="Confidence ${percent(understanding.confidence)} percent"><i style="--brain-meter:${percent(understanding.confidence)}%"></i></div>
      <span><b>${percent(understanding.confidence)}% confident</b> in this reading</span>
      ${sourceNote(understanding)}
    </div>
    ${understanding.missingFields?.length ? `<p class="brain-hint is-warn">The brain could not find: ${understanding.missingFields.map((field) => esc(BRIEF_FIELD_ORDER.find(([key]) => key === field)?.[1] || field)).join(', ')}.</p>` : ''}
    ${understanding.keywords?.length ? `<div class="brain-chips is-keywords">${understanding.keywords.map((keyword) => `<span>${esc(keyword)}</span>`).join('')}</div>` : ''}
    ${understanding.signals?.length ? `<div class="brain-signals"><b>What the brief is asking the page to do</b><ul>${understanding.signals.slice(0, 4).map((signal) => `<li>${esc(signal.label)}</li>`).join('')}</ul></div>` : ''}
  </div>`;
}

function archetypeRecommendation(understanding, context) {
  const recommendation = understanding.archetype;
  if (!recommendation) return '';
  const current = context.project?.design?.archetype;
  const applied = current === recommendation.key;
  return `<div class="brain-recommendation">
    <div><span class="brain-kicker">Recommended visual archetype</span><h4>${esc(recommendation.key)} · ${esc(understanding.archetypeName || recommendation.key)}</h4><p>${esc(recommendation.reason)}</p></div>
    <button type="button" class="brain-primary-button" data-brain-action="apply-archetype" data-brain-archetype="${esc(recommendation.key)}"${off(applied)}>${applied ? 'Already applied' : 'Apply this archetype'}</button>
  </div>`;
}

function flowRecommendationList(understanding, context, { compact = false } = {}) {
  const flows = understanding?.flows || [];
  if (!flows.length) return '';
  const catalog = new Map((context.flows || []).map((flow) => [flow.id, flow]));
  const current = context.project?.flowId;
  return `<ol class="brain-flow-list${compact ? ' is-compact' : ''}">${flows.map((recommendation, index) => {
    const flow = catalog.get(recommendation.id);
    if (!flow) return '';
    const active = current === flow.id;
    return `<li class="${active ? 'is-active' : ''}">
      <div class="brain-flow-rank">${index + 1}</div>
      <div class="brain-flow-copy">
        <b>${esc(flow.name)} <small>${esc(flow.id)}</small></b>
        <p>${esc(recommendation.reason)}</p>
        ${compact ? '' : `<p class="brain-flow-tagline">${esc(flow.tagline)}. ${esc(flow.bestFor)}</p>`}
        ${familyChips(flow.families)}
        ${recommendation.backfilled ? '<small class="brain-flow-note">Added by the built-in planner to complete the shortlist.</small>' : ''}
      </div>
      <div class="brain-flow-actions">
        <span class="brain-fit" title="Fit for this brief">${percent(recommendation.fit)}%</span>
        <button type="button" class="brain-secondary-button" data-brain-action="apply-flow" data-brain-flow="${esc(flow.id)}"${off(active)}>${active ? 'In use' : 'Use this flow'}</button>
      </div>
    </li>`;
  }).join('')}</ol>`;
}

function contentDraftMarkup(brain, context) {
  const draft = brain.contentDraft;
  if (!draft) {
    return `<p class="brain-hint">The brain writes a first draft for every section in the current page flow, using only the words in your brief. Nothing is applied until you press Apply.</p>`;
  }
  const sections = draft.sections || [];
  const footer = draft.footer && draft.footer.statement ? draft.footer : null;
  return `<div class="brain-draft">
    <div class="brain-draft-head"><b>${sections.length} section${sections.length === 1 ? '' : 's'}${footer ? ' and the footer' : ''} drafted</b>${sourceNote(draft)}</div>
    <ol>${sections.map((section) => `<li>
      <span class="brain-draft-family">${esc(sectionFamilyLabel(section.family))}</span>
      <div>
        ${section.pretitle ? `<small>${esc(section.pretitle)}</small>` : ''}
        <b>${esc(section.title || '—')}</b>
        ${section.subtitle ? `<p>${esc(section.subtitle)}</p>` : ''}
        ${section.body ? `<p>${esc(section.body)}</p>` : ''}
        ${section.items?.length ? `<ul class="brain-draft-items">${section.items.slice(0, 4).map((item) => `<li>${item.value ? `<i>${esc(item.value)}</i> ` : ''}${esc(item.title || '')}${item.description ? ` — ${esc(item.description)}` : ''}</li>`).join('')}</ul>` : ''}
        ${section.buttons?.length ? `<div class="brain-chips is-buttons">${section.buttons.map((button) => `<span>${esc(button.text)}</span>`).join('')}</div>` : ''}
        ${section.aiWritten === false ? '<small class="brain-flow-note">Drafted locally — the model skipped this section.</small>' : ''}
      </div>
    </li>`).join('')}${footer ? `
    <li>
      <span class="brain-draft-family">Footer</span>
      <div>
        <b>${esc(footer.statement)}</b>
        ${footer.description ? `<p>${esc(footer.description)}</p>` : ''}
        ${footer.ctaText ? `<div class="brain-chips is-buttons"><span>${esc(footer.ctaText)}</span></div>` : ''}
        ${footer.aiWritten === false ? '<small class="brain-flow-note">Drafted locally — the model skipped the footer.</small>' : ''}
      </div>
    </li>` : ''}</ol>
    <div class="brain-draft-actions">
      <button type="button" class="brain-primary-button" data-brain-action="apply-content"${off(isBrainBusy(brain))}>Apply this content to the page</button>
      <button type="button" class="brain-text-button" data-brain-action="discard-content"${off(isBrainBusy(brain))}>Discard draft</button>
      ${brain.contentAppliedAt ? `<span class="brain-source is-local">Applied ${esc(new Date(brain.contentAppliedAt).toLocaleString())}</span>` : ''}
    </div>
    <p class="brain-hint">Applying replaces the copy in every module of the current flow${footer ? ', plus the footer statement, its supporting line and its button label' : ''}. Media, patterns, layout and effects are untouched, and Undo reverses it in one step.</p>
    ${context.debug ? '' : ''}
  </div>`;
}

/**
 * Step 01 panel. This is the one place that proves the AI actually read the
 * brief, so the readback is the largest thing on it.
 */
export function renderBriefBrainPanel(context = {}) {
  const project = context.project || {};
  const brain = ensureBrainState(project);
  const busy = isBrainBusy(brain);
  const brief = project.brief || {};
  const readiness = briefReadiness(brief);
  const understanding = brain.understanding;
  const stale = understandingIsStale(brain, brief);
  const sections = (project.sections || []).length;

  const running = busyAction(brain, busy);
  return `<section class="${panelClass('brain-panel', busy)}" data-brain-panel>
    <div class="brain-live" aria-live="polite" aria-atomic="true" data-brain-live>${esc(brain.liveMessage || brainStatusLabel(brain))}</div>
    <header class="brain-panel-head">
      <div>
        <span class="brain-kicker">AI brief reader · one model, three jobs</span>
        <h2>Turn this brief into a page</h2>
        <p>The brain reads the fields above, confirms what it understood, recommends a visual archetype and the five best page flows, then writes the first draft of every section.</p>
      </div>
      <span class="brain-badge ${brain.status === 'error' ? 'is-error' : understanding ? 'is-ready' : busy ? 'is-working' : ''}">${esc(brainStatusLabel(brain))}</span>
    </header>
    ${providerLine(brain)}
    ${readinessMarkup(brief)}
    ${brain.error ? `<p class="brain-error" role="alert">${esc(brain.error)}</p>` : ''}
    ${stale ? '<p class="brain-hint is-warn">The brief has changed since the brain last read it. Read it again to refresh the recommendations.</p>' : ''}

    <div class="brain-actions">
      ${jobButton({
        action: 'understand',
        label: understanding ? 'Read the brief again' : 'Read my brief',
        workingLabel: 'Reading the brief…',
        busy: running === 'understand',
        disabled: busy,
      })}
      ${thinking(running === 'understand', brain.liveMessage)}
      ${readiness.ready ? '' : '<span class="brain-hint">You can run it now, but a fuller brief gives a much better result.</span>'}
    </div>

    ${understanding ? `
      ${readbackMarkup(brief, understanding)}
      ${archetypeRecommendation(understanding, context)}
      <div class="brain-subhead"><b>Best page flows for this brief</b><small>Full comparison lives in Step 03</small></div>
      ${flowRecommendationList(understanding, context, { compact: true })}
    ` : ''}

    <div class="brain-subhead"><b>First draft of the page content</b><small>${sections} module${sections === 1 ? '' : 's'} in the current flow</small></div>
    <div class="brain-actions">
      ${jobButton({
        action: 'write-content',
        label: brain.contentDraft ? 'Rewrite the page content' : 'Write the page content',
        workingLabel: 'Writing every section…',
        busy: running === 'write-content',
        disabled: busy || !sections,
        variant: 'secondary',
      })}
      ${thinking(running === 'write-content', brain.liveMessage)}
    </div>
    ${contentDraftMarkup(brain, context)}
  </section>`;
}

/* ------------------------------------------------------------------ *
 * Step 03 — the flow planner
 * ------------------------------------------------------------------ */

/**
 * The typed-outline builder.
 *
 * One copy, used by the advanced flow step and the simple one. It used to be
 * duplicated in both, which is how the two drifted.
 *
 * The section reference is the point of it. "The page will have…" over an empty box
 * asks the strategist to guess the vocabulary, and a guess the mapper cannot resolve
 * comes back as an unresolved line. Every family the engine can actually build is
 * listed with what it is for, and each one is a button that appends itself to the
 * outline — so the box can be filled without typing and without guessing.
 */
function outlineBuilder({ brain, busy, planning }) {
  const outline = String(brain.outline || '');
  const used = new Set(
    outline.split(/\r?\n/)
      .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim().toLowerCase())
      .filter(Boolean),
  );
  const sections = SECTION_FAMILIES.map((family) => {
    const already = used.has(family.label.toLowerCase());
    return `<button type="button" class="outline-section${already ? ' is-used' : ''}"
      data-brain-action="insert-section" data-brain-family="${esc(family.id)}"${off(busy || planning)}
      title="${esc(family.purpose)}">
      <b>${esc(family.label)}</b><span>${esc(family.purpose)}</span>
    </button>`;
  }).join('');

  return `<div class="brain-subhead"><b>Or describe the page you want</b><small>Built from registered DST sections only</small></div>
    <label class="brain-field" for="brain-outline"><span>The page will have…</span>
      <textarea id="brain-outline" rows="4" maxlength="2000" placeholder="1. Hero&#10;2. Before after image gallery&#10;3. A pricing&#10;4. Testimonials" data-brain-field="outline"${off(busy)}>${esc(outline)}</textarea>
    </label>
    <details class="outline-reference"${brain.outlineReferenceOpen === false ? '' : ' open'}>
      <summary data-brain-action="toggle-outline-reference"><b>Everything you can ask for</b><small>${SECTION_FAMILIES.length} registered sections · click to add</small></summary>
      <p class="brain-hint">Type them in any words you like — "before and after", "what we do", "by the numbers" all resolve. These are the ${SECTION_FAMILIES.length} sections the builder can produce, and nothing outside this list can be built.</p>
      <div class="outline-sections">${sections}</div>
    </details>
    <div class="brain-actions">
      ${jobButton({
        action: 'plan-outline',
        label: 'Build this page flow',
        workingLabel: 'Mapping your outline…',
        busy: planning,
        disabled: busy || outline.trim().length < 3,
      })}
      ${thinking(planning, brain.liveMessage)}
      <span class="brain-hint">Every line becomes a real DST module with real content fields.</span>
    </div>
    ${outlinePlanMarkup(brain, busy || planning)}`;
}

function outlinePlanMarkup(brain, busy) {
  const plan = brain.outlinePlan;
  if (!plan) {
    return `<p class="brain-hint">Type the sections you want, in order. Numbered lists, bullets or a plain sentence all work — the brain maps each line to a registered DST section.</p>`;
  }
  const steps = plan.steps || [];
  const usable = steps.filter((step) => step.family).length;
  return `<div class="brain-plan">
    <div class="brain-draft-head"><b>${esc(plan.name || 'Custom outline')}</b>${sourceNote(plan)}</div>
    ${plan.rationale ? `<p class="brain-hint">${esc(plan.rationale)}</p>` : ''}
    <ol class="brain-plan-steps">${steps.map((step, index) => `<li class="${step.family ? '' : 'is-unresolved'}">
      <span class="brain-plan-index">${String(index + 1).padStart(2, '0')}</span>
      <div class="brain-plan-copy"><b>${esc(step.requested)}</b><small>${esc(step.reason || '')}</small></div>
      ${familySelect(index, step.family || '', busy)}
      <button type="button" class="brain-icon-button" title="Remove this step" aria-label="Remove step ${index + 1}" data-brain-action="outline-step-remove" data-brain-index="${index}"${off(busy)}>×</button>
    </li>`).join('')}</ol>
    ${plan.added?.length ? `<div class="brain-plan-added"><b>The brain will also add</b><ul>${plan.added.map((entry) => `<li><b>${esc(sectionFamilyLabel(entry.family))}</b> — ${esc(entry.reason || '')}</li>`).join('')}</ul></div>` : ''}
    <div class="brain-draft-actions">
      <button type="button" class="brain-primary-button" data-brain-action="apply-outline"${off(busy || !usable)}>Create this page flow${usable ? ` (${usable} section${usable === 1 ? '' : 's'})` : ''}</button>
      <button type="button" class="brain-text-button" data-brain-action="discard-outline"${off(busy)}>Start over</button>
    </div>
    ${usable === steps.length ? '' : '<p class="brain-hint is-warn">Pick a section for every line, or remove the lines you did not mean as sections.</p>'}
  </div>`;
}

/** Step 03 panel: the three recommendations, then the build-your-own outline. */
export function renderFlowBrainPanel(context = {}) {
  const project = context.project || {};
  const brain = ensureBrainState(project);
  const busy = isBrainBusy(brain);
  const understanding = brain.understanding;

  const running = busyAction(brain, busy);
  return `<section class="${panelClass('brain-panel is-flow', busy)}" data-brain-panel>
    <div class="brain-live" aria-live="polite" aria-atomic="true" data-brain-live>${esc(brain.liveMessage || brainStatusLabel(brain))}</div>
    <header class="brain-panel-head">
      <div>
        <span class="brain-kicker">AI flow planner</span>
        <h2>Let the brain choose the sequence</h2>
        <p>The same model that read your brief ranks every flow in the library, or builds a brand new one from a list you type.</p>
      </div>
      <span class="brain-badge ${understanding ? 'is-ready' : ''}">${esc(brainStatusLabel(brain))}</span>
    </header>
    ${brain.error ? `<p class="brain-error" role="alert">${esc(brain.error)}</p>` : ''}

    <div class="brain-subhead"><b>The five best flows for this brief</b><small>${(context.flows || []).length} flows in the library</small></div>
    ${understanding
      ? flowRecommendationList(understanding, context)
      : `<p class="brain-hint">Read the brief in Step 01 first, or run it here.</p>`}
    <div class="brain-actions">
      ${jobButton({
        action: 'understand',
        label: understanding ? 'Re-rank the flows' : 'Rank the flows for this brief',
        workingLabel: 'Ranking the flows…',
        busy: running === 'understand',
        disabled: busy,
        variant: 'secondary',
      })}
      ${thinking(running === 'understand', brain.liveMessage)}
    </div>

    ${outlineBuilder({ brain, busy, planning: running === 'plan-outline' })}
  </section>`;
}

/* ------------------------------------------------------------------ *
 * The simple builder
 * ------------------------------------------------------------------ */


const BRIEF_PLACEHOLDER = `Harbour Dental is a family dental practice in Portsmouth offering routine, cosmetic and emergency care.

Our audience is local families and nervous adult patients who have avoided the dentist for years. We want them to book their first appointment online.

We offer gentle, judgement-free dentistry with same-week emergency appointments and clear fixed pricing. The tone should be calm, plain and reassuring — never salesy.`;

/** The five things the brain needs, as a checklist the strategist can scan. */
const BRIEF_CHECKLIST = Object.freeze([
  ['business', 'What the business does'],
  ['audience', 'Who the page is for'],
  ['offer', 'What you are offering'],
  ['goal', 'The one action you want'],
  ['voice', 'How it should sound'],
]);

/*
 * What the one button is doing, and what it did.
 *
 * Four jobs behind one press need to say which one they are on, or a
 * forty-second wait reads as a hang. And once it is over, the counts are the
 * only honest way to say what landed on the page: "3 concepts" when the
 * copywriter timed out is a very different result from "3 concepts, 9 sections
 * written, 7 pictures placed", and the difference must not be silent.
 */
const STAGE_LABELS = {
  brief: 'Reading the brief…',
  content: 'Writing the copy…',
  media: 'Finding imagery…',
  concepts: 'Building the concepts…',
};

const RUN_STAGES = [
  ['brief', 'Reading the brief'],
  ['content', 'Writing the copy'],
  ['media', 'Finding imagery'],
  ['concepts', 'Building the concepts'],
];

function runStages(simple, busy) {
  if (!busy) return '';
  const at = RUN_STAGES.findIndex(([key]) => key === simple.stage);
  return `<ol class="brain-stages" aria-label="Progress">${RUN_STAGES.map(([key, label], index) => {
    const state = at < 0 ? '' : index < at ? 'is-done' : index === at ? 'is-live' : '';
    return `<li class="${state}"><i aria-hidden="true">${index < at ? '✓' : index + 1}</i>${esc(label)}</li>`;
  }).join('')}</ol>`;
}

function runReport(simple) {
  const report = simple.report;
  if (!report) return '';
  const counts = [
    `${report.concepts} concept${report.concepts === 1 ? '' : 's'} designed`,
    report.written ? `${report.written} section${report.written === 1 ? '' : 's'} written and applied` : '',
    report.placed ? `${report.placed} picture${report.placed === 1 ? '' : 's'} found and placed` : '',
  ].filter(Boolean);
  return `<div class="brain-report">
    <ul>${counts.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>
    ${(report.notes || []).map((note) => `<p class="brain-hint is-warn">${esc(note)}</p>`).join('')}
  </div>`;
}

function simpleReadbackMarkup(simple) {
  const readback = simple.readback;
  if (!readback) return '';
  const rows = [
    ['What the business does', readback.business],
    ['Who the page is for', readback.audience],
    ['What you are offering', readback.offer],
    ['The one action this page must produce', readback.goal],
    ['How the copy should sound', readback.voice],
  ];
  return `<div class="brain-readback is-simple">
    <p class="brain-hint">This is what the brain took from your paragraph. If a line is wrong, edit the brief above and read it again — the three concepts are built on these five sentences.</p>
    <dl>${rows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd><b>${esc(value)}</b></dd></div>`).join('')}</dl>
    <div class="brain-confirm-row">
      <div class="brain-meter" role="img" aria-label="Confidence ${percent(simple.confidence)} percent"><i style="--brain-meter:${percent(simple.confidence)}%"></i></div>
      <span><b>${percent(simple.confidence)}% confident</b> in this reading</span>
      ${sourceNote({ source: simple.source, model: simple.model, degraded: simple.degraded })}
    </div>
    ${simple.missingFields?.length ? `<p class="brain-hint is-warn">Not described yet: ${simple.missingFields.map((field) => esc(field)).join(', ')}. Add a line about each and read the brief again.</p>` : ''}
  </div>`;
}

function conceptCard(concept, index, simple, context) {
  const active = simple.active === index;
  const preset = context.presets?.find((entry) => entry.id === concept.preset);
  const buttonStyle = context.buttonStyles?.find((entry) => entry.id === concept.buttonStyle);
  const overrides = Object.entries(concept.dialOverrides || {});
  return `<article class="concept-card${active ? ' is-active' : ''}" data-concept-index="${index}">
    <header>
      <span class="concept-slot">${esc(concept.slot || `V${index + 1}`)}</span>
      <div><b>${esc(concept.name)}</b><small>${esc(concept.archetypeName || concept.archetypeKey)}</small></div>
      ${active ? '<span class="concept-chosen">In preview</span>' : ''}
    </header>
    <p class="concept-why">${esc(concept.why)}</p>
    <dl class="concept-facts">
      <div><dt>Style</dt><dd>${esc(preset ? preset.label : concept.preset)}</dd></div>
      <div><dt>Buttons</dt><dd>${esc(buttonStyle ? buttonStyle.label : concept.buttonStyle)}</dd></div>
      <div><dt>Archetype</dt><dd>${esc(concept.archetypeKey)}</dd></div>
    </dl>
    ${overrides.length ? `<div class="brain-chips">${overrides.map(([dial, value]) => `<span>${esc(dial)} ${value}</span>`).join('')}</div>` : ''}
    ${concept.backfilled ? '<small class="brain-flow-note">Added by the built-in planner to complete the set of three.</small>' : ''}
    <button type="button" class="${active ? 'brain-secondary-button' : 'brain-primary-button'}" data-brain-action="use-concept" data-brain-index="${index}">
      ${active ? 'Previewing this one' : `Preview ${esc(concept.slot || `V${index + 1}`)}`}
    </button>
  </article>`;
}

/**
 * Step 01 of the simple builder: one paragraph in, three concepts out.
 *
 * Everything a strategist needs to put three options in front of a client lives
 * on this one step, and nothing else does.
 */
export function renderSimpleBriefPanel(context = {}) {
  const project = context.project || {};
  const simple = ensureSimpleState(project);
  const busy = isSimpleBusy(simple);
  const written = String(simple.briefText || '').trim();
  // The brief is the paragraph *and* the attachments, so everything the panel
  // reports and everything it gates on is measured on both.
  const attachments = briefAttachments(project);
  const source = briefSourceLength(project);
  const stale = conceptsAreStale(project);
  const chosen = hasChosenConcept(simple);

  return `<section class="${panelClass('brain-panel is-simple', busy)}" data-brain-panel>
    <div class="brain-live" aria-live="polite" aria-atomic="true" data-brain-live>${esc(simple.liveMessage || brainStatusLabel(ensureBrainState(project)))}</div>
    <header class="brain-panel-head">
      <div>
        <span class="brain-kicker">AI brief reader · one paragraph is enough</span>
        <h2>Describe the project once</h2>
        <p>Write about the business, the audience, the offer, the action you want and the tone you want. One press then does the whole first pass: it designs three concepts, writes the copy for every section and puts it on the page, and finds the imagery and places it.</p>
      </div>
      <span class="brain-badge ${simple.status === 'error' ? 'is-error' : simple.concepts.length ? 'is-ready' : busy ? 'is-working' : ''}">${esc(
        simple.status === 'error' ? 'Needs attention'
          : busy ? 'Building concepts…'
            : simple.concepts.length ? `${simple.concepts.length} concepts ready` : 'Ready for your brief'
      )}</span>
    </header>
    ${providerLine(ensureBrainState(project))}

    <label class="brain-field" for="simple-brief"><span>The project, in your own words</span>
      <textarea id="simple-brief" rows="10" maxlength="${BRIEF_TEXT_LIMIT}" placeholder="${esc(BRIEF_PLACEHOLDER)}" data-brain-field="briefText" data-brain-scope="simple"${off(busy)}>${esc(simple.briefText || '')}</textarea>
    </label>
    ${typeof context.briefDropZone === 'function' ? context.briefDropZone(attachments) : ''}
    <div class="brief-checklist">
      ${BRIEF_CHECKLIST.map(([key, label]) => {
        const covered = Boolean(simple.readback && simple.readback[key] && !(simple.missingFields || []).includes(key));
        return `<span class="${covered ? 'is-covered' : ''}"><i aria-hidden="true">${covered ? '✓' : '·'}</i>${esc(label)}</span>`;
      }).join('')}
      <em>${source.toLocaleString()} / ${BRIEF_TEXT_LIMIT.toLocaleString()} characters${attachments.length ? ` · ${attachments.length} attached` : ''}</em>
    </div>
    ${simple.error ? `<p class="brain-error" role="alert">${esc(simple.error)}</p>` : ''}
    ${stale ? '<p class="brain-hint is-warn">The brief has changed since these concepts were built. Read it again to refresh them.</p>' : ''}

    <div class="brain-actions">
      ${jobButton({
        action: 'build-concepts',
        label: simple.concepts.length ? 'Read the brief again' : 'Read my brief and build 3 concepts',
        workingLabel: STAGE_LABELS[simple.stage] || 'Working…',
        busy,
        // An attached document is a brief. Requiring the paragraph as well would
        // mean retyping what the client already wrote down.
        disabled: busy || source < 20,
      })}
      ${thinking(busy, simple.liveMessage)}
      ${source < 20 ? '<span class="brain-hint">A few sentences, or the client\u2019s own brief dropped in above.</span>' : ''}
    </div>
    ${busy ? runStages(simple, busy) : ''}
    ${busy ? '' : runReport(simple)}

    ${simpleReadbackMarkup(simple)}

    ${simple.concepts.length ? `
      ${directiveSummary(simple.directives) ? `<p class="brain-hint is-pinned">${esc(directiveSummary(simple.directives))}</p>` : ''}
      <div class="brain-subhead"><b>Three concepts from your brief</b><small>${chosen ? 'Switch any time with the pills on the preview' : 'Choose one to continue'}</small></div>
      <div class="concept-grid">${simple.concepts.map((concept, index) => conceptCard(concept, index, simple, context)).join('')}</div>
      ${chosen ? '' : '<p class="brain-hint is-warn">Pick a concept to carry into the next step. You can switch between all three at any point without losing your work.</p>'}
    ` : ''}
  </section>`;
}

/**
 * Step 02 of the simple builder: the three recommended flows and nothing else.
 * The full flow library and the page sequence belong to the advanced builder and
 * to Step 03 respectively.
 */
export function renderSimpleFlowPanel(context = {}) {
  const project = context.project || {};
  const simple = ensureSimpleState(project);
  const busy = isSimpleBusy(simple);
  const understanding = simple.flows.length ? { flows: simple.flows, source: simple.source, model: simple.model } : null;

  const brain = ensureBrainState(project);
  const planning = isBrainBusy(brain) && brain.status === 'planning';
  return `<section class="${panelClass('brain-panel is-flow', busy || planning)}" data-brain-panel>
    <div class="brain-live" aria-live="polite" aria-atomic="true" data-brain-live>${esc(simple.liveMessage || '')}</div>
    <header class="brain-panel-head">
      <div>
        <span class="brain-kicker">AI flow planner</span>
        <h2>Pick the sequence</h2>
        <p>The brain ranked every flow in the library against your brief. Choose one, or describe the page you want and it will build the sequence from registered DST sections.</p>
      </div>
      ${understanding ? sourceNote(understanding) : ''}
    </header>
    ${simple.error ? `<p class="brain-error" role="alert">${esc(simple.error)}</p>` : ''}

    <div class="brain-subhead"><b>The five best flows for this brief</b><small>${(context.flows || []).length} flows considered</small></div>
    ${understanding
      ? flowRecommendationList(understanding, context)
      : `<p class="brain-hint">Read your brief in Step 01 first and the five best flows will appear here.</p>`}

    ${outlineBuilder({ brain, busy, planning })}
  </section>`;
}
