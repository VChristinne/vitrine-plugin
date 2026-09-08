// Tests act(): which date field a completed occurrence advances. task-recur.ts
// pulls only `moment` from obsidian, so the stub re-exports the real moment.
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
    build.onResolve({ filter: /^obsidian$/ }, (a) => ({ path: a.path, namespace: "stub" }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: 'export { default as moment } from "moment"; export const App = {}; export const TFile = {};',
      resolveDir: process.cwd(),
    }));
  },
};

const out = (await build({
  entryPoints: ["src/objects/task-recur.ts"],
  bundle: true,
  format: "esm",
  write: false,
  plugins: [stub],
})).outputFiles[0].text;
const file = join(mkdtempSync(join(tmpdir(), "vtr-")), "task-recur.mjs");
writeFileSync(file, out);
const { completeOccurrence } = await import(pathToFileURL(file).href);

// Fake App: processFrontMatter just hands the callback the object under test.
const complete = async (fm) => {
  await completeOccurrence({ fileManager: { processFrontMatter: (_f, cb) => cb(fm) } }, {});
  return fm;
};
const weekly = { mode: "schedule", every: 1, unit: "week" };

test("a scheduled task advances the schedule and drags the deadline along", async () => {
  const fm = await complete({ recur: weekly, schedule: "2026-08-24", deadline: "2026-08-26" });
  assert.equal(fm.schedule, "2026-08-31");
  assert.equal(fm.deadline, "2026-09-02");
  assert.equal(fm.status, "Not started");
});

test("a deadline-only task advances the deadline, keeping its time suffix", async () => {
  const fm = await complete({ recur: weekly, deadline: "2026-08-24T09:00" });
  assert.equal(fm.deadline, "2026-08-31T09:00");
  assert.equal(fm.schedule, undefined);
});

test("a dateless task gets a schedule so it can advance next time", async () => {
  const fm = await complete({ recur: weekly });
  assert.match(fm.schedule, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(fm.occurrences.length, 1);
  // Completing again anchors on that seeded plan and moves past it.
  const seeded = fm.schedule;
  const again = await complete(fm);
  assert.equal(again.occurrences[1].date, seeded);
  assert.notEqual(again.schedule, seeded);
});

test("`count` ends the rule instead of advancing", async () => {
  const fm = await complete({ recur: { ...weekly, count: 1 }, schedule: "2026-08-24" });
  assert.equal(fm.status, "Done");
  assert.equal(fm.schedule, "2026-08-24");
});
