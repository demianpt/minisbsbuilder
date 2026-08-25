import { applyDirectivesToConcepts, extractBriefDirectives } from './directives.mjs';
import { SECTION_FAMILY_IDS, matchSectionFamily, sectionFamilyLabel, splitOutlineSteps } from './families.mjs';
import { parseBriefFields } from './schemas.mjs';

/**
 * Deterministic Brief Brain.
 *
 * Every AI job in this feature has a deterministic twin here. Two reasons:
 *
 * 1. The editor must stay usable when Ollama is unreachable, rate limited, or
 *    simply not configured on a strategist's machine.
 * 2. A recommendation the tool cannot explain is not a recommendation. These
 *    scores are inspectable, so the reason shown next to a flow is the real
 *    reason it was chosen — not a plausible sentence written after the fact.
 *
 * The AI answer is always preferred when it validates; this is the floor.
 */

function words(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function briefCorpus(brief) {
  return words([brief.industry, brief.audience, brief.goal, brief.offer, brief.tone, brief.keywords, brief.notes].join(' '));
}

function hits(corpus, terms) {
  return terms.reduce((count, term) => {
    const needle = words(term);
    if (!needle) return count;
    return new RegExp(`(^| )${needle}( |$)`).test(corpus) ? count + 1 : count;
  }, 0);
}

/**
 * Commercial intent signals. Each one nominates the section families that must
 * appear on the page and the archetypes whose visual contract fits the job.
 */
const INTENT_SIGNALS = Object.freeze([
  {
    id: 'booking',
    label: 'Booking or enquiry led',
    terms: ['book', 'booking', 'appointment', 'schedule', 'consultation', 'enquiry', 'inquiry', 'call', 'quote', 'estimate', 'lead', 'leads', 'contact', 'visit', 'reservation', 'intake'],
    families: ['contact', 'faq', 'testimonial'],
    archetypes: ['B', 'G'],
  },
  {
    id: 'pricing',
    label: 'Price transparency matters',
    terms: ['pricing', 'price', 'prices', 'plans', 'packages', 'tiers', 'subscription', 'cost', 'affordable', 'budget', 'monthly', 'rates'],
    families: ['pricing', 'faq'],
    archetypes: ['B', 'C'],
  },
  {
    id: 'trust',
    label: 'Credibility must be proven',
    terms: ['trust', 'trusted', 'credibility', 'reputation', 'accredited', 'certified', 'regulated', 'compliance', 'safety', 'award', 'awards', 'proven', 'reliable', 'expert', 'expertise', 'legal', 'financial', 'medical', 'insurance', 'security'],
    families: ['logo', 'testimonial', 'stats'],
    archetypes: ['A', 'G'],
  },
  {
    id: 'visual',
    label: 'The work has to be seen',
    terms: ['portfolio', 'gallery', 'visual', 'photography', 'photos', 'design', 'interiors', 'architecture', 'craft', 'renovation', 'before', 'after', 'transformation', 'showcase', 'studio', 'creative', 'brand', 'fashion', 'hospitality', 'restaurant', 'venue', 'travel'],
    families: ['gallery', 'split', 'testimonial'],
    archetypes: ['E', 'F', 'I'],
  },
  {
    id: 'process',
    label: 'The method needs explaining',
    terms: ['process', 'method', 'methodology', 'steps', 'how', 'works', 'approach', 'framework', 'phases', 'stages', 'onboarding', 'consultancy', 'consulting', 'implementation', 'migration', 'programme', 'program'],
    families: ['timeline', 'split', 'faq'],
    archetypes: ['A', 'D'],
  },
  {
    id: 'product',
    label: 'A product or platform to explain',
    terms: ['software', 'saas', 'platform', 'app', 'product', 'tool', 'dashboard', 'api', 'integration', 'automation', 'ai', 'data', 'analytics', 'technology', 'launch', 'release', 'feature', 'features'],
    families: ['split', 'cards', 'tabs', 'stats'],
    archetypes: ['C', 'H', 'J'],
  },
  {
    id: 'people',
    label: 'The people are the differentiator',
    terms: ['team', 'people', 'practitioners', 'doctors', 'dentists', 'therapists', 'lawyers', 'advisors', 'coaches', 'trainers', 'staff', 'founders', 'speakers', 'clinic', 'practice', 'firm'],
    families: ['team', 'testimonial', 'contact'],
    archetypes: ['A', 'G'],
  },
  {
    id: 'education',
    label: 'Content and education carry the page',
    terms: ['education', 'educate', 'learn', 'course', 'courses', 'training', 'school', 'university', 'academy', 'guide', 'guides', 'resources', 'blog', 'articles', 'insight', 'insights', 'research', 'knowledge', 'documentation', 'nonprofit', 'charity', 'mission'],
    families: ['blog', 'text', 'timeline'],
    archetypes: ['A', 'D'],
  },
  {
    id: 'scale',
    label: 'Scale and outcomes are the proof',
    terms: ['growth', 'revenue', 'roi', 'results', 'outcomes', 'performance', 'enterprise', 'global', 'scale', 'clients', 'customers', 'users', 'markets', 'impact', 'metrics'],
    families: ['stats', 'logo', 'testimonial'],
    archetypes: ['B', 'H'],
  },
]);

/** Voice words that legitimately move the visual archetype. */
const TONE_SIGNALS = Object.freeze([
  { archetypes: ['A'], terms: ['editorial', 'considered', 'refined', 'authoritative', 'timeless', 'classic', 'understated', 'elegant', 'premium', 'literary'] },
  { archetypes: ['B'], terms: ['direct', 'clear', 'persuasive', 'commercial', 'urgent', 'confident', 'decisive', 'punchy', 'action'] },
  { archetypes: ['C'], terms: ['precise', 'technical', 'rational', 'structured', 'systematic', 'engineering', 'analytical'] },
  { archetypes: ['D'], terms: ['calm', 'quiet', 'plain', 'honest', 'human', 'warm', 'approachable', 'friendly', 'reassuring'] },
  { archetypes: ['E'], terms: ['bold', 'expressive', 'striking', 'dramatic', 'cinematic', 'ambitious', 'energetic'] },
  { archetypes: ['F'], terms: ['playful', 'lively', 'optimistic', 'fresh', 'youthful', 'colourful', 'colorful'] },
  { archetypes: ['G'], terms: ['institutional', 'trusted', 'established', 'serious', 'professional', 'formal', 'reliable'] },
  { archetypes: ['H'], terms: ['modern', 'progressive', 'innovative', 'sharp', 'future', 'digital', 'minimal'] },
]);

export function briefSignals(briefInput) {
  const brief = parseBriefFields(briefInput);
  const corpus = briefCorpus(brief);
  return INTENT_SIGNALS
    .map((signal) => ({ id: signal.id, label: signal.label, families: signal.families, archetypes: signal.archetypes, score: hits(corpus, signal.terms) }))
    .filter((signal) => signal.score > 0)
    .sort((a, b) => b.score - a.score);
}

function recommendArchetype(brief, archetypes, signals) {
  const available = Object.keys(archetypes || {});
  if (!available.length) return null;
  const corpus = words([brief.tone, brief.industry, brief.keywords].join(' '));
  const scores = new Map(available.map((key) => [key, 0]));
  const bump = (key, amount) => { if (scores.has(key)) scores.set(key, scores.get(key) + amount); };

  for (const signal of signals) signal.archetypes.forEach((key) => bump(key, signal.score * 2));
  for (const tone of TONE_SIGNALS) {
    const matched = hits(corpus, tone.terms);
    if (matched) tone.archetypes.forEach((key) => bump(key, matched * 3));
  }
  // A tie should not depend on object key order changing between catalogs.
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const [key, score] = ranked[0];
  const reasons = [];
  const toneMatch = TONE_SIGNALS.find((tone) => tone.archetypes.includes(key) && hits(corpus, tone.terms));
  if (toneMatch) reasons.push(`the voice reads ${toneMatch.terms.find((term) => hits(corpus, [term])) || 'consistent'}`);
  const signalMatch = signals.find((signal) => signal.archetypes.includes(key));
  if (signalMatch) reasons.push(signalMatch.label.toLowerCase());
  return {
    key,
    reason: score > 0
      ? `${archetypes[key]?.name || key} fits because ${reasons.join(' and ')}.`
      : `${archetypes[key]?.name || key} is the safe neutral starting point until the brief says more about voice.`,
    score,
  };
}

function flowCorpus(flow) {
  return words([flow.name, flow.tagline, flow.bestFor, flow.rhythm].join(' '));
}

function recommendFlows(brief, flows, signals, limit = 5) {
  const list = Array.isArray(flows) ? flows.filter((flow) => flow && flow.id && Array.isArray(flow.families)) : [];
  if (!list.length) return [];
  const corpus = briefCorpus(brief);
  const wanted = new Set(signals.flatMap((signal) => signal.families));
  const weights = new Map();
  for (const signal of signals) for (const family of signal.families) weights.set(family, (weights.get(family) || 0) + signal.score);

  const scored = list.map((flow) => {
    const families = new Set(flow.families);
    let score = 0;
    const covered = [];
    for (const family of wanted) {
      if (!families.has(family)) continue;
      score += 3 + (weights.get(family) || 0);
      covered.push(family);
    }
    // A flow whose own description echoes the brief is a real signal too.
    const descriptive = hits(flowCorpus(flow), corpus.split(' ').filter((token) => token.length > 4).slice(0, 40));
    score += Math.min(6, descriptive);
    // Very short flows are cheap to score highly; reward completeness lightly.
    score += Math.min(3, Math.max(0, flow.families.length - 4));
    return { flow, score, covered, descriptive };
  }).sort((a, b) => b.score - a.score || a.flow.id.localeCompare(b.flow.id));

  // Do not hand the strategist five near-identical journeys. Keep the strongest
  // match first, then greedily favour candidates that introduce section
  // families the already-selected flows do not. This keeps relevance as the
  // primary signal while making the five recommendations genuinely useful
  // alternatives rather than cosmetic variants of one sequence.
  const selected = [];
  const remaining = [...scored];
  while (selected.length < Math.min(limit, remaining.length + selected.length) && remaining.length) {
    let bestIndex = 0;
    let bestAdjusted = -Infinity;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const candidateFamilies = new Set(candidate.flow.families);
      let maxSimilarity = 0;
      let newFamilies = candidateFamilies.size;
      if (selected.length) {
        const already = new Set(selected.flatMap((entry) => entry.flow.families));
        newFamilies = [...candidateFamilies].filter((family) => !already.has(family)).length;
        for (const prior of selected) {
          const priorFamilies = new Set(prior.flow.families);
          const intersection = [...candidateFamilies].filter((family) => priorFamilies.has(family)).length;
          const union = new Set([...candidateFamilies, ...priorFamilies]).size || 1;
          maxSimilarity = Math.max(maxSimilarity, intersection / union);
        }
      }
      const diversityBonus = selected.length ? (1 - maxSimilarity) * 3 + Math.min(3, newFamilies * 0.75) : 0;
      const adjusted = candidate.score + diversityBonus;
      if (adjusted > bestAdjusted || (adjusted === bestAdjusted && candidate.flow.id.localeCompare(remaining[bestIndex].flow.id) < 0)) {
        bestAdjusted = adjusted;
        bestIndex = index;
      }
    }
    selected.push(remaining.splice(bestIndex, 1)[0]);
  }

  const top = selected.slice(0, limit);
  const maxScore = top[0]?.score || 1;
  return top.map(({ flow, score, covered }) => ({
    id: flow.id,
    fit: Math.max(0.35, Math.min(1, score / (maxScore || 1))),
    reason: covered.length
      ? `Covers what this brief needs: ${covered.map(sectionFamilyLabel).join(', ')}.`
      : `${flow.name} is a balanced default sequence for this kind of page.`,
  }));
}

function firstSentence(value, fallback) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  const match = text.match(/^(.{0,220}?[.!?])(\s|$)/);
  return (match ? match[1] : text.slice(0, 220)).trim();
}

/**
 * Deterministic equivalent of the "understand this brief" job. The readback is
 * quotation, not invention: it repeats what the strategist typed so a wrong
 * reading is obvious at a glance.
 */
export function recommendFromBrief({ brief: briefInput, archetypes = {}, flows = [] } = {}) {
  const brief = parseBriefFields(briefInput);
  const signals = briefSignals(brief);
  const archetype = recommendArchetype(brief, archetypes, signals);
  const missingFields = ['industry', 'audience', 'goal', 'offer', 'tone'].filter((key) => brief[key].length < 12);
  const filled = ['industry', 'audience', 'goal', 'offer', 'tone'].filter((key) => brief[key].length >= 12);
  const brand = brief.clientName || brief.projectName || 'This brand';
  return {
    source: 'deterministic',
    readback: {
      business: firstSentence(brief.industry, `${brand} has not described its industry yet.`),
      audience: firstSentence(brief.audience, 'No primary audience is described yet.'),
      offer: firstSentence(brief.offer, 'No core offer is described yet.'),
      goal: firstSentence(brief.goal, 'No primary page goal is described yet.'),
      voice: firstSentence(brief.tone, 'No voice is described yet.'),
    },
    confidence: Math.max(0.2, Math.min(0.85, filled.length / 5)),
    missingFields,
    keywords: String(brief.keywords || '')
      .split(/[,\n]/)
      .map((keyword) => keyword.trim())
      .filter(Boolean)
      .slice(0, 10),
    signals: signals.map((signal) => ({ id: signal.id, label: signal.label, score: signal.score })),
    archetype: archetype ? { key: archetype.key, reason: archetype.reason } : null,
    flows: recommendFlows(brief, flows, signals),
  };
}

/* ------------------------------------------------------------------ *
 * Outline → page flow
 * ------------------------------------------------------------------ */

const OUTLINE_PREAMBLE = /^(?:the |this )?page (?:will |should |must |needs to )?(?:have|include|contain|be)\b|^i (?:want|need|would like)\b|^we (?:want|need|should)\b|^please\b|^build\b|^create\b|^make\b/i;

/**
 * Turns a typed outline into an ordered list of DST section families.
 * Unrecognised lines are returned as `family: null` so the editor can ask
 * instead of silently guessing.
 */
export function planOutline(text) {
  const rawSteps = splitOutlineSteps(text);
  const steps = [];
  rawSteps.forEach((requested, index) => {
    const match = matchSectionFamily(requested);
    // A leading "The page will have" is instruction, not a section.
    if (!match && index === 0 && OUTLINE_PREAMBLE.test(requested)) return;
    steps.push({
      requested,
      family: match?.family || null,
      reason: match ? `"${match.matched}" maps to the ${sectionFamilyLabel(match.family)} family.` : 'No DST family matched this line yet.',
    });
  });
  const resolved = steps.filter((step) => step.family);
  const added = [];
  if (resolved.length) {
    if (resolved[0].family !== 'hero') added.push({ family: 'hero', reason: 'Every page opens with a hero so the promise is visible before scrolling.', position: 'start' });
    const last = resolved[resolved.length - 1].family;
    if (!['cta', 'contact'].includes(last)) added.push({ family: 'cta', reason: 'A closing call to action gives the page somewhere to land.', position: 'end' });
  }
  return {
    source: 'deterministic',
    name: 'Custom outline',
    rationale: resolved.length
      ? `Built from ${resolved.length} recognised step${resolved.length === 1 ? '' : 's'} in the order you typed them.`
      : 'Nothing in the outline matched a DST section family yet.',
    steps,
    added,
    unresolved: steps.filter((step) => !step.family).map((step) => step.requested),
  };
}

/** Merges a plan's recognised steps and its safety additions into families. */
export function outlineFamilies(plan) {
  const resolved = (plan?.steps || []).map((step) => step.family).filter((family) => SECTION_FAMILY_IDS.includes(family));
  if (!resolved.length) return [];
  const start = (plan?.added || []).filter((item) => item.position === 'start' || item.family === 'hero').map((item) => item.family);
  const end = (plan?.added || []).filter((item) => item.position === 'end' || (item.family === 'cta' && !start.includes('cta'))).map((item) => item.family);
  const families = [...start, ...resolved, ...end].filter((family) => SECTION_FAMILY_IDS.includes(family));
  // Never emit the same family twice in a row: two adjacent card grids read as
  // one broken grid, not as two ideas.
  return families.filter((family, index) => family !== families[index - 1]).slice(0, 16);
}

/* ------------------------------------------------------------------ *
 * Deterministic page copy
 * ------------------------------------------------------------------ */

function sentenceCase(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function shorten(value, max) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).replace(/[\s,;:.]+\S*$/, '')}…`;
}

function keywordList(brief, count) {
  return String(brief.keywords || '')
    .split(/[,\n]/)
    .map((keyword) => sentenceCase(keyword.trim()))
    .filter(Boolean)
    .slice(0, count);
}

/**
 * Deterministic first-draft copy. It never states a fact the brief did not
 * supply — every sentence is assembled from the strategist's own words, so an
 * unedited draft is honest placeholder copy rather than invented marketing.
 */
export function draftPageContent({ brief: briefInput, families = [] } = {}) {
  const brief = parseBriefFields(briefInput);
  const brand = brief.clientName || brief.projectName || 'Your brand';
  const offer = shorten(brief.offer, 180);
  const audience = shorten(brief.audience, 140);
  const goal = shorten(brief.goal, 160);
  const themes = keywordList(brief, 6);
  const action = /book|appointment|schedule|call|consult/i.test(brief.goal) ? 'Book a time'
    : /quote|estimate|price/i.test(brief.goal) ? 'Get a quote'
      : /demo|trial|sign ?up|register/i.test(brief.goal) ? 'Request a demo'
        : /download|guide|resource/i.test(brief.goal) ? 'Get the guide'
          : 'Start a conversation';

  const item = (title, description, value) => ({ title: sentenceCase(title), description: shorten(description, 220), value: value || '' });
  const GENERIC_THEMES = ['Approach', 'Delivery', 'Support', 'Outcome', 'Partnership', 'Detail'];
  // A section that renders four steps must receive four items. The brief's own
  // themes come first; the generic list only tops up a short list.
  const themedItems = (count, describe) => {
    const pool = [...themes];
    for (const generic of GENERIC_THEMES) {
      if (pool.length >= count) break;
      if (!pool.some((theme) => theme.toLowerCase() === generic.toLowerCase())) pool.push(generic);
    }
    return pool.slice(0, count).map((theme, index) => item(theme, describe(theme, index)));
  };

  const byFamily = {
    hero: () => ({
      pretitle: shorten(brief.industry, 60) || brand,
      title: sentenceCase(offer || `${brand} — a clearer way forward`),
      subtitle: audience ? `For ${audience.replace(/^for\s+/i, '')}.` : '',
      body: '',
      buttons: [{ text: action, type: 'primary' }, { text: 'See how it works', type: 'secondary' }],
    }),
    text: () => ({
      pretitle: 'Positioning',
      title: sentenceCase(goal || 'What this page is for'),
      body: [offer, audience ? `Written for ${audience.replace(/^for\s+/i, '')}.` : '', shorten(brief.notes, 200)].filter(Boolean).join(' '),
    }),
    split: () => ({
      pretitle: 'In detail',
      title: sentenceCase(themes[0] ? `${themes[0]} in practice` : 'How the work is done'),
      body: offer || 'Describe the single idea this band has to land.',
      buttons: [{ text: 'Read more', type: 'link' }],
    }),
    cards: () => ({
      pretitle: 'What you get',
      title: sentenceCase(themes.length ? 'Where we help' : 'Capabilities'),
      subtitle: audience ? `Chosen for ${audience.replace(/^for\s+/i, '')}.` : '',
      items: themedItems(3, (theme) => `How ${brand} handles ${theme.toLowerCase()}.`),
    }),
    stats: () => ({
      pretitle: 'Evidence',
      title: 'The numbers behind the claim',
      items: [item('Replace with a real figure', 'Add the measured outcome from the brief.', '00'), item('Replace with a real figure', 'Add a second verifiable number.', '00'), item('Replace with a real figure', 'Add a third verifiable number.', '00')],
    }),
    logo: () => ({ pretitle: 'Trusted by', title: 'Recognised in the sector' }),
    // Four, not one: the testimonial family renders as a slider, and a single
    // card leaves the strategist looking at a track that cannot move.
    testimonial: () => ({
      pretitle: 'In their words',
      title: 'What clients say',
      items: [
        item('Add a real client quote', `A named quote about ${themes[0] ? themes[0].toLowerCase() : 'the result'} carries more weight than a claim.`),
        item('Add a second client quote', 'Ask this one to speak to the working relationship rather than the result.'),
        item('Add a third client quote', 'A quote that answers the objection buyers raise most often.'),
        item('Add a fourth client quote', 'Close the set with the outcome the brief is actually selling.'),
      ],
    }),
    pricing: () => ({
      pretitle: 'Investment',
      title: 'Ways to work together',
      items: [item('Starting point', 'What the entry engagement includes.'), item('Core', 'The option most clients choose.'), item('Extended', 'For a larger or longer scope.')],
      buttons: [{ text: action, type: 'primary' }],
    }),
    faq: () => ({
      pretitle: 'Before you ask',
      title: 'Questions we answer every week',
      items: [item(`What does ${brand} actually do?`, offer || 'Answer with the core offer from the brief.'), item('Who is this for?', audience || 'Answer with the primary audience.'), item('How do we start?', goal || 'Answer with the next practical step.')],
    }),
    timeline: () => ({
      pretitle: 'How it works',
      title: 'The path from first call to result',
      items: themedItems(4, (theme, index) => `Stage ${index + 1}: ${theme.toLowerCase()}.`).map((entry, index) => ({ ...entry, value: `0${index + 1}` })),
    }),
    gallery: () => ({ pretitle: 'Selected work', title: 'See the work, not the promise' }),
    team: () => ({
      pretitle: 'The people',
      title: 'Who you will actually work with',
      items: [item('Add a real name', 'Role and one line of relevant credibility.'), item('Add a real name', 'Role and one line of relevant credibility.'), item('Add a real name', 'Role and one line of relevant credibility.')],
    }),
    tabs: () => ({
      pretitle: 'Choose your view',
      title: sentenceCase(themes.length ? 'By focus area' : 'By use case'),
      items: themedItems(3, (theme) => `What ${theme.toLowerCase()} looks like in practice.`),
    }),
    accordion: () => ({ pretitle: 'Detail on demand', title: 'The specifics, when you want them', items: themedItems(4, (theme) => `Detail about ${theme.toLowerCase()}.`) }),
    haccordion: () => ({ pretitle: 'Explore', title: 'Four ways in', items: themedItems(4, (theme) => `Open ${theme.toLowerCase()}.`) }),
    slider: () => ({ pretitle: 'More', title: 'Browse the full set', items: themedItems(5, (theme) => `${theme} in one card.`) }),
    blog: () => ({ pretitle: 'Insight', title: 'Recent thinking', items: themedItems(3, (theme) => `An article about ${theme.toLowerCase()}.`) }),
    contact: () => ({
      pretitle: 'Next step',
      title: sentenceCase(goal ? shorten(goal, 90) : 'Tell us what you need'),
      body: audience ? `Written for ${audience.replace(/^for\s+/i, '')}.` : '',
      buttons: [{ text: action, type: 'primary' }],
    }),
    cta: () => ({
      pretitle: brand,
      title: sentenceCase(goal ? shorten(goal, 90) : 'Ready when you are'),
      subtitle: offer ? shorten(offer, 160) : '',
      buttons: [{ text: action, type: 'primary' }],
    }),
  };

  const sections = (Array.isArray(families) ? families : [])
    .filter((family) => SECTION_FAMILY_IDS.includes(family))
    .map((family) => {
      const draft = (byFamily[family] || byFamily.text)();
      return {
        family,
        pretitle: draft.pretitle || '',
        title: draft.title || '',
        subtitle: draft.subtitle || '',
        body: draft.body || '',
        items: draft.items || [],
        buttons: draft.buttons || [],
      };
    });
  const footer = {
    statement: sentenceCase(goal ? shorten(goal, 90) : (offer ? shorten(offer, 90) : `Work with ${brand}`)),
    description: [offer ? shorten(offer, 150) : '', audience ? `Written for ${audience.replace(/^for\s+/i, '')}.` : '']
      .filter(Boolean).join(' ') || 'Add the one sentence a visitor should leave with.',
    ctaText: action,
  };
  return { source: 'deterministic', sections, footer };
}

/* ------------------------------------------------------------------ *
 * The simple builder: one paragraph in, three concepts out
 * ------------------------------------------------------------------ */

/**
 * Splits a single paragraph of brief into the advanced builder's fields.
 *
 * Deliberately conservative. It only moves a sentence into a field when the
 * sentence says so itself — "for nervous adults", "we want them to book" — and
 * otherwise leaves the text in `industry`, which is the field a strategist reads
 * first. Guessing wrongly here is worse than leaving one paragraph intact,
 * because these fields drive every later AI job.
 */
const FIELD_CUES = Object.freeze([
  { field: 'audience', terms: ['audience', 'customers', 'clients are', 'patients', 'visitors', 'buyers', 'aimed at', 'for local', 'for people', 'for families', 'for businesses', 'target'] },
  { field: 'goal', terms: ['goal', 'we want', 'objective', 'convert', 'get them to', 'so they', 'call to action', 'primary action', 'need them to', 'drive'] },
  { field: 'offer', terms: ['we offer', 'we provide', 'we do', 'services', 'product', 'offering', 'we sell', 'we specialise', 'we specialize', 'we build', 'we help'] },
  { field: 'tone', terms: ['tone', 'voice', 'sound', 'feel', 'friendly', 'formal', 'calm', 'bold', 'warm', 'professional', 'playful', 'editorial', 'reassuring', 'confident'] },
]);

function sentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function expandBriefText(briefText) {
  const all = sentences(briefText);
  const assigned = { industry: [], audience: [], goal: [], offer: [], tone: [] };
  const used = new Set();

  all.forEach((sentence, index) => {
    const corpus = words(sentence);
    for (const cue of FIELD_CUES) {
      if (!cue.terms.some((term) => corpus.includes(words(term)))) continue;
      assigned[cue.field].push(sentence);
      used.add(index);
      break;
    }
  });

  // Everything unclaimed describes the business. The first sentence almost
  // always does, so it leads.
  const leftovers = all.filter((_sentence, index) => !used.has(index));
  assigned.industry = leftovers.length ? leftovers : all.slice(0, 1);

  const first = all[0] || '';
  const brandMatch = first.match(/^([A-Z][\w&'’-]*(?:\s+[A-Z][\w&'’-]*){0,3})(?=\s+(?:is|are|offers|provides|helps|builds|makes|sells|specialis|specializ))/);

  return {
    source: 'deterministic',
    projectName: brandMatch ? brandMatch[1] : '',
    clientName: brandMatch ? brandMatch[1] : '',
    industry: assigned.industry.join(' ').slice(0, 600),
    audience: assigned.audience.join(' ').slice(0, 1_200),
    goal: assigned.goal.join(' ').slice(0, 1_200),
    offer: (assigned.offer.length ? assigned.offer : assigned.industry).join(' ').slice(0, 1_200),
    tone: assigned.tone.join(' ').slice(0, 1_200),
    keywords: '',
    notes: '',
  };
}

/**
 * Three deliberately different concepts, scored from the brief.
 *
 * The archetypes come from the same signal ranking the advanced builder uses,
 * then each is paired with a quick style and a button family chosen to suit it.
 * The pairings are a table rather than a formula because "which mood belongs
 * with this archetype" is a design judgement, not arithmetic.
 */
const CONCEPT_RECIPES = Object.freeze({
  A: { preset: 'editorial', buttonStyle: 'offset-block', angle: 'Editorial and considered' },
  B: { preset: 'bold', buttonStyle: 'sweep-fill', angle: 'Direct and commercial' },
  C: { preset: 'friendly', buttonStyle: 'depth-press', angle: 'Warm and human' },
  D: { preset: 'calm', buttonStyle: 'solid-shift', angle: 'Calm and plain' },
  E: { preset: 'bold', buttonStyle: 'ink-wipe', angle: 'Bold and photographic' },
  F: { preset: 'friendly', buttonStyle: 'pill-glow', angle: 'Lively and optimistic' },
  G: { preset: 'calm', buttonStyle: 'split-reveal', angle: 'Established and reassuring' },
  H: { preset: 'efficient', buttonStyle: 'magnetic-arrow', angle: 'Modern and efficient' },
  I: { preset: 'editorial', buttonStyle: 'corner-cut', angle: 'Crafted and tactile' },
  J: { preset: 'efficient', buttonStyle: 'neon-trace', angle: 'Precise and technical' },
  K: { preset: 'bold', buttonStyle: 'corner-cut', angle: 'Confident and graphic' },
  L: { preset: 'calm', buttonStyle: 'split-reveal', angle: 'Quiet and spacious' },
  M: { preset: 'editorial', buttonStyle: 'offset-block', angle: 'Refined and premium' },
});

const PRESET_ROTATION = Object.freeze(['calm', 'editorial', 'bold', 'friendly', 'efficient']);
// All ten families, so a set of three concepts is never forced back onto the
// same button twice merely because the first five were spoken for.
const BUTTON_ROTATION = Object.freeze([
  'solid-shift', 'offset-block', 'pill-glow', 'sweep-fill', 'magnetic-arrow',
  'split-reveal', 'corner-cut', 'neon-trace', 'depth-press', 'ink-wipe',
]);

/** Ranks every archetype for the brief, best first. */
function rankArchetypes(brief, archetypes, signals) {
  const available = Object.keys(archetypes || {});
  if (!available.length) return [];
  const corpus = words([brief.tone, brief.industry, brief.keywords, brief.offer].join(' '));
  const scores = new Map(available.map((key) => [key, 0]));
  const bump = (key, amount) => { if (scores.has(key)) scores.set(key, scores.get(key) + amount); };
  for (const signal of signals) signal.archetypes.forEach((key) => bump(key, signal.score * 2));
  for (const tone of TONE_SIGNALS) {
    const matched = hits(corpus, tone.terms);
    if (matched) tone.archetypes.forEach((key) => bump(key, matched * 3));
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, score]) => ({ key, score }));
}

export function conceptsFromBrief({ brief: briefInput, archetypes = {}, flows = [] } = {}) {
  const brief = parseBriefFields(briefInput);
  const signals = briefSignals(brief);
  const ranked = rankArchetypes(brief, archetypes, signals);
  const concepts = [];
  const usedPresets = new Set();
  const usedButtons = new Set();

  for (const { key } of ranked) {
    if (concepts.length >= 3) break;
    const recipe = CONCEPT_RECIPES[key] || { preset: 'calm', buttonStyle: 'solid-shift', angle: 'Balanced' };
    // Three concepts that share a mood are not three concepts. Rotate off any
    // quick style or button family already spoken for.
    let preset = recipe.preset;
    if (usedPresets.has(preset)) preset = PRESET_ROTATION.find((candidate) => !usedPresets.has(candidate)) || preset;
    let buttonStyle = recipe.buttonStyle;
    if (usedButtons.has(buttonStyle)) buttonStyle = BUTTON_ROTATION.find((candidate) => !usedButtons.has(candidate)) || buttonStyle;
    usedPresets.add(preset);
    usedButtons.add(buttonStyle);

    const lead = signals[0];
    concepts.push({
      name: `${recipe.angle}`,
      archetypeKey: key,
      preset,
      buttonStyle,
      dialOverrides: {},
      why: lead
        ? `${archetypes[key]?.name || key} with the ${preset} quick style, because the brief reads as ${lead.label.toLowerCase()}.`
        : `${archetypes[key]?.name || key} with the ${preset} quick style as a neutral starting point.`,
    });
  }

  const understanding = recommendFromBrief({ brief, archetypes, flows });
  // A colour, a typeface or a typographic scale the brief stated outright is a
  // constraint on all three options, not a fourth axis to vary them on.
  const directives = briefDirectives(brief);
  return {
    source: 'deterministic',
    directives,
    readback: understanding.readback,
    fields: {
      industry: brief.industry,
      audience: brief.audience,
      goal: brief.goal,
      offer: brief.offer,
      tone: brief.tone,
      keywords: brief.keywords,
      clientName: brief.clientName,
    },
    confidence: understanding.confidence,
    missingFields: understanding.missingFields,
    signals: understanding.signals,
    concepts: applyDirectivesToConcepts(concepts, directives),
    flows: understanding.flows,
  };
}

/**
 * The design instructions in a brief, wherever they were written.
 *
 * A strategist puts "our brand colour is navy" in whichever field is open at the
 * time, so every field is read — including `notes`, which is where the simple
 * builder keeps the original paragraph verbatim.
 */
export function briefDirectives(briefInput) {
  const brief = parseBriefFields(briefInput);
  return extractBriefDirectives([
    brief.industry, brief.audience, brief.goal, brief.offer, brief.tone, brief.keywords, brief.notes,
  ].filter(Boolean).join('. '));
}
