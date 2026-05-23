const L = 6;

AREA = 600;

ZERO = 70;
STRIDE = 70;

arrow([0, 0], [L, 0]);
arrow([0, 0], [0, L]);

function Q(p, v, index, opts) {
    opts = { ...opts, size: 20, italic: true };
    text(p, v, opts);
    text([p.x + 0.3, p.y], index, { size: opts.size - 2 });
}

// Y axis legend
Q({ x: -0.85, y: 6 }, "x", "[2]", { super: "l" });
Q({ x: -0.9, y: 5.6 }, "x", "[2]", { super: "p" });
Q({ x: -0.9, y: 5.1 }, "h", "[2]", { super: "p" });

// X axis legend
Q({ x: 6, y: -0.4 }, "x", "[1]", { super: "l" });
Q({ x: 6, y: -0.8 }, "x", "[1]", { super: "p" });
Q({ x: 3.7, y: -0.7 }, "h", "[1]", { super: "p" });

// D area
rect([1, 2], [4, 5], { thickness: 4 });

// Z
const Z = { x: 1.4, y: 2.2 };

for (let y = 0; y < L; y++) {
    for (let x = 0; x < L; x++) {
        line([x, 0], [x, (L - 1) * 1.05]);
        line([0, y], [(L - 1) * 1.05, y]);
    }
}

for (let y = 0; y <= 5; y++) {
    for (let x = 0; x <= 4; x++) {
        circle([x, y], 6, { fill: "yellow" });
    }
}

arrow([0, 0], [Z.x * 0.8, Z.y * 0.8], { thickness: 2 });
circle(Z, 6, { fill: "red" });
square(Z, 9, { thickness: 2 });

for (let i = 1; i < L; i++) {
    text([i - 0.05, -0.3], String(i), { size: 16 });
    text([-0.3, i - 0.05], String(i), { size: 16 });
}

text([-0.5, -0.5], "0", { size: 16 });

for (let y = 2; y <= 5; ++y) {
    for (let x = 2; x <= 4; ++x) {
        circle([x, y], 6, { fill: "blue" });
    }
}

circle([1, 5], 6, { fill: "blue" });
circle([4, 1], 6, { fill: "blue" });

fill([1, 2], [4, 2], [4, 5], [1, 5], { shape: "v", step: 4, color: "green" });

const C1 = line_angle(Z, 105, 4, { thickness: 3 });
const C2 = line_angle(Z, -32, 4.5, { thickness: 3 });

const C1x_5 = x_at(Z, C1, 5);
const C2y_4 = y_at(Z, C2, 4);

line(Z, C1, { halfplane: { position: 0.9, angle: -45 } });
line(Z, C2, { halfplane: { position: 0.9, angle: 45 * 3 } });

fill([C1x_5, 5], [4, 5], [4, C2y_4], Z, { shape: "\\", step: 12, color: "blue" });

line([4, 0], [4, 6], { halfplane: { position: 0.94, angle: 45 * 3 } });
line([0, 5], [6, 5], { halfplane: { position: 0.94, angle: -3 * 45 } });

//

text([2.2, 6], "D", { super: "l", size: 30, italic: true });
line([2.1, 5.8], [2.6, 5.8]);
line([2.1, 5.8], [1.4, 3.2]);

//

text([-0.4, 0.3], "Z", { size: 24, italic: true });
text([-1, 0.3], "grad", { size: 20, italic: true });
line([-0.1, 0.4], on([0, 0], Z, 0.4));

//

text([0, -0.6], "x", { sub: "min", super: "p", size: 20, italic: true });
line([0.2, -0.2], [1, 2]);

text([4, 7], "область начального поиска", { size: 14 });
text([4, 6.7], "субоптимального решения", { size: 14 });

line([3.8, 6.9], [3.3, 6.9]);
line([3.3, 6.9], [2.1, 2.2]);
