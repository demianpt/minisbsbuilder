/**
 * The style catalogue.
 *
 * Reads the built library — `src/data/style-library.json`, produced by
 * `npm run styles:build` from the seeds — and answers the questions the editor and
 * the AI both need: which families exist, which styles are in one, and what a
 * `family/style` key resolves to.
 *
 * The library is data. Nothing here derives a style, because a style the runtime
 * invented would not be in the catalogue a strategist chose from.
 */

import { STYLE_FAMILIES, parseStyleKey, styleKey } from './schema.mjs';

let library = { styles: [], families: [] };
const byKey = new Map();

/**
 * Installs the built library. The browser imports the JSON through Vite and the
 * server and scripts read it from disk, so neither path is assumed here.
 */
export function loadStyleLibrary(source) {
  library = source && typeof source === 'object' ? source : { styles: [], families: [] };
  byKey.clear();
  for (const profile of library.styles || []) byKey.set(styleKey(profile), profile);
  return library;
}

export function styleLibrary() {
  return library;
}

export function allStyles() {
  return library.styles || [];
}

/** Only production styles reach the strategist's picker (§47). */
export function productionStyles() {
  return allStyles().filter((profile) => profile.status === 'production');
}

export function styleFamilies() {
  const styles = productionStyles();
  return STYLE_FAMILIES.map((family) => ({
    ...family,
    styles: styles.filter((profile) => profile.familyId === family.id),
  })).filter((family) => family.styles.length > 0);
}

export function stylesInFamily(familyId) {
  return productionStyles().filter((profile) => profile.familyId === familyId);
}

/** Resolves `family/style`, or a bare style id when it is unambiguous. */
export function styleByKey(value) {
  const key = String(value ?? '').trim().toLowerCase();
  if (!key) return null;
  if (byKey.has(key)) return byKey.get(key);
  const parsed = parseStyleKey(key);
  if (parsed) return byKey.get(`${parsed.familyId}/${parsed.id}`) || null;
  const matches = allStyles().filter((profile) => profile.id === key);
  return matches.length === 1 ? matches[0] : null;
}

export function styleFromRef(ref) {
  if (!ref || typeof ref !== 'object') return null;
  if (ref.familyId && ref.styleId) return styleByKey(`${ref.familyId}/${ref.styleId}`);
  return ref.styleId ? styleByKey(ref.styleId) : null;
}

export function styleCounts() {
  const styles = productionStyles();
  return {
    families: new Set(styles.map((profile) => profile.familyId)).size,
    styles: styles.length,
    perFamily: Object.fromEntries(STYLE_FAMILIES.map((family) => [family.id, styles.filter((profile) => profile.familyId === family.id).length])),
  };
}

export { STYLE_FAMILIES, styleKey, parseStyleKey };
