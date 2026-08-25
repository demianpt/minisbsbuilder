import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The wash between a band's words and its photograph.
 *
 * A pattern that paints a photograph behind its copy is legible only because of
 * the wash over it, and a wash is either strong enough for the ink in it or the
 * page is a coin toss on the crop. Two failures were measured against rendered
 * pixels before this existed: `sbs-cta-p15-v3` faded its wash to nothing at
 * exactly the height of the heading and put white type on a bright warehouse
 * photograph at 1.1:1, and `sbs-hero-p89-v2` washed 27% white over a picture and
 * kept its white copy at 1.17:1.
 *
 * The floors are derived, not chosen. An overlay of colour C at alpha a over a
 * photograph pixel P paints a*C + (1-a)*P, and a photograph can hold any pixel:
 *
 *   Light copy (#f7f5ef, luminance .93) needs a ground no lighter than luminance
 *   .168 for 4.5:1 — channel 113. Worst case is a white pixel, so a near-black
 *   wash (channel 33) needs 33a + 255(1-a) <= 113: a >= .64.
 *
 *   Dark copy (luminance about .014) needs a ground no darker than luminance .24
 *   — channel 135. Worst case is black, so a white wash needs 255a >= 135:
 *   a >= .53, taken to .58 for the lighter grey the subtitles use.
 *
 * A band that paints *no* wash is deliberately not checked here. That case
 * belongs to the runtime, which gives any unwashed photograph the brand's dark
 * at 60% and inverts the copy to suit; filling it in the data would take the
 * decision away from it.
 */

const DATA = JSON.parse(readFileSync(new URL('../../src/data/dst-data.json', import.meta.url), 'utf8'));

const FLOOR_FOR_LIGHT_COPY = 0.64;
const FLOOR_FOR_DARK_COPY = 0.58;
const MEDIA_GROUNDS = new Set(['ds-blocks/dst-banner', 'ds-blocks/dst-wrapper', 'ds-blocks/ds-columns']);

function readColor(text) {
  const value = String(text || '').trim();
  let match = /^#([0-9a-f]{3,8})$/i.exec(value);
  if (match) {
    let hex = match[1];
    if (hex.length === 3 || hex.length === 4) hex = hex.split('').map((c) => c + c).join('');
    return {
      rgb: [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)),
      alpha: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    };
  }
  match = /^rgba?\(([^)]+)\)$/i.exec(value);
  if (match) {
    const parts = match[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    if (parts.length >= 3) return { rgb: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 };
  }
  if (/^transparent$/i.test(value)) return { rgb: [0, 0, 0], alpha: 0 };
  if (/secondary-color1|secondary-color7/.test(value)) return { rgb: [255, 255, 255], alpha: 1 };
  if (/primary-color1|primary-color3|body-bg-alt/.test(value)) return { rgb: [20, 20, 22], alpha: 1 };
  return null;
}

const luminance = ([r, g, b]) => [r, g, b]
  .map((channel) => { const v = channel / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
  .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);

/** Every ground in the catalogue that paints a photograph and a wash over it. */
function washedGrounds() {
  const found = [];
  for (const pattern of DATA.patterns) {
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(walk); return }
      const attrs = node.attributes || {};
      const paintsPhoto = Object.prototype.hasOwnProperty.call(attrs, 'backgroundImage');
      const wash = typeof attrs.backgroundOverlay === 'string' ? attrs.backgroundOverlay.trim() : '';
      if (MEDIA_GROUNDS.has(node.component) && paintsPhoto && wash) {
        found.push({ pattern: pattern.id, component: node.component, wash, opacity: attrs.backgroundOverlayOpacity });
      }
      (node.children || []).forEach(walk);
    };
    walk(pattern.node || pattern.tree);
  }
  return found;
}

/** The wash's thinnest point, which is the point that has to hold the copy. */
function weakestPoint(wash, opacity) {
  const fold = Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1;
  const stops = String(wash).match(/#[0-9a-f]{3,8}|rgba?\([^)]*\)|var\(--[a-z0-9-]+\)|transparent|white|black/gi) || [];
  const parsed = stops.map(readColor).filter(Boolean);
  if (!parsed.length) return null;
  return parsed.reduce((weakest, stop) => {
    const alpha = stop.alpha * fold;
    return !weakest || alpha < weakest.alpha ? { alpha, rgb: stop.rgb } : weakest;
  }, null);
}

describe('the wash between a band\'s words and its photograph', () => {
  const grounds = washedGrounds();

  it('finds the media grounds it is meant to be checking', () => {
    expect(grounds.length).toBeGreaterThanOrEqual(20);
  });

  for (const ground of grounds) {
    it(`${ground.pattern} washes its photograph strongly enough for its own copy`, () => {
      const weakest = weakestPoint(ground.wash, ground.opacity);
      expect(weakest, `unreadable wash: ${ground.wash}`).toBeTruthy();
      // A dark wash is a decision to put light copy in it, and the reverse.
      const carriesLightCopy = luminance(weakest.rgb) < 0.22;
      const floor = carriesLightCopy ? FLOOR_FOR_LIGHT_COPY : FLOOR_FOR_DARK_COPY;
      expect(
        weakest.alpha,
        `${ground.pattern} (${ground.component}) is ${Math.round(weakest.alpha * 100)}% at its thinnest, `
        + `which hands ${carriesLightCopy ? 'light' : 'dark'} copy to the photograph: ${ground.wash}`,
      ).toBeGreaterThanOrEqual(floor - 0.001);
    });
  }
});
