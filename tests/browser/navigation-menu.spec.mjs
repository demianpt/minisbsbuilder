import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { useAdvancedBuilder } from './support/builder-mode.mjs';

// Playwright's loader does not take a bare JSON import; the other browser specs
// read the catalog through the page, but the palette maths here needs it in Node.
const catalog = JSON.parse(readFileSync(new URL('../../src/data/dst-data.json', import.meta.url), 'utf8'));

/**
 * The mobile menu toggle and the takeover it opens.
 *
 * The toggle was invisible on every palette for a reason worth pinning down: it
 * is a `<button>`, and a button does not inherit `color` — the user-agent
 * `buttontext` keyword wins, so `background:currentColor` on the bars resolved to
 * pure black whatever the theme said. On a dark palette that is black on
 * near-black. These tests measure real contrast rather than trusting a class.
 */

const LIGHT = 'A';
const DARK = 'F';

function luminance(hex) {
  const clean = String(hex).replace('#', '');
  const channels = [0, 2, 4].map((index) => Number.parseInt(clean.slice(index, index + 2), 16) / 255);
  const [r, g, b] = channels.map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function rgbToHex(rgb) {
  const parts = String(rgb).match(/\d+(\.\d+)?/g) || [];
  return `#${parts.slice(0, 3).map((value) => Math.round(Number(value)).toString(16).padStart(2, '0')).join('')}`;
}

async function boot(page, device = 'mobile') {
  await page.setViewportSize({ width: 1680, height: 1050 });
  await useAdvancedBuilder(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
  await page.locator(`.device-btn[data-device="${device}"]`).click();
  // The toggle only exists below 900px, so wait for the state this device
  // actually produces rather than assuming it is visible.
  const shouldShow = device !== 'desktop';
  await expect.poll(() => page.locator('#sitePreview').evaluate((frame) => {
    const toggle = frame.contentDocument?.querySelector('.sbs-menu-toggle');
    return toggle ? getComputedStyle(toggle).display !== 'none' : null;
  })).toBe(shouldShow);
  await widthSettled(page);
}

/**
 * Waits for the frame to actually be the width the device button asked for.
 *
 * The shell animates its width over 220ms, so everything measured inside the
 * frame — whether the menu covers the viewport, how big the link type is — is
 * measured against a width that is still moving. Under load that window is wide
 * enough to fail on, which is the second half of this spec's standing flake.
 */
async function widthSettled(page) {
  let last = -1;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const width = await page.locator('#sitePreview').evaluate((frame) => frame.contentWindow?.innerWidth || 0);
    if (width && width === last) return width;
    last = width;
    await page.waitForTimeout(80);
  }
  return last;
}

async function useArchetype(page, key) {
  await page.locator('[data-step="1"]').click();
  await page.locator(`[data-archetype="${key}"]`).click();
  await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.design.archetype)).toBe(key);
  await expect.poll(() => page.locator('#sitePreview').evaluate((frame) => {
    const site = frame.contentDocument?.getElementById('sbs-site');
    return site ? getComputedStyle(site).getPropertyValue('--dst--body-bg').trim() : null;
  })).toBe(catalog.archetypeStyles[key].bg);
}

function toggleState(page) {
  return page.locator('#sitePreview').evaluate((frame) => {
    const doc = frame.contentDocument;
    const toggle = doc.querySelector('.sbs-menu-toggle');
    const bars = [...toggle.querySelectorAll('span')];
    const styles = getComputedStyle(toggle);
    const box = toggle.getBoundingClientRect();
    return {
      display: styles.display,
      colour: styles.color,
      bars: bars.length,
      barColour: getComputedStyle(bars[0]).backgroundColor,
      barHeight: Number.parseFloat(getComputedStyle(bars[0]).height),
      barWidth: Math.round(bars[0].getBoundingClientRect().width),
      width: Math.round(box.width),
      height: Math.round(box.height),
      canvas: getComputedStyle(doc.getElementById('sbs-site')).getPropertyValue('--dst--body-bg').trim(),
      transforms: bars.map((bar) => getComputedStyle(bar).transform),
      opacities: bars.map((bar) => Number(getComputedStyle(bar).opacity)),
      ariaExpanded: toggle.getAttribute('aria-expanded'),
      ariaLabel: toggle.getAttribute('aria-label'),
    };
  });
}

/**
 * Following a fragment link inside a `srcdoc` iframe reloads that document, so
 * the toggle has to be waited for rather than assumed. That is an artefact of
 * previewing in an iframe, not of the menu.
 */
function isOpen(page) {
  return () => page.locator('#sitePreview').evaluate((frame) => {
    // Following a fragment link replaces the srcdoc document; a missing header
    // means the menu is certainly not open.
    const header = frame.contentDocument?.querySelector('.site-header');
    return header ? header.classList.contains('menu-open') : false;
  });
}

/**
 * Presses the burger, and does not return until the press took effect.
 *
 * Finding the toggle and pressing it have to be one step: split across two round
 * trips they race a preview rebuild — the poll sees a toggle, the rebuild
 * replaces the document, and the click lands on null. Existing *and* pressed is
 * not enough either, because a document can be in the frame a moment before its
 * runtime has bound the toggle, and a press with no listener behind it is
 * silent. So the outcome is what is waited for: the class flipped. The handler
 * flips it synchronously, so one round trip can both act and check.
 *
 * That race was this spec's standing flake, and it moved between tests on every
 * run.
 */
async function openMenu(page) {
  await expect.poll(() => page.locator('#sitePreview').evaluate((frame) => {
    const doc = frame.contentDocument;
    const toggle = doc?.querySelector('.sbs-menu-toggle');
    const header = doc?.querySelector('.site-header');
    if (!toggle || !header) return 'no toggle yet';
    const before = header.classList.contains('menu-open');
    toggle.click();
    return header.classList.contains('menu-open') === before ? 'not bound yet' : 'pressed';
  })).toBe('pressed');
}

function menuState(page) {
  return page.locator('#sitePreview').evaluate((frame) => {
    const doc = frame.contentDocument;
    const view = frame.contentWindow;
    const row = doc.querySelector('.site-header__row');
    const nav = doc.querySelector('.nav-menu');
    const links = [...nav.querySelectorAll('a')];
    const cta = doc.querySelector('.sbs-header-cta');
    const rowBox = row.getBoundingClientRect();
    const centre = view.innerWidth / 2;
    return {
      open: doc.querySelector('.site-header').classList.contains('menu-open'),
      rowPosition: getComputedStyle(row).position,
      coversViewport: Math.round(rowBox.width) === view.innerWidth && Math.round(rowBox.height) === view.innerHeight,
      justify: getComputedStyle(row).justifyContent,
      align: getComputedStyle(row).alignItems,
      linkFont: Number.parseFloat(getComputedStyle(links[0]).fontSize),
      linkFamily: getComputedStyle(links[0]).fontFamily,
      linksCentred: links.every((link) => {
        const box = link.getBoundingClientRect();
        return Math.abs((box.left + box.right) / 2 - centre) < 2;
      }),
      linkColour: getComputedStyle(links[0]).color,
      ctaDisplay: getComputedStyle(cta).display,
      ctaCentred: (() => {
        const box = cta.getBoundingClientRect();
        return Math.abs((box.left + box.right) / 2 - centre) < 2;
      })(),
      logoPinned: getComputedStyle(doc.querySelector('.site-header__logo')).position === 'fixed',
      bodyOverflow: getComputedStyle(doc.body).overflow,
      canvas: getComputedStyle(doc.getElementById('sbs-site')).getPropertyValue('--dst--body-bg').trim(),
    };
  });
}

test.describe('the menu toggle', () => {
  test('is a real target with three visible bars', async ({ page }) => {
    await boot(page);
    const state = await toggleState(page);
    expect(state.display).not.toBe('none');
    // Two 1px hairlines did not read as a menu control.
    expect(state.bars).toBe(3);
    expect(state.barHeight).toBeGreaterThanOrEqual(2);
    expect(state.barWidth).toBeGreaterThanOrEqual(20);
    // A 44px target is the accessibility floor for a touch control.
    expect(state.width).toBeGreaterThanOrEqual(44);
    expect(state.height).toBeGreaterThanOrEqual(44);
  });

  test('takes the palette dark tone on a light header', async ({ page }) => {
    await boot(page);
    await useArchetype(page, LIGHT);
    const state = await toggleState(page);
    const style = catalog.archetypeStyles[LIGHT];
    expect(rgbToHex(state.barColour).toLowerCase()).toBe(style.dark.toLowerCase());
    expect(contrast(rgbToHex(state.barColour), state.canvas)).toBeGreaterThan(4.5);
  });

  test('turns white on a dark header', async ({ page }) => {
    await boot(page);
    await useArchetype(page, DARK);
    const state = await toggleState(page);
    expect(rgbToHex(state.barColour)).toBe('#ffffff');
    expect(contrast('#ffffff', state.canvas)).toBeGreaterThan(4.5);
  });

  test('never renders the user-agent button black regardless of archetype', async ({ page }) => {
    await boot(page);
    for (const key of Object.keys(catalog.archetypes)) {
      await useArchetype(page, key);
      const state = await toggleState(page);
      const bar = rgbToHex(state.barColour);
      // The original defect: `buttontext` resolved to #000 on every theme.
      const ratio = contrast(bar, state.canvas);
      expect(ratio, `${key}: ${bar} on ${state.canvas}`).toBeGreaterThan(4.5);
    }
  });

  test('animates its bars into a cross when the menu opens', async ({ page }) => {
    await boot(page);
    const closed = await toggleState(page);
    // Closed: three parallel bars, none rotated, all visible.
    expect(closed.opacities.every((value) => value === 1)).toBe(true);
    for (const transform of closed.transforms) expect(transform).not.toMatch(/matrix\(0\./);

    await openMenu(page);
    await expect.poll(() => toggleState(page).then((state) => state.ariaExpanded)).toBe('true');
    // Give the transition time to land on its end state.
    await page.waitForTimeout(700);
    const open = await toggleState(page);
    // The outer bars rotate ±45°, so their matrices carry off-diagonal terms.
    const rotated = open.transforms.filter((transform) => /^matrix\(0?\.7/.test(transform));
    expect(rotated.length).toBe(2);
    // The middle bar gets out of the way.
    expect(open.opacities[1]).toBeLessThan(0.2);
    expect(open.ariaLabel).toBe('Close navigation');
  });

  test('honours the movement dial, including zero', async ({ page }) => {
    await boot(page);
    const durationAt = async (motion) => {
      await page.evaluate((value) => {
        const api = window.__SBS_TEST_API;
        api.state.project.design.motion = value;
        api.design.ensure(api.state.project);
        document.getElementById('sitePreview').srcdoc = api.buildSiteDocument(api.state.project);
      }, motion);
      await expect.poll(() => page.locator('#sitePreview').evaluate((frame) => Boolean(frame.contentDocument.querySelector('.sbs-menu-toggle')))).toBe(true);
      return page.locator('#sitePreview').evaluate((frame) => getComputedStyle(frame.contentDocument.querySelector('.sbs-menu-toggle span')).transitionDuration);
    };
    // Chrome collapses identical durations, so compare the number not the string.
    expect(Number.parseFloat(await durationAt(0))).toBe(0);
    expect(Number.parseFloat(await durationAt(100))).toBeGreaterThan(Number.parseFloat(await durationAt(20)));
  });

  test('is hidden on desktop, where the links are already visible', async ({ page }) => {
    await boot(page, 'desktop');
    const state = await page.locator('#sitePreview').evaluate((frame) => {
      const doc = frame.contentDocument;
      return {
        toggle: getComputedStyle(doc.querySelector('.sbs-menu-toggle')).display,
        nav: getComputedStyle(doc.querySelector('.nav-menu')).display,
      };
    });
    expect(state.toggle).toBe('none');
    expect(state.nav).toBe('flex');
  });
});

test.describe('the mobile and tablet takeover', () => {
  for (const device of ['tablet', 'mobile']) {
    test(`on ${device} it fills the screen and centres everything`, async ({ page }) => {
      await boot(page, device);
      await openMenu(page);
      await expect.poll(() => menuState(page).then((state) => state.open)).toBe(true);
      const state = await menuState(page);

      expect(state.rowPosition).toBe('fixed');
      expect(state.coversViewport, `${device} does not cover the viewport`).toBe(true);
      expect(state.justify).toBe('center');
      expect(state.align).toBe('center');
      expect(state.linksCentred).toBe(true);
      expect(state.ctaCentred).toBe(true);
      // The action must not be hidden behind the menu that replaced the header.
      expect(state.ctaDisplay).not.toBe('none');
      // The brand and close control stay put at the top.
      expect(state.logoPinned).toBe(true);
      // A full-screen menu over a scrolling page feels broken.
      expect(state.bodyOverflow).toBe('hidden');
      expect(contrast(rgbToHex(state.linkColour), state.canvas)).toBeGreaterThan(4.5);
    });
  }

  test('the link type is clamped, so it adapts between the two widths', async ({ page }) => {
    await boot(page, 'mobile');
    await openMenu(page);
    await expect.poll(() => menuState(page).then((state) => state.open)).toBe(true);
    const mobile = await menuState(page);
    // A 14.5px nav link in a full-screen menu is not a menu.
    expect(mobile.linkFont).toBeGreaterThan(24);

    await openMenu(page);
    await page.locator('.device-btn[data-device="tablet"]').click();
    await expect.poll(() => page.locator('#sitePreview').evaluate((frame) => frame.contentWindow.innerWidth)).toBe(820);
    await widthSettled(page);
    await openMenu(page);
    await expect.poll(() => menuState(page).then((state) => state.open)).toBe(true);
    const tablet = await menuState(page);

    expect(tablet.linkFont).toBeGreaterThan(mobile.linkFont);
    // The display face, not the body face: this is a statement, not a list.
    expect(tablet.linkFamily).toContain(catalog.archetypeStyles.A.fontDisplay.split(' ')[0]);
  });

  test('closes when a link is followed', async ({ page }) => {
    await boot(page, 'mobile');
    await openMenu(page);
    await expect.poll(isOpen(page)).toBe(true);
    await page.locator('#sitePreview').evaluate((frame) => frame.contentDocument.querySelector('.nav-menu a').click());
    await expect.poll(isOpen(page)).toBe(false);
  });

  test('closes on a second press of the toggle, and unlocks the page', async ({ page }) => {
    await boot(page, 'mobile');
    await openMenu(page);
    await expect.poll(isOpen(page)).toBe(true);
    await openMenu(page);
    await expect.poll(isOpen(page)).toBe(false);
    await expect.poll(() => page.locator('#sitePreview').evaluate((frame) => getComputedStyle(frame.contentDocument.body).overflow)).not.toBe('hidden');
  });

  test('closes on Escape', async ({ page }) => {
    await boot(page, 'mobile');
    await openMenu(page);
    await expect.poll(isOpen(page)).toBe(true);
    await page.locator('#sitePreview').evaluate((frame) => {
      frame.contentDocument.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await expect.poll(isOpen(page)).toBe(false);
    await expect.poll(() => page.locator('#sitePreview').evaluate((frame) => getComputedStyle(frame.contentDocument.body).overflow)).not.toBe('hidden');
  });

  test('the takeover reaches the exported standalone page, not just the preview', async ({ page }) => {
    await boot(page);
    const html = await page.evaluate(() => window.__SBS_TEST_API.buildSiteDocument());
    expect(html).toContain('--sbs-nav-on-header:');
    expect(html).toContain('.site-header.menu-open .site-header__row');
    expect(html).toContain('Close navigation');
    // Three bars in the markup, not two.
    expect(html).toMatch(/sbs-menu-toggle[^>]*>(?:\s*<span><\/span>){3}/);
  });
});

/**
 * The four mobile menu styles.
 *
 * All of them are the same takeover — full screen, pinned brand, pinned close —
 * because that is the behaviour the client already signed off on. What changes
 * is the composition inside it, which is the part they react to, so these tests
 * measure composition: where the type sits, whether the running number is drawn,
 * and whether the expressive one is expressive rather than merely different.
 */
async function chooseMobileMenu(page, style) {
  // Step indices are zero-based: 0 is "Brief + globals", where the navigation
  // controls live. (1 is Direction, which is what `useArchetype` above wants.)
  await page.locator('[data-step="0"]').click();
  await page.locator('select[data-bind="global.header.mobileMenu"]').selectOption(style);
  await expect.poll(() => page.locator('#sitePreview').evaluate((frame) => (
    frame.contentDocument?.querySelector('.site-header')?.getAttribute('data-mobile-menu') || null
  ))).toBe(style);
}

function linkGeometry(page) {
  return page.locator('#sitePreview').evaluate((frame) => {
    const doc = frame.contentDocument;
    const link = doc.querySelector('.nav-menu a');
    const label = link.querySelector('.nav-menu__label');
    const width = doc.documentElement.clientWidth;
    const box = label.getBoundingClientRect();
    return {
      // Distance to each edge, so "left" and "right" are measured rather than
      // read off a class that may or may not be doing anything.
      left: Math.round(box.left),
      right: Math.round(width - box.right),
      number: getComputedStyle(link, '::before').display,
      ground: getComputedStyle(doc.querySelector('.site-header__row')).backgroundImage,
    };
  });
}

test.describe('mobile menu styles', () => {
  test('centres the links by default, and says so in the export', async ({ page }) => {
    await boot(page, 'mobile');
    await openMenu(page);
    const geometry = await linkGeometry(page);
    expect(Math.abs(geometry.left - geometry.right)).toBeLessThanOrEqual(2);
    // A running number is a left/right affordance; centred type does not carry one.
    expect(geometry.number).toBe('none');
    const html = await page.evaluate(() => window.__SBS_TEST_API.buildSiteDocument());
    expect(html).toContain('data-mobile-menu="center"');
  });

  test('aligns left and right on request, with a running number', async ({ page }) => {
    await boot(page, 'mobile');

    await chooseMobileMenu(page, 'left');
    await openMenu(page);
    const left = await linkGeometry(page);
    expect(left.left).toBeLessThan(left.right);
    expect(left.number).toBe('block');
    await openMenu(page);

    await chooseMobileMenu(page, 'right');
    await openMenu(page);
    const right = await linkGeometry(page);
    expect(right.right).toBeLessThan(right.left);
    expect(right.number).toBe('block');
  });

  test('the expressive style paints a real field, not just another alignment', async ({ page }) => {
    await boot(page, 'mobile');
    await chooseMobileMenu(page, 'aurora');
    await openMenu(page);
    const geometry = await linkGeometry(page);
    expect(geometry.ground).toContain('radial-gradient');
    expect(geometry.number).toBe('block');
    // The wipe is a registered custom property, so it has to be declared or the
    // reveal jumps from nothing to everything in one frame.
    const html = await page.evaluate(() => window.__SBS_TEST_API.buildSiteDocument());
    expect(html).toContain('@property --sbs-nav-wipe');
    expect(html).toContain('data-mobile-menu="aurora"');
  });

  test('the choice survives into the navigation JSON the importer reads', async ({ page }) => {
    await boot(page, 'mobile');
    await chooseMobileMenu(page, 'aurora');
    const navigation = await page.evaluate(() => window.__SBS_TEST_API.buildNavigationExport());
    const header = navigation.concept.global.navigation;
    // The builder's own record of the choice…
    expect(header.nav.mobileMenu).toBe('aurora');
    // …and the exported form of it. `dst-navigation` declares no attribute for a
    // takeover style, so it travels as a class the theme's stylesheet hooks —
    // `mobileMenuStyle` was invented, and WordPress kept it in the markup and
    // ignored it.
    expect(header.attributes.className).toContain('mobile-menu--aurora');
    expect(header.attributes.mobileMenuStyle).toBeUndefined();
  });
});
