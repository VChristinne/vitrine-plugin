import { App, TFile, getAllTags } from "obsidian";
import { setField } from "../model/frontmatter";

export type AdoptBy = "folder" | "tag" | "prop";

export interface Candidate {
  value: string;
  count: number;
}

const SKIP_PROPS = new Set(["object", "type", "collection", "position", "tags", "aliases", "title", "cssclasses"]);

export function groupsOf(app: App, f: TFile, by: AdoptBy): string[] {
  if (by === "folder") {
    const parent = f.parent?.path ?? "";
    if (!parent || parent === "/") return [];
    const parts = parent.split("/");
    return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
  }
  const cache = app.metadataCache.getFileCache(f);
  if (by === "tag") return (cache ? getAllTags(cache) ?? [] : []).map((t) => t.replace(/^#/, ""));
  return Object.keys(cache?.frontmatter ?? {}).filter((k) => !SKIP_PROPS.has(k.toLowerCase()));
}

export function candidates(app: App, by: AdoptBy, isTyped: (f: TFile) => boolean): Candidate[] {
  const counts = new Map<string, number>();
  for (const f of app.vault.getMarkdownFiles()) {
    if (isTyped(f)) continue;
    for (const g of groupsOf(app, f, by)) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .filter((c) => c.count > 1)
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export interface Match {
  file: TFile;
  taken: boolean;
}

export function matches(app: App, by: AdoptBy, value: string, typeOfNote: (f: TFile) => string): Match[] {
  const want = by === "tag" ? value.replace(/^#/, "").toLowerCase() : value;
  const out: Match[] = [];
  for (const f of app.vault.getMarkdownFiles()) {
    const groups = groupsOf(app, f, by);
    const hit = by === "tag" ? groups.some((g) => g.toLowerCase() === want) : groups.includes(want);
    if (hit) out.push({ file: f, taken: !!typeOfNote(f) });
  }
  return out.sort((a, b) => a.file.path.localeCompare(b.file.path));
}

export async function adopt(app: App, files: TFile[], name: string): Promise<number> {
  let n = 0;
  for (const f of files) {
    await setField(app, f, "object", name);
    n++;
  }
  return n;
}

export async function release(app: App, paths: string[]): Promise<void> {
  for (const p of paths) {
    const f = app.vault.getAbstractFileByPath(p);
    if (f instanceof TFile) await setField(app, f, "object", undefined);
  }
}
