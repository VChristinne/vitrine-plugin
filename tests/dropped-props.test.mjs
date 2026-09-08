// A removed built-in prop must survive typeConfigs' backfill. Also pins coverKey.
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
    build.onResolve({ filter: /^(obsidian|\.\.\/main|\.\.\/types|\.\.\/model\/.*|\.\/query)$/ }, (a) => ({
      path: a.path,
      namespace: "stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: `
        export class TFile { static [Symbol.hasInstance](v) { return !!v && typeof v.path === "string"; } }
        export const getAllTags = (cache) => cache?.tags ?? [];
        export const App = {};
        export const moment = () => ({ format: () => "" });
        export const setIcon = () => {};
        export const resolveCover = () => "";
        export const splitFrontmatter = () => ({ fm: {}, body: "" });
        export const templateFields = () => [];
        export const normalizePath = (p) => p;
      `,
    }));
  },
};

const out = join(mkdtempSync(join(tmpdir(), "vtr-")), "model.mjs");
const res = await build({ entryPoints: ["src/objects/model.ts"], bundle: true, format: "esm", write: false, plugins: [stub] });
writeFileSync(out, res.outputFiles[0].text);
const { typeConfigs, coverImage, coverKey } = await import(pathToFileURL(out).href);

const weblink = (extra) => ({
  id: "__weblink",
  name: "Weblink",
  namePlural: "Weblinks",
  tag: "weblink",
  icon: "globe",
  color: "#3a63c2",
  props: [{ key: "url", kind: "text" }],
  builtin: true,
  ...extra,
});

const makePlugin = (types) => ({
  settings: { objectTypes: types },
  saveSettings: () => {},
  app: { vault: { getMarkdownFiles: () => [] }, metadataCache: { getFileCache: () => null } },
});

const keys = (cfgs) => cfgs.find((c) => c.id === "__weblink").props.map((p) => p.key);

test("a built-in's missing props are backfilled", () => {
  assert.deepEqual(keys(typeConfigs(makePlugin([weblink()]))), ["url", "site", "description", "image"]);
});

test("a dropped built-in prop is not backfilled", () => {
  const cfgs = typeConfigs(makePlugin([weblink({ dropped: ["site", "image"] })]));
  assert.deepEqual(keys(cfgs), ["url", "description"]);
});

test("a dropped prop still stored in the schema is pruned", () => {
  const cfg = weblink({ props: [{ key: "url", kind: "text" }, { key: "site", kind: "text" }], dropped: ["site"] });
  assert.ok(!keys(typeConfigs(makePlugin([cfg]))).includes("site"));
});

test("coverKey names the key the cover came from", () => {
  const fm = { image: "https://x/y.jpg", url: "https://x" };
  assert.equal(coverKey(fm), "image");
  assert.equal(coverImage(fm, fm.url), "https://x/y.jpg");
  assert.equal(coverKey({ url: "https://x" }), "");
});
