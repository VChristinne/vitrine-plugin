import { Notice, TFile } from "obsidian";
import type VitrinePlugin from "../main";

export async function openFile(plugin: VitrinePlugin, f: TFile, subpath?: string): Promise<void> {
  const { app } = plugin;
  if (f.extension !== "md") {
    await app.workspace.getLeaf("tab").openFile(f);
    return;
  }
  await plugin.openObject(f.path, subpath);
}

export async function newNote(plugin: VitrinePlugin): Promise<void> {
  const { app } = plugin;
  try {
    const base = "Untitled";
    let path = `${base}.md`;
    let n = 1;
    while (app.vault.getAbstractFileByPath(path)) path = `${base} ${n++}.md`;
    const file = await app.vault.create(path, "");
    await openFile(plugin, file);
  } catch {
    new Notice("Could not create the note.");
  }
}
