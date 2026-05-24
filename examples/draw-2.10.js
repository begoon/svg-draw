const L = 6;

AREA = 600;

ZERO = 70;
STRIDE = 70;

const N = [0, 0];

//

arrow(N, [L, 0]);
arrow(N, [0, L]);

text([-0.5, -0.5], "0", { size: 16 });

for (let i = 1; i < L; i++) {
    text([i - 0.05, -0.3], String(i), { size: 16 });
    text([-0.3, i - 0.05], String(i), { size: 16 });
}

for (let y = 0; y < L; y++) {
    for (let x = 0; x < L; x++) {
        line([x, 0], [x, (L - 1) * 1.05]);
        line([0, y], [(L - 1) * 1.05, y]);
    }
}

//

function Q(p, v, index, opts) {
    opts = { ...opts, size: 20, italic: true };
    text(p, v, opts);
    text([p.x + 0.3, p.y], index, { size: opts.size - 2 });
}

// Y axis legend
Q({ x: -0.9, y: 5.6 }, "x", "[2]", { super: "p" });
Q({ x: -0.9, y: 5.1 }, "h", "[2]", { super: "p" });

// X axis legend
Q({ x: 6, y: -0.8 }, "x", "[1]", { super: "p" });
Q({ x: 3.7, y: -0.7 }, "h", "[1]", { super: "p" });

// Z
const Z = { x: 1.8, y: 3.1 };
const Zv = [N, Z];

arrow(N, [Z.x * 0.8, Z.y * 0.8], { thickness: 3 });
line(N, [Z.x * 2, Z.y * 2]);

//
rect([3, 2], [5, 5], { thickness: 4 });

circle([3, 2], 6, { fill: "yellow" });
circle([4, 2], 6, { fill: "yellow" });
circle([5, 2], 6, { fill: "yellow" });
circle([5, 3], 6, { fill: "yellow" });

for (let y = 4; y <= 5; ++y) {
    for (let x = 0; x <= 5; ++x) {
        circle([x, y], 6, { fill: "blue" });
    }
}
circle([2, 3], 6, { fill: "red" });
circle([3, 3], 6, { fill: "blue" });
circle([4, 3], 6, { fill: "blue" });

//

line([1, 0], [5, 4], { before: 1, after: 1, halfplane: { position: 0.95, angle: -45 * 3 } });
line([0, 4], [5, 1.2], { before: 1, after: 1, halfplane: { position: 0.95, angle: 45 * 3 } });

const C1 = [0, 4];
const C2 = [5, 4];

const XLopt = cross([[1, 0], C2], [C1, [4.8, 1.15]]);
circle(XLopt, 5, { fill: "green" });

const XLoptA = normal(Zv, XLopt);
line(XLopt, XLoptA, { thickness: 2, before: 3.5, after: 1, color: "green" });

fill(C1, XLopt, C2, [5, 5], [0, 5], { shape: "\\", step: 10 });

//

const Xdp = [3, 3];
const XdpA = normal(Zv, Xdp);
line(Xdp, XdpA, { thickness: 2, before: 4, after: 1, color: "green" });
angle90(Zv, [Xdp, XdpA], { size: 14, thickness: 2 });

//

const P = [4, 2];
const Pa = normal(Zv, P);
line(P, Pa, { thickness: 2, before: 2.4, after: 1, color: "green" });

//

const XPdp = [2, 3];
const XPdpA = normal(Zv, XPdp);
line(XPdp, XPdpA, { thickness: 2, before: 5, after: 1, color: "green" });

//

text([-0.4, 0.3], "Z", { super: "p", size: 24, italic: true });
text([-1, 0.3], "grad", { size: 20, italic: true });
line([-0.1, 0.4], on([0, 0], Z, 0.4));

//
const T = "\u0303";

text([-0.9, 3.5], "x", { super: "p", sub: "opt", size: 22, italic: true });
line([-0.5, 3.7], C1);

text([1.2, 1.2], "x" + T, { sub: "DP", size: 22, italic: true });
line([1.3, 1.5], XPdp);

text([6, 3.5], "x", { sub: "DP", size: 22, italic: true });
line([5.9, 3.5], Xdp);

text([2.2, 0.5], "x", { super: "p", sub: "min", size: 22, italic: true });
line([2.5, 0.8], [3, 2]);

//

text([6, 1.5], "Z", { sub: "DP", size: 22, italic: true });
text([6.4, 0.6], "Z" + T, { sub: "DP", size: 22, italic: true });
text([6.4, 0.1], "Z", { sub: "opt", super: "p", size: 22, italic: true });
text([5.4, 0.3], "Z", { super: "l", sub: "opt", size: 22, italic: true });

//
text([5.4, 2.6], "Линии уровня", { size: 16 });
text([5.4, 2.2], "целевой функции", { size: 16 });
