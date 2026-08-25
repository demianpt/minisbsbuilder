import { expect, test } from '@playwright/test';
import { useAdvancedBuilder } from './support/builder-mode.mjs';

/**
 * Copy over a photograph.
 *
 * The wash that keeps a headline readable on a picture existed for two families
 * — hero and cta — and an audit of all 154 registered patterns found nineteen
 * more that paint a photograph behind their copy and painted nothing over it:
 * six team bands, six card bands, two FAQ bands, two timelines, a text band and
 * a testimonial. Fifteen of those nineteen had *dark* copy, so the picture was
 * the only thing standing between the words and nothing.
 *
 * These tests are about the rule that replaced the family list: if a section
 * paints a photograph and is not already painting a wash, it gets the brand's
 * dark at 60% and its copy inverts to suit.
 */

async function boot(page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await useAdvancedBuilder(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
}

/** Renders one pattern on its own and reports what it paints over the picture. */
function renderPattern(page, patternId) {
  return page.evaluate((id) => {
    const api = window.__SBS_TEST_API;
    const pattern = api.patterns.find((entry) => entry.id === id);
    if (!pattern) throw new Error(`no such pattern: ${id}`);
    const project = api.state.project;
    const kept = project.sections;
    const section = api.createSection(pattern.family, 0, id);
    project.sections = [section];
    api.ensureProject(project);
    const html = api.buildSiteDocument(project);
    project.sections = kept;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const root = doc.querySelector('#sbs-site section');
    const overlay = root?.querySelector('.c-overlay');
    const style = overlay?.getAttribute('style') || '';
    return {
      family: pattern.family,
      picture: Boolean(root?.querySelector('.c-bg')),
      wash: overlay ? style : null,
      colour: (style.match(/background:([^;]+)/) || [null, null])[1]?.trim() ?? null,
      strength: Number((style.match(/opacity:([\d.]+)/) || [null, null])[1] ?? NaN),
      inverted: section.layout.inverted === true,
    };
  }, patternId);
}

test.describe('a photograph behind copy always gets a wash', () => {
  test('every picture in the catalogue has a wash beside it', async ({ page }) => {
    await boot(page);
    const audit = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      const project = api.state.project;
      const kept = project.sections;
      const bad = [];
      let pictures = 0;
      for (const pattern of api.patterns) {
        const section = api.createSection(pattern.family, 0, pattern.id);
        project.sections = [section];
        api.ensureProject(project);
        const doc = new DOMParser().parseFromString(api.buildSiteDocument(project), 'text/html');
        // Per picture, not per section: a band can carry a washed banner and an
        // unwashed one, and asking only whether the section has *a* wash
        // somewhere would call that fine.
        for (const picture of doc.querySelectorAll('#sbs-site .c-bg')) {
          pictures += 1;
          const owner = picture.parentElement;
          const washed = [...owner.children].some((child) => child.classList.contains('c-overlay'));
          if (!washed) bad.push(`${pattern.family}/${pattern.id} → ${owner.className.split(' ').slice(0, 3).join('.')}`);
        }
      }
      project.sections = kept;
      api.ensureProject(project);
      return { bad, pictures };
    });
    // The count is asserted so this cannot pass by the audit finding nothing.
    expect(audit.pictures).toBeGreaterThan(50);
    expect(audit.bad, 'pictures with nothing painted over them').toEqual([]);
  });

  test('a card that puts white type on a photograph still has its scrim', async ({ page }) => {
    await boot(page);
    const missing = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      const project = api.state.project;
      const kept = project.sections;
      const bad = [];
      for (const pattern of api.patterns) {
        const section = api.createSection(pattern.family, 0, pattern.id);
        project.sections = [section];
        api.ensureProject(project);
        const doc = new DOMParser().parseFromString(api.buildSiteDocument(project), 'text/html');
        for (const card of doc.querySelectorAll('.dst-card--media-background')) {
          if (!card.querySelector('.c-block__scrim')) bad.push(`${pattern.family}/${pattern.id}`);
        }
      }
      project.sections = kept;
      api.ensureProject(project);
      return bad;
    });
    expect(missing).toEqual([]);
  });

  test('the wash is the brand dark at 60%, and the copy inverts to suit', async ({ page }) => {
    await boot(page);
    const dark = await page.evaluate(() => window.__SBS_TEST_API.state.project.design.palette.dark);
    const channels = dark.replace('#', '').match(/../g).map((pair) => Number.parseInt(pair, 16));
    const expected = `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, 1.00)`;

    // One from each family the audit found unwashed, including the FAQ band
    // whose picture is three levels below the node the surface control edits.
    for (const id of [
      'sbs-team-p1-v1', 'sbs-cards-p1003-v1', 'sbs-faq-p6-v2',
      'sbs-timeline-p18-v2', 'sbs-layout-p998-v1', 'sbs-layout-p237-v4',
    ]) {
      const result = await renderPattern(page, id);
      expect(result.picture, `${id} should paint a picture`).toBe(true);
      expect(result.colour, id).toBe(expected);
      expect(result.strength, id).toBeCloseTo(0.6, 2);
      // A 60% wash is the ground, not a tint, so light copy is the only readable
      // answer — fifteen of these bands had dark copy before.
      expect(result.inverted, `${id} should invert its copy`).toBe(true);
    }
  });

  test('a pattern that paints its own wash keeps it exactly', async ({ page }) => {
    await boot(page);
    // Named colour at 60%.
    const authored = await renderPattern(page, 'sbs-hero-p89-v1');
    expect(authored.colour).toContain('#240800');
    expect(authored.strength).toBeCloseTo(0.6, 2);

    // A 27% tint is a tint: the photograph is still the ground and the copy
    // stays light. Strengthening this to 60% would be the same bug mirrored.
    const tint = await renderPattern(page, 'sbs-hero-p89-v2');
    expect(tint.strength).toBeCloseTo(0.27, 2);
    expect(tint.inverted).toBe(true);

    // A pale wash *is* the ground, so that band reads dark-on-light. The colour
    // itself was a pale *blue* in the export, which read as a mistake rather
    // than a decision behind a headline; it is white now.
    const pale = await renderPattern(page, 'sbs-hero-p89-v3');
    expect(pale.colour).toContain('#ffffff');
    expect(pale.colour).not.toMatch(/E3F8FF/i);
    expect(pale.inverted).toBe(false);
  });

  test('a wash nobody edited follows the brand; an edited one never moves', async ({ page }) => {
    await boot(page);
    const painted = () => page.evaluate(() => {
      const doc = new DOMParser().parseFromString(window.__SBS_TEST_API.buildSiteDocument(), 'text/html');
      return doc.querySelector('#sbs-site section .c-overlay')?.getAttribute('style') || 'NONE';
    });
    const moveBrand = (hex) => page.evaluate((value) => {
      const api = window.__SBS_TEST_API;
      api.state.project.design.palette.dark = value;
      api.ensureProject(api.state.project);
    }, hex);

    await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      api.state.project.sections = [api.createSection('team', 0, 'sbs-team-p1-v1')];
      api.ensureProject(api.state.project);
    });
    expect(await painted()).toContain('opacity:0.6');

    // Restyling a project moves its dark, and a navy scrim on a forest-green
    // brand is exactly the kind of thing nobody goes back to fix by hand.
    await moveBrand('#1B3A1F');
    expect(await painted()).toContain('rgba(27, 58, 31, 1.00)');

    // Edited by hand, on the node that carries it: never touched again.
    await page.evaluate(() => {
      const section = window.__SBS_TEST_API.state.project.sections[0];
      const walk = (node) => {
        const attrs = node.attributes || {};
        const raw = attrs.backgroundImage;
        const named = Array.isArray(raw) ? raw.length > 0 : Boolean(raw && (raw.src || raw.url || raw.id));
        if (named || node.component === 'ds-blocks/dst-banner') {
          attrs.backgroundOverlay = 'rgba(120, 0, 0, 1.00)';
          node.attributes = attrs;
          return true;
        }
        return (node.children || []).some(walk);
      };
      walk(section.node);
    });
    await moveBrand('#3A1B1B');
    expect(await painted()).toContain('rgba(120, 0, 0, 1.00)');
  });
});
