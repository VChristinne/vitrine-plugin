// Tests mergeManual: hand-set unlocks must survive a Steam re-sync.
// achievements.ts imports Obsidian only for other helpers, so we stub those
// modules to empty while bundling — mergeManual itself is pure.
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
    build.onResolve({ filter: /^(obsidian|\.\.\/main|\.\.\/model\/fields|\.\/services)$/ }, (a) => ({
      path: a.path,
      namespace: "stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: "export const asText = () => undefined; export const App = {}; export const TFile = {}; export const normalizePath = (p) => p; export const LAUNCHERS = [];",
    }));
  },
};

const out = await build({
  entryPoints: ["src/sync/achievements.ts"],
  bundle: true,
  format: "esm",
  write: false,
  plugins: [stub],
});
const dir = mkdtempSync(join(tmpdir(), "vitrine-"));
const file = join(dir, "achievements.mjs");
writeFileSync(file, out.outputFiles[0].text);
const { mergeManual } = await import(pathToFileURL(file));

const game = (achs) => ({ appId: "1", total: achs.length, unlocked: achs.filter((a) => a.unlocked).length, achievements: achs });

test("manual unlock survives a re-sync that reports it locked", () => {
  const existing = game([
    { name: "A", unlocked: true, unlockedAt: 111, manual: true },
    { name: "B", unlocked: true, unlockedAt: 222 },
  ]);
  const fresh = game([
    { name: "A", unlocked: false },
    { name: "B", unlocked: true, unlockedAt: 999 },
  ]);
  const merged = mergeManual(fresh, existing);
  assert.equal(merged.achievements[0].unlocked, true);
  assert.equal(merged.achievements[0].unlockedAt, 111);
  assert.equal(merged.achievements[1].unlockedAt, 999); // non-manual takes Steam's word
  assert.equal(merged.unlocked, 2);
});

test("manual lock survives a re-sync that reports it unlocked", () => {
  const existing = game([{ name: "A", unlocked: false, manual: true }]);
  const fresh = game([{ name: "A", unlocked: true, unlockedAt: 5 }]);
  const merged = mergeManual(fresh, existing);
  assert.equal(merged.achievements[0].unlocked, false);
  assert.equal(merged.unlocked, 0);
});

test("no existing cache returns fresh untouched", () => {
  const fresh = game([{ name: "A", unlocked: true }]);
  assert.equal(mergeManual(fresh, undefined), fresh);
});
