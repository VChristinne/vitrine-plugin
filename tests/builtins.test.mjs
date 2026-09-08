// Seed and release: the built-in types are created once so a fresh vault is not
// empty, and after that they belong to the user — deleting one has to stick.
// Pages is the exception: it is the bucket every untyped note falls into.
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
    build.onResolve({ filter: /^(obsidian|\.\.\/main|\.\.\/types|\.\.\/model\/.*|\.\/query)$/ }, (a) => ({ path: a.path, namespace: "stub" }));
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

const out = join(mkdtempSync(join(tmpdir(), "vtr-b-")), "model.mjs");
const res = await build({ entryPoints: ["src/objects/model.ts"], bundle: true, format: "esm", write: false, plugins: [stub] });
writeFileSync(out, res.outputFiles[0].text);
const { typeConfigs } = await import(pathToFileURL(out).href);

const plug = (settings) => ({
  settings,
  saveSettings: () => {},
  app: {
    vault: { getMarkdownFiles: () => [], getAbstractFileByPath: () => null },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
  },
});

const ids = (p) => typeConfigs(p).map((c) => c.id).sort();

test("a save that never saw the built-ins gets them once", () => {
  const p = plug({ objectTypes: [{ id: "type-x", name: "X", tag: "", icon: "box", color: "#000", props: [] }] });
  assert.deepEqual(ids(p), ["__pages", "__task", "__weblink", "type-x"]);
  assert.equal(p.settings.seeded, true);
});

test("a built-in deleted after seeding stays deleted", () => {
  const p = plug({ seeded: true, objectTypes: [{ id: "__pages", name: "Page", tag: "", icon: "file", color: "#000", props: [] }] });
  assert.deepEqual(ids(p), ["__pages"]);
});

test("Pages comes back even after seeding, because untyped notes need it", () => {
  const p = plug({ seeded: true, objectTypes: [] });
  assert.deepEqual(ids(p), ["__pages"]);
});

test("a built-in's edited properties survive a reload", () => {
  const task = { id: "__task", name: "Task", tag: "task", icon: "check", color: "#000", props: [{ key: "mine", kind: "text" }] };
  const p = plug({ seeded: true, objectTypes: [task] });
  typeConfigs(p);
  assert.deepEqual(task.props, [{ key: "mine", kind: "text" }]);
});
