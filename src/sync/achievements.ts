import { App, TFile, normalizePath } from "obsidian";
import { asText } from "../model/fields";
import { LAUNCHERS } from "./services";
import type { Service } from "./services";
import type VitrinePlugin from "../main";

export interface Achievement {
  name: string;
  desc?: string;
  icon?: string;
  unlocked: boolean;
  unlockedAt?: number;
  rarity?: number;
  tier?: "bronze" | "silver" | "gold" | "platinum";
  manual?: boolean;
}

export interface GameAchievements {
  appId: string;
  title?: string;
  total: number;
  unlocked: number;
  achievements: Achievement[];
  syncedAt?: number;
}

export type AchievementCache = Record<string, GameAchievements>;

export interface ServiceLink {
  service: Service;
  id: string;
}

export function linkedService(app: App, file: TFile): ServiceLink | undefined {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!fm) return undefined;
  for (const l of LAUNCHERS) {
    const value = asText(fm[l.idProperty]);
    if (value && (!l.idPattern || l.idPattern.test(value))) {
      return { service: l.service, id: value };
    }
  }
  return undefined;
}

export function summarise(game: GameAchievements): { pct: number } {
  return { pct: game.total ? Math.round((game.unlocked / game.total) * 100) : 0 };
}

export function mergeManual(fresh: GameAchievements, existing?: GameAchievements): GameAchievements {
  if (!existing) return fresh;
  const manual = new Map(existing.achievements.filter((a) => a.manual).map((a) => [a.name, a]));
  for (const ach of fresh.achievements) {
    const m = manual.get(ach.name);
    if (m) {
      ach.unlocked = m.unlocked;
      ach.unlockedAt = m.unlockedAt;
      ach.manual = true;
    }
  }
  fresh.unlocked = fresh.achievements.filter((a) => a.unlocked).length;
  return fresh;
}

function cachePath(plugin: VitrinePlugin): string {
  return normalizePath(`${plugin.manifest.dir}/achievements.json`);
}

export async function loadCache(plugin: VitrinePlugin): Promise<AchievementCache> {
  try {
    const raw = await plugin.app.vault.adapter.read(cachePath(plugin));
    return JSON.parse(raw) as AchievementCache;
  } catch {
    return {};
  }
}

export async function saveCache(plugin: VitrinePlugin, cache: AchievementCache): Promise<void> {
  await plugin.app.vault.adapter.write(cachePath(plugin), JSON.stringify(cache, null, 2));
}
