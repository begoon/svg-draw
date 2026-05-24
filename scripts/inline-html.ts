#!/usr/bin/env bun
// Post-process `bun build` output: inline the CSS and JS assets that
// `bun build` emits next to index.html, so docs/index.html is a single
// self-contained file. Removes the now-redundant asset files.

import {
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const DOCS = "docs";
const HTML = join(DOCS, "index.html");

let html = readFileSync(HTML, "utf8");

// Inline <link rel="stylesheet" href="...css">
html = html.replace(
  /<link\b[^>]*\bhref=["']([^"']+\.css)["'][^>]*\/?>/g,
  (_m, href: string) => {
    const css = readFileSync(join(DOCS, href), "utf8");
    return `<style>${css}</style>`;
  },
);

// Inline <script ... src="...js" ...></script>
html = html.replace(
  /<script\b([^>]*)\bsrc=["']([^"']+\.js)["']([^>]*)><\/script>/g,
  (_m, before: string, src: string, after: string) => {
    let js = readFileSync(join(DOCS, src), "utf8");
    // Prevent inline JS from closing the surrounding <script> tag.
    js = js.replace(/<\/script>/gi, "<\\/script>");
    const attrs = `${before}${after}`
      .replace(/\bcrossorigin\b/g, "")
      .trim();
    return attrs ? `<script ${attrs}>${js}</script>` : `<script>${js}</script>`;
  },
);

writeFileSync(HTML, html);

// Remove the now-inlined asset files so docs/ holds just index.html.
for (const name of readdirSync(DOCS)) {
  if (name === "index.html") continue;
  unlinkSync(join(DOCS, name));
}

const size = statSync(HTML).size;
console.log(
  `Inlined into ${HTML} — single file, ${size.toLocaleString()} bytes`,
);
