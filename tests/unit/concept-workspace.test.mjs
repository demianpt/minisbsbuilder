import { describe, expect, it } from 'vitest';
import {
  CONCEPT_IDS,
  CONCEPT_SLICE_KEYS,
  bindProject,
  conceptHasDraftChanges,
  conceptIdFrom,
  conceptIsolationDiff,
  duplicateConcept,
  generateConceptSet,
  getActiveConcept,
  getActiveConceptId,
  getConcept,
  hasGeneratedConceptSet,
  hydrateProject,
  listGeneratedConcepts,
  migrateProject,
  projectToJson,
  resetConcept,
  serializeProject,
  setActiveConcept,
  touchConcept,
} from '../../shared/concepts/workspace.mjs';
import { createConceptHistory } from '../../shared/concepts/history.mjs';

/** A 2.2.x project: one website, everything on the project object. */
function legacyProject() {
  return {
    id: 'concept-legacy-1',
    client: 'Red Moon Motorcycles',
    brief: { projectName: 'Red Moon', clientName: 'Red Moon Motorcycles', goal: 'Book test rides' },
    brain: { status: 'ready', understanding: { source: 'ai' } },
    media: { assets: [{ assetId: 'a1' }, { assetId: 'a2' }], assignments: [{ slotKey: 'hero.0', assetId: 'a1' }] },
    design: { archetype: 'A', density: 20, palette: { bg: '#fff', ink: '#111', accent: '#ff0000' }, fontDisplay: 'Manrope' },
    flowId: 'B3',
    header: { variant: 'standard', logoText: 'Red Moon', nav: [['Bikes', '#bikes']] },
    footer: { variant: 'editorial', legal: 'Red Moon' },
    sections: [
      { id: 'section-hero-1', family: 'hero', patternId: 'p1', content: { title: 'Ride' }, node: { id: 'n1', component: 'ds-blocks/dst-banner', children: [{ id: 'n2', component: 'ds-blocks/dst-heading', children: [] }] } },
      { id: 'section-cards-2', family: 'cards', patternId: 'p2', content: { title: 'Range' }, node: { id: 'n3', component: 'ds-blocks/dst-cards', children: [] } },
    ],
  };
}

function migrated() {
  const project = legacyProject();
  migrateProject(project);
  return project;
}

/** Generates three real workspaces with deliberately different design values. */
function threeConcepts() {
  const project = migrated();
  generateConceptSet(project, {
    variants: [
      { id: 'v1', name: 'Core', variantType: 'core' },
      { id: 'v2', name: 'Brand-led', variantType: 'brand-led' },
      { id: 'v3', name: 'Expressive', variantType: 'expressive' },
    ],
    applyVariant(concept, _variant, index) {
      concept.design.density = [20, 70, 45][index];
      concept.design.fontDisplay = ['Manrope', 'Fraunces', 'Space Grotesk'][index];
      concept.design.palette = { ...concept.design.palette, accent: ['#ff0000', '#0000ff', '#00ff00'][index] };
      concept.sections[0].patternId = ['A', 'B', 'C'][index];
    },
  });
  return project;
}

describe('concept workspace migration', () => {
  it('turns a 2.2.x project into V1 without altering it', () => {
    const before = legacyProject();
    const project = legacyProject();
    const report = migrateProject(project);

    expect(report.migrated).toBe(true);
    expect(report.from).toBe('sbs-project/2.x');
    const v1 = getConcept(project, 'v1');
    expect(v1.status).toBe('generated');
    expect(v1.design).toEqual(before.design);
    expect(v1.flowId).toBe('B3');
    expect(v1.header).toEqual(before.header);
    expect(v1.footer).toEqual(before.footer);
    expect(v1.sections).toEqual(before.sections);
    expect(v1.mediaAssignments).toEqual(before.media.assignments);
  });

  it('leaves V2 and V3 empty so old client work is never silently altered', () => {
    const project = migrated();
    expect(getConcept(project, 'v2').status).toBe('empty');
    expect(getConcept(project, 'v3').status).toBe('empty');
    expect(listGeneratedConcepts(project).map((concept) => concept.id)).toEqual(['v1']);
    expect(hasGeneratedConceptSet(project)).toBe(false);
  });

  it('keeps the shared project state at project level', () => {
    const project = migrated();
    expect(project.brief.clientName).toBe('Red Moon Motorcycles');
    expect(project.brain.status).toBe('ready');
    expect(project.media.assets).toHaveLength(2);
    expect(project.conceptSet.schemaVersion).toBe('sbs-concept-set/1.0');
  });

  it('is idempotent', () => {
    const project = migrated();
    const first = projectToJson(project);
    const report = migrateProject(project);
    expect(report.migrated).toBe(false);
    expect(projectToJson(project)).toBe(first);
  });

  it('adopts 2.2.x simple.concepts as full workspaces, preserving their design', () => {
    const project = legacyProject();
    project.simple = {
      active: 1,
      concepts: [
        { slot: 'V1', name: 'Quiet', archetypeKey: 'A', preset: 'calm', buttonStyle: 'solid-shift', dialOverrides: { density: 22 }, designOverrides: {} },
        { slot: 'V2', name: 'Burgundy Editorial', archetypeKey: 'C', preset: 'bold', buttonStyle: 'sweep-fill', dialOverrides: { density: 68 }, designOverrides: { palette: { accent: '#5B0E20' }, fontDisplay: 'Fraunces' } },
        { slot: 'V3', name: 'Bold Exhibition', archetypeKey: 'K', preset: 'expressive', buttonStyle: 'pill-glow', dialOverrides: { density: 44 }, designOverrides: { palette: { accent: '#00A37A' } } },
      ],
    };
    const report = migrateProject(project);

    expect(report.legacySimpleConcepts).toBe(3);
    expect(hasGeneratedConceptSet(project)).toBe(true);
    expect(getConcept(project, 'v2').name).toBe('Burgundy Editorial');
    expect(getConcept(project, 'v2').design.palette.accent).toBe('#5B0E20');
    expect(getConcept(project, 'v2').design.fontDisplay).toBe('Fraunces');
    expect(getConcept(project, 'v2').design.density).toBe(68);
    expect(getConcept(project, 'v3').design.palette.accent).toBe('#00A37A');
    // V1 is still the live project, untouched by the adoption.
    expect(getConcept(project, 'v1').design.palette.accent).toBe('#ff0000');
    expect(getActiveConceptId(project)).toBe('v2');
    // Each adopted concept gets its own copy of the page, not a shared reference.
    getConcept(project, 'v2').sections[0].content.title = 'Changed';
    expect(getConcept(project, 'v1').sections[0].content.title).toBe('Ride');
    expect(getConcept(project, 'v3').sections[0].content.title).toBe('Ride');
  });
});

describe('project binding', () => {
  it('reads and writes the active concept through the legacy project keys', () => {
    const project = threeConcepts();
    setActiveConcept(project, 'v2');
    expect(project.design.density).toBe(70);
    expect(project.design).toBe(getActiveConcept(project).design);

    project.design.density = 71;
    expect(getConcept(project, 'v2').design.density).toBe(71);
    expect(getConcept(project, 'v1').design.density).toBe(20);
    expect(getConcept(project, 'v3').design.density).toBe(45);
  });

  it('routes a wholesale slice replacement into the active concept', () => {
    const project = threeConcepts();
    setActiveConcept(project, 'v3');
    project.header = { variant: 'transparent', nav: [] };
    expect(getConcept(project, 'v3').header.variant).toBe('transparent');
    expect(getConcept(project, 'v1').header.variant).toBe('standard');
    expect(getConcept(project, 'v2').header.variant).toBe('standard');
  });

  it('binds media placements per concept while the asset pool stays shared', () => {
    const project = threeConcepts();
    setActiveConcept(project, 'v1');
    project.media.assignments = [{ slotKey: 'hero.0', assetId: 'image-A' }];
    setActiveConcept(project, 'v2');
    project.media.assignments = [{ slotKey: 'hero.0', assetId: 'image-B' }];
    setActiveConcept(project, 'v3');
    project.media.assignments = [{ slotKey: 'hero.0', assetId: 'image-C' }];

    setActiveConcept(project, 'v1');
    expect(project.media.assignments[0].assetId).toBe('image-A');
    setActiveConcept(project, 'v2');
    expect(project.media.assignments[0].assetId).toBe('image-B');
    setActiveConcept(project, 'v3');
    expect(project.media.assignments[0].assetId).toBe('image-C');
    expect(project.media.assets).toHaveLength(2);
  });

  it('bumps the concept revision on a slice write', () => {
    const project = threeConcepts();
    setActiveConcept(project, 'v2');
    const before = getConcept(project, 'v2').revision;
    project.flowId = 'C2';
    expect(getConcept(project, 'v2').revision).toBeGreaterThan(before);
    expect(getConcept(project, 'v1').flowId).toBe('B3');
  });

  it('refuses to activate a concept that has not been generated', () => {
    const project = migrated();
    expect(setActiveConcept(project, 'v2')).toBe('v1');
    expect(getActiveConceptId(project)).toBe('v1');
  });

  it('resolves ids from slots, indexes and loose input', () => {
    expect(conceptIdFrom('V2')).toBe('v2');
    expect(conceptIdFrom('v3')).toBe('v3');
    expect(conceptIdFrom(0)).toBe('v1');
    expect(conceptIdFrom('2')).toBe('v2');
    expect(conceptIdFrom('nonsense')).toBe('');
  });
});

describe('concept generation', () => {
  it('creates three generated workspaces from one baseline', () => {
    const project = threeConcepts();
    expect(hasGeneratedConceptSet(project)).toBe(true);
    expect(listGeneratedConcepts(project).map((concept) => concept.slot)).toEqual(['V1', 'V2', 'V3']);
    expect(listGeneratedConcepts(project).map((concept) => concept.variantType)).toEqual(['core', 'brand-led', 'expressive']);
  });

  it('gives every concept its own section identities', () => {
    const project = threeConcepts();
    const ids = CONCEPT_IDS.flatMap((id) => getConcept(project, id).sections.map((section) => section.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(getConcept(project, 'v2').sections[0].id).toMatch(/--v2$/);
    expect(getConcept(project, 'v2').sections[0].node.id).toMatch(/--v2-b1$/);
  });

  it('shares no mutable structure between concepts', () => {
    const project = threeConcepts();
    const v1 = getConcept(project, 'v1');
    const v2 = getConcept(project, 'v2');
    for (const key of CONCEPT_SLICE_KEYS) {
      if (typeof v1[key] !== 'object' || v1[key] === null) continue;
      expect(v1[key]).not.toBe(v2[key]);
    }
    expect(v1.sections[0].node).not.toBe(v2.sections[0].node);
  });

  it('records the generated workspace so a reset has something to restore', () => {
    const project = threeConcepts();
    setActiveConcept(project, 'v2');
    project.design.density = 99;
    project.sections.pop();
    expect(getConcept(project, 'v2').sections).toHaveLength(1);

    expect(resetConcept(project, 'v2')).toBe(true);
    expect(getConcept(project, 'v2').design.density).toBe(70);
    expect(getConcept(project, 'v2').sections).toHaveLength(2);
    expect(getConcept(project, 'v1').design.density).toBe(20);
  });
});

describe('concept isolation', () => {
  it('changes nothing outside the concept being edited', () => {
    const project = threeConcepts();
    const before = projectToJson(project);

    setActiveConcept(project, 'v1');
    project.design.density = 33;
    project.design.fontDisplay = 'Inter';
    project.flowId = 'A1';
    project.sections[0].content.title = 'V1 only';
    project.sections.push({ id: 'extra', family: 'cta', content: {}, node: { id: 'x', children: [] } });
    project.header.logoText = 'V1 logo';
    project.footer.legal = 'V1 legal';
    project.page.metaTitle = 'V1 meta';
    project.media.assignments = [{ slotKey: 'hero.0', assetId: 'only-v1' }];

    const diff = conceptIsolationDiff(before, projectToJson(project));
    expect(diff.changed).toEqual(['v1']);
    expect(diff.isolated).toBe(true);
  });

  it('survives repeated switching with every value intact', () => {
    const project = threeConcepts();
    const expected = {
      v1: { density: 20, font: 'Manrope', accent: '#ff0000', pattern: 'A' },
      v2: { density: 70, font: 'Fraunces', accent: '#0000ff', pattern: 'B' },
      v3: { density: 45, font: 'Space Grotesk', accent: '#00ff00', pattern: 'C' },
    };
    for (const id of ['v1', 'v2', 'v3', 'v1', 'v3', 'v2']) {
      setActiveConcept(project, id);
      expect(project.design.density).toBe(expected[id].density);
      expect(project.design.fontDisplay).toBe(expected[id].font);
      expect(project.design.palette.accent).toBe(expected[id].accent);
      expect(project.sections[0].patternId).toBe(expected[id].pattern);
    }
  });

  it('deep compares untouched concepts before and after an edit', () => {
    const project = threeConcepts();
    const snapshotOf = (id) => JSON.stringify(getConcept(project, id));
    const v2Before = snapshotOf('v2');
    const v3Before = snapshotOf('v3');

    setActiveConcept(project, 'v1');
    for (const key of ['density', 'expressiveness', 'motion']) project.design[key] = 7;
    project.sections.forEach((section) => { section.content.title = 'rewritten'; });
    project.header.nav.push(['New', '#new']);

    expect(snapshotOf('v2')).toBe(v2Before);
    expect(snapshotOf('v3')).toBe(v3Before);
  });

  it('copies a concept without linking the two', () => {
    const project = threeConcepts();
    expect(duplicateConcept(project, 'v1', 'v3')).toBe(true);
    expect(getConcept(project, 'v3').design.density).toBe(20);

    setActiveConcept(project, 'v3');
    project.design.density = 88;
    project.sections[0].content.title = 'V3 diverged';
    expect(getConcept(project, 'v1').design.density).toBe(20);
    expect(getConcept(project, 'v1').sections[0].content.title).toBe('Ride');
    expect(getConcept(project, 'v3').sections[0].id).toMatch(/--v3$/);
  });

  it('never copies publish state between concepts', () => {
    const project = threeConcepts();
    const v1 = getConcept(project, 'v1');
    v1.publish = { ...v1.publish, shareId: 'share-v1', status: 'published', publishedRevision: v1.revision };
    duplicateConcept(project, 'v1', 'v2');
    expect(getConcept(project, 'v2').publish.shareId).toBe('');
    expect(getConcept(project, 'v2').publish.status).toBe('unpublished');
  });
});

describe('serialization', () => {
  it('writes the canonical concept set once', () => {
    const project = threeConcepts();
    const serialized = serializeProject(project);
    for (const key of CONCEPT_SLICE_KEYS) expect(serialized).not.toHaveProperty(key);
    expect(Object.keys(serialized.conceptSet.concepts)).toEqual(['v1', 'v2', 'v3']);
    expect(serialized.media).not.toHaveProperty('assignments');
  });

  it('round-trips all three concepts through storage', () => {
    const project = threeConcepts();
    setActiveConcept(project, 'v2');
    project.design.density = 71;
    project.sections[0].content.title = 'V2 headline';

    const restored = hydrateProject(projectToJson(project));
    expect(getActiveConceptId(restored)).toBe('v2');
    expect(restored.design.density).toBe(71);
    expect(restored.sections[0].content.title).toBe('V2 headline');
    setActiveConcept(restored, 'v1');
    expect(restored.design.density).toBe(20);
    expect(restored.sections[0].content.title).toBe('Ride');
    setActiveConcept(restored, 'v3');
    expect(restored.design.fontDisplay).toBe('Space Grotesk');
    // Binding survives the round trip: writes still land on the active concept.
    restored.design.density = 46;
    expect(getConcept(restored, 'v3').design.density).toBe(46);
    expect(getConcept(restored, 'v1').design.density).toBe(20);
  });

  it('re-binds a project parsed as plain JSON', () => {
    const project = threeConcepts();
    const plain = JSON.parse(projectToJson(project));
    expect(plain.design).toBeUndefined();
    bindProject(plain);
    expect(plain.design.density).toBe(20);
  });
});

describe('publish metadata', () => {
  it('reports draft changes once the concept moves past the published revision', () => {
    const project = threeConcepts();
    const concept = getConcept(project, 'v1');
    concept.publish = { ...concept.publish, status: 'published', publishedRevision: concept.revision };
    expect(conceptHasDraftChanges(concept)).toBe(false);
    touchConcept(concept);
    expect(conceptHasDraftChanges(concept)).toBe(true);
  });
});

describe('concept-aware history', () => {
  it('undoes only the concept that was edited', () => {
    const project = threeConcepts();
    const history = createConceptHistory();

    setActiveConcept(project, 'v1');
    history.checkpoint(project);
    project.sections[0].content.title = 'V1 headline edited';

    setActiveConcept(project, 'v2');
    history.checkpoint(project);
    project.sections[1].content.title = 'V2 cards edited';

    expect(history.undo(project)).toBe(true);
    expect(getConcept(project, 'v2').sections[1].content.title).toBe('Range');
    expect(getConcept(project, 'v1').sections[0].content.title).toBe('V1 headline edited');
  });

  it('keeps a separate stack per concept and survives switching', () => {
    const project = threeConcepts();
    const history = createConceptHistory();

    setActiveConcept(project, 'v1');
    history.checkpoint(project);
    project.design.density = 21;
    setActiveConcept(project, 'v3');
    expect(history.canUndo(project)).toBe(false);
    history.checkpoint(project);
    project.design.density = 46;

    setActiveConcept(project, 'v1');
    expect(history.canUndo(project)).toBe(true);
    history.undo(project);
    expect(getConcept(project, 'v1').design.density).toBe(20);
    expect(getConcept(project, 'v3').design.density).toBe(46);
  });

  it('redoes within one concept', () => {
    const project = threeConcepts();
    const history = createConceptHistory();
    setActiveConcept(project, 'v2');
    history.checkpoint(project);
    project.design.density = 77;
    history.undo(project);
    expect(project.design.density).toBe(70);
    expect(history.canRedo(project)).toBe(true);
    history.redo(project);
    expect(project.design.density).toBe(77);
    expect(getConcept(project, 'v1').design.density).toBe(20);
  });

  it('restores shared project state with the step that changed it', () => {
    const project = threeConcepts();
    const history = createConceptHistory();
    setActiveConcept(project, 'v1');
    history.checkpoint(project);
    project.brief.goal = 'Sell more bikes';
    project.design.density = 25;
    history.undo(project);
    expect(project.brief.goal).toBe('Book test rides');
    expect(project.design.density).toBe(20);
  });

  it('reports its depth per concept', () => {
    const project = threeConcepts();
    const history = createConceptHistory();
    setActiveConcept(project, 'v1');
    history.checkpoint(project);
    history.checkpoint(project);
    setActiveConcept(project, 'v2');
    history.checkpoint(project);
    expect(history.report()).toEqual({ v1: { undo: 2, redo: 0 }, v2: { undo: 1, redo: 0 } });
  });
});
