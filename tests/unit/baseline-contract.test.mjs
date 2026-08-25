import { describe, expect, it } from 'vitest';
import catalog from '../../src/data/dst-data.json';

describe('baseline DST catalog contract', () => {
  it('retains the complete registered catalog and existing archetypes', () => {
    expect(catalog.patterns).toHaveLength(156);
    /*
     * One canonical catalogue. This expected 15 while the data file shipped 20
     * and the runtime pushed 15 more on at boot, so the assertion was measuring
     * neither the data nor the product. All 35 now live in the data file and the
     * runtime adds none.
     */
    expect(catalog.flows).toHaveLength(35);
    expect(catalog.skill.flowCount).toBe(35);
    expect(new Set(catalog.flows.map((flow) => flow.id)).size).toBe(35);
    for (const flow of catalog.flows) {
      expect(flow.families.length, flow.id).toBeGreaterThan(0);
      for (const family of flow.families) expect(catalog.defaultPatternByFamily, `${flow.id}/${family}`).toHaveProperty(family);
    }
    expect(Object.keys(catalog.archetypes)).toEqual([
      'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
    ]);
    expect(Object.keys(catalog.registry)).toContain('ds-blocks/dst-wrapper');
    expect(Object.keys(catalog.registry)).toContain('ds-blocks/c-btn');
  });
});
