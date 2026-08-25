import { describe, expect, it } from 'vitest';
import catalog from '../../src/data/dst-data.json';
import {
  CONCEPT_DESIGN_KEYS,
  CONCEPT_SLOTS,
  PRESET_IDS,
  conceptDistinctness,
  conceptFromDesign,
  conceptSummary,
  normalizeConcept,
  normalizeConceptList,
  presetById,
  resolveConceptDesign,
} from '../../shared/design/concepts.mjs';
import { BUTTON_STYLE_IDS, DEFAULT_BUTTON_STYLE } from '../../shared/design/button-styles.mjs';
import { DIAL_KEYS, DIAL_PRESETS, cornerToRadius } from '../../shared/design/dials.mjs';

const KEYS = Object.keys(catalog.archetypes);

function concept(overrides = {}) {
  return {
    name: 'Calm and plain',
    archetypeKey: 'D',
    preset: 'calm',
    buttonStyle: 'solid-shift',
    dialOverrides: {},
    why: 'The audience is anxious.',
    ...overrides,
  };
}

describe('normalizeConcept', () => {
  it('fills in the slot positionally, never from the model', () => {
    expect(normalizeConcept(concept(), 0).slot).toBe('V1');
    expect(normalizeConcept(concept({ slot: 'V9' }), 2).slot).toBe('V3');
    expect(CONCEPT_SLOTS).toEqual(['V1', 'V2', 'V3']);
  });

  it('drops a concept with no usable archetype key', () => {
    expect(normalizeConcept(concept({ archetypeKey: 'Z' }), 0)).toBeNull();
    expect(normalizeConcept(concept({ archetypeKey: '' }), 0)).toBeNull();
    expect(normalizeConcept(null, 0)).toBeNull();
    // And rejects a real letter that this catalog does not carry.
    expect(normalizeConcept(concept({ archetypeKey: 'M' }), 0, { archetypeKeys: ['A', 'D'] })).toBeNull();
  });

  it('accepts the aliases and decorations the model actually returns', () => {
    const parsed = normalizeConcept({ name: 'X', archetype: 'D — Clean / Utility', preset: 'Calm and spacious', buttonStyle: 'pill-glow', why: 'w' }, 0);
    expect(parsed.archetypeKey).toBe('D');
    expect(parsed.preset).toBe('calm');
    expect(parsed.buttonStyle).toBe('pill-glow');
  });

  it('falls back to the safe button family and rotates the preset by position', () => {
    expect(normalizeConcept(concept({ buttonStyle: 'evil' }), 0).buttonStyle).toBe(DEFAULT_BUTTON_STYLE);
    expect(PRESET_IDS).toContain(normalizeConcept(concept({ preset: 'nonsense' }), 1).preset);
  });

  it('keeps only real dial overrides, clamped', () => {
    const parsed = normalizeConcept(concept({ dialOverrides: { motion: 140, corner: -5, nonsense: 40, headline: '62' } }), 0);
    expect(parsed.dialOverrides).toEqual({ headline: 62, corner: 0, motion: 100 });
  });

  it('takes at most three concepts and skips the unusable ones', () => {
    const list = normalizeConceptList([
      concept(),
      concept({ archetypeKey: 'nope' }),
      concept({ archetypeKey: 'C' }),
      concept({ archetypeKey: 'A' }),
      concept({ archetypeKey: 'B' }),
    ], { archetypeKeys: KEYS });
    expect(list.map((entry) => entry.archetypeKey)).toEqual(['D', 'C', 'A']);
    expect(list.map((entry) => entry.slot)).toEqual(['V1', 'V2', 'V3']);
  });
});

describe('resolveConceptDesign', () => {
  const style = catalog.archetypeStyles.D;

  it('returns the design slice and nothing else', () => {
    const design = resolveConceptDesign(concept(), { archetypeStyle: style });
    // This is the guarantee behind the V1/V2/V3 pills: no sections, no content,
    // no flow, no globals can be reached through a concept.
    for (const key of Object.keys(design)) expect(CONCEPT_DESIGN_KEYS).toContain(key);
    expect(design).not.toHaveProperty('sections');
    expect(design).not.toHaveProperty('flowId');
    expect(design).not.toHaveProperty('header');
  });

  it('takes the palette and type from the archetype', () => {
    const design = resolveConceptDesign(concept(), { archetypeStyle: style });
    expect(design.archetype).toBe('D');
    expect(design.palette).toEqual({ bg: style.bg, ink: style.ink, accent: style.accent, soft: style.soft, dark: style.dark });
    expect(design.fontBody).toBe(style.fontBody);
    expect(design.fontDisplay).toBe(style.fontDisplay);
  });

  it('takes every dial from the named quick style', () => {
    const preset = presetById('calm');
    const design = resolveConceptDesign(concept({ preset: 'calm' }), { archetypeStyle: style });
    for (const dial of DIAL_KEYS) expect(design[dial], dial).toBe(preset.values[dial]);
  });

  it('lets an override beat the quick style, and the corner dial beat the archetype radius', () => {
    const design = resolveConceptDesign(concept({ preset: 'calm', dialOverrides: { motion: 88, corner: 100 } }), { archetypeStyle: style });
    expect(design.motion).toBe(88);
    expect(design.corner).toBe(100);
    // A concept that asked for pill corners must not be squared off by its archetype.
    expect(design.radius).toBe(`${cornerToRadius(100)}px`);
    expect(design.radius).not.toBe(style.radius);
  });

  it('keeps the current palette when the archetype style is unknown', () => {
    const current = { palette: { bg: '#101010', ink: '#fefefe', accent: '#ff0000', soft: '#222', dark: '#000' } };
    const design = resolveConceptDesign(concept(), { current });
    // The roles the concept did not own are inherited rather than reset.
    expect(design.palette.bg).toBe('#101010');
    expect(design.palette.ink).toBe('#fefefe');
    expect(design.palette.accent).toBe('#ff0000');
    expect(design).not.toHaveProperty('fontBody');
    // Resolution is also the point where a palette is made legible. `#000` on a
    // `#101010` page is a band with no edge, so it is lifted just far enough to
    // have one, and the change is reported rather than applied silently.
    expect(design.paletteRepairs.map((entry) => entry.role)).toEqual(['dark']);
    expect(design.palette.dark).not.toBe('#000');
  });

  it('produces a materially different design for each of three concepts', () => {
    const designs = [
      resolveConceptDesign(concept({ archetypeKey: 'D', preset: 'calm', buttonStyle: 'solid-shift' }), { archetypeStyle: catalog.archetypeStyles.D }),
      resolveConceptDesign(concept({ archetypeKey: 'C', preset: 'friendly', buttonStyle: 'pill-glow' }), { archetypeStyle: catalog.archetypeStyles.C }),
      resolveConceptDesign(concept({ archetypeKey: 'A', preset: 'editorial', buttonStyle: 'offset-block' }), { archetypeStyle: catalog.archetypeStyles.A }),
    ];
    expect(new Set(designs.map((design) => JSON.stringify(design))).size).toBe(3);
    expect(new Set(designs.map((design) => design.palette.accent)).size).toBe(3);
    expect(new Set(designs.map((design) => design.buttonStyle)).size).toBe(3);
    expect(new Set(designs.map((design) => design.density)).size).toBeGreaterThan(1);
  });

  it('returns null rather than a partial design for an unusable concept', () => {
    expect(resolveConceptDesign({ archetypeKey: 'Z' })).toBeNull();
  });
});

describe('conceptFromDesign', () => {
  it('records only the dials that depart from the named quick style', () => {
    const preset = presetById('calm');
    const design = { archetype: 'D', buttonStyle: 'pill-glow', ...preset.values, motion: 91 };
    const captured = conceptFromDesign(design, { slot: 'V1', name: 'Calm', preset: 'calm' });
    expect(captured.dialOverrides).toEqual({ motion: 91 });
    expect(captured.buttonStyle).toBe('pill-glow');
    expect(captured.archetypeKey).toBe('D');
  });

  it('round-trips a live design back through resolution', () => {
    const style = catalog.archetypeStyles.C;
    const original = resolveConceptDesign(concept({ archetypeKey: 'C', preset: 'friendly', dialOverrides: { headline: 81 } }), { archetypeStyle: style });
    const captured = conceptFromDesign(original, { slot: 'V2', name: 'Warm', preset: 'friendly' });
    const again = resolveConceptDesign(captured, { archetypeStyle: style });
    for (const dial of DIAL_KEYS) expect(again[dial], dial).toBe(original[dial]);
    expect(again.buttonStyle).toBe(original.buttonStyle);
  });
});

describe('conceptDistinctness', () => {
  it('reports three concepts that really differ', () => {
    const report = conceptDistinctness([
      concept({ archetypeKey: 'D', preset: 'calm', buttonStyle: 'solid-shift' }),
      concept({ archetypeKey: 'C', preset: 'friendly', buttonStyle: 'pill-glow' }),
      concept({ archetypeKey: 'A', preset: 'editorial', buttonStyle: 'offset-block' }),
    ]);
    expect(report).toMatchObject({ count: 3, archetypes: 3, presets: 3, buttons: 3, distinct: true });
  });

  it('flags one concept dressed up as three', () => {
    const same = [concept(), concept(), concept()];
    expect(conceptDistinctness(same).distinct).toBe(false);
  });
});

describe('conceptSummary', () => {
  it('says what a client would notice, not what the catalog calls it', () => {
    expect(conceptSummary(concept(), { archetypeName: 'Clean / Utility SaaS' }))
      .toBe('Clean / Utility SaaS · Calm and spacious');
  });
});

describe('catalog assumptions the concepts rely on', () => {
  it('every quick style and button family a concept may name exists', () => {
    expect(PRESET_IDS).toEqual(DIAL_PRESETS.map((preset) => preset.id));
    expect(BUTTON_STYLE_IDS.length).toBe(10);
    expect(PRESET_IDS.length).toBeGreaterThanOrEqual(3);
  });

  it('there are at least three archetypes to choose between', () => {
    expect(KEYS.length).toBeGreaterThanOrEqual(3);
    for (const key of KEYS) expect(catalog.archetypeStyles[key], key).toBeTruthy();
  });
});
