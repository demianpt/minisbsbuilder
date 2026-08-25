import { expect, test } from '@playwright/test';
import { useAdvancedBuilder } from './support/builder-mode.mjs';
import { previewSettled } from './support/preview.mjs';

/**
 * Every control in the module editor has to reach the exported page.
 *
 * A property you can change in the builder and cannot find in WordPress is
 * worse than a missing control: the page was approved with it. So rather than
 * spot-checking a few, this drives *every* binding the module editor renders —
 * for every family in the library, in both the Basic and the Extended view —
 * with a real `input` event, and asserts the exported artifact changed.
 *
 * A control legitimately absent from the export is listed in EXPECTED_LOCAL with
 * the reason. Anything else failing is a control that does nothing.
 */

/**
 * Bindings whose whole job is inside the builder.
 *
 * Each of these is a preview or authoring concern that has no DST attribute
 * behind it, so an export that carried them would be inventing keys the theme
 * would ignore. Listed rather than skipped by pattern-match, so a new one has to
 * be justified here before the suite goes green.
 */
const EXPECTED_LOCAL = {
  'setting.*.background': 'The band ground is resolved from the palette at export; the control only picks how.',
  'fidelity.*.overlayBlend': 'A preview-side blend mode; DST has no mix-blend attribute on a band.',
};

function expectedLocal(bind) {
  const generic = bind.replace(/^([a-z]+)\.[^.]+\./, '$1.*.');
  return Object.prototype.hasOwnProperty.call(EXPECTED_LOCAL, generic);
}

async function boot(page) {
  await page.addInitScript(() => localStorage.clear());
  await useAdvancedBuilder(page);
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
  await page.locator('[data-step="3"]').click();
  await previewSettled(page);
}

/**
 * Drives every binding in the module editor and reports the ones the export did
 * not notice.
 *
 * Run wholly inside the page: a round trip per control across a whole family's
 * worth of panels would take longer than the whole rest of the suite.
 */
async function sweep(page, { family, view }) {
  return page.evaluate(({ wantedFamily, wantedView }) => {
    const api = window.__SBS_TEST_API;
    const pattern = api.catalog.all().find((entry) => entry.family === wantedFamily);
    if (!pattern) return { skipped: true };

    const section = api.createSection(wantedFamily, 0, pattern.id);
    api.state.project.sections.push(section);
    api.state.selectedSectionId = section.id;
    api.state.moduleView = wantedView;

    const dead = [];
    const pending = [];
    const seen = [];
    const tabs = ['content', 'media', 'layout'];

    /** A value that is definitely not the one already there. */
    const nextValue = (control) => {
      if (control.tagName === 'SELECT') {
        const options = [...control.options].map((option) => option.value);
        return options.find((value) => value !== control.value) ?? null;
      }
      if (control.type === 'range') return null;
      if (control.type === 'color') return control.value === '#3355aa' ? '#aa5533' : '#3355aa';
      if (control.type === 'number') return String(Number(control.value || 0) + 3);
      return `sweep-${Math.abs(Math.round(performance.now())) % 100000}`;
    };

    for (const tab of tabs) {
      api.state.editorTab = tab;
      document.querySelector('[data-step="3"]').click();
      const panel = document.querySelector('#editorInner [data-module-editor]');
      if (!panel) continue;
      /*
       * An overlay's strength needs an overlay.
       *
       * Its colour is set through a composite control with its own mode select,
       * not through a `data-bind` input, so a sweep of the bindings never turns
       * one on — and a strength with nothing to act on changes nothing, which is
       * correct behaviour rather than a dead control. Switching the mode on first
       * is the setup that makes the question answerable.
       */
      const mode = panel.querySelector('[data-fidelity-overlay-mode]');
      if (mode && mode.value === 'off') {
        mode.value = 'solid';
        mode.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const controls = [...panel.querySelectorAll('[data-bind]')];
      for (const control of controls) {
        const bind = control.dataset.bind;
        if (!bind || !bind.includes(section.id)) continue;
        if (seen.includes(bind)) continue;
        seen.push(bind);

        // Every option, not just the next one. A select whose first alternative
        // happens to resolve to the same exported value is not a dead control,
        // and calling it one sends somebody hunting a bug that is not there.
        // A slider is tried in both directions. Several product rules clamp one
        // way on purpose — a corner-anchored motif is never scaled above 1 — and
        // a sweep that only pushed upward would call that a broken control.
        let candidates;
        if (control.tagName === 'SELECT') {
          candidates = [...control.options].map((option) => option.value).filter((value) => value !== control.value);
        } else if (control.type === 'range') {
          const min = Number(control.min || 0), max = Number(control.max || 100);
          const current = Number(control.value);
          const step = Math.max(1, Math.round((max - min) / 4));
          candidates = [Math.min(max, current + step), Math.max(min, current - step)]
            .filter((value) => value !== current).map(String);
        } else {
          candidates = [nextValue(control)].filter((value) => value !== null);
        }
        let landed = false;
        for (const value of candidates) {
          const before = JSON.stringify(api.buildCompleteExport().concept.page.sections);
          control.value = value;
          control.dispatchEvent(new Event('input', { bubbles: true }));
          control.dispatchEvent(new Event('change', { bubbles: true }));
          const after = JSON.stringify(api.buildCompleteExport().concept.page.sections);
          if (before !== after) { landed = true; break; }
        }
        if (!landed && candidates.length) pending.push({ bind, tab, control });
      }
    }

    /*
     * A second pass over the ones that did nothing.
     *
     * Several controls modify something another control creates: an overlay's
     * strength has nothing to act on until an overlay colour exists, a motif's
     * scale nothing until a motif is chosen. Sweeping once in DOM order calls
     * those dead. Retrying after everything has been set once is the difference
     * between a control that does nothing and a control that needs something
     * else set first.
     */
    for (const entry of pending) {
      const control = entry.control;
      if (!control || !control.isConnected) { dead.push({ bind: entry.bind, tab: entry.tab }); continue; }
      const candidates = control.tagName === 'SELECT'
        ? [...control.options].map((option) => option.value).filter((value) => value !== control.value)
        : [nextValue(control)].filter((value) => value !== null);
      let landed = false;
      for (const value of candidates) {
        const before = JSON.stringify(api.buildCompleteExport().concept.page.sections);
        control.value = value;
        control.dispatchEvent(new Event('input', { bubbles: true }));
        control.dispatchEvent(new Event('change', { bubbles: true }));
        if (JSON.stringify(api.buildCompleteExport().concept.page.sections) !== before) { landed = true; break; }
      }
      if (!landed) dead.push({ bind: entry.bind, tab: entry.tab });
    }

    api.state.project.sections.pop();
    return { skipped: false, pattern: pattern.id, checked: seen.length, dead };
  }, { wantedFamily: family, wantedView: view });
}

const FAMILIES = ['hero', 'text', 'split', 'cards', 'stats', 'logo', 'testimonial', 'faq',
  'accordion', 'haccordion', 'tabs', 'timeline', 'pricing', 'team', 'blog', 'gallery',
  'slider', 'contact', 'cta'];

test.describe('every module property reaches the exported page', () => {
  for (const view of ['simple', 'extended']) {
    test(`${view} view, every family`, async ({ page }) => {
      await boot(page);
      const dead = [];
      let checked = 0;
      for (const family of FAMILIES) {
        const result = await sweep(page, { family, view });
        if (result.skipped) continue;
        checked += result.checked;
        result.dead
          .filter((entry) => !expectedLocal(entry.bind))
          .forEach((entry) => dead.push(`${family} · ${entry.tab} · ${entry.bind}`));
      }
      // A real number, so a panel that silently stopped rendering its controls
      // cannot pass this by checking nothing.
      // A real floor, so a panel that silently stopped rendering its controls
      // cannot pass this by having nothing to check.
      expect(checked, `only ${checked} controls were driven`).toBeGreaterThan(view === 'extended' ? 250 : 120);
      expect(dead, `${dead.length} controls changed nothing in the export`).toEqual([]);
    });
  }
});
