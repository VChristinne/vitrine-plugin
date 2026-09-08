// Tests parseTaskInput(): priority bangs, the schedule/deadline split around a
// "due" marker, recurrence and the date forms (relative words, DD/MM, ISO,
// month words). Bundled with a stub for obsidian's exports.
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
    build.onResolve({ filter: /^(obsidian|\.\.\/paths|\.\/model)$/ }, (a) => ({ path: a.path, namespace: "stub" }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: `export { default as moment } from "moment"; export const TFile = {};
        export const objectTypes = () => []; export const objectsOfType = () => []; export const title = () => "";
        export const ensureFolder = async () => {}; export const freePath = (p) => p; export const nameFitsFile = () => true; export const safeName = (n) => n;`,
      resolveDir: process.cwd(),
    }));
  },
};

const out = (await build({
  entryPoints: ["src/objects/task-create.ts"],
  bundle: true,
  format: "esm",
  write: false,
  plugins: [stub],
})).outputFiles[0].text;
const file = join(mkdtempSync(join(tmpdir(), "vtr-")), "task-create.mjs");
writeFileSync(file, out);
const { parseTaskInput } = await import(pathToFileURL(file).href);

const moment = (await import("moment")).default;
const today = moment().format("YYYY-MM-DD");
const tomorrow = moment().add(1, "day").format("YYYY-MM-DD");
const nextFri = (() => {
  const t = moment().day(5);
  if (t.isSameOrBefore(moment(), "day")) t.add(7, "days");
  return t.format("YYYY-MM-DD");
})();

test("both dates on one line", () => {
  const p = parseTaskInput("Report !! tomorrow 2pm due friday 23h59");
  assert.equal(p.title, "Report");
  assert.equal(p.priority, "Medium");
  assert.equal(p.schedule, `${tomorrow}T14:00`);
  assert.equal(p.deadline, `${nextFri}T23:59`);
});

test("marker alone still yields a deadline", () => {
  const p = parseTaskInput("Essay ate sexta");
  assert.equal(p.title, "Essay");
  assert.equal(p.deadline, nextFri);
  assert.equal(p.schedule, undefined);
});

test("date before a bare marker stays a deadline", () => {
  assert.equal(parseTaskInput("Essay friday due").deadline, nextFri);
});

test("no marker means schedule only", () => {
  const p = parseTaskInput("Standup today 9am");
  assert.equal(p.schedule, `${today}T09:00`);
  assert.equal(p.deadline, undefined);
});

test("weekly recurrence anchors on its weekday", () => {
  const p = parseTaskInput("Standup 9am weekly fri");
  assert.equal(p.title, "Standup");
  assert.deepEqual(p.recur, { mode: "schedule", every: 1, unit: "week", weekdays: [5] });
  assert.equal(p.schedule, `${nextFri}T09:00`);
});

const yr = moment().year();

test("numeric dates on both sides of the marker", () => {
  const p = parseTaskInput("Communicative assignment 1 - historical narration !! 29/08 due 12/09");
  assert.equal(p.title, "Communicative assignment 1 - historical narration");
  assert.equal(p.priority, "Medium");
  assert.equal(p.schedule, `${yr}-08-29`);
  assert.equal(p.deadline, `${yr}-09-12`);
});

test("month words, either order, with or without a year", () => {
  assert.equal(parseTaskInput("Essay due Aug 29").deadline, `${yr}-08-29`);
  assert.equal(parseTaskInput("Essay due 29 ago").deadline, `${yr}-08-29`);
  assert.equal(parseTaskInput("Essay due 29 agosto 2027").deadline, "2027-08-29");
  assert.equal(parseTaskInput("Essay due Aug 29").title, "Essay");
});

test("explicit year forms", () => {
  assert.equal(parseTaskInput("Ship by 2027-03-04").deadline, "2027-03-04");
  assert.equal(parseTaskInput("Ship by 4/3/27").deadline, "2027-03-04");
});

test("dates keep their time", () => {
  assert.equal(parseTaskInput("Call 12/09 14:30").schedule, `${yr}-09-12T14:30`);
});

test("an impossible date is left in the title", () => {
  const p = parseTaskInput("Fix 31/02 thing");
  assert.equal(p.schedule, undefined);
  assert.equal(p.title, "Fix 31/02 thing");
});

test("plain numbers are not dates", () => {
  const p = parseTaskInput("Read chapter 12 of the book");
  assert.equal(p.title, "Read chapter 12 of the book");
  assert.equal(p.schedule, undefined);
});
