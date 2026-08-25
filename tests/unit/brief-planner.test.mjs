import { describe, expect, it } from 'vitest';
import catalog from '../../src/data/dst-data.json';
import { SECTION_FAMILY_IDS, matchSectionFamily, splitOutlineSteps } from '../../shared/brief/families.mjs';
import { briefSignals, draftPageContent, outlineFamilies, planOutline, recommendFromBrief } from '../../shared/brief/planner.mjs';

const DENTAL = {
  projectName: 'Harbour Dental',
  clientName: 'Harbour Dental',
  industry: 'Family dental practice in Portsmouth offering routine and emergency care',
  audience: 'Local families and nervous adult patients who have avoided the dentist for years',
  goal: 'Get a nervous new patient to book their first appointment online',
  offer: 'Gentle judgement-free dentistry with same-week emergency appointments and clear fixed pricing',
  tone: 'Calm, plain and reassuring',
  keywords: 'gentle care, same-week appointments, fixed pricing',
  notes: '',
};

describe('outline parsing', () => {
  it('splits the inline numbered list a strategist actually types', () => {
    expect(splitOutlineSteps('The page will have 1. Hero 2. Before after image gallery 3. A pricing 4. Testimonials'))
      .toEqual(['The page will have', 'Hero', 'Before after image gallery', 'A pricing', 'Testimonials']);
  });

  it('splits one item per line and comma-separated prose', () => {
    expect(splitOutlineSteps('Hero\nServices\nPricing')).toEqual(['Hero', 'Services', 'Pricing']);
    expect(splitOutlineSteps('hero, services, pricing then contact')).toEqual(['hero', 'services', 'pricing', 'contact']);
    expect(splitOutlineSteps('- Hero\n- Our work\n- Book a call')).toEqual(['Hero', 'Our work', 'Book a call']);
  });

  it('maps a strategist phrase to a registered DST family', () => {
    expect(matchSectionFamily('booking form').family).toBe('contact');
    expect(matchSectionFamily('how it works').family).toBe('timeline');
    expect(matchSectionFamily('trusted by logos').family).toBe('logo');
    expect(matchSectionFamily('what we do').family).toBe('cards');
    expect(matchSectionFamily('our portfolio').family).toBe('gallery');
    expect(matchSectionFamily('a completely unrelated sentence')).toBeNull();
  });

  it('prefers the longest matching phrase, so "before after" beats "after"', () => {
    expect(matchSectionFamily('Before after image gallery').matched).toBe('before after');
  });

  it('drops the leading instruction and flags what it could not map', () => {
    const plan = planOutline('The page will have 1. Hero 2. A carousel of interpretive dance 3. Pricing');
    expect(plan.steps.map((step) => step.family)).toEqual(['hero', 'slider', 'pricing']);
    expect(plan.steps[0].requested).toBe('Hero');

    const harder = planOutline('I want 1. Hero 2. zzzqqq 3. Pricing');
    expect(harder.steps.find((step) => step.requested === 'zzzqqq').family).toBeNull();
    expect(harder.unresolved).toEqual(['zzzqqq']);
  });

  it('adds a hero and a closing action only when the outline lacks them', () => {
    const missing = planOutline('1. Services 2. Pricing');
    expect(missing.added.map((entry) => entry.family)).toEqual(['hero', 'cta']);
    expect(outlineFamilies(missing)).toEqual(['hero', 'cards', 'pricing', 'cta']);

    const complete = planOutline('1. Hero 2. Services 3. Book a call');
    expect(complete.added).toEqual([]);
    expect(outlineFamilies(complete)).toEqual(['hero', 'cards', 'contact']);
  });

  it('never emits the same family twice in a row', () => {
    const plan = planOutline('1. Hero 2. Services 3. What we do 4. Book a call');
    expect(outlineFamilies(plan)).toEqual(['hero', 'cards', 'contact']);
  });

  it('only ever emits registered families', () => {
    const plan = planOutline('1. Hero 2. Pricing 3. FAQ 4. Contact');
    for (const family of outlineFamilies(plan)) expect(SECTION_FAMILY_IDS).toContain(family);
  });
});

describe('deterministic recommendations', () => {
  it('reads the commercial intent out of the brief', () => {
    const signals = briefSignals(DENTAL).map((signal) => signal.id);
    expect(signals).toContain('booking');
    expect(signals).toContain('pricing');
  });

  it('quotes the brief back rather than inventing a reading', () => {
    const result = recommendFromBrief({ brief: DENTAL, archetypes: catalog.archetypes, flows: catalog.flows });
    expect(result.source).toBe('deterministic');
    expect(result.readback.audience).toContain('nervous adult patients');
    expect(result.readback.goal).toContain('book their first appointment');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('recommends one real archetype and five real flows with reasons', () => {
    const result = recommendFromBrief({ brief: DENTAL, archetypes: catalog.archetypes, flows: catalog.flows });
    expect(Object.keys(catalog.archetypes)).toContain(result.archetype.key);
    expect(result.archetype.reason.length).toBeGreaterThan(10);
    expect(result.flows).toHaveLength(5);
    const ids = catalog.flows.map((flow) => flow.id);
    for (const flow of result.flows) {
      expect(ids).toContain(flow.id);
      expect(flow.reason.length).toBeGreaterThan(10);
      expect(flow.fit).toBeGreaterThan(0);
    }
    // Best first.
    expect(result.flows[0].fit).toBeGreaterThanOrEqual(result.flows[1].fit);
  });

  it('is deterministic: the same brief always ranks the same way', () => {
    const a = recommendFromBrief({ brief: DENTAL, archetypes: catalog.archetypes, flows: catalog.flows });
    const b = recommendFromBrief({ brief: DENTAL, archetypes: catalog.archetypes, flows: catalog.flows });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('recommends different flows for a materially different brief', () => {
    const dental = recommendFromBrief({ brief: DENTAL, archetypes: catalog.archetypes, flows: catalog.flows });
    const studio = recommendFromBrief({
      brief: {
        industry: 'Architecture studio publishing its built portfolio',
        audience: 'Developers and private clients commissioning residential work',
        goal: 'Get a developer to request the studio portfolio',
        offer: 'Residential architecture with a photographed body of built work',
        tone: 'Editorial, restrained and refined',
        keywords: 'built work, photography, craft',
      },
      archetypes: catalog.archetypes,
      flows: catalog.flows,
    });
    expect(studio.flows.map((flow) => flow.id)).not.toEqual(dental.flows.map((flow) => flow.id));
  });

  it('still answers usefully for an almost-empty brief', () => {
    const result = recommendFromBrief({ brief: { projectName: 'X' }, archetypes: catalog.archetypes, flows: catalog.flows });
    expect(result.flows.length).toBeGreaterThanOrEqual(1);
    expect(result.missingFields).toContain('goal');
    expect(result.confidence).toBeLessThan(0.5);
  });
});

describe('deterministic page copy', () => {
  const families = ['hero', 'cards', 'stats', 'timeline', 'faq', 'pricing', 'testimonial', 'cta'];
  const draft = draftPageContent({ brief: DENTAL, families });

  it('writes one section per requested family, in order', () => {
    expect(draft.sections.map((section) => section.family)).toEqual(families);
  });

  it("uses the strategist's own words in the hero and the close", () => {
    expect(draft.sections[0].title).toContain('Gentle judgement-free dentistry');
    expect(draft.sections[families.indexOf('cta')].title.toLowerCase()).toContain('book');
  });

  it('never invents a statistic: numeric slots are instructions', () => {
    const stats = draft.sections.find((section) => section.family === 'stats');
    for (const item of stats.items) {
      expect(item.title.toLowerCase()).toContain('replace');
      expect(item.value).toMatch(/^\d*$/);
    }
  });

  it('gives every family the item count its renderer expects', () => {
    const byFamily = Object.fromEntries(draft.sections.map((section) => [section.family, section]));
    expect(byFamily.cards.items).toHaveLength(3);
    expect(byFamily.timeline.items).toHaveLength(4);
    expect(byFamily.faq.items).toHaveLength(3);
    expect(byFamily.pricing.items).toHaveLength(3);
    expect(byFamily.hero.items).toHaveLength(0);
  });

  it('puts exactly one primary action on the hero and the close', () => {
    expect(draft.sections[0].buttons[0].type).toBe('primary');
    expect(draft.sections.at(-1).buttons.filter((button) => button.type === 'primary')).toHaveLength(1);
  });

  it('never writes a link, because the builder owns URLs', () => {
    for (const section of draft.sections) {
      for (const button of section.buttons) expect(button).not.toHaveProperty('link');
    }
  });

  // The closing band is the last thing on the page, and it used to keep the
  // demonstration project's statement after every module had been rewritten.
  it('writes the footer as well as the sections', () => {
    expect(draft.footer.statement).toBeTruthy();
    expect(draft.footer.description).toBeTruthy();
    expect(draft.footer.ctaText).toBeTruthy();
    // Assembled from the brief, like every other sentence here.
    expect(draft.footer.statement.toLowerCase()).toContain('book');
    expect(draft.footer.description.toLowerCase()).toContain('gentle');
    // An action, not a URL and not a sign-off.
    expect(draft.footer.ctaText).toMatch(/^[A-Z][a-z]/);
    expect(draft.footer.ctaText).not.toContain('http');
  });

  it('still writes a footer when the brief says almost nothing', () => {
    const thin = draftPageContent({ brief: { projectName: 'Acme' }, families: ['hero', 'cta'] });
    expect(thin.footer.statement).toBeTruthy();
    expect(thin.footer.description).toBeTruthy();
    expect(thin.footer.ctaText).toBeTruthy();
  });
});
