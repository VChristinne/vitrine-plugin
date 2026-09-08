// A query bound to a collection belongs to that collection's page only, and an
// unscoped one narrows to whichever collection you're looking at.
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
const { queriesFor, scopeTo } = await import(pathToFileURL(file).href);

const q = (id, typeIds, collection) => ({ id, name: id, icon: "filter", typeIds, filters: [], collection });
const ALL = [q("machines-only", ["shop"], "Machines"), q("shop-wide", ["shop"]), q("everything", []), q("tasks", ["task"])];

test("a type's own tab bar hides the collection-bound queries", () => {
  assert.deepEqual(queriesFor(ALL, "shop").map((x) => x.id), ["shop-wide", "everything"]);
});

test("a collection shows the type's queries plus its own, unscoped first", () => {
  assert.deepEqual(queriesFor(ALL, "shop", "Machines").map((x) => x.id), ["shop-wide", "everything", "machines-only"]);
});

test("another collection doesn't inherit a sibling's queries", () => {
  assert.deepEqual(queriesFor(ALL, "shop", "Oven").map((x) => x.id), ["shop-wide", "everything"]);
});

test("queries of other types never show", () => {
  assert.ok(!queriesFor(ALL, "shop", "Machines").some((x) => x.id === "tasks"));
});

test("an unscoped query narrows to the open collection, leaving the saved spec alone", () => {
  const spec = q("shop-wide", ["shop"]);
  assert.equal(scopeTo(spec, "Machines").collection, "Machines");
  assert.equal(spec.collection, undefined);
});

test("a query with its own scope keeps it, and no collection means no scope", () => {
  assert.equal(scopeTo(q("m", ["shop"], "Machines"), "Oven").collection, "Machines");
  assert.equal(scopeTo(q("w", ["shop"]), undefined).collection, undefined);
});
