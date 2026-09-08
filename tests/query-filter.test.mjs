// A filter's value holds one or more picks (newline-separated): several selected
// means "any of these", and "is not" means none of them.
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
    build.onResolve({ filter: /^(obsidian|\.\.\/main|\.\/model|\.\/task-recur|\.\/task-create)$/ }, (a) => ({
      path: a.path,
      namespace: "stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: `export const getAllTags = () => []; export const TFile = {}; export const App = {};
        export const objectTypes = (p) => p.__types ?? []; export const objectsOfType = (p) => p.__files ?? []; export const inCollection = () => true;
        export const title = () => ""; export const isRecurring = () => false; export const derivedValue = () => null;
        export const PRIORITY_ORDER = []; export const STATUS_BOARD_ORDER = [];`,
    }));
  },
};

const out = await build({
  entryPoints: ["src/objects/query.ts"],
  bundle: true,
  format: "esm",
  write: false,
  plugins: [stub],
});
const file = join(mkdtempSync(join(tmpdir(), "vtr-")), "query.mjs");
writeFileSync(file, out.outputFiles[0].text);
const { matches, filterValues, evalQuery, describeQuery } = await import(pathToFileURL(file).href);

const note = (fm) => ({ stat: { ctime: 0, mtime: 0 } , __fm: fm });
const app = { metadataCache: { getFileCache: (f) => ({ frontmatter: f.__fm }) } };
// matches() takes the plugin (it resolves formula props through the schema).
const plug = { app };

test("one pick behaves like the old single value", () => {
  const f = note({ machine: "Oven" });
  assert.equal(matches(plug, f, { key: "machine", op: "is", value: "Oven" }), true);
  assert.equal(matches(plug, f, { key: "machine", op: "is", value: "Keg" }), false);
});

test("a link prop matches on what it reads as, not on the brackets", () => {
  const f = note({ machine: "[[Cosmetic Crystal]]" });
  assert.equal(matches(plug, f, { key: "machine", op: "is", value: "Cosmetic Crystal" }), true);
  assert.equal(matches(plug, f, { key: "machine", op: "contains", value: "crystal" }), true);
  assert.equal(matches(plug, note({ depends: ["[[Olive Oil]]", "[[Sweet Basil]]"] }),
    { key: "depends", op: "is", value: "Olive Oil" }), true);
});

test("several picks mean any of them", () => {
  const flt = { key: "machine", op: "is", value: "Keg\nOven" };
  assert.equal(matches(plug, note({ machine: "Oven" }), flt), true);
  assert.equal(matches(plug, note({ machine: "Keg" }), flt), true);
  assert.equal(matches(plug, note({ machine: "Mill" }), flt), false);
});

test("is not means none of the picks", () => {
  const flt = { key: "machine", op: "not", value: "Keg\nOven" };
  assert.equal(matches(plug, note({ machine: "Mill" }), flt), true);
  assert.equal(matches(plug, note({ machine: "Keg" }), flt), false);
});

test("contains reaches into a list prop", () => {
  const flt = { key: "crafting", op: "contains", value: "Kettle\nOven" };
  assert.equal(matches(plug, note({ crafting: ["Cooking", "Oven"] }), flt), true);
  assert.equal(matches(plug, note({ crafting: ["Cooking"] }), flt), false);
});

test("is hits one item of a list prop, not the joined string", () => {
  const f = note({ crafting: ["Cooking", "Oven"] });
  assert.equal(matches(plug, f, { key: "crafting", op: "is", value: "Oven" }), true);
  assert.equal(matches(plug, f, { key: "crafting", op: "is", value: "Kettle" }), false);
  assert.equal(matches(plug, f, { key: "crafting", op: "not", value: "Oven" }), false);
  assert.equal(matches(plug, f, { key: "crafting", op: "not", value: "Kettle" }), true);
});

test("> and < work on numbers and on ISO dates", () => {
  assert.equal(matches(plug, note({ sell: 1005 }), { key: "sell", op: "gt", value: "500" }), true);
  assert.equal(matches(plug, note({ sell: 100 }), { key: "sell", op: "gt", value: "500" }), false);
  assert.equal(matches(plug, note({ publish: "2024-05-01" }), { key: "publish", op: "gt", value: "2020-01-01" }), true);
  assert.equal(matches(plug, note({ publish: "2018-05-01" }), { key: "publish", op: "gt", value: "2020-01-01" }), false);
  assert.equal(matches(plug, note({ sell: 1005 }), { key: "sell", op: "gt", value: "" }), false);
});

test("an empty value still matches everything, as before", () => {
  assert.deepEqual(filterValues({ key: "x", op: "contains", value: "" }), []);
  assert.equal(matches(plug, note({ machine: "Oven" }), { key: "machine", op: "contains", value: "" }), true);
});

// The reason multi-sort exists: 87 Shop items share time 900, so the first rule
// leaves them tied and the second is what actually orders them.
test("sort rules run in order, each breaking the ties above it", () => {
  const shop = (path, time, sell, fuel) => ({ path, stat: { ctime: 0, mtime: 0 }, __fm: { time, sell, fuel } });
  const files = [shop("a", 900, 200), shop("b", 300, 999), shop("c", 900, 800), shop("d", 900, 500, "Hops")];
  const plugin = { app, __types: [{ id: "t" }], __files: files };
  const spec = {
    id: "q", name: "", icon: "", color: "", typeIds: [],
    filters: [{ key: "fuel", op: "empty" }],
    sort: [{ field: "time", dir: "asc" }, { field: "sell", dir: "desc" }],
  };
  assert.deepEqual(evalQuery(plugin, spec).map((f) => f.path), ["b", "c", "a"]);
  assert.deepEqual(evalQuery(plugin, { ...spec, limit: 2 }).map((f) => f.path), ["b", "c"]);
});

test("describeQuery spells out scope, filters, sort and grouping", () => {
  const q = {
    id: "q1", name: "Cost-effective", icon: "coins",
    typeIds: ["type-shop"], collection: "Kitchen",
    filters: [
      { key: "machine", op: "notempty", value: "" },
      { key: "sell", op: "gt", value: "500" },
      { key: "crafting", op: "is", value: "Oven\nKettle" },
    ],
    sort: [{ field: "sell", dir: "desc" }],
    groupBy: "machine",
    limit: 10,
  };
  assert.equal(
    describeQuery(q, ["Shop"]),
    "Shop / Kitchen \u00b7 machine is not empty, sell > 500, crafting is Oven or Kettle \u00b7 by sell \u2193 \u00b7 grouped by machine \u00b7 top 10",
  );
});

test("describeQuery falls back when a query spans every type", () => {
  assert.equal(describeQuery({ id: "q", name: "n", icon: "", typeIds: [], filters: [] }, []), "All types");
});
