/**
 * Canonical DST section-family vocabulary for the Brief Brain.
 *
 * The AI brain is never allowed to invent a section type. Every recommendation
 * it makes — a page flow, an outline step, a content block — must resolve to
 * one of these families, because each family maps to registered DST patterns
 * that already exist in the attached skill catalog.
 */

export const SECTION_FAMILIES = Object.freeze([
  Object.freeze({
    id: 'hero',
    label: 'Hero',
    purpose: 'The opening promise: headline, supporting line and the first call to action.',
    // Words a strategist (or a client brief) is likely to use for this family.
    synonyms: Object.freeze(['hero', 'banner', 'opener', 'above the fold', 'masthead', 'header section', 'intro banner', 'headline', 'first screen', 'landing']),
  }),
  Object.freeze({
    id: 'text',
    label: 'Statement / text',
    purpose: 'A single argument in prose: positioning, manifesto, editorial statement.',
    synonyms: Object.freeze(['statement', 'text', 'intro', 'about', 'manifesto', 'positioning', 'copy', 'paragraph', 'story', 'who we are', 'overview', 'summary']),
  }),
  Object.freeze({
    id: 'split',
    label: 'Media + text',
    purpose: 'One idea explained beside an image; also the natural before/after comparison band.',
    synonyms: Object.freeze(['split', 'media and text', 'image and text', 'before after', 'before and after', 'side by side', 'comparison image', 'feature detail', 'two column', 'photo with copy', 'transformation']),
  }),
  Object.freeze({
    id: 'cards',
    label: 'Cards',
    purpose: 'Three to six parallel items: services, capabilities, benefits, features.',
    synonyms: Object.freeze(['cards', 'services', 'features', 'benefits', 'capabilities', 'offering', 'what we do', 'grid', 'tiles', 'solutions', 'products', 'programs']),
  }),
  Object.freeze({
    id: 'stats',
    label: 'Statistics',
    purpose: 'Numeric proof: results, scale, outcomes.',
    synonyms: Object.freeze(['stats', 'statistics', 'numbers', 'metrics', 'results', 'kpi', 'figures', 'by the numbers', 'impact', 'data']),
  }),
  Object.freeze({
    id: 'logo',
    label: 'Logo marquee',
    purpose: 'Borrowed credibility: client, partner or press logos.',
    synonyms: Object.freeze(['logos', 'logo strip', 'logo marquee', 'clients', 'partners', 'brands', 'as seen in', 'press', 'trusted by', 'accreditations']),
  }),
  Object.freeze({
    id: 'testimonial',
    label: 'Testimonials',
    purpose: 'Quoted human proof from named customers.',
    synonyms: Object.freeze(['testimonial', 'testimonials', 'reviews', 'quotes', 'social proof', 'what clients say', 'customer stories', 'feedback', 'ratings']),
  }),
  Object.freeze({
    id: 'pricing',
    label: 'Pricing',
    purpose: 'Packages, tiers and what each one includes.',
    synonyms: Object.freeze(['pricing', 'price', 'plans', 'packages', 'tiers', 'cost', 'rates', 'subscription', 'quote', 'fees', 'investment']),
  }),
  Object.freeze({
    id: 'faq',
    label: 'FAQ',
    purpose: 'Objection handling in question-and-answer form.',
    synonyms: Object.freeze(['faq', 'faqs', 'questions', 'q and a', 'objections', 'common questions', 'help', 'answers']),
  }),
  Object.freeze({
    id: 'timeline',
    label: 'Timeline',
    purpose: 'An ordered sequence: process, method, roadmap, history.',
    synonyms: Object.freeze(['timeline', 'process', 'steps', 'how it works', 'method', 'roadmap', 'journey', 'phases', 'stages', 'agenda', 'schedule', 'history']),
  }),
  Object.freeze({
    id: 'gallery',
    label: 'Gallery',
    purpose: 'A visual body of work shown as images.',
    synonyms: Object.freeze(['gallery', 'portfolio', 'work', 'projects', 'photos', 'images', 'case studies visual', 'showcase', 'lookbook']),
  }),
  Object.freeze({
    id: 'team',
    label: 'Team',
    purpose: 'The people: named practitioners, leadership, speakers.',
    synonyms: Object.freeze(['team', 'people', 'staff', 'leadership', 'founders', 'speakers', 'practitioners', 'doctors', 'experts', 'who we are people']),
  }),
  Object.freeze({
    id: 'tabs',
    label: 'Tabs',
    purpose: 'Several detailed views the visitor chooses between without scrolling.',
    synonyms: Object.freeze(['tabs', 'tabbed', 'segments', 'switcher', 'by audience', 'by industry', 'use cases', 'toggle']),
  }),
  Object.freeze({
    id: 'accordion',
    label: 'Accordion',
    purpose: 'Progressive disclosure of dense detail in a vertical list.',
    synonyms: Object.freeze(['accordion', 'expandable', 'collapsible', 'disclosure', 'toggle list']),
  }),
  Object.freeze({
    id: 'haccordion',
    label: 'Horizontal accordion',
    purpose: 'A wide, expressive expandable band for a small number of rich panels.',
    synonyms: Object.freeze(['horizontal accordion', 'wide accordion', 'expanding panels', 'panel reveal']),
  }),
  Object.freeze({
    id: 'slider',
    label: 'Slider',
    purpose: 'A horizontally browsable set of items.',
    synonyms: Object.freeze(['slider', 'carousel', 'swiper', 'scroller', 'slideshow']),
  }),
  Object.freeze({
    id: 'blog',
    label: 'Content feed',
    purpose: 'Latest articles, insight or resources.',
    synonyms: Object.freeze(['blog', 'news', 'articles', 'insights', 'resources', 'content feed', 'latest', 'press releases', 'guides']),
  }),
  Object.freeze({
    id: 'contact',
    label: 'Contact',
    purpose: 'The form and the practical detail needed to make contact.',
    synonyms: Object.freeze(['contact', 'form', 'enquiry', 'inquiry', 'get in touch', 'booking', 'book', 'appointment', 'request', 'registration', 'sign up', 'lead capture', 'demo request']),
  }),
  Object.freeze({
    id: 'cta',
    label: 'Call to action',
    purpose: 'The closing band that asks for the one action the page exists for.',
    synonyms: Object.freeze(['cta', 'call to action', 'closing', 'final band', 'conversion', 'next step', 'closer', 'ending']),
  }),
]);

export const SECTION_FAMILY_IDS = Object.freeze(SECTION_FAMILIES.map((family) => family.id));

const FAMILY_BY_ID = new Map(SECTION_FAMILIES.map((family) => [family.id, family]));

export function isSectionFamily(value) {
  return FAMILY_BY_ID.has(String(value || '').trim().toLowerCase());
}

export function sectionFamily(value) {
  return FAMILY_BY_ID.get(String(value || '').trim().toLowerCase()) || null;
}

export function sectionFamilyLabel(value) {
  return sectionFamily(value)?.label || String(value || '');
}

/** Compact vocabulary block for AI prompts: one line per family, no prose. */
export function familyVocabularyPrompt() {
  return SECTION_FAMILIES.map((family) => `- ${family.id} — ${family.label}: ${family.purpose}`).join('\n');
}

function normalizeOutlineText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Deterministic "what did the strategist mean" matcher.
 *
 * This is intentionally not AI: the outline field is the one place a strategist
 * types a literal list, and a typed list must resolve the same way every single
 * time. The AI brain refines ambiguous lines; this guarantees a usable result
 * even with the model offline.
 */
export function matchSectionFamily(text) {
  const normalized = normalizeOutlineText(text);
  if (!normalized) return null;
  let best = null;
  for (const family of SECTION_FAMILIES) {
    if (normalized === family.id) return { family: family.id, score: 999, matched: family.id };
    for (const synonym of family.synonyms) {
      const needle = normalizeOutlineText(synonym);
      if (!needle) continue;
      // Whole-word containment keeps "press" out of "impressive", and the
      // longest matching phrase wins so "before after" outranks "after".
      const pattern = new RegExp(`(^| )${needle}( |$)`);
      if (!pattern.test(normalized)) continue;
      const score = needle.length + (normalized === needle ? 100 : 0);
      if (!best || score > best.score) best = { family: family.id, score, matched: synonym };
    }
  }
  return best;
}

function cleanOutlineStep(line) {
  return String(line || '')
    .replace(/^\s*[-*\u2022\u2013\u2014]\s*/, '')
    .replace(/^\s*(?:and|then|next|finally|also)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Splits a strategist's free-text page outline into ordered requested steps.
 *
 * Accepts what people actually type: an inline numbered list ("1. Hero 2. A
 * pricing"), one item per line, bullets, or a comma-separated sentence.
 */
export function splitOutlineSteps(text) {
  const raw = String(text || '').replace(/\r/g, '\n');
  // A numbered marker always starts a new step, even mid-sentence.
  const marked = raw.replace(/(^|[\s\u2022])\d{1,2}\s*[.)\-:]\s+/g, '\n');
  return marked
    .split(/\n+/)
    .flatMap((line) => (/[,;|\u2022]|\bthen\b/i.test(line) ? line.split(/\s*[,;|\u2022]\s*|\s+then\s+/i) : [line]))
    .map(cleanOutlineStep)
    .filter((line) => line.length > 1 && line.length <= 160)
    .slice(0, 24);
}
