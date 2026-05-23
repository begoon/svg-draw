import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  syntaxHighlighting,
  indentOnInput,
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
arrow(0, 20, AREA, 20);
arrow(20, 0, 20, AREA);

// 6x6 grid of dots
STRIDE = 50; ZERO = 20;
for (let y = 0; y < 6; y++) {
  for (let x = 0; x < 6; x++) {
    circle(x, y, 4, { fill: "#000000" });
  }
}

// a couple of shapes on the grid
rect(1, 1, 3, 3, { thickness: 2, fill: "#aaccff" });
arrow(0, 5, 5, 0, { thickness: 2 });
text(0, 5, "x", { sub: "1", super: "2", size: 20 });
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
    // line(x1, y1, x2, y2, opts)
    //   opts.thickness: stroke width, raw px (default 1)
    //   opts.color:     stroke color (default "black")
    //   opts.halfplane: if set, also draw halfplane strokes on this line
    //                   (same options as the halfplane() function).
    line(
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      opts: StrokeOpts & { halfplane?: HalfplaneOpts } = {}
    ) {
      const t = opts.thickness ?? 1;
      const c = opts.color ?? stroke;
      ctx.parts.push(
        `<line x1="${tx(x1)}" y1="${tx(y1)}" x2="${tx(x2)}" y2="${tx(y2)}" stroke="${esc(c)}" stroke-width="${t}" stroke-linecap="round" />`
      );
      if (opts.halfplane) emitHalfplane(x1, y1, x2, y2, opts.halfplane);
    },
    // circle(x, y, r, opts)
    //   opts.thickness: stroke width (default 1)
    //   opts.color:     stroke color (default "black")
    //   opts.fill:      fill color (default: no fill)
    circle(
      x: number,
      y: number,
      r: number,
      opts: FilledOpts = {}
    ) {
      const t = opts.thickness ?? 1;
      const c = opts.color ?? stroke;
      const f = opts.fill ?? noFill;
      ctx.parts.push(
        `<circle cx="${tx(x)}" cy="${tx(y)}" r="${r}" stroke="${esc(c)}" stroke-width="${t}" fill="${esc(f)}" />`
      );
    },
    // square(x, y, r, opts) — centered at (x,y); side = 2*r (like circle).
    square(
      x: number,
      y: number,
      r: number,
      opts: FilledOpts = {}
    ) {
      const t = opts.thickness ?? 1;
      const c = opts.color ?? stroke;
      const f = opts.fill ?? noFill;
      const cx = tx(x), cy = tx(y);
      ctx.parts.push(
        `<rect x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" stroke="${esc(c)}" stroke-width="${t}" fill="${esc(f)}" />`
      );
    },
    // arrow(x1, y1, x2, y2, opts)
    //   opts.thickness: stroke width (default 1)
    //   opts.color:     stroke + arrowhead color (default "black")
    arrow(
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      opts: StrokeOpts = {}
    ) {
      const t = opts.thickness ?? 1;
      const c = opts.color ?? stroke;
      ctx.needsArrowMarker = true;
      ctx.parts.push(
        `<line x1="${tx(x1)}" y1="${tx(y1)}" x2="${tx(x2)}" y2="${tx(y2)}" stroke="${esc(c)}" stroke-width="${t}" stroke-linecap="round" marker-end="url(#arrowhead)" />`
      );
    },
    // rect(x1, y1, x2, y2, opts) — axis-aligned, endpoints in any order.
    //   opts.thickness, opts.color, opts.fill — same as circle.
    rect(
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      opts: FilledOpts = {}
    ) {
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
    // fill(x1, y1, x2, y2, ..., { shape, step?, thickness?, color? })
    // Pattern-fills a polygon defined by the given points.
    //   shape: "h" | "v" | "/" | "\\"  (default "/")
    //   step:  spacing between lines, raw px (default 8)
    //   thickness: line thickness, raw px (default 1)
    //   color: stroke color (default "#000000")
    fill(...args: any[]) {
      let opts: Record<string, any> = {};
      const tail = args[args.length - 1];
      if (tail && typeof tail === "object" && !Array.isArray(tail)) {
        opts = args.pop();
      }
      if (args.length < 6 || args.length % 2 !== 0) {
        throw new Error(
          "fill needs at least 3 points (6 numbers) and an options object"
        );
      }
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
      const ptsStr: string[] = [];
      for (let j = 0; j < args.length; j += 2) {
        ptsStr.push(`${tx(args[j])},${tx(args[j + 1])}`);
      }
      ctx.parts.push(
        `<polygon points="${ptsStr.join(" ")}" fill="url(#${pat.id})" stroke="none" />`
      );
    },
    // text(x, y, text, opts)
    //   opts.size:   font size in raw px (default 10)
    //   opts.sub:    subscript string (default "")
    //   opts.super:  superscript string (default "")
    //   opts.scale:  sub/super font size = size * scale (default 0.7)
    //   opts.italic: render in italic (default false)
    text(
      x: number,
      y: number,
      text: string,
      opts: {
        size?: number;
        sub?: string;
        super?: string;
        scale?: number;
        italic?: boolean;
      } = {}
    ) {
      const size = opts.size ?? 10;
      const sub = opts.sub ?? "";
      const sup = opts.super ?? "";
      const scale = opts.scale ?? 0.7;
      const italic = opts.italic ?? false;
      const small = size * scale;
      const style = italic ? ` font-style="italic"` : "";
      // Small horizontal gap before sub/super so they don't crowd the
      // main text (proportional to font size).
      const gap = size * 0.12;
      let inner = esc(text);
      if (sup) {
        inner += `<tspan dx="${gap}" baseline-shift="super" font-size="${small}">${esc(sup)}</tspan>`;
      }
      if (sub) {
        inner += `<tspan dx="${gap}" baseline-shift="sub" font-size="${small}">${esc(sub)}</tspan>`;
      }
      // Text lives inside the math-flipped group; flip locally so glyphs
      // are upright. y is the text baseline in math coords.
      ctx.parts.push(
        `<text transform="translate(${tx(x)} ${tx(y)}) scale(1 -1)" font-family="sans-serif" font-size="${size}"${style} fill="${stroke}">${inner}</text>`
      );
    },
    // halfplane(x1, y1, x2, y2, opts) — mark one side of the line with
    // short parallel hatch strokes (math-convention "this side is in").
    //   side:      "left" | "right" of the line direction (default "left")
    //   count:     number of strokes (default 4)
    //   length:    stroke length in raw px (default 12)
    //   spacing:   distance between strokes along the line, raw px (default 8)
    //   position:  "end" | "start" | "middle" | number 0..1 (default "end")
    //   angle:     stroke angle from the line, in degrees (default 45)
    //   thickness: stroke thickness (default 1)
    //   color:     stroke color (default "black")
    halfplane(
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      opts: HalfplaneOpts = {}
    ) {
      emitHalfplane(x1, y1, x2, y2, opts);
    },

    // Point-style variants: each raw (x, y) pair becomes a single point
    // given as [x, y] or {x, y}.
    _line(p1: Pt, p2: Pt, opts?: StrokeOpts & { halfplane?: HalfplaneOpts }) {
      const [x1, y1] = pt(p1), [x2, y2] = pt(p2);
      api.line(x1, y1, x2, y2, opts);
    },
    _arrow(p1: Pt, p2: Pt, opts?: StrokeOpts) {
      const [x1, y1] = pt(p1), [x2, y2] = pt(p2);
      api.arrow(x1, y1, x2, y2, opts);
    },
    _circle(p: Pt, r: number, opts?: FilledOpts) {
      const [x, y] = pt(p);
      api.circle(x, y, r, opts);
    },
    _square(p: Pt, r: number, opts?: FilledOpts) {
      const [x, y] = pt(p);
      api.square(x, y, r, opts);
    },
    _rect(p1: Pt, p2: Pt, opts?: FilledOpts) {
      const [x1, y1] = pt(p1), [x2, y2] = pt(p2);
      api.rect(x1, y1, x2, y2, opts);
    },
    _text(
      p: Pt,
      text: string,
      opts?: {
        size?: number;
        sub?: string;
        super?: string;
        scale?: number;
        italic?: boolean;
      }
    ) {
      const [x, y] = pt(p);
      api.text(x, y, text, opts);
    },
    _halfplane(p1: Pt, p2: Pt, opts?: HalfplaneOpts) {
      const [x1, y1] = pt(p1), [x2, y2] = pt(p2);
      api.halfplane(x1, y1, x2, y2, opts);
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
    "circle",
    "square",
    "arrow",
    "text",
    "rect",
    "fill",
    "halfplane",
    "_line",
    "_circle",
    "_square",
    "_arrow",
    "_text",
    "_rect",
    "_fill",
    "_halfplane",
    "__config",
    `with (__config) {\n${userCode}\n}`
  );
  fn(
    api.line,
    api.circle,
    api.square,
    api.arrow,
    api.text,
    api.rect,
    api.fill,
    api.halfplane,
    api._line,
    api._circle,
    api._square,
    api._arrow,
    api._text,
    api._rect,
    api._fill,
    api._halfplane,
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

function render(code: string) {
  try {
    const svg = buildSvg(code);
    renderEl.innerHTML = svg;
    lastGoodSvg = svg;
    statusEl.className = "status ok";
    statusEl.textContent = "ok";
  } catch (e) {
    statusEl.className = "status err";
    statusEl.textContent = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
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

const initialCode = localStorage.getItem(STORAGE_KEY) ?? STARTER;

const onChange = debounce((code: string) => {
  localStorage.setItem(STORAGE_KEY, code);
  render(code);
}, 200);

const view = new EditorView({
  parent: document.getElementById("editor") as HTMLDivElement,
  state: EditorState.create({
    doc: initialCode,
    extensions: [
      lineNumbers(),
      history(),
      indentOnInput(),
      bracketMatching(),
      highlightActiveLine(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      javascript(),
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
      }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) {
          onChange(u.state.doc.toString());
        }
      }),
    ],
  }),
});

// initial render (not debounced)
render(initialCode);

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
