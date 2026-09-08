// The fields a menu offers for a type or one of its collections: the schema first,
// then the keys the notes actually use — sorted, and minus what the object page hides.
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
const { scopeProps, objectTypes } = await import(pathToFileURL(out).href);

const notes = {
  "a.md": { object: "type-x", author: "Ana", zeta: "1", alpha: "2", gone: "x", description: "d", localCover: "c.png", collection: "Lab" },
  "b.md": { object: "type-x", beta: "3" },
};

const plugin = {
  settings: {
    coverProperty: "localCover",
    objectTypes: [
      {
        id: "type-x",
        name: "X",
        tag: "x",
        icon: "box",
        color: "#000",
        props: [{ key: "author", kind: "text" }],
        dropped: ["gone"],
        collections: [{ id: "c1", name: "Lab", members: [], props: [] }],
      },
    ],
  },
  saveSettings: () => {},
  app: {
    vault: { getMarkdownFiles: () => Object.keys(notes).map((path) => ({ path })) },
    metadataCache: { getFileCache: (f) => ({ frontmatter: notes[f.path] }) },
  },
};

const type = objectTypes(plugin).find((t) => t.id === "type-x");
const keys = (coll) => scopeProps(plugin, type, coll).map((p) => p.key);

test("schema first, discovered keys after it in alphabetical order", () => {
  assert.deepEqual(keys(), ["author", "alpha", "beta", "zeta"]);
});

test("a dropped key is not rediscovered from the notes that still carry it", () => {
  assert.ok(!keys().includes("gone"));
});

test("the cover and description keys stay hidden, as on the object page", () => {
  assert.ok(!keys().includes("localCover"));
  assert.ok(!keys().includes("description"));
});

test("a collection sees only the keys of its own notes", () => {
  assert.deepEqual(keys("Lab"), ["author", "alpha", "zeta"]);
});
