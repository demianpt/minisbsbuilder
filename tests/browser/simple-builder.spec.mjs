import { expect, test } from '@playwright/test';
import { useAdvancedBuilder } from './support/builder-mode.mjs';
import { previewSettled } from './support/preview.mjs';

/**
 * The simple builder: four steps, one paragraph, three concepts.
 *
 * The concept endpoint is stubbed so these tests describe the product contract
 * rather than the model's mood. The one thing every test here ultimately guards
 * is that a concept is *only* a design: switching V1/V2/V3 at any step must
 * never disturb content, flow or module work.
 */

const BRIEF_TEXT = `Harbour Dental is a family dental practice in Portsmouth offering routine, cosmetic and emergency care. Our audience is local families and nervous adult patients who have avoided the dentist for years. We want them to book their first appointment online. We offer gentle, judgement-free dentistry with same-week emergency appointments and clear fixed pricing. The tone should be calm, plain and reassuring.`;

const CONCEPT_SET = {
  source: 'ai',
  degraded: null,
  model: 'gemma4:31b',
  briefText: BRIEF_TEXT,
  confidence: 0.9,
  missingFields: [],
  readback: {
    business: 'A family dental practice in Portsmouth.',
    audience: 'Local families and nervous adult patients.',
    offer: 'Gentle dentistry with fixed pricing.',
    goal: 'Book a first appointment online.',
    voice: 'Calm, plain and reassuring.',
  },
  fields: {
    industry: 'Family dental practice in Portsmouth offering routine, cosmetic and emergency care.',
    audience: 'Local families and nervous adult patients who have avoided the dentist for years.',
    goal: 'Book a first appointment online.',
    offer: 'Gentle, judgement-free dentistry with same-week emergency appointments.',
    tone: 'Calm, plain and reassuring.',
    keywords: 'gentle care, fixed pricing',
    clientName: 'Harbour Dental',
  },
  concepts: [
    { slot: 'V1', name: 'Clean and professional', archetypeKey: 'D', archetypeName: 'Clean / Utility SaaS', preset: 'calm', buttonStyle: 'solid-shift', dialOverrides: { motion: 18 }, why: 'The brief asks for plain and reassuring.' },
    { slot: 'V2', name: 'Warm and welcoming', archetypeKey: 'C', archetypeName: 'Warm / Human Modern', preset: 'friendly', buttonStyle: 'pill-glow', dialOverrides: { corner: 80 }, why: 'A family practice reads best warm.' },
    { slot: 'V3', name: 'Editorial and considered', archetypeKey: 'A', archetypeName: 'Editorial Authority', preset: 'editorial', buttonStyle: 'offset-block', dialOverrides: {}, why: 'Authority reassures nervous patients.' },
  ],
  flows: [
    { id: 'B2', reason: 'Trust before the ask suits a nervous audience.', fit: 0.94 },
    { id: 'C3', reason: 'Lead capture puts the booking path first.', fit: 0.82 },
    { id: 'B1', reason: 'Testimonials reduce fear.', fit: 0.71 },
    { id: 'E2', reason: 'A richer service conversion journey adds more supporting modules.', fit: 0.63 },
    { id: 'E4', reason: 'Authority plus resources adds a different content rhythm.', fit: 0.57 },
  ],
};

async function stubBrain(page, overrides = {}) {
  await page.route('**/api/brief/**', async (route) => {
    const url = route.request().url();
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.endsWith('/status')) {
      return json({
        provider: 'ollama', model: 'gemma4:31b', configured: true, available: true, modelAvailable: true,
        // Stock imagery is a separately configured service, and most servers do
        // not have it. Off by default here for the same reason.
        media: { provider: 'shutterstock', configured: Boolean(overrides.stock), available: Boolean(overrides.stock), images: 10, videos: 2 },
      });
    }
    if (url.endsWith('/media')) {
      if (overrides.mediaError) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: overrides.mediaError }) });
      const { slots } = JSON.parse(route.request().postData());
      const assets = slots.map((slot, index) => ({
        id: `ss-${index + 1}`, assetId: String(2_000 + index), kind: 'image', provider: 'shutterstock',
        src: `https://stock.test/ss-${index + 1}.jpg`, thumb: `https://stock.test/ss-${index + 1}-thumb.jpg`,
        alt: `picture ${index + 1} of the practice`, width: 1500, height: 1000, aspect: 1.5,
        url: `https://www.shutterstock.com/ss-${index + 1}`,
      }));
      return json({
        source: 'ai', degraded: null, model: 'gemma4:31b', provider: 'shutterstock', licence: 'preview',
        notice: 'Watermarked Shutterstock preview for client review.',
        queries: { images: 'dental practice interior', videos: '' },
        assets,
        assignments: slots.map((slot, index) => ({ slotKey: slot.key, assetId: `ss-${index + 1}`, kind: 'image', reason: 'matches the section' })),
        unassigned: [],
      });
    }
    if (url.endsWith('/concepts')) {
      if (overrides.conceptsError) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: overrides.conceptsError }) });
      return json({ ...CONCEPT_SET, ...overrides.concepts });
    }
    if (url.endsWith('/expand')) return json({ source: 'ai', model: 'gemma4:31b', briefText: BRIEF_TEXT, ...CONCEPT_SET.fields, projectName: 'Harbour Dental', notes: '' });
    if (url.endsWith('/outline')) return json({ source: 'ai', model: 'gemma4:31b', name: 'Typed', rationale: 'r', steps: [{ requested: 'Hero', family: 'hero', reason: 'r' }, { requested: 'Pricing', family: 'pricing', reason: 'r' }], added: [], unresolved: [] });
    if (url.endsWith('/content')) {
      if (overrides.contentError) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: overrides.contentError }) });
      const families = JSON.parse(route.request().postData()).families;
      return json({
        source: 'ai', degraded: null, model: 'gemma4:31b', families,
        sections: families.map((family) => ({
          family, pretitle: 'Pre', title: `Copy for ${family}`, subtitle: '', body: '', items: [], buttons: [],
        })),
      });
    }
    return json({});
  });
}

async function boot(page) {
  await page.setViewportSize({ width: 1680, height: 1050 });
  await useAdvancedBuilder(page);
  await bootFresh(page);
}

/**
 * A boot with no seeded preference, for the one test that is *about* which
 * builder a session comes back to. Everything else seeds the advanced builder
 * so it can describe the switch rather than the default.
 */
async function bootFresh(page) {
  await page.setViewportSize({ width: 1680, height: 1050 });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
}

async function enterSimple(page) {
  await boot(page);
  await page.locator('[data-builder-mode="simple"]').click();
  await expect(page.locator('#simple-brief')).toBeVisible();
}

/** Step 01 all the way to three concepts on screen. */
async function buildConcepts(page) {
  await enterSimple(page);
  await page.locator('#simple-brief').fill(BRIEF_TEXT);
  await page.locator('[data-brain-action="build-concepts"]').click();
  await expect(page.locator('.concept-card')).toHaveCount(3);
}

function designOf(page) {
  return page.evaluate(() => {
    const api = window.__SBS_TEST_API;
    const design = api.state.project.design;
    return {
      archetype: design.archetype,
      accent: design.palette.accent,
      fontDisplay: design.fontDisplay,
      buttonStyle: design.buttonStyle,
      dials: api.design.dialKeys.map((key) => design[key]).join(','),
    };
  });
}

/**
 * The V1/V2/V3 switcher addresses concept workspaces by id.
 *
 * It used to carry a list index, which was honest when a concept was a design
 * slice inside `simple.concepts`. A concept is now a first-class workspace with a
 * stable id, and the pill says which one it opens.
 */
function conceptPill(page, conceptId) {
  return page.locator(`[data-concept-pill="${conceptId}"]`);
}

/** Every concept's workspace, read straight off the project. */
function conceptWorkspaces(page) {
  return page.evaluate(() => {
    const api = window.__SBS_TEST_API;
    const concepts = api.concepts.list(api.state.project);
    return concepts.map((concept) => ({
      id: concept.id,
      slot: concept.slot,
      status: concept.status,
      flowId: concept.flowId,
      families: (concept.sections || []).map((section) => section.family).join(','),
      titles: (concept.sections || []).map((section) => section.content?.title).join('|'),
      accent: concept.design?.palette?.accent,
      fontDisplay: concept.design?.fontDisplay,
      archetype: concept.design?.archetype,
      logoText: concept.header?.logoText,
      revision: concept.revision,
    }));
  });
}

function projectWork(page) {
  return page.evaluate(() => {
    const project = window.__SBS_TEST_API.state.project;
    return {
      flowId: project.flowId,
      families: project.sections.map((section) => section.family).join(','),
      titles: project.sections.map((section) => section.content.title).join('|'),
      header: project.header.logoText,
      step: window.__SBS_TEST_API.state.currentStep,
    };
  });
}

test.describe('the builder mode switch', () => {
  // Which builder a *fresh* visitor lands in is asserted in builder-upgrades.spec:
  // these tests seed the advanced preference the way a returning session would,
  // so they can describe the switch rather than the default.
  test('names which builder you are in', async ({ page }) => {
    await stubBrain(page);
    await boot(page);
    await expect(page.locator('[data-builder-mode="advanced"]')).toHaveClass(/is-active/);
    await expect(page.locator('[data-builder-mode="advanced"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-builder-mode="simple"]')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#sideKicker')).toHaveText('Advanced builder');
    await expect(page.locator('body')).toHaveClass(/is-advanced-builder/);
    await expect(page.locator('.step-btn')).toHaveCount(5);
  });

  test('switching swaps the steps, the chrome and the step count', async ({ page }) => {
    await stubBrain(page);
    await boot(page);
    await page.locator('[data-builder-mode="simple"]').click();
    await expect(page.locator('[data-builder-mode="simple"]')).toHaveClass(/is-active/);
    await expect(page.locator('#sideKicker')).toHaveText('Simple builder');
    await expect(page.locator('body')).toHaveClass(/is-simple-builder/);
    await expect(page.locator('.step-btn')).toHaveCount(4);
    await expect(page.locator('.step-btn .step-copy b')).toHaveText(['Brief and Direction', 'Page flow', 'Modules', 'Review & export']);
    await expect(page.locator('.nav-hint')).toContainText('Step 1 of 4');

    await page.locator('[data-builder-mode="advanced"]').click();
    await expect(page.locator('.step-btn')).toHaveCount(5);
    await expect(page.locator('.step-btn .step-copy b').first()).toHaveText('Brief');
  });

  test('the export button is gone from the chrome in both builders', async ({ page }) => {
    await stubBrain(page);
    await boot(page);
    for (const mode of ['advanced', 'simple']) {
      await page.locator(`[data-builder-mode="${mode}"]`).click();
      const visible = await page.evaluate(() => {
        const button = document.getElementById('topExportBtn');
        return button ? !button.hidden && getComputedStyle(button).display !== 'none' : false;
      });
      expect(visible, mode).toBe(false);
    }
    // Undo, redo and Open preview keep their place on the right.
    const order = await page.evaluate(() => {
      const bar = document.querySelector('.topbar');
      const spacer = bar.querySelector('.top-spacer');
      const after = [];
      let node = spacer.nextElementSibling;
      while (node) { if (node.id || node.className) after.push(node.id || node.className.split(' ')[0]); node = node.nextElementSibling; }
      return after;
    });
    expect(order).toContain('top-group');
    expect(order).toContain('openPreviewBtn');
  });

  test('the chosen builder survives a reload', async ({ page }) => {
    await stubBrain(page);
    // No seeded preference: a fresh session opens on the simple builder, so the
    // choice this test follows is the move away from it.
    await bootFresh(page);
    await expect(page.locator('#sideKicker')).toHaveText('Simple builder');

    await page.locator('[data-builder-mode="advanced"]').click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('sbs-builder-v3') || '{}').builderMode)).toBe('advanced');
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
    await expect(page.locator('#sideKicker')).toHaveText('Advanced builder');
    await expect(page.locator('.step-btn')).toHaveCount(5);
  });
});

test.describe('simple builder · Step 01 Brief and Direction', () => {
  test('asks for one paragraph and nothing else', async ({ page }) => {
    await stubBrain(page);
    await enterSimple(page);
    await expect(page.locator('#simple-brief')).toHaveCount(1);
    // The nine separate brief fields belong to the advanced builder.
    const binds = await page.$$eval('#editorInner [data-bind]', (nodes) => nodes.map((node) => node.dataset.bind));
    expect(binds.filter((path) => path.startsWith('brief.'))).toEqual([]);
    // Palette, type and the button family live on this step.
    await expect(page.locator('.palette-row .color-field')).toHaveCount(5);
    await expect(page.locator('[data-bind="design.fontDisplay"]')).toHaveCount(1);
    await expect(page.locator('.btn-style-card')).toHaveCount(10);
  });

  test('condenses the step into disclosures, with two of them closed', async ({ page }) => {
    await stubBrain(page);
    await enterSimple(page);
    // Step 01 asks for one paragraph and then offers five panels of controls.
    // Every one of them is a disclosure so the step can be read at a glance.
    const panels = await page.$$eval('#editorInner details.panel-collapsible', (nodes) => nodes.map((node) => ({
      title: node.querySelector('h2').textContent,
      open: node.open,
    })));
    expect(panels.map((panel) => panel.title)).toEqual([
      'Palette and type', 'Button family', 'Quick styles', 'Design dials', 'Navigation and footer',
    ]);
    // Closed: the family the concept already chose, and the globals. Everything
    // else is the task at hand and stays open.
    expect(panels.filter((panel) => !panel.open).map((panel) => panel.title))
      .toEqual(['Button family', 'Navigation and footer']);

    // Closed does not mean gone: opening either reveals its real controls.
    const buttons = page.locator('details.panel-collapsible:has(h2:text-is("Button family"))');
    await expect(buttons).toContainText('Solid Shift');
    await buttons.locator('summary').click();
    await expect(buttons.locator('.btn-style-card').first()).toBeVisible();

    const globals = page.locator('details.panel-collapsible:has(h2:text-is("Navigation and footer"))');
    await globals.locator('summary').click();
    expect(await globals.evaluate((node) => node.open)).toBe(true);
    await expect(globals.locator('[data-bind="global.header.logoText"]')).toHaveCount(1);
  });

  test('builds three concepts, each with its own style, buttons and dials', async ({ page }) => {
    await stubBrain(page);
    await buildConcepts(page);
    const concepts = await page.evaluate(() => window.__SBS_TEST_API.simple.ensure().concepts);
    expect(concepts.map((concept) => concept.slot)).toEqual(['V1', 'V2', 'V3']);
    expect(new Set(concepts.map((concept) => concept.archetypeKey)).size).toBe(3);
    expect(new Set(concepts.map((concept) => concept.preset)).size).toBe(3);
    expect(new Set(concepts.map((concept) => concept.buttonStyle)).size).toBe(3);
    // Each card explains itself.
    for (const [index, concept] of concepts.entries()) {
      const card = page.locator('.concept-card').nth(index);
      await expect(card).toContainText(concept.name);
      await expect(card).toContainText(concept.why);
      await expect(card).toContainText(concept.archetypeName);
    }
    // And the readback proves the paragraph was read.
    await expect(page.locator('.brain-readback.is-simple')).toContainText('A family dental practice in Portsmouth.');
    await expect(page.locator('.brain-readback.is-simple')).toContainText('90% confident');
  });

  test('mirrors the paragraph into the advanced builder brief fields', async ({ page }) => {
    await stubBrain(page);
    await buildConcepts(page);
    const brief = await page.evaluate(() => window.__SBS_TEST_API.state.project.brief);
    expect(brief.clientName).toBe('Harbour Dental');
    expect(brief.projectName).toBe('Harbour Dental');
    expect(brief.industry).toContain('Family dental practice');
    expect(brief.audience).toContain('nervous adult patients');
    expect(brief.goal).toContain('Book a first appointment');
    expect(brief.tone).toContain('Calm');
  });

  test('will not let you leave until a concept is chosen', async ({ page }) => {
    await stubBrain(page);
    await buildConcepts(page);
    // Nothing is pre-selected: choosing is the step's exit condition.
    expect(await page.evaluate(() => window.__SBS_TEST_API.simple.ensure().active)).toBeNull();
    await expect(page.locator('.nav-btn.next')).toBeDisabled();
    await expect(page.locator('.nav-hint')).toContainText('choose a concept');
    // Even a direct step click is refused.
    await page.locator('[data-step="2"]').click();
    expect(await page.evaluate(() => window.__SBS_TEST_API.state.currentStep)).toBe(0);

    await conceptPill(page, 'v2').click();
    await expect(page.locator('.nav-btn.next')).toBeEnabled();
    await page.locator('.nav-btn.next').click();
    expect(await page.evaluate(() => window.__SBS_TEST_API.state.currentStep)).toBe(1);
  });

  test('reports a model failure without losing the paragraph', async ({ page }) => {
    await stubBrain(page, { conceptsError: { code: 'OLLAMA_UNAVAILABLE', message: 'down' } });
    await enterSimple(page);
    await page.locator('#simple-brief').fill(BRIEF_TEXT);
    await page.locator('[data-brain-action="build-concepts"]').click();
    await expect(page.locator('.brain-error')).toContainText('could not be reached');
    expect(await page.locator('#simple-brief').inputValue()).toBe(BRIEF_TEXT);
    await expect(page.locator('[data-brain-action="build-concepts"]')).toBeEnabled();
  });

  test('labels a degraded set as coming from the built-in planner', async ({ page }) => {
    await stubBrain(page, { concepts: { source: 'deterministic', degraded: { code: 'OLLAMA_UNAVAILABLE', message: 'The AI model could not answer in time, so the built-in planner answered instead.' } } });
    await buildConcepts(page);
    await expect(page.locator('.brain-source.is-local')).toContainText('Built-in planner');
  });
});

/**
 * One press, four jobs.
 *
 * This used to be three buttons on three steps, and the middle one needed a
 * fourth press before anything it wrote reached the page. None of those presses
 * was a decision — every one of them had to happen before a page could be shown
 * to anybody — so they are one press now.
 */
test.describe('simple builder · one button does the whole first pass', () => {
  test('writes the copy and puts it on the page, with no second press', async ({ page }) => {
    await stubBrain(page);
    const before = await (async () => {
      await enterSimple(page);
      return page.evaluate(() => window.__SBS_TEST_API.state.project.sections.map((section) => section.content.title));
    })();
    await page.locator('#simple-brief').fill(BRIEF_TEXT);
    await page.locator('[data-brain-action="build-concepts"]').click();
    await expect(page.locator('.concept-card')).toHaveCount(3);

    const after = await page.evaluate(() => window.__SBS_TEST_API.state.project.sections.map((section) => section.content.title));
    expect(after).not.toEqual(before);
    expect(after.every((title) => title.startsWith('Copy for '))).toBe(true);
    // Nowhere in the simple builder is there anything left to press for this.
    await expect(page.locator('[data-brain-action="write-content"]')).toHaveCount(0);
    await expect(page.locator('[data-brain-action="apply-content"]')).toHaveCount(0);
  });

  test('finds the imagery and places it, in the same press', async ({ page }) => {
    await stubBrain(page, { stock: true });
    await buildConcepts(page);

    const placed = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      const slots = api.media.slots();
      const media = (section, slot) => {
        const content = section.content || {};
        if (slot.role === 'card') return (content.items || [])[slot.index]?.media || null;
        const hasBanner = section.node && section.node.component === 'ds-blocks/dst-banner';
        const at = slot.role === 'background' ? 0 : (hasBanner ? slot.index + 1 : slot.index);
        return (content.media || [])[at] || null;
      };
      return slots.map((slot) => {
        const section = api.state.project.sections.find((entry) => entry.id === slot.sectionId);
        const asset = media(section, slot);
        return asset ? asset.provider : 'empty';
      });
    });
    expect(placed.length).toBeGreaterThan(3);
    expect(placed.every((provider) => provider === 'shutterstock')).toBe(true);
    // And the imagery panel is a library from here, not a step to remember.
    await conceptPill(page, 'v1').click();
    await page.locator('.nav-btn.next').click();
    await page.locator('.nav-btn.next').click();
    await expect(page.locator('#editorInner')).toContainText("Step 01's button already searched");
  });

  test('all three concepts carry the copy and the pictures, not just the open one', async ({ page }) => {
    await stubBrain(page, { stock: true });
    await buildConcepts(page);
    // The reason the page is dressed *before* the workspaces are forked: three
    // concepts are for comparing design, so all three have to be the same page.
    const perConcept = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      return api.concepts.generated().map((concept) => ({
        slot: concept.slot,
        titles: concept.sections.map((section) => section.content.title),
        pictures: concept.sections.filter((section) => (section.content.media || []).some((media) => media && media.provider === 'shutterstock')).length,
      }));
    });
    expect(perConcept).toHaveLength(3);
    for (const concept of perConcept) {
      expect(concept.titles.every((title) => title.startsWith('Copy for ')), `${concept.slot} copy`).toBe(true);
      expect(concept.pictures, `${concept.slot} pictures`).toBeGreaterThan(0);
    }
  });

  test('says what it did, in counts, on the panel', async ({ page }) => {
    await stubBrain(page, { stock: true });
    await buildConcepts(page);
    const report = page.locator('.brain-report');
    await expect(report).toContainText('3 concepts designed');
    await expect(report).toContainText('sections written and applied');
    await expect(report).toContainText('pictures found and placed');
  });

  test('says what it could not do, without pretending it worked', async ({ page }) => {
    // No stock credentials is the ordinary case, not an error: the concepts and
    // the copy still land, and the panel says why there are no pictures.
    await stubBrain(page);
    await buildConcepts(page);
    const report = page.locator('.brain-report');
    await expect(report).toContainText('3 concepts designed');
    await expect(report).toContainText('sections written and applied');
    await expect(report).toContainText('stock imagery is not configured');
    await expect(report).not.toContainText('pictures found');
  });

  test('keeps the concepts when the copywriter cannot be reached', async ({ page }) => {
    await stubBrain(page, { contentError: { code: 'PROVIDER_UNAVAILABLE', message: 'The model is unavailable.' } });
    await enterSimple(page);
    const before = await page.evaluate(() => window.__SBS_TEST_API.state.project.sections.map((section) => section.content.title));
    await page.locator('#simple-brief').fill(BRIEF_TEXT);
    await page.locator('[data-brain-action="build-concepts"]').click();

    // A brief that produced three concepts is worth keeping.
    await expect(page.locator('.concept-card')).toHaveCount(3);
    await expect(page.locator('.brain-report')).toContainText('copywriter could not be reached');
    expect(await page.evaluate(() => window.__SBS_TEST_API.state.project.sections.map((section) => section.content.title))).toEqual(before);
    expect(await page.evaluate(() => window.__SBS_TEST_API.simple.ensure().status)).toBe('ready');
  });

  test('reading the brief again re-runs all of it', async ({ page }) => {
    await stubBrain(page, { stock: true });
    await buildConcepts(page);
    await conceptPill(page, 'v2').click();
    await page.evaluate(() => {
      window.__SBS_TEST_API.state.project.sections[0].content.title = 'Edited by hand';
    });
    await page.locator('[data-brain-action="build-concepts"]').click();
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.sections[0].content.title)).toBe('Copy for hero');
    // The concept that was open stays open.
    expect(await page.evaluate(() => window.__SBS_TEST_API.concepts.activeId())).toBe('v2');
  });
});

test.describe('the V1/V2/V3 pills', () => {
  test('appear over the preview and follow you through every step', async ({ page }) => {
    await stubBrain(page);
    await buildConcepts(page);
    await expect(page.locator('#conceptBar')).toBeVisible();
    await expect(page.locator('.concept-pill')).toHaveCount(3);
    await expect(page.locator('.concept-pill')).toHaveText(['V1', 'V2', 'V3']);
    await expect(page.locator('.concept-pill').first()).toHaveAttribute('data-concept-pill', 'v1');

    await conceptPill(page, 'v1').click();
    for (const step of [1, 2, 3]) {
      await page.locator('.nav-btn.next').click();
      expect(await page.evaluate(() => window.__SBS_TEST_API.state.currentStep)).toBe(step);
      await expect(page.locator('#conceptBar'), `step ${step}`).toBeVisible();
      await expect(page.locator('.concept-pill'), `step ${step}`).toHaveCount(3);
    }
  });

  // The switcher is project chrome, not a feature of one builder: a strategist
  // who opens Advanced to change a pattern is still working on one of three
  // proposals and still has to be able to see and change which.
  test('stay available in the advanced builder', async ({ page }) => {
    await stubBrain(page);
    await buildConcepts(page);
    await conceptPill(page, 'v1').click();
    await expect(page.locator('#conceptBar')).toBeVisible();
    await page.locator('[data-builder-mode="advanced"]').click();
    await expect(page.locator('#conceptBar')).toBeVisible();
    await expect(page.locator('.concept-pill')).toHaveText(['V1', 'V2', 'V3']);
    await conceptPill(page, 'v3').click();
    await expect(conceptPill(page, 'v3')).toHaveClass(/is-active/);
    expect(await page.evaluate(() => window.__SBS_TEST_API.concepts.activeId(window.__SBS_TEST_API.state.project))).toBe('v3');
  });

  test('each pill applies a materially different design to the live page', async ({ page }) => {
    await stubBrain(page);
    await buildConcepts(page);
    const designs = [];
    for (const id of ['v1', 'v2', 'v3']) {
      await conceptPill(page, id).click();
      await expect(conceptPill(page, id)).toHaveClass(/is-active/);
      designs.push(await designOf(page));
    }
    expect(new Set(designs.map((design) => JSON.stringify(design))).size).toBe(3);
    expect(new Set(designs.map((design) => design.archetype)).size).toBe(3);
    expect(new Set(designs.map((design) => design.accent)).size).toBe(3);
    expect(new Set(designs.map((design) => design.buttonStyle)).size).toBe(3);
    expect(new Set(designs.map((design) => design.dials)).size).toBe(3);

    // And the rendered page really changes with it. The preview is rebuilt on a
    // debounce, so poll rather than reading the frame the instant the pill is hit.
    await expect.poll(() => page.locator('#sitePreview').evaluate((frame) => {
      const site = frame.contentDocument.getElementById('sbs-site');
      return `${site.dataset.buttonStyle}|${getComputedStyle(site).getPropertyValue('--dst--primary-color2').trim().toLowerCase()}`;
    })).toBe(`${designs[2].buttonStyle}|${designs[2].accent.toLowerCase()}`);
  });

  // The first flow chosen reaches every concept, because three proposals built
  // on three different structures are not a comparison. Once a concept has been
  // edited it keeps its own.
  test('the first flow chosen applies to all three concepts', async ({ page }) => {
    await stubBrain(page);
    await buildConcepts(page);
    await conceptPill(page, 'v1').click();
    await page.locator('.nav-btn.next').click();
    await page.locator('[data-brain-action="apply-flow"]').first().click();
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.flowId)).toBe('B2');
    const workspaces = await conceptWorkspaces(page);
    expect(workspaces.map((concept) => concept.flowId)).toEqual(['B2', 'B2', 'B2']);
    // Same structure, three designs.
    expect(new Set(workspaces.map((concept) => concept.families)).size).toBe(1);
    expect(new Set(workspaces.map((concept) => concept.accent)).size).toBe(3);
    // And no two concepts share a module identity.
    const ids = await page.evaluate(() => window.__SBS_TEST_API.concepts.list(window.__SBS_TEST_API.state.project)
      .flatMap((concept) => (concept.sections || []).map((section) => section.id)));
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every concept keeps its own page, and switching loses nothing', async ({ page }) => {
    await stubBrain(page);
    await buildConcepts(page);
    await conceptPill(page, 'v1').click();
    await page.locator('.nav-btn.next').click();
    await page.locator('[data-brain-action="apply-flow"]').first().click();
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.flowId)).toBe('B2');
    await page.locator('.nav-btn.next').click();

    // A different headline in each concept.
    const headlines = { v1: 'V1 gentle dentistry', v2: 'V2 warm and welcoming', v3: 'V3 considered care' };
    for (const [id, headline] of Object.entries(headlines)) {
      await conceptPill(page, id).click();
      await page.locator('#editorInner [data-bind$=".title"]').first().fill(headline);
      await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.sections[0].content.title)).toBe(headline);
    }
    // A different module count in V3 as well, so the divergence is structural.
    await conceptPill(page, 'v3').click();
    const v3Count = await page.evaluate(() => window.__SBS_TEST_API.state.project.sections.length);

    // Round-trip repeatedly. Every concept comes back exactly as it was left.
    for (const id of ['v1', 'v3', 'v2', 'v1', 'v3', 'v2']) {
      await conceptPill(page, id).click();
      await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.sections[0].content.title)).toBe(headlines[id]);
    }
    await conceptPill(page, 'v3').click();
    expect(await page.evaluate(() => window.__SBS_TEST_API.state.project.sections.length)).toBe(v3Count);

    // And the isolation holds at the object level: three distinct headlines.
    const workspaces = await conceptWorkspaces(page);
    expect(workspaces.map((concept) => concept.titles.split('|')[0])).toEqual([headlines.v1, headlines.v2, headlines.v3]);
  });

  test('everything survives a reload, including which concept was open', async ({ page }) => {
    await stubBrain(page);
    await buildConcepts(page);
    await conceptPill(page, 'v2').click();
    await page.locator('[data-bind="design.palette.accent"]').evaluate((input) => {
      input.value = '#5b0e20';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.design.palette.accent)).toBe('#5b0e20');
    const before = await conceptWorkspaces(page);

    // Autosave is debounced; wait for it to land before reloading.
    await expect.poll(() => page.evaluate(() => Boolean(JSON.parse(localStorage.getItem('sbs-builder-v3') || '{}').project?.conceptSet))).toBe(true);
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));

    expect(await page.evaluate(() => window.__SBS_TEST_API.concepts.activeId(window.__SBS_TEST_API.state.project))).toBe('v2');
    expect(await conceptWorkspaces(page)).toEqual(before);
  });

  test('a design edit stays with the concept it was made on', async ({ page }) => {
    await stubBrain(page);
    await buildConcepts(page);
    await conceptPill(page, 'v1').click();
    // The simple builder has no dial panel: the AI sets the dials per concept.
    // Palette is the design control it does expose on this step.
    await page.locator('[data-bind="design.palette.accent"]').evaluate((input) => {
      input.value = '#123456';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.design.palette.accent)).toBe('#123456');
    // Away and back: the edit belongs to V1, not to whatever was last applied.
    await conceptPill(page, 'v2').click();
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.design.palette.accent)).not.toBe('#123456');
    await conceptPill(page, 'v1').click();
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.design.palette.accent)).toBe('#123456');
  });

  /*
   * Switching concepts is navigation, not an edit.
   *
   * It used to be one undo step, which was consistent while a switch overwrote
   * the design slice. Now nothing is overwritten, so there is nothing to undo —
   * and undo must stay pointed at the edits made inside the concept on screen.
   */
  test('switching a concept is not an undoable edit, and undo is per concept', async ({ page }) => {
    await stubBrain(page);
    await buildConcepts(page);
    await conceptPill(page, 'v1').click();

    const setAccent = async (hex) => {
      await page.locator('[data-bind="design.palette.accent"]').evaluate((input, value) => {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, hex);
      await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.design.palette.accent)).toBe(hex);
    };
    const accent = () => page.evaluate(() => window.__SBS_TEST_API.state.project.design.palette.accent);

    await setAccent('#111111');
    const v1Before = await accent();
    await conceptPill(page, 'v2').click();
    const v2Untouched = await accent();
    // Nothing was edited on V2, so V2 has nothing to undo.
    await expect(page.locator('#undoBtn')).toBeDisabled();
    await setAccent('#222222');
    await page.locator('#undoBtn').click();
    await expect.poll(accent).toBe(v2Untouched);

    // V1's own edit is still there, and still undoable on V1.
    await conceptPill(page, 'v1').click();
    expect(await accent()).toBe(v1Before);
    await expect(page.locator('#undoBtn')).toBeEnabled();
    await page.locator('#undoBtn').click();
    await expect.poll(accent).not.toBe(v1Before);
    // Undoing V1 left V2 exactly where it was.
    await conceptPill(page, 'v2').click();
    expect(await accent()).toBe(v2Untouched);
  });
});

test.describe('simple builder · Step 02 Page flow', () => {
  // Five, not three: the concept job returns the five best flows for the brief.
  test('shows only the five recommendations', async ({ page }) => {
    await stubBrain(page);
    await buildConcepts(page);
    await conceptPill(page, 'v1').click();
    await page.locator('.nav-btn.next').click();

    await expect(page.locator('.brain-flow-list li')).toHaveCount(5);
    // The full library and the page sequence are not on this step.
    await expect(page.locator('.flow-card')).toHaveCount(0);
    await expect(page.locator('.module-row')).toHaveCount(0);
    await expect(page.locator('#editorInner')).not.toContainText('SBS flow library');
    await expect(page.locator('#editorInner')).not.toContainText('Choose the argument');
    await expect(page.locator('#editorInner')).not.toContainText('Current page sequence');
    // The typed-outline builder is still here.
    await expect(page.locator('#brain-outline')).toHaveCount(1);
  });

  test('applying a recommendation rebuilds the page', async ({ page }) => {
    await stubBrain(page);
    await buildConcepts(page);
    await conceptPill(page, 'v1').click();
    await page.locator('.nav-btn.next').click();
    await page.locator('[data-brain-action="apply-flow"]').first().click();
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.flowId)).toBe('B2');
    const patterns = await page.evaluate(() => window.__SBS_TEST_API.state.project.sections.map((section) => section.patternId));
    const known = await page.evaluate(() => window.__SBS_TEST_API.patternIds);
    for (const pattern of patterns) expect(known).toContain(pattern);
  });
});

test.describe('simple builder · Step 03 Modules', () => {
  async function openModules(page) {
    await stubBrain(page);
    await buildConcepts(page);
    await conceptPill(page, 'v1').click();
    await page.locator('.nav-btn.next').click();
    await page.locator('.nav-btn.next').click();
    await expect(page.locator('.module-row').first()).toBeVisible();
  }

  test('has the page sequence, three tabs, no extended view and no DST tree', async ({ page }) => {
    await openModules(page);
    await expect(page.locator('.module-row')).toHaveCount(6);
    await expect(page.locator('.view-switch')).toHaveCount(0);
    await expect(page.locator('[data-module-view]')).toHaveCount(0);
    await expect(page.locator('[data-editor-tab]')).toHaveText(['Content', 'Media', 'Layout + effects']);
    await expect(page.locator('[data-editor-tab="advanced"]')).toHaveCount(0);
    await expect(page.locator('#editorInner')).not.toContainText('DST tree');
  });

  test('the copy is already written, and there is no second button to press', async ({ page }) => {
    await openModules(page);
    // The copywriter used to live here, behind two presses: one to draft and one
    // to apply. Step 01's button does both, so neither button exists any more.
    await expect(page.locator('[data-brain-action="write-content"]')).toHaveCount(0);
    await expect(page.locator('[data-brain-action="apply-content"]')).toHaveCount(0);
    await expect(page.locator('#editorInner')).not.toContainText('Fill the page with real copy');
    // And the copy from the brief is on the page already.
    const titles = await page.evaluate(() => window.__SBS_TEST_API.state.project.sections.map((section) => section.content.title));
    expect(titles[0]).toBe('Copy for hero');
    expect(titles.every((title) => title.startsWith('Copy for '))).toBe(true);
  });

  /*
   * The same in-place repaint the advanced builder gets. It matters more here:
   * the simple builder is the front door, and a page that jumps to the top
   * every time somebody picks "Space above" is the version most people see.
   */
  test('changing a layout property does not move the preview', async ({ page }) => {
    await openModules(page);
    await page.locator('[data-editor-tab="layout"]').click();
    const id = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      api.state.selectedSectionId = api.state.project.sections[2].id;
      return api.state.selectedSectionId;
    });
    await page.locator('.module-row').nth(2).click();
    await page.locator('[data-editor-tab="layout"]').click();
    // Reaching this step queued rebuilds of its own. Measuring before they have
    // all landed would blame this change for somebody else's reload.
    await previewSettled(page);

    await page.evaluate((sectionId) => {
      const frame = document.getElementById('sitePreview');
      window.__loads = 0;
      frame.addEventListener('load', () => { window.__loads += 1; });
      frame.contentDocument.getElementById(sectionId).scrollIntoView({ block: 'center', behavior: 'instant' });
    }, id);
    await page.waitForTimeout(300);
    const before = await page.locator('#sitePreview').evaluate((frame) => frame.contentWindow.scrollY);
    expect(before, 'the band under test was not scrolled away from the top').toBeGreaterThan(50);

    await page.locator(`[data-bind="setting.${id}.paddingTop"]`).selectOption('none');

    // The band really changed…
    await expect.poll(() => page.locator('#sitePreview').evaluate((frame, sectionId) => {
      const band = frame.contentDocument.getElementById(sectionId);
      return band ? band.className : '';
    }, id)).toContain('dt-0');
    // …without the frame being rebuilt, and without the page moving a pixel.
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__SBS_TEST_API.paint.rebuilt()), 'a repaint degraded into a rebuild').toBe(0);
    expect(await page.evaluate(() => window.__loads), 'the preview frame was rebuilt').toBe(0);
    expect(await page.locator('#sitePreview').evaluate((frame) => frame.contentWindow.scrollY)).toBe(before);
  });

  test('the layout tab shows only the plain-language groups', async ({ page }) => {
    await openModules(page);
    await page.locator('[data-editor-tab="layout"]').click();
    const groups = await page.$$eval('.fidelity-group__head h3', (nodes) => nodes.map((node) => node.textContent));
    expect(groups).toContain('How this section looks');
    expect(groups).toContain('How it arrives');
    expect(groups).toContain('Decorative pattern');
    // The overlay controls are here too. They are the fix for the one failure a
    // strategist actually sees — white type on a pale photograph — so hiding
    // them behind a view this builder does not have was a dead end.
    expect(groups).toContain('Background and image overlay');
    const binds = await page.$$eval('#editorInner [data-bind]', (nodes) => nodes.map((node) => node.dataset.bind));
    expect(binds.filter((path) => /\.(?:[a-zA-Z]*(?:Tablet|Mobile)|margin)\b/i.test(path))).toEqual([]);
    // Nothing numeric is typed: every quantity in this view is a slider.
    const numeric = await page.$$eval('#editorInner input[data-bind]', (nodes) => nodes.map((node) => node.type));
    expect(numeric).not.toContain('number');
  });

  /*
   * The overlay is the fix for the one failure a strategist can actually see —
   * a headline that has disappeared into a bright photograph — so it has to be
   * reachable from the builder they are standing in, with sliders rather than a
   * box wanting a number between 0 and 1.
   */
  test('the overlay can be changed here, by dragging', async ({ page }) => {
    await openModules(page);
    await page.locator('[data-editor-tab="layout"]').click();
    await expect(page.locator('[data-fidelity-overlay-control]')).toHaveCount(1);

    const strength = page.locator('input[data-bind$=".surface.overlayOpacity"]');
    await expect(strength).toHaveAttribute('type', 'range');
    await strength.fill('80');
    await expect.poll(() => page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      return api.state.project.sections.find((s) => s.id === api.state.selectedSectionId).fidelity.surface.overlayOpacity;
    })).toBe(0.8);

    const sectionId = await page.evaluate(() => window.__SBS_TEST_API.state.selectedSectionId);
    await expect.poll(() => page.locator('#sitePreview').evaluate((frame, id) => {
      const overlay = frame.contentDocument.querySelector(`#${id} .c-overlay`);
      return overlay ? getComputedStyle(overlay).opacity : null;
    }, sectionId)).toBe('0.8');
  });

  test('the mobile menu style is offered here too, not only in the advanced builder', async ({ page }) => {
    await openModules(page);
    // Step 01 in the simple builder, where the global parts live behind a
    // collapsed panel: optional, but reachable without switching builders.
    await page.locator('[data-step="0"]').click();
    await page.locator('.panel-collapsible', { hasText: 'Navigation and footer' }).locator('summary').click();
    const select = page.locator('select[data-bind="global.header.mobileMenu"]');
    await expect(select).toHaveCount(1);
    const styles = await select.locator('option').evaluateAll((nodes) => nodes.map((node) => node.value));
    expect(styles).toEqual(['center', 'left', 'right', 'aurora']);
    await select.selectOption('aurora');
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.simple.buildConceptExport().concept.global.navigation.nav.mobileMenu)).toBe('aurora');
  });

  test('a persisted extended-view preference does not leak in', async ({ page }) => {
    await stubBrain(page);
    await boot(page);
    // Turn extended on in the advanced builder first.
    await page.locator('[data-step="3"]').click();
    await page.locator('.module-row').first().click();
    await page.locator('[data-editor-tab="layout"]').click();
    await page.locator('[data-module-view="extended"]').click();
    await expect(page.locator('[data-module-view="extended"]')).toHaveClass(/active/);
    await page.locator('[data-builder-mode="simple"]').click();
    await expect(page.locator('.view-switch')).toHaveCount(0);
    expect(await page.evaluate(() => window.__SBS_TEST_API.state.moduleView)).toBe('simple');
  });
});

test.describe('simple builder · Step 04 Review and export', () => {
  async function openReview(page) {
    await stubBrain(page);
    await buildConcepts(page);
    await conceptPill(page, 'v2').click();
    for (let step = 0; step < 3; step += 1) await page.locator('.nav-btn.next').click();
    await expect(page.locator('.check-list')).toBeVisible();
  }

  /*
   * Simple exports through the same pipeline as Advanced.
   *
   * This used to assert one download, which stopped being true when the two
   * builders were put on one export contract. The concept JSON is the extra one
   * Simple has, and the all-concepts archive is the extra one the concept set
   * brought with it.
   */
  test('offers the same WordPress artifacts as Advanced, plus the concept handoff', async ({ page }) => {
    await openReview(page);
    const exports = await page.$$eval('[data-export]', (nodes) => nodes.map((node) => node.dataset.export));
    for (const artifact of ['navigation', 'footer', 'page', 'html', 'bundle', 'simple-concept', 'all-concepts']) {
      expect(exports, artifact).toContain(artifact);
    }
  });

  test('names every concept, its design source and its revision', async ({ page }) => {
    await openReview(page);
    await expect(page.locator('.concept-row')).toHaveCount(3);
    await expect(page.locator('.concept-row.is-active')).toHaveCount(1);
    await expect(page.locator('.concept-row.is-active .concept-row__id b')).toHaveText('V2');
    // The concept being edited is the one that cannot be opened again, and the
    // other two can be.
    await expect(page.locator('[data-concept-action="open"]')).toHaveCount(2);
    await expect(page.locator('[data-concept-action="reset"]')).toHaveCount(3);
  });

  /*
   * The row actions were four sentences of label inside a fixed 27px icon square,
   * so they overflowed their buttons and printed on top of each other. This holds
   * the fix: icons that fit, an accessible name each, and a hover label that stays
   * inside the editor column instead of being cut off by it.
   */
  test('the concept actions are icons that fit, name themselves and label on hover', async ({ page }) => {
    await openReview(page);
    const actions = page.locator('.concept-row .concept-action');
    await expect(actions.first()).toBeVisible();

    const geometry = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('.concept-row .concept-action')];
      const editor = document.querySelector('.editor').getBoundingClientRect();
      const overlaps = [];
      const boxes = nodes.map((node) => node.getBoundingClientRect());
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i];
          const b = boxes[j];
          if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) overlaps.push([i, j]);
        }
      }
      return {
        overlaps,
        count: nodes.length,
        spillsOutOfRow: nodes.filter((node) => {
          const row = node.closest('.concept-row').getBoundingClientRect();
          const box = node.getBoundingClientRect();
          return box.right > row.right + 0.5 || box.left < row.left - 0.5;
        }).length,
        outsideEditor: boxes.filter((box) => box.right > editor.right + 0.5 || box.left < editor.left - 0.5).length,
        missingName: nodes.filter((node) => !node.getAttribute('aria-label') || !node.dataset.tip).length,
        hasIcon: nodes.every((node) => node.querySelector('svg')),
      };
    });
    // The concept being edited cannot be opened again, so it has one action fewer.
    expect(geometry.count).toBe(11);
    expect(geometry.overlaps).toEqual([]);
    expect(geometry.spillsOutOfRow).toBe(0);
    expect(geometry.outsideEditor).toBe(0);
    expect(geometry.missingName).toBe(0);
    expect(geometry.hasIcon).toBe(true);

    // The hover label appears, says what the button does, and is not cut off by
    // the editor column on either the leftmost or the rightmost button.
    for (const action of [actions.first(), actions.last()]) {
      await action.hover();
      // The label fades in over 140ms, so poll rather than reading the frame the
      // pointer arrived on.
      await expect.poll(() => action.evaluate((node) => getComputedStyle(node, '::after').opacity)).toBe('1');
      const tip = await action.evaluate((node) => {
        const style = getComputedStyle(node, '::after');
        const rect = node.getBoundingClientRect();
        const probe = document.createElement('span');
        probe.textContent = style.content.replace(/^"|"$/g, '');
        probe.style.cssText = `position:fixed;visibility:hidden;white-space:nowrap;padding:${style.padding};font:${style.font}`;
        document.body.appendChild(probe);
        const width = probe.getBoundingClientRect().width;
        const text = probe.textContent;
        probe.remove();
        const left = style.left === 'auto'
          ? rect.right - width
          : (style.transform === 'none' ? rect.left : rect.left + rect.width / 2 - width / 2);
        const editor = document.querySelector('.editor').getBoundingClientRect();
        return { text, opacity: style.opacity, fits: left >= editor.left - 0.5 && left + width <= editor.right + 0.5 };
      });
      expect(tip.text).toMatch(/^(Open|Reset|Copy) V[1-3]/);
      expect(tip.fits, tip.text).toBe(true);
    }
  });

  test('exports carry the concept they came from', async ({ page }) => {
    await openReview(page);
    const meta = await page.evaluate(() => {
      const page_ = window.__SBS_TEST_API.buildPageExport();
      return { conceptId: page_.concept.conceptId, slot: page_.concept.slot, variantType: page_.concept.variantType, dials: Object.keys(page_.concept.designDials).length };
    });
    expect(meta).toEqual({ conceptId: 'v2', slot: 'V2', variantType: 'brand-led', dials: 9 });

    // And switching concepts switches what an export contains.
    await conceptPill(page, 'v3').click();
    expect(await page.evaluate(() => window.__SBS_TEST_API.buildPageExport().concept.slot)).toBe('V3');
  });

  test('the JSON carries the page, the navigation, the footer, the brief and all three concepts', async ({ page }) => {
    await openReview(page);
    const json = await page.evaluate(() => window.__SBS_TEST_API.simple.buildConceptExport());
    expect(json.artifactType).toBe('simple-concept');
    expect(json.concept.page.sections.length).toBeGreaterThan(0);
    expect(json.concept.global.navigation).toBeTruthy();
    expect(json.concept.global.footer).toBeTruthy();
    expect(json.simpleBuilder.briefText).toBe(BRIEF_TEXT);
    expect(json.simpleBuilder.concepts).toHaveLength(3);
    expect(json.simpleBuilder.active).toBe(1);
    expect(json.simpleBuilder.fields.clientName).toBe('Harbour Dental');
    // The editing model, without which an import loses every edit.
    expect(json.simpleBuilder.sections).toHaveLength(json.concept.page.sections.length);
    expect(json.simpleBuilder.sections[0].content.title).toBeTruthy();
    // And the design slice, so the concept looks the same after the handoff.
    expect(json.concept.design.archetype).toBe('C');
    expect(json.concept.design.buttonStyle).toBe('pill-glow');
    expect(json.concept.design.palette.accent).toBeTruthy();
  });

  test('shows the same preflight gates the advanced builder uses', async ({ page }) => {
    await openReview(page);
    const codes = await page.$$eval('.check code', (nodes) => nodes.map((node) => node.textContent));
    expect(codes.length).toBeGreaterThanOrEqual(27);
    expect(codes).toContain('CONTRAST');
    expect(codes).toContain('BUTTONS');
  });
});

test.describe('the handoff into the advanced builder', () => {
  test('imports a concept JSON with every edit, field and concept intact', async ({ page }) => {
    await stubBrain(page);
    await buildConcepts(page);
    await conceptPill(page, 'v2').click();
    await page.locator('.nav-btn.next').click();
    await page.locator('[data-brain-action="apply-flow"]').first().click();
    await page.locator('.nav-btn.next').click();
    await page.locator('#editorInner [data-bind$=".title"]').first().fill('Gentle dentistry for nervous patients');
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.sections[0].content.title)).toBe('Gentle dentistry for nervous patients');

    const source = await page.evaluate(() => ({
      json: JSON.stringify(window.__SBS_TEST_API.simple.buildConceptExport()),
      design: window.__SBS_TEST_API.state.project.design.archetype,
      button: window.__SBS_TEST_API.state.project.design.buttonStyle,
      families: window.__SBS_TEST_API.state.project.sections.map((section) => section.family).join(','),
    }));

    // A clean advanced project, then import.
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
    expect(await page.evaluate(() => window.__SBS_TEST_API.simple.mode())).toBe('advanced');
    await page.evaluate(async (json) => {
      const file = new File([json], 'concept.json', { type: 'application/json' });
      await window.__SBS_TEST_API.simple.importConcept(file);
    }, source.json);

    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.sections[0].content.title)).toBe('Gentle dentistry for nervous patients');
    const imported = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      const project = api.state.project;
      return {
        mode: api.simple.mode(),
        step: api.state.currentStep,
        families: project.sections.map((section) => section.family).join(','),
        flowId: project.flowId,
        archetype: project.design.archetype,
        buttonStyle: project.design.buttonStyle,
        brief: project.brief,
        concepts: api.simple.ensure().concepts.length,
        active: api.simple.ensure().active,
      };
    });
    expect(imported.mode).toBe('advanced');
    expect(imported.step).toBe(0);
    expect(imported.families).toBe(source.families);
    expect(imported.flowId).toBe('B2');
    expect(imported.archetype).toBe(source.design);
    expect(imported.buttonStyle).toBe(source.button);
    expect(imported.concepts).toBe(3);
    expect(imported.active).toBe(1);
    // The whole point of the handoff: the individual brief fields are filled in.
    expect(imported.brief.clientName).toBe('Harbour Dental');
    expect(imported.brief.industry).toContain('Family dental practice');
    expect(imported.brief.audience).toContain('nervous adult patients');
    expect(imported.brief.goal).toContain('Book a first appointment');
    expect(imported.brief.tone).toContain('Calm');
    expect(imported.brief.notes).toContain('Harbour Dental is a family dental practice');
    // And the advanced builder is fully itself again.
    await expect(page.locator('.step-btn')).toHaveCount(5);
  });

  test('the import control lives in the advanced builder Step 01 only', async ({ page }) => {
    await stubBrain(page);
    await boot(page);
    await expect(page.locator('[data-concept-import]')).toHaveCount(1);
    await page.locator('[data-step="1"]').click();
    await expect(page.locator('[data-concept-import]')).toHaveCount(0);
    await page.locator('[data-builder-mode="simple"]').click();
    await expect(page.locator('[data-concept-import]')).toHaveCount(0);
  });

  test('refuses a file that is not a concept JSON, without damaging the project', async ({ page }) => {
    await stubBrain(page);
    await boot(page);
    const before = await projectWork(page);
    await page.evaluate(async () => {
      const file = new File(['{"nope":true}'], 'bad.json', { type: 'application/json' });
      await window.__SBS_TEST_API.simple.importConcept(file);
    });
    await expect(page.locator('#toastText')).toContainText('no page sections');
    expect(await projectWork(page)).toEqual(before);
  });
});

test.describe('the advanced builder is unchanged', () => {
  test('keeps its five steps, extended view, DST tree and every export', async ({ page }) => {
    await stubBrain(page);
    await boot(page);
    await expect(page.locator('.step-btn')).toHaveCount(5);
    await page.locator('[data-step="3"]').click();
    await page.locator('.module-row').first().click();
    await expect(page.locator('[data-editor-tab]')).toHaveText(['Content', 'Media', 'Layout + effects', 'DST tree']);
    await page.locator('[data-editor-tab="layout"]').click();
    await expect(page.locator('.view-switch')).toHaveCount(1);
    await page.locator('[data-step="4"]').click();
    const exports = await page.$$eval('[data-export]', (nodes) => nodes.map((node) => node.dataset.export));
    expect(exports.length).toBeGreaterThan(1);
    expect(exports).toContain('html');
  });

  test('still has the full flow library and its nine brief fields', async ({ page }) => {
    await stubBrain(page);
    await boot(page);
    const binds = await page.$$eval('#editorInner [data-bind]', (nodes) => nodes.map((node) => node.dataset.bind));
    expect(binds.filter((path) => path.startsWith('brief.')).length).toBeGreaterThanOrEqual(8);
    await page.locator('[data-step="2"]').click();
    // One canonical catalogue, and the runtime adds nothing to it.
    const catalogue = await page.evaluate(() => window.__SBS_TEST_API.flowCatalog.length);
    expect(catalogue).toBe(35);
    expect(await page.locator('.flow-card').count()).toBe(catalogue);
    await expect(page.locator('.module-row').first()).toBeVisible();
  });
});
