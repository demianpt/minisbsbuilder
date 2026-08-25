import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CONTRAST_BODY,
  contrastRatio,
  isDarkGround,
  paletteContrastReport,
  paletteDistance,
  paletteFromColours,
  paletteVariant,
  readableOn,
  repairPalette,
  shiftToContrast,
} from '../../shared/design/palette.mjs';

const catalog = JSON.parse(readFileSync(new URL('../../src/data/dst-data.json', import.meta.url), 'utf8'));

/**
 * The guarantee, stated as tests.
 *
 * Every one of these is a page somebody could otherwise have shown a client:
 * white type on white, a brand colour swapped for a "safer" one, a dark band
 * that was not dark. The module exists to make each of them impossible.
 */

describe('reading colours out of a sentence', () => {
  it('never makes a near-white the inverted band', () => {
    // The exact failure: "green and white" used to assign the second unqualified
    // colour to `dark`, so every inverted section became white type on white.
    const palette = paletteFromColours(['#1F6F43', '#FFFFFF']);
    expect(palette.bg).toBe('#FFFFFF');
    expect(palette.accent).toBe('#1F6F43');
    expect(palette.dark).toBeUndefined();
  });

  it('reads two colours as a brand and a band when one is plainly a band', () => {
    const palette = paletteFromColours(['#0A2540', '#C9A227']);
    expect(palette.dark).toBe('#0A2540');
    expect(palette.accent).toBe('#C9A227');
  });

  it('separates a dark brand colour from a dark neutral by how much colour it carries', () => {
    // Teal and charcoal are almost the same lightness; only chroma tells them
    // apart, and getting it backwards paints the page in charcoal.
    const palette = paletteFromColours(['#0E6E6E', '#2A2D31']);
    expect(palette.accent).toBe('#0E6E6E');
    expect(palette.dark).toBe('#2A2D31');
  });

  it('treats one named colour as the brand, whatever its lightness', () => {
    expect(paletteFromColours(['#0B1F3A']).accent).toBe('#0B1F3A');
    expect(paletteFromColours(['#0B1F3A']).dark).toBeUndefined();
  });

  it('honours a role stated in words over anything it could measure', () => {
    const palette = paletteFromColours([
      { hex: '#F7F2E7', role: 'bg' }, { hex: '#2A2D31', role: 'ink' }, '#C0522A',
    ]);
    expect(palette).toMatchObject({ bg: '#F7F2E7', ink: '#2A2D31', accent: '#C0522A' });
  });
});

describe('repairing a palette', () => {
  it('makes a light-on-light palette readable, and says what it moved', () => {
    const { palette, repairs } = repairPalette({
      bg: '#FFFFFF', ink: '#DDDDDD', accent: '#F2E9C4', soft: '#FFFFFF', dark: '#FAFAFA',
    });
    expect(paletteContrastReport(palette).ok).toBe(true);
    expect(repairs.map((entry) => entry.role)).toEqual(expect.arrayContaining(['ink', 'dark', 'accent']));
    for (const repair of repairs) expect(repair.why).toMatch(/\w/);
  });

  it('turns a light "dark" band into a real inverted ground', () => {
    const { palette } = repairPalette({ bg: '#F5F1E8', ink: '#1A1A18', accent: '#1F6F43', soft: '#E6DED0', dark: '#FFFFFF' });
    expect(isDarkGround(palette.dark)).toBe(true);
    expect(contrastRatio(readableOn(palette.dark), palette.dark)).toBeGreaterThanOrEqual(CONTRAST_BODY);
  });

  it('does not redesign a dark site to fix a problem it does not have', () => {
    // A near-black band on a near-black page is a quiet second ground, not a
    // failure. Flipping it to a light band would be a redesign.
    const { palette } = repairPalette({ bg: '#0C0B0C', ink: '#F5EFE8', accent: '#B69A70', soft: '#1C191B', dark: '#070607' });
    expect(isDarkGround(palette.bg)).toBe(true);
    expect(isDarkGround(palette.dark)).toBe(true);
  });

  it('keeps the hue of a brand colour it has to adjust', () => {
    const hue = (hex) => {
      const [r, g, b] = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
      const [max, min] = [Math.max(r, g, b), Math.min(r, g, b)];
      if (max === min) return 0;
      const d = max - min;
      const raw = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (raw / 6) * 360;
    };
    const { palette } = repairPalette({ bg: '#FFFFFF', ink: '#111111', accent: '#F2FF00', soft: '#F4F4F4', dark: '#111111' });
    expect(palette.accent).not.toBe('#F2FF00');
    // Same yellow, darker. A different hue would be a different brand.
    expect(Math.abs(hue(palette.accent) - hue('#F2FF00'))).toBeLessThan(4);
  });

  it('refuses to move a colour the brief pinned, and says it refused', () => {
    const pinned = { bg: '#0A0D16', ink: '#F5F7FF', accent: '#0B3D2E', soft: '#171C2D', dark: '#05070D' };
    const { palette, refused } = repairPalette(pinned, { pin: ['accent'] });
    expect(palette.accent).toBe('#0B3D2E');
    expect(refused.some((entry) => entry.role === 'accent')).toBe(true);
    // Everything it was allowed to touch is still repaired.
    expect(contrastRatio(palette.ink, palette.bg)).toBeGreaterThanOrEqual(CONTRAST_BODY);
  });

  it('reports honestly when a target is unreachable rather than returning the original', () => {
    // Mid-grey on mid-grey fails in both directions; the best available answer
    // beats handing back the unreadable one.
    const moved = shiftToContrast('#808080', '#808080', 21);
    expect(contrastRatio(moved, '#808080')).toBeGreaterThan(1);
  });

  it('leaves an already-legible palette completely alone', () => {
    const good = { bg: '#FFFFFF', ink: '#16181C', accent: '#1F6F43', soft: '#E6E2D8', dark: '#101418' };
    const { palette, repairs, ok } = repairPalette(good);
    expect(ok).toBe(true);
    expect(repairs).toEqual([]);
    expect(palette).toEqual(good);
  });

  it('makes every shipped archetype legible', () => {
    for (const [key, style] of Object.entries(catalog.archetypeStyles)) {
      const { palette } = repairPalette(style);
      const report = paletteContrastReport(palette);
      expect(report.failures.map((row) => `${key}:${row.id}`)).toEqual([]);
    }
  });
});

describe('three palettes that are three palettes', () => {
  it('varies the ground while keeping the brand colour', () => {
    const base = { bg: '#F5F1E8', ink: '#1A1A18', accent: '#1F6F43', soft: '#E6DED0', dark: '#1A1A18' };
    const variants = [0, 1, 2].map((index) => paletteVariant(base, index, { pin: ['accent'] }));
    expect(new Set(variants.map((palette) => palette.bg)).size).toBe(3);
    for (const palette of variants) {
      expect(palette.accent).toBe('#1F6F43');
      expect(paletteContrastReport(palette).ok).toBe(true);
    }
    // The third is the adventurous one: a genuinely different ground.
    expect(isDarkGround(variants[2].bg)).toBe(true);
    expect(paletteDistance(variants[0], variants[2])).toBeGreaterThan(0.2);
  });

  it('lifts the inverted ground rather than lightening a pinned brand colour', () => {
    const base = { bg: '#FFFFFF', ink: '#111111', accent: '#0B3D2E', soft: '#EEEEEE', dark: '#111111' };
    const inverted = paletteVariant(base, 2, { pin: ['accent'] });
    expect(inverted.accent).toBe('#0B3D2E');
    expect(isDarkGround(inverted.bg)).toBe(true);
  });
});
