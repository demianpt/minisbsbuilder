import request from 'supertest';
import { describe, expect, it } from 'vitest';
import catalog from '../../src/data/dst-data.json';
import { createApp, createBriefServices } from '../../server/index.mjs';
import { createConfig } from '../../server/config.mjs';
import { PRESET_IDS } from '../../shared/design/concepts.mjs';
import { BUTTON_STYLE_IDS } from '../../shared/design/button-styles.mjs';

const BRIEF_TEXT = `Harbour Dental is a family dental practice in Portsmouth offering routine, cosmetic and emergency care. Our audience is local families and nervous adult patients who have avoided the dentist for years. We want them to book their first appointment online. We offer gentle, judgement-free dentistry with same-week emergency appointments and clear fixed pricing. The tone should be calm, plain and reassuring.`;

const ARCHETYPES = Object.entries(catalog.archetypes).map(([key, value]) => ({
  key, name: value.name, polarity: value.polarity, summary: String(value.paletteIntent || '').slice(0, 200),
}));
const FLOWS = catalog.flows.map((flow) => ({
  id: flow.id, name: flow.name, tagline: flow.tagline, bestFor: flow.bestFor, families: flow.families,
}));

function testConfig(overrides = {}) {
  return { ...createConfig({ NODE_ENV: 'test', OLLAMA_API_KEY: 'test-key', OLLAMA_BASE_URL: 'https://ollama.com/api' }), ...overrides };
}

function stubProvider(answers) {
  const calls = [];
  const queue = [...answers];
  return {
    calls,
    provider: {
      kind: 'ollama',
      model: 'gemma4:31b',
      async status() { return { configured: true, available: true, modelAvailable: true }; },
      async generateJson({ systemPrompt, userPrompt, jsonSchema, maxTokens, validate }) {
        calls.push({ systemPrompt, userPrompt, jsonSchema, maxTokens });
        const next = queue.length > 1 ? queue.shift() : queue[0];
        if (next instanceof Error) throw next;
        return validate ? validate(next) : next;
      },
    },
  };
}

function appWith(provider, config = testConfig()) {
  return createApp({ services: createBriefServices({ config, provider, logger: { info() {}, warn() {} } }) });
}

const GOOD_CONCEPTS = {
  business: 'A family dental practice in Portsmouth.',
  audience: 'Local families and nervous adults.',
  offer: 'Gentle dentistry with fixed pricing.',
  goal: 'Book a first appointment online.',
  voice: 'Calm, plain, reassuring.',
  clientName: 'Harbour Dental',
  keywords: ['gentle care', 'fixed pricing'],
  confidence: 0.9,
  missingFields: [],
  concepts: [
    { name: 'Calm and plain', archetypeKey: 'D', preset: 'calm', buttonStyle: 'solid-shift', dialOverrides: { motion: 18 }, why: 'Anxious audience.' },
    { name: 'Warm and human', archetypeKey: 'C', preset: 'friendly', buttonStyle: 'pill-glow', dialOverrides: {}, why: 'Family practice.' },
    { name: 'Editorial and considered', archetypeKey: 'A', preset: 'editorial', buttonStyle: 'offset-block', dialOverrides: {}, why: 'Authority.' },
  ],
  flows: [
    { id: 'B2', reason: 'Trust before the ask.', fit: 0.95 },
    { id: 'C3', reason: 'Booking first.', fit: 0.8 },
    { id: 'B1', reason: 'Testimonials reduce fear.', fit: 0.7 },
  ],
};

describe('POST /api/brief/concepts', () => {
  it('returns three distinct concepts, the readback, the fields and five flows', async () => {
    const { provider, calls } = stubProvider([GOOD_CONCEPTS]);
    const response = await request(appWith(provider))
      .post('/api/brief/concepts')
      .send({ briefText: BRIEF_TEXT, archetypes: ARCHETYPES, flows: FLOWS })
      .expect(200);

    expect(response.body.source).toBe('ai');
    expect(response.body.degraded).toBeNull();
    expect(response.body.concepts).toHaveLength(3);
    expect(response.body.concepts.map((concept) => concept.slot)).toEqual(['V1', 'V2', 'V3']);
    expect(response.body.concepts.map((concept) => concept.archetypeKey)).toEqual(['D', 'C', 'A']);
    expect(response.body.concepts[0].archetypeName).toBe(catalog.archetypes.D.name);
    expect(response.body.concepts[0].dialOverrides).toEqual({ motion: 18 });
    expect(response.body.flows).toHaveLength(5);
    expect(response.body.flows.slice(0, 3).map((flow) => flow.id)).toEqual(['B2', 'C3', 'B1']);
    // The advanced builder's fields have to come across for the handoff.
    expect(response.body.fields.clientName).toBe('Harbour Dental');
    expect(response.body.fields.audience).toContain('nervous adults');
    expect(response.body.briefText).toBe(BRIEF_TEXT);
    expect(response.body.readback.goal).toContain('Book a first appointment');

    // The prompt must offer only the vocabularies a concept may name.
    for (const id of PRESET_IDS) expect(calls[0].userPrompt).toContain(id);
    for (const id of BUTTON_STYLE_IDS) expect(calls[0].userPrompt).toContain(id);
    expect(calls[0].userPrompt).toContain(BRIEF_TEXT);
    expect(calls[0].maxTokens).toBe(3_072);
  });

  it('honours what the paragraph states outright, on every concept', async () => {
    const briefText = `${BRIEF_TEXT} Our brand colour is #0B3D2E and we want big typography, `
      + 'lots of white space and no animation. Use Fraunces for the headings.';
    const { provider, calls } = stubProvider([GOOD_CONCEPTS]);
    const response = await request(appWith(provider))
      .post('/api/brief/concepts')
      .send({ briefText, archetypes: ARCHETYPES, flows: FLOWS })
      .expect(200);

    // The model is told what was already read out of the paragraph, so it can
    // design around the constraints instead of against them.
    expect(calls[0].userPrompt).toContain('Design instructions this server already read');
    expect(calls[0].userPrompt).toContain('#0b3d2e');

    // And the constraints are applied regardless of what it answered: a stated
    // colour is a constraint on all three options, not an axis to vary them on.
    expect(response.body.directives.palette.accent).toBe('#0b3d2e');
    for (const concept of response.body.concepts) {
      expect(concept.designOverrides.palette.accent).toBe('#0b3d2e');
      expect(concept.designOverrides.fontDisplay).toBe('Fraunces');
      expect(concept.dialOverrides).toMatchObject({ headline: 92, density: 16, motion: 0 });
    }
    // The model's own nudge survives where the brief did not overrule it.
    expect(response.body.concepts[0].dialOverrides.motion).toBe(0);
  });

  it('says nothing about design instructions when the paragraph gave none', async () => {
    const { provider, calls } = stubProvider([GOOD_CONCEPTS]);
    const response = await request(appWith(provider))
      .post('/api/brief/concepts')
      .send({ briefText: BRIEF_TEXT, archetypes: ARCHETYPES, flows: FLOWS })
      .expect(200);
    expect(calls[0].userPrompt).not.toContain('Design instructions this server already read');
    expect(response.body.directives.any).toBe(false);
    for (const concept of response.body.concepts) {
      // No fonts and no dial constraints, because the paragraph named none.
      expect(concept.designOverrides.fontDisplay).toBeUndefined();
      expect(concept.designOverrides.fontBody).toBeUndefined();
      // Colours are a different matter: a concept always carries its own
      // palette now, so three options differ on the axis a client sees first
      // instead of all inheriting whichever archetype they landed on.
      expect(Object.keys(concept.designOverrides.palette)).toEqual(['bg', 'ink', 'accent', 'soft', 'dark']);
      expect(concept.paletteReport.ok).toBe(true);
    }
    const grounds = response.body.concepts.map((concept) => concept.palette.bg);
    expect(new Set(grounds).size).toBe(grounds.length);
  });

  it('rejects a set where two concepts share an archetype', async () => {
    const { provider } = stubProvider([{
      ...GOOD_CONCEPTS,
      concepts: [
        { name: 'One', archetypeKey: 'D', preset: 'calm', buttonStyle: 'solid-shift', why: 'w' },
        { name: 'Two', archetypeKey: 'D', preset: 'bold', buttonStyle: 'sweep-fill', why: 'w' },
        { name: 'Three', archetypeKey: 'D', preset: 'friendly', buttonStyle: 'pill-glow', why: 'w' },
      ],
    }]);
    const response = await request(appWith(provider))
      .post('/api/brief/concepts')
      .send({ briefText: BRIEF_TEXT, archetypes: ARCHETYPES, flows: FLOWS })
      .expect(200);
    // One concept shown three times is not a choice, so the planner answers.
    expect(response.body.source).toBe('deterministic');
    expect(new Set(response.body.concepts.map((concept) => concept.archetypeKey)).size).toBe(response.body.concepts.length);
  });

  it('refuses a flow id the editor added at runtime but never sent', async () => {
    /*
     * The catalog is the contract. A flow that exists only in the browser is not
     * in it, and accepting the id would leave the editor pointing at nothing.
     *
     * `X7` is the shape of a flow a strategist typed into their own project:
     * those live on the project and are never in the catalogue. This used to use
     * `B11`, which was a runtime-injected flow at the time and is now a real
     * catalogue entry — so the case it was written to cover had stopped existing.
     */
    expect(FLOWS.map((flow) => flow.id)).not.toContain('X7');
    const { provider } = stubProvider([{ ...GOOD_CONCEPTS, flows: [{ id: 'X7', reason: 'Runtime only.', fit: 0.9 }] }]);
    const response = await request(appWith(provider))
      .post('/api/brief/concepts')
      .send({ briefText: BRIEF_TEXT, archetypes: ARCHETYPES, flows: FLOWS })
      .expect(200);
    expect(response.body.source).toBe('deterministic');
    for (const flow of response.body.flows) expect(FLOWS.map((entry) => entry.id)).toContain(flow.id);
  });

  it('rejects an archetype, preset or flow outside the supplied catalog', async () => {
    const { provider } = stubProvider([{
      ...GOOD_CONCEPTS,
      concepts: [{ name: 'Invented', archetypeKey: 'Z', preset: 'zebra', buttonStyle: 'sparkles', why: 'w' }],
      flows: [{ id: 'ZZ9', reason: 'Invented.', fit: 1 }],
    }]);
    const response = await request(appWith(provider))
      .post('/api/brief/concepts')
      .send({ briefText: BRIEF_TEXT, archetypes: ARCHETYPES, flows: FLOWS })
      .expect(200);
    expect(response.body.source).toBe('deterministic');
    for (const concept of response.body.concepts) {
      expect(Object.keys(catalog.archetypes)).toContain(concept.archetypeKey);
      expect(PRESET_IDS).toContain(concept.preset);
      expect(BUTTON_STYLE_IDS).toContain(concept.buttonStyle);
    }
    for (const flow of response.body.flows) expect(FLOWS.map((entry) => entry.id)).toContain(flow.id);
  });

  it('tops a short set up to three concepts and five flows from the deterministic ranking', async () => {
    const { provider } = stubProvider([{
      ...GOOD_CONCEPTS,
      concepts: [{ name: 'Only one', archetypeKey: 'D', preset: 'calm', buttonStyle: 'solid-shift', why: 'w' }],
      flows: [{ id: 'B2', reason: 'r', fit: 0.9 }],
    }]);
    const response = await request(appWith(provider))
      .post('/api/brief/concepts')
      .send({ briefText: BRIEF_TEXT, archetypes: ARCHETYPES, flows: FLOWS })
      .expect(200);
    expect(response.body.concepts).toHaveLength(3);
    expect(response.body.flows).toHaveLength(5);
    expect(response.body.concepts[0].name).toBe('Only one');
    expect(response.body.concepts.slice(1).every((concept) => concept.backfilled)).toBe(true);
  });

  it('falls back entirely when the model is unreachable', async () => {
    const { provider } = stubProvider([Object.assign(new Error('down'), { code: 'OLLAMA_UNAVAILABLE', status: 503 })]);
    const response = await request(appWith(provider))
      .post('/api/brief/concepts')
      .send({ briefText: BRIEF_TEXT, archetypes: ARCHETYPES, flows: FLOWS })
      .expect(200);
    expect(response.body.source).toBe('deterministic');
    expect(response.body.degraded.code).toBe('OLLAMA_UNAVAILABLE');
    expect(response.body.concepts).toHaveLength(3);
    expect(response.body.flows).toHaveLength(5);
    expect(new Set(response.body.concepts.map((concept) => concept.archetypeKey)).size).toBe(3);
    // The deterministic split still supplies the advanced builder's fields.
    expect(response.body.fields.audience).toContain('nervous adult patients');
    expect(response.body.fields.goal).toContain('book their first appointment');
  });

  it('requires enough brief text to work with', async () => {
    const { provider } = stubProvider([GOOD_CONCEPTS]);
    const response = await request(appWith(provider))
      .post('/api/brief/concepts')
      .send({ briefText: 'A shop.', archetypes: ARCHETYPES, flows: FLOWS })
      .expect(422);
    expect(response.body.error.code).toBe('BRIEF_REQUIRED');
  });

  it('requires the catalogs', async () => {
    const { provider } = stubProvider([GOOD_CONCEPTS]);
    await request(appWith(provider)).post('/api/brief/concepts').send({ briefText: BRIEF_TEXT }).expect(422);
  });
});

describe('POST /api/brief/expand', () => {
  it('splits one paragraph into the advanced builder fields', async () => {
    const { provider, calls } = stubProvider([{
      projectName: 'Harbour Dental',
      clientName: 'Harbour Dental',
      industry: 'Family dental practice in Portsmouth.',
      audience: 'Local families and nervous adults.',
      goal: 'Book a first appointment online.',
      offer: 'Gentle dentistry with fixed pricing.',
      tone: 'Calm and reassuring.',
      keywords: 'gentle care, fixed pricing',
      notes: '',
    }]);
    const response = await request(appWith(provider))
      .post('/api/brief/expand')
      .send({ briefText: BRIEF_TEXT })
      .expect(200);
    expect(response.body.source).toBe('ai');
    expect(response.body.clientName).toBe('Harbour Dental');
    expect(response.body.goal).toContain('Book a first appointment');
    expect(response.body.briefText).toBe(BRIEF_TEXT);
    expect(calls[0].userPrompt).toContain(BRIEF_TEXT);
  });

  it('refuses an answer that filled none of the load-bearing fields', async () => {
    const { provider } = stubProvider([{ projectName: 'X', industry: '', audience: '', goal: '', offer: '', tone: '' }]);
    const response = await request(appWith(provider)).post('/api/brief/expand').send({ briefText: BRIEF_TEXT }).expect(200);
    expect(response.body.source).toBe('deterministic');
    // The local split still produces something usable.
    expect(response.body.audience).toContain('nervous adult patients');
  });

  it('fills a field the model left blank from the local split', async () => {
    const { provider } = stubProvider([{
      industry: 'Family dental practice in Portsmouth.',
      audience: '', goal: '', offer: 'Gentle dentistry.', tone: '',
    }]);
    const response = await request(appWith(provider)).post('/api/brief/expand').send({ briefText: BRIEF_TEXT }).expect(200);
    expect(response.body.industry).toBe('Family dental practice in Portsmouth.');
    expect(response.body.audience).toContain('nervous adult patients');
    expect(response.body.goal).toContain('book their first appointment');
  });

  it('needs something to split', async () => {
    const { provider } = stubProvider([{}]);
    await request(appWith(provider)).post('/api/brief/expand').send({ briefText: 'hi' }).expect(422);
  });
});
