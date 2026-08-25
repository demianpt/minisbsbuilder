import { describe, expect, it } from 'vitest';
import {
  applyDirectivesToConcept,
  applyDirectivesToConcepts,
  directiveSummary,
  extractBriefDirectives,
} from '../../shared/brief/directives.mjs';
import { FONT_NAMES, fontByName, findFontMentions } from '../../shared/design/fonts.mjs';
import { conceptsFromBrief } from '../../shared/brief/planner.mjs';
import { resolveConceptDesign } from '../../shared/design/concepts.mjs';

/**
 * A brief that states a colour, a typeface or a typographic scale has given an
 * instruction, not a hint. These tests hold two things: that the instruction is
 * read, and — just as important — that ordinary prose is left alone, because a
 * false positive silently overrides a designed decision.
 */

describe('reading design instructions out of a brief', () => {
  it('takes a stated hex, the typefaces and the scale', () => {
    const directives = extractBriefDirectives(
      'Harbour Dental is a family practice. Our brand colour is #0B3D2E. '
      + 'We want big typography and lots of white space. Use Fraunces for the headings '
      + 'and Inter for body copy. No animation please.',
    );
    expect(directives.palette.accent).toBe('#0b3d2e');
    expect(directives.fontDisplay).toBe('Fraunces');
    expect(directives.fontBody).toBe('Inter');
    expect(directives.dials).toMatchObject({ headline: 92, density: 16, motion: 0 });
    expect(directives.any).toBe(true);
  });

  it('attaches each colour to the role named beside it, on either side', () => {
    expect(extractBriefDirectives('The background should be cream and the text colour charcoal.').palette)
      .toMatchObject({ bg: '#F7F2E7', ink: '#2A2D31' });
    // The role word follows the colour just as often as it precedes it.
    expect(extractBriefDirectives('A burnt orange accent over charcoal.').palette)
      .toMatchObject({ accent: '#C0522A', dark: '#2A2D31' });
  });

  it('does not shorten a compound colour into a second decision', () => {
    const palette = extractBriefDirectives('Our brand is midnight blue.').palette;
    expect(palette.accent).toBe('#0B1F3A');
    expect(palette.dark).toBeUndefined();
  });

  it('leaves prose that merely contains a colour word alone', () => {
    // "White space" is a spacing instruction; reading it as a background colour
    // would repaint the page on the strength of it.
    const spacing = extractBriefDirectives('We want lots of white space.');
    expect(spacing.palette).toEqual({});
    expect(spacing.dials.density).toBe(16);
    expect(extractBriefDirectives('A blue-chip advisory firm with a white-label product.').palette).toEqual({});
  });

  it('says nothing when the brief said nothing', () => {
    const quiet = extractBriefDirectives('A championship golf course in Surrey. Members book tee times.');
    expect(quiet.any).toBe(false);
    expect(quiet.summary).toEqual([]);
    expect(directiveSummary(quiet)).toBe('');
  });

  it('only names typefaces the editor can actually offer', () => {
    for (const mention of findFontMentions('We like Fraunces, Inter and Comic Sans.')) {
      expect(FONT_NAMES).toContain(mention.name);
    }
    expect(fontByName('Comic Sans')).toBeNull();
    // People write these names loosely; the catalogue still has to recognise them.
    expect(fontByName('cormorant')?.name).toBe('Cormorant Garamond');
  });
});

describe('applying instructions to concepts', () => {
  const directives = extractBriefDirectives('Brand colour #0B3D2E, Fraunces headings, big typography, no animation.');

  it('writes them where a hand edit would have gone', () => {
    const concept = applyDirectivesToConcept({ archetypeKey: 'A', dialOverrides: { motion: 30 } }, directives);
    expect(concept.dialOverrides).toMatchObject({ headline: 92, motion: 0 });
    expect(concept.designOverrides.palette.accent).toBe('#0b3d2e');
    expect(concept.designOverrides.fontDisplay).toBe('Fraunces');
  });

  it('applies to all three, because a stated colour is a constraint not an axis', () => {
    const concepts = applyDirectivesToConcepts(
      [{ archetypeKey: 'A' }, { archetypeKey: 'B' }, { archetypeKey: 'C' }],
      directives,
    );
    expect(concepts).toHaveLength(3);
    for (const concept of concepts) {
      expect(concept.designOverrides.palette.accent).toBe('#0b3d2e');
      expect(concept.dialOverrides.headline).toBe(92);
    }
  });

  it('survives resolution into the design slice', () => {
    const concept = applyDirectivesToConcept(
      { archetypeKey: 'A', preset: 'calm', buttonStyle: 'solid-shift' },
      directives,
    );
    const design = resolveConceptDesign(concept, {
      archetypeStyle: { bg: '#fff', ink: '#111', accent: '#ed5b38', soft: '#eee', dark: '#111', fontBody: 'Inter', fontDisplay: 'Lora' },
    });
    // The archetype supplied the palette; the brief overruled the one role it named.
    expect(design.palette.accent).toBe('#0b3d2e');
    // Three-digit hexes are expanded on the way through: every consumer compares
    // colours as strings, and `#fff` and `#ffffff` are the same colour written
    // two ways, which is one way too many.
    expect(design.palette.bg).toBe('#ffffff');
    expect(design.fontDisplay).toBe('Fraunces');
    expect(design.headline).toBe(92);
    expect(design.motion).toBe(0);
  });

  it('reaches the deterministic concept planner, not just the AI path', () => {
    const result = conceptsFromBrief({
      brief: {
        industry: 'A family dental practice',
        audience: 'Local families',
        goal: 'Book online',
        offer: 'Routine and emergency care',
        tone: 'Calm and plain',
        notes: 'Our brand colour is #0B3D2E and we want big typography.',
      },
      archetypes: { A: { name: 'Editorial' }, B: { name: 'Direct' }, C: { name: 'Warm' }, D: { name: 'Calm' } },
      flows: [{ id: 'B3', name: 'Proof first', tagline: 'Prove it', bestFor: 'Services', families: ['hero', 'cards', 'cta'] }],
    });
    expect(result.concepts.length).toBeGreaterThan(0);
    for (const concept of result.concepts) {
      expect(concept.designOverrides.palette.accent).toBe('#0b3d2e');
      expect(concept.dialOverrides.headline).toBe(92);
    }
  });
});
