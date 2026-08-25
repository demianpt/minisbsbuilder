/**
 * Concept-isolation QA.
 *
 * Proves at the object level what the browser suite proves through the UI: an
 * edit to one concept workspace changes that concept and nothing else, a
 * round-trip through storage returns all three exactly, and undo stays inside the
 * concept that was edited.
 *
 * Runs without a browser or a WordPress installation, and writes its findings to
 * `release-evidence/concept-isolation-qa.json` so a release has something to show
 * rather than a claim.
 *
 *   node scripts/qa-concepts.mjs
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONCEPT_IDS,
  CONCEPT_SLICE_KEYS,
  conceptIsolationDiff,
  duplicateConcept,
  generateConceptSet,
  getActiveConceptId,
  getConcept,
  hasGeneratedConceptSet,
  hydrateProject,
  listGeneratedConcepts,
  migrateProject,
  projectToJson,
  resetConcept,
  setActiveConcept,
} from '../shared/concepts/workspace.mjs';
import { createConceptHistory } from '../shared/concepts/history.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(resolve(root, 'src/data/dst-data.json'), 'utf8'));

const checks = [];
function check(name, detail, passed) {
  checks.push({ name, detail, status: passed ? 'pass' : 'fail' });
  return passed;
}

/** A project in the pre-3.0 shape, the way a saved session arrives. */
function legacyProject() {
  const flow = catalog.flows.find((entry) => entry.id === 'B3') || catalog.flows[0];
  return {
    id: 'qa-project',
    client: 'Red Moon Motorcycles',
    brief: { projectName: 'Red Moon', clientName: 'Red Moon Motorcycles', goal: 'Book test rides' },
    brain: { status: 'ready' },
    media: { assets: [{ assetId: 'a1' }, { assetId: 'a2' }, { assetId: 'a3' }], assignments: [] },
    design: { archetype: 'A', density: 50, palette: { bg: '#ffffff', ink: '#111111', accent: '#b5412b' }, fontDisplay: 'Inter' },
    flowId: flow.id,
    header: { variant: 'standard', logoText: 'Red Moon', nav: [['Bikes', '#bikes']] },
    footer: { variant: 'editorial', legal: 'Red Moon' },
    sections: flow.families.map((family, index) => ({
      id: `section-${family}-${index}`,
      family,
      patternId: catalog.defaultPatternByFamily[family],
      content: { title: `${family} headline` },
      layout: { columnsMobile: 1 },
      node: { id: `n-${index}`, component: 'ds-blocks/dst-banner', children: [{ id: `n-${index}-c`, component: 'ds-blocks/dst-heading', children: [] }] },
    })),
  };
}

/* ---- the flow catalogue is one place ---- */
const flowIds = catalog.flows.map((flow) => flow.id);
check('flow catalogue has no duplicate ids', `${flowIds.length} flows`, new Set(flowIds).size === flowIds.length);
check('flow catalogue count matches the skill manifest',
  `data ${catalog.flows.length} · skill ${catalog.skill.flowCount}`,
  catalog.flows.length === catalog.skill.flowCount);
check('every flow family has a default pattern',
  'all families resolve',
  catalog.flows.every((flow) => flow.families.every((family) => catalog.defaultPatternByFamily[family])));

/* ---- migration ---- */
const before = legacyProject();
const project = legacyProject();
const migration = migrateProject(project);
check('a 2.x project migrates to the concept set', `from ${migration.from}`, migration.migrated === true);
check('V1 keeps the migrated project exactly',
  'design, flow, globals and sections compared',
  JSON.stringify(getConcept(project, 'v1').design) === JSON.stringify(before.design)
  && getConcept(project, 'v1').flowId === before.flowId
  && JSON.stringify(getConcept(project, 'v1').sections) === JSON.stringify(before.sections)
  && JSON.stringify(getConcept(project, 'v1').header) === JSON.stringify(before.header)
  && JSON.stringify(getConcept(project, 'v1').footer) === JSON.stringify(before.footer));
check('V2 and V3 stay empty until generated',
  'old client work is never silently altered',
  getConcept(project, 'v2').status === 'empty' && getConcept(project, 'v3').status === 'empty');

/* ---- generation ---- */
const variantDesign = [
  { density: 20, fontDisplay: 'Manrope', accent: '#c81e1e' },
  { density: 70, fontDisplay: 'Fraunces', accent: '#1e40c8' },
  { density: 45, fontDisplay: 'Space Grotesk', accent: '#1ec86a' },
];
generateConceptSet(project, {
  applyVariant(concept, _variant, index) {
    Object.assign(concept.design, {
      density: variantDesign[index].density,
      fontDisplay: variantDesign[index].fontDisplay,
      palette: { ...concept.design.palette, accent: variantDesign[index].accent },
    });
    concept.sections[0].patternId = `pattern-${index}`;
  },
});
check('three concepts are generated', `${listGeneratedConcepts(project).length} of 3`, hasGeneratedConceptSet(project));

const sectionIds = CONCEPT_IDS.flatMap((id) => getConcept(project, id).sections.map((section) => section.id));
check('no module identity is shared between concepts', `${sectionIds.length} module ids`, new Set(sectionIds).size === sectionIds.length);
check('no mutable structure is shared between concepts',
  'every object slice compared by reference',
  CONCEPT_SLICE_KEYS.every((key) => {
    const a = getConcept(project, 'v1')[key];
    if (!a || typeof a !== 'object') return true;
    return a !== getConcept(project, 'v2')[key] && a !== getConcept(project, 'v3')[key];
  }));

/* ---- isolation: edit each concept, diff the whole project ---- */
const isolation = {};
for (const conceptId of CONCEPT_IDS) {
  setActiveConcept(project, conceptId);
  const snapshot = projectToJson(project);
  project.design.density = 33;
  project.design.fontDisplay = 'Isolation Test';
  project.flowId = 'A1';
  project.sections[0].content.title = `${conceptId} only`;
  project.sections[0].layout.columnsMobile = 2;
  project.header.logoText = `${conceptId} logo`;
  project.footer.legal = `${conceptId} legal`;
  project.page.metaTitle = `${conceptId} meta`;
  project.media.assignments = [{ slotKey: 'hero.0', assetId: `asset-${conceptId}` }];
  const diff = conceptIsolationDiff(snapshot, projectToJson(project));
  isolation[conceptId] = diff;
  check(`editing ${conceptId.toUpperCase()} changes only ${conceptId.toUpperCase()}`,
    `changed: ${diff.changed.join(', ') || 'none'}`,
    diff.changed.length === 1 && diff.changed[0] === conceptId);
}

/* ---- media placements are per concept, the pool is shared ---- */
check('media placements stay with the concept that made them',
  CONCEPT_IDS.map((id) => `${id}:${getConcept(project, id).mediaAssignments[0]?.assetId}`).join(' '),
  CONCEPT_IDS.every((id) => getConcept(project, id).mediaAssignments[0]?.assetId === `asset-${id}`));
check('the media pool stays at project level', `${project.media.assets.length} assets`, project.media.assets.length === 3);

/* ---- lossless switching ---- */
let switchingHolds = true;
const expected = Object.fromEntries(CONCEPT_IDS.map((id) => [id, JSON.stringify(getConcept(project, id))]));
for (const id of ['v1', 'v3', 'v2', 'v1', 'v3', 'v2', 'v1']) {
  setActiveConcept(project, id);
  if (JSON.stringify(getConcept(project, id)) !== expected[id]) switchingHolds = false;
}
check('switching concepts loses nothing', 'seven switches across three concepts', switchingHolds);

/* ---- persistence round trip ---- */
setActiveConcept(project, 'v2');
const stored = projectToJson(project);
const restored = hydrateProject(stored);
check('all three concepts survive storage',
  'byte-for-byte comparison after a round trip',
  projectToJson(restored) === stored);
check('the concept that was open is restored', `active ${getActiveConceptId(restored)}`, getActiveConceptId(restored) === 'v2');
check('the restored project is still bound to its active concept',
  'a write lands on the active concept only',
  (() => {
    restored.design.density = 91;
    return getConcept(restored, 'v2').design.density === 91 && getConcept(restored, 'v1').design.density !== 91;
  })());

/* ---- per-concept history ---- */
const history = createConceptHistory();
setActiveConcept(project, 'v1');
history.checkpoint(project);
project.sections[0].content.title = 'V1 edited again';
setActiveConcept(project, 'v2');
check('a concept with no edits has nothing to undo', 'V2 stack empty', history.canUndo(project) === false);
history.checkpoint(project);
project.sections[0].content.title = 'V2 edited again';
const v1TitleBeforeUndo = getConcept(project, 'v1').sections[0].content.title;
history.undo(project);
check('undo applies to the concept on screen',
  `V2 restored, V1 still "${getConcept(project, 'v1').sections[0].content.title}"`,
  getConcept(project, 'v2').sections[0].content.title !== 'V2 edited again'
  && getConcept(project, 'v1').sections[0].content.title === v1TitleBeforeUndo);
setActiveConcept(project, 'v1');
check('each concept keeps its own stack', JSON.stringify(history.report()), history.canUndo(project) === true);

/* ---- deliberate operations ---- */
const v1Publish = { shareId: 'share-v1', status: 'published', publishedRevision: 4, publishedAt: '2026-01-01T00:00:00.000Z', updatedAt: '', expiresAt: null };
getConcept(project, 'v1').publish = v1Publish;
duplicateConcept(project, 'v1', 'v3');
check('copying a concept copies the workspace',
  'design compared',
  getConcept(project, 'v3').design.density === getConcept(project, 'v1').design.density);
check('copying a concept never copies its public link',
  `V3 shareId "${getConcept(project, 'v3').publish.shareId}"`,
  getConcept(project, 'v3').publish.shareId === '' && getConcept(project, 'v3').publish.status === 'unpublished');
setActiveConcept(project, 'v2');
project.design.density = 5;
check('resetting a concept restores its generated workspace',
  'V2 reset, V1 untouched',
  resetConcept(project, 'v2') && getConcept(project, 'v2').design.density === variantDesign[1].density
  && getConcept(project, 'v1').design.density === 33);

const failures = checks.filter((entry) => entry.status === 'fail');
const report = {
  schemaVersion: 'sbs-concept-isolation-qa/1.0',
  generatedAt: new Date().toISOString(),
  conceptModel: 'sbs-concept-set/1.0',
  catalog: {
    patterns: catalog.patterns.length,
    flows: catalog.flows.length,
    archetypes: Object.keys(catalog.archetypes).length,
    registeredComponents: Object.keys(catalog.registry).filter((key) => key.startsWith('ds-blocks/')).length,
  },
  totals: { checks: checks.length, passed: checks.length - failures.length, failed: failures.length },
  isolation,
  history: history.report(),
  checks,
};

const outputDirectory = resolve(root, 'release-evidence');
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(resolve(outputDirectory, 'concept-isolation-qa.json'), `${JSON.stringify(report, null, 2)}\n`);

for (const entry of checks) {
  console.log(`${entry.status === 'pass' ? 'PASS' : 'FAIL'}  ${entry.name} — ${entry.detail}`);
}
console.log(`\n${report.totals.passed}/${report.totals.checks} checks passed. Report: release-evidence/concept-isolation-qa.json`);
process.exitCode = failures.length ? 1 : 0;
