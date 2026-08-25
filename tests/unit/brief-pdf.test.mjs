import { describe, expect, it } from 'vitest';
import { decodeWinAnsi, dictValue, extractPdfText, looksLikeText, parseCMap, pdfStreamText } from '../../shared/brief/pdf.mjs';

/**
 * Reading a PDF.
 *
 * The fixtures are real containers built here rather than binaries committed to
 * the repository: a PDF is a set of objects and streams, so anything that can
 * write those can prove the reader opens them, and a fixture written in the test
 * can be reviewed and varied. The two that matter are the two a real export
 * produces — a simple `WinAnsiEncoding` font where a byte is nearly a character,
 * and a `Type0`/`Identity-H` font where a *pair* of bytes is a glyph number that
 * means nothing without the `/ToUnicode` table.
 */

const encode = (value) => new TextEncoder().encode(value);

function join(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

async function deflate(bytes) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
}

/**
 * A one-page PDF with a real page tree, assembled object by object.
 *
 * `content` is the page's drawing instructions; `objects` are any extra objects
 * it refers to (a font, a CMap). Offsets are never written, because the reader
 * finds objects by scanning rather than by trusting a cross-reference table —
 * which is also what lets it read the many real files whose table is wrong.
 */
async function makePdf({ content, resources = '<</Font<</F1 5 0 R>>>>', objects = [], compress = false }) {
  const body = compress ? await deflate(encode(content)) : encode(content);
  const parts = [encode('%PDF-1.7\n')];
  parts.push(encode('1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'));
  parts.push(encode('2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'));
  parts.push(encode(`3 0 obj<</Type/Page/Parent 2 0 R/Resources ${resources}/Contents 4 0 R>>endobj\n`));
  parts.push(encode(`4 0 obj<</Length ${body.length}${compress ? '/Filter/FlateDecode' : ''}>>stream\n`));
  parts.push(body);
  parts.push(encode('\nendstream\nendobj\n'));
  for (const object of objects) parts.push(encode(`${object}\n`));
  parts.push(encode('trailer<</Root 1 0 R>>\n%%EOF'));
  return join(parts);
}

/* A subset font: every code is a glyph number, and the table below is the only
 * thing in the file that says which letter each one draws. */
const CID_TEXT = 'Red Moon Motorcycles rents premium bikes near the Grand Canyon';
const CID_CODES = [...new Set(CID_TEXT)].sort();
const cidFor = (char) => CID_CODES.indexOf(char) + 3;
const hex4 = (value) => value.toString(16).padStart(4, '0');
const cidString = (text) => [...text].map((char) => hex4(cidFor(char))).join('');

function cidCMap() {
  const entries = CID_CODES.map((char) => `<${hex4(cidFor(char))}> <${hex4(char.codePointAt(0))}>`);
  return [
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
    '1 begincodespacerange <0000> <FFFF> endcodespacerange',
    `${entries.length} beginbfchar`,
    ...entries,
    'endbfchar',
    'endcmap end end',
  ].join('\n');
}

/* ------------------------------------------------------------------ *
 * The content stream
 * ------------------------------------------------------------------ */

describe('interpreting a content stream', () => {
  it('reads the shown strings and the line the pen is on', () => {
    const text = pdfStreamText('BT /F1 12 Tf 72 720 Td (Harbour Dental) Tj 0 -16 Td (Portsmouth practice) Tj ET');
    expect(text.trim()).toBe('Harbour Dental\nPortsmouth practice');
  });

  it('reads a word gap out of the kerning, because a PDF stores no spaces', () => {
    expect(pdfStreamText('BT /F1 12 Tf 72 720 Td [(Har)-260(bour)-320(Dental)] TJ ET').trim()).toBe('Har bour Dental');
    // A small adjustment is letter-spacing inside one word, not a gap.
    expect(pdfStreamText('BT /F1 12 Tf 72 720 Td [(Har)-20(bour)] TJ ET').trim()).toBe('Harbour');
  });

  it('decodes escapes, nested brackets and hex strings', () => {
    expect(pdfStreamText('BT (Fees \\(from \\24340\\)) Tj ET').trim()).toBe('Fees (from £40)');
    expect(pdfStreamText('BT <48617262 6f7572> Tj ET').trim()).toBe('Harbour');
  });

  it('joins runs placed side by side on one line, and breaks the next line', () => {
    // Word splits a hyphenated word into three placements at touching positions.
    // Treating each placement as a gap is what produced "multi - language".
    // `Tm` places absolutely, which is what an exporter emits per run; `Td`
    // moves relatively, which is why the second line below is 20 units down and
    // not at 680 twice over.
    const oneWord = 'BT /F1 11 Tf 1 0 0 1 72 700 Tm (multi) Tj 1 0 0 1 99 700 Tm (-) Tj 1 0 0 1 102 700 Tm (language) Tj ET';
    expect(pdfStreamText(oneWord).trim()).toBe('multi-language');
    const twoWords = 'BT /F1 11 Tf 1 0 0 1 72 700 Tm (premium) Tj 1 0 0 1 140 700 Tm (rentals) Tj ET';
    expect(pdfStreamText(twoWords).trim()).toBe('premium rentals');
    const twoLines = 'BT /F1 11 Tf 72 700 Td (first line) Tj 0 -20 Td (second line) Tj ET';
    expect(pdfStreamText(twoLines).trim()).toBe('first line\nsecond line');
  });

  it('keeps a paragraph together across the BT blocks a run is wrapped in', () => {
    const runs = 'BT /F1 11 Tf 72 700 Td (A premium ) Tj ET BT /F1 11 Tf 130 700 Td (experience) Tj ET BT /F1 11 Tf 72 680 Td (near the canyon) Tj ET';
    expect(pdfStreamText(runs).trim()).toBe('A premium experience\nnear the canyon');
  });

  it('reads WinAnsi where it differs from Latin-1, which is every apostrophe Word writes', () => {
    expect(decodeWinAnsi('don\x92t \x93quoted\x94 \x96 dash')).toBe('don’t “quoted” – dash');
    expect(pdfStreamText('BT (Susan\x92s brief) Tj ET').trim()).toBe('Susan’s brief');
  });
});

/* ------------------------------------------------------------------ *
 * Fonts
 * ------------------------------------------------------------------ */

describe('the /ToUnicode table', () => {
  it('reads single codes, listed runs and spanned runs', () => {
    const cmap = parseCMap([
      '1 begincodespacerange <0000> <FFFF> endcodespacerange',
      '2 beginbfchar <0003> <0020> <0024> <0041> endbfchar',
      '2 beginbfrange <0025> <0027> <0042> <0030> <0032> [<0058> <0059> <005A>] endbfrange',
    ].join('\n'));
    expect(cmap.width).toBe(2);
    expect(cmap.map.get(0x03)).toBe(' ');
    expect(cmap.map.get(0x24)).toBe('A');
    // A spanned run counts up from its destination.
    expect(cmap.map.get(0x25)).toBe('B');
    expect(cmap.map.get(0x27)).toBe('D');
    // A listed run takes one destination per code.
    expect(cmap.map.get(0x30)).toBe('X');
    expect(cmap.map.get(0x32)).toBe('Z');
  });

  it('states the code width, so a two-byte font is not read one byte at a time', () => {
    expect(parseCMap('1 begincodespacerange <00> <FF> endcodespacerange').width).toBe(1);
    expect(parseCMap('1 begincodespacerange <0000> <FFFF> endcodespacerange').width).toBe(2);
  });

  it('expands a destination that is more than one character', () => {
    const cmap = parseCMap('1 beginbfchar <0003> <00660066> endbfchar');
    expect(cmap.map.get(0x03)).toBe('ff');
  });
});

describe('reading dictionaries', () => {
  it('reads a key of the dictionary itself, not of one nested inside it', () => {
    const dict = '<</Type/Page/Resources<</Type/Nonsense/Font<</F1 5 0 R>>>>/Contents 4 0 R>>';
    expect(dictValue(dict, 'Type')).toBe('/Page');
    expect(dictValue(dict, 'Contents')).toBe('4 0 R');
    expect(dictValue(dict, 'Resources')).toContain('/Font');
  });
});

/* ------------------------------------------------------------------ *
 * Whole files
 * ------------------------------------------------------------------ */

describe('reading a PDF', () => {
  it('reads a page written in a simple font', async () => {
    const pdf = await makePdf({
      content: 'BT /F1 12 Tf 72 720 Td (Harbour Dental is a family practice in Portsmouth.) Tj 0 -16 Td (The page must book one nervous patient.) Tj ET',
      objects: ['5 0 obj<</Type/Font/Subtype/TrueType/BaseFont/Calibri/Encoding/WinAnsiEncoding>>endobj'],
    });
    const text = await extractPdfText(pdf);
    expect(text).toContain('Harbour Dental is a family practice in Portsmouth.');
    expect(text).toContain('The page must book one nervous patient.');
  });

  it('inflates a compressed content stream, which is what a real exporter writes', async () => {
    const pdf = await makePdf({
      content: 'BT /F1 12 Tf 72 720 Td (Calm, plain and reassuring throughout the whole page.) Tj ET',
      objects: ['5 0 obj<</Type/Font/Subtype/TrueType/Encoding/WinAnsiEncoding>>endobj'],
      compress: true,
    });
    expect(await extractPdfText(pdf)).toContain('Calm, plain and reassuring throughout');
  });

  /**
   * The case that made a real Word document read as a scan.
   *
   * The bytes here are glyph numbers in a subset font. Read as characters they
   * are noise; read through the `/ToUnicode` table the exporter shipped with
   * them they are the sentence. Nothing about the file says which, except the
   * font — so the reader has to resolve the font.
   */
  it('reads a Type0 font by its /ToUnicode table, not by its bytes', async () => {
    const cmap = cidCMap();
    const pdf = await makePdf({
      content: `BT /F1 11 Tf 72 700 Td <${cidString(CID_TEXT)}> Tj ET`,
      objects: [
        '5 0 obj<</Type/Font/Subtype/Type0/BaseFont/AAAAAA+Calibri/Encoding/Identity-H/DescendantFonts[6 0 R]/ToUnicode 7 0 R>>endobj',
        '6 0 obj<</Type/Font/Subtype/CIDFontType2/BaseFont/AAAAAA+Calibri>>endobj',
        `7 0 obj<</Length ${cmap.length}>>stream\n${cmap}\nendstream\nendobj`,
      ],
    });
    const text = await extractPdfText(pdf);
    expect(text).toContain(CID_TEXT);
    // And the proof that this needed the table: the raw bytes are not the text.
    expect(pdfStreamText(`BT <${cidString(CID_TEXT)}> Tj ET`)).not.toContain('Red Moon');
  });

  it('reads a document whose fonts and pages are packed in an object stream', async () => {
    // PDF 1.5 onward: page and font dictionaries live inside a compressed
    // object stream, so a reader that only scans the file body finds no pages.
    const packed = '<</Type/Catalog/Pages 2 0 R>> <</Type/Pages/Kids[3 0 R]/Count 1>> <</Type/Page/Parent 2 0 R/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>> <</Type/Font/Subtype/TrueType/Encoding/WinAnsiEncoding>>';
    const offsets = [];
    let at = 0;
    for (const [index, part] of packed.split(' <<').entries()) {
      offsets.push(`${[1, 2, 3, 5][index]} ${at}`);
      at += (index ? part.length + 3 : part.length) + 1;
    }
    const header = `${offsets.join(' ')} `;
    const stream = header + packed;
    const content = 'BT /F1 12 Tf 72 700 Td (Packed away in an object stream, and still readable.) Tj ET';
    const pdf = join([
      encode('%PDF-1.7\n'),
      encode(`8 0 obj<</Type/ObjStm/N 4/First ${header.length}/Length ${stream.length}>>stream\n${stream}\nendstream\nendobj\n`),
      encode(`4 0 obj<</Length ${content.length}>>stream\n${content}\nendstream\nendobj\n`),
      encode('trailer<</Root 1 0 R>>\n%%EOF'),
    ]);
    expect(await extractPdfText(pdf)).toContain('Packed away in an object stream');
  });

  it('reads the pages in the order the page tree gives them', async () => {
    const page = (number, content) => `${number} 0 obj<</Type/Page/Parent 2 0 R/Resources<</Font<</F1 9 0 R>>>>/Contents ${number + 10} 0 R>>endobj\n${number + 10} 0 obj<</Length ${content.length}>>stream\n${content}\nendstream\nendobj`;
    const pdf = join([
      encode('%PDF-1.7\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'),
      // Kids out of object order: the tree is the authority, not the file layout.
      encode('2 0 obj<</Type/Pages/Kids[4 0 R 3 0 R]/Count 2>>endobj\n'),
      encode(`${page(3, 'BT /F1 12 Tf 72 700 Td (This paragraph is printed on the second page of the file.) Tj ET')}\n`),
      encode(`${page(4, 'BT /F1 12 Tf 72 700 Td (This paragraph is printed on the first page of the file.) Tj ET')}\n`),
      encode('9 0 obj<</Type/Font/Subtype/TrueType/Encoding/WinAnsiEncoding>>endobj\n'),
      encode('trailer<</Root 1 0 R>>\n%%EOF'),
    ]);
    const text = await extractPdfText(pdf);
    expect(text.indexOf('first page')).toBeGreaterThan(-1);
    expect(text.indexOf('first page')).toBeLessThan(text.indexOf('second page'));
  });

  it('leaves a picture alone instead of trying to read it as text', async () => {
    const pdf = await makePdf({
      content: 'BT /F1 12 Tf 72 700 Td (The only words in this file are in its content stream.) Tj ET',
      objects: [
        '5 0 obj<</Type/Font/Subtype/TrueType/Encoding/WinAnsiEncoding>>endobj',
        '6 0 obj<</Type/XObject/Subtype/Image/Filter/DCTDecode/Length 4>>stream\nÿØÿÙ\nendstream\nendobj',
      ],
    });
    const text = await extractPdfText(pdf);
    expect(text).toContain('The only words in this file');
    expect(looksLikeText(text)).toBe(true);
  });

  it('knows glyph numbers from words, so a scan is reported rather than pasted', () => {
    expect(looksLikeText('Harbour Dental is a family practice in Portsmouth offering routine care')).toBe(true);
    expect(looksLikeText('!@#$%^&*()12345678901234567890+={}[]<>?/|~`')).toBe(false);
    expect(looksLikeText('short')).toBe(false);
  });
});
