import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractShutterstockAssetId, createShutterstockProvider } from '../server/media/shutterstock-provider.mjs';
import { recommendFromBrief } from '../shared/brief/planner.mjs';
import { BriefUnderstandingSchema, ConceptSetSchema } from '../shared/brief/schemas.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'src/data/dst-data.json'), 'utf8'));
const assertions = [];

function check(label, fn) {
  try {
    const details = fn() || {};
    assertions.push({ label, passed: true, ...details });
  } catch (error) {
    assertions.push({ label, passed: false, error: error?.message || String(error) });
    throw error;
  }
}

async function checkAsync(label, fn) {
  try {
    const details = await fn() || {};
    assertions.push({ label, passed: true, ...details });
  } catch (error) {
    assertions.push({ label, passed: false, error: error?.message || String(error) });
    throw error;
  }
}

const pastedUrl = 'https://www.shutterstock.com/image-photo/rich-bourbon-whiskey-sits-textured-glass-2651493041?trackingId=319f137c-406e-4195-b835-f8f71c6aebc3&listId=searchResults';
check('Shutterstock full URL extracts the path asset id, not the tracking id', () => {
  assert.equal(extractShutterstockAssetId(pastedUrl), '2651493041');
  assert.equal(extractShutterstockAssetId('2282637127'), '2282637127');
  return { urlAssetId: '2651493041', bareAssetId: '2282637127' };
});

await checkAsync('Shutterstock asset lookup returns the watermarked image preview and avoids an unnecessary video request', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const parsed = new URL(url);
    if (parsed.pathname === '/v2/images/2651493041') {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            id: '2651493041',
            description: 'Rich bourbon whiskey in a textured glass',
            aspect: 1.5,
            assets: {
              preview_1500: { url: 'https://cdn.test/watermarked-2651493041.jpg', width: 1500, height: 1000 },
              large_thumb: { url: 'https://cdn.test/thumb-2651493041.jpg' },
            },
          };
        },
      };
    }
    return { ok: false, status: 404, async json() { return {}; } };
  };
  const provider = createShutterstockProvider({
    config: {
      shutterstockBaseUrl: 'https://api.shutterstock.com/v2',
      shutterstockApiToken: 'test-token',
      shutterstockClientId: '',
      shutterstockClientSecret: '',
      shutterstockTimeoutMs: 2000,
      shutterstockSafeSearch: true,
      mediaImageCount: 10,
      mediaVideoCount: 2,
    },
    fetchImpl,
    logger: { warn() {} },
  });
  const asset = await provider.assetById({ id: pastedUrl });
  assert.equal(asset.assetId, '2651493041');
  assert.equal(asset.kind, 'image');
  assert.equal(asset.src, 'https://cdn.test/watermarked-2651493041.jpg');
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]).pathname, '/v2/images/2651493041');
  return { calls: calls.length, assetId: asset.assetId, src: asset.src };
});

const brief = {
  projectName: 'Red Moon Motorcycles',
  clientName: 'Red Moon Motorcycles',
  industry: 'Premium motorcycle rental and adventure travel near the Grand Canyon',
  audience: 'International tourists and affluent experience seekers',
  goal: 'Book motorcycle rentals and generate qualified enquiries',
  offer: 'Premium non-Harley motorcycles, gear rental and guided experience packages',
  tone: 'Premium, cinematic, adventurous and modern',
  keywords: 'motorcycle, booking, travel, experience, ecommerce, premium',
  notes: 'Needs proof, product discovery, FAQs, testimonials, contact and strong CTAs.',
};
const recommended = recommendFromBrief({ brief, archetypes: catalog.archetypes, flows: catalog.flows });
check('Brief Brain returns five unique flow recommendations', () => {
  assert.equal(recommended.flows.length, 5);
  assert.equal(new Set(recommended.flows.map((flow) => flow.id)).size, 5);
  return { flowIds: recommended.flows.map((flow) => flow.id) };
});

/*
 * One catalogue, counted once.
 *
 * This check used to read the data file and add the ids it could scrape out of
 * one runtime injection block — and there were two. It reported 30 flows while
 * the running product had 35, which is where the "30-flow library" claim came
 * from. The catalogue is now the data file, the runtime adds nothing, and this
 * asserts exactly that.
 */
check('Flow catalogue is the data file, with five richer 10+ module journeys', () => {
  const richer = catalog.flows.filter((flow) => /^E[1-5]$/.test(flow.id));
  assert.equal(richer.length, 5);
  for (const flow of richer) assert.ok(flow.families.length >= 10, `${flow.id} is too short`);
  assert.equal(catalog.flows.length, 35);
  assert.equal(new Set(catalog.flows.map((flow) => flow.id)).size, 35);
  assert.equal(catalog.skill.flowCount, 35);
  const builderSource = fs.readFileSync(path.join(root, 'src/runtime/builder.js'), 'utf8');
  for (const injection of ['SBS_EXTRA_FLOWS', 'SBS_V3_FLOWS', 'DATA.flows=DATA.flows.concat', 'DATA.flows.push']) {
    assert.ok(!builderSource.includes(injection), `the runtime still injects flows via ${injection}`);
  }
  return {
    catalogFlows: catalog.flows.length,
    runtimeInjectedFlows: 0,
    richFlows: richer.map((flow) => ({ id: flow.id, modules: flow.families.length })),
  };
});

check('Brief Understanding schema accepts five recommendations', () => {
  const parsed = BriefUnderstandingSchema.parse({
    readback: { business: 'Business', audience: 'Audience', offer: 'Offer', goal: 'Goal', voice: 'Voice' },
    confidence: 0.9,
    missingFields: [],
    keywords: [],
    archetype: { key: 'A', reason: 'A valid reason for the selected direction.' },
    flows: catalog.flows.slice(0, 5).map((flow, index) => ({ id: flow.id, reason: `Useful recommendation ${index + 1}.`, fit: 0.9 - index * 0.05 })),
  });
  assert.equal(parsed.flows.length, 5);
  return { flows: parsed.flows.length };
});

check('Concept schema still caps concepts at three while allowing five flows', () => {
  const concepts = ['A', 'B', 'C'].map((key, index) => ({
    name: `Concept ${index + 1}`,
    archetypeKey: key,
    preset: 'calm',
    buttonStyle: 'solid-shift',
    dialOverrides: {},
    palette: {},
    paletteWhy: 'Fits the brief.',
    why: 'Provides a distinct design direction.',
  }));
  const parsed = ConceptSetSchema.parse({
    readback: { business: 'Business', audience: 'Audience', offer: 'Offer', goal: 'Goal', voice: 'Voice' },
    fields: { industry: '', audience: '', goal: '', offer: '', tone: '', keywords: '', clientName: '' },
    confidence: 0.9,
    missingFields: [],
    concepts,
    flows: catalog.flows.slice(0, 5).map((flow, index) => ({ id: flow.id, reason: `Useful recommendation ${index + 1}.`, fit: 0.9 - index * 0.05 })),
  });
  assert.equal(parsed.concepts.length, 3);
  assert.equal(parsed.flows.length, 5);
  return { concepts: parsed.concepts.length, flows: parsed.flows.length };
});

const builder = fs.readFileSync(path.join(root, 'src/runtime/builder.js'), 'utf8');
check('Simple builder renders the same design dial controls and WordPress export actions as Advanced', () => {
  const simpleStart = builder.indexOf('function v4SimpleBrief()');
  const simpleEnd = builder.indexOf('function v4ModeBadge()', simpleStart);
  const simpleBrief = builder.slice(simpleStart, simpleEnd);
  // Both are disclosures on this step now, so the panel helper is v4Panel; the
  // assertion is still that Simple offers the same two controls Advanced does.
  assert.ok(simpleBrief.includes("v4Panel('Design dials',v3DialSample(d)+v3DialGroups(d)"));
  assert.ok(simpleBrief.includes("v4Panel('Quick styles',v3PresetButtons(d)"));
  const reviewStart = builder.indexOf('function v4SimpleReview()');
  const reviewEnd = builder.indexOf('function v4BuildConceptExport', reviewStart);
  const review = builder.slice(reviewStart, reviewEnd);
  for (const artifact of ['navigation', 'footer', 'page', 'html', 'bundle']) assert.ok(review.includes(`data-export=\"${artifact}\"`), `missing ${artifact} export`);
  return { dialUi: true, exports: ['navigation', 'footer', 'page', 'html', 'bundle'] };
});

check('Page export embeds raw dials plus the complete resolved design-dial token contract', () => {
  assert.ok(builder.includes("theme.designDialTokens=Object.assign({},tokens);"));
  assert.ok(builder.includes("theme.designDialSchemaVersion='sbs-design-dials/1.0';"));
  return { schema: 'sbs-design-dials/1.0' };
});

const wpTheme = fs.readFileSync(path.join(root, 'wordpress-plugin/sbs-website-importer/includes/class-sbs-importer-theme.php'), 'utf8');
check('WordPress importer consumes the resolved design-dial tokens through an allowlisted mapping', () => {
  assert.ok(wpTheme.includes("$theme['designDialTokens']"));
  assert.ok(wpTheme.includes("'gridGap'"));
  assert.ok(wpTheme.includes("'motionDuration'"));
  assert.ok(wpTheme.includes("'measure'"));
  return { importerVersion: '1.0.1' };
});

const prompt = fs.readFileSync(path.join(root, 'server/ai/prompts/brief-architect.md'), 'utf8');
check('AI Brain prompt explicitly asks for exactly five flows', () => {
  assert.match(prompt, /exactly five/i);
  return {};
});

const result = {
  passed: assertions.every((entry) => entry.passed),
  version: '2.9.0',
  assertions,
  summary: {
    passed: assertions.filter((entry) => entry.passed).length,
    failed: assertions.filter((entry) => !entry.passed).length,
  },
};
const outDir = path.join(root, 'release-evidence');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'upgrade-qa.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
