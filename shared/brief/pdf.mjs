/**
 * Reading the words out of a PDF.
 *
 * A PDF does not contain text. It contains instructions to draw glyphs, and the
 * bytes in those instructions mean whatever the font in force at the time says
 * they mean. For a Word or Chrome export that is two different things at once:
 * body copy in a `WinAnsiEncoding` TrueType font, where a byte is very nearly a
 * character, and anything the exporter subset — headings, links, bullets — in a
 * `Type0`/`Identity-H` font, where a *pair* of bytes is a glyph number with no
 * relationship to any alphabet.
 *
 * Reading the bytes directly therefore gets you half a document and half a pile
 * of noise, which is indistinguishable from a scan. Getting the other half means
 * doing what a reader does:
 *
 *   1. find the indirect objects, including the ones packed inside a compressed
 *      object stream, which is where a modern exporter puts its font dictionaries;
 *   2. walk the page tree so the pages come out in the order they are read in;
 *   3. for each page, resolve its font resources and each font's `/ToUnicode`
 *      CMap — the table the exporter wrote precisely so the text could be got
 *      back out;
 *   4. interpret the content stream, tracking which font is selected, and decode
 *      every shown string through that font.
 *
 * What is deliberately *not* here: encryption, predictors beyond PNG-up, CFF
 * charset reconstruction, and any attempt to recover text from a font with no
 * `/ToUnicode` at all. A file that needs those is reported as unreadable with
 * the reason, which is more use than a page of glyph numbers.
 */

import { inflate, latin1 } from './bytes.mjs';

/* The sixteen places WinAnsi differs from Latin-1. Word uses 0x92 for an
 * apostrophe in almost every sentence it writes, so skipping this table turns
 * "don't" into "don?t" throughout. */
const WIN_ANSI_HIGH = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…',
  0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š',
  0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’',
  0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
  0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ',
  0x9e: 'ž', 0x9f: 'Ÿ',
};

/** One byte string as characters, for a font that encodes text a byte at a time. */
export function decodeWinAnsi(value) {
  let out = '';
  for (let at = 0; at < value.length; at += 1) {
    const code = value.charCodeAt(at) & 0xff;
    out += code >= 0x80 && code <= 0x9f ? (WIN_ANSI_HIGH[code] || '') : String.fromCharCode(code);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Syntax
 * ------------------------------------------------------------------ */

const WHITESPACE = ' \t\r\n\f\0';

function skipWhitespace(raw, at) {
  let scan = at;
  while (scan < raw.length && WHITESPACE.includes(raw[scan])) scan += 1;
  return scan;
}

/** Past a `(…)` string, respecting escapes and nesting. */
function skipLiteralString(raw, at) {
  let scan = at + 1;
  let depth = 1;
  while (scan < raw.length && depth) {
    const char = raw[scan];
    if (char === '\\') { scan += 2; continue; }
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    scan += 1;
  }
  return scan;
}

/** The `<<…>>` dictionary starting at or after `from`, as text. */
function readDictionary(raw, from, limit) {
  const start = raw.indexOf('<<', from);
  if (start < 0 || start >= limit) return '';
  let depth = 0;
  let at = start;
  while (at < limit) {
    if (raw.startsWith('<<', at)) { depth += 1; at += 2; continue; }
    if (raw.startsWith('>>', at)) {
      depth -= 1;
      at += 2;
      if (!depth) return raw.slice(start, at);
      continue;
    }
    if (raw[at] === '(') { at = skipLiteralString(raw, at); continue; }
    at += 1;
  }
  return '';
}

/** Nesting depth at `at` inside a dictionary's own text. */
function depthAt(dict, at) {
  let depth = 0;
  let scan = 0;
  while (scan < at) {
    if (dict.startsWith('<<', scan)) { depth += 1; scan += 2; continue; }
    if (dict.startsWith('>>', scan)) { depth -= 1; scan += 2; continue; }
    if (dict[scan] === '(') { scan = skipLiteralString(dict, scan); continue; }
    if (dict[scan] === '[') { depth += 1; scan += 1; continue; }
    if (dict[scan] === ']') { depth -= 1; scan += 1; continue; }
    scan += 1;
  }
  return depth;
}

/** One token of a value: a dictionary, an array, a name, a reference or a number. */
function readValue(raw, from) {
  const at = skipWhitespace(raw, from);
  if (raw.startsWith('<<', at)) return readDictionary(raw, at, raw.length);
  if (raw[at] === '[') {
    let depth = 0;
    let scan = at;
    while (scan < raw.length) {
      if (raw[scan] === '[') depth += 1;
      else if (raw[scan] === ']') { depth -= 1; if (!depth) return raw.slice(at, scan + 1); }
      else if (raw[scan] === '(') { scan = skipLiteralString(raw, scan); continue; }
      scan += 1;
    }
    return raw.slice(at);
  }
  if (raw[at] === '(') return raw.slice(at, skipLiteralString(raw, at));
  const reference = /^(\d+)\s+(\d+)\s+R(?![A-Za-z])/.exec(raw.slice(at, at + 32));
  if (reference) return reference[0];
  const token = /^[^\s/<>[\]()]+/.exec(raw.slice(at, at + 128));
  if (raw[at] === '/') {
    const name = /^\/[^\s/<>[\]()]*/.exec(raw.slice(at, at + 128));
    return name ? name[0] : '';
  }
  return token ? token[0] : '';
}

/** The value of one of a dictionary's own keys, ignoring keys of nested dicts. */
export function dictValue(dict, key) {
  const pattern = new RegExp(`/${key}(?![A-Za-z0-9])`, 'g');
  let match;
  while ((match = pattern.exec(dict))) {
    if (depthAt(dict, match.index) !== 1) continue;
    return readValue(dict, match.index + match[0].length);
  }
  return '';
}

function referenceNumber(value) {
  const match = /^(\d+)\s+\d+\s+R$/.exec(String(value || '').trim());
  return match ? Number(match[1]) : 0;
}

/* ------------------------------------------------------------------ *
 * The document
 * ------------------------------------------------------------------ */

/** Undoes the PNG "up" predictor some exporters apply to a compressed stream. */
function unpredict(data, columns) {
  const stride = columns + 1;
  const rows = Math.floor(data.length / stride);
  const out = new Uint8Array(rows * columns);
  for (let row = 0; row < rows; row += 1) {
    const from = row * stride + 1;
    const to = row * columns;
    for (let column = 0; column < columns; column += 1) {
      const above = row ? out[to - columns + column] : 0;
      out[to + column] = (data[from + column] + above) & 0xff;
    }
  }
  return out;
}

class PdfDocument {
  constructor(bytes) {
    this.bytes = bytes;
    this.raw = latin1(bytes);
    this.objects = new Map();
    this.embedded = new Map();
    this.fonts = new Map();
    const pattern = /(?:^|[^0-9])(\d+)\s+(\d+)\s+obj\b/g;
    let match;
    while ((match = pattern.exec(this.raw))) {
      const start = match.index + match[0].length;
      const end = this.raw.indexOf('endobj', start);
      // Last definition wins: an incrementally updated file redefines an object
      // by writing it again, and the later copy is the current one.
      this.objects.set(Number(match[1]), { start, end: end < 0 ? this.raw.length : end });
    }
  }

  /** The text of object `number`, wherever it is stored. */
  body(number) {
    const top = this.objects.get(number);
    const packed = this.embedded.get(number);
    if (top) {
      const text = this.raw.slice(top.start, top.end);
      if (text.includes('<<') || !packed) return text;
    }
    return packed ? packed : '';
  }

  dictionary(number) {
    const text = this.body(number);
    return text ? readDictionary(text, 0, text.length) : '';
  }

  /** A value that may be written inline or as a reference, as a dictionary. */
  resolveDictionary(value) {
    const trimmed = String(value || '').trim();
    if (trimmed.startsWith('<<')) return trimmed;
    const number = referenceNumber(trimmed);
    return number ? this.dictionary(number) : '';
  }

  resolveNumber(value) {
    const trimmed = String(value || '').trim();
    if (/^\d+$/.test(trimmed)) return Number(trimmed);
    const number = referenceNumber(trimmed);
    if (!number) return 0;
    const body = this.body(number).trim();
    return /^\d+/.test(body) ? Number(/^\d+/.exec(body)[0]) : 0;
  }

  /** The decoded bytes of object `number`'s stream, or null. */
  async stream(number) {
    const entry = this.objects.get(number);
    if (!entry) return null;
    const dict = this.dictionary(number);
    const keyword = this.raw.indexOf('stream', entry.start);
    if (keyword < 0 || keyword > entry.end) return null;
    let from = keyword + 6;
    if (this.raw[from] === '\r') from += 1;
    if (this.raw[from] === '\n') from += 1;
    const declared = this.resolveNumber(dictValue(dict, 'Length'));
    const found = this.raw.indexOf('endstream', from);
    // The declared length is authoritative; `endstream` is the fallback for a
    // file whose length is wrong, and binary payloads do contain that word.
    const to = declared && from + declared <= this.raw.length ? from + declared : (found < 0 ? this.raw.length : found);
    const body = this.bytes.subarray(from, to);
    const filter = dictValue(dict, 'Filter');
    if (!filter) return body;
    if (!/FlateDecode/.test(filter)) return null;
    let data;
    try {
      data = await inflate(body, 'deflate');
    } catch (error) {
      try { data = await inflate(body, 'deflate-raw'); } catch (retry) { return null; }
    }
    const parms = this.resolveDictionary(dictValue(dict, 'DecodeParms'));
    if (parms && Number(dictValue(parms, 'Predictor')) >= 10) {
      return unpredict(data, Number(dictValue(parms, 'Columns')) || 1);
    }
    return data;
  }

  /**
   * Registers the objects packed inside every compressed object stream.
   *
   * Not an optimisation to skip: from PDF 1.5 on, an exporter puts page and font
   * dictionaries in here rather than in the file body, so without this step a
   * document has no pages and no fonts.
   */
  async expandObjectStreams() {
    for (const number of [...this.objects.keys()]) {
      const dict = this.dictionary(number);
      if (!/\/Type\s*\/ObjStm/.test(dict)) continue;
      const data = await this.stream(number);
      if (!data) continue;
      const text = latin1(data);
      const count = this.resolveNumber(dictValue(dict, 'N'));
      const first = this.resolveNumber(dictValue(dict, 'First'));
      if (!count || !first) continue;
      const header = text.slice(0, first).trim().split(/\s+/).map(Number);
      for (let index = 0; index < count; index += 1) {
        const objectNumber = header[index * 2];
        const offset = header[index * 2 + 1];
        if (!Number.isFinite(objectNumber) || !Number.isFinite(offset)) continue;
        const end = index + 1 < count ? first + header[(index + 1) * 2 + 1] : text.length;
        this.embedded.set(objectNumber, text.slice(first + offset, end));
      }
    }
  }

  /** Every page object number, in reading order. */
  pageNumbers() {
    const root = referenceNumber(dictValue(readDictionary(this.raw, this.raw.lastIndexOf('trailer'), this.raw.length), 'Root'))
      || this.findByType('Catalog');
    const pages = root ? referenceNumber(dictValue(this.dictionary(root), 'Pages')) : 0;
    const ordered = [];
    const walk = (number, seen) => {
      if (!number || seen.has(number) || ordered.length > 400) return;
      seen.add(number);
      const dict = this.dictionary(number);
      if (/\/Type\s*\/Page(?![sA-Za-z])/.test(dict)) { ordered.push(number); return; }
      const kids = dictValue(dict, 'Kids');
      const pattern = /(\d+)\s+\d+\s+R/g;
      let match;
      while ((match = pattern.exec(kids))) walk(Number(match[1]), seen);
    };
    walk(pages, new Set());
    if (ordered.length) return ordered;
    // No usable page tree: take every page object in the order it was written.
    const all = [];
    for (const number of [...this.objects.keys(), ...this.embedded.keys()]) {
      if (/\/Type\s*\/Page(?![sA-Za-z])/.test(this.dictionary(number))) all.push(number);
    }
    return all.sort((left, right) => left - right);
  }

  findByType(type) {
    for (const number of [...this.objects.keys(), ...this.embedded.keys()]) {
      if (new RegExp(`/Type\\s*/${type}(?![A-Za-z])`).test(this.dictionary(number))) return number;
    }
    return 0;
  }

  /** A page's resources, inherited from its parent when it declares none. */
  pageResources(number) {
    let at = number;
    for (let hops = 0; hops < 8 && at; hops += 1) {
      const dict = this.dictionary(at);
      const resources = this.resolveDictionary(dictValue(dict, 'Resources'));
      if (resources) return resources;
      at = referenceNumber(dictValue(dict, 'Parent'));
    }
    return '';
  }

  /** `{name: fontInfo}` for one page's resource dictionary. */
  async pageFonts(resources) {
    const fonts = this.resolveDictionary(dictValue(resources, 'Font'));
    const map = {};
    const pattern = /\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g;
    let match;
    while ((match = pattern.exec(fonts))) {
      map[match[1]] = await this.font(Number(match[2]));
    }
    return map;
  }

  /** How one font encodes text: how many bytes to a code, and what they mean. */
  async font(number) {
    if (this.fonts.has(number)) return this.fonts.get(number);
    const dict = this.dictionary(number);
    const subtype = dictValue(dict, 'Subtype');
    const encoding = dictValue(dict, 'Encoding');
    const info = { width: /Identity-[HV]/.test(encoding) || /Type0/.test(subtype) ? 2 : 1, cmap: null };
    const toUnicode = referenceNumber(dictValue(dict, 'ToUnicode'));
    if (toUnicode) {
      const data = await this.stream(toUnicode);
      if (data) {
        const parsed = parseCMap(latin1(data));
        if (parsed.map.size) info.cmap = parsed.map;
        if (parsed.width) info.width = parsed.width;
      }
    }
    this.fonts.set(number, info);
    return info;
  }

  /** One page's content streams, concatenated. */
  async pageContent(number) {
    const contents = dictValue(this.dictionary(number), 'Contents');
    const parts = [];
    const pattern = /(\d+)\s+\d+\s+R/g;
    let match;
    while ((match = pattern.exec(contents))) {
      const data = await this.stream(Number(match[1]));
      if (data) parts.push(latin1(data));
    }
    return parts.join('\n');
  }
}

/* ------------------------------------------------------------------ *
 * The /ToUnicode CMap
 * ------------------------------------------------------------------ */

function hexToString(hex) {
  const clean = String(hex || '').replace(/[^0-9A-Fa-f]/g, '');
  let out = '';
  // UTF-16BE: a destination can be a surrogate pair or a ligature expansion.
  for (let at = 0; at + 3 < clean.length + 1; at += 4) {
    const unit = parseInt(clean.slice(at, at + 4), 16);
    if (Number.isFinite(unit)) out += String.fromCharCode(unit);
  }
  return out;
}

/**
 * The code-to-character table a PDF carries so its text can be read back.
 *
 * `bfchar` maps one code, `bfrange` maps a run — either onto a run of characters
 * or onto a listed one per code. The codespace range is also where the number of
 * bytes in a code is stated, which matters more than it looks: read a two-byte
 * font one byte at a time and every character is wrong.
 */
export function parseCMap(text) {
  const map = new Map();
  let width = 0;
  const space = /begincodespacerange([\s\S]*?)endcodespacerange/g;
  let match;
  while ((match = space.exec(text))) {
    const first = /<([0-9A-Fa-f]+)>/.exec(match[1]);
    if (first) width = Math.max(width, Math.ceil(first[1].length / 2));
  }
  const chars = /beginbfchar([\s\S]*?)endbfchar/g;
  while ((match = chars.exec(text))) {
    const pair = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g;
    let entry;
    while ((entry = pair.exec(match[1]))) {
      map.set(parseInt(entry[1], 16), hexToString(entry[2]));
    }
  }
  const ranges = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((match = ranges.exec(text))) {
    const body = match[1];
    const listed = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g;
    let entry;
    const consumed = [];
    while ((entry = listed.exec(body))) {
      consumed.push([entry.index, entry.index + entry[0].length]);
      const from = parseInt(entry[1], 16);
      const items = entry[3].match(/<([0-9A-Fa-f]*)>/g) || [];
      items.forEach((item, offset) => map.set(from + offset, hexToString(item)));
    }
    const spanned = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g;
    while ((entry = spanned.exec(body))) {
      if (consumed.some(([start, end]) => entry.index >= start && entry.index < end)) continue;
      const from = parseInt(entry[1], 16);
      const to = parseInt(entry[2], 16);
      const target = hexToString(entry[3]);
      if (!target || to < from || to - from > 65_535) continue;
      const head = target.slice(0, -1);
      const last = target.charCodeAt(target.length - 1);
      for (let code = from; code <= to; code += 1) {
        map.set(code, head + String.fromCharCode(last + (code - from)));
      }
    }
  }
  return { map, width };
}

/* ------------------------------------------------------------------ *
 * The content stream
 * ------------------------------------------------------------------ */

const ESCAPES = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };

/** One shown string, through whichever font was selected when it was shown. */
function decodeShown(value, font) {
  if (!font || !font.cmap) return decodeWinAnsi(value);
  const width = font.width === 2 ? 2 : 1;
  let out = '';
  for (let at = 0; at + width <= value.length; at += width) {
    let code = 0;
    for (let byte = 0; byte < width; byte += 1) code = (code << 8) | (value.charCodeAt(at + byte) & 0xff);
    const mapped = font.cmap.get(code);
    // A code the table does not cover is dropped rather than guessed at: for a
    // subset font a byte value means nothing on its own.
    out += mapped === undefined ? (width === 1 ? decodeWinAnsi(value[at]) : '') : mapped;
  }
  return out;
}

/**
 * The text of one content stream.
 *
 * `fonts` maps a resource name (`F1`) to what that font's bytes mean. Without it
 * every string is read as WinAnsi, which is right for a simple font and wrong
 * for a subset one — so the caller that has the page's resources should always
 * pass them.
 *
 * Two things have to be reconstructed because a PDF does not store them.
 *
 * **Spaces.** Inside a `TJ` array a big negative adjustment is how a typesetter
 * writes a word gap; without that rule extracted prose arrives with none at all.
 *
 * **Lines.** Every placement moves the pen, and Word places each *run* of a
 * sentence separately — one for the bold part, one for the link, one for the
 * superscript — so treating a move as a new line returns a document one or two
 * words per line, which is what the brief reader used to produce. The pen's
 * vertical position is therefore tracked: a move that changes it is a line, a
 * move along the same line is a space, and nothing else breaks anything.
 */
export function pdfStreamText(content, options = {}) {
  const fonts = options.fonts || null;
  const source = String(content || '');
  let out = '';
  let pending = [];
  let font = null;
  let inArray = false;
  let at = 0;
  /* The pen, and where the last shown text was: the two together are what say
   * whether a placement is a new line or a gap on the same one. */
  let pen = null;
  let shown = null;
  let leading = 12;
  let size = 12;
  let moved = false;
  let operands = [];
  const number = (back) => {
    const value = operands[operands.length - back];
    return Number.isFinite(value) ? value : 0;
  };
  const flush = () => {
    if (!pending.length) return;
    let text = '';
    for (const piece of pending) text += piece.space ? ' ' : decodeShown(piece.bytes, font);
    pending = [];
    if (text) {
      if (pen && shown && Math.abs(pen.y - shown.y) > 1.5) out += '\n';
      else if (moved && separated() && out && !/\s$/.test(out) && !/^\s/.test(text)) out += ' ';
      out += text;
    }
    moved = false;
    // Where the pen ended up, estimated: half an em per character is close
    // enough for the only question being asked of it.
    if (pen) shown = { x: pen.x, y: pen.y, advance: text.length * size * 0.5 };
  };
  /**
   * Whether the gap the pen just jumped is a word gap or nothing at all.
   *
   * Word breaks a run at every hyphen so the line can wrap there, so "multi-
   * language" arrives as three placements at touching positions. Treating each
   * placement as a space turns every hyphenated word into "multi - language".
   * A real gap is wider than the rounding error on an estimated advance.
   */
  const separated = () => {
    if (!pen || !shown || shown.advance === undefined) return true;
    return pen.x - (shown.x + shown.advance) > size * 0.28;
  };
  while (at < source.length) {
    const char = source[at];
    if (char === '(') {
      let depth = 1;
      let scan = at + 1;
      let buffer = '';
      while (scan < source.length && depth > 0) {
        const current = source[scan];
        if (current === '\\') {
          const next = source[scan + 1];
          if (next >= '0' && next <= '7') {
            let octal = '';
            let digit = scan + 1;
            while (digit < source.length && octal.length < 3 && source[digit] >= '0' && source[digit] <= '7') { octal += source[digit]; digit += 1; }
            buffer += String.fromCharCode(parseInt(octal, 8));
            scan = digit;
            continue;
          }
          if (next === '\n' || next === '\r') { scan += 2; continue; }
          buffer += ESCAPES[next] === undefined ? (next || '') : ESCAPES[next];
          scan += 2;
          continue;
        }
        if (current === '(') { depth += 1; buffer += current; scan += 1; continue; }
        if (current === ')') { depth -= 1; if (depth) buffer += current; scan += 1; continue; }
        buffer += current;
        scan += 1;
      }
      pending.push({ bytes: buffer });
      at = scan;
      continue;
    }
    if (char === '<' && source[at + 1] !== '<') {
      const close = source.indexOf('>', at);
      if (close < 0) break;
      const hex = source.slice(at + 1, close).replace(/[^0-9A-Fa-f]/g, '');
      let buffer = '';
      for (let pair = 0; pair + 1 < hex.length; pair += 2) buffer += String.fromCharCode(parseInt(hex.slice(pair, pair + 2), 16));
      pending.push({ bytes: buffer });
      at = close + 1;
      continue;
    }
    if (char === '[') { inArray = true; at += 1; continue; }
    if (char === ']') { inArray = false; at += 1; continue; }
    if (char === '/') {
      const name = /^\/([^\s/<>[\]()]*)/.exec(source.slice(at, at + 96));
      // A name is only interesting as the operand of `Tf`, which follows it.
      const operator = /^\s*([\d.]+)\s*Tf/.exec(source.slice(at + (name ? name[0].length : 1), at + 160));
      if (name && operator) {
        if (fonts) font = fonts[name[1]] || null;
        // The size is what makes an advance estimate mean anything.
        size = Number(operator[1]) || size;
      }
      at += name ? name[0].length : 1;
      continue;
    }
    if (char === '-' || char === '.' || (char >= '0' && char <= '9')) {
      const token = /^[-+]?\d*\.?\d+/.exec(source.slice(at, at + 32));
      if (token) {
        if (inArray) {
          if (Number(token[0]) <= -140) pending.push({ space: true });
        } else {
          operands.push(Number(token[0]));
          if (operands.length > 8) operands.shift();
        }
        at += token[0].length;
        continue;
      }
    }
    if (/[A-Za-z'"*]/.test(char)) {
      let scan = at;
      let operator = '';
      while (scan < source.length && /[A-Za-z0-9*'"]/.test(source[scan])) { operator += source[scan]; scan += 1; }
      if (operator === 'Tj' || operator === 'TJ') flush();
      else if (operator === "'" || operator === '"') {
        if (pen) pen.y -= leading;
        moved = true;
        flush();
      } else if (operator === 'Td' || operator === 'TD') {
        pen = pen ? { x: pen.x + number(2), y: pen.y + number(1) } : { x: number(2), y: number(1) };
        if (operator === 'TD') leading = -number(1) || leading;
        moved = true;
      } else if (operator === 'Tm') {
        // The last two of the six numbers are the translation: the pen, absolutely.
        pen = { x: number(2), y: number(1) };
        moved = true;
      } else if (operator === 'T*') {
        if (pen) pen.y -= leading;
        moved = true;
      } else if (operator === 'TL') {
        leading = number(1) || leading;
      } else if (operator === 'BT') {
        // The text matrix resets, so the pen does. Where the last text *landed*
        // deliberately does not: Word wraps every run of a sentence in its own
        // BT/ET pair, and forgetting the previous line at each one is what turned
        // a paragraph into one word per line.
        pen = null;
      } else if (operator === 'ET') {
        flush();
      } else pending = [];
      if (operator !== 'Tj' && operator !== 'TJ') operands = [];
      at = scan > at ? scan : at + 1;
      continue;
    }
    at += 1;
  }
  flush();
  return out;
}

/* ------------------------------------------------------------------ *
 * The one entry point
 * ------------------------------------------------------------------ */

/** True when what came out is words rather than glyph numbers. */
export function looksLikeText(value, { minimum = 40 } = {}) {
  const text = String(value || '').replace(/\s+/g, '');
  if (text.length < minimum) return false;
  const letters = (text.match(/[A-Za-zÀ-ɏ]/g) || []).length;
  return letters / text.length >= 0.55;
}

/**
 * Every readable page of a PDF, in order.
 *
 * Falls back twice, because a malformed file is more common than a
 * well-formed one: if the page tree yields nothing, every content-looking
 * stream is read without font information, which still recovers a document
 * written entirely in simple fonts.
 */
export async function extractPdfText(bytes) {
  const pdf = new PdfDocument(bytes);
  try {
    await pdf.expandObjectStreams();
  } catch (error) {
    // A damaged object stream costs its own objects, not the whole read.
  }
  const pages = [];
  for (const number of pdf.pageNumbers()) {
    let content = '';
    try {
      content = await pdf.pageContent(number);
    } catch (error) {
      continue;
    }
    if (!content) continue;
    let fonts = null;
    try {
      fonts = await pdf.pageFonts(pdf.pageResources(number));
    } catch (error) {
      fonts = null;
    }
    pages.push(pdfStreamText(content, { fonts }));
  }
  const joined = pages.join('\n\n');
  if (looksLikeText(joined)) return joined;
  const loose = await readEveryStream(pdf);
  return looksLikeText(loose) && loose.length > joined.length ? loose : joined;
}

/** Last resort: every stream that could hold drawing instructions. */
async function readEveryStream(pdf) {
  const parts = [];
  for (const number of pdf.objects.keys()) {
    const dict = pdf.dictionary(number);
    if (/\/(Image|DCTDecode|JPXDecode|CCITTFaxDecode|JBIG2Decode|FontFile\d?|ObjStm|XRef|Metadata)\b/.test(dict)) continue;
    let data = null;
    try {
      data = await pdf.stream(number);
    } catch (error) {
      continue;
    }
    if (data) parts.push(pdfStreamText(latin1(data)));
  }
  return parts.join('\n');
}
