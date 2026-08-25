import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp, createBriefServices } from '../../server/index.mjs';
import { createConfig } from '../../server/config.mjs';
import { createShutterstockProvider } from '../../server/media/shutterstock-provider.mjs';

const BRIEF = {
  projectName: 'Fairwood Golf',
  clientName: 'Fairwood Golf',
  industry: 'A championship golf course and clubhouse in Surrey',
  audience: 'Members, visiting golfers and corporate day organisers',
  goal: 'Get a visitor to book a tee time',
  offer: 'Membership, visitor rounds and corporate days',
  tone: 'Calm, precise, understated',
  keywords: 'fairway, greens, clubhouse',
  notes: '',
};

const SLOTS = [
  { key: 's1:background:0', sectionId: 's1', family: 'hero', role: 'background', index: 0, label: 'Play the course', allowsVideo: true },
  { key: 's2:feature:0', sectionId: 's2', family: 'split', role: 'feature', index: 0, label: 'The course', allowsVideo: true },
  { key: 's3:card:0', sectionId: 's3', family: 'cards', role: 'card', index: 0, label: 'Membership', allowsVideo: true },
  { key: 's3:card:1', sectionId: 's3', family: 'cards', role: 'card', index: 1, label: 'Visitors', allowsVideo: true },
  // People never reach the stock search, whichever builder sent them.
  { key: 's4:card:0', sectionId: 's4', family: 'testimonial', role: 'card', index: 0, label: 'Members say', allowsVideo: false },
];

function testConfig(overrides = {}) {
  return {
    ...createConfig({ NODE_ENV: 'test', OLLAMA_API_KEY: 'test-key', SHUTTERSTOCK_API_TOKEN: 'v2/test-token' }),
    ...overrides,
  };
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

function stockAsset(id, kind = 'image') {
  return {
    id, assetId: id.replace(/\D+/g, ''), kind, provider: 'shutterstock', licensed: false,
    src: `https://image.shutterstock.com/${id}.${kind === 'video' ? 'mp4' : 'jpg'}`,
    poster: kind === 'video' ? `https://image.shutterstock.com/${id}.jpg` : '',
    thumb: `https://image.shutterstock.com/${id}-thumb.jpg`,
    alt: `${kind} ${id}`, width: 1500, height: 1000, aspect: 1.5, duration: kind === 'video' ? 12 : null,
    keywords: ['golf'], url: `https://www.shutterstock.com/${id}`,
  };
}

function stubStock({ images = 10, videos = 2 } = {}) {
  const calls = [];
  return {
    calls,
    stock: {
      kind: 'shutterstock',
      configured: true,
      async status() { return { provider: 'shutterstock', configured: true, available: true, auth: 'token' }; },
      async searchImages({ query, count }) {
        calls.push({ type: 'images', query, count });
        return Array.from({ length: Math.min(images, count) }, (_, index) => stockAsset(`ss-image-${index + 1}`));
      },
      async searchVideos({ query, count }) {
        calls.push({ type: 'videos', query, count });
        return Array.from({ length: Math.min(videos, count) }, (_, index) => stockAsset(`ss-video-${index + 1}`, 'video'));
      },
    },
  };
}

function appWith({ provider, stock, config = testConfig() }) {
  return createApp({ services: createBriefServices({ config, provider, stock, logger: { info() {}, warn() {} } }) });
}

const QUERIES = { images: 'golf course fairway sunrise', videos: 'golf course aerial drone', avoid: '' };

describe('POST /api/brief/media', () => {
  it('searches for the brief and places one asset in every slot, never twice', async () => {
    const { provider, calls } = stubProvider([QUERIES, { assignments: [] }]);
    const { stock, calls: stockCalls } = stubStock();
    const response = await request(appWith({ provider, stock }))
      .post('/api/brief/media')
      .send({ brief: BRIEF, slots: SLOTS })
      .expect(200);

    expect(response.body.queries.images).toBe(QUERIES.images);
    expect(stockCalls.map((entry) => entry.type)).toEqual(['images', 'videos']);
    expect(response.body.assets).toHaveLength(12);

    const assigned = response.body.assignments.map((entry) => entry.assetId);
    expect(new Set(assigned).size).toBe(assigned.length);
    // The testimonial slot is a person, so it is not a stock slot at all.
    expect(response.body.assignments.map((entry) => entry.slotKey)).not.toContain('s4:card:0');
    expect(response.body.slots.map((slot) => slot.key)).toEqual(['s1:background:0', 's2:feature:0', 's3:card:0', 's3:card:1']);
    expect(calls).toHaveLength(2);
  });

  it('gives the hero its video and says the assets are previews', async () => {
    const { provider } = stubProvider([QUERIES, { assignments: [] }]);
    const { stock } = stubStock();
    const response = await request(appWith({ provider, stock }))
      .post('/api/brief/media')
      .send({ brief: BRIEF, slots: SLOTS })
      .expect(200);

    const hero = response.body.assignments.find((entry) => entry.slotKey === 's1:background:0');
    expect(hero.kind).toBe('video');
    expect(response.body.licence).toBe('preview');
    expect(response.body.notice).toMatch(/watermarked/i);
  });

  it('honours the model’s placement but still refuses a repeat', async () => {
    const { provider } = stubProvider([
      QUERIES,
      {
        assignments: [
          { slot: 's3:card:0', asset: 'ss-image-4', reason: 'membership' },
          { slot: 's3:card:1', asset: 'ss-image-4', reason: 'visitors' },
        ],
      },
    ]);
    const { stock } = stubStock();
    const response = await request(appWith({ provider, stock }))
      .post('/api/brief/media')
      .send({ brief: BRIEF, slots: SLOTS })
      .expect(200);

    expect(response.body.assignments.find((entry) => entry.slotKey === 's3:card:0').assetId).toBe('ss-image-4');
    const assigned = response.body.assignments.map((entry) => entry.assetId);
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it('falls back to slot order when the model is unavailable, and says so', async () => {
    const failure = Object.assign(new Error('unreachable'), { code: 'OLLAMA_UNAVAILABLE' });
    const { provider } = stubProvider([failure]);
    const { stock, calls: stockCalls } = stubStock();
    const response = await request(appWith({ provider, stock }))
      .post('/api/brief/media')
      .send({ brief: BRIEF, slots: SLOTS })
      .expect(200);

    expect(response.body.source).toBe('deterministic');
    expect(response.body.degraded.code).toBe('OLLAMA_UNAVAILABLE');
    // The deterministic phrase still has to be a real search.
    expect(stockCalls[0].query.length).toBeGreaterThan(2);
    expect(response.body.assignments.length).toBe(4);
  });

  it('widens an over-specific phrase instead of returning nothing', async () => {
    // A stock library ANDs the words: one adjective too many is an empty page,
    // not a looser match. This is the single most common way the job fails.
    const { provider } = stubProvider([{ images: 'golf course fairway sunrise', videos: 'golf course aerial drone', avoid: '' }, { assignments: [] }]);
    const tried = [];
    const stock = {
      configured: true,
      async status() { return { configured: true, available: true }; },
      async searchImages({ query, count }) {
        tried.push(query);
        return query.split(' ').length > 3 ? [] : Array.from({ length: count }, (_, index) => stockAsset(`ss-image-${index + 1}`));
      },
      async searchVideos({ query, count }) {
        return Array.from({ length: count }, (_, index) => stockAsset(`ss-video-${index + 1}`, 'video'));
      },
    };
    const response = await request(appWith({ provider, stock }))
      .post('/api/brief/media')
      .send({ brief: BRIEF, slots: SLOTS })
      .expect(200);

    expect(tried).toEqual(['golf course fairway sunrise', 'golf course fairway']);
    expect(response.body.assets.length).toBeGreaterThan(0);
    // The editor says which phrase actually answered rather than pretending.
    expect(response.body.queries.images).toBe('golf course fairway');
    expect(response.body.queries.requested.images).toBe('golf course fairway sunrise');
    expect(response.body.queries.broadened).toBe(true);
  });

  it('stops widening at two words rather than searching for one vague noun', async () => {
    const { provider } = stubProvider([{ images: 'aaaa bbbb cccc', videos: 'aaaa aerial', avoid: '' }, { assignments: [] }]);
    const tried = [];
    const stock = {
      configured: true,
      async status() { return { configured: true, available: true }; },
      async searchImages({ query }) { tried.push(query); return []; },
      async searchVideos() { return []; },
    };
    const response = await request(appWith({ provider, stock }))
      .post('/api/brief/media')
      .send({ brief: BRIEF, slots: SLOTS })
      .expect(422);
    expect(tried).toEqual(['aaaa bbbb cccc', 'aaaa bbbb']);
    expect(response.body.error.code).toBe('STOCK_EMPTY');
    expect(response.body.error.message).toMatch(/plainly/i);
  });

  it('reports an empty library rather than inventing imagery', async () => {
    const { provider } = stubProvider([QUERIES, { assignments: [] }]);
    const { stock } = stubStock({ images: 0, videos: 0 });
    const response = await request(appWith({ provider, stock }))
      .post('/api/brief/media')
      .send({ brief: BRIEF, slots: SLOTS })
      .expect(422);
    expect(response.body.error.code).toBe('STOCK_EMPTY');
  });

  it('rejects a page with no stock slots', async () => {
    const { provider } = stubProvider([QUERIES]);
    const { stock } = stubStock();
    const response = await request(appWith({ provider, stock }))
      .post('/api/brief/media')
      .send({ brief: BRIEF, slots: [SLOTS[4]] })
      .expect(422);
    expect(response.body.error.code).toBe('SLOTS_REQUIRED');
  });

  it('refuses the job when no stock credential is configured', async () => {
    const { provider } = stubProvider([QUERIES]);
    const config = testConfig({ shutterstockApiToken: '', shutterstockClientId: '', shutterstockClientSecret: '' });
    const response = await request(createApp({
      services: createBriefServices({ config, provider, logger: { info() {}, warn() {} } }),
    }))
      .post('/api/brief/media')
      .send({ brief: BRIEF, slots: SLOTS })
      .expect(503);
    expect(response.body.error.code).toBe('STOCK_NOT_CONFIGURED');
  });

  it('works from the simple builder’s paragraph alone', async () => {
    const { provider, calls } = stubProvider([QUERIES, { assignments: [] }]);
    const { stock } = stubStock();
    await request(appWith({ provider, stock }))
      .post('/api/brief/media')
      .send({
        briefText: 'Fairwood Golf is a championship golf course and clubhouse in Surrey. We want visiting golfers to book a tee time online.',
        slots: SLOTS,
      })
      .expect(200);
    expect(calls[0].userPrompt).toMatch(/golf/i);
  });
});

describe('POST /api/brief/media/asset', () => {
  /*
   * The search job is a good editor and a poor mind reader. Somebody who has
   * already been through Shutterstock and found the exact shot pastes its number
   * instead of describing it back to a model and hoping.
   */
  function stubStockWithLookup(asset) {
    const calls = [];
    return {
      calls,
      stock: {
        kind: 'shutterstock',
        configured: true,
        async status() { return { provider: 'shutterstock', configured: true, available: true, auth: 'token' }; },
        async searchImages() { return []; },
        async searchVideos() { return []; },
        async assetById({ id }) {
          calls.push(id);
          if (asset instanceof Error) throw asset;
          return asset;
        },
      },
    };
  }

  it('returns one watermarked preview for an id', async () => {
    const { provider } = stubProvider([QUERIES]);
    const { stock, calls } = stubStockWithLookup(stockAsset('ss-image-2158734125'));
    const response = await request(appWith({ provider, stock }))
      .post('/api/brief/media/asset')
      .send({ assetId: '2158734125' })
      .expect(200);

    expect(calls).toEqual(['2158734125']);
    expect(response.body.asset).toMatchObject({ id: 'ss-image-2158734125', kind: 'image', provider: 'shutterstock' });
    // Still a comp. This endpoint must never look like a licensing call.
    expect(response.body.licence).toBe('preview');
    expect(response.body.notice).toMatch(/watermarked/i);
  });

  it('passes an unknown id back as a plain 404, not a 500', async () => {
    const { provider } = stubProvider([QUERIES]);
    const error = Object.assign(new Error('Shutterstock has no image or clip with the id 1.'), { code: 'STOCK_ID_NOT_FOUND', status: 404 });
    const { stock } = stubStockWithLookup(error);
    const response = await request(appWith({ provider, stock }))
      .post('/api/brief/media/asset')
      .send({ assetId: '1' })
      .expect(404);
    expect(response.body.error.code).toBe('STOCK_ID_NOT_FOUND');
    expect(response.body.error.message).toMatch(/no image or clip/);
  });

  it('says so when stock media is not configured at all', async () => {
    const { provider } = stubProvider([QUERIES]);
    const response = await request(appWith({ provider, stock: { configured: false } }))
      .post('/api/brief/media/asset')
      .send({ assetId: '2158734125' })
      .expect(503);
    expect(response.body.error.code).toBe('STOCK_NOT_CONFIGURED');
  });
});

describe('the stock provider', () => {
  it('sends the credential as a bearer token and normalises previews', async () => {
    const fetchImpl = vi.fn(async (url) => ({
      ok: true,
      async json() {
        return url.includes('/videos/search')
          ? { data: [{ id: '77', description: 'Aerial over the fairway', duration: 14, assets: { preview_mp4: { url: 'https://cdn.test/77.mp4', width: 640, height: 360 }, thumb_jpgs: { urls: ['https://cdn.test/77.jpg'] } } }] }
          : { data: [{ id: '42', description: 'Fairway at sunrise', aspect: 1.5, keywords: ['golf', 'course'], assets: { preview_1500: { url: 'https://cdn.test/42.jpg', width: 1500, height: 1000 }, large_thumb: { url: 'https://cdn.test/42-thumb.jpg' } } }] };
      },
    }));
    const stock = createShutterstockProvider({ config: testConfig(), fetchImpl });

    const [image] = await stock.searchImages({ query: 'golf course', count: 3 });
    expect(image).toMatchObject({ id: 'ss-image-42', kind: 'image', src: 'https://cdn.test/42.jpg', alt: 'Fairway at sunrise' });

    const [video] = await stock.searchVideos({ query: 'golf aerial', count: 2 });
    // A background clip with no poster is a hole in the page until it buffers.
    expect(video).toMatchObject({ id: 'ss-video-77', kind: 'video', src: 'https://cdn.test/77.mp4', poster: 'https://cdn.test/77.jpg' });

    const [requestUrl, init] = fetchImpl.mock.calls[0];
    expect(init.headers.authorization).toBe('Bearer v2/test-token');
    expect(requestUrl).toContain('per_page=3');
    expect(requestUrl).toContain('safe=true');
  });

  it('falls back to basic auth when only client credentials are set', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, async json() { return { data: [] }; } }));
    const config = testConfig({ shutterstockApiToken: '', shutterstockClientId: 'id', shutterstockClientSecret: 'secret' });
    await createShutterstockProvider({ config, fetchImpl }).searchImages({ query: 'golf' });
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe(`Basic ${Buffer.from('id:secret').toString('base64')}`);
  });

  it('turns a rejected credential into a plain error, not a crash', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401, async json() { return {}; } }));
    const stock = createShutterstockProvider({ config: testConfig(), fetchImpl });
    // Its own code: this is the one case where "check the credentials" is the
    // right advice, and it must not be given for the other two.
    await expect(stock.searchImages({ query: 'golf' })).rejects.toMatchObject({ code: 'STOCK_DENIED' });
    expect(await stock.status()).toMatchObject({ configured: true, available: false, auth: 'token' });
  });

  /*
   * A spent quota used to arrive as STOCK_UNAVAILABLE, and the browser's message
   * for that code told the reader to check the credentials and the connection —
   * the two things that are demonstrably fine when the body says
   * `remaining: 0`. It cost real time to diagnose during a demo.
   */
  it('reports a spent quota as a rate limit, with the hour it resets', async () => {
    const reset = Date.UTC(2026, 7, 20, 16, 0, 0);
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 429,
      async json() { return { message: 'Too many requests', limit: 100, remaining: 0, reset }; },
    }));
    const stock = createShutterstockProvider({ config: testConfig(), fetchImpl });
    const failure = await stock.searchImages({ query: 'golf' }).catch((error) => error);
    expect(failure.code).toBe('STOCK_RATE_LIMITED');
    // 429, not 503: the payload replaces the text of anything 500 and over, and
    // a quota with its reset time is not a provider internal.
    expect(failure.status).toBe(429);
    expect(failure.message).toContain('100 per hour');
    expect(failure.details).toMatchObject({ limit: 100, remaining: 0, reset });

    // Throttled is not broken. Saying "unavailable" makes the editor claim the
    // stock library is not set up, which is a different and wrong story.
    expect(await stock.status()).toMatchObject({ configured: true, available: true, throttled: true, resetsAt: reset });
  });

  /*
   * The status endpoint is polled on every page load. Each poll used to spend
   * one of the account's hundred hourly requests, so a morning of reloads could
   * exhaust the quota before anybody asked for a photograph — and the resulting
   * 429 was then reported as "check the credentials".
   */
  it('does not spend a request on every status poll', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, async json() { return { data: [] }; } }));
    const stock = createShutterstockProvider({ config: testConfig(), fetchImpl });
    expect(await stock.status()).toMatchObject({ available: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    for (let poll = 0; poll < 20; poll += 1) await stock.status();
    expect(fetchImpl, 'twenty polls should not be twenty searches').toHaveBeenCalledTimes(1);
    expect(await stock.status()).toMatchObject({ available: true, cached: true });
    // A real search is never served from that cache.
    await stock.searchImages({ query: 'golf' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('stops probing a spent quota until it resets', async () => {
    const reset = Date.now() + 30 * 60 * 1000;
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 429,
      async json() { return { limit: 100, remaining: 0, reset }; },
    }));
    const stock = createShutterstockProvider({ config: testConfig(), fetchImpl });
    expect(await stock.status()).toMatchObject({ throttled: true, resetsAt: reset });
    for (let poll = 0; poll < 10; poll += 1) await stock.status();
    expect(fetchImpl, 'a spent quota cannot tell us anything new until it resets').toHaveBeenCalledTimes(1);
  });

  it('never searches without a credential', async () => {
    const fetchImpl = vi.fn();
    const config = testConfig({ shutterstockApiToken: '', shutterstockClientId: '', shutterstockClientSecret: '' });
    const stock = createShutterstockProvider({ config, fetchImpl });
    expect(stock.configured).toBe(false);
    await expect(stock.searchImages({ query: 'golf' })).rejects.toMatchObject({ code: 'STOCK_NOT_CONFIGURED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('looks an asset up by id in both catalogues and accepts a pasted URL', async () => {
    const fetchImpl = vi.fn(async (url) => ({
      ok: true,
      status: 200,
      async json() {
        // Only the video catalogue knows this id; the image one 404s.
        return url.includes('/videos/')
          ? { id: '2158734125', description: 'The clubhouse at dusk', duration: 9, assets: { preview_mp4: { url: 'https://cdn.test/2158734125.mp4' }, thumb_jpgs: { urls: ['https://cdn.test/2158734125.jpg'] } } }
          : null;
      },
    }));
    const stock = createShutterstockProvider({ config: testConfig(), fetchImpl });
    const asset = await stock.assetById({ id: 'https://www.shutterstock.com/video/clip-2158734125' });
    expect(asset).toMatchObject({ id: 'ss-video-2158734125', assetId: '2158734125', kind: 'video', src: 'https://cdn.test/2158734125.mp4' });
    // Both catalogues, because the id alone does not say which one it is in.
    expect(fetchImpl.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(['/v2/images/2158734125', '/v2/videos/2158734125']);
  });

  it('accepts a full Shutterstock image URL with unrelated numeric tracking values', async () => {
    const fetchImpl = vi.fn(async (url) => ({
      ok: true,
      status: 200,
      async json() {
        return { id: '2651493041', description: 'Bourbon in a textured glass', aspect: 1.5, assets: { preview_1500: { url: 'https://cdn.test/watermarked-2651493041.jpg', width: 1500, height: 1000 } } };
      },
    }));
    const stock = createShutterstockProvider({ config: testConfig(), fetchImpl });
    const asset = await stock.assetById({ id: 'https://www.shutterstock.com/image-photo/rich-bourbon-whiskey-sits-textured-glass-2651493041?trackingId=319f137c-406e-4195-b835-f8f71c6aebc3&listId=searchResults' });
    expect(asset).toMatchObject({ assetId: '2651493041', kind: 'image', src: 'https://cdn.test/watermarked-2651493041.jpg' });
    expect(new URL(fetchImpl.mock.calls[0][0]).pathname).toBe('/v2/images/2651493041');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refuses something that is not an id, before spending a request', async () => {
    const fetchImpl = vi.fn();
    const stock = createShutterstockProvider({ config: testConfig(), fetchImpl });
    await expect(stock.assetById({ id: 'the one with the boats' })).rejects.toMatchObject({ code: 'STOCK_ID_INVALID', status: 422 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports an id neither catalogue has as not found', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404, async json() { return {}; } }));
    const stock = createShutterstockProvider({ config: testConfig(), fetchImpl });
    await expect(stock.assetById({ id: '999999' })).rejects.toMatchObject({ code: 'STOCK_ID_NOT_FOUND', status: 404 });
  });
});
