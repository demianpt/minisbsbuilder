import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  STYLE_FAMILIES,
  STYLE_FAMILY_IDS,
  STYLE_SCHEMA_VERSION,
  validateStyleProfile,
} from '../../shared/styles/schema.mjs';
import {
  allStyles,
  loadStyleLibrary,
  productionStyles,
  styleByKey,
  styleCounts,
  styleFamilies,
  styleFromRef,
  styleKey,
  stylesInFamily,
} from '../../shared/styles/catalog.mjs';
import {
  compilePatternWeight,
  compileSectionRecipe,
  compileStyle,
  variantRule,
} from '../../shared/styles/compiler.mjs';
import { MINIMUM_DISTANCE, distinctnessReport, styleDistance } from '../../shared/styles/distinctness.mjs';
import { DIAL_KEYS } from '../../shared/design/dials.mjs';
import { BUTTON_STYLE_IDS } from '../../shared/design/button-styles.mjs';
import { FONT_NAMES } from '../../shared/design/fonts.mjs';

/**
 * The hue of a colour, 0–360.
 *
 * `repairPalette` is the last gate before anything is painted and it moves
 * lightness only, so a brand colour arrives as itself even when a band it landed on
 * could not have been read. Comparing hue is how these tests assert "the brand
 * survived" without asserting the page stayed illegible.
 */
function hueOf(hex) {
  const value = String(hex).replace('#', '');
  const [r, g, b] = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const delta = max - min;
  const hue = max === r ? ((g - b) / delta + (g < b ? 6 : 0)) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return Math.round(hue * 60);
}

const catalog = JSON.parse(readFileSync('src/data/dst-data.json', 'utf8'));
const library = JSON.parse(readFileSync('src/data/style-library.json', 'utf8'));

beforeAll(() => {
  loadStyleLibrary(library);
});

describe('the built style library', () => {
  it('holds ten families of five production styles', () => {
    const counts = styleCounts();
    expect(counts.families).toBe(10);
    expect(counts.styles).toBe(50);
    for (const familyId of STYLE_FAMILY_IDS) expect(counts.perFamily[familyId], familyId).toBe(5);
    expect(productionStyles()).toHaveLength(50);
  });

  it('names the families the product spec names', () => {
    expect(STYLE_FAMILY_IDS).toEqual([
      'technology', 'luxury', 'editorial', 'corporate', 'commerce',
      'hospitality', 'automotive-mobility', 'health-wellness', 'creative-culture', 'experimental',
    ]);
    expect(styleFamilies().map((family) => family.id)).toEqual(STYLE_FAMILY_IDS);
  });

  it('carries the styles the spec lists, under stable keys', () => {
    const expected = {
      technology: ['product-keynote-minimal', 'precision-saas', 'glass-ai', 'technical-grid', 'dark-product-lab'],
      luxury: ['quiet-luxury', 'modern-heritage', 'editorial-luxury', 'dark-prestige', 'gallery-luxury'],
      editorial: ['contemporary-magazine', 'swiss-editorial', 'culture-journal', 'oversized-editorial', 'newsroom-modern'],
      corporate: ['executive-precision', 'human-corporate', 'financial-authority', 'global-consulting', 'institutional-modern'],
      commerce: ['product-editorial', 'bold-retail', 'premium-commerce', 'lifestyle-shop', 'conversion-minimal'],
      hospitality: ['boutique-escape', 'resort-editorial', 'culinary-luxury', 'urban-hotel', 'organic-retreat'],
      'automotive-mobility': ['performance-machine', 'grand-touring', 'technical-automotive', 'heritage-garage', 'future-mobility'],
      'health-wellness': ['clinical-calm', 'human-wellness', 'premium-medical', 'natural-health', 'precision-health'],
      'creative-culture': ['portfolio-minimal', 'art-gallery', 'studio-bold', 'cultural-experimental', 'motion-creative'],
      experimental: ['neo-brutalist', 'retro-future', 'digital-aurora', 'geometric-system', 'typographic-maximalist'],
    };
    for (const [familyId, ids] of Object.entries(expected)) {
      expect(stylesInFamily(familyId).map((profile) => profile.id), familyId).toEqual(ids);
    }
  });

  it('validates every profile against sbs-style/1.0', () => {
    const invalid = [];
    for (const profile of allStyles()) {
      const result = validateStyleProfile(profile);
      if (!result.ok) invalid.push({ id: styleKey(profile), issues: result.issues });
    }
    expect(invalid).toEqual([]);
    expect(library.styleSchemaVersion).toBe(STYLE_SCHEMA_VERSION);
  });

  it('only ever references a real font, button family, section family and motif', () => {
    const families = new Set(Object.keys(catalog.defaultPatternByFamily));
    const motifs = new Set(Object.keys(catalog.decorations));
    for (const profile of allStyles()) {
      const key = styleKey(profile);
      expect(FONT_NAMES, `${key} display`).toContain(profile.typography.display);
      expect(FONT_NAMES, `${key} body`).toContain(profile.typography.body);
      expect(BUTTON_STYLE_IDS, `${key} button`).toContain(profile.buttonStyle);
      for (const [family, recipe] of Object.entries(profile.componentRecipes || {})) {
        expect(families, `${key} recipe ${family}`).toContain(family);
        if (recipe.decoration) expect(motifs, `${key} motif`).toContain(recipe.decoration);
      }
    }
  });

  it('takes a position on all nine dials for every style', () => {
    for (const profile of allStyles()) {
      for (const dial of DIAL_KEYS) {
        expect(Number.isInteger(profile.dials[dial]), `${styleKey(profile)}.${dial}`).toBe(true);
      }
    }
  });

  it('resolves a style from a key, a bare id and a concept style reference', () => {
    expect(styleByKey('creative-culture/art-gallery').name).toBe('Art Gallery');
    expect(styleByKey('art-gallery').name).toBe('Art Gallery');
    expect(styleByKey('nope/nope')).toBeNull();
    expect(styleFromRef({ familyId: 'luxury', styleId: 'quiet-luxury' }).name).toBe('Quiet Luxury');
    expect(styleFromRef({ familyId: '', styleId: '' })).toBeNull();
  });
});

describe('style distinctness', () => {
  it('contains no near-clones', () => {
    const report = distinctnessReport(allStyles());
    expect(report.failures, JSON.stringify(report.failures.map((pair) => `${pair.a}~${pair.b}@${pair.score}`))).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.pairs).toBe((50 * 49) / 2);
  });

  it('does not let two styles pass on colour alone', () => {
    // Same style, recoloured: it must still read as a near-clone, because a palette
    // swap is not a design language (§86).
    const base = styleByKey('creative-culture/art-gallery');
    const recoloured = { ...base, id: 'art-gallery-blue', palette: { bg: '#0A0F1C', ink: '#F2F5FA', accent: '#7C6BFF', soft: '#18213A', dark: '#05080F' } };
    expect(styleDistance(base, recoloured).score).toBeLessThan(MINIMUM_DISTANCE);
  });

  it('separates two styles that genuinely differ in structure', () => {
    const gallery = styleByKey('creative-culture/art-gallery');
    const saas = styleByKey('technology/precision-saas');
    const { score, parts } = styleDistance(gallery, saas);
    expect(score).toBeGreaterThan(MINIMUM_DISTANCE);
    expect(parts.dials).toBeGreaterThan(0.2);
    expect(parts.patterns).toBeGreaterThan(0.5);
  });
});

describe('the style compiler', () => {
  const gallery = () => styleByKey('creative-culture/art-gallery');

  it('resolves the authored style for the core variation', () => {
    const profile = gallery();
    const design = compileStyle(profile, { variantType: 'core' });
    expect(design.styleId).toBe('art-gallery');
    expect(design.styleFamilyId).toBe('creative-culture');
    expect(design.fontDisplay).toBe(profile.typography.display);
    expect(design.buttonStyle).toBe(profile.buttonStyle);
    expect(design.radius).toBe(profile.radius);
    for (const dial of DIAL_KEYS) expect(design[dial], dial).toBe(profile.dials[dial]);
    // The archetype is cleared: this concept resolves from a style now.
    expect(design.archetype).toBe('');
  });

  it('lifts brand emphasis for brand-led and expression for expressive', () => {
    const profile = gallery();
    const core = compileStyle(profile, { variantType: 'core' });
    const brandLed = compileStyle(profile, { variantType: 'brand-led' });
    const expressive = compileStyle(profile, { variantType: 'expressive' });
    expect(brandLed.accent).toBeGreaterThan(core.accent);
    expect(expressive.expressiveness).toBeGreaterThan(core.expressiveness);
    expect(expressive.headline).toBeGreaterThan(core.headline);
    expect(expressive.motion).toBeGreaterThan(core.motion);
    // All three stay the same visual language.
    expect(new Set([core.fontDisplay, brandLed.fontDisplay, expressive.fontDisplay]).size).toBe(1);
    expect(variantRule('expressive').label).toBe('Expressive');
    expect(variantRule('nonsense').label).toBe('Core');
  });

  it('honours the style’s protected palette roles', () => {
    // Art Gallery protects its canvas and its supporting surface: a burgundy brand
    // may take the accent and nothing else, or it stops being a gallery style.
    const design = compileStyle(gallery(), {
      variantType: 'brand-led',
      brand: { any: true, palette: { accent: '#5B0E20', bg: '#5B0E20', soft: '#5B0E20' } },
    });
    expect(design.palette.accent).toBe('#5B0E20');
    expect(design.palette.bg).not.toBe('#5B0E20');
    expect(design.palette.soft).not.toBe('#5B0E20');
  });

  it('lets a full-strategy style take the brand across the palette', () => {
    // Commerce styles map the brand fully, which is what makes a brand-led retail
    // concept actually look like the client. The legibility gate may still move a
    // role's lightness, so the contract is that the brand hue arrives — not that a
    // hex survives a band it could not be read on.
    const design = compileStyle(styleByKey('commerce/bold-retail'), {
      variantType: 'brand-led',
      brand: { any: true, palette: { accent: '#123456', soft: '#654321' } },
    });
    expect(design.palette.accent).toBe('#123456');
    expect(hueOf(design.palette.soft)).toBeCloseTo(hueOf('#654321'), 0);
    // And the same brand on an accent-only style reaches the accent and nothing else.
    const restrained = compileStyle(styleByKey('creative-culture/art-gallery'), {
      variantType: 'brand-led',
      brand: { any: true, palette: { accent: '#123456', soft: '#654321' } },
    });
    expect(restrained.palette.soft).toBe(styleByKey('creative-culture/art-gallery').palette.soft);
  });

  it('keeps the brief’s stated typeface over the style’s', () => {
    const design = compileStyle(gallery(), { brand: { any: true, fontDisplay: 'Archivo Black', dials: { density: 90 } } });
    expect(design.fontDisplay).toBe('Archivo Black');
    expect(design.density).toBe(90);
  });

  it('puts manual edits last, above the style and the brief', () => {
    const design = compileStyle(gallery(), {
      variantType: 'expressive',
      brand: { any: true, fontDisplay: 'Archivo Black', palette: { accent: '#111111' } },
      manual: { fontDisplay: 'Fraunces', palette: { accent: '#00FF88' }, density: 77 },
    });
    expect(design.fontDisplay).toBe('Fraunces');
    // Same rule as above: the hand-picked hue is what has to survive.
    expect(hueOf(design.palette.accent)).toBeCloseTo(hueOf('#00ff88'), 0);
    expect(design.density).toBe(77);
  });

  it('repairs a palette it cannot read and records what moved', () => {
    const design = compileStyle({
      ...gallery(),
      palette: { bg: '#FFFFFF', ink: '#FEFEFE', accent: '#FFFFFF', soft: '#FFFFFF', dark: '#FFFFFF' },
    });
    expect(Array.isArray(design.paletteRepairs)).toBe(true);
    expect(design.paletteRepairs.length).toBeGreaterThan(0);
  });

  it('returns null rather than guessing at a missing profile', () => {
    expect(compileStyle(null)).toBeNull();
    expect(compileStyle(undefined, { variantType: 'core' })).toBeNull();
  });
});

describe('style-driven pattern selection', () => {
  it('rewards a pattern the style reaches for and penalises one it avoids', () => {
    const gallery = styleByKey('creative-culture/art-gallery');
    const wanted = compilePatternWeight(gallery, 'gallery', 'spacious large media gallery grid with a caption');
    const unwanted = compilePatternWeight(gallery, 'cards', 'a dense six across grid with a gradient and a slider');
    expect(wanted.delta).toBeGreaterThan(0);
    expect(unwanted.delta).toBeLessThan(0);
    expect(wanted.why.join(' ')).toContain('prefers');
    expect(unwanted.why.join(' ')).toContain('avoids');
  });

  it('weights a per-family instruction above a whole-style one', () => {
    // `art-gallery` avoids `six` for cards specifically and `dense` generally.
    const gallery = styleByKey('creative-culture/art-gallery');
    const perFamily = compilePatternWeight(gallery, 'cards', 'six across');
    const wholeStyle = compilePatternWeight(gallery, 'cards', 'dense');
    expect(Math.abs(perFamily.delta)).toBeGreaterThan(Math.abs(wholeStyle.delta));
  });

  it('gives two styles opposite verdicts on the same pattern', () => {
    const description = 'a dense six across grid of cards';
    const saas = compilePatternWeight(styleByKey('technology/precision-saas'), 'cards', description);
    const gallery = compilePatternWeight(styleByKey('creative-culture/art-gallery'), 'cards', description);
    expect(saas.delta).toBeGreaterThan(0);
    expect(gallery.delta).toBeLessThan(0);
  });

  it('scores nothing when there is no pattern text to judge', () => {
    expect(compilePatternWeight(styleByKey('creative-culture/art-gallery'), 'cards', '')).toEqual({ delta: 0, why: [] });
  });
});

describe('style component recipes', () => {
  it('overrides the engine preset with the style’s own composition', () => {
    const recipe = compileSectionRecipe(styleByKey('technology/precision-saas'), 'cards', {
      base: { container: 'default', paddingTop: 'default', paddingBottom: 'default', inverted: true },
    });
    expect(recipe.container).toBe('wide');
    expect(recipe.styleColumns).toEqual({ desktop: 4, mobile: 1 });
  });

  it('applies the container bias where a family has no recipe of its own', () => {
    const profile = styleByKey('editorial/newsroom-modern');
    const recipe = compileSectionRecipe(profile, 'accordion', { base: { container: 'default' } });
    expect(recipe.container).toBe(profile.composition.containerBias);
  });

  it('never rewrites a full-bleed band into a contained one by accident', () => {
    const recipe = compileSectionRecipe(styleByKey('editorial/swiss-editorial'), 'accordion', { base: { container: 'full' } });
    expect(recipe.container).toBe('full');
  });

  it('turns a decoration into the shape the renderer expects', () => {
    const recipe = compileSectionRecipe(styleByKey('technology/technical-grid'), 'hero', { base: {} });
    expect(recipe.decoration).toMatchObject({ motif: 'blueprint-grid', position: 'cover' });
    expect(recipe.decoration.opacity).toBeCloseTo(0.1);
  });

  it('returns the base untouched for a style it was not given', () => {
    expect(compileSectionRecipe(null, 'hero', { base: { container: 'full' } })).toEqual({ container: 'full' });
  });
});

describe('the fifty styles differ where a client would notice', () => {
  it('spreads across polarity, buttons, fonts, radii and composition', () => {
    const styles = allStyles();
    const axis = (pluck) => new Set(styles.map(pluck)).size;
    expect(axis((profile) => profile.polarity)).toBe(2);
    expect(axis((profile) => profile.buttonStyle)).toBeGreaterThanOrEqual(8);
    expect(axis((profile) => profile.typography.display)).toBeGreaterThanOrEqual(9);
    expect(axis((profile) => profile.radius)).toBeGreaterThanOrEqual(8);
    expect(axis((profile) => profile.composition.alignment)).toBeGreaterThanOrEqual(3);
    expect(axis((profile) => profile.composition.mediaDominance)).toBeGreaterThanOrEqual(4);
    expect(axis((profile) => profile.composition.surfaceTreatment)).toBeGreaterThanOrEqual(4);
    expect(axis((profile) => JSON.stringify(profile.dials))).toBe(50);
    expect(axis((profile) => JSON.stringify(profile.palette))).toBe(50);
  });

  it('gives every style a pattern preference, so none is a palette preset', () => {
    for (const profile of allStyles()) {
      const preferences = profile.patternPreferences;
      const total = (preferences.prefer || []).length + (preferences.avoid || []).length;
      expect(total, styleKey(profile)).toBeGreaterThan(2);
    }
  });

  it('describes itself well enough for a picker card', () => {
    for (const profile of allStyles()) {
      expect(profile.description.length, styleKey(profile)).toBeGreaterThan(30);
      expect(profile.useCases.length, styleKey(profile)).toBeGreaterThanOrEqual(2);
      expect(profile.dos.length, styleKey(profile)).toBeGreaterThanOrEqual(2);
      expect(profile.donts.length, styleKey(profile)).toBeGreaterThanOrEqual(2);
    }
  });

  it('has a blurb for every family in the picker', () => {
    for (const family of STYLE_FAMILIES) expect(family.blurb.length, family.id).toBeGreaterThan(10);
  });
});
