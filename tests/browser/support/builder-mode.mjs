/**
 * The app opens on the simple builder, which is the right front door for a
 * strategist and the wrong starting point for a spec about the advanced
 * builder's five steps, its DST tree or its extended attribute view.
 *
 * This seeds the persisted preference before any page script runs, so those
 * specs boot exactly the way a returning advanced-builder session does — no
 * click, no intermediate render in the other builder, and nothing to undo.
 *
 * Register it *after* any `localStorage.clear()` init script the spec adds of
 * its own: init scripts run in registration order on every navigation, so the
 * last one to touch the key wins.
 */
export async function useAdvancedBuilder(page) {
  await page.addInitScript(() => {
    try {
      // Write into whichever envelope the builder will actually read, or a
      // migration fixture stored under the v1 key would be shadowed by a v2
      // envelope that exists only to carry this preference.
      const keys = ['sbs-builder-v3', 'sbs-dst-page-builder-v2', 'sbs-dst-page-builder-v1'];
      const key = keys.find((candidate) => localStorage.getItem(candidate)) || keys[0];
      const saved = JSON.parse(localStorage.getItem(key) || '{}') || {};
      localStorage.setItem(key, JSON.stringify({ ...saved, builderMode: 'advanced' }));
    } catch (error) {
      // A storage the browser refused is the harness's problem to surface, not
      // something to swallow the whole navigation over.
    }
  });
}
