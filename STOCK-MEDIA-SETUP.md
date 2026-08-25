# Stock imagery — setup and how it works

The Brief Brain can now dress a page with real, on-brief pictures. After the
brief is written and the concept is chosen, it searches the stock library for
what the business actually looks like, then places one asset in every media slot
on the page — no asset twice.

Everything it returns is a **watermarked preview**. This server never calls a
licensing endpoint, so running the feature costs nothing from a subscription and
downloads nothing. The client reviews the concept with real imagery and licenses
only the pictures they keep.

---

## 1. Get the credential

> **Direct asset lookup:** the media library accepts either a numeric Shutterstock asset ID or the full public Shutterstock asset URL. Tracking query parameters are ignored when the asset ID is extracted, and the result is added as a watermarked review preview.


1. Sign in at **https://www.shutterstock.com/developers** with the account that
   holds your free API subscription.
2. Open **My Apps** (developer dashboard) and either use an existing application
   or create one. A name and a description are enough — search needs no callback
   URL and no special scope.
3. The application page shows a **Consumer Key** and a **Consumer Secret**, and
   usually lets you generate an **individual / personal access token** (a long
   string that begins `v2/`).

Either credential works for search. Prefer the token; keep the pair as a
fallback if your account doesn't offer token generation.

> **On "sandbox".** Shutterstock's sandbox is a *licensing* sandbox — it exists
> so you can exercise the license endpoints without spending downloads. This
> integration never licenses anything, so there is nothing to sandbox: search is
> free, and the preview URLs it returns are watermarked by the library itself.
> That is why there is no `SHUTTERSTOCK_SANDBOX` setting here. Your subscription
> ID is recorded in `.env` for traceability only.

---

## 2. Fill in `.env`

The keys are already appended to your `.env` with empty values. Fill in **one**
of the two credential forms:

```dotenv
# Preferred — an individual API token
SHUTTERSTOCK_API_TOKEN=v2/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Or, if your account issues a key/secret pair instead, leave the token empty:
SHUTTERSTOCK_CLIENT_ID=your-consumer-key
SHUTTERSTOCK_CLIENT_SECRET=your-consumer-secret

# Traceability only. Search does not use it.
SHUTTERSTOCK_SUBSCRIPTION_ID=your-subscription-id
```

Optional, with sensible defaults already set:

| Key | Default | What it does |
|---|---|---|
| `BRIEF_BRAIN_MEDIA_IMAGES` | `10` | Stills returned per search |
| `BRIEF_BRAIN_MEDIA_VIDEOS` | `2` | Clips returned per search |
| `BRIEF_BRAIN_MEDIA_TOKENS` | `2048` | Answer budget for the two model calls |
| `SHUTTERSTOCK_SAFE_SEARCH` | `true` | Safe-search filter on the library |
| `SHUTTERSTOCK_TIMEOUT_MS` | `20000` | Per-request timeout |

**Never** prefix any of these with `VITE_`. The browser must never see the
credential; it asks this server for a media plan and receives preview URLs.

---

## 3. Prove it works

```bash
npm run check:stock                              # uses a default golf query
npm run check:stock -- "dental clinic interior"  # or your own
```

It runs one image search and one video search, prints the previews it found, and
tells you which credential form it used. A `401`/`403` is an authentication
failure, not a network problem — the script says so and what to check.

If it reports `widened to "…"`, that is normal and worth understanding: the
library requires **every** word in a query to match, so one adjective too many
returns an empty page rather than a looser match. `golf course fairway sunrise`
finds nothing; `golf course fairway` finds hundreds. Both the script and the
editor drop trailing words until something matches, down to two words, and say
which phrase actually answered.

Then start the app as usual:

```bash
npm run dev
```

---

## 4. Using it

**Both builders, on the Modules step**, in a panel called *Find imagery for this
brief*.

1. Write the brief (advanced) or the paragraph and pick a concept (simple).
2. Go to **Modules** and press **Find imagery**.
3. The brain writes the search phrases, the library answers, and one asset lands
   in each slot. The panel shows every preview it found, which are placed and
   which are spare, and the exact phrases it searched.
4. Change any individual picture in **Module editor → Media**: the project's own
   imagery is listed first, with anything already used on the page dimmed so a
   repeat is a deliberate choice. The built-in placeholder set is still there
   under *Placeholder library*.
5. **Restore placeholders** removes every stock picture and puts the built-in set
   back. Finding imagery is a single undo step, too.

### What it will not touch

**Team and testimonial sections keep the placeholder library.** A testimonial
portrait or a staff headshot has to be the client's own photograph of their own
colleague — a stock face there is worse than no face. Those sections are dropped
from the request on the server, so both builders behave identically and the
module editor says so on the section itself.

### Where video goes

There are only two clips and far more slots, so they are spent where motion
earns its bandwidth: a **hero background** first, then a **full-height CTA
background**. Everything else gets a still. If a pattern has no slot that can
carry a clip, no video search is made at all.

A clip renders as a real muted, looping, poster-backed `<video>` in the live
preview and in the standalone HTML export, and travels into the WordPress JSON
as a background layer with `type: "video"`, its mime type, and a `posterImage` —
using the DST layer's own fields, with no invented attributes.

---

## 5. Before the client's site goes live

The previews are comps. Two things must happen before publishing:

1. **License the assets you keep.** Every placed picture carries its Shutterstock
   asset id; the panel and the export keep it so a purchase can be matched to a
   slot.
2. **Swap the URL.** The WordPress importer sideloads whatever URL it is given.
   If a watermarked preview URL is imported, the watermark ships with it. Replace
   the preview with the licensed download before the import, or after it in the
   media library.

Check your Shutterstock licence terms for how comps may be shown to a client;
this integration displays them inside a private concept for review, which is the
usual comping use, but the terms of your specific subscription govern.

---

## How it works internally

| Piece | Where |
|---|---|
| Stock adapter (search only, no licensing) | [`server/media/shutterstock-provider.mjs`](server/media/shutterstock-provider.mjs) |
| Slot model, no-repeat rule, video placement | [`shared/brief/media.mjs`](shared/brief/media.mjs) |
| The job: phrases → search → assignment | `media()` in [`server/brief/brief-brain.mjs`](server/brief/brief-brain.mjs) |
| Prompts | [`server/ai/prompts/media-search.md`](server/ai/prompts/media-search.md), [`server/ai/prompts/media-director.md`](server/ai/prompts/media-director.md) |
| Route | `POST /api/brief/media` in [`server/routes/brief.mjs`](server/routes/brief.mjs) |
| Slot derivation and plan application | `v5SectionSlots` / `v5ApplyMediaPlan` in [`src/runtime/builder.js`](src/runtime/builder.js) |
| Panel and picker | [`src/features/brief-brain/panels.js`](src/features/brief-brain/panels.js) |

The model influences two things: the search phrases, and which asset suits which
slot. It never controls structure. The slot list is derived from the pattern tree
on each section, and the no-repeat guarantee, the video-placement rule and the
people exclusion are enforced by this server after the model answers. If the
model is unavailable the search still runs and slots are filled in priority
order, and the panel says the imagery was placed without it.

If the **library** is unavailable, that is a real error rather than a downgrade:
there is no local substitute for a photograph of a golf course.
