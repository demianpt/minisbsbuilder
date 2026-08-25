import { expect, test } from '@playwright/test';
import { useAdvancedBuilder } from './support/builder-mode.mjs';

async function openReview(page) {
  await useAdvancedBuilder(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
  await page.locator('[data-step="4"]').click();
  await expect(page.locator('.check-list')).toBeVisible();
}

function checks(page) {
  return page.$$eval('.check', (nodes) => nodes.map((node) => ({
    code: node.querySelector('code').textContent,
    status: node.className.replace('check ', '').trim(),
    title: node.querySelector('b').textContent,
    detail: node.querySelector('p').textContent,
  })));
}

async function revalidate(page) {
  await page.locator('[data-step="0"]').click();
  await page.locator('[data-step="4"]').click();
  await expect(page.locator('.check-list')).toBeVisible();
}

test.describe('preflight checks', () => {
  test('covers content, structure, design system, accessibility and provenance', async ({ page }) => {
    await openReview(page);
    const codes = (await checks(page)).map((check) => check.code);
    // The original ten are preserved…
    for (const code of ['STRUCTURE', 'HERO', 'PATTERNS', 'REGISTRY', 'CONTENT', 'MEDIA', 'MOTION', 'CTA', 'A11Y', 'EXPORT']) {
      expect(codes, code).toContain(code);
    }
    // …and the new gates a strategist can actually act on.
    for (const code of ['COPY', 'HEADLINE', 'UNIQUE', 'PROOF', 'CLOSE', 'RHYTHM', 'LENGTH', 'BUTTONS', 'MOTION-BUDGET', 'CONTRAST', 'TYPE', 'BRIEF', 'AI-READ', 'FLOW']) {
      expect(codes, code).toContain(code);
    }
    expect(new Set(codes).size).toBe(codes.length);
    // 24 gates plus the render audit, which only appears once the preview has
    // measured itself. Before this work there were 14.
    expect(codes.length).toBeGreaterThanOrEqual(27);

    // Every check must say something specific, not just pass or fail.
    for (const check of await checks(page)) {
      expect(check.title.length, check.code).toBeGreaterThan(10);
      expect(check.detail.length, check.code).toBeGreaterThan(10);
      expect(['pass', 'warn', 'fail'], check.code).toContain(check.status);
    }
  });

  test('the score reflects the checks rather than being decorative', async ({ page }) => {
    await openReview(page);
    /*
     * The render audit adds its own gate once the preview has measured itself,
     * which re-renders this step. Wait for that to settle, or the rendered score
     * and a freshly computed one legitimately disagree by one check.
     */
    await expect.poll(() => page.evaluate(() => Boolean(window.__SBS_TEST_API.state.previewAudit))).toBe(true);
    await expect.poll(async () => {
      const computed = await page.evaluate(() => window.__SBS_TEST_API.validate());
      const shown = Number(await page.locator('.score-card b').first().textContent());
      return shown === computed.score && computed.checks.length === (await checks(page)).length;
    }).toBe(true);
  });

  test('catches placeholder copy left in the page', async ({ page }) => {
    await openReview(page);
    const before = Number((await checks(page)).find((check) => check.code === 'COPY').detail.match(/^(\d+)/)?.[1] || 0);
    await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      api.state.project.sections[0].content.title = 'Replace with a real headline';
    });
    await revalidate(page);
    const copy = (await checks(page)).find((check) => check.code === 'COPY');
    expect(copy.status).toBe('warn');
    expect(Number(copy.detail.match(/^(\d+)/)[1])).toBe(before + 1);
    expect(copy.detail).toContain('draft instructions');
  });

  test('catches a headline that will wrap badly at display scale', async ({ page }) => {
    await openReview(page);
    await page.evaluate(() => {
      window.__SBS_TEST_API.state.project.sections[0].content.title = 'A'.repeat(120);
    });
    await revalidate(page);
    expect((await checks(page)).find((check) => check.code === 'HEADLINE').status).toBe('warn');
  });

  test('catches a repeated headline', async ({ page }) => {
    await openReview(page);
    await page.evaluate(() => {
      const sections = window.__SBS_TEST_API.state.project.sections;
      sections[1].content.title = sections[0].content.title;
    });
    await revalidate(page);
    expect((await checks(page)).find((check) => check.code === 'UNIQUE').status).toBe('warn');
  });

  test('catches a page with no proof and no closing action', async ({ page }) => {
    await openReview(page);
    await page.evaluate(() => window.__SBS_TEST_API.brain.applyCustomFlow({
      name: 'No proof', rationale: 'test', families: ['hero', 'text', 'split'],
    }));
    await revalidate(page);
    const result = await checks(page);
    expect(result.find((check) => check.code === 'PROOF').status).toBe('warn');
    expect(result.find((check) => check.code === 'CLOSE').status).toBe('warn');
    expect(result.find((check) => check.code === 'PROOF').detail).toContain('No testimonials');
  });

  test('catches two identical devices in a row', async ({ page }) => {
    await openReview(page);
    await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      const extra = api.createSection('cards', 1);
      api.state.project.sections.splice(1, 0, api.createSection('cards', 0), extra);
    });
    await revalidate(page);
    const rhythm = (await checks(page)).find((check) => check.code === 'RHYTHM');
    expect(rhythm.status).toBe('warn');
    expect(rhythm.detail).toContain('Cards');
  });

  test('fails a palette that cannot carry body text', async ({ page }) => {
    await openReview(page);
    /*
     * Hand-picked, so it is kept and reported rather than quietly corrected.
     * That is the split the builder now draws: colours it *generates* are
     * guaranteed legible, colours a person chose are theirs — and the preflight
     * is where they find out what they chose costs.
     */
    await page.evaluate(() => {
      const design = window.__SBS_TEST_API.state.project.design;
      design.paletteLocked = true;
      design.palette.bg = '#8a8a8a';
      design.palette.ink = '#909090';
    });
    await revalidate(page);
    const contrast = (await checks(page)).find((check) => check.code === 'CONTRAST');
    expect(contrast.status).toBe('warn');
    expect(contrast.detail).toContain('4.5:1');
    expect(contrast.detail).toContain('picked by hand');
    // Untouched, because a decision is a decision.
    expect(await page.evaluate(() => window.__SBS_TEST_API.state.project.design.palette.ink)).toBe('#909090');
  });

  test('repairs a generated palette that cannot carry body text, and says what it moved', async ({ page }) => {
    await openReview(page);
    // The same unreadable pair, arriving the way a concept or an archetype
    // would: nobody picked it, so nobody has to live with it.
    await page.evaluate(() => {
      const design = window.__SBS_TEST_API.state.project.design;
      design.paletteLocked = false;
      design.paletteSignature = '';
      design.palette.bg = '#8a8a8a';
      design.palette.ink = '#909090';
    });
    await revalidate(page);
    const contrast = (await checks(page)).find((check) => check.code === 'CONTRAST');
    expect(contrast.status).toBe('pass');
    expect(contrast.detail).toContain('adjusted');
    const design = await page.evaluate(() => window.__SBS_TEST_API.state.project.design);
    expect(design.palette.ink).not.toBe('#909090');
    expect(design.paletteRepairs.map((entry) => entry.role)).toContain('ink');
  });

  test('reports whether the AI actually read the brief', async ({ page }) => {
    await openReview(page);
    expect((await checks(page)).find((check) => check.code === 'AI-READ').status).toBe('warn');
    await page.evaluate(() => {
      window.__SBS_TEST_API.state.project.brain.understanding = {
        source: 'ai', model: 'gemma4:31b', confidence: 0.91, readback: {}, flows: [], archetype: { key: 'A' },
      };
    });
    await revalidate(page);
    const read = (await checks(page)).find((check) => check.code === 'AI-READ');
    expect(read.status).toBe('pass');
    expect(read.detail).toContain('gemma4:31b');
    expect(read.detail).toContain('91%');
  });

  test('names the button family and the movement level in use', async ({ page }) => {
    await openReview(page);
    await page.evaluate(() => {
      window.__SBS_TEST_API.state.project.design.buttonStyle = 'pill-glow';
      window.__SBS_TEST_API.state.project.design.motion = 0;
    });
    await revalidate(page);
    const result = await checks(page);
    expect(result.find((check) => check.code === 'BUTTONS').detail).toContain('Pill Glow');
    expect(result.find((check) => check.code === 'MOTION-BUDGET').detail).toContain('switched off');
  });

  test('reports flow provenance, including a custom outline flow', async ({ page }) => {
    await openReview(page);
    expect((await checks(page)).find((check) => check.code === 'FLOW').detail).toContain('Library flow');
    await page.evaluate(() => window.__SBS_TEST_API.brain.applyCustomFlow({
      name: 'Typed by hand', rationale: 'test', families: ['hero', 'cards', 'cta'],
    }));
    await revalidate(page);
    const flow = (await checks(page)).find((check) => check.code === 'FLOW');
    expect(flow.status).toBe('pass');
    expect(flow.detail).toContain('Custom outline flow "Typed by hand"');
  });

  test('warns when the brief cannot support the page', async ({ page }) => {
    await openReview(page);
    expect((await checks(page)).find((check) => check.code === 'BRIEF').status).toBe('pass');
    await page.evaluate(() => {
      const brief = window.__SBS_TEST_API.state.project.brief;
      for (const key of ['industry', 'audience', 'goal', 'offer']) brief[key] = '';
    });
    await revalidate(page);
    const brief = (await checks(page)).find((check) => check.code === 'BRIEF');
    expect(brief.status).toBe('fail');
    expect(brief.detail).toContain('0 of 4');
  });

  test('the validation travels with the export', async ({ page }) => {
    await openReview(page);
    const exported = await page.evaluate(() => window.__SBS_TEST_API.buildCompleteExport());
    expect(exported.__status.validation.checks.length).toBeGreaterThanOrEqual(27);
    expect(exported.__status.validation.score).toBeGreaterThan(0);
  });
});
