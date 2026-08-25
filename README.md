# SBS Page Builder

Two interfaces over one engine. A **simple builder** turns one paragraph of brief
and one chosen style into three complete design concepts a strategist can show a
client in ten minutes; an **advanced builder** edits the same concepts with 154
registered patterns, nine design dials, ten button families and every registered
DST attribute. Both draw on a library of **50 production styles across 10
families**, both edit the same three concept workspaces, and both export the same
WordPress importer artifacts.

## Fast start

```bash
npm install
npm run dev
```

Open the Vite URL printed in Terminal, normally `http://127.0.0.1:5173`.

`npm run dev` starts both processes: the Vite client on `:5173` and the Brief
Brain server on `:4174`. The client proxies `/api` to the server. Running only
`npm run dev:client` leaves the AI features unavailable — the built-in planner
answers instead, and the editor says so.

On macOS you can also double-click `START-MAC.command`. The launcher installs packages when needed, starts the application, and opens the builder.

## Deploying

Full runbook: **[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)**. The short version.

This is **one stateless Node process**, not a static site.
[`server/index.mjs`](server/index.mjs) serves the built client bundle *and*
answers `/api/brief/*` on the same port and the same origin — so there is no
second service, no static host, no CORS surface and no database. Publishing only
`dist/` to a CDN would silently delete every AI feature.

```bash
npm ci && npm run build      # build
npm run check:env            # validate the environment before starting
npm start                    # serve bundle + API on one port
```

| | |
| --- | --- |
| Runtime | Node **20.19+**, pinned to 22.15.1 in `.nvmrc` |
| Production dependencies | four packages — `express`, `compression`, `dotenv`, `zod` |
| Runtime file set | `dist/`, `server/`, `shared/`, `package.json`, prod `node_modules` — ~12 MB installed |
| Persistent state | **none.** No database, no volume, no writable path, no session affinity |
| Outbound | `ollama.com` and `api.shutterstock.com`, both optional |
| Liveness | `GET /healthz` — no upstream call |
| Readiness | `GET /readyz` — `503` when the client bundle is missing |

Three ways in, all prepared in this repository:

| Path | Command |
| --- | --- |
| **Docker Compose** (recommended) | `cp deploy/env.staging.example .env.staging && docker compose up -d --build` |
| **systemd on the host** | `deploy/deploy.sh` — atomic release swap, health gate, automatic rollback |
| **Any PaaS** | build `npm ci && npm run build`, start `npm start`, health check `/healthz` |

Supporting files: [`Dockerfile`](Dockerfile),
[`docker-compose.yml`](docker-compose.yml),
[`deploy/nginx/minisbsbuilder.dsstaging4.com.conf`](deploy/nginx/minisbsbuilder.dsstaging4.com.conf),
[`deploy/systemd/minisbsbuilder.service`](deploy/systemd/minisbsbuilder.service),
[`deploy/deploy.sh`](deploy/deploy.sh),
[`deploy/env.staging.example`](deploy/env.staging.example).

Push to `main` runs [`ci.yml`](.github/workflows/ci.yml) and then
[`deploy-staging.yml`](.github/workflows/deploy-staging.yml), which deploys and
confirms the public URL reports healthy. The four SSH secrets it needs are listed
in the runbook.

### The three settings that break a deployment

Everything else has a working default. These do not, and two of them fail in a
way that looks like a product bug rather than a configuration mistake.

1. **`HOST=0.0.0.0`.** The server defaults to loopback. In a container or behind
   a proxy it then starts, logs happily, and is unreachable.
2. **`PUBLIC_APP_ORIGIN`** is an allowlist, not a label. `enforceOrigin()` in
   [`server/routes/brief.mjs`](server/routes/brief.mjs) rejects any request whose
   `Origin` header does not match it *exactly*, and browsers send `Origin` on
   same-origin `POST`s too. Wrong value — a trailing slash is enough — and the
   site loads perfectly while every AI action returns `403`.
3. **The proxy read timeout must exceed `OLLAMA_TIMEOUT_MS` (180s).** Drafting a
   whole page's copy is one request waiting on a language model. nginx's default
   is 60s, which turns a working job into a `504` two thirds of the way in. The
   supplied site config sets 200s on `/api/`.

`npm run check:env` fails on the first, fails on a malformed second, and prints
the rest of the resolved configuration without printing a single secret value.
Run it on the box before starting the service.

### What is already handled

- **gzip on every text response** — the bundle is 2,315 KB uncompressed and
  **392 KB on the wire**. If the proxy also compresses, it must pass the app's
  `Content-Encoding` through; the supplied nginx config sets `gzip off`.
- **`immutable` year-long caching on content-hashed assets, `no-store` on
  `index.html`** which names them — the post-deploy white screen, prevented.
- **Graceful `SIGTERM`**: close the listener, let in-flight AI jobs finish, drop
  idle keep-alive sockets after 10s so a restart cannot hang a deploy.
- **`keepAliveTimeout` 65s**, deliberately longer than the nginx pool in front,
  so a reused socket is never one the app is closing.
- **Per-visitor rate limiting** — correct only when `TRUST_PROXY` names the
  proxy, or every visitor shares one bucket. Held by
  `tests/integration/server-runtime.test.mjs`.
- **Credentials never reach the browser.** `publicConfig()` in
  [`server/config.mjs`](server/config.mjs) is the entire browser-facing surface
  and reports whether each credential exists, never its value.
- **Sizing**: 512 MB of RAM is enough. The process waits on a language model
  rather than computing, holds only an in-memory cache, and scales horizontally
  with no coordination.

## WordPress handoff

The final step provides:

- `navigation.json`
- `footer.json`
- `page.json`
- standalone `website.html`
- a **Complete project bundle ZIP** containing all four files

The WordPress plugin source is in:

```text
wordpress-plugin/sbs-website-importer/
```

A ready-to-upload plugin ZIP is included in:

```text
deliverables/sbs-website-importer.zip
```

Install it through **Plugins → Add New → Upload Plugin**, activate it, then open **SBS Importer** in WordPress. Upload either the complete project ZIP or an individual JSON artifact.

The importer can:

- create a new page or replace/append to an existing page;
- import page modules as native Digital Silk Gutenberg block comments;
- create a WordPress navigation menu and editable Header template part;
- create an editable Footer template part;
- apply exported DST design tokens in the front end and block editor;
- optionally copy supported remote images into the WordPress Media Library.

The Digital Silk theme/block package must be active so the imported `ds-blocks/*` blocks expose their native Gutenberg inspector options.

See [`WORDPRESS-IMPORTER-QUICKSTART.md`](WORDPRESS-IMPORTER-QUICKSTART.md).

## DST editing model

Each SBS module keeps its registered block tree and pattern provenance. Module controls cover, where supported by the selected block:

- containers and side padding;
- desktop, tablet, and mobile columns;
- responsive gaps and spans;
- horizontal/vertical card orientation;
- backgrounds, media, overlays, blur, and blend modes;
- alignment and responsive alignment;
- borders, radius, shadows, motion, and decorations;
- all remaining registered settings through the advanced block inspector.

The JSON export is the source of truth for WordPress import. The standalone HTML is for visual review only.

## Two builders

The switch is in the top bar and the whole chrome follows it — sidebar heading,
step list and accent colour all state which builder you are in.

| | Simple builder | Advanced builder |
| --- | --- | --- |
| Steps | 4 | 5 |
| Brief | One textarea | Nine individual fields |
| Direction | Three AI-designed concepts, switchable at any step, plus all nine Design Dials | Archetype grid, nine dials, ten button families |
| Page flow | The five best flows for the brief | The recommendations plus the full 35-flow catalogue |
| Modules | Basic view, three tabs | Basic **and** Extended view, plus the DST tree |
| Export | Page, navigation, footer, standalone HTML, project ZIP, optional concept JSON | Page, navigation, footer, standalone HTML, project ZIP |

### The intended journey

1. **Simple builder.** Write one paragraph. The brain reads it and designs three
   concepts — archetype, palette, type, all nine dials and a button family each —
   and the builder turns each one into a complete concept workspace. Pick one of
   five recommended flows, let the brain write the copy, and export the same
   WordPress-ready artifacts as Advanced (plus an optional concept JSON).
2. **Show the client.** The V1/V2/V3 pills sit over the live preview in both
   builders and on every step, so all three proposals are one click away for the
   whole conversation.
3. **Advanced builder.** Same project, same active concept, full toolset. A
   pattern swap or a mobile column count set in Advanced is there when you go back
   to Simple, because both are editing the same concept workspace.

## The Style Library

Ten style families, five styles each — **50 production style profiles** — in
`src/data/style-library.json`, built from `style-factory/style-seeds.json`.

| Family | Styles |
| --- | --- |
| Technology | Product Keynote Minimal · Precision SaaS · Glass AI · Technical Grid · Dark Product Lab |
| Luxury | Quiet Luxury · Modern Heritage · Editorial Luxury · Dark Prestige · Gallery Luxury |
| Editorial | Contemporary Magazine · Swiss Editorial · Culture Journal · Oversized Editorial · Newsroom Modern |
| Corporate | Executive Precision · Human Corporate · Financial Authority · Global Consulting · Institutional Modern |
| Commerce | Product Editorial · Bold Retail · Premium Commerce · Lifestyle Shop · Conversion Minimal |
| Hospitality | Boutique Escape · Resort Editorial · Culinary Luxury · Urban Hotel · Organic Retreat |
| Automotive / Mobility | Performance Machine · Grand Touring · Technical Automotive · Heritage Garage · Future Mobility |
| Health / Wellness | Clinical Calm · Human Wellness · Premium Medical · Natural Health · Precision Health |
| Creative / Culture | Portfolio Minimal · Art Gallery · Studio Bold · Cultural Experimental · Motion Creative |
| Experimental | Neo Brutalist · Retro Future · Digital Aurora · Geometric System · Typographic Maximalist |

Style keys are stable slugs — `creative-culture/art-gallery`,
`automotive-mobility/performance-machine` — and a concept records the one it
resolves from, so an export says which style produced it.

### A style is not a palette preset

That rule is enforced, not aspirational. A profile has to take a position on every
axis the engine can vary, and choosing one changes all of them:

| A style decides | Which means |
| --- | --- |
| palette, display and body type, radius, button family | the page is recoloured and reset |
| **all nine Design Dials** | density, measure, headline scale, brand emphasis, surface definition, corner softness, image presence, movement and expression |
| **composition** | alignment, container bias, media dominance, surface treatment, asymmetry, full-bleed bias |
| **component recipes, per section family** | container, vertical rhythm, inversion, arrival effect, column counts, decorative motif |
| **pattern preferences** | which of the 154 patterns each band actually uses |

The last row is the one that matters most. Choosing Art Gallery and then Precision
SaaS does not recolour the same page — it re-selects the modules, because the ranker
in `shared/styles/compiler.mjs` scores every candidate pattern against that style's
preferred and avoided terms. A pattern the strategist picked by hand is never
re-selected: an explicit choice always wins.

`shared/styles/distinctness.mjs` scores all 1,225 pairs across those axes with
**palette weighted lowest**, and `npm run styles:build` refuses to emit a catalogue
containing a near-clone. Three pairs were rejected during authoring and had to be
genuinely redesigned rather than nudged past the threshold.

### The picker

Family, then style, in **both builders** — Advanced Step 02 and Simple Step 01. The
AI may badge a recommendation; the human chooses. The 13 original A–M archetypes
remain as the older, coarser path, and picking one clears the concept's style
reference rather than leaving it claiming a style it no longer follows.

### One style, three concepts

`Generate V1/V2/V3` builds the three concepts from the chosen style, so a client is
comparing interpretations of one design language rather than three unrelated sites:

| Slot | Variation | What differs |
| --- | --- | --- |
| V1 | Core | The style exactly as authored |
| V2 | Brand-led | The client's colours as far as the style's own `brandMapping` allows, brand emphasis raised |
| V3 | Expressive | The axes the style is already strongest on pushed — scale, movement, expression |

The display typeface never changes between the three. A protected palette role is
never taken by a brand colour: a gallery style whose canvas turns burgundy has
stopped being a gallery style.

Precedence, in order: **style default → variation → brief/brand directives →
concept-specific manual edits**. Manual edits are last and authoritative.

### The factory

```bash
npm run styles:build      # seeds -> profiles, validate, distinctness, docs, evidence
npm run styles:validate   # the same checks without regenerating documentation
```

Emits `src/data/style-library.json`, `styles/<family>/<style>/{style.json,DESIGN.md}`,
`style-factory/STYLE.schema.json` and the two `release-evidence/style-*.json`
reports. Nothing invalid is ever written — the build fails instead, because a
profile the compiler has to guess about at render time is worse than no profile.

Authoring lives in two files: `style-factory/style-seeds.json` for the design
decisions and [`style-factory/STYLE-CONSTITUTION.md`](style-factory/STYLE-CONSTITUTION.md)
for what every permitted value means. Adding style #51 is a seed plus a passing
build.

## Three concept workspaces

A project holds exactly three concept workspaces — **V1**, **V2** and **V3** —
and each one is a complete, independently editable website proposal.

| | Owned by each concept | Shared by the project |
| --- | --- | --- |
| | style, palette, fonts, all nine Design Dials, button family | client and project identity |
| | page flow, module sequence, pattern choices | the original brief |
| | section content, layout, effects, responsive settings | the AI brief analysis |
| | media *placements* | the media *pool* (Shutterstock previews) |
| | navigation and footer | project notes |
| | page metadata and SEO fields | |
| | publish state and revision | |

Switching concepts is lossless in both directions. There is nothing to save on
the way out and nothing to re-derive on the way in: `bindProject` in
[`shared/concepts/workspace.mjs`](shared/concepts/workspace.mjs) installs
accessors for `design`, `sections`, `header`, `footer`, `flowId`, `page`, `style`
and `manualOverrides` that resolve through `conceptSet.activeConceptId` on every
read and every write. The editor has been writing into the active concept all
along, so activating another one is a pointer move.

That is a deliberate replacement for the 2.2.x model, in which a concept owned a
slice of `project.design` and a switch copied values out of the live project and
back into the concept they came from. Anything the capture list did not name — a
section, a pattern choice, a mobile column count — was shared between all three
concepts whether you wanted it to be or not.

Consequences worth knowing:

- **Undo and redo are per concept.** Editing V1, switching to V2, editing V2 and
  pressing undo undoes the V2 change. Switching concepts is navigation, not an
  edit, and pushes nothing onto either stack.
- **Exports always come from the concept you are editing**, and every artifact
  names it: `concept.conceptId`, `slot`, `variantType`, `revision`, the resolved
  style reference and the nine dial values. Export filenames carry the slot too,
  so two proposals cannot be confused in a downloads folder.
- **The first flow you choose applies to all three concepts**, because three
  proposals built on three different structures are not a comparison. Once a
  concept has been edited it keeps its own, and a later flow change reaches only
  the concept on screen.
- **Reset and copy are deliberate.** The Review step's *Concept workspaces* panel
  can reset one concept to the workspace it was generated as, or copy one concept
  over another. Both confirm first, and neither ever copies publish state.
- **Older projects still load.** A pre-3.0 project becomes V1 exactly as it was,
  with V2 and V3 left empty — nothing is re-derived, because re-resolving somebody's
  approved work against today's defaults would change it. A 2.2.x
  `project.simple.concepts` set is different: those really were three proposals,
  so their palettes, fonts, buttons and dial nudges are carried onto the matching
  slot and a full workspace is built around each.

## The AI Brief Brain

One model (`OLLAMA_MODEL`, by default `gemma4:31b` on Ollama Cloud) performs
three jobs, all driven by the Step 01 brief:

| Job | Endpoint | What it does |
| --- | --- | --- |
| Understand | `POST /api/brief/understand` | Reads the brief back field by field, then recommends one DST visual archetype and the five best page flows, with a reason for each |
| Write | `POST /api/brief/content` | Drafts the copy for every section in the current flow |
| Plan | `POST /api/brief/outline` | Maps a typed page outline ("1. Hero 2. Before after image gallery 3. A pricing") onto registered DST section families |
| Design | `POST /api/brief/concepts` | The simple builder's first step: reads one paragraph and returns three complete concepts plus the five best flows |
| Split | `POST /api/brief/expand` | Splits that paragraph into the advanced builder's nine brief fields, for the import |

Three rules hold across every Brief Brain job:

1. **The model never invents structure.** It chooses only from the archetype
   keys, flow ids and section families this server sends it, and every answer is
   validated against a schema in `shared/brief/schemas.mjs` before it can reach a
   project. Anything off-contract is discarded.
2. **The model never invents facts.** Where a section structurally needs a number
   or a name, the draft contains an instruction to replace it, not a plausible
   figure.
3. **The editor is never blocked on inference.** Every job has a deterministic
   twin in `shared/brief/planner.mjs`. If the model is unconfigured, unreachable,
   slow or off-contract, the planner answers and the UI labels the result as
   coming from the built-in planner rather than the model.

### One button, in the simple builder

**Read my brief and build 3 concepts** runs four jobs in one press: it designs
the three concepts, writes the copy for every section and puts it on the page,
finds the imagery and places it, and only then clones the finished page into V1,
V2 and V3 so each resolves its own design. Forking last is what makes the three
comparable — all three carry the same real copy and pictures and differ only in
design.

The copy and the imagery jobs are best-effort: a brief that produced concepts is
kept even when the copywriter times out, and stock imagery is separately
configured and often absent. The panel reports the counts it achieved and names
anything it could not do.

The advanced builder keeps its separate write → review → apply sequence. That
review step is the reason it exists: it runs on pages that already carry
hand-written copy.

The Simple builder exposes those same nine Design Dials directly, so strategists can make global changes without switching to Advanced.

A concept names a *quick style* and may nudge individual dials from there, rather
than inventing nine raw numbers. The model picks a named mood far more reliably
than a coherent set of integers, and the result stays inspectable and editable
after the handoff. Three concepts that share an archetype are rejected outright:
one option shown three times is not a choice.

The hosted model does not reliably honour Ollama's `format` constraint, so each
prompt carries an explicit output example and each schema has a `coerce*`
function that repairs the flattened, renamed shapes the model actually returns.
That repair layer is covered by `tests/unit/brief-schemas.test.mjs`.

Configuration lives in `.env` (see `.env.example`; for a deployed environment,
`deploy/env.staging.example`). The API key is server-side only and never reaches
the browser; `publicConfig()` in `server/config.mjs` is the entire browser-facing
surface, asserted by `tests/security/config.test.mjs`.

The server needs no AI credential to run. Unconfigured, `provider.status()`
short-circuits without a network call, `/api/brief/status` reports
`configured: false`, the editor disables what it cannot do, and every job is
answered by the deterministic planner. That is why `/healthz` never probes the
model: an Ollama outage is not an unhealthy deployment.

### A brief that arrives as a file

Drag a PDF, a Word `.docx`, an `.rtf` or any text file anywhere over the builder
and drop it: the words are read and become the brief. Both builders take one — the
simple builder puts the paragraph in its brief box, the advanced builder runs it
through the **Split** job above and keeps the document verbatim as the internal
note.

Every format is read in the browser with no dependency and no upload — a `.docx`
is a ZIP of XML and a PDF's text lives in deflated content streams, so
`DecompressionStream` is the whole toolchain. The client's document never leaves
the machine.

A PDF is the hard one, and `shared/brief/pdf.mjs` treats it as such: a PDF stores
instructions to draw glyphs, and what a byte means depends on the font in force —
which in a real Word export is a `WinAnsiEncoding` font for the body and an
`Identity-H` subset for every heading and link, where a pair of bytes is a glyph
number. So it finds the objects (including those packed inside compressed object
streams, where modern exporters keep their fonts), walks the page tree, resolves
each font's `/ToUnicode` table, and follows the pen so a sentence Word split into
six placements comes back as one line.

What it cannot read, it names. A scanned PDF has no text in it and says so rather
than filling the brief with glyph codes; a legacy `.doc` is refused with the fix.
A drop of several files places the ones it could read, each under its own name, and
reports the rest.

The brief the model reads is capped at **16,000 characters** — one number in
`shared/brief/schemas.mjs`, used by the textarea, the requests and the server —
which is a whole discovery document rather than its first two pages.

Held by `tests/unit/brief-pdf.test.mjs` and `tests/unit/brief-documents.test.mjs`,
which build real PDF and ZIP containers to read back, and
`tests/browser/brief-documents.spec.mjs`, which prints a PDF with the browser's
own engine and drops it into the builder.

## Design system controls

**Step 02** owns the whole visual system:

- **13 DST visual archetypes** set the starting palette and type pairing.
- **Ten button families** — Solid Shift, Sweep Fill, Offset Block, Pill Glow,
  Magnetic Arrow, Split Reveal, Corner Cut, Neon Trace, Depth Press and Ink Wipe —
  each define the primary action, the secondary action and the text link together,
  with their own hover behaviour. Defined once in
  `shared/design/button-styles.mjs` and used by the editor swatches, the live
  preview and the theme export, so a swatch cannot drift from the page. Label
  colours are derived, never assumed: `--sbs-on-accent` and `--sbs-on-ink` ask
  which of white or the page's own ink can be read on the fill that button state
  actually paints, because a pale accent with a hard-coded white label is a button
  with no visible text.
- **Five quick styles** set all nine dials at once.
- **Five navigation layouts and five footer layouts** — `HEADER_VARIANTS` and
  `FOOTER_VARIANTS` in `src/runtime/builder.js`. Both global parts step from the
  preview exactly like a module: hover the navigation or the footer and the arrows
  (or ← →) walk through the layouts, one undo per press, repainted in place. The
  navigation's overlay also cycles the phone takeover style. The editor selects,
  the preview CSS and the exported navigation and footer JSON all read the same two
  catalogues, so there is one answer to what layout a project is on.
- **35 page flows** in one canonical catalogue, in `src/data/dst-data.json`. The
  runtime adds none: two later layers used to push their own flows onto the array
  at boot and every loaded project pushed its typed flows on top, so the number of
  flows in the product depended on which projects a session had opened. A flow a
  strategist types stays on their project and is joined in by `allFlows()`.
- **Nine design dials** in `shared/design/dials.mjs`: Density, Reading width,
  Headline size, Brand colour emphasis, Surface definition, Corner softness,
  Image presence, Movement and Expression. Each dial owns a set of CSS custom
  properties *and* a discrete band (for example `data-motion-level="still"`),
  because a purely continuous value is not noticeable enough to feel like a
  control. Movement at 0 switches motion off completely.

Every dial is written into the WordPress theme export (`theme.designDials`,
`theme.layout`, `theme.typography`, `theme.motion`), so an imported page keeps
the rhythm the preview showed.

## Module editor views

**Step 04** opens in **Basic view**: background, content width, space above and
below, how many items per row, how the section arrives, and the registered
decorative motif — in plain language, with nothing that can break a layout.
**Extended view** exposes every registered DST attribute the builder can set,
including per-breakpoint columns, gaps, card and list geometry, overlays and
scroll-driven effects. The choice persists per user.

### Copy over a photograph

Any section that paints a picture behind its copy gets a wash over it: the
palette's own `dark` at **60%**, with the section's copy inverted to suit, since at
that strength the wash *is* the ground rather than a tint. It is a condition, not a
list of families — a pattern that paints its own wash keeps it exactly, a colour a
pattern carries but never paints does not count as one, and a default wash follows
the brand when the palette moves while an edited one is never touched again. Held
by `tests/browser/photo-scrim.spec.mjs`, which audits all 154 patterns.

### A picture, dragged onto the module

Every picture tile in the editor — the found-imagery gallery, the module's own
picker, the placeholder library — can be dragged onto any module in the preview.
The slot is read from what the pointer is over: a card takes that card's picture, a
split takes that half's, a band with no picture under the pointer takes its
background. It is the same slot list the stock-imagery job fills, so a slot that
can be dropped on is a slot the pattern really renders. The module is outlined and
the exact slot ringed while the pointer is over them; one drop is one undo; a
module of people refuses the drop and says why. Held by
`tests/browser/media-drop.spec.mjs`.

## Tests

The handoff-specific checks do not require a browser or a WordPress installation:

```bash
npm run test:handoff
```

They verify:

- the browser-generated project ZIP contains the four exact artifacts;
- the artifacts contain valid JSON/HTML;
- page JSON serializes to native Gutenberg block comments;
- navigation receives a WordPress menu ID;
- footer shorthand expands into editable DST blocks;
- all 154 pattern trees can be serialized;
- design-token CSS contains no external `url()` values.

### Concept isolation

```bash
npm run qa:concepts
```

Twenty-four object-level checks: a 2.x project migrates to V1 without being
altered, three workspaces are generated from one baseline with no shared mutable
structure, editing one concept changes only that concept, seven switches across
three concepts lose nothing, all three survive a storage round trip byte for byte,
undo stays inside the concept on screen, and reset and copy do exactly what they
say. Writes `release-evidence/concept-isolation-qa.json`.

### The deployment contract

```bash
npm run check:env     # validate the resolved server configuration
npm run check:health  # ...and probe a running server's /healthz, /readyz and status
```

`tests/integration/server-runtime.test.mjs` holds what an orchestrator, a reverse
proxy and a browser cache each depend on: liveness answering with no upstream
call, readiness failing when the bundle is missing, `immutable` caching on hashed
assets and `no-store` on the shell that names them, gzip on text, the response
headers a proxy should not have to add, and the rate limit keyed per visitor only
when `TRUST_PROXY` names the proxy. CI additionally boots the exact runtime file
set the container copies and probes it.

### Everything else

```bash
npm test              # unit, integration and security — 364 tests
npm run test:browser  # Playwright, the full editor
npm run test:all      # both
```

Install Playwright Chromium once when browser tests are needed:

```bash
npx playwright install chromium
```

Playwright is a **dev** dependency: nothing in `server/` or `src/` imports it, so
no browser binary is ever installed on a server. `npm ci --omit=dev` yields the
four production packages and nothing else.

Do **not** run `npm run migrate:legacy`; it can overwrite the maintained separated source files.

## Repository layout

Which directories the running server reads, and which exist only for authoring.

| Path | Runtime | What it is |
| --- | --- | --- |
| `server/` | **yes** | The Brief Brain HTTP surface, the Ollama and Shutterstock providers, and the job prompts it reads from disk |
| `shared/` | **yes** | Contracts used by both the browser and the server: schemas, the deterministic planner, the style compiler, design dials, palettes |
| `src/` | build input | The client. Compiled into `dist/`; the server never reads it |
| `dist/` | **yes** | The built bundle the server serves. Not committed |
| `deploy/` | no | nginx site, systemd unit, deploy script, environment template |
| `style-factory/` | no | Style seeds and the constitution. `npm run styles:build` turns these into `src/data/style-library.json` |
| `styles/` | no | Generated per-style documentation and JSON |
| `patternsSBS/`, `legacy/` | no | Pattern source material and the pre-separation page |
| `wordpress-plugin/`, `deliverables/` | no | The importer plugin source and its built ZIP |
| `tests/`, `release-evidence/` | no | Suites and the reports the builds emit |

The container image and each release directory copy only the rows marked
runtime — about 12 MB installed.
