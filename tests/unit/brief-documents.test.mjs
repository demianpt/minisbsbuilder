import { describe, expect, it } from 'vitest';
import {
  BRIEF_DOCUMENT_ACCEPT,
  BRIEF_TEXT_LIMIT,
  briefDocumentKind,
  docxXmlToText,
  fitBriefText,
  isBriefDocument,
  normalizeBriefText,
  readBriefDocument,
  readBriefDocuments,
  rtfToText,
  zipEntries,
} from '../../shared/brief/documents.mjs';

const BRIEF = 'Harbour Dental is a family practice in Portsmouth. The page has to get a nervous adult patient to book their first appointment online, and the tone must stay calm and plain.';

/* ------------------------------------------------------------------ *
 * Fixtures
 *
 * Real files, built here rather than committed: a .docx is a ZIP and a PDF is a
 * set of streams, so anything that can write those two containers can prove the
 * readers open them. The alternative — binary fixtures in the repo — cannot be
 * reviewed and cannot be varied.
 * ------------------------------------------------------------------ */

async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function ascii(value) {
  return new TextEncoder().encode(value);
}

function concat(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

function u16(value) { return new Uint8Array([value & 0xff, (value >> 8) & 0xff]); }
function u32(value) { return new Uint8Array([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff]); }

/** A ZIP with one deflated entry per file. CRCs are zeroed: nothing reads them. */
async function makeZip(files) {
  const locals = [];
  const directory = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = ascii(text);
    const body = await deflateRaw(raw);
    const nameBytes = ascii(name);
    const local = concat([u32(0x04034b50), u16(20), u16(0), u16(8), u16(0), u16(0), u32(0), u32(body.length), u32(raw.length), u16(nameBytes.length), u16(0), nameBytes, body]);
    locals.push(local);
    directory.push(concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(0), u16(0), u32(0),
      u32(body.length), u32(raw.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes,
    ]));
    offset += local.length;
  }
  const central = concat(directory);
  const eocd = concat([u32(0x06054b50), u16(0), u16(0), u16(directory.length), u16(directory.length), u32(central.length), u32(offset), u16(0)]);
  return concat([...locals, central, eocd]);
}

function docxXml(paragraphs) {
  const body = paragraphs.map((line) => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`;
}

/** A PDF whose one page draws `lines`, optionally with a deflated stream. */
async function makePdf(lines, { compress = false } = {}) {
  const content = ['BT /F1 12 Tf 72 720 Td', ...lines.map((line) => `(${line}) Tj 0 -16 Td`), 'ET'].join('\n');
  const raw = ascii(content);
  const body = compress ? await deflate(raw) : raw;
  const head = ascii('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n2 0 obj<</Length ' + body.length + (compress ? '/Filter/FlateDecode' : '') + '>>stream\n');
  const tail = ascii('\nendstream endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
  return concat([head, body, tail]);
}

function asFile(bytes, name, type = '') {
  return new File([bytes], name, { type });
}

/* ------------------------------------------------------------------ *
 * What a file is
 * ------------------------------------------------------------------ */

describe('recognising a brief document', () => {
  it('reads the kind off the name, whatever the browser claims the type is', () => {
    expect(briefDocumentKind('Discovery deck.PDF', 'application/octet-stream')).toBe('pdf');
    expect(briefDocumentKind('brief.docx', 'application/octet-stream')).toBe('docx');
    expect(briefDocumentKind('notes.md')).toBe('plain');
    expect(briefDocumentKind('brief.rtf')).toBe('rtf');
  });

  it('names the two formats it will not open instead of pretending they failed', () => {
    expect(briefDocumentKind('legacy brief.doc')).toBe('legacy-doc');
    expect(briefDocumentKind('brief.pages')).toBe('other-office');
    expect(isBriefDocument('legacy brief.doc')).toBe(false);
    expect(isBriefDocument('brief.pdf')).toBe(true);
  });

  it('offers every format it can read on the file picker', () => {
    for (const extension of ['.pdf', '.docx', '.rtf', '.txt', '.md']) {
      expect(BRIEF_DOCUMENT_ACCEPT).toContain(extension);
    }
    expect(BRIEF_DOCUMENT_ACCEPT).not.toContain('.doc,');
  });
});

/* ------------------------------------------------------------------ *
 * The formats
 * ------------------------------------------------------------------ */

describe('reading a .docx', () => {
  it('finds the body in a real ZIP and keeps the paragraphs', async () => {
    const zip = await makeZip({
      '[Content_Types].xml': '<Types/>',
      'word/document.xml': docxXml(['Harbour Dental, Portsmouth.', 'The goal is one booked appointment.']),
    });
    expect(zipEntries(zip).map((entry) => entry.name)).toContain('word/document.xml');
    const result = await readBriefDocument(asFile(zip, 'brief.docx'));
    expect(result.reason).toBe('');
    expect(result.text).toBe('Harbour Dental, Portsmouth.\nThe goal is one booked appointment.');
  });

  it('turns tabs, breaks and entities into the characters they stand for', () => {
    expect(docxXmlToText('<w:p><w:r><w:t>Fees</w:t></w:r><w:tab/><w:t>&#163;40 &amp; up</w:t><w:br/><w:t>Same week</w:t></w:p>'))
      .toBe('Fees\t£40 & up\nSame week\n');
  });

  it('refuses a ZIP that is not a Word document, by name', async () => {
    const zip = await makeZip({ 'notes.txt': BRIEF });
    const result = await readBriefDocument(asFile(zip, 'brief.docx'));
    expect(result.text).toBe('');
    expect(result.reason).toContain('no document body');
  });
});

describe('reading text formats', () => {
  it('reads a plain text file as it stands', async () => {
    const result = await readBriefDocument(asFile(ascii(BRIEF), 'brief.txt', 'text/plain'));
    expect(result.text).toBe(BRIEF);
  });

  it('strips RTF markup down to the prose', () => {
    const rtf = `{\\rtf1\\ansi{\\fonttbl\\f0 Helvetica;}\\f0\\fs24 Harbour Dental\\par Portsmouth\\tab practice}`;
    expect(rtfToText(rtf).replace(/\s+/g, ' ').trim()).toBe('Harbour Dental Portsmouth practice');
  });

  it('takes the words out of an HTML export', async () => {
    const html = '<html><head><style>p{color:red}</style></head><body><p>Harbour Dental, Portsmouth.</p><p>Book one nervous patient in.</p></body></html>';
    const result = await readBriefDocument(asFile(ascii(html), 'brief.html', 'text/html'));
    expect(result.text).toBe('Harbour Dental, Portsmouth.\nBook one nervous patient in.');
  });
});

/* ------------------------------------------------------------------ *
 * Turning documents into a brief
 * ------------------------------------------------------------------ */

describe('normalising what came out', () => {
  it('collapses the whitespace a document layout leaves behind', () => {
    expect(normalizeBriefText('Harbour   Dental\r\n\r\n\r\n\r\nPortsmouth   practice')).toBe('Harbour Dental\n\nPortsmouth practice');
  });

  it('drops the invisible characters an exporter leaves in prose', () => {
    expect(normalizeBriefText('Harbour­Dental​ practice')).toBe('HarbourDental practice');
  });

  it('cuts to the limit on a word boundary and says it did', () => {
    const long = 'word '.repeat(1_200).trim();
    const fitted = fitBriefText(long, 4_000);
    expect(fitted.truncated).toBe(true);
    expect(fitted.text.length).toBeLessThanOrEqual(4_000);
    expect(fitted.text.endsWith('word')).toBe(true);
    expect(fitBriefText('short', 4_000)).toEqual({ text: 'short', truncated: false });
  });

  it('takes a whole discovery document without trimming it', async () => {
    // The size that made this worth changing: a ten-page meeting-notes PDF is
    // twelve thousand characters, and the old four-thousand cap threw away the
    // audience, the scope and the budget — the two thirds worth reading.
    const document = `Discovery notes. ${'The audience is international visitors near the Grand Canyon. '.repeat(200)}`;
    expect(document.length).toBeGreaterThan(11_000);
    const result = await readBriefDocuments([asFile(ascii(document), 'discovery.txt')]);
    expect(BRIEF_TEXT_LIMIT).toBeGreaterThanOrEqual(12_000);
    expect(result.truncated).toBe(false);
    expect(result.characters).toBe(document.trim().length);
  });
});

describe('a drop of several files', () => {
  it('joins what it read, names each one and reports what it skipped', async () => {
    const docx = await makeZip({ 'word/document.xml': docxXml(['Harbour Dental, Portsmouth. Nervous adult patients.']) });
    const result = await readBriefDocuments([
      asFile(ascii(BRIEF), 'goal.txt'),
      asFile(docx, 'discovery.docx'),
      asFile(ascii(BRIEF), 'old brief.doc'),
    ]);
    expect(result.read.map((entry) => entry.name)).toEqual(['goal.txt', 'discovery.docx']);
    expect(result.text).toContain('goal.txt');
    expect(result.text).toContain('discovery.docx');
    expect(result.text).toContain('Nervous adult patients.');
    expect(result.skipped).toEqual([{ name: 'old brief.doc', reason: 'a .doc from an old Word version - save it as .docx or PDF first' }]);
  });

  it('keeps a brief already written and adds the document under it', async () => {
    const result = await readBriefDocuments([asFile(ascii(BRIEF), 'extra.txt')], { existing: 'What the strategist typed.' });
    expect(result.text.startsWith('What the strategist typed.')).toBe(true);
    expect(result.text).toContain('extra.txt');
  });

  it('reads one file into the brief with no filename heading in the way', async () => {
    const result = await readBriefDocuments([asFile(ascii(BRIEF), 'brief.txt')]);
    expect(result.text).toBe(BRIEF);
    expect(result.characters).toBe(BRIEF.length);
  });

  it('says nothing was read rather than throwing when every file fails', async () => {
    const result = await readBriefDocuments([asFile(ascii(''), 'empty.txt'), asFile(ascii(BRIEF), 'brief.pages')]);
    expect(result.read).toEqual([]);
    expect(result.text).toBe('');
    expect(result.skipped).toHaveLength(2);
  });
});
