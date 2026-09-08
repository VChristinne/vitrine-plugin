import { App, TFile } from "obsidian";
import { keepShape } from "./fields";

export async function setField(
  app: App,
  file: TFile,
  key: string,
  value: string | number | undefined,
) {
  await app.fileManager.processFrontMatter(file, (fm) => {
    const next = keepShape(fm[key], value);
    if (next === undefined) delete fm[key];
    else fm[key] = next;
  });
}

export async function setCollection(app: App, file: TFile, name: string, add: boolean) {
  await app.fileManager.processFrontMatter(file, (fm) => {
    const cur: unknown[] = Array.isArray(fm.collection) ? fm.collection : fm.collection ? [fm.collection] : [];
    const has = cur.some((v) => String(v).trim().toLowerCase() === name.toLowerCase());
    const next = add
      ? has ? cur : [...cur, name]
      : cur.filter((v) => String(v).trim().toLowerCase() !== name.toLowerCase());
    if (!next.length) delete fm.collection;
    else fm.collection = next.length === 1 ? next[0] : next;
  });
}

export async function addTag(app: App, file: TFile, tag: string) {
  const clean = tag.replace(/^#/, "").trim();
  if (!clean) return;
  await app.fileManager.processFrontMatter(file, (fm) => {
    const tags: string[] = Array.isArray(fm.tags) ? fm.tags : fm.tags ? [fm.tags] : [];
    if (!tags.some((t) => String(t) === clean)) tags.push(clean);
    fm.tags = tags;
  });
}

export async function removeTag(app: App, file: TFile, tag: string) {
  const clean = tag.replace(/^#/, "");
  await app.fileManager.processFrontMatter(file, (fm) => {
    if (fm.tags === undefined) return;
    const tags: unknown[] = Array.isArray(fm.tags) ? fm.tags : [fm.tags];
    const next = tags.filter((t) => String(t).replace(/^#/, "") !== clean);
    if (next.length) fm.tags = next;
    else delete fm.tags;
  });
}
