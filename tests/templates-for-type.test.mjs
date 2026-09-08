// Tests templatesForType: which template notes each object type offers in its New
// menu. A template is `status: template` PLUS an `object:` naming its type — both,
// so a vault already using `status: template` on its own keeps those notes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// model.ts only needs a handful of Obsidian symbols on this path.
const stub = {
  name: "stub",
  setup(build) {
    build.onResolve({ filter: /^(obsidian|\.\.\/main|\.\.\/types|\.\.\/model\/.*|\.\/query)$/ }, (a) => ({
      path: a.path,
      namespace: "stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: `
        // The fake vault hands out plain objects, so instanceof accepts anything
        // file-shaped rather than demanding this exact class.
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
const res = await build({
  entryPoints: ["src/objects/model.ts"],
  bundle: true,
  format: "esm",
  write: false,
  plugins: [stub],
});
writeFileSync(out, res.outputFiles[0].text);
const { templatesForType, notePropDefs } = await import(pathToFileURL(out).href);

// A tiny in-memory vault: path → frontmatter.
function makePlugin(files, types) {
  const mk = (path) => ({ path, basename: (path.split("/").pop() ?? "").replace(/\.md$/, ""), extension: "md" });
  const all = Object.keys(files).map(mk);
  return {
    settings: { objectTypes: types },
    saveSettings: () => {},
    app: {
      vault: {
        getMarkdownFiles: () => all,
        getAbstractFileByPath: (p) => all.find((f) => f.path === p) ?? null,
      },
      metadataCache: { getFileCache: (f) => ({ frontmatter: files[f.path] ?? {} }) },
    },
  };
}

const TYPES = [
  { id: "__pages", name: "Page", namePlural: "Pages", tag: "", icon: "file", color: "#888", props: [] },
  { id: "type-writing", name: "Writing", tag: "writing", icon: "book", color: "#888", props: [] },
];

const FILES = {
  "Templates/Chapter.md": { status: "template", object: "writing", collection: "Chapters" },
  "Templates/Lecture.md": { status: "template" }, // no `object:` — not a template
  "Templates/Note.md": { status: "template", object: "page" },
  "Templates/Character.md": { status: "template", object: "writing" },
  "Notes/Real note.md": { object: "writing" },
};

const names = (plugin, type) => templatesForType(plugin, type).map((f) => f.basename).sort();

test("a template's `object:` decides which type offers it", () => {
  const plugin = makePlugin(FILES, structuredClone(TYPES));
  assert.deepEqual(names(plugin, TYPES[1]), ["Chapter", "Character"]);
});

test("Pages offers the templates that name it, not the ones of other types", () => {
  const plugin = makePlugin(FILES, structuredClone(TYPES));
  assert.deepEqual(names(plugin, TYPES[0]), ["Note"]);
});

test("`status: template` without an `object:` is not a template", () => {
  const plugin = makePlugin(FILES, structuredClone(TYPES));
  const all = [...names(plugin, TYPES[0]), ...names(plugin, TYPES[1])];
  assert.ok(!all.includes("Lecture"));
});

test("notes that aren't templates are never offered", () => {
  const plugin = makePlugin(FILES, structuredClone(TYPES));
  const all = [...names(plugin, TYPES[0]), ...names(plugin, TYPES[1])];
  assert.ok(!all.includes("Real note"));
});

test("a template attached in the type editor is offered once, not twice", () => {
  const types = structuredClone(TYPES);
  types[1].templates = ["Templates/Chapter.md"];
  const plugin = makePlugin(FILES, types);
  assert.deepEqual(names(plugin, types[1]), ["Chapter", "Character"]);
});

test("a note attached in the type editor is offered even if it isn't a template", () => {
  const types = structuredClone(TYPES);
  types[1].templates = ["Templates/Lecture.md"];
  const plugin = makePlugin(FILES, types);
  assert.deepEqual(names(plugin, types[1]), ["Chapter", "Character", "Lecture"]);
});

// The property panel edits scalars; a task's `recur` rule and `occurrences` log
// are structured, and used to surface as an "[object Object]" pill.
test("structured frontmatter values are not offered as properties", () => {
  const files = {
    "Tasks/Weekly.md": {
      status: "Done",
      recur: { mode: "schedule", every: 1, unit: "week", weekdays: [1] },
      occurrences: [{ date: "2026-08-24", status: "completed" }],
      links: ["[[A]]", "[[B]]"],
    },
  };
  const plugin = makePlugin(files, structuredClone(TYPES));
  const keys = notePropDefs(plugin, { path: "Tasks/Weekly.md" }).map((p) => p.key);
  assert.deepEqual(keys, ["status", "links"]);
});
