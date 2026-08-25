/**
 * Style distinctness.
 *
 * Fifty styles that reduce to fifty palettes are one style with a colour picker,
 * and §86 of the spec calls that a failed implementation. This measures the axes
 * a client would actually notice — typography, composition, density, surface,
 * radius, media, motion, buttons and pattern preference — and deliberately gives
 * palette a small weight, so two styles cannot pass by being different colours.
 *
 * The build fails on a near-clone rather than shipping it.
 */

import { DIAL_KEYS } from '../design/dials.mjs';

/** How much each axis contributes. Palette is last on purpose. */
export const DISTINCTNESS_WEIGHTS = Object.freeze({
  dials: 3,
  typography: 3,
  composition: 3,
  radius: 1.5,
  buttons: 1.5,
  patterns: 2,
  palette: 1,
});

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

/** Mean absolute difference across the nine dials, normalised to 0–1. */
function dialDistance(a, b) {
  const total = DIAL_KEYS.reduce((sum, key) => sum + Math.abs(Number(a.dials?.[key] ?? 50) - Number(b.dials?.[key] ?? 50)), 0);
  return clamp01(total / (DIAL_KEYS.length * 100) * 2.2);
}

function typographyDistance(a, b) {
  const left = a.typography || {};
  const right = b.typography || {};
  let score = 0;
  if (left.display !== right.display) score += 0.45;
  if (left.body !== right.body) score += 0.25;
  if (left.displayCase !== right.displayCase) score += 0.12;
  score += clamp01(Math.abs(Number(left.scale ?? 1) - Number(right.scale ?? 1)) / 0.5) * 0.18;
  return clamp01(score);
}

function compositionDistance(a, b) {
  const left = a.composition || {};
  const right = b.composition || {};
  let score = 0;
  for (const key of ['alignment', 'containerBias', 'mediaDominance', 'surfaceTreatment']) {
    if (left[key] !== right[key]) score += 0.19;
  }
  for (const key of ['asymmetry', 'fullBleedBias']) {
    score += clamp01(Math.abs(Number(left[key] ?? 50) - Number(right[key] ?? 50)) / 100) * 0.12;
  }
  return clamp01(score);
}

function termSet(preferences) {
  const source = preferences || {};
  const terms = new Set();
  for (const term of source.prefer || []) terms.add(`+${term}`);
  for (const term of source.avoid || []) terms.add(`-${term}`);
  for (const [family, entry] of Object.entries(source.byFamily || {})) {
    for (const term of entry.prefer || []) terms.add(`+${family}:${term}`);
    for (const term of entry.avoid || []) terms.add(`-${family}:${term}`);
  }
  return terms;
}

/** Jaccard distance over pattern-preference terms: do they reach for the same patterns? */
function patternDistance(a, b) {
  const left = termSet(a.patternPreferences);
  const right = termSet(b.patternPreferences);
  if (!left.size && !right.size) return 0;
  let shared = 0;
  for (const term of left) if (right.has(term)) shared += 1;
  const union = left.size + right.size - shared;
  return union ? clamp01(1 - shared / union) : 0;
}

function hexToRgb(hex) {
  const value = String(hex || '').replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  return [0, 2, 4].map((offset) => Number.parseInt(full.slice(offset, offset + 2), 16) || 0);
}

function paletteDistance(a, b) {
  const roles = ['bg', 'ink', 'accent', 'soft', 'dark'];
  const total = roles.reduce((sum, role) => {
    const left = hexToRgb(a.palette?.[role]);
    const right = hexToRgb(b.palette?.[role]);
    const delta = Math.sqrt(left.reduce((acc, channel, index) => acc + (channel - right[index]) ** 2, 0));
    return sum + delta / 441.67;
  }, 0);
  return clamp01(total / roles.length * 1.6);
}

/**
 * 0 = identical, 1 = maximally different. Two production styles must clear
 * `MINIMUM_DISTANCE`, and two styles in the same family must clear it too — a
 * family of five near-identical entries is four wasted slots.
 */
export function styleDistance(a, b) {
  const parts = {
    dials: dialDistance(a, b),
    typography: typographyDistance(a, b),
    composition: compositionDistance(a, b),
    radius: a.radius === b.radius ? 0 : 1,
    buttons: a.buttonStyle === b.buttonStyle ? 0 : 1,
    patterns: patternDistance(a, b),
    palette: paletteDistance(a, b),
  };
  const weightTotal = Object.values(DISTINCTNESS_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
  const score = Object.entries(parts).reduce((sum, [key, value]) => sum + value * DISTINCTNESS_WEIGHTS[key], 0) / weightTotal;
  return { score: Math.round(score * 1000) / 1000, parts };
}

export const MINIMUM_DISTANCE = 0.2;

/**
 * Every pair, with the closest pairs first. `failures` are the pairs a human has
 * to look at before the catalogue can be called production.
 */
export function distinctnessReport(profiles, { minimum = MINIMUM_DISTANCE } = {}) {
  const list = Array.isArray(profiles) ? profiles : [];
  const pairs = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const { score, parts } = styleDistance(list[i], list[j]);
      pairs.push({
        a: `${list[i].familyId}/${list[i].id}`,
        b: `${list[j].familyId}/${list[j].id}`,
        sameFamily: list[i].familyId === list[j].familyId,
        score,
        parts,
      });
    }
  }
  pairs.sort((left, right) => left.score - right.score);
  const failures = pairs.filter((pair) => pair.score < minimum);
  return {
    minimum,
    pairs: pairs.length,
    closest: pairs.slice(0, 10),
    failures,
    ok: failures.length === 0,
    // The axis a style differs *least* on across the whole set, which is where a
    // catalogue quietly collapses toward one look.
    weakestAxis: (() => {
      const axes = Object.keys(DISTINCTNESS_WEIGHTS);
      const means = axes.map((axis) => ({
        axis,
        mean: Math.round(pairs.reduce((sum, pair) => sum + pair.parts[axis], 0) / Math.max(1, pairs.length) * 1000) / 1000,
      }));
      means.sort((left, right) => left.mean - right.mean);
      return means;
    })(),
  };
}
