const encoder = new TextEncoder();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = (year - 1980) << 9 | (date.getMonth() + 1) << 5 | date.getDate();
  return { time, date: day };
}

function concat(parts) {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function u16(value) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Create a standards-compliant, uncompressed ZIP without runtime dependencies.
 * Store mode is deliberate: the bundle has only four files, is fast to build,
 * and works in every modern browser used by the internal content team.
 */
export function createZip(files) {
  const localParts = [];
  const centralParts = [];
  const now = dosDateTime();
  let localOffset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = typeof file.content === 'string' ? encoder.encode(file.content) : file.content;
    const crc = crc32(data);

    const localHeader = concat([
      u32(0x04034b50), // Local file header signature.
      u16(20),         // Version needed.
      u16(0x0800),     // UTF-8 filenames.
      u16(0),          // Store (no compression).
      u16(now.time),
      u16(now.date),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
    ]);
    localParts.push(localHeader, data);

    const centralHeader = concat([
      u32(0x02014b50), // Central directory signature.
      u16(20),         // Version made by.
      u16(20),         // Version needed.
      u16(0x0800),
      u16(0),
      u16(now.time),
      u16(now.date),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(localOffset),
      name,
    ]);
    centralParts.push(centralHeader);
    localOffset += localHeader.length + data.length;
  }

  const central = concat(centralParts);
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.length),
    u32(localOffset),
    u16(0),
  ]);
  return concat([...localParts, central, end]);
}

export async function createProjectBundle({ navigation, footer, page, websiteHtml }) {
  if (!navigation || !footer || !page || typeof websiteHtml !== 'string') {
    throw new TypeError('Navigation, footer, page, and website HTML are required.');
  }
  const bytes = createZip([
    { name: 'navigation.json', content: serializeJson(navigation) },
    { name: 'footer.json', content: serializeJson(footer) },
    { name: 'page.json', content: serializeJson(page) },
    { name: 'website.html', content: websiteHtml },
  ]);
  return new Blob([bytes], { type: 'application/zip' });
}

/**
 * The archival bundle: every concept's own four artifacts, in its own folder.
 *
 * WordPress imports one concept at a time, so this is not an import format. It
 * exists for handoff and for the record — the three proposals a client was shown,
 * each complete, in one file.
 */
export async function createConceptSetBundle({ concepts, manifest = null }) {
  const list = Array.isArray(concepts) ? concepts : [];
  if (!list.length) throw new TypeError('At least one concept is required.');
  const files = [];
  for (const concept of list) {
    const folder = String(concept?.slot || 'V1').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!concept?.navigation || !concept?.footer || !concept?.page || typeof concept?.websiteHtml !== 'string') {
      throw new TypeError(`Concept ${folder} is missing an artifact.`);
    }
    files.push(
      { name: `${folder}/navigation.json`, content: serializeJson(concept.navigation) },
      { name: `${folder}/footer.json`, content: serializeJson(concept.footer) },
      { name: `${folder}/page.json`, content: serializeJson(concept.page) },
      { name: `${folder}/website.html`, content: concept.websiteHtml },
    );
  }
  if (manifest) files.unshift({ name: 'concepts.json', content: serializeJson(manifest) });
  return new Blob([createZip(files)], { type: 'application/zip' });
}

export function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
