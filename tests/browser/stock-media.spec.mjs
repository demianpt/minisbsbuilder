import { expect, test } from '@playwright/test';
import { useAdvancedBuilder } from './support/builder-mode.mjs';

/**
 * Stock imagery, end to end in the real editor.
 *
 * The endpoint is stubbed so no credential or network is needed; what these
 * tests hold to account is everything after the response: that a picture reaches
 * the page and the preview, that no picture is used twice, that a clip renders
 * as a clip, that people sections are left alone, and that the whole thing is
 * one undo step.
 */

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

function asset(index, kind = 'image') {
  const id = `ss-${kind}-${index}`;
  return {
    id,
    assetId: String(1000 + index),
    kind,
    provider: 'shutterstock',
    src: `https://stock.test/${id}.${kind === 'video' ? 'mp4' : 'jpg'}`,
    poster: kind === 'video' ? `https://stock.test/${id}-poster.jpg` : '',
    thumb: `https://stock.test/${id}-thumb.jpg`,
    alt: `${kind} ${index} of the course`,
    width: 1500, height: 1000, aspect: 1.5,
    duration: kind === 'video' ? 12 : null,
    keywords: ['golf'],
    url: `https://www.shutterstock.com/${id}`,
  };
}

const ASSETS = [
  ...Array.from({ length: 10 }, (_, index) => asset(index + 1)),
  ...Array.from({ length: 2 }, (_, index) => asset(index + 1, 'video')),
];

/** Answers the media endpoint by filling the slots the editor actually sent. */
async function stubMedia(page, { fail = null } = {}) {
  await page.route('**/api/brief/**', async (route) => {
    const url = route.request().url();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.endsWith('/status')) {
      return json({
        provider: 'ollama', model: 'gemma4:31b', configured: true, available: true, modelAvailable: true,
        media: { provider: 'shutterstock', configured: !fail, available: !fail, images: 10, videos: 2 },
      });
    }
    if (url.endsWith('/media/asset')) {
      if (fail) return json({ error: { code: fail, message: 'Stock media is unavailable.' } }, 503);
      const requested = String(JSON.parse(route.request().postData()).assetId || '');
      let digits = '';
      try {
        const parsed = new URL(requested);
        digits = parsed.pathname.match(/(?:-|\/)([1-9]\d{5,14})$/)?.[1] || '';
      } catch {
        digits = /^[1-9]\d{5,14}$/.test(requested.trim()) ? requested.trim() : '';
      }
      // The real provider answers on the path asset id and ignores unrelated
      // tracking numbers from the URL query string.
      if (digits !== '2651493041') return json({ error: { code: 'STOCK_ID_NOT_FOUND', message: `Shutterstock has no image or clip with the id ${digits}.` } }, 404);
      return json({
        provider: 'shutterstock',
        licence: 'preview',
        notice: 'Watermarked Shutterstock preview for client review. License it before publishing.',
        asset: { ...asset(99), id: 'ss-image-2651493041', assetId: '2651493041', alt: 'rich bourbon whiskey in a textured glass', src: 'https://stock.test/watermarked-2651493041.jpg', url: 'https://www.shutterstock.com/image-photo/rich-bourbon-whiskey-sits-textured-glass-2651493041' },
      });
    }
    if (url.endsWith('/media')) {
      if (fail) return json({ error: { code: fail, message: 'Stock media is unavailable.' } }, 503);
      const { slots } = JSON.parse(route.request().postData());
      const pool = [...ASSETS];
      const assignments = [];
      // Videos go to the hero background first, exactly as the server does.
      const heroBackground = slots.find((slot) => slot.family === 'hero' && slot.role === 'background');
      if (heroBackground) {
        assignments.push({ slotKey: heroBackground.key, assetId: 'ss-video-1', kind: 'video', reason: 'aerial establishes the course' });
        pool.splice(pool.findIndex((entry) => entry.id === 'ss-video-1'), 1);
      }
      for (const slot of slots) {
        if (assignments.some((entry) => entry.slotKey === slot.key)) continue;
        const next = pool.find((entry) => entry.kind === 'image');
        if (!next) continue;
        pool.splice(pool.indexOf(next), 1);
        assignments.push({ slotKey: slot.key, assetId: next.id, kind: 'image', reason: 'matches the section' });
      }
      return json({
        source: 'ai', degraded: null, model: 'gemma4:31b', provider: 'shutterstock',
        licence: 'preview',
        notice: 'Watermarked Shutterstock previews for client review. License the assets you keep before publishing.',
        queries: { images: 'golf course fairway sunrise', videos: 'golf course aerial drone', avoid: '' },
        assets: ASSETS,
        slots,
        assignments,
        unassigned: slots.slice(assignments.length).map((slot) => slot.key),
      });
    }
    return json({});
  });
}

async function openModules(page) {
  await useAdvancedBuilder(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
  await page.evaluate((brief) => {
    Object.assign(window.__SBS_TEST_API.state.project.brief, brief);
  }, BRIEF);
  await page.locator('[data-step="3"]').click();
  await expect(page.locator('[data-brain-action="find-media"]')).toBeVisible();
}

async function findImagery(page) {
  await page.locator('[data-brain-action="find-media"]').click();
  await expect(page.locator('.brain-asset-grid')).toBeVisible();
}

function projectMedia(page) {
  return page.evaluate(() => {
    const project = window.__SBS_TEST_API.state.project;
    return project.sections.map((section) => ({
      id: section.id,
      family: section.family,
      media: (section.content.media || []).map((entry) => entry && { src: entry.src, kind: entry.kind, provider: entry.provider }),
      items: (section.content.items || []).map((item) => item.media && { src: item.media.src, provider: item.media.provider }),
    }));
  });
}

test.describe('stock imagery in the advanced builder', () => {
  test('places imagery across the page without using one picture twice', async ({ page }) => {
    await stubMedia(page);
    await openModules(page);
    await findImagery(page);

    const sections = await projectMedia(page);
    const used = sections.flatMap((section) => [
      ...section.media.filter((entry) => entry && entry.provider === 'shutterstock').map((entry) => entry.src),
      ...section.items.filter((entry) => entry && entry.provider === 'shutterstock').map((entry) => entry.src),
    ]);
    expect(used.length).toBeGreaterThan(2);
    expect(new Set(used).size).toBe(used.length);
  });

  test('every slot it asks to fill actually renders that picture', async ({ page }) => {
    await stubMedia(page);
    await openModules(page);
    // Every registered pattern, not just the ones the default flow happens to
    // use: a slot the editor claims exists but never renders is a silently
    // wasted asset, and the two media stores are easy to get out of step.
    const mismatches = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      const out = [];
      for (const pattern of api.patterns) {
        const section = api.createSection(pattern.family, 0, pattern.id);
        if (!section || ['team', 'testimonial'].includes(section.family)) continue;
        const patternId = pattern.id;
        const slots = api.media.sectionSlots(section);
        if (!slots.length) continue;
        // Put a unique, findable picture in every slot this pattern claims.
        api.media.fillSlots(section, slots, (slot) => ({ src: `https://probe.test/${slot.key}.jpg`, alt: slot.key, provider: 'shutterstock' }));
        const rendered = JSON.stringify(section.node);
        for (const slot of slots) {
          if (!rendered.includes(`https://probe.test/${slot.key}.jpg`)) out.push(`${patternId} ${slot.key}`);
        }
      }
      return out;
    });
    expect(mismatches).toEqual([]);
  });

  test('leaves team and testimonial portraits on the placeholder library', async ({ page }) => {
    await stubMedia(page);
    await openModules(page);
    await findImagery(page);

    const sections = await projectMedia(page);
    for (const section of sections.filter((entry) => ['team', 'testimonial'].includes(entry.family))) {
      const stock = [...section.media, ...section.items].filter((entry) => entry && entry.provider === 'shutterstock');
      expect(stock).toEqual([]);
    }
  });

  test('renders a clip as a real video in the live preview', async ({ page }) => {
    await stubMedia(page);
    await openModules(page);
    await findImagery(page);

    await expect.poll(() => page.locator('#sitePreview').evaluate((frame) => {
      const video = frame.contentDocument.querySelector('video.c-bg__media, video.ph__video');
      return video ? { src: video.querySelector('source')?.getAttribute('src'), muted: video.muted, loop: video.loop } : null;
    })).toMatchObject({ src: 'https://stock.test/ss-video-1.mp4', muted: true, loop: true });
  });

  test('carries the clip into the WordPress export as a video layer with a poster', async ({ page }) => {
    await stubMedia(page);
    await openModules(page);
    await findImagery(page);

    const layer = await page.evaluate(() => {
      const json = window.__SBS_TEST_API.buildCompleteExport();
      const found = JSON.stringify(json).includes('ss-video-1.mp4');
      const banner = json.concept.page.sections.find((section) => (section.attributes?.backgroundImage || []).some((entry) => entry.kind === 'video'));
      return { found, layer: banner?.attributes.backgroundImage.find((entry) => entry.kind === 'video') || null };
    });
    expect(layer.found).toBe(true);
    expect(layer.layer).toMatchObject({ kind: 'video', mime: 'video/mp4', posterImage: 'https://stock.test/ss-video-1-poster.jpg' });
    expect(layer.layer.desktop.media).toMatchObject({ type: 'video', mime: 'video/mp4' });
  });

  test('is one undo step, and restoring placeholders removes only stock media', async ({ page }) => {
    await stubMedia(page);
    await openModules(page);
    const before = JSON.stringify(await projectMedia(page));
    await findImagery(page);

    await page.keyboard.press('Control+z');
    await expect.poll(async () => JSON.stringify(await projectMedia(page))).toBe(before);

    await findImagery(page);
    await page.locator('[data-brain-action="clear-media"]').click();
    await expect.poll(async () => {
      const sections = await projectMedia(page);
      return sections.flatMap((section) => [...section.media, ...section.items]).filter((entry) => entry && entry.provider === 'shutterstock').length;
    }).toBe(0);
  });

  test('offers the found imagery in the module editor and marks what is already used', async ({ page }) => {
    await stubMedia(page);
    await openModules(page);
    await findImagery(page);

    await page.locator('[data-editor-tab="media"]').click();
    await expect(page.locator('[data-project-media]').first()).toBeVisible();
    await expect(page.locator('.media-fallback summary')).toContainText('Placeholder library');
    expect(await page.locator('[data-project-media].is-used').count()).toBeGreaterThan(0);

    const spare = page.locator('[data-project-media]:not(.is-used):not(.selected)').first();
    const chosen = await spare.getAttribute('data-project-media');
    await spare.click();
    await expect.poll(() => page.evaluate(() => {
      const state = window.__SBS_TEST_API.state;
      const section = state.project.sections.find((entry) => entry.id === state.selectedSectionId);
      return section?.content?.media?.[0]?.src || '';
    })).toContain(chosen.replace('ss-', ''));
  });

  /*
   * A comp is a promise to buy something later. The number that promise is
   * written against has to be on screen, or the page is a set of pictures the
   * client likes and nobody can source.
   */
  test('shows the Shutterstock id and a licence link for every preview', async ({ page }) => {
    await stubMedia(page);
    await openModules(page);
    await findImagery(page);

    const first = page.locator('.brain-asset').first();
    await expect(first.locator('.brain-asset-id')).toHaveText('#1001');
    await expect(first.locator('.brain-asset-buy')).toHaveAttribute('href', 'https://www.shutterstock.com/ss-image-1');
    await expect(first.locator('.brain-asset-buy')).toHaveAttribute('target', '_blank');

    // And on the slot itself, where somebody is actually looking at the picture.
    await page.locator('[data-editor-tab="media"]').click();
    const slot = page.locator('.media-slot').first();
    await expect(slot.locator('.media-slot__id')).toContainText('Shutterstock #');
    await expect(slot.locator('.media-slot__licence-state')).toHaveText('Watermarked preview');
    await expect(slot.locator('.media-slot__licence a')).toHaveAttribute('href', /shutterstock\.com/);
  });

  test('adds one asset by a full Shutterstock URL or id, and says so when the id is wrong', async ({ page }) => {
    await stubMedia(page);
    await openModules(page);

    // Deliberately before any search: somebody who already knows the shot they
    // want should not have to run the search job first.
    const input = page.locator('[data-brain-field="assetIdQuery"]');
    await input.fill('https://www.shutterstock.com/image-photo/rich-bourbon-whiskey-sits-textured-glass-2651493041?trackingId=319f137c-406e-4195-b835-f8f71c6aebc3&listId=searchResults');
    await page.locator('[data-brain-action="add-media-asset"]').click();

    await expect.poll(() => page.evaluate(() => (window.__SBS_TEST_API.state.project.media.assets || []).map((entry) => entry.assetId)))
      .toContain('2651493041');
    // The pool is what the module pickers read, so it has to be pickable there.
    await page.locator('[data-editor-tab="media"]').click();
    await expect(page.locator('[data-project-media="ss-image-2651493041"]').first()).toBeVisible();

    await page.locator('[data-step="3"]').click();
    await page.locator('[data-brain-field="assetIdQuery"]').fill('123456');
    await page.locator('[data-brain-action="add-media-asset"]').click();
    await expect(page.locator('.brain-asset-add .brain-error')).toContainText('no image or clip with that id');
  });

  test('says so plainly when stock media is not configured', async ({ page }) => {
    await stubMedia(page, { fail: 'STOCK_NOT_CONFIGURED' });
    await openModules(page);
    await expect(page.locator('.brain-hint.is-warn')).toContainText('not configured');
    await expect(page.locator('[data-brain-action="find-media"]')).toBeDisabled();
  });
});

test.describe('stock imagery in the simple builder', () => {
  test('is available on the simple builder’s modules step too', async ({ page }) => {
    await stubMedia(page);
    await useAdvancedBuilder(page);
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
    await page.evaluate((brief) => {
      const api = window.__SBS_TEST_API;
      Object.assign(api.state.project.brief, brief);
      // Step 01 will not release the strategist until a concept is chosen, so
      // stand one up rather than driving the whole concepts flow again here.
      const simple = api.simple.ensure();
      simple.briefText = `${brief.industry}. ${brief.goal}.`;
      simple.concepts = api.simple.normalizeConcepts([
        { name: 'Course first', archetypeKey: 'A', preset: 'editorial', buttonStyle: 'solid-shift', dialOverrides: {}, why: 'Wide landscape.' },
      ]);
      simple.active = 0;
      api.simple.setMode('simple', { force: true });
    }, BRIEF);
    await page.locator('[data-step="2"]').click();
    await expect(page.locator('[data-brain-action="find-media"]')).toBeVisible();

    await findImagery(page);
    const used = (await projectMedia(page)).flatMap((section) => [...section.media, ...section.items])
      .filter((entry) => entry && entry.provider === 'shutterstock');
    expect(used.length).toBeGreaterThan(0);
  });
});
