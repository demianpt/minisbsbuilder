import { expect, test } from '@playwright/test';
import { useAdvancedBuilder } from './support/builder-mode.mjs';

const apiKeys = [
  'version', 'ensureProject', 'buildSiteDocument', 'buildPageExport',
  'buildNavigationExport', 'buildFooterExport', 'buildGlobalsExport',
  'buildCompleteExport', 'auditDocument', 'createSection', 'patternIds', 'state',
];

async function openClean(page) {
  await page.addInitScript(() => localStorage.clear());
  await useAdvancedBuilder(page);
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
}

function inspectExports() {
  const api = window.__SBS_TEST_API;
  const project = structuredClone(api.state.project);
  const page = api.buildPageExport(structuredClone(project));
  const navigation = api.buildNavigationExport(structuredClone(project));
  const footer = api.buildFooterExport(structuredClone(project));
  const globals = api.buildGlobalsExport(structuredClone(project));
  const complete = api.buildCompleteExport(structuredClone(project));
  const html = api.buildSiteDocument(structuredClone(project));
  const document = new DOMParser().parseFromString(html, 'text/html');
  const components = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.component) components.push(node.component);
    (node.children || []).forEach(walk);
  };
  page.concept.page.sections.forEach(walk);
  walk(navigation.concept.global.navigation);
  walk(footer.concept.global.footer);
  return {
    project,
    page,
    navigation,
    footer,
    globals,
    complete,
    html,
    components,
    siteExists: Boolean(document.querySelector('#sbs-site')),
    headerExists: Boolean(document.querySelector('[data-dst-component="ds-blocks/dst-navigation"]')),
    footerExists: Boolean(document.querySelector('[data-dst-component="global-footer"]')),
    hasReducedMotion: html.includes('prefers-reduced-motion'),
  };
}

test.describe('existing builder baseline', () => {
  test('initializes the default project, keeps the test API, and produces all existing exports', async ({ page }) => {
    await openClean(page);
    const result = await page.evaluate(inspectExports);

    expect(await page.locator('.step-btn').count()).toBe(5);
    expect(result.project.design.archetype).toBe('A');
    expect(result.project.sections.length).toBeGreaterThan(4);
    expect(result.components.length).toBeGreaterThan(10);
    expect(result.components.every((component) => component.startsWith('ds-blocks/') || component.startsWith('core/') || component === 'gravityforms/form')).toBeTruthy();
    expect(result.siteExists).toBeTruthy();
    expect(result.headerExists).toBeTruthy();
    expect(result.footerExists).toBeTruthy();
    expect(result.hasReducedMotion).toBeTruthy();
    expect(result.page.artifactType).toBe('page');
    expect(result.navigation.artifactType).toBe('navigation');
    expect(result.footer.artifactType).toBe('footer');
    expect(result.globals.artifactType).toBe('globals');
    expect(result.complete.artifactType).toBe('complete-project');

    const keys = await page.evaluate(() => Object.keys(window.__SBS_TEST_API));
    apiKeys.forEach((key) => expect(keys).toContain(key));
  });

  test('migrates both v1 and v2 persisted projects without losing their page data', async ({ page }) => {
    await page.addInitScript(() => {
      const base = {
        id: 'legacy-project',
        client: 'Legacy client',
        brief: { projectName: 'Legacy project', clientName: 'Legacy client', goal: 'Keep working', keywords: 'legacy' },
        design: { archetype: 'C', palette: { bg: '#ffffff', ink: '#111111', accent: '#aa0000', soft: '#eeeeee', dark: '#111111' }, fontBody: 'Inter', fontDisplay: 'Lora', radius: '8px', density: 40, expressiveness: 50, motion: 30 },
        flowId: 'B2',
        sections: [],
      };
      localStorage.setItem('sbs-dst-page-builder-v1', JSON.stringify({ project: base, currentStep: 1, device: 'tablet', zoom: 0.7 }));
    });
    await useAdvancedBuilder(page);
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
    let legacy = await page.evaluate(() => ({
      project: window.__SBS_TEST_API.state.project,
      step: window.__SBS_TEST_API.state.currentStep,
      device: window.__SBS_TEST_API.state.device,
    }));
    expect(legacy.project.brief.projectName).toBe('Legacy project');
    expect(legacy.project.design.archetype).toBe('C');
    expect(legacy.project.header).toBeTruthy();
    expect(legacy.project.footer).toBeTruthy();
    expect(legacy.step).toBe(1);
    expect(legacy.device).toBe('tablet');
    // The migrated project is V1 exactly as it was, with the other two slots
    // left empty: an older client's approved work is never re-derived.
    const concepts = await page.evaluate(() => window.__SBS_TEST_API.concepts.list().map((concept) => ({
      id: concept.id, status: concept.status, flowId: concept.flowId, archetype: concept.design?.archetype,
    })));
    expect(concepts.map((concept) => concept.status)).toEqual(['generated', 'empty', 'empty']);
    expect(concepts[0]).toMatchObject({ id: 'v1', flowId: 'B2', archetype: 'C' });
    expect(await page.evaluate(() => window.__SBS_TEST_API.concepts.activeId())).toBe('v1');
    expect(await page.evaluate(() => window.__SBS_TEST_API.concepts.migration.from)).toBe('sbs-project/2.x');

    // The editor autosaves on a debounce, so wait for its own write to land
    // before replacing it — otherwise a save in flight clobbers the fixture
    // between the write and the reload.
    await expect
      .poll(() => page.evaluate(() => Boolean(localStorage.getItem('sbs-builder-v3'))))
      .toBe(true);
    await page.evaluate(() => {
      const envelope = JSON.parse(localStorage.getItem('sbs-dst-page-builder-v1'));
      envelope.project.brief.projectName = 'V2 project';
      localStorage.clear();
      localStorage.setItem('sbs-dst-page-builder-v2', JSON.stringify(envelope));
    });
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
    legacy = await page.evaluate(() => window.__SBS_TEST_API.state.project.brief.projectName);
    expect(legacy).toBe('V2 project');
  });

  test('retains archetypes, Direction controls, responsive previews, module edits, and undo/redo', async ({ page }) => {
    await openClean(page);
    await page.locator('[data-step="1"]').click();

    for (const archetype of 'ABCDEFGHIJKLM') {
      await page.locator(`[data-archetype="${archetype}"]`).click();
      await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.design.archetype)).toBe(archetype);
    }

    const beforeDensity = await page.evaluate(() => window.__SBS_TEST_API.state.project.design.density);
    await page.locator('input[data-bind="design.density"]').fill('73');
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.design.density)).toBe(73);
    expect(beforeDensity).not.toBe(73);

    const firstSectionTitle = await page.evaluate(() => window.__SBS_TEST_API.state.project.sections[0].content.title);
    await page.locator('[data-step="3"]').click();
    await page.locator('.module-row').first().click();
    await page.locator('textarea[data-bind*=".title"]').first().fill('Edited real DST module');
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.sections[0].content.title)).toBe('Edited real DST module');
    await page.locator('#undoBtn').click();
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.sections[0].content.title)).toBe(firstSectionTitle);
    await page.locator('#redoBtn').click();
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.sections[0].content.title)).toBe('Edited real DST module');

    for (const device of ['desktop', 'tablet', 'mobile']) {
      await page.locator(`[data-device="${device}"]`).click();
      await expect(page.locator('#deviceShell')).toHaveClass(new RegExp(`\\b${device}\\b`));
    }
  });

  test('keeps editable navigation/footer and standalone DST output intact', async ({ page }) => {
    await openClean(page);
    await page.locator('[data-step="0"]').click();
    await page.locator('input[data-bind="global.header.logoText"]').fill('Builder proof');
    await page.locator('textarea[data-bind="global.footer.statement"]').fill('A distinct footer proof.');
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.header.logoText)).toBe('Builder proof');
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.footer.statement)).toBe('A distinct footer proof.');

    const output = await page.evaluate(inspectExports);
    expect(output.html).toContain('Builder proof');
    expect(output.html).toContain('A distinct footer proof.');
    expect(output.html).toContain('data-dst-component');
    expect(output.html).not.toMatch(/undefined|NaN|\[object Object\]/);
  });
});
