# UI layout: container-first typography and SVG geometry

Standing guidance for **all Planner and Runner UI work**: controls, headings,
labels, status/error text, tooltips, dialogs, tables, previews and questionnaires.
Read alongside [AGENTS.md](../AGENTS.md). This is the single owner of these UI
rules; link here instead of copying them into more checklists.

## References and reuse

Use [Ponytail](https://github.com/DietrichGebert/ponytail/blob/main/skills/ponytail/SKILL.md)
for implementation and review. Read the real skill when the runtime cannot load
it. Reuse existing helpers, CSS and platform features before adding machinery.

Canonical text-measurement reference: **Cheng Lou's
[Pretext](https://github.com/chenglou/pretext)**; package `@chenglou/pretext`.
Upstream inspected on 2026-09-19:
[README / API and caveats](https://github.com/chenglou/pretext/blob/main/README.md),
[layout.ts](https://github.com/chenglou/pretext/blob/main/src/layout.ts), and
[measurement.ts](https://github.com/chenglou/pretext/blob/main/src/measurement.ts).
Check the installed version's exports before implementation. Use the normal
package/lockfile workflow; no CDN, runtime GitHub fetch, copied layout engine,
skill manager or new UI framework.

Local reference: `D:\GitHub\SecretTunnel-v2`,
`For-AI/PROTOCOLS/v3-ui-modules.md` (Fitting), `app/src/main.ts`
(`fitText`, `fitElementToBox`, `fitAllText`), and `app/src/styles.css` (sheet marks).
Reuse the **principle**, not a runtime dependency on another checkout. Its
inspected string helper truncates rather than resizes fonts, includes a
constant-width account-label special case, and uses `Array.from` where its
comment says graphemes. Those are not the target contract here: prefer measured
font fitting, derive room from the real slot, and use genuine grapheme boundaries
when truncation is explicitly permitted.

## Design rule

**CSS allocates the box; text and icons adapt inside it.** Moving, resizing or
reparenting a component must not require new hand-tuned font sizes or offsets.
Layout may deliberately reflow at narrow widths, but a long label must not
silently enlarge its control or push a sibling off-screen.

Every text component inherits one shared fitting policy. Constrained display
text uses Pretext-driven font fitting by default, including static/localized
labels that can become constrained later. An already-fitting label is a no-op.
Ordinary flowing prose can use CSS wrapping within its allocated content panel;
do not measure every node or turn every paragraph into a fixed-height tile.

Keep semantic HTML text. Fitting changes presentation, not questionnaire wording,
option order, saved values, experiment layout settings or research semantics.
Do not wrap or replace SurveyJS DOM indiscriminately: use its supported styling
hooks and preserve labels, focus, events and validation. Narrow/mobile-size UI
checks do not authorize a new mobile acquisition/runtime capability.

## Adapt Pretext into one shared font fitter

Pretext measures and lays out text; it does **not** automatically select a font
size or implement CSS boxes. Its core separation is useful here: prepare text
for a font/configuration, then evaluate available space using cached metrics.

Use one helper shared by Planner and Runner, attached through existing component
rendering or a small marker such as `data-fit-text`. The marker is a local
convention, not an upstream Pretext API. Do not create per-button fitters.

1. Read the label's **allocated content box**, not its intrinsic text width.
   Reserve icon/badge slots and gaps with grid/flex. Account for padding, borders
   and pseudo-elements exactly once. `ResizeObserver` content-box sizes already
   exclude padding/borders; `clientWidth` does not exclude padding. Never feed
   transformed screen coordinates or device pixels into CSS-pixel measurements.
2. Keep the full current string separately from presentation. Read computed
   family, weight, style, resolved font size, line-height, letter-spacing,
   whitespace and language. Resolve `rem`/`em` to CSS pixels for Pretext. Measure
   the actual displayed case when CSS transforms text. Use shared, rem-based
   **minimum and preferred/maximum typography tokens**, not per-label numbers.
3. Test the preferred size first. Otherwise use a bounded search in the allowed
   font-size range, selecting the largest candidate that fits width **and**
   height and the component's permitted line count. Recompute line-height and
   any em-based spacing for each candidate. A width ratio is only an initial
   estimate, not proof of fit; round downward only as needed and remeasure the
   chosen candidate. Return an explicit `no-fit` result at the floor.
4. Use `prepareWithSegments` + `measureNaturalWidth` for a single-line label;
   handle authored hard breaks explicitly. For wrapping, `measureLineStats`
   gives line count and maximum line width; `layout` gives block height with
   the supplied line-height. Use `layoutWithLines` only when actual line strings
   are needed. Keep the DOM's wrapping policy consistent with the measurement.
5. Cache preparations only for identical full text, font **including size**,
   spacing, whitespace and locale/font state. A width-only change can reuse a
   preparation; a font-size change cannot. Bound caches to live/recent content.
   Preserve an independent CSS preferred size so text grows back when space
   returns instead of treating its previously shrunken size as the new ceiling.
6. Apply the final size once. Check actual rendered bounds after layout, with
   a small documented rounding tolerance and a bounded correction/no-fit path.
   Pretext is not proof against all fonts, glyph overhangs or CSS combinations.
   Do not repeatedly alternate DOM reads and style writes for every candidate.

Conceptual flow (not an upstream API):

```text
content box + full text + computed typography + shared size limits
    -> reuse/prepare metrics for each necessary font candidate
    -> test width, height and allowed lines
    -> choose largest readable fitting size
    -> write one CSS custom property
    -> bounded rendered verification or explicit no-fit handling
```

## Refitting lifecycle and measurement limits

Observe the **owning label slot**, not only the browser window. Refit after text
or language changes, panel reveal, reparenting, container resize, theme/font
changes and root text-scale changes. A hidden/zero-size element waits for a real
layout; never shrink it to zero. Route updates through the shared helper; use a
scoped `MutationObserver` only where existing render hooks cannot signal changes.

Batch dirty elements in one `requestAnimationFrame`; read first, write second.
Ignore unchanged results and the fitter's own writes. Avoid resize-observer
feedback loops, polling, one observer per character, or measuring on every
animation/affect-sample tick. Disconnect observers and listeners on teardown.

Wait for required fonts (`document.fonts.ready` / the relevant font load) and
invalidate prepared handles and measurement caches after late font replacement.
An unchanged font-family string can now identify different glyph metrics.
Reprepare after locale changes. Use supported font/CSS settings and test actual
fallback fonts, emoji, accents and translated content. Upstream caveats cover
variable-font features, generic fonts, browser minimum font sizes and bidi;
do not assume arbitrary rich text matches a plain-font measurement. Preparation
can include cached DOM calibration; the cheap layout path avoids repeated DOM
measurement. No universal pixel-perfect claim.

## CSS and SVG: preserve local geometry

Use `box-sizing: border-box`, logical sizes, grid/flex gaps, `min-inline-size: 0`
and `minmax(0, 1fr)` for shrinkable text tracks. Give bounded regions a real
allocated height when height fitting is required; do not infer it from text.
Container queries may reorganize layout; `clamp()` / container units may set
preferred typography, but neither measures whether a particular string fits.
Avoid viewport-specific font-size patches, magic `left/top` corrections,
negative margins and `transform: scale()` to squeeze text.

For icon buttons, center a dedicated icon slot using `display: grid` and
`place-items: center`. Prefer SVG with a correctly bounded `viewBox` and
`preserveAspectRatio="xMidYMid meet"`; size it to its slot, constrained by both
width and height. Example for an **already dimensioned icon slot**:

```css
.ui-icon-slot { display: grid; place-items: center; min-inline-size: 0; }
.ui-icon-slot > svg {
  display: block;
  inline-size: 100%;
  block-size: 100%;
  max-inline-size: 100%;
  max-block-size: 100%;
}
```

The parent establishes the slot through shared CSS tokens, ratios or container
units. Use two-axis containment/container units only on an intentionally sized
container, not one that must derive its size from children. Keep SVG strokes,
shapes and internal offsets in its own coordinate system; retain aspect ratio
and enough viewBox space for stroke/filter bounds. Center the artwork within
that viewBox rather than nudging each button. Use `currentColor` where appropriate;
choose proportional strokes or `vector-effect="non-scaling-stroke"` deliberately.

Decorative SVG is `aria-hidden="true"` and `focusable="false"`; the real button
keeps its accessible name, keyboard operation, focus ring and usable hit area.
An icon-plus-label control has separate slots so fitting cannot replace icons.
Prefer live HTML labels rather than outlining text into paths. When SVG text is
necessary, place it in viewBox coordinates with `text-anchor="middle"` and a
tested baseline; Pretext measures text, it does not center the surrounding SVG.

## Readability is a boundary, not another overflow hack

Do not keep shrinking below the shared readability floor or counteract browser
zoom. Respect user text scaling and spacing. At the floor, use the component's
planned multiline/reflow presentation or an accessible bounded details region;
no ad hoc enlargement of a fixed control. For long research content, preserve
full readable text through wrapping, paging or intentional panel scrolling.
Never truncate questions, response choices, consent text or essential errors.

Only expendable secondary labels may use measured ellipsis after readable
fitting fails. Keep full text accessible by keyboard/touch as well as its
accessible name; a hover-only `title` is insufficient. Use `Intl.Segmenter` with
grapheme granularity, not UTF-16 slicing or `Array.from`. CSS clipping/ellipsis
is a fallback guard, not successful fitting or permission to hide information.
No finite box can contain unlimited text at a fixed readable minimum.

## Verification on every affected UI path

Check short/long English and German labels, paths/unbroken IDs, accents/emoji;
resize width **and height**, move the same component into another container,
hide/reveal it, change its string, and load a font late. Verify shrink **and
regrowth**, centering, reserved icon space and absence of observer loops.
Exercise narrow/mobile-sized views, 200% text/zoom and reflow toward 320 CSS px;
preserve keyboard focus, reading order, full required content and hit targets.
Use [W3C Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html)
and [Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) as checks,
not a reason to cancel zoom by shrinking text again.

Test resulting geometry/behavior in the browser and Tauri WebView, not exact
prose, filenames or fixed screenshots. A docs change does not prove a fitter is
installed or every existing element has been migrated. When implementing, add
one focused behavioral regression check to the existing test tools, wire the
shared helper into the affected surfaces, and report what was actually run.
