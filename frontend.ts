import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  ViewPlugin,
  Decoration,
} from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import {
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  syntaxHighlighting,
  indentOnInput,
  syntaxTree,
} from "@codemirror/language";

const DEFAULT_AREA = 500;
const STORAGE_KEY = "svg-draw:code";

const STARTER = `// Coordinates: (0,0) is bottom-left, like math.
//
// Globals you can reassign at any time:
//   AREA    (default ${DEFAULT_AREA}) — SVG canvas is AREA x AREA
//   STRIDE  (default 1) — multiplies every x and y
//   ZERO    (default 0) — added to every x and y
// Effect: x -> ZERO + x * STRIDE  (same for y).

AREA = 500;
STRIDE = 50;
ZERO = 20;

// axes (in raw units, switch STRIDE back temporarily)
STRIDE = 1; ZERO = 0;
arrow([0, 20], [AREA, 20]);
arrow([20, 0], [20, AREA]);

// 6x6 grid of dots
STRIDE = 50; ZERO = 20;
for (let y = 0; y < 6; y++) {
  for (let x = 0; x < 6; x++) {
    circle([x, y], 4, { fill: "#000000" });
  }
}

// a couple of shapes on the grid
rect([1, 1], [3, 3], { thickness: 2, fill: "#aaccff" });
arrow([0, 5], [5, 0], { thickness: 2 });
text([0, 5], "x", { sub: "1", super: "2", size: 20 });
`;

type SvgPart = string;
type Pattern = { id: string; svg: string };
type DrawCtx = {
  parts: SvgPart[];
  needsArrowMarker: boolean;
  patterns: Map<string, Pattern>; // key -> { id, svg }
};
type DrawState = { STRIDE: number; ZERO: number; AREA: number };

const SHAPE_ANGLES: Record<string, number> = {
  h: 0,
  v: 90,
  "/": 45,
  "\\": 135,
};

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" :
    c === "<" ? "&lt;" :
    c === ">" ? "&gt;" :
    c === '"' ? "&quot;" : "&#39;"
  );
}

function makeApi(ctx: DrawCtx, state: DrawState) {
  const stroke = "black";
  const noFill = "none";
  // Apply ZERO + coord * STRIDE at call time so user can reassign mid-script.
  const tx = (v: number) => state.ZERO + v * state.STRIDE;

  // Shared options for stroked shapes.
  type StrokeOpts = { thickness?: number; color?: string };
  type FilledOpts = StrokeOpts & { fill?: string };

  // Point form used by the `_`-prefixed variants: [x, y] or {x, y}.
  type Pt = [number, number] | { x: number; y: number };
  const pt = (p: Pt): [number, number] =>
    Array.isArray(p) ? [p[0], p[1]] : [p.x, p.y];
  const isPt = (v: any): v is Pt => {
    if (Array.isArray(v))
      return v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number";
    return (
      v && typeof v === "object" && typeof v.x === "number" && typeof v.y === "number"
    );
  };
  type HalfplaneOpts = {
    side?: "left" | "right";
    count?: number;
    length?: number;
    spacing?: number;
    position?: "end" | "start" | "middle" | number;
    angle?: number;
    thickness?: number;
    color?: string;
  };

  // Emit halfplane strokes for the line (x1,y1)->(x2,y2). Used by both
  // the `halfplane` API and the `halfplane` option on `line`.
  function emitHalfplane(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    opts: HalfplaneOpts
  ) {
    const side = opts.side ?? "left";
    const count = opts.count ?? 4;
    const len = opts.length ?? 12;
    const spacing = opts.spacing ?? 8;
    const position = opts.position ?? "end";
    const angleDeg = opts.angle ?? 45;
    const thickness = opts.thickness ?? 1;
    const color = opts.color ?? stroke;

    const X1 = tx(x1), Y1 = tx(y1), X2 = tx(x2), Y2 = tx(y2);
    const dx = X2 - X1, dy = Y2 - Y1;
    const L = Math.hypot(dx, dy);
    if (L === 0) return;
    const ux = dx / L, uy = dy / L;

    const sign = side === "left" ? 1 : -1;
    const r = (sign * angleDeg * Math.PI) / 180;
    const cosR = Math.cos(r), sinR = Math.sin(r);
    const sx = ux * cosR - uy * sinR;
    const sy = ux * sinR + uy * cosR;

    let aX: number, aY: number;
    let walkSign = -1;
    let startIndex = 0;
    if (position === "end") { aX = X2; aY = Y2; walkSign = -1; }
    else if (position === "start") { aX = X1; aY = Y1; walkSign = 1; }
    else if (position === "middle") {
      aX = (X1 + X2) / 2;
      aY = (Y1 + Y2) / 2;
      walkSign = 1;
      startIndex = -Math.floor((count - 1) / 2);
    } else {
      const t = Number(position);
      aX = X1 + t * (X2 - X1);
      aY = Y1 + t * (Y2 - Y1);
      walkSign = 1;
      startIndex = -Math.floor((count - 1) / 2);
    }

    for (let k = 0; k < count; k++) {
      const i = startIndex + k;
      const bx = aX + walkSign * i * spacing * ux;
      const by = aY + walkSign * i * spacing * uy;
      const ex = bx + len * sx;
      const ey = by + len * sy;
      ctx.parts.push(
        `<line x1="${bx}" y1="${by}" x2="${ex}" y2="${ey}" stroke="${esc(color)}" stroke-width="${thickness}" stroke-linecap="round" />`
      );
    }
  }

  const api = {
    // line(p1, p2, ..., pN, opts?) — straight line for N=2, polyline for N>2.
    //   opts.thickness: stroke width, raw px (default 1)
    //   opts.color:     stroke color (default "black")
    //   opts.before:    extend the line beyond p1, by this many user units,
    //                   along the direction (p1 - p2). Default 0.
    //   opts.after:     extend the line beyond pN, by this many user units,
    //                   along the direction (pN - p(N-1)). Default 0.
    //   opts.halfplane: only honored when the user passed exactly N=2 points;
    //                   uses the user's original p1/p2 (extensions ignored).
    line(...args: any[]) {
      let opts: StrokeOpts & {
        halfplane?: HalfplaneOpts;
        before?: number;
        after?: number;
      } = {};
      const tail = args[args.length - 1];
      if (tail !== undefined && !isPt(tail) && typeof tail === "object") {
        opts = args.pop();
      }
      if (args.length < 2) {
        throw new Error("line needs at least 2 points");
      }
      const pts2: [number, number][] = args.map((p) => {
        if (!isPt(p)) throw new Error("line expects points as [x,y] or {x,y}");
        return pt(p);
      });

      const userN = pts2.length;

      // Extend the polyline at the ends if requested. Extensions are in
      // user coordinates and add extra path vertices, so the drawn line
      // stays continuous.
      const before = opts.before ?? 0;
      const after = opts.after ?? 0;
      if (before > 0) {
        const [x0, y0] = pts2[0];
        const [x1, y1] = pts2[1];
        const dx = x0 - x1, dy = y0 - y1;
        const d = Math.hypot(dx, dy);
        if (d > 0) {
          pts2.unshift([x0 + (dx / d) * before, y0 + (dy / d) * before]);
        }
      }
      if (after > 0) {
        const [xN, yN] = pts2[pts2.length - 1];
        const [xP, yP] = pts2[pts2.length - 2];
        const dx = xN - xP, dy = yN - yP;
        const d = Math.hypot(dx, dy);
        if (d > 0) {
          pts2.push([xN + (dx / d) * after, yN + (dy / d) * after]);
        }
      }

      const t = opts.thickness ?? 1;
      const c = opts.color ?? stroke;
      if (pts2.length === 2) {
        const [[x1, y1], [x2, y2]] = pts2;
        ctx.parts.push(
          `<line x1="${tx(x1)}" y1="${tx(y1)}" x2="${tx(x2)}" y2="${tx(y2)}" stroke="${esc(c)}" stroke-width="${t}" stroke-linecap="round" />`
        );
      } else {
        const ptsStr = pts2
          .map(([x, y]) => `${tx(x)},${tx(y)}`)
          .join(" ");
        ctx.parts.push(
          `<polyline points="${ptsStr}" stroke="${esc(c)}" stroke-width="${t}" fill="none" stroke-linecap="round" stroke-linejoin="round" />`
        );
      }

      if (opts.halfplane && userN === 2) {
        // Use the extended endpoints so halfplane.position spans the full
        // drawn line (before + segment + after).
        const [x1, y1] = pts2[0];
        const [x2, y2] = pts2[pts2.length - 1];
        emitHalfplane(x1, y1, x2, y2, opts.halfplane);
      }
    },
    // arrow(p1, p2, opts) — line with arrowhead at p2. Arrowhead color
    // inherits opts.color.
    arrow(p1: Pt, p2: Pt, opts: StrokeOpts = {}) {
      const [x1, y1] = pt(p1), [x2, y2] = pt(p2);
      const t = opts.thickness ?? 1;
      const c = opts.color ?? stroke;
      ctx.needsArrowMarker = true;
      ctx.parts.push(
        `<line x1="${tx(x1)}" y1="${tx(y1)}" x2="${tx(x2)}" y2="${tx(y2)}" stroke="${esc(c)}" stroke-width="${t}" stroke-linecap="round" marker-end="url(#arrowhead)" />`
      );
    },
    // circle(p, r, opts) — centered at p with radius r.
    circle(p: Pt, r: number, opts: FilledOpts = {}) {
      const [x, y] = pt(p);
      const t = opts.thickness ?? 1;
      const c = opts.color ?? stroke;
      const f = opts.fill ?? noFill;
      ctx.parts.push(
        `<circle cx="${tx(x)}" cy="${tx(y)}" r="${r}" stroke="${esc(c)}" stroke-width="${t}" fill="${esc(f)}" />`
      );
    },
    // square(p, r, opts) — centered at p; side = 2*r (mirrors circle's r).
    square(p: Pt, r: number, opts: FilledOpts = {}) {
      const [x, y] = pt(p);
      const t = opts.thickness ?? 1;
      const c = opts.color ?? stroke;
      const f = opts.fill ?? noFill;
      const cx = tx(x), cy = tx(y);
      ctx.parts.push(
        `<rect x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" stroke="${esc(c)}" stroke-width="${t}" fill="${esc(f)}" />`
      );
    },
    // rect(p1, p2, opts) — axis-aligned, corners in any order.
    rect(p1: Pt, p2: Pt, opts: FilledOpts = {}) {
      const [x1, y1] = pt(p1), [x2, y2] = pt(p2);
      const t = opts.thickness ?? 1;
      const c = opts.color ?? stroke;
      const f = opts.fill ?? noFill;
      const X1 = tx(x1), Y1 = tx(y1), X2 = tx(x2), Y2 = tx(y2);
      const x = Math.min(X1, X2);
      const y = Math.min(Y1, Y2);
      const w = Math.abs(X2 - X1);
      const h = Math.abs(Y2 - Y1);
      ctx.parts.push(
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" stroke="${esc(c)}" stroke-width="${t}" fill="${esc(f)}" />`
      );
    },
    // fill(p1, p2, ..., pN, opts) — pattern-fills a polygon of >=3 points.
    //   shape: "h" | "v" | "/" | "\\"  (default "/")
    //   step:  spacing between lines, raw px (default 8)
    //   thickness: line thickness, raw px (default 1)
    //   color: stroke color (default "#000000")
    fill(...args: any[]) {
      let opts: Record<string, any> = {};
      const tail = args[args.length - 1];
      if (tail !== undefined && !isPt(tail) && typeof tail === "object") {
        opts = args.pop();
      }
      if (args.length < 3) {
        throw new Error("fill needs at least 3 points");
      }
      const points = args.map((p) => {
        if (!isPt(p)) throw new Error("fill expects points as [x,y] or {x,y}");
        return pt(p);
      });
      const shape: string = opts.shape ?? "/";
      const step: number = Number(opts.step ?? 8);
      const thickness: number = Number(opts.thickness ?? 1);
      const color: string = String(opts.color ?? "#000000");
      const angle: number =
        shape in SHAPE_ANGLES ? SHAPE_ANGLES[shape] : Number(opts.angle ?? 45);

      // Pattern lives in the math-flipped local frame; negate angle so it
      // reads as the intended screen angle.
      const tileAngle = -angle;
      const key = `${tileAngle}|${step}|${thickness}|${color}`;
      let pat = ctx.patterns.get(key);
      if (!pat) {
        const id = `pat${ctx.patterns.size}`;
        const svg = `<pattern id="${id}" width="${step}" height="${step}" patternUnits="userSpaceOnUse" patternTransform="rotate(${tileAngle})">
          <line x1="0" y1="${step / 2}" x2="${step}" y2="${step / 2}" stroke="${esc(color)}" stroke-width="${thickness}" />
        </pattern>`;
        pat = { id, svg };
        ctx.patterns.set(key, pat);
      }
      const ptsStr = points.map(([x, y]) => `${tx(x)},${tx(y)}`).join(" ");
      ctx.parts.push(
        `<polygon points="${ptsStr}" fill="url(#${pat.id})" stroke="none" />`
      );
    },
    // text(p, text, opts)
    //   opts.size:   font size in raw px (default 10)
    //   opts.sub:    subscript string (default "")
    //   opts.super:  superscript string (default "")
    //   opts.scale:  sub/super font size = size * scale (default 0.7)
    //   opts.italic: render in italic (default false)
    text(
      p: Pt,
      text: string,
      opts: {
        size?: number;
        sub?: string;
        super?: string;
        scale?: number;
        italic?: boolean;
      } = {}
    ) {
      const [x, y] = pt(p);
      const size = opts.size ?? 10;
      const sub = opts.sub ?? "";
      const sup = opts.super ?? "";
      const scale = opts.scale ?? 0.7;
      const italic = opts.italic ?? false;
      const small = size * scale;
      const style = italic ? ` font-style="italic"` : "";
      const gap = size * 0.12;
      let inner = esc(text);
      if (sup) {
        inner += `<tspan dx="${gap}" baseline-shift="super" font-size="${small}">${esc(sup)}</tspan>`;
      }
      if (sub) {
        inner += `<tspan dx="${gap}" baseline-shift="sub" font-size="${small}">${esc(sub)}</tspan>`;
      }
      ctx.parts.push(
        `<text transform="translate(${tx(x)} ${tx(y)}) scale(1 -1)" font-family="sans-serif" font-size="${size}"${style} fill="${stroke}">${inner}</text>`
      );
    },
    // halfplane(p1, p2, opts) — see emitHalfplane for option semantics.
    halfplane(p1: Pt, p2: Pt, opts: HalfplaneOpts = {}) {
      const [x1, y1] = pt(p1), [x2, y2] = pt(p2);
      emitHalfplane(x1, y1, x2, y2, opts);
    },

    // line_angle(p, angle, length, opts) — line of `length` units from p,
    // at `angle` degrees (0 = +X axis, CCW positive). `length` is in user
    // coords (scales with STRIDE). Returns the end point as { x, y };
    // `opts.before` / `opts.after` extend the drawn line but do NOT affect
    // the returned point.
    line_angle(
      p: Pt,
      angle: number,
      length: number,
      opts?: StrokeOpts & {
        halfplane?: HalfplaneOpts;
        before?: number;
        after?: number;
      },
    ): { x: number; y: number } {
      const [x, y] = pt(p);
      const r = (angle * Math.PI) / 180;
      const x2 = x + length * Math.cos(r);
      const y2 = y + length * Math.sin(r);
      // before/after are honored inside line() via the same opts.
      api.line({ x, y }, { x: x2, y: y2 }, opts);
      return { x: x2, y: y2 };
    },

    // Geometry helpers. Points are [x, y] or {x, y}; results are {x, y}.
    // on(a, b, p)            — point at fraction p along the segment a->b.
    // x_at(a, b, Y)          — x of the line a-b at the given Y.
    // y_at(a, b, X)          — y of the line a-b at the given X.
    // cross([a1,a2],[b1,b2]) — intersection of the line through a1,a2
    //                          and the line through b1,b2 (infinite lines,
    //                          not segments). Throws if parallel.
    on(a: Pt, b: Pt, p: number): { x: number; y: number } {
      const [ax, ay] = pt(a), [bx, by] = pt(b);
      return { x: ax + p * (bx - ax), y: ay + p * (by - ay) };
    },
    x_at(a: Pt, b: Pt, Y: number): number {
      const [ax, ay] = pt(a), [bx, by] = pt(b);
      return ax + ((bx - ax) * (Y - ay)) / (by - ay);
    },
    y_at(a: Pt, b: Pt, X: number): number {
      const [ax, ay] = pt(a), [bx, by] = pt(b);
      return ay + ((by - ay) * (X - ax)) / (bx - ax);
    },
    cross(line1: [Pt, Pt], line2: [Pt, Pt]): { x: number; y: number } {
      if (!Array.isArray(line1) || line1.length !== 2 ||
          !Array.isArray(line2) || line2.length !== 2) {
        throw new Error("cross expects two [p1, p2] line tuples");
      }
      const [a1x, a1y] = pt(line1[0]);
      const [a2x, a2y] = pt(line1[1]);
      const [b1x, b1y] = pt(line2[0]);
      const [b2x, b2y] = pt(line2[1]);
      const dxA = a2x - a1x, dyA = a2y - a1y;
      const dxB = b2x - b1x, dyB = b2y - b1y;
      const denom = dxA * dyB - dyA * dxB;
      if (denom === 0) {
        throw new Error("cross: lines are parallel (no unique intersection)");
      }
      const t = ((b1x - a1x) * dyB - (b1y - a1y) * dxB) / denom;
      return { x: a1x + t * dxA, y: a1y + t * dyA };
    },
    // normal(a, b, over) — foot of perpendicular from `over` to the line
    // through a and b. The returned point P is on line a-b, and the segment
    // [over, P] meets line a-b at 90 degrees.
    normal(a: Pt, b: Pt, over: Pt): { x: number; y: number } {
      const [ax, ay] = pt(a);
      const [bx, by] = pt(b);
      const [ox, oy] = pt(over);
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) {
        throw new Error("normal: a and b must be distinct points");
      }
      const t = ((ox - ax) * dx + (oy - ay) * dy) / len2;
      return { x: ax + t * dx, y: ay + t * dy };
    },
    // _fill(p1, p2, ..., pN, opts?) — variadic points + optional opts.
    _fill(...args: any[]) {
      const flat: number[] = [];
      let opts: any = undefined;
      const tail = args[args.length - 1];
      if (tail !== undefined && !isPt(tail) && typeof tail === "object") {
        opts = args.pop();
      }
      for (const p of args) {
        if (!isPt(p)) {
          throw new Error("_fill expects points as [x,y] or {x,y}");
        }
        const [x, y] = pt(p);
        flat.push(x, y);
      }
      if (opts !== undefined) flat.push(opts);
      api.fill(...flat);
    },
  };
  return api;
}

function buildSvg(userCode: string): string {
  const ctx: DrawCtx = {
    parts: [],
    needsArrowMarker: false,
    patterns: new Map(),
  };
  const state: DrawState = { STRIDE: 1, ZERO: 0, AREA: DEFAULT_AREA };
  const api = makeApi(ctx, state);

  // Expose STRIDE/ZERO/AREA as bare identifiers via `with` + Proxy.
  // `has` traps ONLY these names so unrelated identifiers still
  // resolve to function parameters (line, circle, ...).
  const CONFIG_KEYS = new Set(["STRIDE", "ZERO", "AREA"]);
  const config = new Proxy({} as Record<string, number>, {
    has: (_t, k) => typeof k === "string" && CONFIG_KEYS.has(k),
    get: (_t, k) => state[k as keyof DrawState],
    set: (_t, k, v) => {
      if (typeof k === "string" && CONFIG_KEYS.has(k)) {
        state[k as keyof DrawState] = Number(v);
        return true;
      }
      return false;
    },
  });

  // Note: cannot use "use strict" here — `with` is forbidden in strict mode.
  const fn = new Function(
    "line",
    "arrow",
    "circle",
    "square",
    "rect",
    "fill",
    "text",
    "halfplane",
    "line_angle",
    "on",
    "x_at",
    "y_at",
    "cross",
    "normal",
    "__config",
    `with (__config) {\n${userCode}\n}`
  );
  fn(
    api.line,
    api.arrow,
    api.circle,
    api.square,
    api.rect,
    api.fill,
    api.text,
    api.halfplane,
    api.line_angle,
    api.on,
    api.x_at,
    api.y_at,
    api.cross,
    api.normal,
    config
  );

  const defsParts: string[] = [];
  if (ctx.needsArrowMarker) {
    defsParts.push(
      `<marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth="8" markerHeight="8" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
      </marker>`
    );
  }
  for (const p of ctx.patterns.values()) defsParts.push(p.svg);
  const defs = defsParts.length ? `<defs>${defsParts.join("\n")}</defs>` : "";

  const A = state.AREA;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${A} ${A}" width="${A}" height="${A}">
    ${defs}
    <g transform="translate(0 ${A}) scale(1 -1)">
      ${ctx.parts.join("\n      ")}
    </g>
  </svg>`;
}

const renderEl = document.getElementById("render") as HTMLDivElement;
const statusEl = document.getElementById("status") as HTMLDivElement;

let lastGoodSvg: string = "";

// Calibrate the line offset that `new Function(body)` reports in stack traces.
// Chrome wraps the body inside a synthetic `function anonymous(...) { body }`
// so error lines are shifted by a few. We detect the shift once by throwing
// from a known position and observing what line the engine reports.
let FN_LINE_OFFSET = 0;
try {
  new Function("throw new Error('CAL')")();
} catch (e: any) {
  const m = (e && e.stack || "").match(/<anonymous>:(\d+):/);
  if (m) FN_LINE_OFFSET = Number(m[1]) - 1;
}

// We further wrap user code as `with (__config) {\nUSER\n}` — so user line N
// corresponds to body line (N + 1). Combined offset relative to the
// anonymous function: user line N -> anonymous line (N + 1 + FN_LINE_OFFSET).
function extractUserLine(err: any): number | null {
  const stack: string = (err && err.stack) || "";
  const m = stack.match(/<anonymous>:(\d+):/);
  if (!m) return null;
  const userLine = Number(m[1]) - 1 - FN_LINE_OFFSET;
  return userLine >= 1 ? userLine : null;
}

// CodeMirror effect + state field for the red error-line decoration.
const setErrorLine = StateEffect.define<number | null>();
const errorLineField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    let next = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setErrorLine)) {
        const v = e.value;
        if (v == null || v < 1 || v > tr.state.doc.lines) {
          next = Decoration.none;
        } else {
          const line = tr.state.doc.line(v);
          next = Decoration.set([
            Decoration.line({ class: "cm-error-line" }).range(line.from),
          ]);
        }
      }
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function render(code: string) {
  try {
    const svg = buildSvg(code);
    renderEl.innerHTML = svg;
    lastGoodSvg = svg;
    statusEl.className = "status ok";
    statusEl.textContent = "ok";
    view.dispatch({ effects: setErrorLine.of(null) });
  } catch (e) {
    const userLine = extractUserLine(e);
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    statusEl.className = "status err";
    statusEl.textContent =
      userLine != null ? `line ${userLine}: ${msg}` : msg;
    view.dispatch({ effects: setErrorLine.of(userLine) });
    // keep previous render
  }
}

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let t: ReturnType<typeof setTimeout> | undefined;
  return ((...args: any[]) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  }) as T;
}

// Multi-file storage.
const FILES_KEY = "svg-draw:files";
type FilesState = { files: Record<string, string>; active: string };

function loadFiles(): FilesState {
  const raw = localStorage.getItem(FILES_KEY);
  if (raw) {
    try {
      const v = JSON.parse(raw);
      if (
        v && typeof v === "object" &&
        v.files && typeof v.files === "object" &&
        typeof v.active === "string" && v.active in v.files
      ) return v as FilesState;
    } catch {}
  }
  // Migrate from the old single-doc key, if present. Write the new key
  // BEFORE removing the old one so an unexpected error in between
  // doesn't lose the content. Also keep a one-shot backup copy.
  const legacy = localStorage.getItem(STORAGE_KEY);
  if (legacy != null) {
    const migrated: FilesState = {
      files: { "main.js": legacy },
      active: "main.js",
    };
    localStorage.setItem(FILES_KEY, JSON.stringify(migrated));
    localStorage.setItem("svg-draw:code.backup", legacy);
    localStorage.removeItem(STORAGE_KEY);
    return migrated;
  }
  const fresh: FilesState = {
    files: { "main.js": STARTER },
    active: "main.js",
  };
  localStorage.setItem(FILES_KEY, JSON.stringify(fresh));
  return fresh;
}

function saveFiles() {
  localStorage.setItem(FILES_KEY, JSON.stringify(filesState));
}

const filesState = loadFiles();

// Render is debounced; saving is immediate (each keystroke persists).
const renderDebounced = debounce((code: string) => render(code), 200);

// Names that should be highlighted as built-in API identifiers in the
// editor. Drawing functions, globals, and geometry helpers.
const API_FNS = new Set([
  "line",
  "arrow",
  "circle",
  "square",
  "rect",
  "fill",
  "text",
  "halfplane",
  "line_angle",
  "on",
  "x_at",
  "y_at",
  "cross",
  "normal",
]);
const API_GLOBALS = new Set(["AREA", "STRIDE", "ZERO"]);

// Lezer's JS grammar names a bare identifier reference `VariableName`.
// (Declarations like `let foo` use `VariableDefinition`, so this won't
// fire when a user shadows an API name — which is what we want: their
// local binding stops being the API.)
const apiHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        syntaxTree(u.startState) !== syntaxTree(u.state)
      ) {
        this.decorations = this.build(u.view);
      }
    }
    build(view: EditorView): DecorationSet {
      const fnMark = Decoration.mark({ class: "cm-api-fn" });
      const globMark = Decoration.mark({ class: "cm-api-global" });
      const b = new RangeSetBuilder<Decoration>();
      for (const { from, to } of view.visibleRanges) {
        syntaxTree(view.state).iterate({
          from,
          to,
          enter: (node) => {
            if (node.name !== "VariableName") return;
            const name = view.state.doc.sliceString(node.from, node.to);
            if (API_FNS.has(name)) b.add(node.from, node.to, fnMark);
            else if (API_GLOBALS.has(name)) b.add(node.from, node.to, globMark);
          },
        });
      }
      return b.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

const editorExtensions = [
  lineNumbers(),
  history(),
  indentOnInput(),
  bracketMatching(),
  highlightActiveLine(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  javascript(),
  apiHighlighter,
  errorLineField,
  keymap.of([...defaultKeymap, ...historyKeymap]),
  EditorView.theme({
    "&": { backgroundColor: "#ffffff", color: "#1f1f1f" },
    ".cm-content": { caretColor: "#000" },
    ".cm-gutters": {
      backgroundColor: "#f5f5f5",
      color: "#9a9a9a",
      border: "none",
      borderRight: "1px solid #e5e5e5",
    },
    ".cm-activeLine": { backgroundColor: "#f0f4ff" },
    ".cm-activeLineGutter": { backgroundColor: "#e8eefc" },
    ".cm-api-fn": { color: "#0a7c7c", fontWeight: "600" },
    ".cm-api-global": { color: "#8a2bb8", fontWeight: "600" },
    ".cm-error-line": { backgroundColor: "rgba(255, 80, 80, 0.18)" },
  }),
  EditorView.updateListener.of((u) => {
    if (u.docChanged) {
      const code = u.state.doc.toString();
      filesState.files[filesState.active] = code;
      saveFiles();
      renderDebounced(code);
    }
  }),
];

const view = new EditorView({
  parent: document.getElementById("editor") as HTMLDivElement,
  state: EditorState.create({
    doc: filesState.files[filesState.active],
    extensions: editorExtensions,
  }),
});

// Tab UI.
const tabsEl = document.getElementById("tabs") as HTMLDivElement;

function renderTabs() {
  tabsEl.innerHTML = "";
  for (const name of Object.keys(filesState.files)) {
    const tab = document.createElement("div");
    tab.className = "tab" + (name === filesState.active ? " active" : "");

    const label = document.createElement("span");
    label.className = "tab-label";
    label.textContent = name;
    label.title = "Click to activate, double-click to rename";
    label.addEventListener("click", () => activateTab(name));
    label.addEventListener("dblclick", () => renameTab(name));
    tab.appendChild(label);

    const rename = document.createElement("button");
    rename.className = "tab-rename";
    rename.textContent = "✎";
    rename.title = "Rename";
    rename.addEventListener("click", (e) => {
      e.stopPropagation();
      renameTab(name);
    });
    tab.appendChild(rename);

    const close = document.createElement("button");
    close.className = "tab-close";
    close.textContent = "×";
    close.title = "Close";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(name);
    });
    tab.appendChild(close);

    tabsEl.appendChild(tab);
  }
  const plus = document.createElement("button");
  plus.className = "tab-plus";
  plus.textContent = "+";
  plus.title = "New file";
  plus.addEventListener("click", () => newTab());
  tabsEl.appendChild(plus);
}

function activateTab(name: string) {
  if (!(name in filesState.files) || name === filesState.active) return;
  filesState.active = name;
  saveFiles();
  view.setState(
    EditorState.create({
      doc: filesState.files[name],
      extensions: editorExtensions,
    }),
  );
  renderTabs();
  render(filesState.files[name]);
}

function normalizeName(raw: string): string {
  const n = raw.trim();
  return n.endsWith(".js") ? n : n + ".js";
}

function newTab() {
  let i = 1;
  let suggested = `scratch${i}.js`;
  while (suggested in filesState.files) {
    i++;
    suggested = `scratch${i}.js`;
  }
  const raw = prompt("New file name (.js)", suggested);
  if (raw == null) return;
  const name = normalizeName(raw);
  if (!name || name === ".js") return;
  if (name in filesState.files) {
    alert(`File "${name}" already exists.`);
    return;
  }
  filesState.files[name] = "";
  filesState.active = name;
  saveFiles();
  renderTabs();
  view.setState(
    EditorState.create({ doc: "", extensions: editorExtensions }),
  );
  render("");
}

function renameTab(name: string) {
  const raw = prompt("Rename file", name);
  if (raw == null) return;
  const next = normalizeName(raw);
  if (!next || next === ".js" || next === name) return;
  if (next in filesState.files) {
    alert(`File "${next}" already exists.`);
    return;
  }
  // Preserve insertion order by rebuilding the files map.
  const rebuilt: Record<string, string> = {};
  for (const k of Object.keys(filesState.files)) {
    rebuilt[k === name ? next : k] = filesState.files[k];
  }
  filesState.files = rebuilt;
  if (filesState.active === name) filesState.active = next;
  saveFiles();
  renderTabs();
}

function closeTab(name: string) {
  if (!(name in filesState.files)) return;
  delete filesState.files[name];
  const remaining = Object.keys(filesState.files);
  if (remaining.length === 0) {
    filesState.files["main.js"] = "";
    filesState.active = "main.js";
  } else if (filesState.active === name) {
    filesState.active = remaining[0];
  }
  saveFiles();
  renderTabs();
  const code = filesState.files[filesState.active];
  view.setState(
    EditorState.create({ doc: code, extensions: editorExtensions }),
  );
  render(code);
}

renderTabs();
// initial render (not debounced)
render(filesState.files[filesState.active]);

// Buttons
function currentSvgString(): string {
  return lastGoodSvg;
}

function download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

document.getElementById("download-source")!.addEventListener("click", () => {
  const code = filesState.files[filesState.active] ?? "";
  const blob = new Blob([code], { type: "text/javascript;charset=utf-8" });
  download(filesState.active, blob);
});

document.getElementById("copy-svg")!.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(currentSvgString());
    statusEl.className = "status ok";
    statusEl.textContent = "SVG copied to clipboard";
  } catch (e) {
    statusEl.className = "status err";
    statusEl.textContent = `copy failed: ${e}`;
  }
});

document.getElementById("download-svg")!.addEventListener("click", () => {
  const blob = new Blob([currentSvgString()], { type: "image/svg+xml" });
  download("drawing.svg", blob);
});

document.getElementById("download-png")!.addEventListener("click", async () => {
  const svgStr = currentSvgString();
  const blob = new Blob([svgStr], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "sync";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image load failed"));
      img.src = url;
    });
    const scale = 2; // 2x for crispness
    // Read AREA from the rendered SVG so user-set AREA is respected.
    const m = svgStr.match(/viewBox="0 0 (\d+(?:\.\d+)?) /);
    const area = m ? Number(m[1]) : DEFAULT_AREA;
    const canvas = document.createElement("canvas");
    canvas.width = area * scale;
    canvas.height = area * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((b) => {
      if (b) download("drawing.png", b);
    }, "image/png");
  } catch (e) {
    statusEl.className = "status err";
    statusEl.textContent = `PNG export failed: ${e}`;
  } finally {
    URL.revokeObjectURL(url);
  }
});
