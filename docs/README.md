# Documentation

Viewable online: <https://claude.ai/code/artifact/19c609cb-dcf1-4b0e-a7e2-bd33011792e5>
(private until shared from the page's own share menu).

## `SBS-Simple-Builder.pdf`

An 18-slide landscape deck documenting how the simple builder works, for the
engineering team: the four steps, the one button and its four stages, the
architecture, the AI layer, the pattern library, concept isolation, the preview's
in-place repaint, the crossing into WordPress, the stack, and what verifies it.

Five diagrams are hand-authored inline SVG, so they stay crisp at any zoom and in
print, and they theme with the page rather than being pasted images.

### Regenerating it

```
npm run build:deck
```

The source is `sbs-simple-builder-deck.html` — a normal web page whose slide box
*is* its printed page (`@page { size: 1280px 720px }`), so the PDF is the deck at
16:9 rather than a document reflowed onto A4 with slides broken across page
boundaries. `scripts/build-deck.mjs` prints it with Playwright and
`preferCSSPageSize`, after waiting for the webfonts — a PDF printed before they
arrive is set in the fallback stack.

Open the HTML directly in a browser to present from it; it follows the reader's
light or dark theme. The PDF is always the light palette, because it is printed.

### Editing it

Every slide is one `<section class="slide">`. The numbers in the deck are real and
were read out of the code and the data at the version stated on slide 1 — when
they move, update them here rather than rounding.
