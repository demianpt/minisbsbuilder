/**
 * The byte primitives the document readers share.
 *
 * A `.docx` is a ZIP and a PDF is a set of deflated streams, so both readers
 * need the same three things: read a little-endian integer, turn bytes into
 * characters without a decoder guessing at them, and inflate. The platform
 * supplies the last one — `DecompressionStream` — which is why neither reader
 * needs a dependency or a server.
 */

export function u16(bytes, at) {
  return bytes[at] | (bytes[at + 1] << 8);
}

export function u32(bytes, at) {
  return ((bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16)) + bytes[at + 3] * 0x1000000) >>> 0;
}

/**
 * Bytes as characters, one for one.
 *
 * The right reading for a PDF, whose syntax is bytes and whose strings are only
 * text once a font says what they mean. A UTF-8 decoder would silently mangle
 * both halves of that.
 */
export function latin1(bytes) {
  let out = '';
  for (let at = 0; at < bytes.length; at += 8_192) {
    out += String.fromCharCode.apply(null, bytes.subarray(at, Math.min(bytes.length, at + 8_192)));
  }
  return out;
}

export function utf8(bytes) {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export async function inflate(bytes, format) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('this browser cannot unpack compressed documents');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
