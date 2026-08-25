import { describe, expect, it } from 'vitest';
import { BUTTON_STYLE_IDS, buttonStyleCss } from '../../shared/design/button-styles.mjs';

/**
 * A button's label against the colour the button is actually filled with.
 *
 * Five of the ten families inverted on hover by flooding the shape with `#fff`
 * and then setting the label to `var(--dst--primary-color3)`. That role is the
 * palette's ink, which is dark only while the palette is light — on a dark
 * palette ink *is* the light colour, so the hover painted a light label on a
 * white fill. Measured against rendered pixels at 1.2:1 on Sweep Fill, Split
 * Reveal, Corner Cut, Ink Wipe and Magnetic Arrow.
 *
 * The rule this locks in: a fill of a *known* colour takes a label chosen for
 * that colour — `--sbs-on-white`, `--sbs-on-accent`, `--sbs-on-ink` — and never a
 * palette role that changes tone underneath it.
 */

/* Roles whose tone follows the palette, so they cannot label a known fill. */
const TONE_FOLLOWING_ROLES = ['--dst--primary-color3', '--dst--base-text-color', '--dst--primary-color1'];

describe('what a button paints its label with', () => {
  for (const id of BUTTON_STYLE_IDS) {
    const css = buttonStyleCss(id);

    it(`${id} labels an inverted hover with a colour chosen for the fill`, () => {
      /*
       * The inverted variants are the ones that flood with white, so their hover
       * label is the case that broke. A rule is read as one declaration block.
       */
      const blocks = css.match(/\.-(?:primary|secondary)-inverted[^{]*\{[^}]*\}/g) || [];
      const hovers = (css.match(/[^{}]*-inverted:hover[^{]*\{[^}]*\}/g) || []);
      for (const block of hovers) {
        const label = /(?:^|[;{])color:([^;}]+)/.exec(block);
        if (!label) continue;
        const value = label[1].trim();
        /*
         * The colour that gets used is the first token named; a tone-following
         * role is fine *after* it, as the fallback for a build that does not
         * emit the token. So the check is on what comes first, not on whether
         * the role appears at all.
         */
        const first = /var\(\s*(--[a-z0-9-]+)/i.exec(value);
        if (!first) continue;
        expect(
          TONE_FOLLOWING_ROLES,
          `${id} labels an inverted hover with ${first[1]}, which is dark only while the palette is light: ${block.trim()}`,
        ).not.toContain(first[1]);
      }
      // The variants themselves must exist, or the assertion above is vacuous.
      expect(blocks.length + hovers.length, `${id} declares no inverted variants`).toBeGreaterThan(0);
    });
  }

  it('the families that flood with white ask for the colour that reads on white', () => {
    const flooders = BUTTON_STYLE_IDS.filter((id) => /--sbs-btn-(?:sweep|split|wedge|ink|flood)\s*:\s*#fff/i.test(buttonStyleCss(id)));
    // Sweep Fill, Split Reveal, Corner Cut, Ink Wipe and Magnetic Arrow.
    expect(flooders.length).toBeGreaterThanOrEqual(4);
    for (const id of flooders) {
      expect(buttonStyleCss(id), `${id} floods with white and never names --sbs-on-white`).toContain('--sbs-on-white');
    }
  });
});
