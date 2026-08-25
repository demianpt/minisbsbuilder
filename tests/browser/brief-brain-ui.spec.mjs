import { expect, test } from '@playwright/test';
import { useAdvancedBuilder } from './support/builder-mode.mjs';

/**
 * The Brief Brain replaced the Website inspiration / Style DNA panel. These
 * tests stub the Brief Brain endpoints so the UI contract is verified without
 * depending on a running model: what matters here is that the readback is shown,
 * that the strategist can see what was understood, and that applying a result
 * mutates the project through the builder's own history.
 */

const BRIEF = {
  projectName: 'Harbour Dental',
  clientName: 'Harbour Dental',
  industry: 'Family dental practice in Portsmouth',
  audience: 'Local families and nervous adult patients',
  goal: 'Get a nervous new patient to book their first appointment online',
  offer: 'Gentle judgement-free dentistry with same-week emergency appointments',
  tone: 'Calm, plain and reassuring',
  keywords: 'gentle care, fixed pricing',
  notes: '',
};

const UNDERSTANDING = {
  source: 'ai',
  degraded: null,
  model: 'gemma4:31b',
  archetypeName: 'Warm / Human Modern',
  readback: {
    business: 'A family dental practice in Portsmouth.',
    audience: 'Local families and nervous adults.',
    offer: 'Gentle dentistry with same-week emergency slots.',
    goal: 'Book a first appointment online.',
    voice: 'Calm, plain, reassuring.',
  },
  confidence: 0.88,
  missingFields: [],
  keywords: ['gentle care', 'fixed pricing'],
  signals: [{ id: 'booking', label: 'Booking or enquiry led', score: 2 }],
  archetype: { key: 'C', reason: 'The voice asks for calm and the audience is anxious.' },
  flows: [
    { id: 'B11', reason: 'Clears every objection before the price.', fit: 0.95 },
    { id: 'C3', reason: 'Puts the booking path first.', fit: 0.82 },
    { id: 'B1', reason: 'Testimonials reduce fear.', fit: 0.7 },
    { id: 'E2', reason: 'A deeper service conversion journey gives the strategist more options.', fit: 0.64 },
    { id: 'E4', reason: 'Authority plus resources is useful for a trust-heavy brief.', fit: 0.58 },
  ],
};

const OUTLINE_PLAN = {
  source: 'ai',
  degraded: null,
  model: 'gemma4:31b',
  name: 'Proof-led booking path',
  rationale: 'Show the change, price it, prove it, then ask.',
  steps: [
    { requested: 'Hero', family: 'hero', reason: 'The promise comes first.' },
    { requested: 'Before after image gallery', family: 'gallery', reason: 'Paired images are a gallery.' },
    { requested: 'A pricing', family: 'pricing', reason: 'Price is the objection.' },
    { requested: 'Testimonials', family: 'testimonial', reason: 'Named patients reduce fear.' },
  ],
  added: [{ family: 'cta', reason: 'The page needs somewhere to land.', position: 'end' }],
  unresolved: [],
};

/** Answers /api/brief/* from the browser so no model or server is required. */
async function stubBrain(page, overrides = {}) {
  await page.route('**/api/brief/**', async (route) => {
    const url = route.request().url();
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.endsWith('/status')) return json({ provider: 'ollama', model: 'gemma4:31b', configured: true, available: true, modelAvailable: true, ...overrides.status });
    if (url.endsWith('/understand')) {
      if (overrides.understandError) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: overrides.understandError }) });
      return json({ ...UNDERSTANDING, ...overrides.understand });
    }
    if (url.endsWith('/outline')) return json({ ...OUTLINE_PLAN, ...overrides.outline });
    if (url.endsWith('/content')) {
      const families = JSON.parse(route.request().postData()).families;
      return json({
        source: 'ai',
        degraded: null,
        model: 'gemma4:31b',
        families,
        sections: families.map((family, index) => ({
          family,
          pretitle: `Pre ${index}`,
          title: `AI title for ${family}`,
          subtitle: family === 'hero' ? 'AI subtitle' : '',
          body: family === 'text' ? 'AI body copy.' : '',
          items: ['cards', 'faq', 'stats', 'timeline', 'pricing', 'testimonial', 'team', 'blog', 'tabs', 'gallery', 'slider', 'accordion', 'haccordion'].includes(family)
            ? [{ title: `Item A for ${family}`, description: 'Item A detail.', value: '01' }, { title: `Item B for ${family}`, description: 'Item B detail.', value: '02' }]
            : [],
          buttons: ['hero', 'cta', 'contact'].includes(family) ? [{ text: 'Book online', type: 'primary' }] : [],
        })),
        ...overrides.content,
      });
    }
    return json({});
  });
}

async function openBrief(page) {
  await useAdvancedBuilder(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
  await page.evaluate((brief) => {
    Object.assign(window.__SBS_TEST_API.state.project.brief, brief);
  }, BRIEF);
  await page.locator('[data-step="0"]').click();
  await expect(page.locator('.brain-panel')).toBeVisible();
}

test.describe('the AI brief reader (Step 01)', () => {
  test('no Style DNA surface survives anywhere in the editor', async ({ page }) => {
    await stubBrain(page);
    await openBrief(page);
    for (const step of [0, 1, 2, 3, 4]) {
      await page.locator(`[data-step="${step}"]`).click();
      await expect(page.locator('[data-style-dna-panel]')).toHaveCount(0);
      await expect(page.locator('#editorInner')).not.toContainText('Style DNA');
      await expect(page.locator('#editorInner')).not.toContainText('Website inspiration');
    }
  });

  test('shows how complete the brief is before spending model time', async ({ page }) => {
    await stubBrain(page);
    await openBrief(page);
    await expect(page.locator('.brain-readiness')).toContainText('fields filled in');
    await expect(page.locator('.brain-provider')).toContainText('AI model ready');
    await expect(page.locator('.brain-provider')).toContainText('gemma4:31b');
  });

  test('reads the brief and shows the readback beside the original fields', async ({ page }) => {
    await stubBrain(page);
    await openBrief(page);
    await page.locator('[data-brain-action="understand"]').click();

    const readback = page.locator('.brain-readback');
    await expect(readback).toBeVisible();
    // The confirmation the requirement asked for: what it understood, per field.
    await expect(readback).toContainText('A family dental practice in Portsmouth.');
    await expect(readback).toContainText('Book a first appointment online.');
    await expect(readback).toContainText('Calm, plain, reassuring.');
    // And the strategist's own words next to it, so a wrong reading is obvious.
    await expect(readback).toContainText(BRIEF.audience);
    await expect(readback).toContainText(BRIEF.goal);
    await expect(readback).toContainText('88% confident');
    await expect(readback).toContainText('gemma4:31b');
    await expect(page.locator('.brain-signals')).toContainText('Booking or enquiry led');
  });

  test('recommends one archetype and applies it on request', async ({ page }) => {
    await stubBrain(page);
    await openBrief(page);
    await page.locator('[data-brain-action="understand"]').click();
    const recommendation = page.locator('.brain-recommendation');
    await expect(recommendation).toContainText('C · Warm / Human Modern');
    await expect(recommendation).toContainText('the audience is anxious');

    await page.locator('[data-brain-action="apply-archetype"]').click();
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.design.archetype)).toBe('C');
    await expect(page.locator('[data-brain-action="apply-archetype"]')).toBeDisabled();
  });

  test('recommends exactly five flows and applies one on request', async ({ page }) => {
    await stubBrain(page);
    await openBrief(page);
    await page.locator('[data-brain-action="understand"]').click();
    await expect(page.locator('.brain-flow-list li')).toHaveCount(5);
    await expect(page.locator('.brain-flow-list li').first()).toContainText('Objection Clearing');
    await expect(page.locator('.brain-flow-list li').first()).toContainText('95%');

    await page.locator('[data-brain-action="apply-flow"]').first().click();
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.flowId)).toBe('B11');
  });

  test('says plainly when the brief has changed since it was read', async ({ page }) => {
    await stubBrain(page);
    await openBrief(page);
    await page.locator('[data-brain-action="understand"]').click();
    await expect(page.locator('.brain-readback')).toBeVisible();
    await page.locator('textarea[data-bind="brief.goal"]').fill('Sell a completely different thing');
    await page.locator('[data-step="1"]').click();
    await page.locator('[data-step="0"]').click();
    await expect(page.locator('.brain-panel')).toContainText('brief has changed since the brain last read it');
  });

  test('reports a model failure in plain language and stays usable', async ({ page }) => {
    await stubBrain(page, { understandError: { code: 'OLLAMA_UNAVAILABLE', message: 'nope' } });
    await openBrief(page);
    await page.locator('[data-brain-action="understand"]').click();
    await expect(page.locator('.brain-error')).toContainText('could not be reached');
    await expect(page.locator('[data-brain-action="understand"]')).toBeEnabled();
  });

  test('labels a degraded answer as coming from the built-in planner', async ({ page }) => {
    await stubBrain(page, {
      understand: { source: 'deterministic', degraded: { code: 'OLLAMA_UNAVAILABLE', message: 'The AI model could not answer in time, so the built-in planner answered instead.' } },
    });
    await openBrief(page);
    await page.locator('[data-brain-action="understand"]').click();
    await expect(page.locator('.brain-source.is-local')).toContainText('Built-in planner');
    await expect(page.locator('.brain-source.is-local')).toContainText('built-in planner answered instead');
  });
});

test.describe('AI page content', () => {
  test('drafts content for the whole flow, then applies it as one undo step', async ({ page }) => {
    await stubBrain(page);
    await openBrief(page);
    await page.locator('[data-brain-action="write-content"]').click();

    const draft = page.locator('.brain-draft');
    await expect(draft).toBeVisible();
    await expect(draft).toContainText('AI title for hero');
    const familyCount = await page.evaluate(() => window.__SBS_TEST_API.state.project.sections.length);
    await expect(draft.locator('ol > li')).toHaveCount(familyCount);

    const before = await page.evaluate(() => window.__SBS_TEST_API.state.project.sections.map((section) => section.content.title));
    await page.locator('[data-brain-action="apply-content"]').click();
    const after = await page.evaluate(() => window.__SBS_TEST_API.state.project.sections.map((section) => section.content.title));
    expect(after).not.toEqual(before);
    expect(after[0]).toBe('AI title for hero');

    // One undo must return the whole page, not one section.
    await page.locator('#undoBtn').click();
    const undone = await page.evaluate(() => window.__SBS_TEST_API.state.project.sections.map((section) => section.content.title));
    expect(undone).toEqual(before);
  });

  test('writes the AI copy into the registered DST node, not just the model', async ({ page }) => {
    await stubBrain(page);
    await openBrief(page);
    await page.locator('[data-brain-action="write-content"]').click();
    await page.locator('[data-brain-action="apply-content"]').click();
    // Applying content touches every module, so the preview rebuild is the
    // slowest in the suite; give it room rather than racing it under load.
    await expect.poll(
      () => page.locator('#sitePreview').evaluate((frame) => frame.contentDocument.body.textContent),
      { timeout: 20_000 },
    ).toContain('AI title for hero');
    const html = await page.evaluate(() => window.__SBS_TEST_API.buildSiteDocument());
    expect(html).toContain('AI title for hero');
    const exported = await page.evaluate(() => JSON.stringify(window.__SBS_TEST_API.buildPageExport()));
    expect(exported).toContain('AI title for hero');
  });

  test('maps repeated items onto each family\'s own content model', async ({ page }) => {
    await stubBrain(page);
    await openBrief(page);
    await page.evaluate(() => window.__SBS_TEST_API.brain.applyCustomFlow({
      name: 'Item probe', rationale: 'test', families: ['hero', 'stats', 'timeline', 'faq', 'pricing', 'cta'],
    }));
    await page.locator('[data-step="0"]').click();
    await page.locator('[data-brain-action="write-content"]').click();
    await page.locator('[data-brain-action="apply-content"]').click();

    const shapes = await page.evaluate(() => {
      const byFamily = {};
      for (const section of window.__SBS_TEST_API.state.project.sections) byFamily[section.family] = section.content;
      return {
        // Statistics keep value/label/description; the renderer needs those names.
        stats: Object.keys(byFamily.stats.items[0]).sort(),
        timeline: Object.keys(byFamily.timeline.items[0]).sort(),
        faq: Object.keys(byFamily.faq.items[0]).sort(),
        pricing: Object.keys(byFamily.pricing.items[0]).sort(),
        statsLabel: byFamily.stats.items[0].label,
        faqQuestion: byFamily.faq.items[0].title,
        pricingKeepsPrice: typeof byFamily.pricing.items[0].price,
      };
    });
    expect(shapes.stats).toEqual(['description', 'label', 'value']);
    expect(shapes.timeline).toEqual(['text', 'title', 'value']);
    expect(shapes.faq).toEqual(['text', 'title']);
    expect(shapes.pricing).toContain('price');
    expect(shapes.pricing).toContain('features');
    expect(shapes.statsLabel).toContain('Item A for stats');
    expect(shapes.faqQuestion).toContain('Item A for faq');
    expect(shapes.pricingKeepsPrice).toBe('string');
  });

  test('writes the footer as well as the modules, and it is one undo', async ({ page }) => {
    const footer = { statement: 'Readiness you can hand over.', description: 'Continuity programmes that survive the handover.', ctaText: 'Request a briefing' };
    await stubBrain(page, { content: { footer } });
    await openBrief(page);
    const before = await page.evaluate(() => {
      const part = window.__SBS_TEST_API.state.project.footer;
      return { statement: part.statement, description: part.description, cta: part.cta.text };
    });

    await page.locator('[data-brain-action="write-content"]').click();
    // The footer is reviewed with the sections, because it is applied with them.
    const draft = page.locator('.brain-draft');
    await expect(draft).toContainText('and the footer drafted');
    await expect(draft.locator('.brain-draft-family', { hasText: 'Footer' })).toHaveCount(1);
    await expect(draft).toContainText(footer.statement);

    await page.locator('[data-brain-action="apply-content"]').click();
    const after = await page.evaluate(() => {
      const part = window.__SBS_TEST_API.state.project.footer;
      return { statement: part.statement, description: part.description, cta: part.cta.text };
    });
    expect(after).toEqual({ statement: footer.statement, description: footer.description, cta: footer.ctaText });
    expect(after).not.toEqual(before);

    // The closing band on the rendered page and in the exported footer JSON.
    await expect.poll(
      () => page.locator('#sitePreview').evaluate((frame) => frame.contentDocument.querySelector('.site-footer')?.textContent || ''),
      { timeout: 20_000 },
    ).toContain(footer.statement);
    const exported = await page.evaluate(() => JSON.stringify(window.__SBS_TEST_API.buildFooterExport()));
    expect(exported).toContain(footer.statement);
    expect(exported).toContain(footer.ctaText);

    // The same single undo that returns the modules returns the footer.
    await page.locator('#undoBtn').click();
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.footer.statement)).toBe(before.statement);
  });

  test('leaves the footer alone when the draft carries no closing copy', async ({ page }) => {
    await stubBrain(page);
    await openBrief(page);
    const before = await page.evaluate(() => window.__SBS_TEST_API.state.project.footer.statement);
    await page.locator('[data-brain-action="write-content"]').click();
    await expect(page.locator('.brain-draft')).not.toContainText('and the footer drafted');
    await page.locator('[data-brain-action="apply-content"]').click();
    expect(await page.evaluate(() => window.__SBS_TEST_API.state.project.footer.statement)).toBe(before);
  });

  test('a discarded draft leaves the page untouched', async ({ page }) => {
    await stubBrain(page);
    await openBrief(page);
    const before = await page.evaluate(() => window.__SBS_TEST_API.state.project.sections.map((section) => section.content.title));
    await page.locator('[data-brain-action="write-content"]').click();
    await page.locator('[data-brain-action="discard-content"]').click();
    await expect(page.locator('.brain-draft')).toHaveCount(0);
    const after = await page.evaluate(() => window.__SBS_TEST_API.state.project.sections.map((section) => section.content.title));
    expect(after).toEqual(before);
  });
});

test.describe('the AI flow planner (Step 03)', () => {
  test('ranks the library and offers the typed-outline builder', async ({ page }) => {
    await stubBrain(page);
    await openBrief(page);
    await page.locator('[data-step="2"]').click();
    await expect(page.locator('.brain-panel.is-flow')).toBeVisible();
    await expect(page.locator('.brain-panel.is-flow')).toContainText('The five best flows for this brief');
    await expect(page.locator('#brain-outline')).toBeVisible();
    // More flows than the original library, and every one is selectable.
    const flowCount = await page.locator('.flow-card').count();
    expect(flowCount).toBeGreaterThanOrEqual(30);
  });

  test('turns a typed outline into a real page flow of registered patterns', async ({ page }) => {
    await stubBrain(page);
    await openBrief(page);
    await page.locator('[data-step="2"]').click();
    await page.locator('#brain-outline').fill('The page will have 1. Hero 2. Before after image gallery 3. A pricing 4. Testimonials');
    await page.locator('[data-brain-action="plan-outline"]').click();

    const plan = page.locator('.brain-plan');
    await expect(plan).toContainText('Proof-led booking path');
    await expect(plan.locator('.brain-plan-steps li')).toHaveCount(4);
    await expect(plan).toContainText('Before after image gallery');
    await expect(plan).toContainText('Paired images are a gallery.');
    await expect(plan.locator('.brain-plan-added')).toContainText('Call to action');

    await page.locator('[data-brain-action="apply-outline"]').click();
    const applied = await page.evaluate(() => ({
      families: window.__SBS_TEST_API.state.project.sections.map((section) => section.family),
      patterns: window.__SBS_TEST_API.state.project.sections.map((section) => section.patternId),
      flowId: window.__SBS_TEST_API.state.project.flowId,
    }));
    expect(applied.families).toEqual(['hero', 'gallery', 'pricing', 'testimonial', 'cta']);
    // Every step became a real registered SBS pattern.
    const known = await page.evaluate(() => window.__SBS_TEST_API.patternIds);
    for (const pattern of applied.patterns) expect(known).toContain(pattern);
    expect(applied.flowId).toMatch(/^X\d+$/);
  });

  test('lets the strategist correct a mapping the brain got wrong', async ({ page }) => {
    await stubBrain(page);
    await openBrief(page);
    await page.locator('[data-step="2"]').click();
    await page.locator('#brain-outline').fill('1. Hero 2. Before after image gallery 3. A pricing 4. Testimonials');
    await page.locator('[data-brain-action="plan-outline"]').click();
    // "Before after" is genuinely ambiguous between a gallery and a media+text
    // band, so the choice has to be reversible without retyping the outline.
    await page.locator('.brain-plan-steps li').nth(1).locator('select').selectOption('split');
    await page.locator('[data-brain-action="apply-outline"]').click();
    const families = await page.evaluate(() => window.__SBS_TEST_API.state.project.sections.map((section) => section.family));
    expect(families).toEqual(['hero', 'split', 'pricing', 'testimonial', 'cta']);
  });

  /*
   * "The page will have…" over an empty box asks the strategist to guess the
   * vocabulary, and a guess the mapper cannot resolve comes back as an unresolved
   * line. Every family the engine can build is listed with what it is for, and each
   * one adds itself to the outline.
   */
  test('lists every section that can be asked for, and adds them on click', async ({ page }) => {
    await stubBrain(page);
    await openBrief(page);
    await page.locator('[data-step="2"]').click();

    const reference = page.locator('.outline-reference');
    await expect(reference).toBeVisible();
    // Open to begin with: somebody who has not written an outline is exactly who
    // needs to see the list.
    expect(await reference.evaluate((node) => node.open)).toBe(true);
    const sections = page.locator('.outline-section');
    const families = await page.evaluate(() => window.__SBS_TEST_API.brain.sectionFamilies.length);
    await expect(sections).toHaveCount(families);
    await expect(reference.locator('summary')).toContainText(`${families} registered sections`);
    // Each one names itself and says what it is for, so the list is a reference and
    // not just a set of labels.
    for (const locator of [sections.first(), sections.last()]) {
      expect((await locator.locator('b').textContent()).trim().length).toBeGreaterThan(2);
      expect((await locator.locator('span').textContent()).trim().length).toBeGreaterThan(15);
    }

    const clickSection = async (label) => {
      await page.locator('.outline-section', { has: page.locator(`b:text-is("${label}")`) }).first().click();
    };
    // A flow is a sequence, so the same family may be asked for twice.
    for (const label of ['Hero', 'Cards', 'Statistics', 'Cards']) await clickSection(label);
    await expect(page.locator('#brain-outline')).toHaveValue('1. Hero\n2. Cards\n3. Statistics\n4. Cards');
    // The list must not collapse as sections are added, or a second click is
    // impossible — which was the whole point of it.
    expect(await reference.evaluate((node) => node.open)).toBe(true);
    await expect(page.locator('.outline-section.is-used')).toHaveCount(3);

    // Closed on request, and it stays closed through the re-render.
    await reference.locator('summary').click();
    await expect.poll(() => reference.evaluate((node) => node.open)).toBe(false);
    await expect(sections.first()).toBeHidden();
    await reference.locator('summary').click();
    await expect.poll(() => reference.evaluate((node) => node.open)).toBe(true);

    // And what was clicked maps to real registered families.
    await page.locator('[data-brain-action="plan-outline"]').click();
    await expect.poll(() => page.evaluate(() => (window.__SBS_TEST_API.state.project.brain.outlinePlan?.steps || []).length)).toBeGreaterThan(0);
  });

  test('a custom outline flow survives a reload', async ({ page }) => {
    await stubBrain(page);
    await openBrief(page);
    await page.locator('[data-step="2"]').click();
    await page.locator('#brain-outline').fill('1. Hero 2. Pricing 3. Testimonials');
    await page.locator('[data-brain-action="plan-outline"]').click();
    await page.locator('[data-brain-action="apply-outline"]').click();
    const flowId = await page.evaluate(() => window.__SBS_TEST_API.state.project.flowId);

    // `customFlows` is initialised to [] on every load, so wait for the saved
    // flow id itself: autosave is debounced and a reload before it flushes
    // would be testing the debounce, not the persistence. The flow the concept
    // is on lives inside its workspace; the typed flow itself is project-level,
    // because all three concepts may use it.
    await expect.poll(() => page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('sbs-builder-v3') || '{}');
      const set = saved.project?.conceptSet;
      const active = set?.concepts?.[set?.activeConceptId];
      return [active?.flowId, (saved.project?.customFlows || []).map((flow) => flow.id).join(',')].join('|');
    })).toBe(`${flowId}|${flowId}`);
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
    // A flow id that no longer resolves would silently reset the page to flow one.
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.flowId)).toBe(flowId);
    /*
     * It resolves through the project, not through the catalogue.
     *
     * A typed flow used to be pushed onto `DATA.flows` on load, which made it
     * indistinguishable from the 35 authored flows and grew the catalogue for
     * every project a session opened. It now stays on the project and `allFlows()`
     * is the only view that joins the two.
     */
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.allFlows().some((flow) => flow.id === window.__SBS_TEST_API.state.project.flowId))).toBe(true);
    expect(await page.evaluate(() => window.__SBS_TEST_API.flowIds.includes(window.__SBS_TEST_API.state.project.flowId))).toBe(false);
  });

  test('refuses to build a flow with nothing mapped', async ({ page }) => {
    await stubBrain(page, { outline: { steps: [{ requested: 'zzz', family: 'hero', reason: '' }], added: [] } });
    await openBrief(page);
    await page.locator('[data-step="2"]').click();
    await expect(page.locator('[data-brain-action="plan-outline"]')).toBeDisabled();
    await page.locator('#brain-outline').fill('zzz');
    await expect(page.locator('[data-brain-action="plan-outline"]')).toBeEnabled();
  });
});
