# Release notes

## 3.0.0 — The import is the deliverable

Reported: a slider imported as a plain grid of cards, missing typography, missing
spacing, missing effects, and a page that did not look like the preview it was
approved from. All of it was real, and none of it was one bug.

The theme in `~/sites/minisbssandbox` settled every question, because it is the
only authority on what WordPress will accept.

### An empty button on every hero

All 153 `c-btn` nodes in the catalogue exported with an empty `text`, across 77
patterns. The preview never draws those — `v2RenderButton` returns nothing
without a label — so nobody saw them until they arrived as
`<a class="c-btn -primary"><span class="c-btn__txt"></span></a>`: a real,
clickable, invisible control. A button with no label is not a setting somebody
made, it is a slot the content pass never filled, and the export is the last
place to catch it. Emptied button groups go with them, since a flex row of
nothing still takes its gap.

Buttons that *do* carry a label are untouched — the default project still exports
"Request a briefing", "See capabilities" and the rest.

### A slider that was not a slider

`ds-blocks/c-cards` registers `enableDstSlider` and `dstSliderSettings`. Four
patterns named `enableLightSlider` and `lightSliderSettings` — attributes from an
older install that exist nowhere in this theme. WordPress keeps an unregistered
attribute in the markup and ignores it, so the flag was carried faithfully and
did nothing, and the band rendered as a static grid.

Renamed in the pattern data, along with the other six mismatches an audit of all
156 patterns found: `c-heading.description` (which is inner blocks, not an
attribute — the copy becomes a `simple-text` child so the words survive),
`c-heading.showText`, `c-heading.showButtons`, `c-btn.btnVariant`, and
`dst-banner-slider.lightSliderSettings`.

**And three cards on a phone.** `dst-slider.js` reads `visibleItemsDesktop`,
`visibleItemsTablet` and `visibleItemsMobile`. The export sent only
`bleedRightVisibleItems`, so the slider fell back to its own default and showed
three cards side by side on mobile where the preview shows one. Now derived from
the column counts the band already carries, so the two cannot drift.

### Why the existing check said everything was fine

`verify-against-theme.mjs` reported a clean bill of health throughout. It was
right about what it measured: four recorded fixtures, one sample project, in
which `enableLightSlider` never appears. Coverage was the bug.

`scripts/verify-catalog-against-theme.mjs` now exports **all 156 patterns** and
looks up every block and every attribute in the theme's own `block.json` files.
It found 7 kinds of mismatch on the first run. It reports none now — 1,990 blocks
and 13,105 attributes checked.

    npm run verify:catalog          # needs npm run dev in another terminal

### The plugin was refusing to write the theme's own controls

The importer asked `WP_Block_Type_Registry` whether a block accepted an attribute
and used the answer to decide whether to write it. That answer comes from
`block.json`, and this theme adds a second set of controls from JavaScript, keyed
on `supports` flags: `dsGapControl` adds `dsPadding`, `dsContainers` adds the
container family, `dsEffects` adds `dsEffects`. PHP cannot see any of them.

So every scroll effect and band padding carried on a *node* rather than in
`attributes` was dropped, and the strategist was told those attributes were "not
registered by the active block package" — attributes the theme applies on every
page it renders. Full detail in the plugin's own release notes; the plugin is
**3.0.0**, and it also ships the card scrim the theme has no render path for, and
enqueues the fonts the concept was designed in.

The plugin's tests could not have caught it: their fixture registry is built from
the builder's snapshot, which already lists the HOC names. There is now a test
that registers a block the way WordPress does, and it fails against the old code
on exactly the three settings that were being lost.

### An import you can take back

Every import records what it did — posts created, posts overwritten with their
previous content kept verbatim, options and theme mods changed, menus built — and
the admin screen offers **Undo this import** and **Re-apply**. Both directions
are stored rather than inferred afterwards. One honest limit, stated on screen: a
navigation menu deleted by an undo is not recreated, because a menu's items
belong to it and inventing new ones would be a different menu with the same name.

## 2.9.1 — A band's words against the picture behind them

Two reports, one shape: buttons filled dark and labelled dark, and testimonials
with dark copy on a dark ground. Both are the same question asked in two places —
*what is actually behind this text?* — and the honest answer is not available from
computed styles. A glyph's ground can be a photograph, a scrim, a gradient that
has faded to nothing, or a fill painted by a button family's pseudo-element.

So this release was measured against rendered pixels. For each render every glyph
is masked, the frame is screenshotted, and the pixel under each text rect is read
back off a canvas. That pixel *is* the ground.

### The instrument was wrong first

Worth stating, because the first set of numbers was published and they were
wrong. The preview iframe lays out at 1440px and is displayed scaled to fit the
device shell — about 0.52 — so every sample landed roughly twice as far down the
page as the glyph it claimed to measure. Two of the "1:1" button failures were
the band's own background, sampled from well below the button.

Three more corrections followed, each caught by the instrument checking itself:

- **Coordinates.** One element is flooded with a colour that appears nowhere else
  and the pixel this code believes is its centre is read back. If it is not that
  colour, the run stops instead of publishing. Playwright's own `boundingBox` was
  no help — it reports in-iframe elements without the shell's scale either.
- **Motion.** Zeroing CSS durations is not enough: a staged heading reveal adds
  its classes from JavaScript timers, so the copy arrives word by word and the
  buttons paint last. The sweep now waits for two byte-identical frames.
- **Media and inline colour.** A band whose photograph had not decoded sampled as
  the placeholder behind it, which is how one pattern produced a black ground on
  one run and a photo ground on the next. And a stylesheet mask loses to an
  inline `!important` colour, so some glyphs stayed painted and were read as
  their own ground — an exact 1.00:1, which is what a masking failure looks like.

### The wash has to be strong enough for the ink in it

Both floors are derived rather than chosen. A wash of colour C at alpha a over a
photograph pixel P paints `a*C + (1-a)*P`, and a photograph can hold any pixel:

    light copy (#f7f5ef)  needs a ground no lighter than channel 113  ->  a >= .64
    dark copy  (the dark role)  needs no darker than channel 135      ->  a >= .58

Twenty-four grounds were below their floor. `sbs-cta-p15-v3` faded to transparent
at exactly the height of its heading and put white type on a bright warehouse
photograph at **1.09:1**; `sbs-hero-p89-v2` washed 27% white and kept its white
copy at **1.17:1**; `sbs-hero-p1-v1` came to .45 effective and lost its headline
at **1.33:1**. A gradient's authored alpha is remapped onto `[floor, 1]` rather
than clamped, so a wash that faded from clear to solid still fades — it fades
from the floor to solid, and keeps its direction, hue and shape.

**A band that paints no wash is deliberately untouched.** That case already
belongs to the runtime, which gives any unwashed photograph the brand's dark at
60% and inverts the copy to suit. Filling the blank in the data would have taken
that decision away from it and turned fifteen dark media bands pale — a design
change nobody asked for.

### The ink role is not a dark colour

Five of the ten button families inverted on hover by flooding the shape with
`#fff` and then labelling it `var(--dst--primary-color3)`. That role is the
palette's ink, which is dark *only while the palette is light* — on a dark-ground
palette ink **is** the light colour. Measured at **1.20:1** on Sweep Fill, Split
Reveal, Corner Cut, Ink Wipe and Magnetic Arrow, for as long as the pointer was
on the button.

A fill of a known colour now takes a label chosen for that colour:
`--sbs-on-white` is new, and the accent floods that hard-coded `#fff` use
`--sbs-on-accent`. The tone-following role survives only as the fallback inside
the `var()`.

### A pale band re-points its roles instead of overruling them

v2.9.0 forced `.c-btn.-primary{color:…!important}` on a pale band, which assumed
every family fills the primary with the accent. Three do not: Magnetic Arrow and
Neon Trace leave it unfilled and take the label from the text role, so the forced
light label landed on the pale wash itself.

The band now feeds the roles it actually has — the text and heading colours, the
button colour pairs, the ink role the families flood with, and the page ground
Depth Press paints its secondary plate on. Each family computes what it was
written to compute, including its hover, which no `!important` in a band rule
could reach. The measured pair of colours under the pointer is what the test
asserts now, rather than the text of a rule.

### sbs-hero-p1-v1

All white copy, which its scrim now carries, and the ordinary accent-filled
primary rather than the white-on-dark ghost a dark band would otherwise get.
`groupTheme: 'standard'` says so; it moves the primary only, because an outlined
button has to be drawn in the band's own ink to be visible at all.

## 2.9.0 — What imports is what you approved

An imported page did not look like the preview, and the reason was never the
patterns. Nobody had read the theme. The registry the export validates against
was a *snapshot*; the header and footer were shorthand for the importer to guess
at; and the plugin was reading a field the builder had stopped writing years of
changes ago.

`~/sites/minisbssandbox` settled all of it. `wp-content/themes/digitalsilk` has 46
block manifests and two template parts, and those are the authority: which blocks
exist, which attributes each one has, which of those the WordPress editor shows,
and exactly how a header and a footer are built.

### A pale band paints in the palette's dark role

v2.9.0 made the band's *tone class* follow its overlay, so a hero fading white
across the frame stopped claiming to be an inverted band. That was half the job.
The other half is what the standard tone actually resolves to:

    --dst--base-text-color   #EAEAEA   on a dark-ground concept palette

`ink` is the page's text colour, and on a dark-ground palette it is a *pale*
colour — right against a near-black page, wrong against a white wash. So the
headline, the pretitle, the supporting line and the outlined button all rendered
near-white on white in `sbs-hero-p5-v2`, `p5-v4`, `p89-v3`, `p30-v2` and `p30-v4`.

On a pale band the copy now uses the palette's **dark** role explicitly — the one
colour guaranteed to read on a light ground.

**The buttons had a second, separate cause.** Their variant was chosen from
`section.layout.inverted` — the family's opening guess — rather than from the tone
the band resolved to, so two of these heroes rendered `-secondary-inverted`: a
white outline and a white label on a white wash. The renderer reads
`ctx.surfaceInverted` now, which is what the banner and wrapper renderers already
compute from the overlay. An outlined button on a pale band is a dark outline with
a dark label; hovering fills it with the dark role and puts a light label on it,
picked from the palette rather than assumed to be white. Focus rings, the text
button and the hero's scroll cue follow.

**The narrowing that mattered.** The first version of this rule was keyed on
`is-style-colors-standard`, which is on *every* band that is not inverted — most
of the page. On a dark-ground palette the dark role is the band's own background,
so forcing it produced 1:1 contrast: the legibility audit caught **78 bands**, and
the pricing patterns' featured tier — painted dark on purpose — lost its heading
entirely. The rules are keyed on a new `is-pale-overlay` class, set only where the
tone pass judged the overlay to be a light wash over a photograph. Five tests hold
the pale heroes and two hold the genuinely dark ones, so the next attempt at this
cannot quietly widen again.

### One sticky offset for the page

`top:0` pinned a held column *under* the sticky header, which covered the top of
whatever was holding. Every sticky element now reads `--sbs-sticky-top`, set once
at `12rem`: the held media column, the timeline counter and the stacking cards
line up with each other instead of each choosing its own. The held column's
height allowance follows it, so a picture taller than the remaining viewport is
still bounded rather than cropped at an arbitrary point.

Their rows are also `position:relative` now. A sticky element resolves its offsets
against the nearest positioned ancestor; without one it pins to the viewport and
slides out of its own band — which is the difference between sticky working and
sticky appearing to do nothing.

### The timeline

`sbs-timeline-p1-v2` holds its heading beside the entries: the column carrying it
is marked `is-sticky-heading`, so the label stays with the entries it labels
instead of scrolling away halfway down the band. Static under 900px, where one
column would pin the heading and scroll the entries underneath it.

And `.list-timeline .dst-list__content` stacks. Row was the default, which put the
counter beside the title and squeezed the copy into whatever was left; column
gives each entry its own measure, with `margin-bottom: 2rem` as the gap between
entries that the row layout never needed.

### The brief reader now says *why* it fell back

Every job reported `OLLAMA_UNAVAILABLE`, all four within two seconds, on a server
that had just logged `ollamaConfigured: true`. Nothing in the log said what
happened, and there was no way to find out after the fact — because the provider
discarded the one thing that knew.

`rawRequest` threw `OLLAMA_UNAVAILABLE` with "Ollama could not complete the
request" for every non-2xx and **never read the response body**. A quota that
clears in a minute, a key without access to the model, a typo in `OLLAMA_MODEL`
and a transient 502 all produced the same four identical lines.

    before   {"event":"brief_brain_degraded","job":"concepts","code":"OLLAMA_UNAVAILABLE"}

    after    {"event":"brief_brain_degraded","job":"concepts",
              "code":"OLLAMA_RATE_LIMITED","status":429,"retryAfter":42,
              "reason":"rate limit exceeded for this key"}

Three causes an operator can act on now have their own code and their own
sentence — `OLLAMA_RATE_LIMITED`, `OLLAMA_FORBIDDEN`, `OLLAMA_MODEL_NOT_FOUND` —
each carrying the provider's own message, bounded to 300 characters so an HTML
error page from a proxy cannot become the message. The panel's degraded note is
per-cause too: "the AI model did not answer in time" was being shown for a
refused key, which is not a timeout and does not improve by waiting.

**A blip is no longer a verdict.** A rate limit or a transient 5xx is retried once
after a wait — honouring `Retry-After` when the provider sends one — where before
a moment's congestion degraded the whole run to the built-in planner. A refused
key and a missing model are still not retried, because waiting does not fix
either.

**`STOCK_EMPTY` stopped blaming the brief.** When the search terms came from the
built-in planner because the model had degraded, "name the subject more plainly"
sent the strategist to rewrite a brief that was fine. It now says the terms were
the planner's and why the model degraded.

### `npm run check:ollama`

One command that answers the question without needing somebody watching the log:
configuration, key length (never the key), whether the account offers the
configured model, and a real one-token generation through the actual provider
code. It exits non-zero and says plainly that the builder will still work on the
built-in planner but the copy, the concepts and the imagery search will not be
written by the model until it is fixed.

Six of the ten new tests assert the refusals — including that the key never
appears in a message or in `details`, and that a fenced ```` ```json ```` reply is
read rather than refused, because the model returns one even when a schema is
sent.

### Documentation: a deck the team can actually read

`docs/SBS-Simple-Builder.pdf` — 18 slides, landscape 16:9, one slide per page —
walks the engineering team through the simple builder: the four steps, the one
button and its four stages, the architecture, the AI layer, the pattern library,
concept isolation, the preview's in-place repaint, the crossing into WordPress,
the stack, and what verifies it.

Five diagrams are hand-authored inline SVG rather than pasted images, so they stay
crisp at any zoom and in print and they theme with the page. Each one draws a
mechanism rather than naming it: the preview slide is a before/after of the same
four steps, because the difference *is* the claim.

The source is a normal web page whose slide box is its printed page
(`@page { size: 1280px 720px }`), so `npm run build:deck` produces the deck at
16:9 rather than a document reflowed onto A4 with slides split across boundaries.
Playwright prints it with `preferCSSPageSize` after waiting on
`document.fonts.ready` — a PDF printed before the webfonts arrive is set in the
fallback stack, same layout, wrong voice.

Two things the build caught that a glance would not have. A responsive rule was
written `@media (max-width:1360px)` and therefore matched under *print* as well,
putting 54px of padding back after the print block had removed it — two extra
blank pages in an eighteen-slide PDF, which is why the build verifies the page
count and the MediaBox rather than trusting them. And an overflow check that read
`scrollHeight` found nothing, because the slide clips: measuring each child's
bottom against the slide's padding box found four real spills.

Every number in the deck was read out of the code and the data at v2.9.0 rather
than remembered.

### The registry is generated from the theme

`npm run sync:registry` reads `build/blocks/**/block.json` and rebuilds the
component registry from it. A block's real attribute set is not only what its
manifest declares: WordPress adds attributes for the `supports` a block opts into,
and the theme's own HOCs add more — the container control, the gap control, the
effects panel, the class list, the variant picker, the pattern selector. Every one
of those names was read out of `build/blocks/hoc-components/*/index.js` rather
than guessed, because those are the attributes the *editor* shows, and the point
of the exercise is an imported block you can still edit with the controls the
builder used.

    52 components · 1,270 attributes · +158 the builder had never heard of

Four of them were whole blocks: `dst-footer`, `dst-footer-section`,
`dst-footer-slot` and `dst-site-logo` — the footer family the shorthand had been
standing in for.

The sync is a **union**, not a replacement. This theme build is a different
vintage from the install the pattern library was exported from, so the registry
keeps anything the theme declares, anything the 169 patterns actually use, and a
short explicit list of what the builder authors itself. Replacing outright would
have deleted both slider controls, `c-heading.description` and every card overlay
strength on the way out — the exact failure the allow-list exists to prevent,
mirrored.

### The header and the footer are real block trees

They were shorthand: one `dst-navigation` node with a `nav: {logo, menu, cta}`
object hanging off it and `importerShorthand: true`, and the plugin expanded that
into whatever it guessed. `parts/header.html` and `parts/footer.html` are the
answer, and the export now builds those trees exactly — every block, every
attribute name, every level of nesting:

    dst-navigation                          dst-footer
      dst-navigation-announcement             dst-footer-section[top]
      dst-navigation-top                        dst-footer-slot
      dst-navigation-main                     dst-footer-section[middle]
        …-content[logo]   > dst-site-logo       dst-footer-slot × 4
        …-content[menu]   > …-navigation-menu  dst-footer-section[bottom]
        …-content[search] > …-navigation-search  dst-footer-slot × 2
      dst-navigation-mobile
        …-content[logo] > dst-site-logo
        …-mobile-dropdown > …-navigation-menu
      dst-navigation-bottom

**Menus are the other half of it.** The theme's menu blocks read a *location* —
`menuSource: 'location'`, `menuLocation: 'primary-menu'` — not a list of links and
not a menu id. So the links travel beside the tree as a `menus` plan, the blocks
name the location they expect, and the plugin builds each menu and points the
location at it. The 1.0 importer created one menu and wrote its id into a
`menuValue` attribute the theme's block does not declare, which is why an
imported header came in empty.

The phone takeover had no attribute behind it either; `mobileMenuStyle` was
invented, and WordPress kept it in the markup and ignored it. It travels as a
class the theme's stylesheet hooks.

### Only attributes the theme declares leave the builder

`node scripts/verify-against-theme.mjs` looks every exported attribute up in the
theme's manifests. An unknown attribute is not an error — WordPress keeps it and
ignores it, which is worse: a setting the strategist made that the page does not
have, and nothing anywhere says so. It found four:

**`backgroundOverlayOpacity`.** The theme carries an overlay's strength *inside*
the colour — `#333333b0`, `rgba(7,28,42,.82)` — and declares no opacity
attribute. Exported as a separate number, every scrim landed at **full strength**:
a hero's photograph vanished behind a solid band of ink. The strength is now
folded into the colour, multiplied rather than replaced so a stop that was already
half transparent under a 60% scrim ends up at 30% — which is what the browser
composites in the preview. A token that can only be resolved in the browser
becomes `color-mix(in srgb, …)`.

**`htmlTag` on a wrapper.** Invented by `makeFullBleedBand`. A wrapper is a
`<section>` and has no say in it.

**`title` and `link` on `c-list-item`.** Mine, from the first draft of the footer.
That block has `listTitle`, `listSubTitle`, `heroText` and `icon` — and no link
attribute at all, so a link column built from list items imports as a column of
unclickable words. The theme's own footer part puts link columns in a paragraph of
anchors, and so does this now.

    194 blocks · 1,080 attributes · 0 the theme does not know

### The plugin is source, and it is 2.0.0

It existed only as a zip, which meant every change to it was a change nobody
could review and nobody could repeat. `wordpress-plugin/` is the source and
`npm run build:plugin` produces the artifact.

**The defect that mattered most.** The builder moves a paragraph's words onto the
node — its export normalizer does `node.text = node.text || attrs.content` and
then deletes the attribute — and the converter only ever read `attributes.content`
and `content.text`. **Every paragraph in every artifact imported blank**: body
copy, the footer description, the legal line, the announcement bar. Nothing
reported it, because an empty paragraph is a perfectly valid block. Three
assertions now fail if a `<p></p>` reaches a page.

Also in 2.0.0: `create_navigation_menus` builds every menu the artifact names and
assigns each to its theme location, skipping locations the theme has not
registered rather than writing invisible keys; menus are replaced rather than
appended to, so importing twice no longer doubles every item; a menu id is written
only for a 1.0 artifact that names no location; and a sideloaded logo becomes the
`customLogoId` the site-logo block reads, with a warning rather than a broken
reference when the file could not be fetched.

### Coverage

    tests/browser/wordpress-parity.spec.mjs   8   the canonical trees, areas,
                                                  menu binding, takeover, the fold
    tests/unit/theme-parity.test.mjs          6   registry vs theme, artifacts vs
                                                  theme — skipped when no theme
    tests/wordpress/importer-unit.php        36   +13, including the paragraph guard
    npm run verify:export                         records and checks in one step

The unit tests skip rather than fail when the theme is not checked out: the check
is about agreement, and there is nothing to agree with.

### Two tests that were asserting the bug

`color-controls` required `backgroundOverlayOpacity` in the export and
`navigation-menu` required `attributes.mobileMenuStyle`. Both are attributes the
theme ignores; both now assert the form that actually renders. And the
every-property sweep gained a second pass, because a control that modifies
something another control creates — an overlay's strength, a motif's scale — is
not a dead control, it is one that needs its subject to exist first.

## 2.8.0 — An imported page is a page you can use

A page exported from the builder and imported into WordPress came in with things
missing. None of the causes were in the patterns: the trees are faithful to
`patternsSBS/` block for block, on 155 of 156 patterns, and no enabled overlay is
lost at ingestion. What had drifted was everything *around* them — the export's
media shape, the catalogue's description of the library, and a handful of editor
controls that moved the preview and nothing else.

### Named corrections to individual patterns

Everything in `clean-patterns.mjs` above this was a rule. These are decisions
about individual patterns that no rule can derive — how many quotes a pull-quote
band shows, where a column sits in its row, whether a picture should hold still
while the copy beside it scrolls. They live in a `CORRECTIONS` table rather than
hand-edited into the data, so a re-ingest cannot quietly revert them, and
`pattern-corrections.spec.mjs` fails if one does.

**How many quotes.** Sweeping the whole testimonial family to three across in
2.8.0 was wrong: a pull-quote band shows one large quote and a card band shows
two or three, and which it is belongs to the pattern.

    p15 v1   1        p43 v2   2
    p15 v2   1        p10 v1   2
    p43 v1   1        p17 v1   3 (unchanged — its own value)

**Where a column sits.** `sbs-testimonial-p15-v2` set its row to `end` *and*
pinned its first column to `bottom`, so the heading sat on the floor of the band
beside a column of quotes. The column is what actually renders `align-self`, so
both had to move — correcting the row alone left it exactly where it was.

**A picture that holds still.** The two `p31` stats bands put a tall picture
beside a list of figures and centred it, which leaves it floating in the middle
of a lot of nothing. The picture's column is now marked `is-sticky-media` and the
row aligns to the top, so the picture holds while the figures move past it.

Three details decide whether that works rather than silently doing nothing:
`align-self:start`, because a stretched grid item is already as tall as its row
and has nowhere to travel; `overflow:visible` asserted on the ancestors, because
`overflow:hidden` anywhere above a sticky element turns it back into a static one
and both `.has-bg-media` and the decoration layer set it; and `position:static`
under 900px, because sticky and a single column would pin the picture to the top
and scroll the copy underneath it. The held column is also bounded by the viewport
rather than by the row, since a picture taller than the window can never be seen
whole.

`sbs-stats-p31-v2`'s list also carried `c-default` — a container inside a band
that already is one, with 2.4rem of side padding it did not need. Naming its
container empty resolves it to `c-full`: no class, no padding.

### The footer

`.sbs-footer-statement` was measured at 105rem and its headline clamped to twelve
characters, which broke a four-word sign-off across four lines. Both take the
width they have.

The centred layout is the one exception, and it has to be: centring is relative
to something, and at full width there is nothing to centre within — that layout
became pixel-for-pixel the editorial one, which is what `global-parts.spec.mjs`
caught. It keeps a reading measure, which a centred line needs anyway.

**The watermark is the client's name.** `footer.wordmark` was seeded once from the
brand and never revisited — `if (!project.footer.wordmark)` is only ever true on a
brand new project — so every page built afterwards carried **Vision** across the
bottom, from the default project's own name. It now follows the brand the way the
logo text and the legal line already do, until somebody types their own. One word,
because it is set at ten rem: a leading article is dropped (`The Bicycle Company`
→ `Bicycle`) and a first word too short to read as a fragment takes the second
with it (`Ex Machina Studio` → `Ex Machina`).

### The form slot

`.sbs-form-slot` is the one surface that is always white, and its text colour was
the palette's `ink` — which on a dark-ground palette is a *pale* colour. The
darkest of the palette's own candidates is used instead, with `#111` as the floor
when a palette has nothing dark in it at all.

### A stats band with real figures in it

The content writer was told to leave every number empty and write "Add the
measured figure" where it belonged. That is the safe answer and an unpresentable
one: three cards reading *Add the measured figure* is a template, not a concept.

The prompt now asks for an illustrative figure **in the unit the industry actually
uses** — `2,000 km` for a motorcycle rental, `48 hrs` for a turnaround, `12 sites`
for a contractor — taking the unit from the brief and keeping the magnitude round
and obviously a placeholder. The prohibition on invented *verifiable* facts is
unchanged and now spelled out: no satisfaction percentages, no review scores, no
revenue, no headcount, no years trading.

`v19StatsFigures` is the net under it — for the built-in planner, for a model that
ignores the instruction, and for demo content nobody has run the writer over yet.
It reads the brief's own vocabulary against a table of trades and fills any value
that has no digit in it. Either way the band's own body says the figures are
illustrative and to be confirmed, rather than leaving somebody to notice.

### Coverage

`tests/browser/pattern-corrections.spec.mjs` (13): the five quote counts, the
column that had to move twice, both held pictures and the three CSS conditions
that make holding work, the form slot against a deliberately pale palette, the
footer widths including the centred exception, the watermark through four brand
names and one typed override, and a stats band whose every value arrived as an
instruction.

### The pattern library stops carrying the site it came from

All 156 patterns are real WordPress exports, so each one arrived with that
install's own decisions baked in. Three of them were actively wrong here, and
`scripts/clean-patterns.mjs` takes them out — repeatably, printing what it
changed.

**Media.** A card named
`dsstaging1.com/wp-content/uploads/2026/01/exterior-facade-high-reflection-blue.jpg`
— somebody else's photograph of somebody else's building — and it won over the
imagery found for *this* brief simply by being present, because an attribute that
exists is never replaced. 230 references gone.

The *slot* is not the file, and that distinction cost two attempts to get right.
Deleting the attribute deleted the pattern's intent with the photograph: a
thirteen-card band came back with no pictures at all, and a third of the
catalogue's photo-backed bands became flat colour. Worse, a background *layer*
that lost its file kept `fixed`, `focal`, `size` and `width` — still shaped like a
layer, rendering nothing, and not empty enough to notice. So an emptied slot is
now an explicit marker (`media: {}`, `backgroundImage: []`, a fileless layer
collapsed), and `v18FillEmptySlots` fills every one at sync from `mediaChoice` —
the imagery pass's output once it has run, a labelled placeholder before that.
Preview, audit and export all see the same picture.

**Overlays.** `backgroundOverlay: '#f5f5f5'` at opacity 1 over a photograph is a
grey rectangle where the photograph was. So were `var(--dst--secondary-color1)`
(white), `#dddddd`, a bright green gradient, and the hard
`linear-gradient(180deg,rgba(7,146,227,0) 0%,rgb(0,0,0) 73%)` on the sliders. 233
of them, on cards and lists, removed. The renderer already has a scrim for the
one case that needs one — a title sitting on a picture — and it is a soft
bottom-up gradient that darkens the type's ground and leaves the image visible.

**Links.** 14 buttons pointed at the exporting site's own contact page, which is a
dead link on every page built from the pattern. Now `#contact`.

### A band's text tone follows its overlay, not its family

The sharpest of these. A hero's `is-style-colors-inverted` came from the family
preset — every hero is inverted, because a hero is usually a photograph — while
the overlay came from the pattern, and five patterns fade something *pale* across
the band and put the headline in it. The band class carries `!important` colour
rules, so it overruled the heading renderer, which had already worked out the
right answer. White type on near-white.

The overlay is the fact and the preset is a guess, so `sectionClasses` and
`sectionBgClass` now follow the overlay for a banner-rooted section:
`sbs-hero-p89-v3`, `p5-v2`, `p5-v4` and `p30-v4` render dark type; every genuinely
dark-washed hero and CTA still renders light. A pale wash below 45% opacity is a
haze over a photograph rather than a ground, so those keep the preset and the
rendered-legibility pass has the last word.

`sbs-hero-p89-v3`'s wash was also a pale *blue*, which behind a headline reads as
a mistake rather than a decision. It is white.

### The logo rail is a rail you can fill

`marquee.images` listed seven real client logos by URL from the exporting site.
They are gone. What ships instead is six inline SVG marks drawn in
`currentColor`, so one set reads on a dark banner and on a light one and nothing
is fetched from anywhere — and they are abstract rather than imitations, because a
fake wordmark in a client concept says something nobody agreed to.

The rail also had no editor, which is why it was still showing Walmart. The media
tab now lists its logos: an address each (SVG or PNG) and a company name, with
add and remove. Clearing an address returns that slot to its placeholder rather
than leaving a hole in a scrolling track. On export a placeholder becomes a
`data:image/svg+xml` attachment — an image block with no `url` is an empty slot in
WordPress, the importer leaves a data URI alone because it only sideloads
`http(s)`, and the browser renders it directly.

### A card grid that never said how many across

`sbs-stats-p29-v1` was the reported case: thirteen cards, no column count, and
`fidelityNumber(undefined, 1, 6)` is one — so thirteen full-width bands. The count
is now written into the data from what each grid holds, capped at the three a card
is designed around, with `fidelityEnsureSection` as the net under it for a pattern
added later. A pattern that *states* one column still means it: a stacked timeline
is one event per row.

Both slider patterns said two and one respectively, which is why they looked
alike and why one card filled the band. Slider and testimonial grids are three
across, and `dstSliderSettings.bleedRightVisibleItems` follows.

### A column's picture is shown whole

`.ds-column .dst-media` and `.dst-content2__col .dst-media` were capped at
`62vh`, which crops a portrait image in a two-column band and shows its middle
rather than its composition. There is no reason for a column's own media to be
measured against the viewport; it is `100%`.

### Coverage

`tests/browser/pattern-hygiene.spec.mjs` (11) sweeps **every** pattern rather than
the handful that were reported, because the reported ones were only the ones
somebody happened to look at: no rendered URL names the staging install, every
card scrim is the renderer's own, no grid falls back to one card per row, every
media slot shows a picture, pale overlays get dark type and dark ones keep light,
the rail ships inline marks and fetches nothing, a real logo goes in and comes
out, and no column media is capped to the viewport.

Four existing tests asserted values that were deliberately changed — the pale
blue, and the hard black card scrim — and were updated to assert the new ones
rather than being loosened.

### A dropped document is attached, not pasted

Dropping the client's PDF used to tip its whole text into the brief textarea.
That is the wrong place for it twice over: three pages of somebody else's
document buries the paragraph the strategist wrote in a box they are meant to
keep editing, and it makes a *document* look like something they typed.

A document is now attached. It shows as its own name with a page icon, its kind
and how much was read out of it, beside a button that takes it off again. The
words never enter the textarea.

    ┌──────────────────────────────────────────────┐
    │  📄  Red Moon Motorcycles-Intro Notes.pdf  × │
    │      PDF · 6,214 characters read              │
    └──────────────────────────────────────────────┘

`briefSourceText()` is the single place that decides what "the brief" is: the
typed paragraph, then each attachment announced by its own file name. Everything
downstream reads it, because everything has to agree on the answer — the request
the brain receives, the length the button is gated on, the character counter, and
the comparison that decides whether the concepts have gone stale. The model is
being asked to weigh several sources, and an unlabelled wall of concatenated text
hides which sentence came from the client's brief and which from a rate card that
happened to be in the same folder.

Which means **an attachment on its own is a brief**. The button's gate counts the
paragraph and the attachments together, so a client who sent a PDF and nothing
else does not have to retype it to press *Read my brief and build 3 concepts*.
Removing an attachment makes the concepts stale exactly as editing the paragraph
does, and a file dropped twice is one attachment rather than two.

The advanced builder still fills its individual brief fields from the document,
because it is unusable without them. What changed there is that the internal note
is left alone: it used to be overwritten with the whole document, which is the
same problem in a different box.

Ten tests in `brief-documents.spec.mjs`, rewritten around the new behaviour: the
chip and its icon, the textarea left untouched, the words reaching the brain
under the document's name, removal, the duplicate drop, two documents at once, a
real `.docx`, a browser-printed PDF, and both builders.

### The export writes media the way the patterns write it

All 169 registered pattern files agree on how DST stores a picture. The export
had drifted to a shape of its own, and a block handed an object it has no reader
for renders nothing:

    every pattern   c-media.media = {lazyLoad, primaryType, videoExternal,
                                     imagePrimary:{id,url,alt,mimeType,
                                     mediaType,size},
                                     style:{desktop:{mediaRatio,focalPoint},
                                            mobile:{…}, borderRadius}}
    the export      c-media.media = {src, alt, ratioDesktop:'16/9'}

    every pattern   backgroundImage:[{id, desktop:{media:{id,url,mime,type},
                                      fixed,focal,size,width}, mobile:{…},
                                      lazy, hideMobile, posterImage,
                                      fetchPriority, overlay, overlayEnabled,
                                      overlayOpacity}]
    the export      backgroundImage:[{src, desktop:{size,focal}, …}]

The `v13` layer converts at the export boundary — backgrounds, the three media
blocks, card media and clips, and the marquee rail — and keeps the builder's own
`src`/`alt` alongside the DST shape so the preview, the audit and re-importing a
builder export all still work.

Two details decide whether an import is usable rather than merely plausible.
Every media object now keeps an `id` key, even at `0`: the importer sideloads a
URL and writes the new attachment id back only into a key that already exists —
`array_key_exists( 'id', $value )` — so without the key the page never learns
which attachment it got. And `mime`/`mimeType` is filled in from the file
extension, because DST decides between an `<img>` and a `<video>` on the type,
and an empty type on an `.mp4` is a still image that never plays.

### A band keeps its own background

`normalizeExportSection` deleted `backgroundImage` and `backgroundColor` from
every section that was not a `dst-banner`, and `makeFullBleedBand` replaced an
inverted band's photograph with a flat token colour. Two thirds of the library is
rooted in a wrapper, so this was most of the page — and worse than losing the
picture, it made the export disagree with the preview that had just been
approved, because the preview renders both. Sixteen patterns put their photograph
on a wrapper or a column set; all sixteen now export it.

### The catalogue agrees with the patterns it describes

Each pattern shipped its own `counts`, `flags` and one-line `look`, and all three
had drifted from the trees. This is not cosmetic: `v8Score` reads the flags and
counts to decide which pattern a concept gets.

    flags.media contradicted the tree on   92 patterns
    counts contradicted the tree on       101 patterns
    look named a count it does not hold     10 patterns

The default hero declared itself photograph-free while carrying a background
image, so every concept that asked for dominant imagery scored its own default
hero *down*. All three are now derived at boot from the tree that will actually
be rendered, so the drift cannot come back — there is one source of truth and it
is the pattern.

Correcting the flag truthfully would have handed the "carries photography" bonus
to 119 of 156 patterns and flattened the distinction the imagery dial exists to
make, so `flags.mediaLed` was added beside it: the sharper half, where the
section's own ground is a photograph. A concept asking for dominant imagery now
prefers those, and still prefers a card grid with pictures over a band with none.

### The staging host, repaired

262 media URLs across 76 patterns pointed at `dst.dsstaging1.local`. `.local` is
reserved for mDNS, so `download_url()` cannot fetch it and
`wp_http_validate_url()` will not pass it — the importer records "could not
sideload" and leaves a dead URL in the page, which looks filled until it ships.
The pattern files name the real host; it is put back at boot.

### The registry stopped deleting real attributes

The export deletes any attribute the registry does not list, which is the only
thing stopping a builder-internal key reaching WordPress. But the registry is a
snapshot, and where it had fallen behind the theme it was deleting attributes the
patterns use: both slider controls (so slider patterns imported as static grids),
a card overlay strength, and `c-heading.description`, which is *copy*. Ten
attribute descriptors were added to `src/data/dst-data.json`, so the browser
runtime and the PHP importer tests agree on what is real.

### Every control in the module editor lands in the export

`tests/browser/editor-properties.spec.mjs` drives every binding the module editor
renders — every family, both views, a real `input` event each — and checks the
exported artifact afterwards. It found controls that changed nothing at all, each
fixed at its own cause:

  * **Content width on a banner.** A banner is full-bleed by definition, so the
    export pins its container to `full` — and the control was writing to the
    pinned value. What a banner actually has is an *inner* container, which the
    preview already read. On a hero, "Content width" now does something.
  * **Hero image treatment.** A split hero was a class in the preview and nothing
    in the export. DST already has the attribute: the background layer's own
    `width`. The phone keeps the whole band, because a 55% background beside 45%
    of nothing is a gap, not a composition.
  * **Supporting text alignment.** `c-heading` has exactly one alignment pair, so
    this had no attribute to become: it moved the preview and vanished on export,
    which meant a page approved with centred supporting text arrived
    left-aligned. Withdrawn. The heading alignment, which does export, moves both.
  * **Custom image URL and alt text.** Offered on six families whose pattern
    renders no media slot, where there was nothing to change. The panel now says
    so instead.
  * **List geometry.** Offered on a module whose list had already been rebuilt
    away by its own content model, from a target recorded before the rebuild.
    Stale fidelity slices are pruned at sync.

The sweep itself needed care to be worth trusting: a select is tried through
*every* option and a slider in both directions, because a first alternative that
happens to resolve to the same exported value is not a dead control, and several
product rules clamp one way on purpose — a corner-anchored motif is never scaled
above 1.

### The production form is a decision, not a constant

Ten patterns embed `gravityforms/form`, every one carrying `formId: "1"` from the
DST staging site. That attribute is exempt from the registry filter, so it reached
WordPress verbatim — where form 1 is a different form, or none, and the contact
band imported empty. There was nowhere to say otherwise. The contact editor now
asks, the preview slot shows what it was told, and the export carries the answer.

### Two patterns added, one un-truncated

`scripts/ingest-patterns.mjs` re-reads named patterns from `patternsSBS/` — not
the legacy migration, which rewrites everything; this touches only what it is
asked for and prints what it changed.

  * `sbs-pricing-p26-v1` held 77 of its 137 blocks — 26 of 44 card items, 12 of
    24 list items — so the second tab of a two-tab pricing table was half empty.
    It is whole. It was the only truncated tree in the library.
  * `sbs-hero-p30-v2` and `sbs-hero-p30-v4` were never ingested, while their
    siblings v1 and v3 were. **156 patterns.**

Five patterns in the builder are not in `patternsSBS/` at all —
`sbs-logo-p1/p2/p3-v1`, `sbs-cards-p1002/p1003-v1`. They are kept, because the
families would otherwise have gaps, but they are labelled `builder-placeholder`
rather than claiming the registered library, and no family defaults to one any
more: the logo family opened every generated page with `sbs-logo-p2-v1`, which
nobody can point at.

### The WordPress fixtures are generated, not remembered

`tests/fixtures/wordpress/*` is what `npm run test:wordpress` validates and what
`npm run test:bundle` zips, and they were recordings of the export shape from
*before* all of the above — so the PHP importer tests were passing against a page
the builder no longer produces. A fixture that does not match the product is worse
than no fixture, because it reports success. `npm run record:wordpress` loads the
real app in a real browser, calls the same export functions the Export button
calls, and writes the results back, with `generatedAt` pinned so the diff stays
readable.

### Coverage

    tests/browser/export-fidelity.spec.mjs     8   the shapes, ids, hosts, backgrounds
    tests/browser/pattern-fidelity.spec.mjs    7   counts, flags, look, host, registry, defaults
    tests/browser/editor-properties.spec.mjs   2   every binding, every family, both views
    tests/browser/module-form.spec.mjs         4   the form id, end to end

Each asserts the agreement rather than a snapshot of it, so a pattern added or
re-ingested later cannot quietly reintroduce the drift.

### One regression caught on the way

Adding the per-breakpoint descriptor to background layers dropped the `kind` and
`mime` a clip announces itself with at the layer root, which the preview and the
importer both still read. Adding the DST shape was not a reason to drop them.

## 2.7.2 — Editing a module never moves the preview

### Every property, not only a dropped picture

2.7.1 stopped the preview jumping when a picture landed on a band. It jumped for
everything else: pick "Space above: Normal" on a band halfway down the page and
the page left, came back and re-animated, with the band you were spacing
somewhere inside that journey.

The cause was the same one, and the cure was already written. Every control in
the module editor called `queuePreview`, which rebuilds the whole document, and a
rebuilt `srcdoc` opens at scroll 0 before the restore walks it down. Nothing
about the in-place repaint was specific to a picture: a background, a content
width, an arrival effect, an overlay, a headline, a card's copy, an item added to
a list — each changes exactly one module, and `siteCss` is derived from the
design dials rather than from any section, so no document-level rule goes stale
when one band is replaced.

The new `v12` layer sits at the end of the IIFE, where it can reassign the
outermost `updateBinding` wrapper, and covers three routes:

  * `updateBinding` itself, for every `setting.` / `effect.` / `decoration.` /
    `section.` / `fidelity.` path — which is every select, slider and colour
    control in both the Basic and the Extended view, plus the fidelity overlay
    and colour composites that call `updateBinding` from a click.
  * A bubble-phase `input`/`change` listener on `document`, for the fields that
    never reach `updateBinding` — a headline, a card's copy, a list of bullet
    points, a slot's own media fields. Bubble on `document` is the first point at
    which every `#editorInner` listener has run and the change has actually been
    applied; a field that also went through `updateBinding` is queued twice and
    painted once, because the queue is keyed by module id.
  * A capture-phase `click` listener for the repeater controls. Adding or
    removing an item goes through `mutate`, which re-renders the editor pane — so
    by the time a bubble listener ran, the button clicked has been detached and
    can no longer be asked which panel it was in. The module is recorded in
    capture, before the pane is rebuilt, and painted on the next frame: well
    inside the 110ms the rebuild is waiting on.

Two properties this layer had to get right. The queued rebuild is cancelled when
the change lands rather than when the repaint runs, because a rebuild firing in
between would move the page anyway. And a dragged slider fires `input` per pixel,
so repaints are coalesced to one per frame — the debounce the rebuild used to
provide. A change the frame genuinely cannot absorb still rebuilds: a torn-down
frame, a module no longer in the document, or a design dial, which rewrites the
document stylesheet and is not one module.

`__SBS_TEST_API.paint` exposes `painted()` and `rebuilt()`. A repaint that
silently degraded into a rebuild is the failure mode this layer exists to
prevent, and a test asserting only "the change landed" cannot tell the two apart.

### One old test asserted the bug

`preview-scroll.spec.mjs` waited for the frame's load count to *grow* and then
checked the scroll had been restored. That was the best guarantee available while
every change rebuilt the document — and it is also a description of what people
were complaining about. It now asserts the stronger thing: no reload at all, and
a scroll position identical to the pixel.

Its baseline needed one more piece of care. A programmatic scroll clamped because
the document had not finished growing is restored by the browser as the page gets
taller, so the baseline is the first reading that holds still — otherwise the
assertion blames this change for the browser's own catch-up.

### Coverage

`tests/browser/module-properties.spec.mjs` (10) covers space above, space below,
the light/dark flip, the content measure, the arrival effect, a decorative motif,
a fifteen-event slider drag, a typed headline, an added repeater item, and the
design dial that must *still* rebuild. `simple-builder.spec.mjs` gains the same
assertion in the builder most people actually stand in.

### One more instance of a known flake

`button-styles.spec.mjs:71` still confirmed a change had landed and then measured
geometry in a *second* round trip — the shape `measureWhen` was introduced for in
2.7.1, applied to its neighbour at line 93 but not to this one. It now measures
in the reading that satisfies the wait. `previewButton` also no longer throws
when the frame is caught between documents: reporting a null reading lets the
caller keep polling, where throwing failed the test on a page that was correct
before and after the moment it was read.

## 2.7.1 — The preview stays where you are

### A dropped picture no longer throws the page to the top

Dropping a picture on a band worked, and then the preview jumped to the top of
the page and animated its way back down. The band you had just dropped on — the
one you were looking at, the reason you dropped there — went with it.

The cause was a full rebuild for a one-section change. A rebuilt `srcdoc` is a
new document: it opens at the top, and the scroll restore then walks it back,
which is exactly what that jump-and-glide is. `v6RepaintSection` already existed
for precisely this, with a comment saying a rebuild "is precisely what would jump
the page to the top and re-animate the whole document" — the preview arrows have
used it since 2.5.0. A picture landing in a slot changes one section, so that
section is now swapped in place and the rebuild queued behind it is cancelled.

Every path that places a picture takes it: the drag-and-drop, the module editor's
found-imagery picker, the per-slot placeholder picker and the placeholder
library. Held by two tests that assert the frame's load count stays at zero and
its scroll position is unchanged to the pixel.

One thing worth recording: the first attempt called the repaint from the
builder's first layer, which sits *outside* the IIFE that defines it — a
`ReferenceError` thrown inside a click listener, silently swallowed by the
browser, leaving the mutation applied and the rebuild un-cancelled. The repaint
for that path is attached as its own listener from inside the right scope.

### The CSS the minifier had been complaining about

`.brand-mark` was followed by a dangling `border:2px solid #fbfaf7}` outside any
rule — present since the first commit, so it has never rendered. esbuild warned
on every build. Removed rather than folded into the rule: the app's known
appearance is the one without it.

### The legibility control finally controls something

`legibility.spec.mjs` asserts that no archetype produces an unreadable band. That
claim is worth nothing unless its negative control fails when a band *is*
unreadable — and that control had been failing since 2.4.0, because it tried to
force the failure through the project model and the model kept defending itself.
Palette repair puts the ink back. The derived tokens read text colour off the
ground rather than from the ink, so `ink = bg` changes nothing on an inverted
band. Every band with a photograph behind it inverts its copy and is excluded
from measurement anyway. All three of those are the product being right, and none
of them leaves a way to say "unreadable" in the model.

So the sabotage is applied where the audit looks: the rendered page. Each line in
one band is painted the colour of *its own* ground — per line, because a slider's
card sits on its own opaque panel, and painting its title the colour of the band
behind the panel makes it more readable, not less — using the audit's own
selector, now exposed for the purpose. The control then requires that band and no
other to be named, under 1.1:1, with the preflight gate failing and quoting it.

### Two more flakes, one shape

`button-styles` and `hero-fit` each confirmed a change had landed and then
measured the geometry in a *second* round trip, which can catch the preview
mid-rebuild: a radius reads as the default, a width as the pre-layout value, and
the test fails on a page that was correct before and after the moment it was
looked at. Both now poll on the reading they are about to assert and keep it
(`measureWhen`). The full suite is green twice over.

## 2.7.0 — One button

"Read my brief and build 3 concepts" was three buttons on three steps, and the
middle one needed a fourth press before anything it wrote reached the page:

1. Step 01 — read the brief, get three concepts.
2. Step 01 or 03 — write the page copy. *Then press Apply.*
3. Step 03 — find the imagery.

Not one of those presses was a decision. Every one of them had to happen before
a page could be shown to anybody, and the draft nobody reads before applying is
a confirmation dialog with extra steps. So it is one press, and it does all of
it:

**Read my brief and build 3 concepts** → designs three concepts · writes the copy
for every section and puts it on the page · finds the imagery and places it.

### The order changed, and that is the point

The old flow generated the three concept workspaces first and dressed the page
afterwards — which left the copy and the pictures in whichever workspace happened
to be open. The new order dresses the page and forks it last:

1. read the brief — the readback, the fields, the three concept designs;
2. write the copy and put it on the page;
3. find the imagery and place it;
4. **then** clone that page into V1, V2 and V3, each resolving its own design.

Now all three concepts carry the same real copy and the same real pictures and
differ only in design, which is the entire reason to show a client three of them.

### Two of the four jobs are allowed to fail

A brief that produced three concepts is worth keeping even when the copywriter
times out, and stock imagery is a separately configured service that many servers
do not have. Neither is a reason to throw away the rest, so both are best-effort
and both say what happened. The panel shows the counts when it is done —
"3 concepts designed · 6 sections written and applied · 6 pictures found and
placed" — and any note underneath: the copywriter unreachable, stock not
configured, a slot that kept its placeholder rather than repeat a picture.

### It says which job it is on

Four jobs behind one press is most of a minute of waiting, and a button that just
sits there reads as a hang. The press names the stage it is in and ticks off the
ones it finished.

### What went away

- The **"Write the page copy" / "Apply this content"** pair in the simple builder
  — both presses, on Step 01 *and* Step 03. The `renderSimpleContentPanel` panel
  and the copywriter block are deleted, not hidden.
- Step 03's imagery panel is now the **library** rather than a step: it says
  Step 01 already searched, and its button is a re-run for a different set.

The advanced builder is deliberately untouched. Its write-then-review-then-apply
sequence is the reason it exists: it is used on pages that already have
hand-written copy, where overwriting without reading the draft first is the whole
risk. One model, one set of jobs, two front doors with different promises.

Measured against the real thing — a ten-page client PDF dropped on Step 01, then
one press: three concepts designed, six sections written and applied ("Ride the
Grand Canyon in Style", "More Than Just a Rental", "From Booking to Open Road"),
twelve previews found and six placed, and all three concepts carrying the same
page.

## 2.6.0 — The brief arrives as a file, and the pictures arrive by hand

### The client's own brief, dropped straight in

The brief that actually exists is a PDF the client exported or a Word document
from a discovery call, and the only way in was to open it somewhere else, select
all, and paste. Now the whole window takes a file: drag one anywhere over the
builder and a sheet appears; drop it and the words are read.

Every format is read **in the browser** with no dependency and no upload — a
`.docx` is a ZIP of XML and a PDF's text lives in deflated content streams, and
the platform already ships the one primitive both need. The client's document
therefore never leaves the machine, which for a brief under NDA is the difference
between usable and not.

- **`.docx`** — the ZIP central directory, then `word/document.xml` (plus foot and
  end notes), with paragraphs, tabs and breaks kept.
- **`.rtf`, `.txt`, `.md`, `.csv`, `.json`, `.html`** — markup stripped to prose.
- **PDF** — see below; it turned out to be the whole job.

#### A PDF does not contain text

The first version of this read the bytes of every content stream, which works on
a PDF written by hand and fails on every PDF anybody actually has. A real Word or
Pages export uses two kinds of font at once: body copy in a `WinAnsiEncoding`
TrueType font, where a byte is nearly a character, and everything the exporter
subset — headings, links, bullets — in a `Type0`/`Identity-H` font, where a
*pair* of bytes is a glyph number with no relationship to any alphabet. Read
straight through, half the document comes back as noise, which is
indistinguishable from a scan. That is exactly what a real ten-page meeting-notes
PDF did: "probably a scan", with 12,000 characters of readable brief inside it.

So `shared/brief/pdf.mjs` now does what a reader does:

- finds the indirect objects, **including the ones packed inside a compressed
  object stream** — which is where every exporter since PDF 1.5 puts its page and
  font dictionaries, so a reader that only scans the file body finds no pages at
  all;
- walks the page tree, so pages come out in reading order rather than file order;
- resolves each page's fonts and each font's **`/ToUnicode` CMap** — the table the
  exporter shipped precisely so the text could be got back — handling single
  codes, listed runs, spanned runs and multi-character destinations;
- interprets the content stream tracking the selected font, and decodes every
  shown string through it;
- follows the pen, because Word places every *run* of a sentence separately: one
  for the bold part, one for the link, one for the superscript. Treating each
  placement as a new line returns a document one or two words per line. A move
  that changes the vertical position is a line; a move along the same line is a
  space — and only if the gap is wider than the estimated advance of what was
  just drawn, or every hyphenated word arrives as "multi - language".

Word gaps still come out of the kerning as well, because a PDF stores no spaces:
a `TJ` adjustment past a third of an em is where a typesetter put one.

Deliberately absent: encryption, CFF charset reconstruction, and any attempt to
invent text for a font with no `/ToUnicode` at all. Those are reported as
unreadable with the reason, which is more use than a page of glyph numbers.

#### The brief the model reads is no longer four thousand characters

Reading the document was only half of it. `briefText` was capped at 4,000
characters end to end — textarea, request, server — so a 12,000-character
discovery document arrived and immediately lost its last two thirds. In a
discovery document that is the audience, the scope, the budget and the page list:
everything worth reading. The trim was reported honestly and was still useless.

The cap is now **16,000 characters** — about four thousand tokens, a full
discovery document, and a small fraction of the model's context — stated once in
`shared/brief/schemas.mjs` and taken from there by the browser, the server, the
textarea's own limit and the file reader. The internal note that keeps the
document verbatim went from 2,000 to 6,000.

Measured against the real thing: a ten-page client PDF now reads whole, and the
concepts the brain returns cite the target audience from page 2 and the "Book a
ride" call to action from page 7 — neither of which it could previously see.

What it cannot read is named rather than hidden. A scanned PDF is a picture of
text with no text in it, and it says so — "probably a scan… copy the text out and
paste it instead" — instead of filling the brief with glyph soup, which is decided
by measuring how much of the extraction is actually letters. A `.doc` from an old
Word version is refused by name with the fix ("save it as .docx or PDF first"). A
drop of four files where one is a scan places the other three and reports the
fourth.

Where it lands is the difference between the two builders. The **simple builder**
gets the paragraph, appended under anything already written, each file under its
own name so a discovery deck and a tone-of-voice note do not run together. The
**advanced builder** gets the fields: the text goes through the same splitter a
simple-builder import uses, and the document is kept verbatim as the internal
note. If the brief server is not reachable the words are still kept, and the toast
says the split is what was missing rather than pretending it worked.

The same drop still recognises a concept export and imports it as a concept.

### A picture, dragged onto the module it is for

The imagery was in the editor and the page was in the preview. Getting one into
the other meant selecting the module, opening its Media tab, finding the slot in a
list and clicking a tile — three decisions to express one: *this* picture,
*there*.

Every tile is now draggable — the found-imagery gallery, the module picker and the
placeholder library — and every module in the preview is a target. Which slot it
lands in is read from what the pointer is actually over: a card takes that card's
picture, a split takes that half's, a band with no picture under the pointer takes
its background. The slot list is the same one the stock-imagery job fills, so a
slot that can be dropped on is a slot the pattern really renders. The module is
outlined and the exact slot is ringed while the pointer is over them, one drop is
one undo, and the module dropped on becomes the selected one so the editor follows.

A module of people refuses the drop and says why: a testimonial face has to be the
client's own colleague, not a stock model, and that rule now shows itself at the
moment somebody tries.

### The navigation's own controls stay put

The controls moved out of the navigation in 2.5.0, into a strip below it — and
became unusable. The strip is drawn over whatever module follows the header, so
reaching a button meant crossing those pixels, one `mousemove` retargeted the
overlay to the hero, and the arrows were gone before the pointer arrived. The
navigation could be looked at and never changed.

The band the strip occupies now reads as part of the header for as long as the
header is what is being described, and releases the moment the pointer is past it,
so the module below is still selectable. On a phone shell the strip keeps the
arrows and the actions and drops the label, which had nowhere to go in 390px.

### "Edit module" lands on the module editor

The button changed step and left the editor at the top of it — which in the
modules step is the brief reader, then the imagery panel, then the page sequence,
with the module editor below the fold and nothing to say the page had moved. It
now travels there: an animated scroll unless motion is switched off, and the panel
marked for a moment on arrival.

### A programmatic edit no longer loses to its own stale markup

Found while the document drop kept coming out empty, and it was not the document
reader. Replacing the editor's markup blurs whatever was focused, a blur on an
edited field is answered with a `change`, and that `change` carries the value the
field held **before** the render. To every handler on the editor that is
indistinguishable from typing — so any programmatic edit that caused a render was
overwritten by its own stale markup a moment later. Nothing that happens during
the swap is a person editing, so nothing during the swap is delivered.

## 2.5.0 — The global parts, and the panels that were too long

### The navigation and the footer step like a module

Hovering a module in the preview has always named its pattern and offered arrows to
walk through the registered alternatives. The two global parts were the one thing on
the page that could not be changed that way — the overlay ignored them on purpose,
with a comment saying neither was "a module anyone can swap".

They are now addressed exactly like a module: the same overlay, the same arrows, the
same left/right keys, one undo per gesture, and the element repainted in place
rather than through a full frame rebuild. What stands in for the pattern is the
layout variant, and each part now has five:

- **Navigation** — Standard (logo left), Centred logo, Stacked (logo over a centred
  menu row), Floating bar (inset, rounded, reads as a panel), and Minimal.
- **Footer** — Editorial statement, Compact utility, Centred closing, Statement
  beside the menus, and Minimal sign-off.

Minimal navigation now does what its name says. It used to hide the desktop links
and show nothing in their place; the burger appears at every width and opens a real
panel of links, driven by the `menu-open` class the header runtime already toggled.

The overlay also carries the phone menu style, because the takeover is the one
navigation decision nobody remembers to go and check: one button cycles Centred →
Left → Right → Aurora, and the preview repaints with it.

Nothing about this is a second source of truth. Both variants are catalogues —
`HEADER_VARIANTS` and `FOOTER_VARIANTS` — read by the editor select, the preview
CSS, the overlay and the exported navigation and footer JSON. Stepping from the
preview moves the select; choosing in the select moves the preview; the export
carries whichever was chosen. An unrecognised variant from an older project or a
style that named one that no longer exists resolves to a real layout on every
ensure pass instead of falling through to unstyled markup.

Because the header's own behaviour — sticky class, announcement dismiss, burger —
was bound once when the document loaded, swapping the element in place would have
left a dead toggle. Those bindings moved into `__sbsBind` as `__sbsBindChrome()`,
idempotent like the rest of it, so the replacement works immediately.

### Buttons that no longer jump away from the cursor

Solid Shift and Pill Glow were the two families that translated the whole button
upward on hover, Pill Glow far enough to read as the button moving out from under
the pointer. Neither travels now: Solid Shift deepens its shadow and keeps its
colour inversion, Pill Glow grows very slightly in place and keeps its glow. Solid
Shift says `transform:none` explicitly, because `dst-shared.css` gives every button
a shared -2px lift that a missing rule would let through.

### A button label you can actually read

Every label colour in the button system was written as white, because the ground
behind a button was assumed to be dark. Across fifty archetypes it is not: a pale
accent — sand, mint, citrus — produced white text on a light fill, and the worst
pair in the library measured **1.09:1**, which is a button with no visible label at
all.

The four DST button tokens and every hard-coded white in the ten families now read
from `--sbs-on-accent` / `--sbs-on-ink`, which the page derives from its own palette
by asking which of white or the page's ink can be read on that fill. Across the 50
styles, label-on-ground pairs below 4.5:1 went from **27 of 150 to 3**, and the
worst case from 1.09:1 to 4.00:1 — the remaining three being the best any colour
can do on those accents without moving the palette the style deliberately chose.
The editor swatches publish the same two tokens, so a family cannot read correctly
in the preview and look broken in the panel.

### The AI writes the footer

Applying AI content rewrote every module and left the closing band on the
demonstration project's statement — the last thing on the page, and the one piece of
copy that was never asked for. The content job now returns a `footer` object with
the closing statement, its supporting sentence and its button label. It is reviewed
in the draft list with the sections, applied with them, and reversed by the same
single undo. The legal line, the menu columns and every link are untouched, because
none of those are copy the brain was asked for.

The footer is optional in the answer and never optional in the result: a model that
skips it gets the deterministic footer, assembled from the strategist's own words
like every other sentence the planner writes. A draft carrying no closing statement
leaves the existing footer alone rather than overwriting it with empty strings.

### Design dials: one sample, two to a row

The live sample was three cards demonstrating the grid gap, which the preview beside
it already shows, at three times the height. It is one card now, still carrying every
token the panel is about — padding, radius, border, shadow, type scale, line height,
reading measure.

"Replay the movement" is gone, along with the automatic replay that fired whenever
the movement dial moved. It re-ran an entrance nobody had asked to see.

The nine dials are paired two to a row. They are short controls — a label, a track,
two words of scale — and one per row was most of the panel's height.

### Saving is a notification, not a readout

The top bar said "Saved locally" permanently, whether or not anything had just been
saved. It is now a pill at the bottom right that says **Saving** while the write is
pending, **Saved** when it lands, and then withdraws. It keeps an `aria-live`
announcement, since nothing in the bar carries the state any more.

Writing the pill turned up a real defect underneath it. Autosave is debounced by
420ms, and nothing flushed it: close the tab, reload, or lock the phone inside that
window and the last edit was gone. A pending save is now written on `pagehide` and
on the page becoming hidden. Two existing reload tests had been passing on the
knife edge of that race and started failing when this release shifted the timing by
a few milliseconds — which is how the defect was found.

### Simple Step 01, condensed

The step asks for one paragraph and then offers five panels of controls, which was a
long scroll past things most briefs never touch. Every panel is a disclosure now.
Four open, and **Button family** starts closed with the chosen family named in its
summary — the concept already picked one, and its ten live samples were the tallest
thing on the step. Navigation and footer stays closed as before.

### Every photograph gets a wash, not two families

Copy over a picture needs something between the two. That existed for `hero` and
`cta`, and an audit of all **154 registered patterns** says the list was the wrong
shape: **19 more patterns paint a photograph behind their copy and painted nothing
over it** — six `team` bands, six `cards`, two `faq`, two `timeline`, a `text` band
and a `testimonial`. Fifteen of the nineteen had *dark* copy, so whether the words
could be read depended entirely on what the photograph happened to be doing behind
them.

The family list is gone. The rule is the condition itself: **a section that paints
a photograph and is not already painting a wash gets one — the brand's own dark at
60%** — and because 60% is the strength at which the wash *is* the ground rather
than a tint, the copy inverts to suit. Both halves matter: darkening the ground
without inverting fifteen bands of dark type would have made them worse.

Three things it deliberately does not do:

- **A pattern that paints its own wash keeps it exactly.** `sbs-hero-p89-v1`'s
  `#240800` at 60%, `p89-v2`'s 27% white tint (a tint, so the photograph stays the
  ground and the copy stays light), `p89-v3`'s pale gradient (which *is* the ground,
  so that band reads dark-on-light) — all untouched.
- **A colour the pattern carries but does not paint is not a wash.** Three of the
  nineteen had an overlay colour with the flag off, which rendered nothing; those
  get the default.
- **It follows the brand.** The wash is the palette's `dark`, so restyling a project
  moves it — otherwise a page restyled from navy to forest keeps a navy scrim over
  every photograph. The colour written is recorded, so the moment anybody edits a
  wash by hand it stops matching and is never moved again.

The `contact` band's own 50% wash went with the list. It was a second convention
for the same job — alpha-carried rather than strength-carried — and weaker than the
banners for no reason anyone had written down. One rule now covers it at the same
60%.

The wash also reaches a photograph that is not on the node the surface control
edits: `sbs-faq-p6-v2` paints its picture on a banner three levels down, and the
old code would have washed the wrong node.

### The overlay no longer covers the navigation it describes

The navigation is 80-odd pixels tall and every one of them is a control — logo,
links, the action, the burger. The overlay's bar, tools and arrows sat straight on
top of them, so hovering the navigation to change it made the burger unclickable.
They now sit in a strip immediately below the bar. The footer keeps the inside
placement: it is tall, has nothing at its top edge, and moving its controls above
it would push them off the stage whenever its top is scrolled past.

### Two defects the timing changes surfaced

Selecting a module is supposed to scroll the preview to it. It scrolled with
`behavior: 'auto'`, which is not "instant" — it defers to the document's own
`scroll-behavior`, and the preview page sets that to `smooth`. So every jump was
animated, including the one taken when movement is switched off, and an animated
scroll is cancellable: re-fitting the frame — which happens on every step change
and every rescale of the shell — cancelled it outright. Select a module within a
beat of switching step and the preview simply stayed where it was. The instant
path now really is instant, and the animated one verifies that it started: if the
frame has not moved at all a moment later, the scroll is made immediately. It only
does that when the position is untouched, so it can never fight a reader who has
scrolled somewhere themselves.

Several specs measured *inside* the preview document while a queued rebuild was
still pending, which replaced the document under them — "Execution context was
destroyed", or a sampling loop's promise garbage-collected. `previewSettled()` in
`tests/browser/support/preview.mjs` waits for the frame's load events to go quiet;
waiting for the frame to *contain* something never was enough, because the
outgoing document contains it too. The same race had a second face: a rebuild also
re-renders the editor, so a field a spec was holding could be detached before it
was typed into, and a colour set on the detached node went nowhere.

### QA

- `tests/browser/global-parts.spec.mjs` — 10 tests: the overlay on both parts, the
  keys walking all five layouts and wrapping, the five compositions measured as
  genuinely different, the minimal navigation's desktop panel opening and closing,
  the phone menu cycling through all four, no footer layout losing its statement,
  menus or legal line, the select and the export agreeing with the overlay, one undo
  per step, the burger still working after the element is swapped, and a module
  still stepping its own pattern.
- `tests/browser/photo-scrim.spec.mjs` — 5 tests: every one of the 154 patterns
  that paints a picture also paints a wash (with the count asserted, so it cannot
  pass by finding nothing), every background-media card keeps its scrim, the wash
  is the brand dark at 60% with the copy inverted, an authored wash survives
  untouched in all three of its forms, and a default wash follows the brand while
  an edited one never moves.
- `tests/browser/global-parts.spec.mjs` — 2 more tests: no overlay control overlaps
  the navigation's own box, and the burger can be clicked while the overlay shows.
- `tests/browser/save-pill.spec.mjs` — placement, both states, the withdrawal, and
  an edit surviving a reload that happens inside the debounce window.
- `tests/browser/button-styles.spec.mjs` — two new tests: no family travels
  vertically on hover, and the worst label/ground contrast across all 50 styles.
- `tests/browser/brief-brain-ui.spec.mjs` — two new tests: the footer drafted,
  reviewed, applied, exported and undone; and a draft with no closing copy leaving
  the footer alone.
- `tests/unit/button-styles.test.mjs`, `tests/unit/brief-planner.test.mjs`,
  `tests/unit/brief-schemas.test.mjs`, `tests/integration/brief-brain-api.test.mjs` —
  nine new tests covering the hover rules, the derived label tokens, the
  deterministic footer, the footer coercion and the server's fallback.
- Every navigation and footer layout rendered through real DST and inspected as
  screenshots.

### Still failing

`tests/browser/legibility.spec.mjs` → "catches a band that really is unreadable"
remains failing for the reason recorded under 2.4.0. It is unrelated to anything in
this release.

## 2.4.0 — The Style Library

### Ten families, fifty production styles

`src/data/style-library.json` now holds 50 style profiles across 10 families —
Technology, Luxury, Editorial, Corporate, Commerce, Hospitality, Automotive /
Mobility, Health / Wellness, Creative / Culture and Experimental — five each, under
stable keys like `creative-culture/art-gallery`. They are authored in
`style-factory/style-seeds.json` and built by `npm run styles:build`.

A concept records the style it resolves from, so an export names it:
`concept.style` carries the family, the style, the version and the variation.

### A style is not a palette preset — and that is enforced

A profile has to take a position on every axis the engine can vary, and choosing one
moves all of them: palette, display and body type, radius and button family; **all
nine Design Dials**; **composition** (alignment, container bias, media dominance,
surface treatment, asymmetry, full-bleed bias); **component recipes per section
family** (container, vertical rhythm, inversion, arrival effect, column counts,
decorative motif); and **pattern preferences**.

The last of those is the point. `compilePatternWeight` scores every candidate
pattern against the style's preferred and avoided terms, so switching from Art
Gallery to Precision SaaS does not recolour the same page — it re-selects the
modules out of the same 154 patterns, carrying the existing copy across. Terms
rather than pattern ids, matched against the profile the ranker already builds from
each catalogue entry, so a preference survives the catalogue growing. A pattern the
strategist picked by hand is locked and never re-selected.

`shared/styles/distinctness.mjs` scores all 1,225 pairs across those axes with
**palette weighted lowest**, and the build refuses a catalogue containing a
near-clone. Three pairs were rejected during authoring — `dark-prestige` against
both `resort-editorial` and `culinary-luxury`, and `technical-grid` against
`technical-automotive` — and were redesigned rather than nudged past the threshold.
A unit test proves the gate works by recolouring one style and asserting it still
reads as a clone.

### The picker, in both builders

Family, then style: Advanced Step 02 and Simple Step 01. The 13 original A–M
archetypes remain as the older, coarser path, and choosing one now clears the
concept's style reference rather than leaving it claiming a style it no longer
follows.

### One style, three concepts

`Generate V1/V2/V3` builds all three from the chosen style so a client compares
interpretations of one design language: **V1 Core** as authored, **V2 Brand-led**
with the client's colours as far as the style's own `brandMapping` allows, **V3
Expressive** pushing the axes the style is already strongest on. The display
typeface never changes between them, and a protected palette role is never taken by
a brand colour — a gallery style whose canvas turns burgundy has stopped being a
gallery style.

Precedence is fixed: style default → variation → brief/brand directives →
concept-specific manual edits, with manual edits last and authoritative.

### The factory

```bash
npm run styles:build      # seeds -> profiles, validate, distinctness, docs, evidence
npm run styles:validate   # the same checks without regenerating documentation
```

Emits the runtime catalogue, `styles/<family>/<style>/{style.json,DESIGN.md}` for all
fifty, `style-factory/STYLE.schema.json` generated from the same constants the
validator uses so the two cannot drift, and
`release-evidence/style-catalog-qa.json` plus `style-distinctness.json`. Structural
checks beyond the schema: five styles per family, unique keys, all nine dials set,
and every component recipe naming a real section family and a real decoration motif.
`style-factory/STYLE-CONSTITUTION.md` defines what every permitted value means.

### Also in this release

The concept row actions on the Review step were four sentences of label inside a
fixed 27px icon square, so they overflowed and printed on top of each other. They
are icons now — open, reset, copy-into — each with an accessible name and a hover
label that stays inside the editor column, held by a browser test that measures
overlap and tooltip bounds.

The typed-outline builder now lists what can be typed into it. "The page will
have…" over an empty box asked the strategist to guess the vocabulary, and a guess
the mapper cannot resolve comes back as an unresolved line. All 19 registered
section families are listed with what each is for, and each is a button that appends
itself to the outline and renumbers the list — so the box can be filled without
typing and without guessing. The list stays open until it is closed on purpose, and
the same family can be added twice, because a page flow is a sequence. The block was
also duplicated in the advanced and simple flow steps; it is now one function used by
both.

### QA

- `tests/unit/style-library.test.mjs` — 31 tests: every profile valid, the named 50
  present under the expected keys, fonts/buttons/motifs/section families all real,
  distinctness including the recolour control, the compiler's variations, brand
  mapping and precedence, pattern weighting and component recipes.
- `tests/browser/style-library.spec.mjs` — 7 tests: the picker in both builders,
  choosing a style changing patterns *and* containers *and* dials *and* palette
  while preserving the copy, three concepts from one style, the export carrying the
  style, a per-concept style surviving a reload, and an archetype clearing it.
- Five gold-standard styles rendered through real DST and inspected as screenshots.

### Known failing test

`tests/browser/legibility.spec.mjs` → "catches a band that really is unreadable" is
failing. It is a negative control: it breaks the palette by hand and expects the
rendered-contrast audit to notice. Making the style's pattern preferences part of
the ranking tie-break changed which patterns that test's page ends up with, and the
bands the audit samples now paint their own grounds, so the broken palette no longer
produces a combination the audit can see. The product behaviour is intact — the
rendered page does reflect the broken palette, and the four other legibility tests
including the positive control across all 13 archetypes still pass. The control
needs to pin its patterns rather than depend on the ranker; it was left failing
rather than weakened to go green.

## 2.3.0 — Three concept workspaces

### V1, V2 and V3 are three independently editable websites

A project now holds exactly three **concept workspaces**, and each one is a
complete website proposal: its own style reference, palette, fonts, all nine
Design Dials, button family, page flow, module sequence, pattern choices, section
content, layout, responsive settings, media placements, navigation, footer, page
metadata, publish state and revision. The brief, the AI brief analysis, the client
identity and the Shutterstock media *pool* stay shared at project level, because
those describe the source material rather than the proposal.

Before this, a concept owned a slice of `project.design` and switching concepts
meant reading values out of the live project and writing them back into the
concept they came from. Anything the capture list did not name — a section, a
pattern choice, a mobile column count — was shared between all three concepts
whether you wanted it to be or not, and anything it named incorrectly was lost.

The replacement is structural rather than procedural. `bindProject` in
`shared/concepts/workspace.mjs` installs accessors on the project for `design`,
`sections`, `header`, `footer`, `flowId`, `page`, `style` and `manualOverrides`,
and every one of them resolves through `conceptSet.activeConceptId` on each read
and each write. Five thousand lines of existing editor code therefore edit the
active concept and nothing else, and there is no moment at which an edit exists on
the project but not yet in a concept. Nothing has to be captured because nothing
was ever detached. `captureConceptEdit` is gone.

### The switcher belongs to the project, not to one builder

The V1/V2/V3 pills now render in Simple **and** Advanced, on every step where a
concept exists, and each pill names the concept it opens rather than a list index.
A pattern swap or a mobile column count set in Advanced is there when you go back
to Simple, because both are editing the same workspace.

### Undo and redo are per concept

Editing V1, switching to V2, editing V2 and pressing undo undoes the V2 change.
Each concept keeps its own stack, an entry carries the shared project state so a
brief edit comes back with the step that made it, and switching concepts is
navigation — it pushes nothing and clears nothing. Typing coalescing was also made
per concept: an 850ms window left open by a slider in one concept used to swallow
the first checkpoint of an edit made in another, leaving that concept with an edit
and no way to undo it.

### Exports name the concept they came from

Every artifact carries `concept.conceptId`, `slot`, `variantType`, `revision`, the
resolved style reference and the nine dial values, and export filenames carry the
slot. Three concepts used to produce three indistinguishable `page.json` files for
the same client, and importing the wrong one was a silent failure. A new
**all-concepts archive** (`data-export="all-concepts"`) writes one ZIP with a
folder per concept, each holding that concept's four artifacts plus a manifest.

### The first flow reaches all three concepts

Three proposals built on three different page structures are not a comparison, so
the first flow chosen applies to every concept that has not been edited yet. A
concept somebody has worked on keeps its own flow, and a later flow change reaches
only the concept on screen. Nothing structural is ever propagated over existing
work.

### Reset and copy, deliberately

The Review step in both builders gains a **Concept workspaces** panel listing each
concept with its design source, variation, module count and revision. From there a
concept can be reset to the workspace it was generated as, or copied over another
slot. Both confirm first, and neither ever copies publish state or a public link.

### Older projects load unchanged

A pre-3.0 project becomes V1 exactly as it was — same sections, same design, same
globals, same ids — with V2 and V3 left empty. Nothing is re-derived, because
re-resolving somebody's approved work against today's defaults would change it. A
2.2.x `project.simple.concepts` set is the one exception: those really were three
design proposals, so their palettes, fonts, buttons and dial nudges are carried
onto the matching slot and a full workspace is built around each.

The session envelope moved to `sbs-builder-v3` and stores the canonical concept
set once, plus which concept was open. The two older keys are still read, so a
returning session migrates on load.

### One flow catalogue, counted once

The data file shipped 20 flows and the runtime pushed 15 more onto the array at
boot — five from `SBS_EXTRA_FLOWS`, ten from `SBS_V3_FLOWS` — while every loaded
project pushed its own typed flows on top of that. So the number of flows in the
product depended on which projects a session had opened, and no two places agreed
on the count: the data file said 20, a unit test asserted 15, the README claimed
30, and the running product had 35. The QA script that produced the "30" figure
scraped one injection block and missed the other.

All 35 flows now live in `src/data/dst-data.json`, which is the whole catalogue.
The runtime injects none, `DATA.flows` is frozen, and a flow a strategist types
stays on their project and is joined in by `allFlows()`. Data, runtime, tests,
QA scripts and README now report the same 35.

### QA

- `npm run qa:concepts` — 24 object-level checks covering migration, generation,
  isolation, lossless switching, storage round-trip, per-concept history and the
  deliberate reset/copy operations. Writes `release-evidence/concept-isolation-qa.json`.
- `tests/unit/concept-workspace.test.mjs` — 29 unit tests on the concept model.
- `tests/browser/simple-builder.spec.mjs` — rewritten to the workspace contract,
  including three concepts diverging in content and structure, repeated round-trips,
  a reload that restores all three, per-concept undo, and exports proving which
  concept they came from.

Two assertions in the browser suite described a product that had already moved on
and were failing before this work started — the flow step offers five
recommendations rather than three, and the Simple review exports the same
artifacts as Advanced rather than one. Both are fixed against what the builder
actually does.

## 2.2.2 — Simple/Advanced parity, Shutterstock URL lookup, richer flow planning

### Simple builder gets the complete Design Dials

The Simple builder now uses the same nine system-wide Design Dials and quick-style presets as Advanced. Moving a slider writes the same canonical design state and immediately changes the live preview; concept switching captures those edits instead of losing them. The Simple review step also exposes the same navigation, footer, page, standalone HTML and complete-project ZIP exports as Advanced.

### WordPress receives the resolved visual system

`page.json` now carries both the raw nine dial values and the complete resolved `sbs-design-dials/1.0` token set. The bundled WordPress importer consumes those tokens through an allowlisted mapping for containers, vertical rhythm, reading measure, type scale, card spacing/surfaces, imagery treatment and motion. This removes the previous approximation where WordPress could receive the same block tree but miss design-dial-derived presentation values.

### Shutterstock URL / ID lookup is robust

The media library accepts either a numeric Shutterstock asset ID or a full public Shutterstock asset URL, including URLs with tracking query parameters. The lookup reads the asset ID from the actual asset path before unrelated tracking numbers, resolves images first, and only checks the video catalogue when needed. Added assets remain watermarked review previews with their Shutterstock ID and licensing link.

### Five better flow recommendations

The Brief Brain now returns five flow recommendations instead of three. The recommendation catalog gains five richer 10–11 module journeys and the full in-browser library now totals 30 flows covering experience-led storytelling, service conversion, product discovery, authority/resources and community/brand storytelling. Deterministic ranking now includes a diversity pass so the five recommendations are useful alternatives rather than near-duplicates; AI prompts explicitly request varied journeys and richer flows when the brief warrants them.

### QA / regression protection

The release adds `npm run test:upgrade`, covering Shutterstock parsing/preview lookup, five-flow schemas/planning, richer-flow catalog integrity, Simple Design Dial parity, Simple/Advanced export parity hooks and WordPress design-token consumption. Browser QA verifies all nine Simple dials, live token changes, five flow recommendations, Simple export actions and byte-equivalent Simple/Advanced page JSON after timestamp normalization. The WordPress unit and full 154-pattern catalog sweeps remain part of the handoff checks.

## 2.2.1 — The mobile navigation

### The menu toggle was invisible on every palette

Not a contrast oversight — a specificity one. The toggle is a `<button>`, and a
button does **not** inherit `color`: the user-agent `buttontext` keyword wins. So
`background:currentColor` on the bars resolved to pure black on every theme,
which is black-on-near-black on any dark palette. It was also two 1px hairlines,
so even where the colour happened to contrast it read as a smudge.

The colour is now chosen by measured contrast against the canvas the header sits
on — the palette's dark tone on a light canvas, white on a dark one — so it holds
for all thirteen archetypes and any hand-edited palette. Measured: 15.5:1 on
archetype A, 19.7:1 on F, 13.3:1 on C. The bars are three, 2px, in a 44px target.

### The toggle animates

Three bars spread slightly on hover, then the outer two cross to an X while the
middle one scales away. Speed comes from the Movement dial, and zero means no
transition at all.

### Tablet and mobile get a real takeover

Opening the menu now fills the viewport: content centred on both axes, links in
the display face at `clamp(2.8rem, 7.2vw, 4.8rem)` — 48px on tablet, 28px on
mobile, against the 14.5px it was — arriving one after another. The brand stays
pinned top-left and the close control top-right. The call to action, previously
hidden behind the menu that replaced it, is now in the menu. Page scroll is
locked while it is open, `aria-expanded` and the label track the state, and
Escape closes it and returns focus to the toggle.

All of it ships in the exported standalone HTML, not just the preview.

## 2.2.0 — The simple builder

A second builder, over the same project model. The advanced builder is unchanged;
this adds a narrower path designed for one job — getting three credible concepts
in front of a client in one sitting — and a clean handoff into the advanced
builder afterwards.

### The switch

A labelled two-state control in the top bar. The sidebar heading, the step list
and the accent colour all change with it, so which builder you are in is never a
guess. The choice persists.

The **Export page JSON** button is gone from the chrome in both builders —
exporting belongs at the end of the flow. Undo, redo and Open preview sit on the
right.

### Simple builder · Step 01 Brief and Direction

One textarea replaces the nine brief fields. The brain reads it and returns:

- a five-line readback, so a wrong reading is obvious before anything is built;
- **three complete concepts**, each with its own archetype, palette, type, all
  nine design dials (via a named quick style plus deliberate nudges) and a button
  family, with a sentence explaining why;
- the three best page flows for the brief.

Palette, type and the button family are on this step. Navigation and footer are
collapsed by default. The step cannot be left until a concept is chosen.

### The V1/V2/V3 pills

Float over the live preview at every step. Clicking one applies that concept
immediately.

A concept resolves to the design slice and nothing else, which is what makes this
safe: switch concepts after choosing a flow, writing copy and editing a module and
all of that work is untouched. A design edit made while a concept is selected is
recorded on that concept, so previewing another and coming back keeps it.

### Simple builder · Steps 02–04

- **Page flow** — the three recommendations and the typed-outline builder. The
  30-flow library and the page sequence are not on this step.
- **Modules** — the page sequence, one button that writes the whole page's copy
  from the brief, and a module editor with Content, Media and Layout + effects.
  No Extended view, no DST tree.
- **Review & export** — the same 27 preflight gates, and one download: a concept
  JSON carrying the page, the navigation, the footer, the brief, the design and
  all three concepts.

### The handoff

Import that JSON in the advanced builder's Step 01, by file picker or drag and
drop. Sections, content, flow, custom flows, globals, design and all three
concepts come across, and the paragraph is split into the nine brief fields so
every later AI job has what it needs. The mode switches to advanced on import.

### Two AI jobs added

`POST /api/brief/concepts` and `POST /api/brief/expand`, both with deterministic
twins. The concept job refuses a set where two concepts share an archetype, and
refuses any archetype, quick style, button family or flow id outside the catalog
it was sent.

### Fixes found while building this

- The feature's event bridge was handed a different context object from its
  panels, so a concept click reached a context with no `applyConcept` on it.
  There is now one context.
- `normalizeApiError` reported *any* non-network error as "start the local
  server", which sent the user to fix the wrong thing and hid the real fault. It
  now names the actual error and logs the stack.
- `Number(null)` is `0`, so the "nothing chosen yet" state was silently
  pre-selecting V1 and defeating the first step's exit condition.
- The concept export carried the DST node tree but not the builder's own section
  model, so an import rebuilt every module from pattern defaults and discarded
  the copy the strategist had written.
- A palette edit made on a concept was lost when previewing another concept and
  returning, because only dials were captured.

### Tests

125 unit/integration tests and 116 Playwright tests, all passing, plus the
unchanged WordPress handoff suite (19/19 assertions).

## 2.1.0 — AI Brief Brain, design dials, button families

### The AI model now reads the brief

The **Website inspiration / Style DNA** panel is gone, along with its whole
server pipeline (browser capture, screenshot analysis, job store, blend
synthesis). The one configured Ollama model now does three jobs driven entirely
by the Step 01 brief:

- **Step 01 — read my brief.** The brain reads back what it understood, field by
  field, beside the strategist's own words, with a confidence score. It then
  recommends one DST visual archetype and the three best page flows, each with a
  reason drawn from the brief. It can also draft the copy for every section in
  the current flow.
- **Step 03 — plan the flow.** The same model ranks every flow in the library,
  and turns a typed outline ("The page will have 1. Hero 2. Before after image
  gallery 3. A pricing 4. Testimonials") into a real sequence of registered DST
  modules. Any mapping can be corrected without retyping the outline.

The model may only choose from vocabularies the server sends it, every answer is
schema-validated, and nothing it produces can introduce a component or attribute
that is not registered. When the model is unavailable or answers off-contract, a
deterministic planner answers instead and the UI says so.

### Design dials that are actually visible

The three old dials moved measurable tokens but produced changes a strategist
could not see. There are now **nine dials** — Density, Reading width, Headline
size, Brand colour emphasis, Surface definition, Corner softness, Image
presence, Movement and Expression — grouped into six labelled sections, each
with a plain-language readout ("48 · Balanced") and a sentence explaining what it
changes.

Two structural changes make them obvious:

- Each dial drives a wide range of CSS custom properties *and* a discrete band
  (`data-density-level`, `data-motion-level`, …) that switches whole rules on, so
  crossing a band is unmistakable.
- Step 02 shows a **live sample** that reflects the dials without scrolling the
  preview, including a **Replay the movement** button.

Measured across the full range on the default page: headline 58px → 148px, hero
height 522px → 900px, section gap 15.4vmin → 4.8vmin, header 108px → 64px, card
radius 0 → 44px, reveal travel 0 → 92px, reveal duration 0s → 0.96s, logo
marquee 96s → 14s. Movement at 0 switches motion off entirely and reveals all
content immediately.

### Five button families

Where Style DNA used to be, Step 02 now offers five complete button systems —
**Solid Shift**, **Sweep Fill**, **Offset Block**, **Pill Glow** and **Magnetic
Arrow** — each defining the primary action, the secondary action and the text
link together with its own hover behaviour. Each is shown as a live, hoverable
sample built from the real DST markup and the real CSS. The choice applies to
every registered button in the preview and travels into the theme export.

### Basic and Extended module views

Step 04 opens in **Basic view**: the six choices a strategist understands, in
plain language, with no padding tokens or breakpoint values. **Extended view**
still exposes every registered DST attribute. The choice persists.

### More page flows and more preflight checks

- The flow library grew from 20 to **30** flows.
- Preflight grew from 14 checks to **27**, adding placeholder-copy detection,
  headline length, duplicate headlines, proof presence, closing action, section
  rhythm, page length, button family, motion budget, palette contrast, type
  scale, brief completeness, AI provenance and flow provenance.

### Preview

- The preview pane is about 20% wider (988px instead of 808px at 1680px).
- The tablet gained a bezel to match the phone, drawn with box-shadow rings so
  the emulated viewport stays exactly 820px.
- Fixed: the desktop preview was being flex-shrunk to 1418px instead of 1440px.

### Component defaults and corrections

- **Card media overlays never rendered.** `dst-shared.css` carries
  `.dst-card--media-background > *:not(.c-block__media){position:relative}`,
  which is more specific than `.c-block__scrim{position:absolute}`, so the scrim
  lost its geometry, collapsed to a zero-height flow element, and every
  media-background card put white text straight onto a photograph. The scrim's
  own geometry and the media/scrim/copy stacking order are now re-stated from
  inside `#sbs-site`.
- **Card grids open four across** (two on tablet, one on mobile), capped by the
  item count so three cards never leave a hole where a fourth should be.
- **Logo bands read as one row** — six across, four on tablet, two on mobile —
  instead of a single stacked column.
- **Contact bands ship a flat 50% wash** so the form and its labels are legible
  over a photograph. The alpha lives in the colour and the element opacity stays
  at 1, because setting both would multiply into a 25% wash while the control
  still claimed 50%.
- **Accordions animate open and closed.** Native `<details>` does not, so this
  uses `::details-content` with an interpolatable `auto`; a browser without
  either support drops the rules and the accordion still opens, just instantly.
  Speed comes from the Movement dial, with a floor so a disclosure never reads
  as a page reload — except at zero, where Still means still.
- **The preview follows the selected module.** Choosing a row in either module
  list scrolls the preview to that section, landing it just below the sticky
  header, and marks it for a moment so you can see where you are.

### Hero fit

- A hero with a centred heading kept a left-pinned inner, so a "centred" hero
  read as off-centre on every wide screen.
- A hero built from a two-column layout inherited the single-column cap of
  `min(74rem, 56vw)` and squeezed the copy and image into a third of the page
  each. Those heroes now fall back to the authored `--cw`, so a deliberate
  `contentWidth` is still honoured and only the hero's own editorial cap is
  dropped. The `11ch` display measure is also relaxed inside a column.

### Fixes found while building this

- A saved project whose `sections` was not an array bricked the editor
  permanently; it now falls back to a fresh project.
- The module-editor view preference was not persisted.
- `ensureBrainState` replaced the state object, silently detaching in-flight
  async writes.
- A disabled-state patch left `aria-disabled="true"` behind, announcing an
  enabled button as disabled.
- The deterministic draft under-filled sections that render a fixed item count.
- The new preview-follows-selection scroll left its pending target armed after a
  successful scroll, so the next unrelated preview rebuild jumped back to the
  last selected module instead of holding the reader's position. Caught by the
  existing `preview-scroll` test only when the whole suite ran together.

### Tests

93 unit/integration tests and 85 Playwright tests, all passing, plus the
unchanged WordPress handoff suite (19/19 assertions).

## 2.0.0

Complete project bundle ZIP, editable navigation and footer template parts,
layout fidelity controls, and the tailored WordPress importer.
