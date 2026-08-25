import { expect, test } from '@playwright/test';
import { useAdvancedBuilder } from './support/builder-mode.mjs';

/**
 * Stepping the navigation and the footer from the preview.
 *
 * The two global parts used to be the only things on the page you could not
 * change by hovering them: the overlay explicitly ignored them, with the note
 * that neither was "a module anyone can swap". They are now addressed the same
 * way a module is — same overlay, same arrows, same keys — with their layout
 * variant standing in for the pattern.
 */

async function openPreview(page) {
  await page.addInitScript(() => localStorage.clear());
  await useAdvancedBuilder(page);
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
  await page.locator('[data-step="3"]').click();
  const preview = page.locator('#sitePreview');
  await expect.poll(() => preview.evaluate((frame) => Boolean(frame.contentDocument?.querySelector('#sbs-site')))).toBe(true);
  // The step change queues its own rebuild; hovering into a frame that is about
  // to be replaced is how this reads as flaky rather than as a failure.
  await page.waitForTimeout(1200);
  return preview;
}

/**
 * Puts the pointer on a global part.
 *
 * The frame is scaled with CSS zoom, so a point computed from an element's box
 * inside it does not survive the coordinate translation. Sweeping the stage and
 * asking the overlay what it is over is the reliable way in, and it is also
 * exactly what a person does with a mouse.
 */
async function hoverPart(page, id, { bottom = false } = {}) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.locator('#sitePreview').evaluate((frame, toBottom) => {
      frame.contentWindow.scrollTo(0, toBottom ? 999999 : 0);
    }, bottom);
    await page.waitForTimeout(400);
    const stage = await page.locator('.preview-stage').boundingBox();
    for (let y = 20; y < stage.height - 10; y += 40) {
      await page.mouse.move(stage.x + stage.width / 2, stage.y + y);
      await page.mouse.move(stage.x + stage.width / 2 + 2, stage.y + y + 1);
      await page.waitForTimeout(60);
      const hovered = await page.evaluate(() => window.__SBS_TEST_API.previewSwitcher.hoverId());
      if (hovered === id) return;
    }
  }
  throw new Error(`the overlay never reported ${id} under the pointer`);
}

const overlay = (page) => page.evaluate(() => {
  const root = document.getElementById('previewHud');
  return {
    hidden: root.hidden,
    chrome: root.classList.contains('is-chrome'),
    badge: root.querySelector('.pv-hud__index').textContent,
    label: root.querySelector('.pv-hud__copy b').textContent,
    part: root.querySelector('.pv-hud__copy span').textContent,
    count: root.querySelector('.pv-hud__count').textContent,
    tools: [...root.querySelectorAll('.pv-hud__tool')].map((button) => button.dataset.pv),
    hint: root.querySelector('.pv-hud__hint').textContent,
  };
});

test.describe('the navigation and the footer step like a module', () => {
  test('hovering the navigation names its layout and its place in the set', async ({ page }) => {
    await openPreview(page);
    await hoverPart(page, '@header');
    const hud = await overlay(page);
    expect(hud.hidden).toBe(false);
    expect(hud.chrome).toBe(true);
    expect(hud.badge).toBe('NAV');
    expect(hud.part).toBe('Global navigation');
    expect(hud.count).toBe('1 / 5');
    expect(hud.label).toContain('Standard');
    // The phone takeover is the one navigation decision nobody remembers to go
    // and check, so it is offered here rather than only in the global editors.
    expect(hud.tools).toEqual(['mobile', 'globals']);
    expect(hud.hint).toContain('navigation layout');
  });

  test('the overlay never covers the navigation it is describing', async ({ page }) => {
    await openPreview(page);
    await hoverPart(page, '@header');

    // The navigation is 80-odd pixels tall and every one of them is a control:
    // logo, links, the action, the burger. The overlay's own bar, tools and
    // arrows used to sit straight on top of them, which made the burger
    // unclickable exactly when you were looking at the navigation.
    const overlapping = await page.evaluate(() => {
      const frame = document.getElementById('sitePreview');
      const zoom = window.__SBS_TEST_API.state.zoom || 1;
      const frameBox = frame.getBoundingClientRect();
      const header = frame.contentDocument.querySelector('.site-header').getBoundingClientRect();
      const box = {
        top: frameBox.top + header.top * zoom,
        bottom: frameBox.top + header.bottom * zoom,
        left: frameBox.left + header.left * zoom,
        right: frameBox.left + header.right * zoom,
      };
      return [...document.querySelectorAll('#previewHud .pv-hud__bar, #previewHud .pv-hud__tools, #previewHud .pv-hud__arrow')]
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          if (!rect.width || !rect.height) return false;
          return rect.left < box.right && rect.right > box.left && rect.top < box.bottom && rect.bottom > box.top;
        })
        .map((node) => node.className);
    });
    expect(overlapping, 'overlay controls sitting on the navigation').toEqual([]);
  });

  test('the burger can be clicked while the overlay is showing', async ({ page }) => {
    await openPreview(page);
    await page.locator('.device-btn[data-device="mobile"]').click();
    await page.waitForTimeout(900);
    await hoverPart(page, '@header');
    const point = await page.evaluate(() => {
      const frame = document.getElementById('sitePreview');
      const zoom = window.__SBS_TEST_API.state.zoom || 1;
      const frameBox = frame.getBoundingClientRect();
      const toggle = frame.contentDocument.querySelector('.sbs-menu-toggle').getBoundingClientRect();
      return {
        x: frameBox.left + (toggle.left + toggle.width / 2) * zoom,
        y: frameBox.top + (toggle.top + toggle.height / 2) * zoom,
      };
    });
    await page.mouse.click(point.x, point.y);
    await expect.poll(() => page.locator('#sitePreview').evaluate((frame) => frame.contentDocument.querySelector('.site-header').classList.contains('menu-open'))).toBe(true);
  });

  test('the controls hold still while the pointer travels down to them', async ({ page }) => {
    await openPreview(page);
    await hoverPart(page, '@header');

    // The controls sit in a strip below the navigation, which is drawn over the
    // module that follows it. Reaching them means crossing those pixels — and
    // one `mousemove` on the hero used to retarget the whole overlay, so the
    // arrows were gone before the pointer arrived and the navigation could never
    // actually be changed from the preview.
    const arrow = await page.locator('#previewHud .pv-hud__arrow.-next').boundingBox();
    const start = await page.evaluate(() => {
      const frame = document.getElementById('sitePreview');
      const zoom = window.__SBS_TEST_API.state.zoom || 1;
      const frameBox = frame.getBoundingClientRect();
      const header = frame.contentDocument.querySelector('.site-header').getBoundingClientRect();
      return { x: frameBox.left + (header.width / 2) * zoom, y: frameBox.top + (header.height / 2) * zoom };
    });

    await page.mouse.move(start.x, start.y);
    const seen = [];
    for (let step = 1; step <= 8; step += 1) {
      await page.mouse.move(
        start.x + ((arrow.x + arrow.width / 2 - start.x) * step) / 8,
        start.y + ((arrow.y + arrow.height / 2 - start.y) * step) / 8,
      );
      await page.waitForTimeout(40);
      seen.push(await page.evaluate(() => window.__SBS_TEST_API.previewSwitcher.hoverId()));
    }
    expect(new Set(seen), 'the overlay retargeted on the way to its own arrow').toEqual(new Set(['@header']));

    // And the arrow it held still for actually works from there.
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.header.variant)).toBe('centered');
  });

  test('the module below the navigation is still selectable once the pointer is past the strip', async ({ page }) => {
    await openPreview(page);
    await hoverPart(page, '@header');
    const stage = await page.locator('.preview-stage').boundingBox();
    for (let y = 20; y < stage.height - 10; y += 30) {
      await page.mouse.move(stage.x + stage.width / 2, stage.y + y);
      await page.waitForTimeout(50);
      const hovered = await page.evaluate(() => window.__SBS_TEST_API.previewSwitcher.hoverId());
      if (hovered && hovered !== '@header') return;
    }
    throw new Error('the guard band never released: no module could be hovered below the navigation');
  });

  test('the arrow keys walk the navigation through all five layouts and wrap', async ({ page }) => {
    await openPreview(page);
    await hoverPart(page, '@header');
    const seen = [];
    for (let i = 0; i < 6; i += 1) {
      seen.push(await page.evaluate(() => window.__SBS_TEST_API.state.project.header.variant));
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(320);
    }
    expect(seen).toEqual(['standard', 'centered', 'stacked', 'floating', 'minimal', 'standard']);
  });

  test('each navigation layout is a different composition, not a different name', async ({ page }) => {
    await openPreview(page);
    await hoverPart(page, '@header');
    const shapes = [];
    for (let i = 0; i < 5; i += 1) {
      shapes.push(await page.locator('#sitePreview').evaluate((frame) => {
        const doc = frame.contentDocument;
        const box = (selector) => {
          const node = doc.querySelector(selector);
          const rect = node.getBoundingClientRect();
          return [Math.round(rect.x), Math.round(rect.y)];
        };
        return JSON.stringify({
          height: Math.round(doc.querySelector('.site-header').getBoundingClientRect().height),
          logo: box('.site-header__logo'),
          cta: box('.sbs-header-cta'),
          nav: getComputedStyle(doc.querySelector('.nav-menu')).display,
          burger: getComputedStyle(doc.querySelector('.sbs-menu-toggle')).display,
          radius: getComputedStyle(doc.querySelector('.site-header__row')).borderTopLeftRadius,
        });
      }));
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(320);
    }
    expect(new Set(shapes).size).toBe(5);
  });

  test('the minimal layout really does put the links behind the button', async ({ page }) => {
    await openPreview(page);
    await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      api.state.project.header.variant = 'minimal';
      document.getElementById('sitePreview').srcdoc = api.buildSiteDocument(api.state.project);
    });
    await expect.poll(() => page.locator('#sitePreview').evaluate((frame) => Boolean(frame.contentDocument?.querySelector('.site-header.header-minimal')))).toBe(true);
    const behaviour = await page.locator('#sitePreview').evaluate((frame) => {
      const doc = frame.contentDocument;
      const nav = doc.querySelector('.nav-menu');
      const toggle = doc.querySelector('.sbs-menu-toggle');
      const closed = getComputedStyle(nav).display;
      toggle.click();
      const opened = getComputedStyle(nav).display;
      toggle.click();
      return { closed, opened, reclosed: getComputedStyle(nav).display, links: nav.querySelectorAll('a').length, toggle: getComputedStyle(toggle).display };
    });
    // A desktop burger that opens nothing would be dead UI.
    expect(behaviour.toggle).toBe('block');
    expect(behaviour.closed).toBe('none');
    expect(behaviour.opened).toBe('flex');
    expect(behaviour.reclosed).toBe('none');
    expect(behaviour.links).toBeGreaterThan(0);
  });

  test('the phone menu style cycles from the navigation overlay', async ({ page }) => {
    await openPreview(page);
    const menu = () => page.evaluate(() => window.__SBS_TEST_API.state.project.header.mobileMenu);

    /**
     * Presses the overlay's phone-menu button once.
     *
     * Cycling it rebuilds the whole preview document, because the takeover is
     * painted by the page stylesheet rather than by the header markup — so the
     * overlay this pressed can be gone by the time the next press is due. The
     * retry is about that rebuild, not about the control being unreliable.
     */
    const press = async () => {
      const before = await menu();
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await hoverPart(page, '@header');
        const point = await page.evaluate(() => {
          const button = document.querySelector('.pv-hud__tool[data-pv="mobile"]');
          if (!button) return null;
          const rect = button.getBoundingClientRect();
          return rect.width ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null;
        });
        if (point) {
          await page.mouse.click(point.x, point.y);
          await page.waitForTimeout(600);
          if (await menu() !== before) return;
        }
      }
      throw new Error('the phone menu never advanced from ' + before);
    };

    const seen = [await menu()];
    for (let i = 0; i < 4; i += 1) {
      await press();
      seen.push(await menu());
    }
    // Four styles, and it wraps.
    expect(seen).toEqual(['center', 'left', 'right', 'aurora', 'center']);
    // The rendered page carries it, because that is what paints the takeover.
    await press();
    await expect.poll(() => page.locator('#sitePreview').evaluate((frame) => frame.contentDocument.querySelector('.site-header').dataset.mobileMenu)).toBe('left');
  });

  test('hovering the footer offers its five layouts and nothing about modules', async ({ page }) => {
    await openPreview(page);
    await hoverPart(page, '@footer', { bottom: true });
    const hud = await overlay(page);
    expect(hud.chrome).toBe(true);
    expect(hud.badge).toBe('FTR');
    expect(hud.part).toBe('Global footer');
    expect(hud.count).toBe('1 / 5');
    expect(hud.tools).toEqual(['globals']);
    expect(hud.hint).toContain('footer layout');
  });

  test('each footer layout is a different composition, and none of them loses content', async ({ page }) => {
    await openPreview(page);
    await hoverPart(page, '@footer', { bottom: true });
    const shapes = [];
    for (let i = 0; i < 5; i += 1) {
      shapes.push(await page.locator('#sitePreview').evaluate((frame) => {
        const doc = frame.contentDocument;
        const footer = doc.querySelector('.site-footer');
        const box = (selector) => {
          const node = doc.querySelector(selector);
          if (!node) return null;
          const rect = node.getBoundingClientRect();
          return [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width)];
        };
        return {
          variant: footer.className.match(/footer-[a-z]+/)[0],
          shape: JSON.stringify({
            height: Math.round(footer.getBoundingClientRect().height),
            statement: box('.sbs-footer-statement'),
            columns: box('.footer__cols'),
          }),
          // Whatever the layout, the closing statement, the menus and the legal
          // line are all still on the page.
          keeps: Boolean(doc.querySelector('.site-footer .footer__nl-head')?.textContent?.trim())
            && doc.querySelectorAll('.site-footer .footer__col').length > 1
            && Boolean(doc.querySelector('.site-footer .footer__legal')?.textContent?.trim()),
        };
      }));
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(320);
    }
    expect(shapes.map((entry) => entry.variant)).toEqual([
      'footer-editorial', 'footer-compact', 'footer-centered', 'footer-columns', 'footer-minimal',
    ]);
    expect(new Set(shapes.map((entry) => entry.shape)).size).toBe(5);
    for (const entry of shapes) expect(entry.keeps, entry.variant).toBe(true);
  });

  test('the global editors and the export agree with what the overlay chose', async ({ page }) => {
    await openPreview(page);
    await hoverPart(page, '@header');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(400);
    const chosen = await page.evaluate(() => window.__SBS_TEST_API.state.project.header.variant);
    expect(chosen).toBe('stacked');

    // The select is built from the same catalogue, so it offers five and shows
    // the one the arrows landed on.
    await page.locator('[data-step="0"]').click();
    const select = page.locator('[data-bind="global.header.variant"]');
    await expect(select.locator('option')).toHaveCount(5);
    await expect(select).toHaveValue('stacked');
    await expect(page.locator('[data-bind="global.footer.variant"] option')).toHaveCount(5);

    // And the navigation JSON the importer reads carries it.
    const exported = await page.evaluate(() => JSON.stringify(window.__SBS_TEST_API.buildNavigationExport()));
    expect(exported).toContain('"variant":"stacked"');
  });

  test('stepping a global part is one undo, and the header keeps working after the swap', async ({ page }) => {
    await openPreview(page);
    await hoverPart(page, '@header');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__SBS_TEST_API.state.project.header.variant)).toBe('centered');

    // The header's own behaviour was bound when the document loaded. Swapping
    // the element in place has to re-bind it or the burger stops working.
    const toggles = await page.locator('#sitePreview').evaluate((frame) => {
      const doc = frame.contentDocument;
      doc.querySelector('.sbs-menu-toggle').click();
      const open = doc.querySelector('.site-header').classList.contains('menu-open');
      doc.querySelector('.sbs-menu-toggle').click();
      return { open, closed: !doc.querySelector('.site-header').classList.contains('menu-open') };
    });
    expect(toggles).toEqual({ open: true, closed: true });

    await page.locator('#undoBtn').click();
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.header.variant)).toBe('standard');
  });

  test('a module still steps its own pattern, untouched by any of this', async ({ page }) => {
    await openPreview(page);
    const first = await page.evaluate(() => window.__SBS_TEST_API.state.project.sections[0].id);
    await hoverPart(page, first);
    const hud = await overlay(page);
    expect(hud.chrome).toBe(false);
    expect(hud.tools).toEqual(['browse', 'edit']);
    const before = await page.evaluate(() => window.__SBS_TEST_API.state.project.sections[0].patternId);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.sections[0].patternId)).not.toBe(before);
  });
});
