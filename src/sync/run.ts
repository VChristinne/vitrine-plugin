import { Notice, TFile } from "obsidian";
import { askSteamCreds } from "../modals/steam-creds";
import { linkedService, mergeManual, saveCache } from "./achievements";
import { fetchSteam } from "./steam";
import type VitrinePlugin from "../main";

async function ensureSteamKey(plugin: VitrinePlugin): Promise<boolean> {
  if (plugin.steamKey) return true;
  const creds = await askSteamCreds(plugin.app, { key: plugin.steamKey, steamId: plugin.steamId });
  if (!creds) return false;
  plugin.steamKey = creds.key;
  plugin.steamId = creds.steamId;
  return true;
}

export async function syncGame(plugin: VitrinePlugin, file: TFile, silent = false): Promise<boolean> {
  const link = linkedService(plugin.app, file);
  if (!link) return note(silent, "No steam:/psn: link on this note."), false;
  if (link.service === "psn") return note(silent, "PlayStation sync isn't available yet."), false;
  if (!(await ensureSteamKey(plugin))) return false;
  try {
    const fresh = await fetchSteam(plugin.steamKey, link.id, plugin.steamId || undefined);
    const merged = mergeManual(fresh, plugin.achievements[link.id]);
    plugin.achievements[link.id] = merged;
    await saveCache(plugin, plugin.achievements);
    plugin.refreshViews();
    note(silent, `${fresh.title ?? "Game"}: ${merged.unlocked}/${fresh.total} synced.`);
    return true;
  } catch (e) {
    note(silent, `Sync failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

export async function syncAll(plugin: VitrinePlugin): Promise<void> {
  const files = plugin.app.vault
    .getMarkdownFiles()
    .filter((f) => linkedService(plugin.app, f)?.service === "steam");
  if (!files.length) return void new Notice("No Steam-linked games found.");
  if (!(await ensureSteamKey(plugin))) return;
  new Notice(`Syncing ${files.length} games…`);
  let ok = 0;
  for (const f of files) if (await syncGame(plugin, f, true)) ok++;
  new Notice(`Synced ${ok}/${files.length} games.`);
}

function note(silent: boolean, msg: string) {
  if (!silent) new Notice(msg);
}
