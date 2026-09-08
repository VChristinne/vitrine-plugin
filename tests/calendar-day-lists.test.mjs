// The Day view keeps two lists apart: what a date property put on the day, and
// what was actually created that day. An object can be in both.
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
    build.onResolve({ filter: /^(obsidian|\.\.\/main|\.\/model|\.\.\/objects\/model)$/ }, (a) => ({
      path: a.path,
      namespace: "stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: `export const TFile = {}; export const App = {}; export const setIcon = () => {};
        export const moment = (ms) => ({ format: () => new Date(ms).toISOString().slice(0, 10) });
        export const allObjects = (p) => p.__files ?? [];
        export const typeOf = (p, f) => f.__type ?? null;
        export const typeOrPage = (p, f, types) => f.__type ?? types.find((t) => t.id === "__pages") ?? null;
        export const objectDate = (fm) => fm.date ?? "";
        export const objectTypes = () => []; export const coverImage = () => null;
        export const title = () => ""; export const typeOf_ = null;`,
    }));
  },
};

const out = await build({
  entryPoints: ["src/objects/calendar.ts"],
  bundle: true,
  format: "esm",
  write: false,
  plugins: [stub],
});
const file = join(mkdtempSync(join(tmpdir(), "vtr-cal-")), "calendar.mjs");
writeFileSync(file, out.outputFiles[0].text);
const { byDate, hasTaskItems } = await import(pathToFileURL(file).href);

const DAY = "2026-08-27";
const ms = (iso) => Date.parse(`${iso}T12:00:00Z`);
const file_ = (path, born, date, type) => ({ path, stat: { ctime: ms(born) }, __type: type, __fm: date ? { date } : {} });

const plugin = (files) => ({
  __files: files,
  app: { metadataCache: { getFileCache: (f) => ({ frontmatter: f.__fm }) } },
});

test("a dated object lands in Dated, not in Created, on the day it names", () => {
  const f = file_("plan.md", "2026-08-01", DAY);
  const idx = byDate(plugin([f]), []);
  assert.deepEqual(idx.dated.get(DAY), [f]);
  assert.equal(idx.created.get(DAY), undefined);
  assert.deepEqual(idx.created.get("2026-08-01"), [f]);
});

test("an undated object shows only under Created, on its creation day", () => {
  const f = file_("note.md", DAY, null);
  const idx = byDate(plugin([f]), []);
  assert.equal(idx.dated.get(DAY), undefined);
  assert.deepEqual(idx.created.get(DAY), [f]);
});

test("an object both dated and created today appears in both lists", () => {
  const f = file_("today.md", DAY, DAY);
  const idx = byDate(plugin([f]), []);
  assert.deepEqual(idx.dated.get(DAY), [f]);
  assert.deepEqual(idx.created.get(DAY), [f]);
});

test("the grid views still place each object once, the date property winning", () => {
  const dated = file_("plan.md", "2026-08-01", DAY);
  const plain = file_("note.md", DAY, null);
  const idx = byDate(plugin([dated, plain]), []);
  assert.deepEqual(idx.placed.get(DAY), [dated, plain]);
  assert.equal(idx.placed.get("2026-08-01"), undefined);
});

test("a type hidden from the calendar stays out of every list", () => {
  const f = file_("shop.md", DAY, DAY, { calHidden: true });
  const idx = byDate(plugin([f]), []);
  assert.equal(idx.placed.size, 0);
  assert.equal(idx.dated.size, 0);
  assert.equal(idx.created.size, 0);
});

// The Day view scans notes for checkbox lines naming that date. Reading every note
// in the vault to find them is the whole cost, so the metadata cache decides who is
// worth opening: no task list item, no read.
test("a note with a checkbox is worth reading", () => {
  assert.ok(hasTaskItems({ listItems: [{ task: " " }] }));
  assert.ok(hasTaskItems({ listItems: [{}, { task: "x" }] }));
});

test("a note with no checkbox is skipped, cache or no cache", () => {
  assert.ok(!hasTaskItems({ listItems: [{}, {}] }));
  assert.ok(!hasTaskItems({}));
  assert.ok(!hasTaskItems(null));
});
