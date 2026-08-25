/**
 * Palette legibility.
 *
 * A palette in this builder is five roles — canvas, ink, accent, soft, dark —
 * and every one of them is a *ground* or a thing that sits on a ground. That is
 * the whole reason this module exists: a palette can be beautiful, on brief, and
 * completely unreadable, and nothing upstream can tell. An archetype supplies a
 * palette that was designed as a set. A brief supplies two colours with no roles
 * attached. A model supplies five hexes it believes go together. Only one of
 * those three has been checked against a contrast ratio, and it is none of them.
 *
 * So this is the last gate. Whatever produced a palette — catalogue, brief,
 * model, or somebody's colour picker — it comes through `repairPalette` before
 * it is allowed to paint anything, and comes out with a guarantee:
 *
 *   - body copy on the canvas clears 4.5:1
 *   - the dark band really is a different ground from the canvas, and its own
 *     text clears 4.5:1 on it
 *   - the accent can hold a label, and can be seen against the canvas
 *   - the soft surface is visible against the canvas without becoming a second
 *     ground the ink cannot cope with
 *
 * Repairs move **lightness only**. Hue and saturation are left exactly as they
 * arrived, because they are the part a client recognises: a brand green that has
 * been darkened to hold white text is still that green, and a brand green
 * replaced by a "safe" one is a different company's website. Every repair is
 * reported rather than applied silently, so the editor can say what it did and
 * why, and so a designer who disagrees can put it back.
 */

export const PALETTE_ROLES = Object.freeze(['bg', 'ink', 'accent', 'soft', 'dark']);

/** WCAG AA for body text. Everything here is measured against this. */
export const CONTRAST_BODY = 4.5;
/** WCAG AA for large text and for "can I see this shape at all". */
export const CONTRAST_LARGE = 3;

const HEX_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/* ------------------------------------------------------------------ *
 * Colour maths
 *
 * sRGB in, sRGB out. HSL is the working space because the one operation this
 * module performs is "same colour, different lightness", and that is the axis
 * HSL names directly.
 * ------------------------------------------------------------------ */

export function isHex(value) {
  return HEX_PATTERN.test(String(value ?? '').trim());
}

/** `#abc`, `#aabbcc` and `#aabbccdd` all normalise to `#aabbcc`. */
export function normalizeHex(value, fallback = '') {
  const raw = String(value ?? '').trim();
  if (!HEX_PATTERN.test(raw)) return fallback;
  const hex = raw.toLowerCase();
  if (hex.length === 4) return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  return hex.slice(0, 7);
}

export function hexToRgb(value) {
  const hex = normalizeHex(value, '#000000').slice(1);
  const number = Number.parseInt(hex, 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

export function rgbToHex([r, g, b]) {
  const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)));
  return `#${[r, g, b].map((value) => clamp(value).toString(16).padStart(2, '0')).join('')}`;
}

export function rgbToHsl([r, g, b]) {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rn
    ? ((gn - bn) / d + (gn < bn ? 6 : 0))
    : max === gn
      ? (bn - rn) / d + 2
      : (rn - gn) / d + 4;
  return [(h / 6) * 360, s, l];
}

export function hslToRgb([h, s, l]) {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const hue = ((h % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    let value = t;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };
  return [channel(hue + 1 / 3) * 255, channel(hue) * 255, channel(hue - 1 / 3) * 255];
}

export function relativeLuminance(value) {
  const [r, g, b] = hexToRgb(value).map((channel) => {
    const n = channel / 255;
    return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const [la, lb] = [relativeLuminance(a), relativeLuminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Whether a colour reads as a dark ground — the same threshold the renderer uses. */
export function isDarkGround(value) {
  return relativeLuminance(value) < 0.42;
}

/** How chromatic a colour is. Used to tell a brand colour from a neutral. */
export function saturationOf(value) {
  return rgbToHsl(hexToRgb(value))[1];
}

export function lightnessOf(value) {
  return rgbToHsl(hexToRgb(value))[2];
}

function withLightness(value, lightness) {
  const [h, s] = rgbToHsl(hexToRgb(value));
  return rgbToHex(hslToRgb([h, s, Math.max(0, Math.min(1, lightness))]));
}

/** The better-contrasting of two candidates on a ground. */
export function readableOn(ground, candidates = ['#ffffff', '#101114']) {
  let best = candidates[0];
  let bestRatio = -1;
  for (const candidate of candidates) {
    const ratio = contrastRatio(candidate, ground);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = candidate;
    }
  }
  return best;
}

/**
 * The same colour, moved along lightness until it clears `target` against
 * `ground`. Direction is chosen by which side has room: a colour on a light
 * canvas darkens, one on a dark canvas lightens.
 *
 * When no lightness reaches the target — a mid-grey on a mid-grey genuinely
 * fails in both directions — this returns the best it found rather than the
 * original. Giving up and handing back the unreadable colour is the one outcome
 * that helps nobody; the caller still learns the truth from the report.
 */
export function shiftToContrast(colour, ground, target = CONTRAST_BODY, { prefer = '' } = {}) {
  const start = normalizeHex(colour, '#000000');
  if (contrastRatio(start, ground) >= target) return start;
  const groundIsDark = isDarkGround(ground);
  const first = prefer === 'lighter' || (!prefer && groundIsDark) ? 'lighter' : 'darker';
  let best = start;
  let bestRatio = contrastRatio(start, ground);
  for (const direction of [first, first === 'lighter' ? 'darker' : 'lighter']) {
    // One percent of lightness at a time: the smallest move that clears the bar
    // is the one that changes the design least.
    for (let step = 1; step <= 100; step += 1) {
      const lightness = direction === 'lighter'
        ? lightnessOf(start) + step / 100
        : lightnessOf(start) - step / 100;
      if (lightness < 0 || lightness > 1) break;
      const candidate = withLightness(start, lightness);
      const ratio = contrastRatio(candidate, ground);
      if (ratio >= target) return candidate;
      if (ratio > bestRatio) { bestRatio = ratio; best = candidate; }
    }
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * Reading a palette out of loose colours
 * ------------------------------------------------------------------ */

/**
 * Turns the colours a brief named into palette roles.
 *
 * This replaces the rule that used to sit in the brief parser — "first
 * unqualified colour is the accent, second is the dark band" — which is right
 * for "our brand is teal and charcoal" and catastrophic for "green and white",
 * where it made white the inverted ground and every dark band turned into white
 * type on white.
 *
 * The fix is to stop guessing from word order and read the colours themselves. A
 * near-white can only be a canvas. A near-black can only be a dark band. The
 * most chromatic colour in the sentence is the brand colour, because that is
 * what somebody means when they name a colour without saying what for.
 */
export function paletteFromColours(colours, { base = {} } = {}) {
  const explicit = {};
  const loose = [];
  for (const entry of colours || []) {
    const raw = String((typeof entry === 'string' ? entry : entry?.hex) ?? '').trim();
    if (!normalizeHex(raw)) continue;
    // Kept exactly as authored. A brief that says `#0B3D2E` gets `#0B3D2E`
    // back — the maths below normalises internally, but a case-folded hex in an
    // export reads as a value somebody else decided.
    const hex = raw.length === 4 ? `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}` : raw.slice(0, 7);
    const role = typeof entry === 'object' ? String(entry.role || '') : '';
    if (PALETTE_ROLES.includes(role) && !explicit[role]) explicit[role] = hex;
    else loose.push(hex);
  }

  const out = { ...explicit };
  const claimed = new Set(Object.values(out).map((hex) => hex.toLowerCase()));
  const spare = loose.filter((hex) => !claimed.has(hex.toLowerCase()));
  const take = (hex, role) => { out[role] = hex; spare.splice(spare.indexOf(hex), 1); };

  // The canvas first, because it is unambiguous: nothing this light can be an
  // inverted band, whatever order the sentence put it in. This is the half of
  // "green and white" that used to go wrong.
  if (!out.bg) {
    const lightest = spare.filter((hex) => lightnessOf(hex) >= 0.82).sort((a, b) => lightnessOf(b) - lightnessOf(a))[0];
    if (lightest) take(lightest, 'bg');
  }

  /*
   * Then the dark band, but only when something else is left to be the brand
   * colour. "Our brand is midnight blue" names one colour and means the accent;
   * "navy and gold" names two and means one of each, and the one that is a band
   * is the darker, quieter of the two. Scoring both darkness and how little
   * chroma a colour carries is what separates charcoal from teal when the brief
   * says "teal and charcoal" — they are almost the same lightness.
   */
  if (!out.dark && spare.length > 1) {
    const banded = spare
      .filter((hex) => lightnessOf(hex) <= 0.24)
      .map((hex) => ({ hex, score: (0.24 - lightnessOf(hex)) * 2 + (1 - saturationOf(hex)) * 0.5 }))
      .sort((a, b) => b.score - a.score)[0];
    if (banded) take(banded.hex, 'dark');
  }

  // The brand colour: the most chromatic thing still unspoken for. Somebody who
  // names a colour and does not say what it is for means this one.
  if (!out.accent) {
    const chromatic = spare
      .map((hex) => ({ hex, saturation: saturationOf(hex), lightness: lightnessOf(hex) }))
      .filter((entry) => entry.saturation >= 0.15 && entry.lightness > 0.08 && entry.lightness < 0.92)
      .sort((a, b) => b.saturation - a.saturation)[0];
    if (chromatic) take(chromatic.hex, 'accent');
  }

  for (const hex of spare.slice()) {
    const lightness = lightnessOf(hex);
    if (!out.bg && lightness >= 0.82) take(hex, 'bg');
    else if (!out.dark && lightness <= 0.3) take(hex, 'dark');
    else if (!out.soft) take(hex, 'soft');
  }

  // Anything still unplaced becomes the accent only if nothing else claimed it.
  if (!out.accent && spare.length) out.accent = spare.shift();

  return { ...base, ...out };
}

/* ------------------------------------------------------------------ *
 * The guarantee
 * ------------------------------------------------------------------ */

const FALLBACK = Object.freeze({
  bg: '#f7f5f0', ink: '#16181c', accent: '#1f6f43', soft: '#e6e2d8', dark: '#101418',
});

/**
 * Five roles, all present, all valid — and still spelled the way they arrived.
 *
 * Case is preserved deliberately. A brief that says `#0B3D2E` should find
 * `#0B3D2E` in its export, not a case-folded copy: the value is the same colour
 * either way, but one of them looks like a decision somebody else made.
 */
function fill(palette) {
  const out = {};
  for (const role of PALETTE_ROLES) {
    const raw = String(palette?.[role] ?? '').trim();
    out[role] = normalizeHex(raw) && raw.length === 7 ? raw : normalizeHex(raw, FALLBACK[role]);
  }
  return out;
}

/**
 * Makes a palette legible without making it somebody else's palette.
 *
 * Order matters. The canvas is never moved — it is the decision a client sees
 * first and the ground everything else is measured against — so every other role
 * is repaired *to* it rather than the other way round.
 *
 * Returns `{ palette, repairs, ok }`. `repairs` is the honest record: an empty
 * array means the palette arrived legible, which is the outcome we want and the
 * one the editor should be able to prove.
 */
export function repairPalette(input, { target = CONTRAST_BODY, pin = [] } = {}) {
  const palette = fill(input);
  const repairs = [];
  const refused = [];
  /*
   * A pinned role is a colour somebody stated. "Our brand is #0B3D2E" is a
   * constraint, not an opening offer, and a tool that quietly returns #16795C
   * because that measured better has not honoured the brief — it has replaced
   * it. So a repair that would move a pinned role is refused and reported
   * instead, and the preflight is left to say the relationship is tight.
   */
  const pinned = new Set(pin);
  const change = (role, next, why) => {
    if (next === palette[role]) return;
    if (pinned.has(role)) { refused.push({ role, kept: palette[role], why }); return; }
    repairs.push({ role, from: palette[role], to: next, why });
    palette[role] = next;
  };

  const bgIsDark = isDarkGround(palette.bg);

  // 1. Body copy on the canvas. Everything else on the page is a variation of
  //    this one relationship, so it is repaired first and hardest. The small
  //    headroom above the target is deliberate: ink that only just clears 4.5:1
  //    on the canvas has nothing left for the card surface a step away from it,
  //    and the two repairs then fight each other.
  if (contrastRatio(palette.ink, palette.bg) < target) {
    change('ink', shiftToContrast(palette.ink, palette.bg, target + 1.5),
      'body text was not readable on the page colour');
  }

  // 2. An inverted band must actually invert. A light canvas with a light "dark"
  //    role is the failure "green and white" used to produce: white was read as
  //    the inverted ground, so every dark band became white type on white.
  //
  //    A dark site is *not* that failure. `#070607` under `#0C0B0C` is a real,
  //    if quiet, second ground — flipping it to a light band would redesign four
  //    archetypes to fix a problem they do not have.
  if (!bgIsDark && !isDarkGround(palette.dark)) {
    change('dark', withLightness(palette.dark, Math.min(0.2, Math.max(0.06, lightnessOf(palette.bg) - 0.55))),
      'the inverted band was as light as the page, so its light text had nothing to sit on');
  }

  // 3. Whichever ground it is, its own copy has to be readable on it.
  const onDark = () => readableOn(palette.dark, ['#ffffff', palette.bg, palette.ink, '#0b0d10']);
  if (contrastRatio(onDark(), palette.dark) < target) {
    change('dark', shiftToContrast(palette.dark, onDark(), target, { prefer: isDarkGround(palette.dark) ? 'darker' : 'lighter' }),
      'no text colour could be read on the inverted band');
  }

  // 4. And it has to be visible *as* a band. Same polarity, nudged just far
  //    enough from the canvas to have an edge.
  if (contrastRatio(palette.dark, palette.bg) < 1.2) {
    change('dark', shiftToContrast(palette.dark, palette.bg, 1.2, { prefer: bgIsDark ? 'lighter' : 'darker' }),
      'the inverted band was the same tone as the page, so it read as one continuous surface');
  }

  // 5. The accent carries buttons and pretitles: it has to be visible against
  //    the canvas, and a label has to survive on top of it.
  if (contrastRatio(palette.accent, palette.bg) < CONTRAST_LARGE) {
    change('accent', shiftToContrast(palette.accent, palette.bg, CONTRAST_LARGE),
      'the brand colour disappeared into the page colour');
  }
  if (contrastRatio(readableOn(palette.accent, ['#ffffff', '#0b0d10']), palette.accent) < target) {
    change('accent', shiftToContrast(palette.accent, readableOn(palette.accent, ['#ffffff', '#0b0d10']), target),
      'button labels were not readable on the brand colour');
  }

  // 6. The soft surface is a card or a band on the *same* ground as the canvas.
  //    Too close and it is invisible; too far and the ink stops working on it.
  //    Both at once, or not at all — repairing them in sequence lets the second
  //    undo the first, which is how a card ends up one percent off the page.
  const softOk = (hex) => contrastRatio(hex, palette.bg) >= 1.06 && contrastRatio(palette.ink, hex) >= target;
  if (!softOk(palette.soft)) {
    const start = lightnessOf(palette.soft);
    let best = '';
    for (let step = 0; step <= 100 && !best; step += 1) {
      for (const lightness of [start + step / 100, start - step / 100]) {
        if (lightness < 0 || lightness > 1) continue;
        const candidate = withLightness(palette.soft, lightness);
        if (softOk(candidate)) { best = candidate; break; }
      }
    }
    // Nothing along this hue satisfies both, so give the ink more room and let
    // the surface follow it rather than shipping an unreadable card.
    if (!best) {
      change('ink', shiftToContrast(palette.ink, palette.bg, target + 3),
        'the card surface and the body text could not both work at this ink');
      best = bgIsDark
        ? withLightness(palette.soft, Math.min(0.4, lightnessOf(palette.bg) + 0.12))
        : withLightness(palette.soft, Math.max(0.62, lightnessOf(palette.bg) - 0.1));
    }
    change('soft', best, 'the supporting surface was invisible against the page, or its text was not readable');
  }

  return { palette, repairs, refused, ok: repairs.length === 0 };
}

/**
 * What a palette measures, for the preflight panel.
 *
 * Reported rather than repaired, because these are the numbers a designer argues
 * with and a repair is only ever a floor.
 */
export function paletteContrastReport(input) {
  const palette = fill(input);
  const onDark = readableOn(palette.dark, ['#ffffff', palette.bg, palette.ink]);
  const onAccent = readableOn(palette.accent, ['#ffffff', '#0b0d10']);
  const rows = [
    { id: 'ink-on-bg', label: 'Body text on the page', ratio: contrastRatio(palette.ink, palette.bg), target: CONTRAST_BODY },
    { id: 'ink-on-soft', label: 'Body text on a card', ratio: contrastRatio(palette.ink, palette.soft), target: CONTRAST_BODY },
    { id: 'text-on-dark', label: 'Text on the dark band', ratio: contrastRatio(onDark, palette.dark), target: CONTRAST_BODY },
    { id: 'label-on-accent', label: 'Button label on the brand colour', ratio: contrastRatio(onAccent, palette.accent), target: CONTRAST_BODY },
    { id: 'accent-on-bg', label: 'Brand colour against the page', ratio: contrastRatio(palette.accent, palette.bg), target: CONTRAST_LARGE },
    // Not a text ratio and not held to one. On a dark site the inverted band is
    // a *darker* dark; asking it to clear 3:1 against a near-black canvas would
    // mean turning it into a light band, which is a redesign, not a repair. All
    // this has to prove is that the band has an edge.
    { id: 'dark-on-bg', label: 'Dark band against the page', ratio: contrastRatio(palette.dark, palette.bg), target: 1.2 },
  ].map((row) => ({ ...row, ratio: Math.round(row.ratio * 100) / 100, pass: row.ratio >= row.target }));
  return { rows, failures: rows.filter((row) => !row.pass), ok: rows.every((row) => row.pass) };
}

/**
 * One palette, three grounds.
 *
 * Used when a concept arrives with no colours of its own — the model omitted
 * them, or the deterministic planner answered because no model was reachable.
 * Three concepts that all sit on the same off-white are one concept shown three
 * times, and the fix cannot be "vary the brand colour", because the brand colour
 * is the part the brief pinned. So the ground varies instead: paper, a tint of
 * the brand, and the brand inverted. The accent survives all three, which is
 * exactly the promise a stated colour makes.
 *
 * `index` is positional and matches the presentation order — safest first.
 */
export function paletteVariant(base, index = 0, { pin = [] } = {}) {
  const palette = fill(base);
  const step = index % 3;
  if (step === 0) return repairPalette(palette, { pin }).palette;

  const [hue, saturation] = rgbToHsl(hexToRgb(palette.accent));
  if (step === 1) {
    // A tinted paper: the brand colour at a fraction of its chroma, so the page
    // reads as belonging to the brand without shouting it.
    const bg = rgbToHex(hslToRgb([hue, Math.min(0.3, saturation * 0.35), 0.955]));
    const soft = rgbToHex(hslToRgb([hue, Math.min(0.32, saturation * 0.4), 0.9]));
    return repairPalette({ ...palette, bg, soft }, { pin }).palette;
  }

  /*
   * Inverted: the same hue as a deep ground, with a light ink on it. The
   * adventurous option, still on brief.
   *
   * The ground is chosen so the brand colour can be seen against it, rather
   * than the brand colour being adjusted to suit a ground this function picked.
   * That is the whole difference between "three options in your colours" and
   * "three options in colours near yours".
   *
   * Chosen by measurement, not by walking in one direction: a mid-dark brand
   * green gets *more* contrast as the ground goes darker, and a very dark one
   * gets more as it lifts. Assuming either produced a muddy ground that showed
   * the brand at 1.1:1, which is the failure this variant exists to avoid.
   */
  const chroma = Math.min(0.42, Math.max(0.16, saturation * 0.6));
  let lightness = 0.09;
  let best = -1;
  for (let step = 4; step <= 32; step += 1) {
    const candidate = rgbToHex(hslToRgb([hue, chroma, step / 100]));
    const ratio = contrastRatio(palette.accent, candidate);
    if (ratio > best) { best = ratio; lightness = step / 100; }
    if (best >= CONTRAST_LARGE && step / 100 >= lightness) break;
  }
  const bg = rgbToHex(hslToRgb([hue, chroma, lightness]));
  const soft = rgbToHex(hslToRgb([hue, Math.min(0.4, Math.max(0.14, saturation * 0.55)), lightness + 0.07]));
  const ink = rgbToHex(hslToRgb([hue, 0.12, 0.95]));
  const dark = rgbToHex(hslToRgb([hue, Math.min(0.45, Math.max(0.18, saturation * 0.65)), Math.max(0.03, lightness - 0.04)]));
  return repairPalette({ ...palette, bg, soft, ink, dark }, { pin }).palette;
}

/**
 * Three palettes that are three palettes.
 *
 * Concepts exist so a client can choose. Three sets of colours that measure the
 * same are one option shown three times, so this reports the spread the editor
 * can warn on.
 */
export function paletteDistance(a, b) {
  const roles = ['bg', 'accent', 'dark'];
  return roles.reduce((total, role) => {
    const [ha, sa, la] = rgbToHsl(hexToRgb(normalizeHex(a?.[role], '#000000')));
    const [hb, sb, lb] = rgbToHsl(hexToRgb(normalizeHex(b?.[role], '#000000')));
    const hue = Math.min(Math.abs(ha - hb), 360 - Math.abs(ha - hb)) / 180;
    return total + hue * 0.5 + Math.abs(sa - sb) + Math.abs(la - lb);
  }, 0) / roles.length;
}
