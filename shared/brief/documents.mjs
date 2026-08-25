/**
 * Reading a brief out of a file.
 *
 * A brief almost never arrives as a paragraph somebody is willing to retype. It
 * arrives as a PDF the client exported, a Word document with the discovery notes
 * in it, or a text file pasted out of an email. So the builder reads those
 * directly, and the brain gets the same input it would have got by hand.
 *
 * Everything here runs in the browser with no dependency and no upload: a `.docx`
 * is a ZIP of XML and a PDF's text lives in deflated content streams, and the
 * platform already ships the one primitive both need — `DecompressionStream`.
 * The client's own document therefore never leaves the machine, which for a brief
 * under NDA is the difference between usable and not.
 *
 * What it cannot do is stated rather than hidden. A scanned PDF is a picture of
 * text with no text in it, and a `.doc` from 1997 is a binary format that is not
 * worth carrying: both come back as a named refusal with the reason.
 */

import { inflate, u16, u32, utf8 } from './bytes.mjs';
import { extractPdfText, looksLikeText } from './pdf.mjs';
import { BRIEF_TEXT_LIMIT } from './schemas.mjs';

export { looksLikeText };

/* The extensions that are just text once decoded. `.rtf` is here because its
 * markup is stripped rather than parsed. */
const PLAIN_EXTENSIONS = ['txt', 'text', 'md', 'markdown', 'mdown', 'csv', 'tsv', 'json', 'log', 'vtt', 'srt', 'html', 'htm', 'xml'];

export const BRIEF_DOCUMENT_ACCEPT = ['.pdf', '.docx', '.rtf', ...PLAIN_EXTENSIONS.map((ext) => `.${ext}`)].join(',');

export { BRIEF_TEXT_LIMIT };

/** The shortest extraction worth calling a brief rather than a failure. */
const MIN_USEFUL = 40;

export function fileExtension(name) {
  const match = /\.([A-Za-z0-9]+)$/.exec(String(name || '').trim());
  return match ? match[1].toLowerCase() : '';
}

/**
 * Which reader a file needs, from its name and its declared type.
 *
 * The name is trusted over the type: a browser reports `application/octet-stream`
 * for a `.docx` often enough that refusing on the type alone would refuse real
 * documents.
 */
export function briefDocumentKind(name, type = '') {
  const extension = fileExtension(name);
  const mime = String(type || '').toLowerCase();
  if (extension === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (extension === 'docx' || mime.includes('wordprocessingml')) return 'docx';
  if (extension === 'rtf' || mime === 'application/rtf' || mime === 'text/rtf') return 'rtf';
  if (PLAIN_EXTENSIONS.includes(extension)) return 'plain';
  if (extension === 'doc' || mime === 'application/msword') return 'legacy-doc';
  if (extension === 'pages' || extension === 'odt') return 'other-office';
  if (mime.startsWith('text/')) return 'plain';
  return '';
}

export function isBriefDocument(name, type = '') {
  const kind = briefDocumentKind(name, type);
  return Boolean(kind) && kind !== 'legacy-doc' && kind !== 'other-office';
}

/* ------------------------------------------------------------------ *
 * ZIP, for .docx
 * ------------------------------------------------------------------ */

/**
 * The central directory of a ZIP.
 *
 * Read from the end-of-central-directory record rather than by scanning for
 * local headers, because a streamed entry's local header carries no size — the
 * directory is the only place the compressed length is always right.
 */
export function zipEntries(bytes) {
  const floor = Math.max(0, bytes.length - 66_000);
  let eocd = -1;
  for (let at = bytes.length - 22; at >= floor; at -= 1) {
    if (u32(bytes, at) === 0x06054b50) { eocd = at; break; }
  }
  if (eocd < 0) throw new Error('that file is not a readable .docx');
  const count = u16(bytes, eocd + 10);
  let at = u32(bytes, eocd + 16);
  const entries = [];
  for (let n = 0; n < count && at + 46 <= bytes.length; n += 1) {
    if (u32(bytes, at) !== 0x02014b50) break;
    const nameLength = u16(bytes, at + 28);
    entries.push({
      name: utf8(bytes.subarray(at + 46, at + 46 + nameLength)),
      method: u16(bytes, at + 10),
      compressed: u32(bytes, at + 20),
      offset: u32(bytes, at + 42),
    });
    at += 46 + nameLength + u16(bytes, at + 30) + u16(bytes, at + 32);
  }
  return entries;
}

export async function zipRead(bytes, entry) {
  if (!entry || u32(bytes, entry.offset) !== 0x04034b50) throw new Error('that .docx is damaged');
  const start = entry.offset + 30 + u16(bytes, entry.offset + 26) + u16(bytes, entry.offset + 28);
  const data = bytes.subarray(start, start + entry.compressed);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflate(data, 'deflate-raw');
  throw new Error('that .docx uses a compression this reader does not support');
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(value) {
  return String(value).replace(/&(#x?[0-9A-Fa-f]+|[a-z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[body] === undefined ? whole : ENTITIES[body];
  });
}

/** The words out of a WordprocessingML body, with its paragraphs kept. */
export function docxXmlToText(xml) {
  return decodeEntities(String(xml || '')
    .replace(/<w:tab\b[^>]*\/?>/g, '\t')
    .replace(/<w:br\b[^>]*\/?>/g, '\n')
    .replace(/<\/w:(p|tr)>/g, '\n')
    .replace(/<\/w:tc>/g, ' ')
    .replace(/<[^>]*>/g, ''));
}

async function readDocx(bytes) {
  const entries = zipEntries(bytes);
  // The body, then anything Word split into a second part. Headers and footers
  // are left out: they are page furniture, not the brief.
  const wanted = entries.filter((entry) => /^word\/(document\d*\.xml|footnotes\.xml|endnotes\.xml)$/.test(entry.name));
  if (!wanted.length) throw new Error('that .docx has no document body in it');
  const parts = [];
  for (const entry of wanted) parts.push(docxXmlToText(utf8(await zipRead(bytes, entry))));
  return parts.join('\n\n');
}

/* ------------------------------------------------------------------ *
 * PDF
 *
 * A PDF stores drawing instructions, not text, and what a byte in one means
 * depends on the font in force — which for a Word or Chrome export is two
 * different things in the same document. `pdf.mjs` does that work.
 * ------------------------------------------------------------------ */

async function readPdf(bytes) {
  const text = await extractPdfText(bytes);
  if (!looksLikeText(text)) {
    throw new Error('no text could be read out of that PDF - it is probably a scan, or its fonts carry no text mapping. Copy the text out and paste it instead');
  }
  return text;
}

/* ------------------------------------------------------------------ *
 * RTF and plain text
 * ------------------------------------------------------------------ */

export function rtfToText(value) {
  return String(value || '')
    .replace(/\\'([0-9a-fA-F]{2})/g, (whole, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\u(-?\d+)\s?\??/g, (whole, code) => String.fromCodePoint(((Number(code) % 65_536) + 65_536) % 65_536))
    // The groups that hold a font table or a colour table hold no prose.
    .replace(/\{\\\*?\\?(?:fonttbl|colortbl|stylesheet|listtable|info|generator)(?:[^{}]|\{[^{}]*\})*\}/g, '')
    .replace(/\\(?:par|line|sect)\b\s?/g, '\n')
    .replace(/\\(?:tab)\b\s?/g, '\t')
    .replace(/\\[a-zA-Z]+-?\d*\s?/g, '')
    .replace(/[{}]/g, '');
}

function htmlToText(value) {
  return decodeEntities(String(value || '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<br\b[^>]*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ''));
}

/* ------------------------------------------------------------------ *
 * The one entry point
 * ------------------------------------------------------------------ */

/** Collapses whatever came out of a document into brief prose. */
export function normalizeBriefText(raw) {
  return String(raw || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[\u00ad\u200b-\u200d\ufeff]/g, '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[ \t\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Keeps the brief inside the textarea's own limit, cutting on a word. */
export function fitBriefText(value, limit = BRIEF_TEXT_LIMIT) {
  const text = String(value || '');
  if (!limit || text.length <= limit) return { text, truncated: false };
  const cut = text.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return { text: (space > limit * 0.6 ? cut.slice(0, space) : cut).trim(), truncated: true };
}

/**
 * The text of one file, or a reason it has none.
 *
 * Never throws: a drop of four files where one is a scan has to place the other
 * three and say what happened to the fourth.
 */
export async function readBriefDocument(file) {
  const name = String(file?.name || 'document');
  const kind = briefDocumentKind(name, file?.type);
  const result = { name, kind, text: '', reason: '' };
  if (kind === 'legacy-doc') return { ...result, reason: 'a .doc from an old Word version - save it as .docx or PDF first' };
  if (kind === 'other-office') return { ...result, reason: 'not a format this reader opens - export it as PDF or .docx' };
  if (!kind) return { ...result, reason: 'not a document the brief reader can open' };
  let bytes;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (error) {
    return { ...result, reason: 'the file could not be read off the disk' };
  }
  if (!bytes.length) return { ...result, reason: 'the file is empty' };
  try {
    let text = '';
    if (kind === 'pdf') text = await readPdf(bytes);
    else if (kind === 'docx') text = await readDocx(bytes);
    else if (kind === 'rtf') text = rtfToText(utf8(bytes));
    else {
      const plain = utf8(bytes);
      text = /\.(html?|xml)$/i.test(name) ? htmlToText(plain) : plain;
    }
    const normalized = normalizeBriefText(text);
    if (normalized.length < MIN_USEFUL) return { ...result, reason: 'there was almost no text in it' };
    return { ...result, text: normalized };
  } catch (error) {
    return { ...result, reason: String(error?.message || 'it could not be read') };
  }
}

/**
 * Every dropped file, read and joined into one brief.
 *
 * Each file keeps its name as a heading, because a brief assembled from a
 * discovery deck and a tone-of-voice note reads as nonsense once the two run
 * together with no seam.
 */
export async function readBriefDocuments(files, { existing = '', limit = BRIEF_TEXT_LIMIT } = {}) {
  const list = Array.from(files || []);
  const read = [];
  const skipped = [];
  for (const file of list) {
    const outcome = await readBriefDocument(file);
    if (outcome.text) read.push(outcome);
    else skipped.push({ name: outcome.name, reason: outcome.reason });
  }
  const blocks = read.map((entry) => (read.length > 1 || existing ? `${entry.name}\n${entry.text}` : entry.text));
  const joined = [normalizeBriefText(existing), ...blocks].filter(Boolean).join('\n\n');
  const fitted = fitBriefText(joined, limit);
  return { text: fitted.text, truncated: fitted.truncated, read, skipped, characters: fitted.text.length };
}
