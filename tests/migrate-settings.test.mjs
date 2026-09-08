// Tests migrateSettings: a save written by an older version loads without missing
// keys, and the config of retired features stops round-tripping through data.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = join(mkdtempSync(join(tmpdir(), "vtr-")), "settings.mjs");
const res = await build({ entryPoints: ["src/settings.ts"], bundle: true, format: "esm", write: false });
writeFileSync(out, res.outputFiles[0].text);
const { migrateSettings } = await import(pathToFileURL(out).href);

test("the config of a retired feature is dropped", () => {
  const s = migrateSettings({
    dashboard: { bannerCover: "/Users/someone/wallpaper.png" },
    browse: { lens: "tags" },
    timeline: {}, dossier: {}, insights: {}, planning: {}, folders: {}, stats: {},
    pageCounts: { "Some/Report.pdf": 21 },
    openDashboardOnStartup: false,
    korean: {}, pdf: {}, reminders: {}, wikipedia: {},
  });
  for (const k of ["dashboard", "browse", "timeline", "dossier", "insights", "planning", "folders",
                   "stats", "pageCounts", "openDashboardOnStartup", "korean", "pdf", "reminders", "wikipedia"]) {
    assert.ok(!(k in s), `${k} survived the migration`);
  }
});

test("a live setting is kept and the missing ones are backfilled", () => {
  const s = migrateSettings({ coverProperty: "banner", fontScale: 1.2 });
  assert.equal(s.coverProperty, "banner");
  assert.equal(s.fontScale, 1.2);
  assert.equal(s.editorMode, "read");
  assert.deepEqual(s.taskNotify, { enabled: true, inApp: true, system: true, lead: 10 });
});

test("an empty save comes back as the defaults", () => {
  assert.equal(migrateSettings(null).tabStyle, "native");
});
