# Style constitution

The vocabulary every style profile is written in, defined once so two styles cannot
mean different things by the same word. A profile is validated against
[`STYLE.schema.json`](STYLE.schema.json); this document defines what the permitted
values *mean*, and what a strategist should expect to see when a style claims one.

Where a term maps onto a measurable value in the engine, that value is given. A
term with no measurable definition does not belong in a profile.

## The rule the rest of this document serves

> A style is not a palette preset.

Fifty styles that differ only in colour are one style with a colour picker. So a
profile has to take a position on every axis the engine can vary, and
`shared/styles/distinctness.mjs` scores exactly those axes with palette weighted
*lowest*. Two styles that pass on colour alone are rejected by the build.

## Polarity

| Value | Meaning |
| --- | --- |
| `light` | The body canvas is lighter than the ink. Most bands read dark-on-light. |
| `dark` | The body canvas is darker than the ink. Most bands read light-on-dark. |

Polarity is about the *canvas*, not about how many bands are inverted. A light style
may invert its hero.

## The nine dials

Each dial is 0–100 and resolves to CSS custom properties plus a discrete band. A
profile must set all nine: an unset dial falls back to a neutral 50 and the style
stops being a style on that axis.

| Dial | 0 | 100 |
| --- | --- | --- |
| `density` | Very few things per band, long vertical rhythm | Many things per band, short rhythm |
| `measure` | Narrow reading column | Wide, near-full-width text |
| `headline` | Display type close to body size | Poster-scale display type |
| `accent` | Brand colour almost absent | Brand colour throughout |
| `surface` | No visible edges, shadows or fills | Strongly defined panels, borders, fills |
| `corner` | Square | Fully rounded |
| `imagery` | Text-only | Photography dominates every band |
| `motion` | Nothing moves (0 disables motion entirely) | Sequenced reveals, parallax, autoplay |
| `expressiveness` | Conventional, safe composition | Deliberately unusual composition |

## Composition

### `alignment`

| Value | Meaning |
| --- | --- |
| `left` | Flush-left type, consistent left axis down the page |
| `centered` | Headlines and lead copy centred in their container |
| `split` | Two-column bands are the default rhythm |
| `asymmetric` | The axis moves deliberately between bands |

### `containerBias`

The container a band uses when its style has no specific recipe: `full` (edge to
edge), `wide`, `default`, `alt` (the alternate ground). A `full` band is never
narrowed by a bias — a full-bleed decision is deliberate and outranks a default.

### `mediaDominance`

| Value | Meaning |
| --- | --- |
| `none` | Type and shape only; photography would weaken it |
| `supporting` | Images illustrate; a band works without them |
| `balanced` | Image and text carry equal weight |
| `dominant` | The image is the band; text sits beside or under it |
| `immersive` | Full-bleed media with type laid over it |

### `surfaceTreatment`

| Value | Meaning |
| --- | --- |
| `flat` | No borders, no shadows, no fills |
| `bordered` | Visible hairlines and boxes define structure |
| `raised` | Soft shadows lift cards off the ground |
| `layered` | Overlapping planes at different depths |
| `glass` | Translucent surfaces over a coloured field |

### `asymmetry` and `fullBleedBias`

Both 0–100. `asymmetry` is how often the axis deliberately shifts; `fullBleedBias`
is how often a band runs to both edges rather than sitting in a container.

## Brand mapping

How far the client's own colours are allowed into the style.

| Strategy | Roles the brand may take |
| --- | --- |
| `accentOnly` | `accent` |
| `accentAndSurface` | `accent`, `soft` |
| `full` | `accent`, `soft`, `dark`, `ink`, `bg` |

`protectedRoles` overrides the strategy: a role listed there is never taken,
whatever the brief says. A gallery style whose canvas turns burgundy has stopped
being a gallery style.

Only the **brand-led** variation maps beyond the accent. **Core** takes no brand
colour at all; **expressive** takes the accent only.

## The three variations

Every concept set is three interpretations of *one* style, not three styles.

| Variation | What changes |
| --- | --- |
| `core` | Nothing. The style exactly as authored. |
| `brand-led` | The client's colours enter as far as `brandMapping` allows; brand emphasis rises. |
| `expressive` | The axes the style is already strongest on are pushed — scale, movement, expression — and density eases. |

The display typeface never changes between variations. Three concepts that do not
share a typeface are three styles, and the client was promised a comparison.

## Pattern preferences

Terms, not pattern ids. A term is matched against the profile the ranker already
builds from each pattern's own catalogue entry — its `look`, `bestFor`, `container`,
`components` and `flags`. An id would pin a style to one revision of the catalogue;
a term keeps working as the catalogue grows.

- `prefer` raises a pattern's score; `avoid` lowers it.
- A term under `byFamily` is a sharper instruction than the same term at style level
  and is weighted higher.
- A pattern the strategist chose by hand is never re-selected by a style change.

Useful vocabulary, all of which appears in real catalogue entries: `full bleed`,
`contained`, `centered`, `asymmetric`, `overlap`, `large media`, `background media`,
`photo overlay`, `gallery`, `grid`, `columns`, `list`, `table`, `compare`, `dense`,
`spacious`, `bordered`, `flat`, `rounded`, `gradient`, `glass`, `quote-led`,
`number-led`, `form-led`, `timeline`, `slider`, `marquee`, `text-dominant`,
`oversized`, `people`, `product`, `diagram`, `price`, `caption`.

## Component recipes

Per section family, and only the keys the style actually decides: `container`,
`paddingTop`, `paddingBottom`, `inverted`, `viewport`, `columns`, `columnsMobile`,
`decoration`, `decorationOpacity`. Anything omitted keeps the engine's own preset
for that family.

A recipe may only name a section family the engine can build and a decoration motif
the catalogue ships. The build fails on either, rather than emitting a style whose
recipe silently does nothing.

## Do and don't

Two to eight of each, written as instructions to a designer rather than as
description. "Let one image carry a whole band" is usable; "elegant and refined" is
not.

## Status

`draft` → `generated` → `validated` → `visual-qa` → `production`.

Only `production` appears in the strategist's picker.
