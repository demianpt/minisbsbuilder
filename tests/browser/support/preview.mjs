/**
 * Waiting for the preview to stop rebuilding.
 *
 * The preview is rebuilt on a debounce, and one action can queue more than one
 * rebuild — applying a flow renders, saves and re-renders. Waiting for the frame
 * to *contain* something is not enough: the document that satisfied the wait can
 * be replaced a moment later, which destroys any execution context a spec is
 * holding inside it. That shows up as "Execution context was destroyed" or
 * "Resulting promise was garbage collected", neither of which is what the spec
 * was testing.
 *
 * So: watch the frame's load events and return once none has arrived for a
 * while. Anything that measures *inside* the preview — a transition sampled
 * frame by frame, a scroll position, a computed style — should call this first.
 */
export async function previewSettled(page, { quietFor = 600, timeout = 20_000 } = {}) {
  await page.evaluate(() => {
    const frame = document.getElementById('sitePreview');
    if (!frame) return;
    if (window.__sbsPreviewLoads === undefined) {
      window.__sbsPreviewLoads = 0;
      frame.addEventListener('load', () => { window.__sbsPreviewLoads += 1; });
    }
  });
  const started = Date.now();
  let last = -1;
  while (Date.now() - started < timeout) {
    const count = await page.evaluate(() => window.__sbsPreviewLoads ?? 0);
    if (count === last) return;
    last = count;
    await page.waitForTimeout(quietFor);
  }
  throw new Error('the preview never stopped rebuilding');
}

/**
 * Reads a measurement, and returns the one that satisfied the condition.
 *
 * The flaky shape this replaces is everywhere: poll until the change has landed,
 * then measure in a *second* round trip. The preview is rebuilt on a debounce,
 * so between those two calls the document can be replaced — and the geometry
 * that comes back belongs to a page mid-swap. Radii read as the default, widths
 * read as the pre-layout value, and the test fails on a page that was correct
 * before and after the moment it was looked at.
 *
 * Polling on the value that is about to be asserted, and keeping *that* reading,
 * removes the gap entirely.
 */
export async function measureWhen(read, ok, { timeout = 15_000, every = 120 } = {}) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeout) {
    last = await read();
    if (last && ok(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, every));
  }
  throw new Error(`the measurement never satisfied the condition; last reading was ${JSON.stringify(last)}`);
}
