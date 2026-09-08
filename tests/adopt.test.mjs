// Tests the matching behind "bring notes you already have": which notes a folder,
// tag or property picks up, and which are left alone because another type has them.
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
    build.onResolve({ filter: /^(obsidian|\.\.\/model\/frontmatter)$/ }, (a) => ({ path: a.path, namespace: "stub" }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: `
        export class TFile { static [Symbol.hasInstance](v) { return !!v && typeof v.path === "string"; } }
        export const App = {};
        export const getAllTags = (cache) => cache?.tags ?? null;
        export const setField = async () => {};
      `,
    }));
  },
};

const out = join(mkdtempSync(join(tmpdir(), "vtr-adopt-")), "adopt.mjs");
const res = await build({ entryPoints: ["src/objects/adopt.ts"], bundle: true, format: "esm", write: false, plugins: [stub] });
writeFileSync(out, res.outputFiles[0].text);
const { groupsOf, candidates, matches, renameCheck } = await import(pathToFileURL(out).href);

// path → { tags, frontmatter }
const VAULT = {
  "Books/Dune.md": { frontmatter: { author: "Herbert" } },
  "Books/Piranesi.md": { frontmatter: { author: "Clarke" } },
  "Books/Old/Stoner.md": { frontmatter: { author: "Williams" } },
  "Books/Reading list.md": { frontmatter: {} },
  "Games/Hollow Knight.md": { tags: ["#game"], frontmatter: { object: "game" } },
  "Games/Celeste.md": { tags: ["#game"], frontmatter: {} },
  "Inbox.md": { frontmatter: {} },
};

const mk = (path) => ({ path, basename: path.split("/").pop().replace(/\.md$/, ""), parent: { path: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "/" } });
const files = Object.keys(VAULT).map(mk);
const app = {
  vault: { getMarkdownFiles: () => files },
  metadataCache: { getFileCache: (f) => VAULT[f.path] },
};
const typed = (f) => String(VAULT[f.path]?.frontmatter?.object ?? "");
const isTyped = (f) => !!typed(f);

test("a nested note belongs to every folder above it", () => {
  assert.deepEqual(groupsOf(app, mk("Books/Old/Stoner.md"), "folder"), ["Books", "Books/Old"]);
  assert.deepEqual(groupsOf(app, mk("Inbox.md"), "folder"), []);
});

test("reserved frontmatter keys are never offered as a grouping", () => {
  const keys = groupsOf(app, mk("Games/Hollow Knight.md"), "prop");
  assert.ok(!keys.includes("object"));
});

test("candidates rank by size and ignore notes that already have a type", () => {
  const folders = candidates(app, "folder", isTyped);
  assert.deepEqual(folders.map((c) => c.value), ["Books"]);
  assert.equal(folders[0].count, 4);
});

test("a folder picks up its subfolders", () => {
  const m = matches(app, "folder", "Books", typed);
  assert.equal(m.length, 4);
  assert.ok(m.every((x) => !x.taken));
});

test("notes already claimed by a type come back flagged, not hidden", () => {
  const m = matches(app, "tag", "game", typed);
  assert.deepEqual(m.map((x) => x.file.basename), ["Celeste", "Hollow Knight"]);
  assert.deepEqual(m.map((x) => x.taken), [false, true]);
});

test("a tag matches with or without the hash", () => {
  assert.equal(matches(app, "tag", "#game", typed).length, 2);
});

// Renaming a type rewrites its notes, because the name IS how a note joins it.
// The three cases that must not trigger that rewrite are what this pins down.
test("renaming to a name another type holds is refused", () => {
  assert.equal(renameCheck(["Book", "Game"], "WAG", "Game"), "clash");
  assert.equal(renameCheck(["Book", "Game"], "WAG", "game"), "clash");
});

test("changing only the case does not touch the notes", () => {
  assert.equal(renameCheck([], "WAG", "wag"), "cosmetic");
  assert.equal(renameCheck([], "Book", "BOOK"), "cosmetic");
});

test("an empty or unchanged name does nothing at all", () => {
  assert.equal(renameCheck([], "Book", "Book"), "noop");
  assert.equal(renameCheck([], "Book", "   "), "noop");
});

test("a real rename rewrites", () => {
  assert.equal(renameCheck(["Game"], "WAG", "Shop"), "rewrite");
  assert.equal(renameCheck([], "WAG", " Shop "), "rewrite");
});
