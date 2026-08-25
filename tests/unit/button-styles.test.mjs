import { describe, expect, it } from 'vitest';
import {
  BUTTON_STYLES,
  BUTTON_STYLE_IDS,
  DEFAULT_BUTTON_STYLE,
  buttonStyle,
  buttonStyleCss,
  buttonStyleEditorCss,
  buttonStylePreviewMarkup,
  isButtonStyle,
  normalizeButtonStyle,
} from '../../shared/design/button-styles.mjs';

describe('button style catalog', () => {
  it('offers ten complete, described families', () => {
    expect(BUTTON_STYLES).toHaveLength(10);
    for (const style of BUTTON_STYLES) {
      expect(style.id).toMatch(/^[a-z-]+$/);
      expect(style.label).toBeTruthy();
      // A strategist chooses from the description, so it has to say something.
      expect(style.summary.length).toBeGreaterThan(30);
      expect(style.hover.length).toBeGreaterThan(10);
      expect(style.bestFor.length).toBeGreaterThan(10);
    }
    expect(new Set(BUTTON_STYLE_IDS).size).toBe(10);
  });

  it('falls back to the safe default for anything unrecognised', () => {
    expect(normalizeButtonStyle('not-a-style')).toBe(DEFAULT_BUTTON_STYLE);
    expect(normalizeButtonStyle(undefined)).toBe(DEFAULT_BUTTON_STYLE);
    expect(normalizeButtonStyle('pill-glow')).toBe('pill-glow');
    expect(isButtonStyle('offset-block')).toBe(true);
    expect(isButtonStyle('<script>')).toBe(false);
    expect(buttonStyle('nope').id).toBe(DEFAULT_BUTTON_STYLE);
  });
});

describe('buttonStyleCss', () => {
  const css = Object.fromEntries(BUTTON_STYLE_IDS.map((id) => [id, buttonStyleCss(id)]));

  it('emits a distinct block per style', () => {
    expect(new Set(Object.values(css)).size).toBe(10);
    for (const [id, value] of Object.entries(css)) expect(value).toContain(`/* button-style:${id} */`);
  });

  it('styles all three roles in every family', () => {
    for (const [id, value] of Object.entries(css)) {
      expect(value, id).toContain('.c-btn.-primary');
      expect(value, id).toContain('.c-btn.-secondary');
      expect(value, id).toContain('.c-btn.-link');
      // Inverted roles exist because half the DST bands are dark.
      expect(value, id).toContain('-inverted');
    }
  });

  it('gives every family a real hover state', () => {
    for (const [id, value] of Object.entries(css)) {
      const hovers = value.split('\n').filter((line) => line.includes(':hover'));
      expect(hovers.length, id).toBeGreaterThanOrEqual(3);
    }
  });

  it('scopes every rule to the rendered page', () => {
    for (const [id, value] of Object.entries(css)) {
      const selectors = value
        .split('\n')
        .filter((line) => line.includes('{') && !line.trim().startsWith('@') && !line.trim().startsWith('/*'))
        .map((line) => line.split('{')[0].trim())
        .filter(Boolean);
      for (const selector of selectors) expect(selector, `${id}: ${selector}`).toContain('#sbs-site');
    }
  });

  it('reads colour from palette tokens only, never a hard-coded brand colour', () => {
    for (const [id, value] of Object.entries(css)) {
      // White and transparent are legitimate; a hex brand colour is not.
      const hexes = (value.match(/#[0-9a-f]{3,8}\b/gi) || []).map((hex) => hex.toLowerCase());
      for (const hex of hexes) expect(['#fff', '#ffffff'], `${id} uses ${hex}`).toContain(hex);
    }
  });

  it('respects the corner dial unless the family is intentionally a pill', () => {
    expect(css['solid-shift']).toContain('--sbs-btn-radius,var(--dst--default-radius)');
    expect(css['pill-glow']).toContain('--sbs-btn-radius:999px');
    expect(css['offset-block']).toContain('--sbs-btn-radius:0px');
  });

  it('always ships a reduced-motion escape hatch', () => {
    for (const [id, value] of Object.entries(css)) {
      expect(value, id).toContain('@media(prefers-reduced-motion:reduce)');
      expect(value, id).toContain('transform:none!important');
    }
  });

  it('never lifts the whole button on hover for the two families that used to', () => {
    // Solid Shift and Pill Glow were the only families that translated upward,
    // and Pill Glow far enough to read as the button jumping away. dst-shared
    // gives every button a shared -2px lift, so Solid Shift has to say `none`
    // rather than merely omit a transform.
    expect(css['solid-shift']).toContain('transform:none');
    expect(css['solid-shift']).not.toContain('translateY(calc(-1 * var(--sbs-hover-lift)))');
    expect(css['pill-glow']).not.toContain('translateY(calc(-1 * var(--sbs-hover-lift)))');
    // Pill Glow still grows, in place.
    expect(css['pill-glow']).toContain('transform:scale(1.03)');
  });

  it('asks the page which label colour can be read on the ground it paints', () => {
    // A pale accent used to get a hard-coded white label, which is a button
    // with no visible text. Every label that lands on the accent or the ink
    // reads its colour from a token the page derives from the palette.
    for (const [id, value] of Object.entries(css)) {
      const hovers = value.split('\n').filter((line) => /\.-primary:hover|\.-secondary:hover/.test(line) && line.includes('color:#fff'));
      expect(hovers, `${id} still hard-codes a white label on a palette ground`).toEqual([]);
    }
    expect(css['sweep-fill']).toContain('var(--sbs-on-ink');
    expect(css['magnetic-arrow']).toContain('var(--sbs-on-accent');
    expect(css['corner-cut']).toContain('var(--sbs-on-ink');
    expect(css['ink-wipe']).toContain('var(--sbs-on-accent');
  });

  it('drives its timing from the movement dial, not a fixed duration', () => {
    for (const [id, value] of Object.entries(css)) {
      expect(value, id).toContain('var(--sbs-motion-duration)');
      expect(value, id).toContain('var(--sbs-motion-ease)');
    }
  });
});

describe('editor swatches', () => {
  it('uses only registered DST markup, so a swatch cannot drift from the page', () => {
    const markup = buttonStylePreviewMarkup('sweep-fill');
    expect(markup).toContain('data-button-style="sweep-fill"');
    expect(markup).toContain('class="c-btn -primary"');
    expect(markup).toContain('class="c-btn -secondary"');
    expect(markup).toContain('class="c-btn -link"');
    expect(markup).toContain('c-btn__txt');
    // No anchors: the swatch lives inside a <label> and must not navigate.
    expect(markup).not.toContain('<a ');
    expect(markup).not.toContain('href');
  });

  it('re-scopes the page CSS to the swatch container with nothing left behind', () => {
    const editor = buttonStyleEditorCss();
    expect(editor).not.toContain('#sbs-site');
    for (const id of BUTTON_STYLE_IDS) expect(editor).toContain(`.btn-style-preview[data-button-style="${id}"]`);
    // The swatch has no dst-shared.css, so it ships its own role colours.
    expect(editor).toContain('.btn-style-preview .c-btn.-primary{');
    expect(editor).toContain('@media(prefers-reduced-motion:reduce)');
  });

  it('sizes itself in em so the small swatch and the real page agree', () => {
    const editor = buttonStyleEditorCss();
    expect(editor).toContain('--sbs-btn-pad,1.02em 1.8em');
    expect(editor).not.toMatch(/--sbs-btn-pad:[\d.]+rem/);
  });
});
