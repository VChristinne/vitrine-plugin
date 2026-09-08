import { DEFAULT_SETTINGS } from "./types";
import type { VitrineSettings } from "./types";

export function migrateSettings(raw: unknown): VitrineSettings {
  const settings = Object.assign({}, DEFAULT_SETTINGS, raw) as VitrineSettings;

  settings.sidebarCollapsed ??= false;
  settings.fontScale ??= 1;
  settings.reduceGlow ??= false;
  settings.editorMode ??= "read";
  settings.editorOutline ??= true;
  settings.hideEmptyProps ??= true;
  for (const q of settings.queries ?? []) delete (q as { color?: string }).color;
  settings.tabStyle ??= settings.hideTabs ? "hidden" : "native";
  settings.tabLayout ??= "start";
  if ((settings.tabLayout as string) === "fill") settings.tabLayout = "center";
  settings.tabTickSide ??= "right";
  settings.taskNotify ??= { ...(settings as { reminders?: { notify?: typeof DEFAULT_SETTINGS.taskNotify } }).reminders?.notify ?? DEFAULT_SETTINGS.taskNotify };
  delete (settings as { reminders?: unknown }).reminders;
  delete (settings as { wikipedia?: unknown }).wikipedia;
  for (const k of ["korean", "pdf", "export", "sidebarHub", "libraries", "displayFont", "bodyFont", "accent", "accentColor"]) delete (settings as unknown as Record<string, unknown>)[k];

  for (const q of settings.queries ?? []) {
    const sort = q.sort as unknown;
    if (sort && !Array.isArray(sort)) q.sort = [sort as { field: string; dir: "asc" | "desc" }];
  }

  return settings;
}
