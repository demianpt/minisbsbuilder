import { expect, test } from '@playwright/test';
import { useAdvancedBuilder } from './support/builder-mode.mjs';

/**
 * Dropping the client's own brief onto the builder.
 *
 * The brief that actually exists is a PDF the client exported or a Word document
 * from a discovery call, and the only way in was to open it somewhere else,
 * select all, and paste. So the whole window takes a file: the text is extracted
 * in the browser — nothing is uploaded — and handed to the same brain the
 * textarea feeds.
 *
 * A document is *attached*, not pasted. It shows as its own name with its kind
 * and its length, and its words never enter the textarea: tipping three pages of
 * somebody else's PDF into the box the strategist is meant to keep editing
 * buries their paragraph in it, and makes a document look like something they
 * typed. The brain reads the paragraph and every attachment together, so one
 * press still sees the lot — and an attachment on its own is a brief, because a
 * client who sent a PDF should not have to retype it.
 */

const BRIEF = 'Harbour Dental is a family practice in Portsmouth offering routine and emergency care. The page has to get a nervous adult patient to book their first appointment online. The tone must stay calm, plain and reassuring throughout.';

async function open(page, { advanced = false } = {}) {
  await page.addInitScript(() => localStorage.clear());
  if (advanced) await useAdvancedBuilder(page);
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
}

/**
 * Drags files over the window and drops them, the way a desktop drag arrives.
 *
 * `files` are described rather than passed: a File cannot cross into the page, so
 * each one is built there from its name and its text.
 */
async function dropFiles(page, files, { dropIt = true } = {}) {
  return page.evaluate(async ({ list, drop }) => {
    const transfer = new DataTransfer();
    for (const entry of list) {
      const body = entry.docx
        ? await (async () => {
          // A real .docx: a ZIP whose word/document.xml is deflated, written here
          // so the format is proven through the app rather than only in a unit.
          const encode = (value) => new TextEncoder().encode(value);
          const u16 = (value) => new Uint8Array([value & 0xff, (value >> 8) & 0xff]);
          const u32 = (value) => new Uint8Array([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff]);
          const join = (parts) => {
            const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
            let at = 0;
            for (const part of parts) { out.set(part, at); at += part.length; }
            return out;
          };
          const xml = encode(`<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>${entry.text}</w:t></w:r></w:p></w:body></w:document>`);
          const deflated = new Uint8Array(await new Response(new Blob([xml]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
          const name = encode('word/document.xml');
          const local = join([u32(0x04034b50), u16(20), u16(0), u16(8), u16(0), u16(0), u32(0), u32(deflated.length), u32(xml.length), u16(name.length), u16(0), name, deflated]);
          const central = join([u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(0), u16(0), u32(0), u32(deflated.length), u32(xml.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(0), name]);
          const end = join([u32(0x06054b50), u16(0), u16(0), u16(1), u16(1), u32(central.length), u32(local.length), u16(0)]);
          return join([local, central, end]);
        })()
        : entry.text;
      transfer.items.add(new File([entry.bytes ? new Uint8Array(entry.bytes) : body], entry.name, { type: entry.type || '' }));
    }
    window.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: transfer }));
    window.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: transfer }));
    const sheetShowing = !document.getElementById('briefDrop').hidden;
    if (drop) window.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    return { sheetShowing };
  }, { list: files, drop: dropIt });
}

/** The paragraph in the textarea — what the strategist typed, and only that. */
const briefText = (page) => page.evaluate(() => window.__SBS_TEST_API.simple.ensure().briefText || '');

/** The whole brief as the brain receives it: the paragraph plus every attachment. */
const briefSource = (page) => page.evaluate(() => window.__SBS_TEST_API.documents.source());

/** What is attached, by name and kind. */
const attached = (page) => page.evaluate(() => window.__SBS_TEST_API.documents.attached()
  .map((file) => ({ name: file.name, kind: file.kind, characters: file.characters })));

test.describe('the brief can arrive as a file', () => {
  test('a file dragged anywhere over the app opens one target that cannot be missed', async ({ page }) => {
    await open(page);
    const { sheetShowing } = await dropFiles(page, [{ name: 'brief.txt', text: BRIEF, type: 'text/plain' }], { dropIt: false });
    expect(sheetShowing, 'no drop target appeared while a file was over the window').toBe(true);
    await expect(page.locator('#briefDrop')).toContainText('nothing is uploaded');
    // And it goes away again when the drag leaves rather than sitting there.
    await page.evaluate(() => window.dispatchEvent(new DragEvent('dragleave', { bubbles: true, dataTransfer: new DataTransfer() })));
  });

  test('a dropped file is attached by name, and its words go to the brain', async ({ page }) => {
    await open(page);
    await dropFiles(page, [{ name: 'harbour-brief.txt', text: BRIEF, type: 'text/plain' }]);

    // It shows as a document: its name, its kind, its length.
    await expect.poll(() => attached(page)).toEqual([
      { name: 'harbour-brief.txt', kind: 'plain', characters: BRIEF.length },
    ]);
    const chip = page.locator('#editorInner .brief-file');
    await expect(chip).toContainText('harbour-brief.txt');
    await expect(chip).toContainText('Text file');
    await expect(chip.locator('svg')).toBeVisible();

    // And the textarea is left alone — this is the whole point.
    expect(await briefText(page)).toBe('');
    await expect(page.locator('#simple-brief')).toHaveValue('');

    // The brain still gets the words, under the document's own name.
    expect(await briefSource(page)).toContain('nervous adult patient');
    expect(await briefSource(page)).toContain('harbour-brief.txt');

    await expect(page.locator('#toast')).toContainText('harbour-brief.txt');
    // An attachment on its own is a brief, so the button that reads it is live.
    await expect(page.locator('[data-brain-action="build-concepts"]')).toBeEnabled();
    await expect(page.locator('.brief-checklist em')).toContainText('1 attached');
  });

  test('an attachment can be taken off again', async ({ page }) => {
    await open(page);
    await dropFiles(page, [{ name: 'harbour-brief.txt', text: BRIEF, type: 'text/plain' }]);
    await expect(page.locator('#editorInner .brief-file')).toHaveCount(1);

    await page.locator('[data-brief-file-remove]').click();

    await expect(page.locator('#editorInner .brief-file')).toHaveCount(0);
    expect(await attached(page)).toEqual([]);
    expect(await briefSource(page)).toBe('');
    await expect(page.locator('#toast')).toContainText('removed from the brief');
    // And the button goes back to needing a brief.
    await expect(page.locator('[data-brain-action="build-concepts"]')).toBeDisabled();
  });

  test('the same file dropped twice is one attachment', async ({ page }) => {
    await open(page);
    await dropFiles(page, [{ name: 'harbour-brief.txt', text: BRIEF, type: 'text/plain' }]);
    await expect(page.locator('#editorInner .brief-file')).toHaveCount(1);
    await dropFiles(page, [{ name: 'harbour-brief.txt', text: BRIEF, type: 'text/plain' }]);
    await expect(page.locator('#editorInner .brief-file')).toHaveCount(1);
  });

  test('a real .docx is unpacked and read in the browser', async ({ page }) => {
    await open(page);
    await dropFiles(page, [{ name: 'discovery.docx', text: BRIEF, docx: true }]);
    await expect.poll(() => briefSource(page)).toContain('nervous adult patient');
    expect(await attached(page)).toMatchObject([{ name: 'discovery.docx', kind: 'docx' }]);
    await expect(page.locator('#editorInner .brief-file')).toContainText('Word document');
  });

  /**
   * The case that sent a real Word document back as "probably a scan".
   *
   * Printed by this browser rather than assembled by hand: Chromium embeds its
   * fonts as `Type0`/`Identity-H` subsets, where a pair of bytes is a glyph
   * number that means nothing until the `/ToUnicode` table is resolved. It is
   * the same shape a Word or Pages export produces, and reading the bytes
   * straight through returns noise indistinguishable from a scan.
   */
  test('a PDF printed by a real engine is read, fonts and all', async ({ page, browser }) => {
    const printer = await browser.newPage();
    await printer.setContent(`<article style="font:16px Georgia,serif;padding:40px">
      <h1>Red Moon Motorcycles</h1>
      <p>A premium motorcycle rental near the Grand Canyon, renting non-Harley bikes to
      international visitors, with multi-language support and a merch store.</p>
      <p>The audience is affluent experience-seekers and influencers; the tone is
      story-driven and premium rather than transactional.</p>
    </article>`);
    const printed = await printer.pdf({ format: 'A4' });
    await printer.close();

    await open(page);
    await dropFiles(page, [{ name: 'red-moon.pdf', type: 'application/pdf', bytes: [...printed] }]);
    await expect.poll(() => briefSource(page), { timeout: 15_000 }).toContain('Red Moon Motorcycles');
    expect(await attached(page)).toMatchObject([{ name: 'red-moon.pdf', kind: 'pdf' }]);
    await expect(page.locator('#editorInner .brief-file')).toContainText('PDF');
    // The textarea stays the strategist's own.
    expect(await briefText(page)).toBe('');
    const brief = await briefSource(page);
    expect(brief).toContain('premium motorcycle rental near the Grand Canyon');
    // Word gaps and hyphens both survive, which is what separates a readable
    // brief from a wall of joined-up letters.
    expect(brief).toContain('multi-language support');
    expect(brief).toContain('experience-seekers');
  });

  test('two documents are two attachments, each under its own name', async ({ page }) => {
    await open(page);
    await dropFiles(page, [
      { name: 'goal.txt', text: BRIEF, type: 'text/plain' },
      { name: 'tone-of-voice.txt', text: 'Plain English. Short sentences. Never clinical, never salesy, and never exclamation marks.', type: 'text/plain' },
    ]);
    await expect(page.locator('#editorInner .brief-file')).toHaveCount(2);
    expect((await attached(page)).map((file) => file.name)).toEqual(['goal.txt', 'tone-of-voice.txt']);
    // The brain sees both, and can tell which sentence came from which document.
    const source = await briefSource(page);
    expect(source).toContain('goal.txt');
    expect(source).toContain('tone-of-voice.txt');
    expect(source).toContain('Never clinical');
    await expect(page.locator('.brief-checklist em')).toContainText('2 attached');
  });

  test('a brief already typed is left exactly as it was', async ({ page }) => {
    await open(page);
    await page.locator('#simple-brief').fill('What the strategist typed first.');
    await dropFiles(page, [{ name: 'extra.txt', text: BRIEF, type: 'text/plain' }]);
    await expect(page.locator('#editorInner .brief-file')).toHaveCount(1);

    // Not appended to, not replaced: untouched.
    await expect(page.locator('#simple-brief')).toHaveValue('What the strategist typed first.');
    expect(await briefText(page)).toBe('What the strategist typed first.');
    // The brain reads the paragraph first, then the document.
    const source = await briefSource(page);
    expect(source.startsWith('What the strategist typed first.')).toBe(true);
    expect(source).toContain('nervous adult patient');
  });

  test('a state change survives the render it causes, cursor still in the field', async ({ page }) => {
    await open(page);
    // The defect this guards: replacing the editor's markup blurs the focused
    // textarea, the blur is answered with a `change` carrying the value from
    // *before* the render, and every handler on the editor reads that as
    // typing. The brief read out of the document was overwritten by its own
    // stale markup, so the drop looked like it had done nothing at all.
    await page.locator('#simple-brief').click();
    await page.locator('#simple-brief').fill('Half a sentence typed by hand');
    await dropFiles(page, [{ name: 'client-brief.txt', text: BRIEF, type: 'text/plain' }]);
    await expect.poll(() => attached(page)).toMatchObject([{ name: 'client-brief.txt' }]);
    // Twice over: the same window in which the revert used to land.
    await page.waitForTimeout(700);
    expect((await attached(page)).length).toBe(1);
    expect(await briefSource(page)).toContain('nervous adult patient');
    // And the half-sentence the strategist was mid-way through is still theirs.
    await expect(page.locator('#simple-brief')).toHaveValue('Half a sentence typed by hand');
  });

  test('a format it cannot open is refused by name, with the reason', async ({ page }) => {
    await open(page);
    await dropFiles(page, [{ name: 'legacy brief.doc', text: BRIEF }]);
    await expect(page.locator('#toast')).toContainText('legacy brief.doc');
    await expect(page.locator('#toast')).toContainText('save it as .docx or PDF');
    expect(await briefText(page)).toBe('');
    expect(await attached(page)).toEqual([]);
  });

  test('the advanced builder splits the document into its brief fields', async ({ page }) => {
    // The splitter is stubbed rather than left to whatever server happens to be
    // running: what is under test is that a document reaches the fields, not
    // whether a model is reachable today.
    await page.route('**/api/brief/expand', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        industry: 'Family dental practice in Portsmouth',
        audience: 'Nervous adult patients who have avoided the dentist',
        goal: 'Book a first appointment online',
        offer: 'Gentle judgement-free dentistry with fixed pricing',
        tone: 'Calm, plain and reassuring',
        keywords: 'gentle care, fixed pricing',
        clientName: 'Harbour Dental',
        source: 'model',
        model: 'stub',
      }),
    }));
    await open(page, { advanced: true });
    await dropFiles(page, [{ name: 'brief.txt', text: BRIEF, type: 'text/plain' }]);

    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.brief.goal)).toContain('Book a first appointment');
    const brief = await page.evaluate(() => window.__SBS_TEST_API.state.project.brief);
    expect(brief.audience).toContain('Nervous adult patients');
    expect(brief.clientName).toBe('Harbour Dental');
    // The document is attached rather than dumped into the internal note — the
    // same "pasted into a textarea" problem in a different box.
    expect(brief.notes).not.toContain('nervous adult patient');
    expect(await attached(page)).toMatchObject([{ name: 'brief.txt' }]);
    await expect(page.locator('#toast')).toContainText('filled in from it');
    expect(await page.evaluate(() => window.__SBS_TEST_API.state.currentStep)).toBe(0);
  });

  test('with no splitter reachable the words are still kept, and it says so', async ({ page }) => {
    await page.route('**/api/brief/expand', (route) => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'PROVIDER_UNAVAILABLE', message: 'The brief service is unavailable.' } }),
    }));
    await open(page, { advanced: true });
    await dropFiles(page, [{ name: 'brief.txt', text: BRIEF, type: 'text/plain' }]);
    // The words are not lost when the splitter is unreachable: they are on the
    // attachment, which is where they live now.
    await expect.poll(() => briefSource(page)).toContain('nervous adult patient');
    expect(await attached(page)).toMatchObject([{ name: 'brief.txt' }]);
    await expect(page.locator('#toast')).toContainText('fill them in yourself');
  });

  test('both builders show the drop zone in their brief step', async ({ page }) => {
    await open(page);
    const simpleZone = page.locator('#editorInner [data-brief-drop]');
    await expect(simpleZone).toContainText('Drop the brief document here');
    await expect(simpleZone.locator('input[type="file"]')).toHaveAttribute('accept', /\.pdf/);
    await expect(simpleZone.locator('input[type="file"]')).toHaveAttribute('accept', /\.docx/);

    await page.evaluate(() => window.__SBS_TEST_API.simple.setMode('advanced', { force: true }));
    await expect(page.locator('#editorInner [data-brief-drop]')).toContainText('Drop the brief document here');
  });

  test('a concept export dropped on the window is still an import, not a brief', async ({ page }) => {
    await open(page);
    const concept = await page.evaluate(() => JSON.stringify(window.__SBS_TEST_API.simple.buildConceptExport()));
    await dropFiles(page, [{ name: 'concept.json', text: concept, type: 'application/json' }]);
    await expect(page.locator('#toast')).toContainText('Concept imported');
    expect(await page.evaluate(() => window.__SBS_TEST_API.simple.mode())).toBe('advanced');
  });
});
