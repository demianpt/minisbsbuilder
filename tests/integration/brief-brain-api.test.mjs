import request from 'supertest';
import { describe, expect, it } from 'vitest';
import catalog from '../../src/data/dst-data.json';
import { createApp, createBriefServices } from '../../server/index.mjs';
import { createConfig } from '../../server/config.mjs';

const BRIEF = {
  projectName: 'Harbour Dental',
  clientName: 'Harbour Dental',
  industry: 'Family dental practice in Portsmouth offering routine and emergency care',
  audience: 'Local families and nervous adult patients who have avoided the dentist for years',
  goal: 'Get a nervous new patient to book their first appointment online',
  offer: 'Gentle, judgement-free dentistry with same-week emergency appointments and clear fixed pricing',
  tone: 'Calm, plain and reassuring. Never salesy.',
  keywords: 'gentle care, same-week appointments, fixed pricing',
  notes: '',
};

const ARCHETYPES = Object.entries(catalog.archetypes).map(([key, value]) => ({
  key,
  name: value.name,
  polarity: value.polarity,
  summary: String(value.paletteIntent || '').slice(0, 200),
}));

const FLOWS = catalog.flows.map((flow) => ({
  id: flow.id, name: flow.name, tagline: flow.tagline, bestFor: flow.bestFor, families: flow.families,
}));

function testConfig(overrides = {}) {
  return { ...createConfig({ NODE_ENV: 'test', OLLAMA_API_KEY: 'test-key', OLLAMA_BASE_URL: 'https://ollama.com/api' }), ...overrides };
}

/** A provider stub that answers with whatever the test wants for each call. */
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
        if (typeof next === 'function') return validate ? validate(await next()) : next();
        if (next instanceof Error) throw next;
        return validate ? validate(next) : next;
      },
    },
  };
}

function appWith(provider, config = testConfig()) {
  return createApp({ services: createBriefServices({ config, provider, logger: { info() {}, warn() {} } }) });
}

describe('POST /api/brief/understand', () => {
  it('returns the model readback, one archetype and five flow recommendations', async () => {
    const { provider, calls } = stubProvider([{
      readback: {
        business: 'A family dental practice in Portsmouth.',
        audience: 'Local families and nervous adults.',
        offer: 'Gentle dentistry with same-week emergency slots and fixed pricing.',
        goal: 'Book a first appointment online.',
        voice: 'Calm, plain, reassuring.',
      },
      confidence: 0.88,
      missingFields: [],
      keywords: ['gentle care', 'fixed pricing'],
      archetype: { key: 'D', reason: 'The voice asks for calm and plain, and the audience is anxious.' },
      flows: [
        { id: 'C3', reason: 'Lead capture puts the booking path first.', fit: 0.95 },
        { id: 'B2', reason: 'Trust before the ask suits nervous patients.', fit: 0.8 },
        { id: 'B1', reason: 'Testimonials reduce fear.', fit: 0.7 },
      ],
    }]);

    const response = await request(appWith(provider))
      .post('/api/brief/understand')
      .send({ brief: BRIEF, archetypes: ARCHETYPES, flows: FLOWS })
      .expect(200);

    expect(response.body.source).toBe('ai');
    expect(response.body.degraded).toBeNull();
    expect(response.body.archetype).toMatchObject({ key: 'D' });
    expect(response.body.archetypeName).toBe(catalog.archetypes.D.name);
    expect(response.body.flows).toHaveLength(5);
    expect(response.body.flows.slice(0, 3).map((flow) => flow.id)).toEqual(['C3', 'B2', 'B1']);
    expect(new Set(response.body.flows.map((flow) => flow.id)).size).toBe(5);
    expect(response.body.readback.goal).toContain('Book a first appointment');
    // The prompt must actually contain the strategist's brief fields.
    expect(calls[0].userPrompt).toContain('nervous adult patients');
    expect(calls[0].userPrompt).toContain('Calm, plain and reassuring');
    // And the catalogs it is allowed to choose from.
    expect(calls[0].userPrompt).toContain('C3 ·');
    expect(calls[0].userPrompt).toContain('D ·');
  });

  it('rejects an archetype key or flow id outside the supplied catalog', async () => {
    const { provider } = stubProvider([{
      readback: { business: 'b', audience: 'a', offer: 'o', goal: 'g', voice: 'v' },
      confidence: 0.5,
      missingFields: [],
      keywords: [],
      archetype: { key: 'Z', reason: 'Invented.' },
      flows: [{ id: 'ZZ9', reason: 'Invented.', fit: 1 }],
    }]);
    const response = await request(appWith(provider))
      .post('/api/brief/understand')
      .send({ brief: BRIEF, archetypes: ARCHETYPES, flows: FLOWS })
      .expect(200);
    // Off-catalog answers are not surfaced: the deterministic planner answers.
    expect(response.body.source).toBe('deterministic');
    expect(response.body.degraded.code).toMatch(/SCHEMA_INVALID$/);
    expect(Object.keys(catalog.archetypes)).toContain(response.body.archetype.key);
    expect(response.body.flows.length).toBeGreaterThanOrEqual(1);
    for (const flow of response.body.flows) expect(FLOWS.map((entry) => entry.id)).toContain(flow.id);
  });

  it('falls back to the deterministic planner when the model is unreachable', async () => {
    const { provider } = stubProvider([Object.assign(new Error('down'), { code: 'OLLAMA_UNAVAILABLE', status: 503 })]);
    const response = await request(appWith(provider))
      .post('/api/brief/understand')
      .send({ brief: BRIEF, archetypes: ARCHETYPES, flows: FLOWS })
      .expect(200);
    expect(response.body.source).toBe('deterministic');
    expect(response.body.degraded.code).toBe('OLLAMA_UNAVAILABLE');
    expect(response.body.flows).toHaveLength(5);
    expect(response.body.readback.audience).toContain('nervous adult patients');
  });

  it('requires the archetype and flow catalogs', async () => {
    const { provider } = stubProvider([{}]);
    await request(appWith(provider)).post('/api/brief/understand').send({ brief: BRIEF }).expect(422);
  });

  it('refuses a client-chosen model', async () => {
    const { provider } = stubProvider([{}]);
    const response = await request(appWith(provider))
      .post('/api/brief/understand')
      .send({ brief: BRIEF, archetypes: ARCHETYPES, flows: FLOWS, model: 'some-other-model' })
      .expect(422);
    expect(response.body.error.code).toBe('MODEL_UNSUPPORTED');
  });
});

describe('POST /api/brief/content', () => {
  const families = ['hero', 'cards', 'testimonial', 'cta'];

  it('writes one section per requested family, in order', async () => {
    const { provider, calls } = stubProvider([{
      sections: [
        { family: 'hero', pretitle: 'Portsmouth', title: 'Dentistry that does not rush you', subtitle: 'Same-week emergency care.', body: '', items: [], buttons: [{ text: 'Book online', type: 'primary' }] },
        { family: 'cards', pretitle: 'What you get', title: 'Where we help', subtitle: '', body: '', items: [{ title: 'Gentle care', description: 'Sedation options explained first.', value: '' }], buttons: [] },
        { family: 'testimonial', pretitle: 'In their words', title: 'What patients say', subtitle: '', body: '', items: [{ title: 'Quote a nervous patient', description: '', value: '' }], buttons: [] },
        { family: 'cta', pretitle: 'Harbour Dental', title: 'Book your first appointment', subtitle: '', body: '', items: [], buttons: [{ text: 'Book online', type: 'primary' }] },
      ],
    }]);
    const response = await request(appWith(provider))
      .post('/api/brief/content')
      .send({ brief: BRIEF, families })
      .expect(200);
    expect(response.body.source).toBe('ai');
    expect(response.body.sections.map((section) => section.family)).toEqual(families);
    expect(response.body.sections[0].title).toContain('does not rush you');
    expect(calls[0].maxTokens).toBe(4_096);
  });

  it('repairs a misordered answer positionally instead of reshaping the page', async () => {
    const { provider } = stubProvider([{
      sections: [
        { family: 'cta', title: 'Book your first appointment', items: [], buttons: [] },
        { family: 'hero', title: 'Dentistry that does not rush you', items: [], buttons: [] },
        { family: 'cards', title: 'Where we help', items: [], buttons: [] },
        { family: 'testimonial', title: 'What patients say', items: [], buttons: [] },
      ],
    }]);
    const response = await request(appWith(provider)).post('/api/brief/content').send({ brief: BRIEF, families }).expect(200);
    expect(response.body.sections.map((section) => section.family)).toEqual(families);
    expect(response.body.sections[0].title).toContain('does not rush you');
    expect(response.body.sections[3].title).toContain('Book your first appointment');
  });

  it('drafts locally for a family the model skipped', async () => {
    const { provider } = stubProvider([{
      sections: [
        { family: 'hero', title: 'Dentistry that does not rush you', items: [], buttons: [] },
        { family: 'cards', title: 'Where we help', items: [], buttons: [] },
        { family: 'cta', title: 'Book your first appointment', items: [], buttons: [] },
      ],
    }]);
    const response = await request(appWith(provider)).post('/api/brief/content').send({ brief: BRIEF, families }).expect(200);
    expect(response.body.sections.map((section) => section.family)).toEqual(families);
    expect(response.body.sections[2].aiWritten).toBe(false);
    expect(response.body.sections[2].title).toBeTruthy();
  });

  it('keeps the footer the model wrote', async () => {
    const { provider } = stubProvider([{
      sections: families.map((family) => ({ family, title: 'Heading for ' + family, items: [], buttons: [] })),
      footer: { statement: 'Care that comes to you.', description: 'Same-week appointments, fixed pricing.', ctaText: 'Book online' },
    }]);
    const response = await request(appWith(provider)).post('/api/brief/content').send({ brief: BRIEF, families }).expect(200);
    expect(response.body.footer).toMatchObject({
      statement: 'Care that comes to you.',
      description: 'Same-week appointments, fixed pricing.',
      ctaText: 'Book online',
    });
  });

  // The closing band is not optional on the page, so it is not optional in the
  // answer either: a model that skipped it gets the deterministic footer.
  it('drafts the footer locally when the model skipped it', async () => {
    const { provider } = stubProvider([{
      sections: families.map((family) => ({ family, title: 'Heading for ' + family, items: [], buttons: [] })),
    }]);
    const response = await request(appWith(provider)).post('/api/brief/content').send({ brief: BRIEF, families }).expect(200);
    expect(response.body.footer.aiWritten).toBe(false);
    expect(response.body.footer.statement).toBeTruthy();
    expect(response.body.footer.ctaText).toBeTruthy();
  });

  it('requires the ordered families', async () => {
    const { provider } = stubProvider([{}]);
    await request(appWith(provider)).post('/api/brief/content').send({ brief: BRIEF, families: [] }).expect(422);
  });
});

describe('POST /api/brief/outline', () => {
  it('maps a typed outline to DST families in the typed order', async () => {
    const { provider, calls } = stubProvider([{
      name: 'Proof-led booking path',
      rationale: 'Show the transformation, price it, then prove it with patients.',
      steps: [
        { requested: 'Hero', family: 'hero', reason: 'The promise comes first.' },
        { requested: 'Before after image gallery', family: 'gallery', reason: 'A set of paired images is a gallery.' },
        { requested: 'A pricing', family: 'pricing', reason: 'Fixed pricing is the objection.' },
        { requested: 'Testimonials', family: 'testimonial', reason: 'Named patients reduce fear.' },
      ],
      added: [{ family: 'cta', reason: 'The page needs somewhere to land.' }],
    }]);
    const response = await request(appWith(provider))
      .post('/api/brief/outline')
      .send({ brief: BRIEF, outline: 'The page will have 1. Hero 2. Before after image gallery 3. A pricing 4. Testimonials' })
      .expect(200);
    expect(response.body.steps.map((step) => step.family)).toEqual(['hero', 'gallery', 'pricing', 'testimonial']);
    expect(response.body.added).toEqual([{ family: 'cta', reason: 'The page needs somewhere to land.', position: 'end' }]);
    // The server pre-splits the typed lines and shows the model its own work.
    expect(calls[0].userPrompt).toContain('1. Hero');
    expect(calls[0].userPrompt).toContain('Before after image gallery');
  });

  it('answers deterministically when the model is offline', async () => {
    const { provider } = stubProvider([Object.assign(new Error('nope'), { code: 'OLLAMA_NOT_CONFIGURED', status: 503 })]);
    const response = await request(appWith(provider))
      .post('/api/brief/outline')
      .send({ outline: '1. Hero 2. Services 3. Pricing 4. Book a call' })
      .expect(200);
    expect(response.body.source).toBe('deterministic');
    expect(response.body.degraded.code).toBe('OLLAMA_NOT_CONFIGURED');
    expect(response.body.steps.map((step) => step.family)).toEqual(['hero', 'cards', 'pricing', 'contact']);
  });

  it('requires an outline', async () => {
    const { provider } = stubProvider([{}]);
    await request(appWith(provider)).post('/api/brief/outline').send({ outline: '' }).expect(422);
  });
});

describe('brief brain service surface', () => {
  it('exposes provider status without leaking configuration', async () => {
    const { provider } = stubProvider([{}]);
    const response = await request(appWith(provider)).get('/api/brief/status').expect(200);
    expect(response.body).toMatchObject({ provider: 'ollama', model: 'gemma4:31b', available: true });
    expect(JSON.stringify(response.body)).not.toContain('test-key');
  });

  it('rate limits repeated jobs', async () => {
    const { provider } = stubProvider([Object.assign(new Error('down'), { code: 'OLLAMA_UNAVAILABLE', status: 503 })]);
    const app = appWith(provider, testConfig({ maxJobsPerWindow: 2 }));
    await request(app).post('/api/brief/outline').send({ outline: '1. Hero' }).expect(200);
    await request(app).post('/api/brief/outline').send({ outline: '1. Hero' }).expect(200);
    const limited = await request(app).post('/api/brief/outline').send({ outline: '1. Hero' }).expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeTruthy();
  });
});
