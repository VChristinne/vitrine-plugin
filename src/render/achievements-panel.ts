import { Menu, TFile, setIcon, setTooltip, moment } from "obsidian";
import { saveCache, linkedService, summarise } from "../sync/achievements";
import { syncGame } from "../sync/run";
import { askDate } from "../modals/date-picker";
import { launcherFor } from "../sync/services";
import type { Achievement, GameAchievements } from "../sync/achievements";
import type VitrinePlugin from "../main";

export function renderAchievements(
  plugin: VitrinePlugin,
  host: HTMLElement,
  note: TFile,
  rerender: () => void,
): boolean {
  const link = linkedService(plugin.app, note);
  if (!link) return false;

  const game = plugin.achievements[link.id];
  if (!game) {
    const box = host.createDiv({ cls: "vtr-empty-state" });
    setIcon(box.createDiv({ cls: "vtr-empty-icon" }), "trophy");
    box.createDiv({ cls: "vtr-empty-title", text: "No trophies cached" });
    box.createDiv({ text: `No cached ${launcherFor(link.service).label} achievements for this game.` });
    const btn = box.createDiv({ cls: "vtr-button", text: `Sync from ${launcherFor(link.service).label}` });
    btn.onclick = () => void syncGame(plugin, note);
    return true;
  }

  const pct = summarise(game).pct;

  const hero = host.createDiv({ cls: "vtr-ach-hero" });
  const figure = hero.createDiv({ cls: "vtr-ach-pct", text: `${pct}%` });
  figure.dataset.done = String(pct === 100);
  const meta = hero.createDiv({ cls: "vtr-ach-meta" });
  meta.createDiv({ cls: "vtr-ach-count", text: `${game.unlocked} / ${game.total} unlocked` });
  const bar = meta.createDiv({ cls: "vtr-progress" });
  bar.createDiv({ cls: "vtr-progress-bar" }).style.width = `${pct}%`;

  const grid = host.createDiv({ cls: "vtr-ach-grid" });
  for (const ach of game.achievements) {
    const cell = grid.createDiv({ cls: "vtr-ach-cell" });
    cell.toggleClass("is-locked", !ach.unlocked);
    const head = ach.tier ? `${ach.name} (${ach.tier})` : ach.name;
    setTooltip(cell, ach.desc ? `${head}\n${ach.desc}` : head, { delay: 0, classes: ["vtr-tip"] });
    if (ach.tier) cell.dataset.tier = ach.tier;
    if (ach.icon) {
      cell.createEl("img").src = ach.icon;
    } else {
      setIcon(cell, ach.unlocked ? "award" : "lock");
    }
    cell.oncontextmenu = (e) => {
      e.preventDefault();
      trophyMenu(plugin, e, game, ach, rerender);
    };
  }

  const recent = game.achievements
    .filter((a) => a.unlocked && a.unlockedAt !== undefined)
    .sort((a, b) => (b.unlockedAt ?? 0) - (a.unlockedAt ?? 0))
    .slice(0, 6);
  if (recent.length) {
    host.createDiv({ cls: "vtr-ach-label", text: "Recent unlocks" });
    const list = host.createDiv({ cls: "vtr-ach-list" });
    for (const ach of recent) list.appendChild(recentRow(ach));
  }

  const foot = host.createDiv({ cls: "vtr-ach-synced" });
  const resync = foot.createSpan({ cls: "vtr-ach-resync" });
  setIcon(resync, "refresh-cw");
  setTooltip(resync, `Sync from ${launcherFor(link.service).label}`, { classes: ["vtr-tip"] });
  resync.onclick = () => void syncGame(plugin, note);
  foot.createSpan({ text: game.syncedAt ? `synced ${moment(game.syncedAt).format("MMM D, YYYY")}` : "not synced" });
  return true;
}

function trophyMenu(plugin: VitrinePlugin, event: MouseEvent, game: GameAchievements, ach: Achievement, rerender: () => void) {
  const menu = new Menu();
  menu.addItem((i) => i.setTitle("Set as today").setIcon("check").onClick(() => void setDate(plugin, game, ach, Date.now(), rerender)));
  menu.addItem((i) =>
    i.setTitle("Set date…").setIcon("calendar").onClick(async () => {
      const ms = await askDate(plugin.app, ach.unlockedAt);
      if (ms !== null) await setDate(plugin, game, ach, ms, rerender);
    }),
  );
  menu.showAtMouseEvent(event);
}

async function setDate(plugin: VitrinePlugin, game: GameAchievements, ach: Achievement, ms: number, rerender: () => void) {
  ach.unlocked = true;
  ach.unlockedAt = ms;
  ach.manual = true;
  game.unlocked = game.achievements.filter((a) => a.unlocked).length;
  await saveCache(plugin, plugin.achievements);
  rerender();
}

function recentRow(ach: Achievement): HTMLElement {
  const row = createDiv({ cls: "vtr-ach-row" });
  const icon = row.createDiv({ cls: "vtr-ach-row-icon" });
  if (ach.tier) icon.dataset.tier = ach.tier;
  setIcon(icon, ach.tier === "platinum" ? "trophy" : "award");
  const body = row.createDiv({ cls: "vtr-ach-row-body" });
  body.createDiv({ cls: "vtr-ach-row-name", text: ach.name });
  if (ach.desc) body.createDiv({ cls: "vtr-ach-row-desc", text: ach.desc });
  const side = row.createDiv({ cls: "vtr-ach-row-side" });
  if (ach.tier) {
    const tier = side.createDiv({ cls: "vtr-ach-tier", text: ach.tier });
    tier.dataset.tier = ach.tier;
  }
  if (ach.rarity !== undefined) {
    const rare = ach.rarity <= 10;
    side.createDiv({ cls: rare ? "vtr-ach-rarity is-rare" : "vtr-ach-rarity", text: rare ? "rare" : "common" });
    side.createDiv({ cls: "vtr-ach-rarity-pct", text: `${ach.rarity}%` });
  }
  if (ach.unlockedAt) {
    row.createDiv({ cls: "vtr-ach-row-when", text: moment(ach.unlockedAt).format("MMM D, YYYY") });
  }
  return row;
}
