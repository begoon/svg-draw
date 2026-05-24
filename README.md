# svg-draw

A small Bun + CodeMirror playground for drawing SVG programmatically.
Left pane: a JavaScript editor. Right pane: the live SVG render.

Coordinates are math-style: `(0, 0)` is the bottom-left of the canvas,
y increases upward.

## Install & run

```bash
bun install
bun run dev      # or: bun --hot ./index.ts
```

Open <http://localhost:3000>.

## Editor features

- Multi-file tabs (each tab is a `.js` file with a unique name). Click a tab
  to switch, click `+` to create a new file, `×` to close one, click `✎`
  (or double-click the tab label) to rename. The active tab is what renders
  to SVG.
- Every keystroke persists all tabs to `localStorage`. Re-render of the
  active tab is debounced ~200 ms.
- Invalid JS shows an error in the status bar (with a line number when one
  can be extracted from the runtime stack); the offending line is
  highlighted in light red, and the last good SVG stays on screen.
- API names and globals are highlighted in the editor (drawing/geometry
  functions in teal, `AREA`/`STRIDE`/`ZERO` in purple).
- Buttons:
  - **Download source** — saves the active tab as its `.js` file.
  - **Copy SVG** — copies current SVG markup to the clipboard.
  - **Download .svg** — saves as a `.svg` file.
  - **Download .png** — rasterizes at 2× on a white background.

## Globals

These can be reassigned at any point in your script. Later draw calls pick up
the new values immediately.

| Name     | Default | Meaning                                                                |
| -------- | ------- | ---------------------------------------------------------------------- |
| `AREA`   | `500`   | SVG canvas is `AREA × AREA` (viewBox, width, height).                  |
| `STRIDE` | `1`     | Multiplies every `x` and `y` coordinate.                               |
| `ZERO`   | `0`     | Added to every `x` and `y` coordinate.                                 |

Coordinate transform applied to every `x` / `y`:

```text
x -> ZERO + x * STRIDE     (same for y)
```

Only x/y coordinates are transformed. Lengths (`r`, `thickness`, `size`, text
size, `step`, `length`, `spacing`) are always in raw pixels.

## Drawing API

All functions are available as bare identifiers in user code.

### Shared shape options

`line`, `circle`, `square`, `rect`, and `arrow` all accept an `opts` object
with the following keys (all optional):

| Option      | Default   | Meaning                                                            |
| ----------- | --------- | ------------------------------------------------------------------ |
| `thickness` | `1`       | Stroke width in raw px.                                            |
| `color`     | `"black"` | Stroke color (any CSS color: `#rrggbb`, name, etc).                |
| `fill`      | none      | Fill color. Omit for no fill. (Not on `line` / `arrow`.)           |

For `arrow`, the arrowhead inherits the line's `color` automatically.

All point arguments accept either `[x, y]` or `{x, y}`. The two forms are
interchangeable and may be mixed in the same call.

### `line(p1, p2, ..., pN, opts={})`

Straight line with rounded caps for `N=2`; polyline (connected segments
with rounded joins) for `N>2`. Needs at least 2 points.

| Option      | Default   | Meaning                                                                                                       |
| ----------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| `thickness` | `1`       | Stroke width.                                                                                                 |
| `color`     | `"black"` | Stroke color.                                                                                                 |
| `before`    | `0`       | Extend the drawn line past `p1` by this many user units, along the direction `(p1 - p2)`.                     |
| `after`     | `0`       | Extend the drawn line past `pN` by this many user units, along the direction `(pN - p(N-1))`.                 |
| `halfplane` | none      | Only honored when `N=2`. Anchors at the **extended** endpoints — `position` spans the full drawn length.      |

```js
// straight line
line([0, 0], [5, 5]);
line([0, 0], [5, 5], { thickness: 2 });
line({ x: 0, y: 0 }, { x: 5, y: 5 }, { color: "#0044aa", thickness: 2 });

// extend past both endpoints by 1 unit each
line([0, 0], [5, 5], { before: 1, after: 1 });

// line + halfplane in one call (only with two points)
line(Z, C2, { thickness: 1, halfplane: { position: 0.9, angle: 135 } });

// polyline through any number of points
line([0, 0], [2, 3], [4, 1], [6, 4], [8, 2], { thickness: 2 });
```

### `arrow(p1, p2, opts={})`

Line from `p1` to `p2` with a filled triangular arrowhead at `p2`. Accepts
`thickness`, `color`. The arrowhead is rendered in the same color as the line.

```js
arrow([0, 0], [5, 4]);
arrow([0, 0], [5, 4], { thickness: 2 });
arrow({ x: 0, y: 0 }, { x: 5, y: 4 }, { color: "#0044aa", thickness: 2 });
```

### `circle(p, r, opts={})`

Circle centered at `p` with radius `r`. Accepts `thickness`, `color`, `fill`.

```js
circle([2, 3], 10);                                  // outlined
circle([2, 3], 10, { fill: "#aaccff" });             // filled
circle({ x: 2, y: 3 }, 10, { thickness: 2, color: "red", fill: "#aaccff" });
```

### `square(p, r, opts={})`

Same options as `circle`, but draws a square centered at `p` with half-side
`r` (so the side length is `2 * r`).

```js
square([2, 3], 8);
square([2, 3], 8, { fill: "#000000" });
```

### `rect(p1, p2, opts={})`

Axis-aligned rectangle between corners `p1` and `p2`. Corners can be given
in any order. Accepts `thickness`, `color`, `fill`.

```js
rect([1, 1], [4, 3]);
rect([1, 1], [4, 3], { fill: "#ffddaa" });
rect([1, 1], [4, 3], { thickness: 2, color: "darkred", fill: "#ffddaa" });
```

### `text(p, text, opts={})`

Text whose **baseline** sits at `p` (in math coordinates — y goes up).
Glyphs are flipped locally so they render upright.

| Option   | Default | Meaning                                                          |
| -------- | ------- | ---------------------------------------------------------------- |
| `size`   | `10`    | Font size in raw px.                                             |
| `sub`    | `""`    | Subscript string (appended after the main text).                 |
| `super`  | `""`    | Superscript string (appended after the main text).               |
| `scale`  | `0.7`   | Sub/super font size = `size * scale`.                            |
| `italic` | `false` | Render in italic (applies to the main text and sub/super).       |

Sub and super are placed after the main text with a small horizontal gap of
`size * 0.12` so they don't crowd the preceding glyph.

```js
text([2, 3], "x");
text([2, 3], "x", { sub: "1", super: "2", size: 20 });
text([2, 3], "E = mc", { super: "2", size: 24, scale: 0.5 });
text([2, 3], "v", { italic: true, sub: "i", size: 18 });
```

### `fill(p1, p2, ..., pN, opts)`

Pattern-fills a polygon defined by at least 3 points. Hatching uses an SVG
`<pattern>` so it's automatically clipped to the polygon border regardless
of edge angle.

| Option      | Default     | Meaning                                                                |
| ----------- | ----------- | ---------------------------------------------------------------------- |
| `shape`     | `"/"`       | `"h"` (horizontal), `"v"` (vertical), `"/"` (45°), `"\\"` (135°).      |
| `step`      | `8`         | Spacing between hatch lines in raw px.                                 |
| `thickness` | `1`         | Hatch line thickness in raw px.                                        |
| `color`     | `"#000000"` | Hatch line color.                                                      |

```js
// triangle hatched at 45°
fill([0, 0], [5, 0], [0, 5], { shape: "/" });

// pentagon with vertical lines, wider spacing
fill([2, 2], [4, 2], [4.5, 4], [3, 5], [1.5, 4],
     { shape: "v", step: 12 });

// arbitrary polygon, back-slash hatching, thicker, blue
fill([0, 6], [3, 6], [3, 6.5], [1.5, 7], [0, 6.5],
     { shape: "\\", step: 6, thickness: 1.5, color: "#0044aa" });
```

Polygons can be concave and the same `(angle, step, thickness, color)` is
deduplicated into a single `<pattern>` definition.

### `halfplane(p1, p2, opts={})`

Draws a few short hatch strokes on one side of the line — the math/engineering
convention for marking which half-plane is "in".

| Option      | Default   | Meaning                                                                                                 |
| ----------- | --------- | ------------------------------------------------------------------------------------------------------- |
| `side`      | `"left"`  | `"left"` or `"right"` of the line direction. "Left" = the 90°-CCW side of the tangent in math coords.   |
| `count`     | `4`       | Number of strokes.                                                                                      |
| `length`    | `12`      | Stroke length in raw px.                                                                                |
| `spacing`   | `8`       | Distance between strokes along the line, in raw px.                                                     |
| `position`  | `"end"`   | `"end"`, `"start"`, `"middle"`, or a number `0..1` along the line.                                      |
| `angle`     | `45`      | Stroke angle from the line, into the chosen side. `45` = forward-leaning; `135` = back-leaning.         |
| `thickness` | `1`       | Stroke thickness.                                                                                       |
| `color`     | `"black"` | Stroke color.                                                                                           |

```js
// fish-fin marker at the end of a line, on the left
line([1, 1], [5, 4]);
halfplane([1, 1], [5, 4], { side: "left" });

// back-leaning, on the right
halfplane([1, 3], [5, 6], { side: "right", angle: 135 });

// constraint y >= 2, mark the upper half-plane along the whole line
line([0, 2], [6, 2]);
halfplane([0, 2], [6, 2],
          { side: "left", position: "middle", count: 6, spacing: 30 });
```

### `angle90([a1, a2], [b1, b2], opts={})`

Draws a small square at the intersection of two lines to mark a 90° angle.
One corner of the square sits at the intersection point; the two adjacent
sides run along the two lines. (Used purely as a visual marker — it doesn't
verify the lines are actually perpendicular.)

| Option      | Default   | Meaning                                                                                            |
| ----------- | --------- | -------------------------------------------------------------------------------------------------- |
| `size`      | `8`       | Side length in raw px.                                                                             |
| `position`  | `1`       | Which of the 4 quadrants formed by the two lines to draw the square in (`1`, `2`, `3`, or `4`).    |
| `thickness` | `1`       | Outline thickness.                                                                                 |
| `color`     | `"black"` | Outline color.                                                                                     |

`position` maps to sign combinations of the two line directions (`+` means
the direction `a1 → a2` for line 1, `b1 → b2` for line 2):

| position | line 1 direction | line 2 direction |
| -------- | ---------------- | ---------------- |
| `1`      | `+`              | `+`              |
| `2`      | `-`              | `+`              |
| `3`      | `-`              | `-`              |
| `4`      | `+`              | `-`              |

```js
// two perpendicular lines and a right-angle marker
line([0, 0], [5, 0]);          // along +X
line([0, 0], [0, 5]);          // along +Y
angle90([[0, 0], [5, 0]], [[0, 0], [0, 5]], { size: 10, position: 1 });
```

### `line_angle(p, angle, length, opts={})`

Draws a line starting at point `p`, at `angle` degrees, of the given `length`.
`angle` is measured CCW from the positive X axis (`angle: 0` points right,
`angle: 90` points up in math coords). `length` is in user coordinates — it
scales with `STRIDE`.

Accepts the same `opts` as `line` (`thickness`, `color`, `halfplane`,
`before`, `after`). Returns the end point as `{ x, y }`, so it can be
chained. `before` / `after` extend the drawn line but do **not** affect
the returned point.

```js
line_angle({ x: 0, y: 0 }, 45, 5);
line_angle([2, 2], 90, 3, { color: "red", thickness: 2 });
line_angle([0, 0], 30, 6, { halfplane: { position: 0.9, angle: 135 } });

// drawn line is extended by 1 unit on each side, but tip is still at length 5
const tip = line_angle([0, 0], 45, 5, { before: 1, after: 1 });
circle(tip, 4, { fill: "red" });
```

## Geometry helpers

Small helpers for line geometry. Points accept either `[x, y]` or `{x, y}`
(interchangeable). `on` and `cross` return `{x, y}`; `x_at` / `y_at`
return a number.

| Helper                           | Returns  | Meaning                                                                                                     |
| -------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `on(a, b, p)`                    | `{x, y}` | Point at fraction `p` along the segment `a -> b` (lerp).                                                    |
| `x_at(a, b, Y)`                  | `number` | The `x` where the line through `a` and `b` crosses `Y`.                                                     |
| `y_at(a, b, X)`                  | `number` | The `y` where the line through `a` and `b` crosses `X`.                                                     |
| `cross([a1, a2], [b1, b2])`      | `{x, y}` | Intersection of the line through `a1,a2` and the line through `b1,b2` (infinite lines). Throws if parallel. |
| `normal([a, b], p)`              | `{x, y}` | Foot of perpendicular from `p` onto the line through `a` and `b`. `[p, result]` meets line `a-b` at 90°.    |

```js
const A = { x: 0, y: 0 };
const B = [4, 6];

const M = on(A, B, 0.5);            // midpoint -> { x: 2, y: 3 }
const xWhereY3 = x_at(A, B, 3);     // 2
const yWhereX2 = y_at(A, B, 2);     // 3

// intersection of two lines
const P = cross([[0, 0], [4, 4]], [[0, 4], [4, 0]]);   // { x: 2, y: 2 }
circle(P, 4, { fill: "red" });

// drop a perpendicular from C onto line a-b
const C = { x: 1, y: 5 };
const F = normal([A, B], C);     // F is on line A-B
line(C, F, { thickness: 1, color: "#888" });

line(A, on(A, B, 0.9), { halfplane: { position: 1.0 } });
```

## Coordinate system notes

- The SVG is wrapped in `<g transform="translate(0 AREA) scale(1 -1)">` so
  positive `y` points up. `text` flips glyphs back locally so they render
  upright.
- Lengths (`r`, `thickness`, `size`, hatch `step`/`length`/`spacing`) are
  always in raw pixels — they do **not** scale with `STRIDE`. This keeps
  visual size constant when you switch grid scales.
- For `fill` and `halfplane`, "angle" is the **screen-visible** angle: the
  internal math compensates for the y-flip.

## Project layout

```text
index.ts        # Bun.serve entry, HTML import
index.html      # page shell
frontend.ts     # CodeMirror setup, draw API, render loop, buttons
styles.css      # light-theme UI
```
