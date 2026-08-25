import { expect, test } from '@playwright/test';
import { useAdvancedBuilder } from './support/builder-mode.mjs';

/**
 * The working state.
 *
 * Every AI job here is a network round trip of a few seconds. Without a cue the
 * editor reads as broken rather than busy, so these tests hold the cue to
 * account on the two jobs that live in different state slices — and check that
 * it clears afterwards, because a loader that never leaves is worse than none.
 */

const BRIEF = {
  projectName: 'Fairwood Golf',
  clientName: 'Fairwood Golf',
  industry: 'A championship golf course and clubhouse in Surrey',
  audience: 'Members and visiting golfers',
  goal: 'Get a visitor to book a tee time',
  offer: 'Membership and visitor rounds',
  tone: 'Calm and precise',
  keywords: 'fairway, greens',
  notes: '',
};

async function stub(page, { delayMs = 0 } = {}) {
  await page.route('**/api/brief/**', async (route) => {
    const url = route.request().url();
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.endsWith('/status')) {
      return json({
        provider: 'ollama', model: 'gemma4:31b', configured: true, available: true, modelAvailable: true,
        media: { provider: 'shutterstock', configured: true, available: true, images: 10, videos: 2 },
      });
    }
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (url.endsWith('/media')) {
      const { slots } = JSON.parse(route.request().postData());
      return json({
        source: 'ai', model: 'gemma4:31b', provider: 'shutterstock', licence: 'preview', notice: 'Watermarked previews.',
        queries: { images: 'golf course', videos: 'golf aerial' }, assets: [], slots, assignments: [], unassigned: [],
      });
    }
    if (url.endsWith('/concepts')) {
      return json({
        source: 'ai', degraded: null, model: 'gemma4:31b', confidence: 0.9, missingFields: [],
        readback: { business: 'A golf course.', audience: 'Visitors.', offer: 'Rounds.', goal: 'Book a tee time.', voice: 'Calm.' },
        fields: { industry: 'A championship golf course in Surrey', audience: 'Visiting golfers', goal: 'Book a tee time', offer: 'Visitor rounds', tone: 'Calm', keywords: 'fairway', clientName: 'Fairwood Golf' },
        concepts: [
          { name: 'Course first', archetypeKey: 'A', preset: 'editorial', buttonStyle: 'solid-shift', dialOverrides: {}, why: 'Wide landscape.' },
          { name: 'Members first', archetypeKey: 'C', preset: 'confident', buttonStyle: 'sweep-fill', dialOverrides: {}, why: 'Proof early.' },
          { name: 'Bold', archetypeKey: 'F', preset: 'expressive', buttonStyle: 'pill-glow', dialOverrides: {}, why: 'Statement.' },
        ],
        flows: [{ id: 'B3', reason: 'Proof first.', fit: 0.9 }],
      });
    }
    if (url.endsWith('/content')) {
      const families = JSON.parse(route.request().postData()).families;
      return json({
        source: 'ai', degraded: null, model: 'gemma4:31b', families,
        sections: families.map((family) => ({ family, pretitle: '', title: `Copy for ${family}`, subtitle: '', body: '', items: [], buttons: [] })),
      });
    }
    if (url.endsWith('/understand')) {
      return json({
        source: 'ai', degraded: null, model: 'gemma4:31b', archetypeName: 'Editorial',
        readback: { business: 'A golf course.', audience: 'Visitors.', offer: 'Rounds.', goal: 'Book a tee time.', voice: 'Calm.' },
        confidence: 0.9, missingFields: [], keywords: ['fairway'], signals: [],
        archetype: { key: 'A', reason: 'Understated.' },
        flows: [{ id: 'B3', reason: 'Proof first.', fit: 0.9 }],
      });
    }
    return json({});
  });
}

async function open(page, step) {
  await useAdvancedBuilder(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
  await page.evaluate((brief) => Object.assign(window.__SBS_TEST_API.state.project.brief, brief), BRIEF);
  await page.locator(`[data-step="${step}"]`).click();
}

test.describe('the working cue', () => {
  test('marks the panel that is actually thinking, and clears when it settles', async ({ page }) => {
    await stub(page, { delayMs: 2500 });
    await open(page, 3);
    await page.locator('[data-brain-action="find-media"]').click();

    const panel = page.locator('.brain-panel.is-thinking');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.brain-thinking')).toContainText('Searching the stock library');
    // Disabled controls need a reason on screen, not just a dead button.
    await expect(page.locator('[data-brain-action="find-media"]')).toBeDisabled();

    await expect(page.locator('.brain-panel.is-thinking')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator('.brain-thinking')).toHaveCount(0);
    await expect(page.locator('[data-brain-action="find-media"]')).toBeEnabled();
  });

  test('animates rather than sitting still', async ({ page }) => {
    await stub(page, { delayMs: 2500 });
    await open(page, 3);
    await page.locator('[data-brain-action="find-media"]').click();
    await expect(page.locator('.brain-panel.is-thinking')).toBeVisible();

    expect(await page.evaluate(() => {
      const orb = document.querySelector('.brain-thinking-orb');
      const panel = document.querySelector('.brain-panel.is-thinking');
      return {
        orbit: getComputedStyle(orb).animationName,
        dot: getComputedStyle(orb.querySelector('i'), '::before').animationName,
        sweep: getComputedStyle(panel, '::before').animationName,
      };
    })).toEqual({ orbit: 'brain-spin', dot: 'brain-breathe', sweep: 'brain-sweep' });
  });

  test('covers the brief reader too, not just the newest job', async ({ page }) => {
    await stub(page, { delayMs: 2500 });
    await open(page, 0);
    await page.locator('[data-brain-action="understand"]').click();
    await expect(page.locator('.brain-panel.is-thinking .brain-thinking')).toContainText('Reading the brief');
    await expect(page.locator('.brain-panel.is-thinking')).toHaveCount(0, { timeout: 15_000 });
  });

  test('a reload never leaves a panel stuck as busy', async ({ page }) => {
    await stub(page);
    await open(page, 3);
    // Persist a busy status the way an interrupted session would have.
    await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      api.state.project.media = { ...(api.state.project.media || {}), status: 'searching', liveMessage: 'Searching…' };
      localStorage.setItem('sbs-dst-page-builder-v2', JSON.stringify({ project: api.state.project, currentStep: 3 }));
    });
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
    await page.locator('[data-step="3"]').click();
    await expect(page.locator('.brain-panel.is-thinking')).toHaveCount(0);
    await expect(page.locator('[data-brain-action="find-media"]')).toBeEnabled();
  });
});

test.describe('where the AI panels sit, and what they say while they work', () => {
  test('advanced builder', async ({ page }) => {
    await stub(page);
    await open(page, 3);
    const first = await page.locator('#editorInner section.brain-panel, #editorInner section.panel').first();
    await expect(first).toHaveClass(/brain-panel/);
    await expect(first).toContainText('Find imagery for this brief');
  });

  test('simple builder, the imagery library is the first panel on the modules step', async ({ page }) => {
    await stub(page);
    await useAdvancedBuilder(page);
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
    await page.evaluate((brief) => {
      const api = window.__SBS_TEST_API;
      Object.assign(api.state.project.brief, brief);
      const simple = api.simple.ensure();
      simple.briefText = `${brief.industry}. ${brief.goal}.`;
      simple.concepts = api.simple.normalizeConcepts([{ name: 'Course first', archetypeKey: 'A', preset: 'editorial', buttonStyle: 'solid-shift', dialOverrides: {}, why: 'Wide landscape.' }]);
      simple.active = 0;
      api.simple.setMode('simple', { force: true });
    }, BRIEF);
    await page.locator('[data-step="2"]').click();

    // The copywriter panel used to sit above this one. Step 01's one button now
    // writes and applies the copy, so this step is the imagery library and the
    // modules, and nothing else.
    const headings = await page.locator('#editorInner section.brain-panel h2, #editorInner section.panel .panel-head h2').allInnerTexts();
    expect(headings[0]).toBe('Find imagery for this brief');
    expect(headings).not.toContain('Fill the page with real copy');
  });

  /**
   * Four jobs behind one press is most of a minute of waiting. Which one is
   * running has to be on screen, or it reads as a hang.
   */
  test('the one button names the job it is on, and ticks off the ones it finished', async ({ page }) => {
    await stub(page, { delayMs: 900 });
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
    await page.locator('#simple-brief').fill('A championship golf course in Surrey that needs visiting golfers to book a tee time online. Calm, precise and understated.');
    await page.locator('[data-brain-action="build-concepts"]').click();

    const stages = page.locator('.brain-stages li');
    await expect(stages).toHaveCount(4);
    await expect(stages.nth(0)).toHaveClass(/is-live/);
    await expect(page.locator('[data-brain-action="build-concepts"]')).toContainText('Reading the brief');

    // The copy is next, and the brief is now ticked rather than merely past.
    await expect(stages.nth(1)).toHaveClass(/is-live/, { timeout: 15_000 });
    await expect(stages.nth(0)).toHaveClass(/is-done/);
    await expect(page.locator('[data-brain-action="build-concepts"]')).toContainText('Writing the copy');
    await expect(stages.nth(2)).toHaveClass(/is-live/, { timeout: 15_000 });
    await expect(page.locator('[data-brain-action="build-concepts"]')).toContainText('Finding imagery');

    // And when it is over the list goes away and the counts take its place.
    await expect(page.locator('.brain-stages')).toHaveCount(0, { timeout: 25_000 });
    await expect(page.locator('.brain-report')).toContainText('concepts designed');
  });
});
