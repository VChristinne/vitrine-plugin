// trimSite cuts the site off a fetched <title> — the cases where it must not fire.
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
    build.onResolve({ filter: /^(obsidian|\.\.\/main|\.\.\/paths|\.\.\/objects\/model|\.\.\/render\/theme)$/ }, (a) => ({ path: a.path, namespace: "stub" }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: `
        export class Modal { constructor() {} }
        export class Notice { constructor() {} }
        export class TFile {}
        export const requestUrl = async () => ({ text: "" });
        export const ensureFolder = async () => {};
        export const join = (f, n) => (f ? f + "/" + n : n);
        export const freePath = async (a, b, c, d) => c;
        export const nameFitsFile = () => true;
        export const safeName = (n) => n;
        export const applyModalTheme = () => {};
      `,
    }));
  },
};

const out = join(mkdtempSync(join(tmpdir(), "vtr-")), "weblink.mjs");
const res = await build({ entryPoints: ["src/modals/weblink.ts"], bundle: true, format: "esm", write: false, plugins: [stub] });
writeFileSync(out, res.outputFiles[0].text);
const { trimSite } = await import(pathToFileURL(out).href);

test("the site's own name is dropped from the tail", () => {
  assert.equal(trimSite("Tenerife airport disaster - Wikipedia", "Wikipedia"), "Tenerife airport disaster");
  assert.equal(trimSite("Zed is now open source | Zed Blog", "Zed Blog"), "Zed is now open source");
  assert.equal(trimSite("anthropics/claude-code · GitHub", "github.com"), "anthropics/claude-code");
});

test("a tail that isn't the site stays", () => {
  assert.equal(trimSite("Tenerife airport disaster - Wikipedia", "example.com"), "Tenerife airport disaster - Wikipedia");
  assert.equal(trimSite("Reduce, reuse - recycle", "Wikipedia"), "Reduce, reuse - recycle");
});

test("a dash inside the title is not a suffix", () => {
  assert.equal(trimSite("Half-life of a weblink", "Wikipedia"), "Half-life of a weblink");
  assert.equal(trimSite("Wikipedia", "Wikipedia"), "Wikipedia");
});
