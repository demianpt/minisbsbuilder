import { expect, test } from '@playwright/test';
import { useAdvancedBuilder } from './support/builder-mode.mjs';

/**
 * The preview pane was widened by about a fifth, and the tablet gained a bezel
 * to match the phone. The bezel must be decoration only: it is drawn with
 * box-shadow rings precisely so the shell's border box stays exactly the
 * emulated viewport width. A padding or border here would silently change which
 * breakpoint the strategist is looking at.
 */

async function open(page) {
  await page.setViewportSize({ width: 1680, height: 1000 });
  await useAdvancedBuilder(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
  await expect(page.locator('#deviceShell')).toBeVisible();
}

function geometry(page) {
  return page.evaluate(() => {
    const rect = (selector) => Math.round(document.querySelector(selector).getBoundingClientRect().width);
    return {
      preview: rect('.preview'),
      editor: rect('.editor'),
      sidebar: rect('.sidebar'),
      viewport: window.innerWidth,
    };
  });
}

test.describe('preview shell', () => {
  test('gives the preview roughly a fifth more room than the editor column pair', async ({ page }) => {
    await open(page);
    const layout = await geometry(page);
    // Before this change the split at 1680px was 252 + 620 + 808.
    expect(layout.sidebar).toBeLessThanOrEqual(212);
    expect(layout.editor).toBeLessThanOrEqual(480);
    expect(layout.preview).toBeGreaterThan(808 * 1.18);
    expect(layout.preview).toBe(layout.viewport - layout.sidebar - layout.editor);
    // The preview must own more of the screen than everything else combined.
    expect(layout.preview).toBeGreaterThan(layout.sidebar + layout.editor);
  });

  test('the editor content still fits its narrower column', async ({ page }) => {
    await open(page);
    const overflow = await page.evaluate(() => {
      const editor = document.querySelector('.editor');
      return editor.scrollWidth - editor.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('each device keeps its exact emulated width despite the bezel', async ({ page }) => {
    await open(page);
    for (const [device, width] of [['desktop', 1440], ['tablet', 820], ['mobile', 390]]) {
      await page.locator(`.device-btn[data-device="${device}"]`).click();
      await expect(page.locator('#deviceShell')).toHaveClass(new RegExp(`\\b${device}\\b`));
      // The shell animates its width, so settle before measuring.
      await expect.poll(() => page.evaluate(() => Math.round(Number.parseFloat(getComputedStyle(document.querySelector('#deviceShell')).width)))).toBe(width);
      const measured = await page.evaluate(() => {
        const shell = document.querySelector('#deviceShell');
        const frame = document.querySelector('#sitePreview');
        const styles = getComputedStyle(shell);
        return {
          shell: Math.round(Number.parseFloat(styles.width)),
          frame: Math.round(Number.parseFloat(getComputedStyle(frame).width)),
          padding: styles.paddingTop,
          border: styles.borderTopWidth,
          shadow: styles.boxShadow,
          radius: styles.borderTopLeftRadius,
        };
      });
      expect(measured.shell, device).toBe(width);
      expect(measured.frame, device).toBe(width);
      // The bezel may not eat into the emulated viewport.
      expect(measured.padding, device).toBe('0px');
      expect(measured.border, device).toBe('0px');
    }
  });

  test('the tablet and the phone both wear a bezel', async ({ page }) => {
    await open(page);
    for (const device of ['tablet', 'mobile']) {
      await page.locator(`.device-btn[data-device="${device}"]`).click();
      const skin = await page.evaluate(() => {
        const shell = document.querySelector('#deviceShell');
        const styles = getComputedStyle(shell);
        const before = getComputedStyle(shell, '::before');
        const after = getComputedStyle(shell, '::after');
        return {
          // Three rings: body, highlight edge, outer shadow line.
          rings: (styles.boxShadow.match(/rgb/g) || []).length,
          radius: Number.parseFloat(styles.borderTopLeftRadius),
          overflow: styles.overflow,
          hasCameraOrNotch: before.content !== 'none' && Number.parseFloat(before.width) > 0,
          hasHomeIndicator: after.content !== 'none' && Number.parseFloat(after.width) > 0,
          frameRadius: Number.parseFloat(getComputedStyle(document.querySelector('#sitePreview')).borderTopLeftRadius),
        };
      });
      expect(skin.rings, device).toBeGreaterThanOrEqual(4);
      expect(skin.radius, device).toBeGreaterThan(8);
      expect(skin.hasCameraOrNotch, device).toBe(true);
      expect(skin.hasHomeIndicator, device).toBe(true);
      // The screen has to be clipped to the bezel's rounding.
      expect(skin.frameRadius, device).toBeGreaterThan(0);
      // …which means the shell itself cannot clip, or the bezel would vanish.
      expect(skin.overflow, device).toBe('visible');
    }
    // Desktop stays a plain browser-less canvas.
    await page.locator('.device-btn[data-device="desktop"]').click();
    const desktop = await page.evaluate(() => getComputedStyle(document.querySelector('#deviceShell')).overflow);
    expect(desktop).toBe('hidden');
  });

  test('the bezel is not clipped by the preview stage', async ({ page }) => {
    await open(page);
    await page.locator('.device-btn[data-device="tablet"]').click();
    const room = await page.evaluate(() => {
      const stage = document.querySelector('.preview-stage');
      const styles = getComputedStyle(stage);
      // The widest ring is 19px; the stage padding has to clear it.
      return { padding: Number.parseFloat(styles.paddingTop), bottom: Number.parseFloat(styles.paddingBottom) };
    });
    expect(room.padding).toBeGreaterThanOrEqual(20);
    expect(room.bottom).toBeGreaterThanOrEqual(20);
  });

  test('the device choice survives a reload', async ({ page }) => {
    await open(page);
    await page.locator('.device-btn[data-device="tablet"]').click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('sbs-builder-v3') || '{}').device)).toBe('tablet');
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
    await expect(page.locator('#deviceShell')).toHaveClass(/\btablet\b/);
  });
});
