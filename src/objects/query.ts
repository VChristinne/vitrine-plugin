import { getAllTags, TFile } from "obsidian";
import { objectTypes, objectsOfType, inCollection, title, derivedValue } from "./model";
import { cleanValue } from "./value";
import { isRecurring } from "./task-recur";
import { PRIORITY_ORDER, STATUS_BOARD_ORDER } from "./task-create";
import type VitrinePlugin from "../main";

export type QueryOp = "is" | "not" | "contains" | "gt" | "lt" | "empty" | "notempty";

export const QUERY_OPS: { op: QueryOp; label: string }[] = [
  { op: "is", label: "is" },
  { op: "not", label: "is not" },
  { op: "contains", label: "contains" },
  { op: "gt", label: ">" },
  { op: "lt", label: "<" },
  { op: "empty", label: "is empty" },
  { op: "notempty", label: "is not empty" },
];

export interface QueryFilter {
  key: string;
  op: QueryOp;
  value?: string;
}

export interface SortRule {
  field: string;
  dir: "asc" | "desc";
}

export interface QuerySpec {
  id: string;
  name: string;
  icon: string;
  typeIds: string[];
  collection?: string;
  filters: QueryFilter[];
  sort?: SortRule[];
  groupBy?: string;
  limit?: number;
}

export function fieldValue(plugin: VitrinePlugin, f: TFile, key: string): string | number {
  const app = plugin.app;
  if (key === "title") return title(app, f).toLowerCase();
  if (key === "__created") return f.stat.ctime;
  if (key === "__updated") return f.stat.mtime;
  if (key === "__tags") return (getAllTags(app.metadataCache.getFileCache(f) ?? {}) ?? []).join(",").toLowerCase();
  if (key === "__recurring") return isRecurring(app.metadataCache.getFileCache(f)?.frontmatter ?? {}) ? "yes" : "no";
  const v = app.metadataCache.getFileCache(f)?.frontmatter?.[key];
  if (v === undefined) {
    const d = derivedValue(plugin, f, key);
    if (d !== null) return d;
  }
  return typeof v === "number" ? v : cleanValue(v).toLowerCase();
}

export function sortValue(plugin: VitrinePlugin, f: TFile, key: string): string | number {
  const order: readonly string[] | null =
    key === "status" ? STATUS_BOARD_ORDER : key === "priority" ? PRIORITY_ORDER : null;
  if (!order) return fieldValue(plugin, f, key);
  const i = order.findIndex((v) => v.toLowerCase() === String(fieldValue(plugin, f, key)));
  return i < 0 ? order.length : i;
}

export function filterValues(flt: QueryFilter): string[] {
  return (flt.value ?? "").split("\n").filter((v) => v !== "");
}

function fieldParts(plugin: VitrinePlugin, f: TFile, key: string): string[] {
  const app = plugin.app;
  if (key === "__tags") return (getAllTags(app.metadataCache.getFileCache(f) ?? {}) ?? []).map((t) => t.toLowerCase());
  const v = app.metadataCache.getFileCache(f)?.frontmatter?.[key];
  if (Array.isArray(v)) return v.map((x) => cleanValue(x).toLowerCase());
  return [String(fieldValue(plugin, f, key))];
}

function compare(a: string | number, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) && b.trim() !== "" ? na - nb : String(a).localeCompare(b);
}

export function matches(plugin: VitrinePlugin, f: TFile, flt: QueryFilter): boolean {
  const v = fieldValue(plugin, f, flt.key);
  const s = String(v);
  const vals = filterValues(flt).map((x) => x.toLowerCase());
  const parts = fieldParts(plugin, f, flt.key);
  const any = (fn: (val: string) => boolean) => (vals.length ? vals.some(fn) : fn(""));
  const hit = (cmp: (part: string, val: string) => boolean) => parts.some((p) => any((val) => cmp(p, val)));
  switch (flt.op) {
    case "is": return hit((p, val) => p === val);
    case "not": return !hit((p, val) => p === val);
    case "contains": return hit((p, val) => p.includes(val));
    case "gt": return vals.length ? compare(v, vals[0]) > 0 : false;
    case "lt": return vals.length ? compare(v, vals[0]) < 0 : false;
    case "empty": return s === "";
    case "notempty": return s !== "";
  }
}

export function describeQuery(q: QuerySpec, typeNames: string[]): string {
  const parts: string[] = [];
  const scope = [typeNames.join(", ") || "All types", q.collection].filter(Boolean).join(" / ");
  parts.push(scope);
  const rules = q.filters.map((f) => {
    const label = QUERY_OPS.find((o) => o.op === f.op)?.label ?? f.op;
    const vals = filterValues(f).join(" or ");
    return [f.key, label, vals].filter(Boolean).join(" ");
  });
  if (rules.length) parts.push(rules.join(", "));
  const sort = (q.sort ?? []).map((s) => `${s.field} ${s.dir === "desc" ? "\u2193" : "\u2191"}`);
  if (sort.length) parts.push(`by ${sort.join(", ")}`);
  if (q.groupBy) parts.push(`grouped by ${q.groupBy}`);
  if (q.limit) parts.push(`top ${q.limit}`);
  return parts.join(" \u00b7 ");
}

export function queriesFor(all: QuerySpec[], typeId: string, collection?: string): QuerySpec[] {
  return all
    .filter((q) => !q.typeIds.length || q.typeIds.includes(typeId))
    .filter((q) => !q.collection || q.collection === collection)
    .sort((a, b) => Number(!!a.collection) - Number(!!b.collection));
}

export function scopeTo(spec: QuerySpec, collection?: string): QuerySpec {
  return collection && !spec.collection ? { ...spec, collection } : spec;
}

export function evalQuery(plugin: VitrinePlugin, spec: QuerySpec): TFile[] {
  const types = objectTypes(plugin);
  const wanted = spec.typeIds.length ? types.filter((t) => spec.typeIds.includes(t.id)) : types;

  const seen = new Set<string>();
  let files: TFile[] = [];
  for (const t of wanted) {
    for (const f of objectsOfType(plugin, t)) {
      if (seen.has(f.path)) continue;
      seen.add(f.path);
      files.push(f);
    }
  }

  if (spec.collection) {
    const coll = { id: "", name: spec.collection, members: [] as string[] };
    files = files.filter((f) => inCollection(plugin.app, coll, f));
  }

  for (const flt of spec.filters) files = files.filter((f) => matches(plugin, f, flt));

  const rules = spec.sort?.length ? spec.sort : spec.groupBy ? [{ field: spec.groupBy, dir: "asc" as const }] : [];
  if (rules.length) {
    files.sort((a, b) => {
      for (const { field, dir } of rules) {
        const va = sortValue(plugin, a, field);
        const vb = sortValue(plugin, b, field);
        const c = va < vb ? -1 : va > vb ? 1 : 0;
        if (c) return dir === "desc" ? -c : c;
      }
      return 0;
    });
  }

  return spec.limit && spec.limit > 0 ? files.slice(0, spec.limit) : files;
}
