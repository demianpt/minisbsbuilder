import { familyVocabularyPrompt, isSectionFamily, SECTION_FAMILY_IDS } from '../../shared/brief/families.mjs';
import { BRIEF_TEXT_LIMIT, BriefExpansionJsonSchema, BriefUnderstandingJsonSchema, OutlinePlanJsonSchema, PageContentJsonSchema, buildConceptSetJsonSchema, parseBriefExpansion, parseBriefFields, parseBriefUnderstanding, parseConceptSet, parseOutlinePlan, parsePageContent } from '../../shared/brief/schemas.mjs';
import {
  MediaAssignmentJsonSchema,
  MediaQueriesJsonSchema,
  MediaSlotSchema,
  assignMedia,
  broadeningSearch,
  isPeopleFamily,
  mediaQueriesFromBrief,
  parseMediaAssignment,
  parseMediaQueries,
  slotPrefersVideo,
} from '../../shared/brief/media.mjs';
import { conceptsFromBrief, draftPageContent, expandBriefText, planOutline, recommendFromBrief } from '../../shared/brief/planner.mjs';
import { applyDirectivesToConcepts, extractBriefDirectives } from '../../shared/brief/directives.mjs';
import { paletteContrastReport, paletteVariant, repairPalette } from '../../shared/design/palette.mjs';
import { PRESET_IDS, normalizeConceptList } from '../../shared/design/concepts.mjs';
import { BUTTON_STYLE_IDS } from '../../shared/design/button-styles.mjs';
import { loadPrompt } from '../ai/prompt-loader.mjs';
import { BriefBrainError } from '../shared/errors.mjs';

/**
 * The Brief Brain. One model, three jobs, one rule: the model may only choose
 * from vocabularies this server sends it, and every answer is validated against
 * a schema before it can reach a project. When the model is unavailable or
 * off-contract, the deterministic planner answers instead — the editor is never
 * blocked on inference.
 */

const MAX_CATALOG_ARCHETYPES = 13;
const MAX_CATALOG_FLOWS = 40;
const MAX_MEDIA_SLOTS = 48;

function text(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Archetype catalog entries are editor-supplied; keep only what the model needs. */
function safeArchetypeCatalog(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === 'object' && /^[A-M]$/.test(String(entry.key)))
    .slice(0, MAX_CATALOG_ARCHETYPES)
    .map((entry) => ({
      key: String(entry.key),
      name: text(entry.name, 80),
      polarity: text(entry.polarity, 24),
      summary: text(entry.summary, 240),
      palette: safePalette(entry.palette),
    }));
}

/** Five hex roles or nothing. Never a partially-parsed palette. */
function safePalette(value) {
  if (!value || typeof value !== 'object') return null;
  const out = {};
  for (const role of ['bg', 'ink', 'accent', 'soft', 'dark']) {
    const hex = text(value[role], 9).trim();
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) out[role] = hex;
  }
  return Object.keys(out).length === 5 ? out : null;
}

function safeFlowCatalog(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === 'object' && entry.id && Array.isArray(entry.families))
    .slice(0, MAX_CATALOG_FLOWS)
    .map((entry) => ({
      id: text(entry.id, 12),
      name: text(entry.name, 80),
      tagline: text(entry.tagline, 160),
      bestFor: text(entry.bestFor, 200),
      families: entry.families.filter(isSectionFamily).slice(0, 16),
    }))
    .filter((entry) => entry.families.length);
}

function safeFamilies(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(isSectionFamily).slice(0, 14);
}

/**
 * The editor knows which pattern is on each section and therefore how many
 * pictures it can hold; this server decides which of those slots stock media is
 * allowed to touch. People slots are dropped here, once, so both builders behave
 * the same way without either of them having to remember the rule.
 */
function safeMediaSlots(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const slots = [];
  for (const entry of value) {
    if (slots.length >= MAX_MEDIA_SLOTS) break;
    const parsed = MediaSlotSchema.safeParse(entry);
    if (!parsed.success) continue;
    const slot = parsed.data;
    if (isPeopleFamily(slot.family) || seen.has(slot.key)) continue;
    seen.add(slot.key);
    slots.push({ ...slot, prefersVideo: slotPrefersVideo(slot) });
  }
  return slots;
}

function briefBlock(brief) {
  return [
    ['Project name', brief.projectName],
    ['Client / brand', brief.clientName],
    ['Industry / context', brief.industry],
    ['Primary audience', brief.audience],
    ['Primary page goal', brief.goal],
    ['Core offer', brief.offer],
    ['Voice and tone', brief.tone],
    ['Useful words / themes', brief.keywords],
    ['Internal notes', brief.notes],
  ].map(([label, value]) => `${label}: ${value || '(empty)'}`).join('\n');
}

function providerUnavailable(error) {
  return [
    'OLLAMA_NOT_CONFIGURED', 'OLLAMA_UNAVAILABLE', 'OLLAMA_TIMEOUT',
    'OLLAMA_RATE_LIMITED', 'OLLAMA_FORBIDDEN', 'OLLAMA_MODEL_NOT_FOUND',
    'OLLAMA_INVALID_JSON', 'OLLAMA_SCHEMA_INVALID', 'SCHEMA_INVALID',
  ].includes(error?.code) || error?.name === 'ZodError';
}

/*
 * What to tell the operator, per cause.
 *
 * "The AI model could not answer in time" was the message for every one of these,
 * including a key without access and a model name that does not exist — neither
 * of which is a timeout and neither of which improves by waiting.
 */
const DEGRADED_MESSAGES = {
  OLLAMA_NOT_CONFIGURED: 'The AI model is not configured on this server, so the built-in planner answered instead.',
  OLLAMA_RATE_LIMITED: 'The AI provider is rate limiting this key, so the built-in planner answered instead. Try again in a minute.',
  OLLAMA_FORBIDDEN: 'The AI provider refused the configured key or model, so the built-in planner answered instead. The server log has the reason.',
  OLLAMA_MODEL_NOT_FOUND: 'The configured AI model does not exist on the provider, so the built-in planner answered instead. Check OLLAMA_MODEL.',
  OLLAMA_TIMEOUT: 'The AI model did not answer in time, so the built-in planner answered instead.',
  OLLAMA_INVALID_JSON: 'The AI model returned something that was not usable, so the built-in planner answered instead.',
  OLLAMA_SCHEMA_INVALID: 'The AI model returned something that did not fit the required shape, so the built-in planner answered instead.',
};

function degradedMessage(code) {
  return DEGRADED_MESSAGES[code] || 'The AI model could not answer, so the built-in planner answered instead.';
}

/**
 * Runs an AI job, then falls back to the deterministic twin rather than failing
 * the request. `degraded` tells the editor exactly what happened so the UI can
 * say "written without the model" instead of pretending.
 */
async function withFallback({ run, fallback, logger, job }) {
  try {
    const result = await run();
    return { ...result, source: 'ai', degraded: null };
  } catch (error) {
    if (!providerUnavailable(error)) throw error;
    const code = error?.code || (error?.name === 'ZodError' ? 'OLLAMA_SCHEMA_INVALID' : 'UNKNOWN');
    /*
     * The log line is what an operator has to act on, so it carries the reason
     * rather than only the code — the provider's own status and message, and the
     * retry hint when there is one. It never carries the key: `details` is built
     * from the response, and the response does not contain it.
     */
    logger?.warn('brief_brain_degraded', {
      job,
      code,
      status: error?.details?.status,
      retryAfter: error?.details?.retryAfter,
      reason: error?.details?.provider || error?.message,
    });
    return {
      ...fallback(),
      degraded: { code, message: degradedMessage(code) },
    };
  }
}

export function createBriefBrain({ provider, stock, config, logger } = {}) {
  if (!provider) throw new Error('The Brief Brain requires an AI provider.');

  /** Job 1 — read the brief, recommend one archetype and five flows. */
  async function understand(input = {}) {
    const brief = parseBriefFields(input.brief);
    const archetypes = safeArchetypeCatalog(input.archetypes);
    const flows = safeFlowCatalog(input.flows);
    if (!archetypes.length) throw new BriefBrainError('CATALOG_REQUIRED', 'Send the archetype catalog with the brief.', { status: 422 });
    if (!flows.length) throw new BriefBrainError('CATALOG_REQUIRED', 'Send the page flow catalog with the brief.', { status: 422 });

    const archetypeMap = Object.fromEntries(archetypes.map((entry) => [entry.key, entry]));
    const flowIds = new Set(flows.map((entry) => entry.id));

    const result = await withFallback({
      job: 'understand',
      logger,
      fallback: () => recommendFromBrief({ brief, archetypes: archetypeMap, flows }),
      run: async () => {
        const systemPrompt = await loadPrompt('brief-architect');
        const userPrompt = [
          '## Project brief', briefBlock(brief), '',
          '## Archetype catalog (choose exactly one key)',
          archetypes.map((entry) => `- ${entry.key} · ${entry.name} · ${entry.polarity}: ${entry.summary}`).join('\n'), '',
          '## Page flow catalog (choose exactly five ids, best first)',
          flows.map((entry) => `- ${entry.id} · ${entry.name}: ${entry.tagline}. Best for ${entry.bestFor}. Sections: ${entry.families.join(' → ')}`).join('\n'),
        ].join('\n');
        const value = await provider.generateJson({
          systemPrompt,
          userPrompt,
          jsonSchema: BriefUnderstandingJsonSchema,
          maxTokens: config?.briefUnderstandTokens,
          validate: (candidate) => {
            const parsed = parseBriefUnderstanding(candidate);
            if (!archetypeMap[parsed.archetype.key]) {
              throw new BriefBrainError('SCHEMA_INVALID', `archetype.key must be one of ${archetypes.map((entry) => entry.key).join(', ')}.`, { status: 502 });
            }
            const unique = [];
            for (const flow of parsed.flows) {
              if (!flowIds.has(flow.id) || unique.some((entry) => entry.id === flow.id)) continue;
              unique.push(flow);
            }
            if (!unique.length) throw new BriefBrainError('SCHEMA_INVALID', `flows[].id must be one of ${[...flowIds].join(', ')}.`, { status: 502 });
            return { ...parsed, flows: unique.slice(0, 5) };
          },
        });
        // The model chose the shortlist; the deterministic signals stay attached
        // because the editor shows them as the auditable "why".
        return { ...value, signals: recommendFromBrief({ brief, archetypes: archetypeMap, flows }).signals };
      },
    });

    // Five recommendations are promised in the UI. Top up from the
    // deterministic ranking rather than showing one lonely card.
    if (result.flows.length < 5) {
      const backfill = recommendFromBrief({ brief, archetypes: archetypeMap, flows }).flows;
      for (const flow of backfill) {
        if (result.flows.length >= 5) break;
        if (!result.flows.some((entry) => entry.id === flow.id)) result.flows.push({ ...flow, backfilled: true });
      }
    }
    return {
      ...result,
      archetypeName: archetypeMap[result.archetype?.key]?.name || null,
      model: provider.model,
    };
  }

  /** Job 2 — write the first draft of the page. */
  async function content(input = {}) {
    const brief = parseBriefFields(input.brief);
    const families = safeFamilies(input.families);
    if (!families.length) {
      throw new BriefBrainError('FAMILIES_REQUIRED', 'Send the ordered section families to write content for.', { status: 422 });
    }
    const result = await withFallback({
      job: 'content',
      logger,
      fallback: () => draftPageContent({ brief, families }),
      run: async () => {
        const systemPrompt = await loadPrompt('content-writer');
        const userPrompt = [
          '## Project brief', briefBlock(brief), '',
          '## Section families to write, in this exact order',
          families.map((family, index) => `${index + 1}. ${family}`).join('\n'), '',
          '## Family vocabulary', familyVocabularyPrompt(),
        ].join('\n');
        const value = await provider.generateJson({
          systemPrompt,
          userPrompt,
          jsonSchema: PageContentJsonSchema,
          maxTokens: config?.briefContentTokens,
          validate: (candidate) => {
            const parsed = parsePageContent(candidate);
            // The structure is not the model's decision. A misaligned answer is
            // repaired positionally, and any shortfall is drafted locally so
            // every requested section still receives content.
            const byFamily = new Map();
            for (const section of parsed.sections) {
              if (!byFamily.has(section.family)) byFamily.set(section.family, []);
              byFamily.get(section.family).push(section);
            }
            const localDraft = draftPageContent({ brief, families });
            const local = localDraft.sections;
            const sections = families.map((family, index) => {
              const queue = byFamily.get(family);
              const written = queue?.length ? queue.shift() : null;
              return written ? { ...written, family } : { ...local[index], aiWritten: false };
            });
            if (sections.every((section) => section.aiWritten === false)) {
              throw new BriefBrainError('SCHEMA_INVALID', `sections[].family must use exactly these values in order: ${families.join(', ')}.`, { status: 502 });
            }
            // The footer is optional in the answer and never optional in the
            // result: a model that skipped it gets the deterministic one.
            const footer = parsed.footer?.statement ? parsed.footer : { ...localDraft.footer, aiWritten: false };
            return { sections, footer };
          },
        });
        return value;
      },
    });
    return { ...result, families, model: provider.model };
  }

  /** Job 3 — turn a typed outline into an ordered DST flow. */
  async function outline(input = {}) {
    const raw = text(input.outline, 2_000);
    if (raw.length < 3) throw new BriefBrainError('OUTLINE_REQUIRED', 'Type the sections you want on the page first.', { status: 422 });
    const brief = parseBriefFields(input.brief);
    const local = planOutline(raw);

    const result = await withFallback({
      job: 'outline',
      logger,
      fallback: () => local,
      run: async () => {
        const systemPrompt = await loadPrompt('flow-outline');
        const userPrompt = [
          '## The strategist typed', raw, '',
          '## Registered DST section families (the only allowed values)', familyVocabularyPrompt(), '',
          '## Project brief for context', briefBlock(brief), '',
          `## Lines this server already split out`, local.steps.map((step, index) => `${index + 1}. ${step.requested}`).join('\n') || '(none)',
        ].join('\n');
        const value = await provider.generateJson({
          systemPrompt,
          userPrompt,
          jsonSchema: OutlinePlanJsonSchema,
          maxTokens: config?.briefOutlineTokens,
          validate: (candidate) => {
            const parsed = parseOutlinePlan(candidate);
            const steps = parsed.steps.filter((step) => SECTION_FAMILY_IDS.includes(step.family));
            if (!steps.length) throw new BriefBrainError('SCHEMA_INVALID', 'steps[].family must use the supplied family vocabulary.', { status: 502 });
            return {
              ...parsed,
              steps,
              added: parsed.added
                .filter((entry) => ['hero', 'cta', 'contact'].includes(entry.family))
                .map((entry) => ({ ...entry, position: entry.family === 'hero' ? 'start' : 'end' })),
              unresolved: local.unresolved,
            };
          },
        });
        return value;
      },
    });
    return { ...result, model: provider.model };
  }

  /**
   * Job 4 — the simple builder's whole first step: one paragraph in, three
   * complete concepts and the five best flows out.
   */
  async function concepts(input = {}) {
    const briefText = text(input.briefText, BRIEF_TEXT_LIMIT);
    if (briefText.length < 20) {
      throw new BriefBrainError('BRIEF_REQUIRED', 'Write a little more about the project first.', { status: 422 });
    }
    const archetypes = safeArchetypeCatalog(input.archetypes);
    const flows = safeFlowCatalog(input.flows);
    if (!archetypes.length) throw new BriefBrainError('CATALOG_REQUIRED', 'Send the archetype catalog with the brief.', { status: 422 });
    if (!flows.length) throw new BriefBrainError('CATALOG_REQUIRED', 'Send the page flow catalog with the brief.', { status: 422 });

    const archetypeMap = Object.fromEntries(archetypes.map((entry) => [entry.key, entry]));
    const archetypeKeys = archetypes.map((entry) => entry.key);
    const flowIds = new Set(flows.map((entry) => entry.id));
    // The paragraph has to become brief fields either way: the deterministic
    // twin needs them to score, and the export carries them to the advanced
    // builder.
    const localFields = expandBriefText(briefText);
    // Read from the paragraph itself rather than from the split fields: an
    // instruction like "use Fraunces for headings" often lands in whichever
    // field the splitter guessed, and it is an instruction either way.
    const directives = extractBriefDirectives(briefText);

    const result = await withFallback({
      job: 'concepts',
      logger,
      fallback: () => conceptsFromBrief({ brief: localFields, archetypes: archetypeMap, flows }),
      run: async () => {
        const systemPrompt = await loadPrompt('concept-designer');
        const userPrompt = [
          '## The strategist wrote', briefText, '',
          '## Archetype catalog (one key per concept, all three must differ)',
          // The palette is shown as a starting point, not a constraint: a
          // concept that keeps its archetype's colours is a fine answer for a
          // brief that named none, and a poor one for a brief that named two.
          archetypes.map((entry) => [
            `- ${entry.key} · ${entry.name} · ${entry.polarity}: ${entry.summary}`,
            entry.palette ? `  ships with bg ${entry.palette.bg}, ink ${entry.palette.ink}, accent ${entry.palette.accent}, soft ${entry.palette.soft}, dark ${entry.palette.dark}` : '',
          ].filter(Boolean).join('\n')).join('\n'), '',
          '## Quick styles (one per concept, all three must differ)',
          PRESET_IDS.map((id) => `- ${id}`).join('\n'), '',
          '## Button families (one per concept)',
          BUTTON_STYLE_IDS.map((id) => `- ${id}`).join('\n'), '',
              '## Design dials available to `dialOverrides` (0-100 each)',
          'density, measure, headline, accent, surface, corner, imagery, motion, expressiveness', '',
          ...(directives.any
            ? ['## Design instructions this server already read out of the paragraph',
              'These are not suggestions. Every concept must honour them; they are applied after your answer either way, so design *around* them rather than against them.',
              directives.summary.map((entry) => `- ${entry}`).join('\n'), '']
            : []),
          '## Page flow catalog (choose exactly five ids, best first)',
          flows.map((entry) => `- ${entry.id} · ${entry.name}: ${entry.tagline}. Best for ${entry.bestFor}. Sections: ${entry.families.join(' → ')}`).join('\n'),
        ].join('\n');
        const value = await provider.generateJson({
          systemPrompt,
          userPrompt,
          jsonSchema: buildConceptSetJsonSchema({ presets: PRESET_IDS, buttonStyles: BUTTON_STYLE_IDS, archetypes: archetypeKeys }),
          maxTokens: config?.briefConceptTokens,
          validate: (candidate) => {
            const parsed = parseConceptSet(candidate);
            const shortlist = normalizeConceptList(parsed.concepts, { archetypeKeys });
            if (!shortlist.length) {
              throw new BriefBrainError('SCHEMA_INVALID', `concepts[].archetypeKey must be one of ${archetypeKeys.join(', ')}.`, { status: 502 });
            }
            // Three concepts that share an archetype are one concept shown three
            // times, which defeats the entire point of this step.
            const distinctArchetypes = new Set(shortlist.map((concept) => concept.archetypeKey));
            if (shortlist.length > 1 && distinctArchetypes.size < shortlist.length) {
              throw new BriefBrainError('SCHEMA_INVALID', 'Every concept must use a different archetypeKey.', { status: 502 });
            }
            const uniqueFlows = [];
            for (const flow of parsed.flows) {
              if (!flowIds.has(flow.id) || uniqueFlows.some((entry) => entry.id === flow.id)) continue;
              uniqueFlows.push(flow);
            }
            if (!uniqueFlows.length) throw new BriefBrainError('SCHEMA_INVALID', `flows[].id must be one of ${[...flowIds].join(', ')}.`, { status: 502 });
            return { ...parsed, concepts: shortlist, flows: uniqueFlows.slice(0, 5) };
          },
        });
        return { ...value, signals: conceptsFromBrief({ brief: localFields, archetypes: archetypeMap, flows }).signals };
      },
    });

    // The UI promises three concepts and five flows. Top up from the deterministic ranking
    // rather than showing a client one lonely option.
    const local = conceptsFromBrief({ brief: localFields, archetypes: archetypeMap, flows });
    if (result.concepts.length < 3) {
      for (const concept of local.concepts) {
        if (result.concepts.length >= 3) break;
        if (result.concepts.some((entry) => entry.archetypeKey === concept.archetypeKey)) continue;
        result.concepts.push({ ...concept, backfilled: true });
      }
    }
    if (result.flows.length < 5) {
      for (const flow of local.flows) {
        if (result.flows.length >= 5) break;
        if (!result.flows.some((entry) => entry.id === flow.id)) result.flows.push({ ...flow, backfilled: true });
      }
    }
    return {
      ...result,
      directives,
      // Applied last and unconditionally: a stated colour is a constraint, and
      // whether the model remembered it is not the strategist's problem.
      concepts: applyDirectivesToConcepts(normalizeConceptList(result.concepts, { archetypeKeys }), directives).map((concept, index) => {
        /*
         * The colours, resolved and measured before they leave the server.
         *
         * The browser resolves the concept again with the same function and the
         * same inputs, so this is not a second source of truth — it is the same
         * answer, computed early, so the panel can show what the palette is and
         * say what had to be repaired instead of leaving the strategist to
         * notice an unreadable band on the preview.
         */
        const base = archetypeMap[concept.archetypeKey]?.palette || {};
        const stated = concept.designOverrides?.palette || {};
        // Only the roles the *paragraph* named are immovable. A colour the model
        // proposed is a proposal and may be adjusted; a colour the strategist
        // wrote down is the brief.
        const pin = Object.keys(directives.palette || {});
        /*
         * A concept that named its own ground keeps it. One that did not — the
         * model skipped the palette, or the deterministic planner answered
         * because no model was reachable — gets a ground derived from its
         * position in the set, so three options still look like three options
         * while every one of them keeps the colour the brief asked for.
         */
        const designed = Object.keys(stated).includes('bg')
          ? { ...base, ...stated }
          : { ...paletteVariant({ ...base, ...stated }, index, { pin }), ...stated };
        const repaired = repairPalette(designed, { pin });
        return {
          ...concept,
          designOverrides: { ...concept.designOverrides, palette: repaired.palette },
          archetypeName: archetypeMap[concept.archetypeKey]?.name || concept.archetypeKey,
          backfilled: Boolean(result.concepts[index]?.backfilled),
          palette: repaired.palette,
          paletteRepairs: repaired.repairs,
          // Relationships the brief's own colours made tight. Reported, never
          // silently "fixed" by moving the colour the strategist named.
          paletteKept: repaired.refused,
          paletteReport: paletteContrastReport(repaired.palette),
        };
      }),
      // A field the model left empty falls back to the local split rather than
      // handing the advanced builder a blank brief.
      fields: Object.fromEntries(['industry', 'audience', 'goal', 'offer', 'tone', 'keywords', 'clientName']
        .map((key) => [key, (result.fields?.[key] || '').trim() || (localFields[key] || '')])),
      briefText,
      model: provider.model,
    };
  }

  /** Job 5 — split the simple builder's paragraph into the advanced fields. */
  async function expand(input = {}) {
    const briefText = text(input.briefText, BRIEF_TEXT_LIMIT);
    if (briefText.length < 20) {
      throw new BriefBrainError('BRIEF_REQUIRED', 'There is not enough brief text to split into fields.', { status: 422 });
    }
    const result = await withFallback({
      job: 'expand',
      logger,
      fallback: () => expandBriefText(briefText),
      run: async () => {
        const systemPrompt = await loadPrompt('brief-expander');
        const value = await provider.generateJson({
          systemPrompt,
          userPrompt: ['## The strategist wrote', briefText].join('\n'),
          jsonSchema: BriefExpansionJsonSchema,
          maxTokens: config?.briefUnderstandTokens,
          validate: (candidate) => {
            const parsed = parseBriefExpansion(candidate);
            const filled = ['industry', 'audience', 'goal', 'offer'].filter((key) => parsed[key].length >= 8);
            if (!filled.length) throw new BriefBrainError('SCHEMA_INVALID', 'At least one of industry, audience, goal or offer must be filled from the paragraph.', { status: 502 });
            return parsed;
          },
        });
        return value;
      },
    });
    const local = expandBriefText(briefText);
    // Never hand back a field the local split could have filled.
    return {
      ...Object.fromEntries(Object.keys(local)
        .filter((key) => key !== 'source')
        .map((key) => [key, (result[key] || '').trim() || local[key] || ''])),
      source: result.source,
      degraded: result.degraded,
      briefText,
      model: provider.model,
    };
  }

  /**
   * Job 6 — dress the page.
   *
   * Two halves with one real-world call between them: the brain writes the
   * search phrases, the stock library answers with watermarked previews, and the
   * brain then places one preview in each media slot. The library call is the
   * only part with no deterministic twin — there is no local substitute for a
   * photograph of a golf course — so a stock outage is a real error, while a
   * model outage merely means the slots are filled in priority order.
   */
  async function media(input = {}) {
    if (!stock?.configured) {
      throw new BriefBrainError('STOCK_NOT_CONFIGURED', 'Stock media search is not configured on this server.', { status: 503 });
    }
    const slots = safeMediaSlots(input.slots);
    if (!slots.length) {
      throw new BriefBrainError('SLOTS_REQUIRED', 'Send the page media slots to fill. Sections with no picture slot, and team or testimonial portraits, are not stock slots.', { status: 422 });
    }
    // Either builder may call this: the advanced one has fields, the simple one
    // has a paragraph. Whatever is missing is split out of the paragraph.
    const briefText = text(input.briefText, BRIEF_TEXT_LIMIT);
    const fields = parseBriefFields(input.brief);
    const local = briefText ? expandBriefText(briefText) : {};
    const brief = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value || local[key] || '']));

    const queries = await withFallback({
      job: 'media-search',
      logger,
      fallback: () => mediaQueriesFromBrief(brief),
      run: async () => {
        const systemPrompt = await loadPrompt('media-search');
        const userPrompt = ['## Project brief', briefBlock(brief)].join('\n');
        return provider.generateJson({
          systemPrompt,
          userPrompt,
          jsonSchema: MediaQueriesJsonSchema,
          maxTokens: config?.briefMediaTokens,
          validate: (candidate) => parseMediaQueries(candidate),
        });
      },
    });

    const videoSlots = slots.filter((slot) => slot.allowsVideo).length;
    const [images, videos] = await Promise.all([
      broadeningSearch((query, count) => stock.searchImages({ query, count }), queries.images, config?.mediaImageCount ?? 10),
      // No slot can hold a clip on this page, so do not spend a request finding one.
      videoSlots
        ? broadeningSearch((query, count) => stock.searchVideos({ query, count }), queries.videos, config?.mediaVideoCount ?? 2)
        : Promise.resolve({ results: [], query: '' }),
    ]);
    const assets = [...images.results, ...videos.results];
    if (!assets.length) {
      /*
       * Whose fault it is matters here.
       *
       * When the search terms came from the built-in planner because the model
       * degraded, "name the subject more plainly" sends the strategist to rewrite
       * a brief that was fine. The terms are the problem, and the terms are the
       * model's — so say that instead.
       */
      const searched = String(queries.images || '').trim();
      const message = queries.degraded
        ? `No imagery was found${searched ? ` for "${searched}"` : ''}, because the AI model could not write the search terms — the built-in planner's terms were used instead. ${degradedMessage(queries.degraded.code)}`
        : `The stock library has nothing for "${searched}". Name the subject more plainly — what would actually be in the photograph.`;
      throw new BriefBrainError('STOCK_EMPTY', message, { status: 422, details: { query: searched || undefined, degraded: queries.degraded?.code } });
    }

    const assetLine = (asset) => [
      `- ${asset.id} · ${asset.kind}`,
      asset.duration ? `${Math.round(asset.duration)}s` : '',
      `: ${asset.alt}`,
      asset.keywords.length ? ` (${asset.keywords.slice(0, 6).join(', ')})` : '',
    ].join('');
    const slotLine = (slot) => `- ${slot.key} · ${slot.family} ${slot.role} · video: ${slot.allowsVideo ? 'yes' : 'no'}${slot.label ? ` · "${slot.label}"` : ''}`;

    const plan = await withFallback({
      job: 'media-assign',
      logger,
      fallback: () => assignMedia({ slots, assets }),
      run: async () => {
        const systemPrompt = await loadPrompt('media-director');
        const userPrompt = [
          '## Project brief', briefBlock(brief), '',
          `## Assets the search returned (${assets.length}; use each at most once)`,
          assets.map(assetLine).join('\n'), '',
          `## Media slots on the page (${slots.length}, in page order)`,
          slots.map(slotLine).join('\n'),
        ].join('\n');
        const value = await provider.generateJson({
          systemPrompt,
          userPrompt,
          jsonSchema: MediaAssignmentJsonSchema,
          maxTokens: config?.briefMediaTokens,
          validate: (candidate) => {
            const parsed = parseMediaAssignment(candidate);
            const known = new Set(assets.map((asset) => asset.id));
            const slotKeys = new Set(slots.map((slot) => slot.key));
            const usable = parsed.assignments.filter((entry) => known.has(entry.asset) && slotKeys.has(entry.slot));
            if (!usable.length) {
              throw new BriefBrainError('SCHEMA_INVALID', `assignments[].slot must be one of ${[...slotKeys].slice(0, 8).join(', ')} and assignments[].asset one of ${[...known].slice(0, 8).join(', ')}.`, { status: 502 });
            }
            return { assignments: usable };
          },
        });
        // The model ranks; this server still owns the no-repeat guarantee and
        // fills whatever it left behind.
        return assignMedia({ slots, assets, preferred: value.assignments });
      },
    });

    return {
      ...plan,
      // `withFallback` marks a model answer; anything else came from this
      // server's own ordering, and the editor says which on screen.
      source: plan.source || 'deterministic',
      degraded: plan.degraded || queries.degraded || null,
      // Both the phrase the brain wrote and the one that answered, because a
      // broadened search is the difference between "no results" and "close enough".
      queries: {
        images: images.query || queries.images,
        videos: videos.query || queries.videos,
        avoid: queries.avoid || '',
        requested: { images: queries.images, videos: queries.videos },
        broadened: Boolean(images.broadened || videos.broadened),
      },
      assets,
      slots,
      provider: 'shutterstock',
      model: provider.model,
      // A comp is a watermarked preview, never a licensed download. The editor
      // shows this wording next to the picker so nobody ships one by accident.
      licence: 'preview',
      notice: 'Watermarked Shutterstock previews for client review. License the assets you keep before publishing.',
    };
  }

  /**
   * Job 6b — one named asset.
   *
   * The search job answers "what should this page look like"; this one answers
   * "I already found the shot, here is its number". No model is involved and no
   * slot is filled: it returns the same watermarked preview shape the search
   * returns, and the editor decides where it goes.
   */
  async function mediaAsset(input = {}) {
    if (!stock?.configured) {
      throw new BriefBrainError('STOCK_NOT_CONFIGURED', 'Stock media search is not configured on this server.', { status: 503 });
    }
    const asset = await stock.assetById({ id: input.assetId ?? input.id });
    return {
      asset,
      provider: 'shutterstock',
      licence: 'preview',
      notice: 'Watermarked Shutterstock preview for client review. License it before publishing.',
    };
  }

  return Object.freeze({ understand, content, outline, concepts, expand, media, mediaAsset });
}
