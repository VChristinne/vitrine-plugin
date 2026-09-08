import { requestUrl } from "obsidian";
import type { Achievement, GameAchievements } from "./achievements";

const API = "https://api.steampowered.com/ISteamUserStats";

interface SchemaAch {
  name: string;
  displayName: string;
  description?: string;
  icon: string;
  icongray: string;
}

export async function fetchSteam(key: string, appId: string, steamId?: string): Promise<GameAchievements> {
  const schema = await getSchema(key, appId);
  if (!schema.list.length) throw new Error("This game has no Steam achievements.");
  const rarity = await getGlobal(appId);
  const owned = steamId ? await getPlayer(key, appId, steamId) : undefined;

  const achievements: Achievement[] = schema.list.map((a) => {
    const unlockedAt = owned?.get(a.name);
    const unlocked = unlockedAt !== undefined;
    return {
      name: a.displayName || a.name,
      desc: a.description,
      icon: unlocked ? a.icon : a.icongray,
      unlocked,
      unlockedAt: unlockedAt ? unlockedAt * 1000 : undefined,
      rarity: rarity.get(a.name),
    };
  });

  return {
    appId,
    title: schema.title,
    total: achievements.length,
    unlocked: achievements.filter((a) => a.unlocked).length,
    achievements,
    syncedAt: Date.now(),
  };
}

async function getSchema(key: string, appId: string): Promise<{ title?: string; list: SchemaAch[] }> {
  const url = `${API}/GetSchemaForGame/v2/?key=${key}&appid=${appId}`;
  const res = await requestUrl({ url, throw: false });
  if (res.status === 403) throw new Error("Steam key rejected (403). Check the key.");
  if (res.status !== 200) throw new Error(`Steam schema failed (HTTP ${res.status}).`);
  const game = res.json?.game;
  return {
    title: game?.gameName,
    list: (game?.availableGameStats?.achievements ?? []) as SchemaAch[],
  };
}

async function getGlobal(appId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const url = `${API}/GetGlobalAchievementPercentagesForApp/v0002/?gameid=${appId}`;
    const res = await requestUrl({ url, throw: false });
    const list = res.json?.achievementpercentages?.achievements as Array<{ name: string; percent: number }> | undefined;
    for (const a of list ?? []) out.set(a.name, Math.round(Number(a.percent)));
  } catch {
  }
  return out;
}

async function getPlayer(key: string, appId: string, steamId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const url = `${API}/GetPlayerAchievements/v0001/?appid=${appId}&key=${key}&steamid=${steamId}`;
    const res = await requestUrl({ url, throw: false });
    const stats = res.json?.playerstats;
    if (!stats?.success) return out;
    for (const a of (stats.achievements ?? []) as Array<{ apiname: string; achieved: number; unlocktime: number }>) {
      if (a.achieved) out.set(a.apiname, a.unlocktime);
    }
  } catch {
  }
  return out;
}
