import { App, TFile, getAllTags } from "obsidian";
import type { ObjectCollection, ObjectPropConfig, ObjectPropKind, ObjectTypeConfig } from "../types";
import { freePath, join, safeName } from "../paths";
import { cleanValue } from "./value";
import type VitrinePlugin from "../main";

export type PropKind = ObjectPropKind;
export type PropDef = ObjectPropConfig;

export type PageLayout = "page" | "indexcard" | "profile" | "encyclopedia";

export interface ObjectType {
  id: string;
  name: string;
  namePlural?: string;
  tag: string;
  icon: string;
  hue: string;
  group?: string;
  template: TFile | null;
  newNoteFolder?: string;
  props: PropDef[];
  dropped: string[];
  builtin?: boolean;
  layout: PageLayout;
  wide: boolean;
  cover: "crop" | "full";
  coverMode: "small" | "wide";
  cardProps: string[];
  linkView: "link" | "inline" | "small" | "wide" | "embed";
  calCreate: "show" | "hide";
  calHidden: boolean;
}

export function pluralName(t: { name: string; namePlural?: string }): string {
  if (t.namePlural) return t.namePlural;
  return /s$/i.test(t.name) ? t.name : `${t.name}s`;
}

const RESERVED = new Set(["tags", "aliases", "position", "title", "object", "type", "collection"]);
export const TYPE_HUES = ["#0f7f96", "#c94f77", "#3a63c2", "#2f8f5b", "#6d47c2", "#977c1b", "#4a53c4", "#c26a2c"];
const HUES = TYPE_HUES;
export const PROP_KINDS: PropKind[] = ["text", "number", "date", "check", "link", "links", "list", "select", "formula"];

export function evalFormula(expr: string, fm: Record<string, unknown>): string | number {
  try {
    const v = new Function("p", `with (p) { return (${expr}); }`)(fm);
    if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : "";
    return v === null || v === undefined || typeof v === "object" ? "" : String(v);
  } catch {
    return "";
  }
}

export function derivedValue(plugin: VitrinePlugin, f: TFile, key: string): string | number | null {
  const type = typeOf(plugin, f, objectTypes(plugin));
  const def = type ? effectiveProps(plugin, type, f).find((p) => p.key === key) : null;
  if (def?.kind !== "formula") return null;
  return evalFormula(def.expr ?? "", plugin.app.metadataCache.getFileCache(f)?.frontmatter ?? {});
}

export function hueFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}

export { cleanValue };

function isTemplate(app: App, f: TFile): boolean {
  if (!declaredType(app, f)) return false;
  return cleanValue(app.metadataCache.getFileCache(f)?.frontmatter?.status).toLowerCase() === "template";
}

export function templateNotes(app: App): TFile[] {
  return app.vault.getMarkdownFiles().filter((f) => isTemplate(app, f)).sort((a, b) => a.basename.localeCompare(b.basename));
}

function typeTag(app: App, tmpl: TFile): string | null {
  const cache = app.metadataCache.getFileCache(tmpl);
  const tags = cache ? getAllTags(cache) ?? [] : [];
  return tags.map((t) => t.replace(/^#/, "").trim()).find(Boolean) ?? null;
}

function isLink(v: unknown): boolean {
  return typeof v === "string" && /^\[\[.*\]\]$/.test(v.trim());
}

export function isStructured(v: unknown): boolean {
  if (v === null || typeof v !== "object") return false;
  return !Array.isArray(v) || v.some((x) => x !== null && typeof x === "object");
}

function inferKind(v: unknown): PropKind | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "boolean") return "check";
  if (typeof v === "number") return "number";
  if (Array.isArray(v)) return v.length && v.every(isLink) ? "links" : "list";
  if (isLink(v)) return "link";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v.trim())) return "date";
  return "text";
}

function propsFor(app: App, tmpl: TFile, objects: TFile[]): PropDef[] {
  const tfm = app.metadataCache.getFileCache(tmpl)?.frontmatter ?? {};
  const keys = Object.keys(tfm).filter((k) => !RESERVED.has(k) && !isStructured(tfm[k]));
  return keys.map((key) => {
    let kind = inferKind(tfm[key]);
    for (const o of objects) {
      if (kind) break;
      kind = inferKind(app.metadataCache.getFileCache(o)?.frontmatter?.[key]);
    }
    return { key, kind: kind ?? "text" };
  });
}

function pagesConfig(): ObjectTypeConfig {
  return { id: "__pages", name: "Page", namePlural: "Pages", tag: "", icon: "file-text", color: "#6b7585", props: [], builtin: true };
}

function taskConfig(): ObjectTypeConfig {
  return {
    id: "__task",
    name: "Task",
    namePlural: "Tasks",
    tag: "task",
    icon: "check-square",
    color: "#c26a2c",
    newNoteFolder: "Tasks",
    props: [
      { key: "status", kind: "text" },
      { key: "priority", kind: "text" },
      { key: "deadline", kind: "date" },
      { key: "schedule", kind: "date" },
      { key: "context", kind: "links" },
    ],
    builtin: true,
  };
}

function weblinkConfig(): ObjectTypeConfig {
  return {
    id: "__weblink",
    name: "Weblink",
    namePlural: "Weblinks",
    tag: "weblink",
    icon: "globe",
    color: "#3a63c2",
    newNoteFolder: "Weblinks",
    props: [
      { key: "url", kind: "text" },
      { key: "site", kind: "text" },
      { key: "description", kind: "text" },
      { key: "image", kind: "text" },
    ],
    builtin: true,
  };
}

const BUILTINS: Array<[string, () => ObjectTypeConfig]> = [
  ["__pages", pagesConfig],
  ["__task", taskConfig],
  ["__weblink", weblinkConfig],
];

function seedFromTemplates(plugin: VitrinePlugin): ObjectTypeConfig[] {
  const { app } = plugin;
  const configs: ObjectTypeConfig[] = [];
  for (const tmpl of templateNotes(app)) {
    const tag = typeTag(app, tmpl);
    if (!tag || configs.some((c) => c.tag === tag)) continue;
    const name = tmpl.basename;
    configs.push({
      id: tag,
      name,
      tag,
      icon: "box",
      color: hueFor(tag),
      templates: [tmpl.path],
      props: propsFor(app, tmpl, objectsForTag(app, tag)),
    });
  }
  configs.sort((a, b) => a.name.localeCompare(b.name));
  for (const [, make] of BUILTINS) configs.push(make());
  return configs;
}

export function typeConfigs(plugin: VitrinePlugin): ObjectTypeConfig[] {
  if (!plugin.settings.objectTypes) {
    plugin.settings.objectTypes = seedFromTemplates(plugin);
    void plugin.saveSettings();
  }
  const cfgs = plugin.settings.objectTypes;
  let changed = false;
  for (const [id, make] of BUILTINS) {
    const existing = cfgs.find((c) => c.id === id);
    if (!existing) {
      cfgs.push(make());
      changed = true;
      continue;
    }
    const code = make();
    if (code.newNoteFolder && existing.newNoteFolder === undefined) {
      existing.newNoteFolder = code.newNoteFolder;
      changed = true;
    }
    const def = code.props;
    const RENAME: Record<string, string> = { done: "status", scheduled: "schedule" };
    const byKey = new Map(def.map((p) => [p.key, p]));
    let next = existing.props.map((p) => byKey.get(RENAME[p.key] ?? p.key) ?? p);
    next = next.filter((p, i) => next.findIndex((q) => q.key === p.key) === i);
    const dropped = new Set(existing.dropped ?? []);
    next = next.filter((p) => !dropped.has(p.key));
    for (const p of def) if (!next.some((q) => q.key === p.key) && !dropped.has(p.key)) next.push(p);
    if (JSON.stringify(existing.props) !== JSON.stringify(next)) {
      existing.props = next;
      changed = true;
    }
  }
  if (changed) void plugin.saveSettings();
  return cfgs;
}

export function templatePaths(c: ObjectTypeConfig): string[] {
  return c.templates ?? (c.templatePath ? [c.templatePath] : []);
}

function hydrate(plugin: VitrinePlugin, c: ObjectTypeConfig): ObjectType {
  const first = templatePaths(c)[0];
  const t = first ? plugin.app.vault.getAbstractFileByPath(first) : null;
  return {
    id: c.id,
    name: c.name,
    namePlural: c.namePlural,
    tag: c.tag,
    icon: c.icon,
    hue: c.color,
    group: c.group,
    template: t instanceof TFile ? t : null,
    newNoteFolder: c.newNoteFolder,
    props: c.props,
    dropped: c.dropped ?? [],
    builtin: c.builtin,
    layout: c.layout ?? "page",
    wide: c.wide ?? false,
    cover: c.cover ?? "crop",
    coverMode: c.coverMode ?? "small",
    cardProps: c.cardProps ?? [],
    linkView: c.linkView ?? "link",
    calCreate: c.calCreate ?? "hide",
    calHidden: c.calHidden ?? false,
  };
}

export function youtubeId(url: string): string {
  return url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/)?.[1] ?? "";
}

export const COVER_KEYS = ["image", "cover", "thumbnail", "banner", "og:image"];

export function coverKey(fm: Record<string, unknown>): string {
  return COVER_KEYS.find((k) => typeof fm[k] === "string" && (fm[k] as string).trim()) ?? "";
}

export function coverImage(fm: Record<string, unknown>, link?: unknown): string {
  const k = coverKey(fm);
  if (k) return (fm[k] as string).trim();
  const yt = youtubeId(String(link ?? ""));
  return yt ? `https://img.youtube.com/vi/${yt}/hqdefault.jpg` : "";
}

export function objectTypes(plugin: VitrinePlugin): ObjectType[] {
  return typeConfigs(plugin).map((c) => hydrate(plugin, c));
}

export function objectDate(fm: Record<string, unknown>): string {
  for (const k of ["scheduled", "deadline", "date", "due", "when", "start"]) {
    const v = fm[k];
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v.trim())) return v.trim().slice(0, 10);
  }
  return "";
}

export function allObjects(plugin: VitrinePlugin): TFile[] {
  const seen = new Set<string>();
  const out: TFile[] = [];
  for (const t of objectTypes(plugin)) {
    for (const f of objectsOfType(plugin, t)) {
      if (seen.has(f.path)) continue;
      seen.add(f.path);
      out.push(f);
    }
  }
  return out;
}

function objectsForTag(app: App, tag: string): TFile[] {
  const want = `#${tag}`.toLowerCase();
  return app.vault.getMarkdownFiles().filter((f) => {
    if (isTemplate(app, f)) return false;
    const cache = app.metadataCache.getFileCache(f);
    const tags = cache ? getAllTags(cache) ?? [] : [];
    return tags.some((t) => t.toLowerCase() === want);
  });
}

export function declaredType(app: App, f: TFile): string {
  const fm = app.metadataCache.getFileCache(f)?.frontmatter;
  const v = fm?.object ?? fm?.type;
  return v ? String(v).trim().toLowerCase() : "";
}

function fileTags(app: App, f: TFile): string[] {
  const cache = app.metadataCache.getFileCache(f);
  return cache ? (getAllTags(cache) ?? []).map((t) => t.replace(/^#/, "").toLowerCase()) : [];
}

function isClipped(app: App, f: TFile): boolean {
  const src = app.metadataCache.getFileCache(f)?.frontmatter?.source;
  return typeof src === "string" && /^https?:\/\//i.test(src.trim());
}

function fileIsType(app: App, f: TFile, type: { id: string; name: string; tag: string }): boolean {
  const declared = declaredType(app, f);
  if (declared) return declared === type.name.toLowerCase();
  return type.tag === "weblink" && isClipped(app, f);
}

function objectsForType(plugin: VitrinePlugin, type: ObjectType): TFile[] {
  const { app } = plugin;
  return app.vault.getMarkdownFiles().filter((f) => !isTemplate(app, f) && fileIsType(app, f, type));
}

function pagesFiles(plugin: VitrinePlugin): TFile[] {
  const { app } = plugin;
  const others = objectTypes(plugin).filter((t) => t.id !== "__pages");
  return app.vault.getMarkdownFiles().filter((f) => {
    if (isTemplate(app, f)) return false;
    if (fileTags(app, f).some((t) => t.startsWith("gallery/"))) return false;
    return !others.some((t) => fileIsType(app, f, t));
  });
}

export function templatesForType(plugin: VitrinePlugin, type: ObjectType): TFile[] {
  const { app } = plugin;
  const cfg = typeConfigs(plugin).find((c) => c.id === type.id);
  const attached = (cfg ? templatePaths(cfg) : [])
    .map((p) => app.vault.getAbstractFileByPath(p))
    .filter((f): f is TFile => f instanceof TFile);
  const others = objectTypes(plugin).filter((t) => t.id !== type.id);
  const declared = templateNotes(app).filter((f) =>
    type.id === "__pages" ? !others.some((t) => fileIsType(app, f, t)) : fileIsType(app, f, type),
  );
  const seen = new Set<string>();
  return [...attached, ...declared].filter((f) => {
    if (seen.has(f.path)) return false;
    seen.add(f.path);
    return true;
  });
}

export function objectsOfType(plugin: VitrinePlugin, type: ObjectType): TFile[] {
  const files = type.id === "__pages" ? pagesFiles(plugin) : objectsForType(plugin, type);
  return files.sort((a, b) => title(plugin.app, a).localeCompare(title(plugin.app, b)));
}

export function title(app: App, f: TFile): string {
  const t = app.metadataCache.getFileCache(f)?.frontmatter?.title;
  return t ? String(t) : f.basename;
}

export async function renameObject(app: App, f: TFile, name: string): Promise<boolean> {
  const clean = name.trim();
  if (!clean || clean === title(app, f)) return false;
  if (app.metadataCache.getFileCache(f)?.frontmatter?.title !== undefined) {
    await app.fileManager.processFrontMatter(f, (fm) => { fm.title = clean; });
  }
  const dir = f.parent && f.parent.path !== "/" ? f.parent.path : "";
  const wanted = join(dir, `${safeName(clean)}.${f.extension}`);
  if (wanted !== f.path) {
    const target = app.vault.getAbstractFileByPath(wanted) ? await freePath(app, dir, safeName(clean), f.extension) : wanted;
    await app.fileManager.renameFile(f, target);
  }
  return true;
}

export function notePropDefs(plugin: VitrinePlugin, file: TFile): PropDef[] {
  const fm = plugin.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
  return Object.keys(fm)
    .filter((k) => !RESERVED.has(k) && !isStructured(fm[k]))
    .map((key) => ({ key, kind: inferKind(fm[key]) ?? "text" }));
}

export function previewText(raw: string): string {
  const body = raw.replace(/^---\n[\s\S]*?\n---\n*/, "");
  const out: string[] = [];
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) continue;
    if (/^#{1,6}\s/.test(t)) continue;
    if (/^[-*+]\s+\[[ xX]\]/.test(t)) continue;
    if (/^>\s*\[![^\]]*\]/.test(t)) continue;
    const s = t
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
      .replace(/^>\s?/, "")
      .replace(/^[-*+]\s+/, "")
      .replace(/^\d+\.\s+/, "")
      .replace(/[#*_`~]/g, "")
      .trim();
    if (s) out.push(s);
    if (out.join(" ").length > 240) break;
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

export function collectionsOf(cfg: ObjectTypeConfig | undefined): ObjectCollection[] {
  return [...(cfg?.collections ?? [])].sort((a, b) => a.name.localeCompare(b.name));
}

export function inCollection(app: App, coll: ObjectCollection, f: TFile): boolean {
  const cv = app.metadataCache.getFileCache(f)?.frontmatter?.collection;
  if (cv != null && cv !== "") {
    const want = coll.name.toLowerCase();
    if ((Array.isArray(cv) ? cv : [cv]).some((v) => String(v).trim().toLowerCase() === want)) return true;
  }
  return coll.members.includes(f.path);
}

export function collectionOf(plugin: VitrinePlugin, type: { id: string }, f: TFile): ObjectCollection | null {
  const cfg = typeConfigs(plugin).find((c) => c.id === type.id);
  return collectionsOf(cfg).find((c) => inCollection(plugin.app, c, f)) ?? null;
}

export function effectiveProps(plugin: VitrinePlugin, type: ObjectType, f: TFile): PropDef[] {
  const coll = collectionOf(plugin, type, f);
  if (coll?.props?.length) return coll.props;
  return type.props;
}

function collByName(plugin: VitrinePlugin, type: ObjectType, collName?: string): ObjectCollection | undefined {
  const lc = collName?.toLowerCase();
  return lc ? collectionsOf(typeConfigs(plugin).find((c) => c.id === type.id)).find((c) => c.name.toLowerCase() === lc) : undefined;
}

export function scopeFiles(plugin: VitrinePlugin, type: ObjectType, collName?: string): TFile[] {
  const coll = collByName(plugin, type, collName);
  const files = type.id === "__pages" ? pagesFiles(plugin) : objectsForType(plugin, type);
  return coll ? files.filter((f) => inCollection(plugin.app, coll, f)) : files;
}

export function scopeProps(plugin: VitrinePlugin, type: ObjectType, collName?: string): PropDef[] {
  const coll = collByName(plugin, type, collName);
  const schema = coll?.props?.length ? coll.props : type.props;
  const hidden = new Set([...type.dropped, "description", plugin.settings.coverProperty, ...COVER_KEYS]);
  const extra = new Map<string, PropDef>();
  for (const f of scopeFiles(plugin, type, collName)) {
    for (const p of notePropDefs(plugin, f)) {
      if (extra.has(p.key) || hidden.has(p.key) || schema.some((x) => x.key === p.key)) continue;
      extra.set(p.key, p);
    }
  }
  return [...schema, ...[...extra.values()].sort((a, b) => a.key.localeCompare(b.key))];
}

export function resolveLink(app: App, value: unknown, from: string): TFile | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0];
  return app.metadataCache.getFirstLinkpathDest(name, from);
}

export function resolveLinks(app: App, value: unknown, from: string): TFile[] {
  const vals = Array.isArray(value) ? value : [value];
  return vals.map((v) => resolveLink(app, v, from)).filter((f): f is TFile => !!f);
}

export interface Backlink {
  file: TFile;
  count: number;
}

export function backlinksOf(plugin: VitrinePlugin, file: TFile): Backlink[] {
  const resolved = plugin.app.metadataCache.resolvedLinks ?? {};
  const out: Backlink[] = [];
  for (const [from, targets] of Object.entries(resolved)) {
    const count = (targets as Record<string, number>)[file.path];
    if (!count || from === file.path) continue;
    const src = plugin.app.vault.getAbstractFileByPath(from);
    if (src instanceof TFile) out.push({ file: src, count });
  }
  return out;
}

export function typeOf(plugin: VitrinePlugin, file: TFile, types: ObjectType[]): ObjectType | null {
  return types.find((t) => t.id !== "__pages" && fileIsType(plugin.app, file, t)) ?? null;
}

export function typeOrPage(plugin: VitrinePlugin, file: TFile, types: ObjectType[]): ObjectType | null {
  return typeOf(plugin, file, types) ?? types.find((t) => t.id === "__pages") ?? null;
}
