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

- Auto re-render ~200 ms after each keystroke.
- Code persists to `localStorage` on every change.
- Invalid JS shows an error in the status bar; the last good SVG stays on screen.
- Buttons:
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

### `line(x1, y1, x2, y2, opts={})`

Straight line with rounded caps. Accepts `thickness`, `color`, and an
optional `halfplane` shortcut.

| Option      | Default   | Meaning                                                                                                       |
| ----------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| `thickness` | `1`       | Stroke width.                                                                                                 |
| `color`     | `"black"` | Stroke color.                                                                                                 |
| `halfplane` | none      | If set to a halfplane options object, also draws `halfplane(x1, y1, x2, y2, opts.halfplane)` for this line.   |

```js
line(0, 0, 5, 5);
line(0, 0, 5, 5, { thickness: 2 });
line(0, 0, 5, 5, { color: "#0044aa", thickness: 2 });

// line + halfplane in one call
line(Z.x, Z.y, C2.x, C2.y, {
  thickness: 1,
  halfplane: { position: 0.9, angle: 135 }
});
```

### `circle(x, y, r, opts={})`

Circle centered at `(x, y)` with radius `r`. Accepts `thickness`, `color`,
`fill`.

```js
circle(2, 3, 10);                                  // outlined
circle(2, 3, 10, { fill: "#aaccff" });             // filled
circle(2, 3, 10, { thickness: 2, color: "red", fill: "#aaccff" });
```

### `square(x, y, r, opts={})`

Same options as `circle`, but draws a square centered at `(x, y)` with
half-side `r` (so the side length is `2 * r`).

```js
square(2, 3, 8);
square(2, 3, 8, { fill: "#000000" });
```

### `rect(x1, y1, x2, y2, opts={})`

Axis-aligned rectangle from `(x1, y1)` to `(x2, y2)`. Endpoints can be given
in any order. Accepts `thickness`, `color`, `fill`.

```js
rect(1, 1, 4, 3);
rect(1, 1, 4, 3, { fill: "#ffddaa" });
rect(1, 1, 4, 3, { thickness: 2, color: "darkred", fill: "#ffddaa" });
```

### `arrow(x1, y1, x2, y2, opts={})`

Line from `(x1, y1)` to `(x2, y2)` with a filled triangular arrowhead at
`(x2, y2)`. Accepts `thickness`, `color`. The arrowhead is rendered in the
same color as the line.

```js
arrow(0, 0, 5, 4);
arrow(0, 0, 5, 4, { thickness: 2 });
arrow(0, 0, 5, 4, { color: "#0044aa", thickness: 2 });
```

### `text(x, y, text, opts={})`

Text whose **baseline** sits at `(x, y)` (in math coordinates — y goes up).
Glyphs are flipped locally so they render upright.

`opts`:

| Option   | Default | Meaning                                                          |
| -------- | ------- | ---------------------------------------------------------------- |
| `size`   | `10`    | Font size in raw px.                                             |
| `sub`    | `""`    | Subscript string (appended after the main text).                 |
| `super`  | `""`    | Superscript string (appended after the main text).               |
| `scale`  | `0.7`   | Sub/super font size = `size * scale`.                            |
| `italic` | `false` | Render in italic (applies to the main text and sub/super).       |

Sub and super are placed immediately after the main text with a small
horizontal gap of `size * 0.12` so they don't crowd the preceding glyph.
Both can be combined on the same call.

```js
text(2, 3, "x");
text(2, 3, "x", { sub: "1", super: "2", size: 20 });
text(2, 3, "E = mc", { super: "2", size: 24, scale: 0.5 });
text(2, 3, "v", { italic: true, sub: "i", size: 18 });
```

### `fill(x1, y1, x2, y2, ..., xN, yN, opts)`

Pattern-fills a polygon defined by at least 3 points (6 numbers).
Hatching uses an SVG `<pattern>`, so it's automatically clipped to the polygon
border regardless of edge angle.

`opts`:

| Option      | Default     | Meaning                                                                |
| ----------- | ----------- | ---------------------------------------------------------------------- |
| `shape`     | `"/"`       | `"h"` (horizontal), `"v"` (vertical), `"/"` (45°), `"\\"` (135°).      |
| `step`      | `8`         | Spacing between hatch lines in raw px.                                 |
| `thickness` | `1`         | Hatch line thickness in raw px.                                        |
| `color`     | `"#000000"` | Hatch line color.                                                      |

```js
// triangle hatched at 45°
fill(0, 0, 5, 0, 0, 5, { shape: "/" });

// pentagon with vertical lines, wider spacing
fill(2, 2, 4, 2, 4.5, 4, 3, 5, 1.5, 4, { shape: "v", step: 12 });

// arbitrary polygon, back-slash hatching, thicker, blue
fill(0, 6, 3, 6, 3, 6.5, 1.5, 7, 0, 6.5,
     { shape: "\\", step: 6, thickness: 1.5, color: "#0044aa" });
```

Polygons can be concave and the same `(angle, step, thickness, color)` is
deduplicated into a single `<pattern>` definition.

### `halfplane(x1, y1, x2, y2, opts={})`

Draws a few short hatch strokes on one side of the line — the math/engineering
convention for marking which half-plane is "in".

`opts`:

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
line(1, 1, 5, 4);
halfplane(1, 1, 5, 4, { side: "left" });

// back-leaning, on the right
halfplane(1, 3, 5, 6, { side: "right", angle: 135 });

// constraint y >= 2, mark the upper half-plane along the whole line
line(0, 2, 6, 2);
halfplane(0, 2, 6, 2, { side: "left", position: "middle",
                        count: 6, spacing: 30 });
```

## Point-style variants (`_`-prefixed)

Every point-taking function has an `_`-prefixed variant where each `(x, y)`
pair is collapsed into a single point given as either `[x, y]` or `{x, y}`.
The two point forms are interchangeable and can even be mixed in the same
call. All other arguments (radius, opts, etc.) keep their original meaning.

| Raw form                                    | Point-style form                               |
| ------------------------------------------- | ---------------------------------------------- |
| `line(x1, y1, x2, y2, opts?)`               | `_line(p1, p2, opts?)`                         |
| `arrow(x1, y1, x2, y2, opts?)`              | `_arrow(p1, p2, opts?)`                        |
| `circle(x, y, r, opts?)`                    | `_circle(p, r, opts?)`                         |
| `square(x, y, r, opts?)`                    | `_square(p, r, opts?)`                         |
| `rect(x1, y1, x2, y2, opts?)`               | `_rect(p1, p2, opts?)`                         |
| `text(x, y, text, opts?)`                   | `_text(p, text, opts?)`                        |
| `halfplane(x1, y1, x2, y2, opts?)`          | `_halfplane(p1, p2, opts?)`                    |
| `fill(x1, y1, ..., xN, yN, opts)`           | `_fill(p1, p2, ..., pN, opts?)`                |

Examples:

```js
const A = { x: 1, y: 2 };
const B = [3, 4];

_line(A, B);
_line(A, B, { thickness: 2, halfplane: { position: 0.9, angle: 135 } });

_circle(A, 10, { fill: "#aaccff" });

_text({ x: 0, y: 5 }, "x", { sub: "1", super: "2", size: 20 });

_fill([0, 0], [5, 0], [0, 5], { shape: "/" });

_halfplane([0, 2], [6, 2], { side: "left", position: "middle", count: 6 });
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
