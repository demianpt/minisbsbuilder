/**
 * The style factory.
 *
 * Expands `style-factory/style-seeds.json` into full `sbs-style/1.0` profiles,
 * validates every one against the schema, checks the catalogue for near-clones,
 * and emits:
 *
 *   src/data/style-library.json          the runtime catalogue the builder loads
 *   styles/<family>/<style>/style.json   the canonical per-style profile
 *   styles/<family>/<style>/DESIGN.md    generated documentation
 *   release-evidence/style-catalog-qa.json
 *   release-evidence/style-distinctness.json
 *
 * A seed carries the design decisions; everything derivable is derived here, so a
 * style is never described twice. Nothing invalid is written — the build fails
 * instead, because a profile the compiler has to guess about at render time is
 * worse than no profile.
 *
 *   node scripts/styles-build.mjs [--no-docs]
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALIGNMENTS,
  CONTAINERS,
  MEDIA_DOMINANCE,
  PADDINGS,
  PALETTE_ROLES,
  POLARITIES,
  RECIPE_FAMILIES,
  STYLE_FAMILIES,
  STYLE_FAMILY_IDS,
  STYLE_SCHEMA_VERSION,
  STYLE_STATUSES,
  SURFACE_TREATMENTS,
  VIEWPORT_EFFECTS,
  validateStyleProfile,
} from '../shared/styles/schema.mjs';
import { BUTTON_STYLE_IDS } from '../shared/design/button-styles.mjs';
import { FONT_NAMES } from '../shared/design/fonts.mjs';
import { distinctnessReport } from '../shared/styles/distinctness.mjs';
import { DIAL_KEYS } from '../shared/design/dials.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const writeDocs = !process.argv.includes('--no-docs');

const seeds = JSON.parse(readFileSync(resolve(root, 'style-factory/style-seeds.json'), 'utf8'));
const catalog = JSON.parse(readFileSync(resolve(root, 'src/data/dst-data.json'), 'utf8'));

const STYLE_VERSION = '1.0.0';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Family defaults under the style's own values. One level of nesting is enough. */
function merge(base, override) {
  const out = { ...(isObject(base) ? base : {}) };
  for (const [key, value] of Object.entries(isObject(override) ? override : {})) {
    out[key] = isObject(value) && isObject(out[key]) ? merge(out[key], value) : value;
  }
  return out;
}

/**
 * Pattern preferences are additive: a family says what the whole territory reaches
 * for and a style adds its own, rather than restating the family's list.
 */
function mergePreferences(familyPrefs, stylePrefs) {
  const base = isObject(familyPrefs) ? familyPrefs : {};
  const own = isObject(stylePrefs) ? stylePrefs : {};
  const union = (left = [], right = []) => [...new Set([...left, ...right])];
  const byFamily = { ...(base.byFamily || {}) };
  for (const [family, entry] of Object.entries(own.byFamily || {})) {
    byFamily[family] = {
      prefer: union(byFamily[family]?.prefer, entry.prefer),
      avoid: union(byFamily[family]?.avoid, entry.avoid),
    };
  }
  // A style that names a term as preferred overrides the family avoiding it.
  const prefer = union(base.prefer, own.prefer);
  const avoid = union(base.avoid, own.avoid).filter((term) => !prefer.includes(term));
  return { prefer, avoid, byFamily };
}

const profiles = [];
const failures = [];

for (const familyId of STYLE_FAMILY_IDS) {
  const family = seeds.families[familyId];
  if (!family) {
    failures.push({ style: familyId, issues: [{ path: '(family)', message: 'no seed for this family' }] });
    continue;
  }
  const defaults = family.defaults || {};
  for (const seed of family.styles || []) {
    const profile = {
      schemaVersion: STYLE_SCHEMA_VERSION,
      id: seed.id,
      familyId,
      name: seed.name,
      version: seed.version || STYLE_VERSION,
      status: seed.status || 'production',
      description: seed.description,
      philosophy: seed.philosophy,
      polarity: seed.polarity || defaults.polarity || 'light',
      tags: seed.tags,
      useCases: seed.useCases || defaults.useCases || [],
      industries: seed.industries || defaults.industries || [],
      palette: seed.palette,
      brandMapping: merge(defaults.brandMapping, seed.brandMapping),
      typography: merge(defaults.typography, seed.typography),
      radius: seed.radius,
      buttonStyle: seed.buttonStyle,
      dials: merge(defaults.dials, seed.dials),
      composition: merge(defaults.composition, seed.composition),
      patternPreferences: mergePreferences(defaults.patternPreferences, seed.patternPreferences),
      componentRecipes: merge(defaults.componentRecipes, seed.componentRecipes),
      dos: seed.dos,
      donts: seed.donts,
    };
    const result = validateStyleProfile(profile);
    if (!result.ok) {
      failures.push({ style: `${familyId}/${seed.id}`, issues: result.issues });
      continue;
    }
    profiles.push(result.profile);
  }
}

/* ---- structural checks the schema cannot express ---- */

const structural = [];
function structuralCheck(name, detail, passed) {
  structural.push({ name, detail, status: passed ? 'pass' : 'fail' });
}

structuralCheck('every family has exactly five styles',
  STYLE_FAMILY_IDS.map((id) => `${id}:${profiles.filter((p) => p.familyId === id).length}`).join(' '),
  STYLE_FAMILY_IDS.every((id) => profiles.filter((p) => p.familyId === id).length === 5));
structuralCheck('the catalogue holds fifty styles', `${profiles.length} profiles`, profiles.length === 50);
structuralCheck('every style id is unique',
  `${new Set(profiles.map((p) => `${p.familyId}/${p.id}`)).size} unique keys`,
  new Set(profiles.map((p) => `${p.familyId}/${p.id}`)).size === profiles.length);

// A recipe may only name a section family the engine can build, and a decoration
// motif the catalogue actually ships — otherwise the style silently does nothing.
const knownFamilies = new Set(Object.keys(catalog.defaultPatternByFamily));
const knownMotifs = new Set(Object.keys(catalog.decorations));
const badRecipes = [];
const badMotifs = [];
for (const profile of profiles) {
  for (const [family, recipe] of Object.entries(profile.componentRecipes || {})) {
    if (!knownFamilies.has(family)) badRecipes.push(`${profile.familyId}/${profile.id}:${family}`);
    if (recipe.decoration && !knownMotifs.has(recipe.decoration)) badMotifs.push(`${profile.familyId}/${profile.id}:${recipe.decoration}`);
  }
}
structuralCheck('every component recipe names a real section family', badRecipes.join(', ') || 'all recipes resolve', badRecipes.length === 0);
structuralCheck('every decoration motif exists in the catalogue', badMotifs.join(', ') || 'all motifs resolve', badMotifs.length === 0);

// Every style must take a position on all nine dials, or the engine falls back to
// a neutral 50 and the style stops being a style on that axis.
const missingDials = profiles.filter((profile) => DIAL_KEYS.some((key) => !Number.isFinite(Number(profile.dials[key]))));
structuralCheck('every style sets all nine dials', missingDials.map((p) => p.id).join(', ') || 'all nine set on all fifty', missingDials.length === 0);

const distinctness = distinctnessReport(profiles);
structuralCheck('no two styles are near-clones',
  distinctness.ok
    ? `closest pair ${distinctness.closest[0]?.a} / ${distinctness.closest[0]?.b} at ${distinctness.closest[0]?.score}`
    : distinctness.failures.map((pair) => `${pair.a}~${pair.b}@${pair.score}`).join(', '),
  distinctness.ok);

/* ---- documentation ---- */

function designDocument(profile) {
  const family = STYLE_FAMILIES.find((entry) => entry.id === profile.familyId);
  const row = (label, value) => `| ${label} | ${value} |`;
  return `# ${profile.name}

**${family?.name || profile.familyId} → ${profile.id}** · \`${profile.familyId}/${profile.id}\` · v${profile.version} · ${profile.status}

${profile.description}

## Design philosophy

${profile.philosophy}

## Colour

| Role | Value |
| --- | --- |
${['bg', 'ink', 'accent', 'soft', 'dark'].map((role) => row(role, `\`${profile.palette[role]}\``)).join('\n')}

Polarity: **${profile.polarity}**. Brand mapping: **${profile.brandMapping.strategy}**${profile.brandMapping.protectedRoles.length ? `, protecting ${profile.brandMapping.protectedRoles.join(', ')}` : ''}.

## Typography

| Property | Value |
| --- | --- |
${row('Display', profile.typography.display)}
${row('Body', profile.typography.body)}
${row('Scale', profile.typography.scale)}
${row('Display case', profile.typography.displayCase)}
${row('Display tracking', profile.typography.displayTracking)}

## Design dials

| Dial | Value |
| --- | --- |
${DIAL_KEYS.map((key) => row(key, profile.dials[key])).join('\n')}

## Composition

| Property | Value |
| --- | --- |
${Object.entries(profile.composition).map(([key, value]) => row(key, value)).join('\n')}
${row('Radius', profile.radius)}
${row('Button family', profile.buttonStyle)}

## Pattern preferences

Prefers: ${profile.patternPreferences.prefer.map((term) => `\`${term}\``).join(', ') || '—'}

Avoids: ${profile.patternPreferences.avoid.map((term) => `\`${term}\``).join(', ') || '—'}

${Object.entries(profile.patternPreferences.byFamily || {}).length
  ? `Per section family:\n\n${Object.entries(profile.patternPreferences.byFamily).map(([family_, entry]) => `- **${family_}** — prefers ${entry.prefer.join(', ') || '—'}; avoids ${entry.avoid.join(', ') || '—'}`).join('\n')}`
  : 'No per-family overrides.'}

## Component recipes

${Object.entries(profile.componentRecipes || {}).length
  ? `| Section | Container | Padding | Inverted | Effect | Columns | Decoration |\n| --- | --- | --- | --- | --- | --- | --- |\n${Object.entries(profile.componentRecipes).map(([family_, recipe]) => `| ${family_} | ${recipe.container || '—'} | ${recipe.paddingTop || '—'} / ${recipe.paddingBottom || '—'} | ${recipe.inverted === undefined ? '—' : recipe.inverted} | ${recipe.viewport || '—'} | ${recipe.columns || '—'} | ${recipe.decoration || '—'} |`).join('\n')}`
  : 'This style uses the engine defaults for every section family.'}

## Use cases

${profile.useCases.map((useCase) => `- ${useCase}`).join('\n')}

Industry affinity: ${profile.industries.join(', ')}.

Tags: ${profile.tags.join(', ')}.

## Do

${profile.dos.map((entry) => `- ${entry}`).join('\n')}

## Don't

${profile.donts.map((entry) => `- ${entry}`).join('\n')}

---

Generated by \`npm run styles:build\` from \`style-factory/style-seeds.json\`. Edit the
seed, not this file.
`;
}

/**
 * The contract in JSON Schema form.
 *
 * `shared/styles/schema.mjs` is the authority — it is what actually validates a
 * profile. This is generated from the same constants on every build so the two
 * cannot drift, and exists so a designer can author a style, or wire up editor
 * completion, without running the toolchain.
 */
function jsonSchema() {
  const dial = { type: 'integer', minimum: 0, maximum: 100 };
  const enumOf = (values, description) => ({ type: 'string', enum: [...values], ...(description ? { description } : {}) });
  const dials = Object.fromEntries(DIAL_KEYS.map((key) => [key, dial]));
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: `https://sbs.digitalsilk.com/schema/${STYLE_SCHEMA_VERSION}.json`,
    title: `SBS style profile (${STYLE_SCHEMA_VERSION})`,
    description: 'One design language, as data. STYLE-CONSTITUTION.md defines what each permitted value means. Generated by npm run styles:build from shared/styles/schema.mjs, which is the authoritative validator.',
    type: 'object',
    additionalProperties: false,
    required: [
      'schemaVersion', 'id', 'familyId', 'name', 'version', 'status', 'description', 'philosophy',
      'polarity', 'tags', 'useCases', 'industries', 'palette', 'brandMapping', 'typography',
      'radius', 'buttonStyle', 'dials', 'composition', 'patternPreferences', 'dos', 'donts',
    ],
    properties: {
      schemaVersion: { const: STYLE_SCHEMA_VERSION },
      id: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
      familyId: enumOf(STYLE_FAMILY_IDS),
      name: { type: 'string', minLength: 2, maxLength: 48 },
      version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
      status: enumOf(STYLE_STATUSES, 'Only "production" appears in the strategist picker.'),
      description: { type: 'string', minLength: 20, maxLength: 400 },
      philosophy: { type: 'string', minLength: 20, maxLength: 600 },
      polarity: enumOf(POLARITIES, 'Whether the body canvas is lighter or darker than the ink.'),
      tags: { type: 'array', minItems: 3, maxItems: 12, items: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' } },
      useCases: { type: 'array', minItems: 2, maxItems: 8, items: { type: 'string', minLength: 3, maxLength: 60 } },
      industries: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' } },
      palette: {
        type: 'object', additionalProperties: false, required: [...PALETTE_ROLES],
        properties: Object.fromEntries(PALETTE_ROLES.map((role) => [role, { type: 'string', pattern: '^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$' }])),
      },
      brandMapping: {
        type: 'object', additionalProperties: false, required: ['strategy'],
        properties: {
          strategy: enumOf(['accentOnly', 'accentAndSurface', 'full'], 'How far the client brand may enter the palette.'),
          protectedRoles: { type: 'array', maxItems: 5, items: enumOf(PALETTE_ROLES), description: 'Roles the brand may never take, whatever the brief says.' },
        },
      },
      typography: {
        type: 'object', additionalProperties: false, required: ['display', 'body', 'scale', 'displayCase', 'displayTracking'],
        properties: {
          display: enumOf(FONT_NAMES),
          body: enumOf(FONT_NAMES),
          scale: { type: 'number', minimum: 0.8, maximum: 1.35 },
          displayCase: enumOf(['none', 'upper']),
          displayTracking: { type: 'number', minimum: -0.05, maximum: 0.24 },
        },
      },
      radius: { type: 'string', pattern: '^\\d+px$' },
      buttonStyle: enumOf(BUTTON_STYLE_IDS),
      dials: { type: 'object', additionalProperties: false, required: [...DIAL_KEYS], properties: dials, description: 'All nine are required: an unset dial falls back to a neutral 50 and the style stops being a style on that axis.' },
      composition: {
        type: 'object', additionalProperties: false,
        required: ['alignment', 'containerBias', 'mediaDominance', 'surfaceTreatment', 'asymmetry', 'fullBleedBias'],
        properties: {
          alignment: enumOf(ALIGNMENTS),
          containerBias: enumOf(CONTAINERS),
          mediaDominance: enumOf(MEDIA_DOMINANCE),
          surfaceTreatment: enumOf(SURFACE_TREATMENTS),
          asymmetry: dial,
          fullBleedBias: dial,
        },
      },
      patternPreferences: {
        type: 'object', additionalProperties: false,
        description: 'Terms, not pattern ids: matched against the profile the ranker builds from each pattern catalogue entry, so a preference survives the catalogue growing.',
        properties: {
          prefer: { type: 'array', maxItems: 24, items: { type: 'string', minLength: 2, maxLength: 40 } },
          avoid: { type: 'array', maxItems: 24, items: { type: 'string', minLength: 2, maxLength: 40 } },
          byFamily: {
            type: 'object', additionalProperties: false,
            propertyNames: { enum: [...RECIPE_FAMILIES] },
            patternProperties: {
              '.*': {
                type: 'object', additionalProperties: false,
                properties: {
                  prefer: { type: 'array', maxItems: 12, items: { type: 'string', minLength: 2, maxLength: 40 } },
                  avoid: { type: 'array', maxItems: 12, items: { type: 'string', minLength: 2, maxLength: 40 } },
                },
              },
            },
          },
        },
      },
      componentRecipes: {
        type: 'object', additionalProperties: false,
        propertyNames: { enum: [...RECIPE_FAMILIES] },
        patternProperties: {
          '.*': {
            type: 'object', additionalProperties: false,
            properties: {
              container: enumOf(CONTAINERS),
              paddingTop: enumOf(PADDINGS),
              paddingBottom: enumOf(PADDINGS),
              inverted: { type: 'boolean' },
              viewport: enumOf(VIEWPORT_EFFECTS),
              columns: { type: 'integer', minimum: 1, maximum: 6 },
              columnsMobile: { type: 'integer', minimum: 1, maximum: 2 },
              decoration: { type: 'string', maxLength: 40, description: 'A motif id the pattern catalogue ships.' },
              decorationOpacity: { type: 'number', minimum: 0, maximum: 0.4 },
            },
          },
        },
      },
      dos: { type: 'array', minItems: 2, maxItems: 8, items: { type: 'string', minLength: 6, maxLength: 140 } },
      donts: { type: 'array', minItems: 2, maxItems: 8, items: { type: 'string', minLength: 6, maxLength: 140 } },
    },
  };
}

/* ---- emit ---- */

if (failures.length || structural.some((entry) => entry.status === 'fail')) {
  for (const failure of failures) {
    console.error(`INVALID  ${failure.style}`);
    for (const issue of failure.issues) console.error(`         ${issue.path}: ${issue.message}`);
  }
  for (const entry of structural.filter((item) => item.status === 'fail')) {
    console.error(`FAIL     ${entry.name} — ${entry.detail}`);
  }
  console.error(`\nNothing written. ${profiles.length} valid, ${failures.length} invalid.`);
  process.exitCode = 1;
} else {
  const library = {
    schemaVersion: 'sbs-style-library/1.0',
    styleSchemaVersion: STYLE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    generatedFrom: 'style-factory/style-seeds.json',
    families: STYLE_FAMILIES.map((family) => ({
      ...family,
      styleIds: profiles.filter((profile) => profile.familyId === family.id).map((profile) => profile.id),
    })),
    styles: profiles,
  };
  writeFileSync(resolve(root, 'src/data/style-library.json'), `${JSON.stringify(library, null, 2)}\n`);
  writeFileSync(resolve(root, 'style-factory/STYLE.schema.json'), `${JSON.stringify(jsonSchema(), null, 2)}\n`);

  const stylesDirectory = resolve(root, 'styles');
  rmSync(stylesDirectory, { recursive: true, force: true });
  for (const profile of profiles) {
    const directory = resolve(stylesDirectory, profile.familyId, profile.id);
    mkdirSync(directory, { recursive: true });
    writeFileSync(resolve(directory, 'style.json'), `${JSON.stringify(profile, null, 2)}\n`);
    if (writeDocs) writeFileSync(resolve(directory, 'DESIGN.md'), designDocument(profile));
  }

  const evidence = resolve(root, 'release-evidence');
  mkdirSync(evidence, { recursive: true });
  writeFileSync(resolve(evidence, 'style-catalog-qa.json'), `${JSON.stringify({
    schemaVersion: 'sbs-style-catalog-qa/1.0',
    generatedAt: library.generatedAt,
    totals: {
      families: STYLE_FAMILY_IDS.length,
      styles: profiles.length,
      perFamily: Object.fromEntries(STYLE_FAMILY_IDS.map((id) => [id, profiles.filter((p) => p.familyId === id).length])),
      production: profiles.filter((p) => p.status === 'production').length,
    },
    checks: structural,
  }, null, 2)}\n`);
  writeFileSync(resolve(evidence, 'style-distinctness.json'), `${JSON.stringify({
    schemaVersion: 'sbs-style-distinctness/1.0',
    generatedAt: library.generatedAt,
    ...distinctness,
  }, null, 2)}\n`);

  for (const entry of structural) console.log(`${entry.status === 'pass' ? 'PASS' : 'FAIL'}  ${entry.name} — ${entry.detail}`);
  console.log(`\n${profiles.length} styles across ${STYLE_FAMILY_IDS.length} families.`);
  console.log(`Closest pair: ${distinctness.closest[0]?.a} / ${distinctness.closest[0]?.b} at ${distinctness.closest[0]?.score} (minimum ${distinctness.minimum}).`);
  console.log(`Weakest axes: ${distinctness.weakestAxis.slice(0, 3).map((entry) => `${entry.axis} ${entry.mean}`).join(', ')}.`);
  console.log('Wrote src/data/style-library.json, styles/**, release-evidence/style-*.json');
}
