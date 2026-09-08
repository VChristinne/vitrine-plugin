// Tests the one module with fiddly logic. Run with `npm test`.
// fields.ts is pure (nothing from Obsidian), so stripping the type annotations
// with esbuild is enough to import it here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { pathToFileURL } from "node:url";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = buildSync({
  entryPoints: ["src/model/fields.ts"],
  bundle: false,
  format: "esm",
  write: false,
});
const dir = mkdtempSync(join(tmpdir(), "vitrine-"));
const file = join(dir, "fields.mjs");
writeFileSync(file, out.outputFiles[0].text);
const { asList, asText, asNumber, asYear, byOrder, sameText, average, keepShape, selectOptions, toggleSelect, splitFrontmatter, templateFields } = await import(
  pathToFileURL(file).href
);

test("asText keeps a scalar whole but takes a list's first", () => {
  assert.equal(asText("Chapter 1: Beginnings, and Ends"), "Chapter 1: Beginnings, and Ends");
  assert.equal(asText(["read", "owned"]), "read");
  assert.equal(asText(" A "), "A");
  assert.equal(asText(""), undefined);
  assert.equal(asText(null), undefined);
});

test("splitFrontmatter tolerates LF and CRLF", () => {
  assert.deepEqual(splitFrontmatter("---\ntitle: X\n---\nbody"), { fm: "title: X", body: "body" });
  assert.deepEqual(splitFrontmatter("---\r\ntitle: X\r\n---\r\nbody"), { fm: "title: X", body: "body" });
  assert.deepEqual(splitFrontmatter("no fm"), { fm: "", body: "no fm" });
});

test("asList takes lists, scalars and comma separated strings", () => {
  assert.deepEqual(asList(["read"]), ["read"]);
  assert.deepEqual(asList("read"), ["read"]);
  assert.deepEqual(asList("a, b ,c"), ["a", "b", "c"]);
  assert.deepEqual(asList(null), []);
  assert.deepEqual(asList([" A ", ""]), ["A"]);
});

test("asNumber takes fractional ratings", () => {
  assert.equal(asNumber(3.25), 3.25);
  assert.equal(asNumber("4.75"), 4.75);
  assert.equal(asNumber(["5"]), 5);
  assert.equal(asNumber("n/a"), undefined);
  assert.equal(asNumber(undefined), undefined);
});

test("asYear pulls the year out of dates", () => {
  assert.equal(asYear(2023), 2023);
  assert.equal(asYear("2019-05-01"), 2019);
  assert.equal(asYear("01/05/2023"), 2023);
  assert.equal(asYear(""), undefined);
});

test("sameText ignores case and surrounding space", () => {
  assert.equal(sameText("read", " Read "), true);
  assert.equal(sameText("read", "reading"), false);
});

test("byOrder pushes items without an order to the end", () => {
  const list = [
    { title: "C", order: 2 },
    { title: "A" },
    { title: "B", order: 1 },
  ];
  assert.deepEqual(list.sort(byOrder).map((i) => i.title), ["B", "C", "A"]);
});

test("byOrder breaks ties with natural title order", () => {
  const list = [{ title: "Vol. 10" }, { title: "Vol. 2" }];
  assert.deepEqual(list.sort(byOrder).map((i) => i.title), ["Vol. 2", "Vol. 10"]);
});

test("average ignores an empty list", () => {
  assert.equal(average([]), undefined);
  assert.equal(average([4, 5]), 4.5);
});

test("keepShape preserves list vs scalar and clears on empty", () => {
  // The note already stored a list, so a new status stays a list.
  assert.deepEqual(keepShape(["read"], "reading"), ["reading"]);
  // A scalar (or absent) property stays scalar.
  assert.equal(keepShape("read", "reading"), "reading");
  assert.equal(keepShape(undefined, 4), 4);
  // Empty means clear, whatever the previous shape.
  assert.equal(keepShape(["read"], ""), undefined);
  assert.equal(keepShape("read", undefined), undefined);
});

test("templateFields keeps a template's own fields, list values and all", () => {
  const fm = [
    "tags:",
    "  - topic/",
    "  - source/course",
    "pdf: \"\"",
    "status: template",
    "object: __pages",
    "score:",
  ].join("\n");
  assert.deepEqual(templateFields(fm, new Set(["status", "object", "title"])), [
    "tags:",
    "  - topic/",
    "  - source/course",
    'pdf: ""',
    "score:",
  ]);
});

test("templateFields drops a skipped key's whole block", () => {
  const fm = "tags:\n  - a\ntitle: Ignored\nlonely:";
  assert.deepEqual(templateFields(fm, new Set(["title"])), ["tags:", "  - a", "lonely:"]);
});

test("selectOptions keeps a stored value the schema no longer offers", () => {
  assert.deepEqual(selectOptions(["Spring", "Summer"], ["Summer", "Fall"]), ["Spring", "Summer", "Fall"]);
  assert.deepEqual(selectOptions(["Spring"], undefined), ["Spring"]);
  assert.deepEqual(selectOptions(undefined, "Fall"), ["Fall"]);
});

test("toggleSelect ticks and unticks, always in options order", () => {
  const opts = ["Spring", "Summer", "Fall", "Winter"];
  assert.deepEqual(toggleSelect(opts, ["Winter"], "Spring"), ["Spring", "Winter"]);
  assert.deepEqual(toggleSelect(opts, ["Spring", "Winter"], "Winter"), ["Spring"]);
  assert.deepEqual(toggleSelect(opts, ["Spring"], "Spring"), []);
});
