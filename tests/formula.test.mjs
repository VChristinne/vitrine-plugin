// A formula prop evaluates its expression over the note's frontmatter. It must
// never throw: a missing prop, a typo or a division by zero reads empty.
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const stub = {
  name: "stub",
  setup(build) {
    build.onResolve({ filter: /^(obsidian|\.\.\/main|\.\.\/paths)$/ }, (a) => ({ path: a.path, namespace: "stub" }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: `export const getAllTags = () => []; export const TFile = {}; export const App = {};
        export const freePath = (p) => p; export const join = (...p) => p.join("/"); export const safeName = (s) => s;`,
    }));
  },
};

const out = await build({ entryPoints: ["src/objects/model.ts"], bundle: true, format: "esm", write: false, plugins: [stub] });
const file = join(mkdtempSync(join(tmpdir(), "vtr-")), "model.mjs");
writeFileSync(file, out.outputFiles[0].text);
const { evalFormula } = await import(pathToFileURL(file).href);

test("a formula reads the note's other props", () => {
  assert.equal(evalFormula("sell / time", { sell: 552, time: 20 }), 27.6);
  assert.equal(evalFormula("sell - 100", { sell: 552 }), 452);
  assert.equal(evalFormula("kind + '!'", { kind: "Artisan Good" }), "Artisan Good!");
});

test("a long ratio is rounded, not dumped in full", () => {
  assert.equal(evalFormula("sell / time", { sell: 6800, time: 280 }), 24.29);
});

test("nothing to compute reads empty", () => {
  assert.equal(evalFormula("sell / time", { sell: 552 }), ""); // time missing
  assert.equal(evalFormula("sell / time", { sell: 552, time: 0 }), ""); // Infinity
  assert.equal(evalFormula("sell /", { sell: 552 }), ""); // broken expression
  assert.equal(evalFormula("", {}), "");
  assert.equal(evalFormula("depends", { depends: ["[[A]]"] }), ""); // no object dumps
});
