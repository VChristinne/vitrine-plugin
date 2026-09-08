import { App, normalizePath } from "obsidian";

export function slug(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "-");
}

export function nameFitsFile(name: string): boolean {
  return safeName(name) === name;
}

export function join(folder: string, name: string): string {
  return normalizePath(folder ? `${folder}/${name}` : name);
}

export async function ensureFolder(app: App, path: string) {
  const clean = normalizePath(path);
  if (!clean || app.vault.getAbstractFileByPath(clean)) return;
  try {
    await app.vault.createFolder(clean);
  } catch {
  }
}

export async function freePath(app: App, folder: string, base: string, ext: string): Promise<string> {
  let name = `${base}.${ext}`;
  let n = 1;
  while (app.vault.getAbstractFileByPath(join(folder, name))) {
    name = `${base}-${n++}.${ext}`;
  }
  return join(folder, name);
}
