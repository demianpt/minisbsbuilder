import { describe, expect, it } from 'vitest';
import {
  briefReadiness,
  coerceBriefUnderstanding,
  coerceOutlinePlan,
  coercePageContent,
  parseBriefUnderstanding,
  parseOutlinePlan,
  parsePageContent,
} from '../../shared/brief/schemas.mjs';

/**
 * The hosted model does not honour Ollama's `format` constraint: it answers with
 * a flattened, renamed, roughly-correct object. These tests pin the repair layer
 * that makes that answer usable, because without it every AI call silently
 * degrades to the deterministic planner.
 */

describe('coerceBriefUnderstanding', () => {
  it('accepts the flat shape the model actually returns', () => {
    const parsed = parseBriefUnderstanding({
      business: 'A dental practice.',
      audience: 'Nervous adults.',
      offer: 'Gentle care.',
      goal: 'Book online.',
      voice: 'Calm.',
      confidence: 0.9,
      keywords: ['gentle'],
      missingFields: [],
      archetypeKey: 'D',
      archetypeReason: 'The voice asks for calm.',
      flows: [{ id: 'C3', reason: 'Booking first.', fit: 0.95 }],
    });
    expect(parsed.readback.business).toBe('A dental practice.');
    expect(parsed.archetype).toEqual({ key: 'D', reason: 'The voice asks for calm.' });
    expect(parsed.flows[0]).toEqual({ id: 'C3', reason: 'Booking first.', fit: 0.95 });
  });

  it('accepts the nested shape a compliant model would return', () => {
    const parsed = parseBriefUnderstanding({
      readback: { business: 'b', audience: 'a', offer: 'o', goal: 'g', voice: 'v' },
      confidence: 0.5,
      archetype: { key: 'A', reason: 'Editorial.' },
      flows: [{ id: 'A1', reason: 'Safe default.', fit: 0.6 }],
    });
    expect(parsed.readback.audience).toBe('a');
    expect(parsed.archetype.key).toBe('A');
  });

  it('repairs the field renames and value formats seen in practice', () => {
    const coerced = coerceBriefUnderstanding({
      whatTheBusinessDoes: 'A clinic.',
      primaryAudience: 'Families.',
      coreOffer: 'Care.',
      pageGoal: 'Book.',
      tone: 'Warm.',
      // Percentages instead of ratios, and a string list instead of an array.
      confidence: 88,
      keywords: 'gentle care, fixed pricing',
      archetype: 'D — Clean / Utility',
      archetypeReason: 'Calm voice.',
      recommendedFlows: [{ flowId: 'C3', why: 'Booking.', score: 95 }],
    });
    expect(coerced.confidence).toBeCloseTo(0.88);
    expect(coerced.keywords).toEqual(['gentle care', 'fixed pricing']);
    expect(coerced.archetype.key).toBe('D');
    expect(coerced.flows).toEqual([{ id: 'C3', reason: 'Booking.', fit: 0.95 }]);
    expect(() => parseBriefUnderstanding(coerced)).not.toThrow();
  });

  it('rejects an answer with no usable archetype key', () => {
    expect(() => parseBriefUnderstanding({
      business: 'b', audience: 'a', offer: 'o', goal: 'g', voice: 'v',
      archetypeKey: 'Zeta', archetypeReason: 'r', flows: [{ id: 'A1', reason: 'r', fit: 1 }],
    })).toThrow();
  });

  it('rejects an answer with no flows at all', () => {
    expect(() => parseBriefUnderstanding({
      business: 'b', audience: 'a', offer: 'o', goal: 'g', voice: 'v',
      archetypeKey: 'A', archetypeReason: 'r', flows: [],
    })).toThrow();
  });
});

describe('coercePageContent', () => {
  it('normalises per-family field names onto one neutral item shape', () => {
    const parsed = parsePageContent({
      sections: [
        { section: 'faq', heading: 'Questions', questions: [{ question: 'Will I be judged?', answer: 'No.' }] },
        { type: 'stats', title: 'Numbers', items: [{ label: 'Patients', number: 'Add the figure' }] },
        { family: 'hero', headline: 'A promise', ctas: [{ label: 'Book now', variant: 'primary' }] },
      ],
    });
    expect(parsed.sections.map((section) => section.family)).toEqual(['faq', 'stats', 'hero']);
    expect(parsed.sections[0].title).toBe('Questions');
    expect(parsed.sections[0].items[0]).toEqual({ title: 'Will I be judged?', description: 'No.', value: '' });
    expect(parsed.sections[1].items[0]).toEqual({ title: 'Patients', description: '', value: 'Add the figure' });
    expect(parsed.sections[2].buttons[0]).toEqual({ text: 'Book now', type: 'primary' });
  });

  it('accepts a bare array of sections', () => {
    const parsed = coercePageContent([{ family: 'cta', title: 'Ready?' }]);
    expect(parsed.sections).toHaveLength(1);
  });

  it('drops a section whose family is not a registered DST family', () => {
    const parsed = coercePageContent({ sections: [{ family: 'newsletter-popup', title: 'Nope' }, { family: 'cta', title: 'Yes' }] });
    expect(parsed.sections.map((section) => section.family)).toEqual(['cta']);
  });

  it('coerces an unknown button type to primary rather than failing', () => {
    const parsed = parsePageContent({ sections: [{ family: 'cta', title: 'Go', buttons: [{ text: 'Go', type: 'ghost' }] }] });
    expect(parsed.sections[0].buttons[0].type).toBe('primary');
  });

  // The footer is the page's last sentence, so the writer is asked for it too.
  it('reads the footer under whichever name the model used for it', () => {
    const parsed = parsePageContent({
      sections: [{ family: 'cta', title: 'Ready?' }],
      closing: { headline: 'Care that comes to you.', supporting: 'Same-week appointments.', cta: { label: 'Book online' } },
    });
    expect(parsed.footer).toEqual({
      statement: 'Care that comes to you.',
      description: 'Same-week appointments.',
      ctaText: 'Book online',
    });
  });

  it('takes the label when the footer action is answered as a bare string', () => {
    const parsed = parsePageContent({ sections: [{ family: 'cta', title: 'Ready?' }], footer: { statement: 'One line.', ctaText: 'Call us' } });
    expect(parsed.footer.ctaText).toBe('Call us');
  });

  // No statement means no footer: an object of empty strings would overwrite
  // the strategist's own closing line with nothing.
  it('returns no footer at all when the model skipped it', () => {
    expect(parsePageContent({ sections: [{ family: 'cta', title: 'Ready?' }] }).footer).toBe(null);
    expect(parsePageContent({ sections: [{ family: 'cta', title: 'Ready?' }], footer: { description: 'Only this.' } }).footer).toBe(null);
  });
});

describe('coerceOutlinePlan', () => {
  it('keeps the strategist order and drops unmappable steps', () => {
    const parsed = parseOutlinePlan({
      name: 'Proof-led booking path',
      steps: [
        { requested: 'Hero', family: 'hero' },
        { requested: 'A carousel of nothing', family: 'not-a-family' },
        { requested: 'Testimonials', family: 'testimonial' },
      ],
      added: [{ family: 'cta', reason: 'Needs a close.' }],
    });
    expect(parsed.steps.map((step) => step.family)).toEqual(['hero', 'testimonial']);
    expect(parsed.added).toEqual([{ family: 'cta', reason: 'Needs a close.' }]);
  });

  it('accepts a bare list of family names', () => {
    const parsed = coerceOutlinePlan(['hero', 'cards', 'cta']);
    expect(parsed.steps.map((step) => step.family)).toEqual(['hero', 'cards', 'cta']);
  });

  it('extracts a family from a decorated value', () => {
    const parsed = coerceOutlinePlan({ steps: [{ requested: 'Pricing table', family: 'pricing (three tiers)' }] });
    expect(parsed.steps[0].family).toBe('pricing');
  });
});

describe('briefReadiness', () => {
  it('reports which load-bearing fields are still too thin', () => {
    const readiness = briefReadiness({ projectName: 'X', industry: 'Dentistry in Portsmouth', audience: 'no' });
    expect(readiness.missingRequired).toContain('audience');
    expect(readiness.missingRequired).toContain('goal');
    expect(readiness.filled).toContain('industry');
    expect(readiness.ready).toBe(false);
  });

  it('is ready once at least two of the four are substantial', () => {
    const readiness = briefReadiness({
      industry: 'Family dental practice in Portsmouth',
      audience: 'Local families and nervous adults',
      goal: 'Book a first appointment online',
      offer: 'Gentle judgement-free dentistry',
    });
    expect(readiness.missingRequired).toEqual([]);
    expect(readiness.ready).toBe(true);
  });
});
