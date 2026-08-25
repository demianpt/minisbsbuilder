import { describe, expect, it } from 'vitest';
import {
  DIAL_DEFAULTS,
  DIAL_GROUPS,
  DIAL_KEYS,
  DIAL_PRESETS,
  DIALS,
  cornerToRadius,
  dialCss,
  dialDocumentAttributes,
  dialLabel,
  dialLevels,
  dialTokens,
  dialVariables,
  ensureDials,
  radiusToCorner,
} from '../../shared/design/dials.mjs';

const MIN = Object.fromEntries(DIAL_KEYS.map((key) => [key, 0]));
const MAX = Object.fromEntries(DIAL_KEYS.map((key) => [key, 100]));

function px(value) {
  return Number.parseFloat(String(value).replace(/[^0-9.]/g, ''));
}

describe('dial definitions', () => {
  it('describes every dial the editor renders', () => {
    for (const key of DIAL_KEYS) {
      const dial = DIALS[key];
      expect(dial.label).toBeTruthy();
      expect(dial.min).toBeTruthy();
      expect(dial.max).toBeTruthy();
      // A dial with no explanation is a dial a strategist will not touch.
      expect(dial.help.length).toBeGreaterThan(30);
      expect(DIAL_DEFAULTS[key]).toBeGreaterThanOrEqual(0);
      expect(DIAL_DEFAULTS[key]).toBeLessThanOrEqual(100);
    }
  });

  it('puts every dial in exactly one editor group', () => {
    const grouped = DIAL_GROUPS.flatMap((group) => group.dials);
    expect([...grouped].sort()).toEqual([...DIAL_KEYS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it('names the band a value falls into', () => {
    expect(dialLabel('density', 0)).toBe('0 · Spacious');
    expect(dialLabel('density', 100)).toBe('100 · Compact');
    expect(dialLabel('motion', 0)).toBe('0 · Still');
    expect(dialLabel('motion', 100)).toBe('100 · Dynamic');
    expect(dialLabel('headline', 92)).toBe('92 · Huge');
  });
});

describe('ensureDials', () => {
  it('fills in every missing dial with its default', () => {
    const design = ensureDials({});
    for (const key of DIAL_KEYS) expect(design[key]).toBe(DIAL_DEFAULTS[key]);
  });

  it('keeps a legacy radius authoritative and derives the corner dial from it', () => {
    // A project saved before the corner dial existed must keep its rounding.
    const design = ensureDials({ radius: '16px' });
    expect(design.radius).toBe('16px');
    expect(design.corner).toBe(radiusToCorner('16px'));
    expect(cornerToRadius(design.corner)).toBe(16);
  });

  it('lets the corner dial rewrite the radius once it is set', () => {
    const design = ensureDials({ radius: '16px', corner: 0 });
    expect(design.radius).toBe('0px');
    expect(ensureDials({ corner: 100 }).radius).toBe('44px');
  });

  it('clamps and rounds hostile values instead of trusting them', () => {
    const design = ensureDials({ density: 400, motion: -20, headline: 'nope', corner: 999 });
    expect(design.density).toBe(100);
    expect(design.motion).toBe(0);
    expect(design.headline).toBe(DIAL_DEFAULTS.headline);
    expect(design.corner).toBe(100);
  });
});

describe('dialTokens', () => {
  const min = dialTokens(MIN);
  const max = dialTokens(MAX);

  it('changes every single token between the two extremes', () => {
    // This is the guard against the original complaint: a dial that does not
    // move a token is a dial the strategist cannot see.
    const unchanged = Object.keys(min).filter((token) => min[token] === max[token]);
    expect(unchanged).toEqual([]);
  });

  it('moves spacing the right way: spacious means more room', () => {
    expect(px(min.sectionGap)).toBeGreaterThan(px(max.sectionGap));
    expect(px(min.cardPadding)).toBeGreaterThan(px(max.cardPadding));
    expect(px(min.gridGap)).toBeGreaterThan(px(max.gridGap));
    expect(px(min.headerHeight)).toBeGreaterThan(px(max.headerHeight));
    expect(Number(min.bodyLineHeight)).toBeGreaterThan(Number(max.bodyLineHeight));
  });

  it('scales headings by a factor a strategist would call obvious', () => {
    // Roughly 2.5x between the smallest and largest headline setting.
    expect(Number(max.typeScale) / Number(min.typeScale)).toBeGreaterThan(2);
  });

  it('switches motion off completely at zero and produces real travel at full', () => {
    expect(min.motionDuration).toBe('0s');
    expect(min.motionDistance).toBe('0px');
    expect(min.hoverLift).toBe('0px');
    expect(min.mediaHoverZoom).toBe('1');
    expect(px(max.motionDuration)).toBeGreaterThan(0.7);
    expect(px(max.motionDistance)).toBeGreaterThan(60);
    expect(px(max.hoverLift)).toBeGreaterThan(8);
    // The logo marquee speed is visible without any scrolling at all.
    expect(px(min.marqueeDuration)).toBeGreaterThan(px(max.marqueeDuration) * 4);
  });

  it('keeps the two motion values the user compared clearly distinct', () => {
    const low = dialTokens({ ...MAX, motion: 1 });
    const high = dialTokens({ ...MAX, motion: 100 });
    expect(low.motionDuration).toBe('0s');
    expect(low.motionDistance).toBe('0px');
    expect(dialLevels({ motion: 1 }).motion).toBe('still');
    expect(dialLevels({ motion: 100 }).motion).toBe('dynamic');
    expect(high.motionDistance).not.toBe(low.motionDistance);
  });

  it('grows surface definition from nothing to a real shadow', () => {
    expect(min.cardShadow).toBe('none');
    expect(max.cardShadow).toContain('rgba');
    expect(px(min.borderAlpha)).toBeLessThan(px(max.borderAlpha));
  });

  it('emits only well-formed CSS values', () => {
    for (const [token, value] of Object.entries(max)) {
      expect(typeof value, token).toBe('string');
      expect(value.length, token).toBeGreaterThan(0);
      expect(value, token).not.toContain('NaN');
      expect(value, token).not.toContain('undefined');
    }
  });
});

describe('dialLevels and document attributes', () => {
  it('names a band for every dial', () => {
    const levels = dialLevels(MAX);
    expect(levels).toMatchObject({
      density: 'compact', expression: 'bold', motion: 'dynamic',
      accent: 'saturated', surface: 'raised', imagery: 'dominant', headline: 'huge',
    });
  });

  it('exposes the bands as data attributes the CSS can switch on', () => {
    const attributes = dialDocumentAttributes(MIN);
    expect(attributes['data-motion-level']).toBe('still');
    expect(attributes['data-density-level']).toBe('spacious');
    expect(attributes['data-surface-level']).toBe('flat');
    expect(Object.keys(dialDocumentAttributes(MAX))).toHaveLength(7);
  });
});

describe('dialCss', () => {
  it('declares one custom property per token', () => {
    const variables = dialVariables(MAX);
    expect(variables).toContain('--dst--desktop-vertical-gap:');
    expect(variables).toContain('--sbs-motion-distance:');
    expect(variables).toContain('--sbs-measure:');
    // Two tokens are consumed directly by rules rather than exposed as
    // variables: the mobile gap (inside a media query) and scroll-behavior.
    const exposed = new Set(variables.split(';').map((declaration) => declaration.split(':')[0]));
    expect(exposed.size).toBe(Object.keys(dialTokens(MAX)).length - 2);
    expect(dialCss(MAX)).toContain(`--dst--desktop-vertical-gap:${dialTokens(MAX).mobileGap}`);
    expect(dialCss(MAX)).toContain(`scroll-behavior:${dialTokens(MAX).scrollBehavior}`);
  });

  it('scopes every rule to the rendered page', () => {
    const css = dialCss(MAX);
    const selectors = css
      .split('\n')
      .filter((line) => line.includes('{') && !line.startsWith('@') && !line.startsWith('/*') && !line.startsWith('html'))
      .map((line) => line.split('{')[0].trim())
      .filter(Boolean);
    for (const selector of selectors) {
      // Nothing here may leak into the editor chrome.
      expect(selector.includes('#sbs-site') || selector.startsWith('.has-inview-a'), selector).toBe(true);
    }
  });

  it('produces different CSS for different dial settings', () => {
    expect(dialCss(MIN)).not.toBe(dialCss(MAX));
  });

  it('always ships a reduced-motion escape hatch', () => {
    expect(dialCss(MAX)).toContain('@media(prefers-reduced-motion:reduce)');
    expect(dialCss(MAX)).toContain('--sbs-motion-duration:0s');
  });
});

describe('dial presets', () => {
  it('sets every dial, so a preset is a complete starting point', () => {
    for (const preset of DIAL_PRESETS) {
      expect([...Object.keys(preset.values)].sort()).toEqual([...DIAL_KEYS].sort());
      expect(preset.label).toBeTruthy();
      expect(preset.summary).toBeTruthy();
    }
  });

  it('produces visibly different pages from one another', () => {
    const signatures = DIAL_PRESETS.map((preset) => JSON.stringify(dialTokens(preset.values)));
    expect(new Set(signatures).size).toBe(DIAL_PRESETS.length);
  });

  it('gives the friendly preset round corners and the editorial preset square ones', () => {
    const friendly = DIAL_PRESETS.find((preset) => preset.id === 'friendly');
    const editorial = DIAL_PRESETS.find((preset) => preset.id === 'editorial');
    expect(cornerToRadius(friendly.values.corner)).toBeGreaterThan(16);
    expect(cornerToRadius(editorial.values.corner)).toBe(0);
  });
});
