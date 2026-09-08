import { Events, Notice, Plugin, TFile, debounce } from "obsidian";
import { newNote, openFile } from "./model/open-note";
import { objectTypes } from "./objects/model";
import { applyTabBar } from "./render/tab-bar";
import { DEFAULT_SETTINGS } from "./types";
import { migrateSettings } from "./settings";
import type { VitrineSettings } from "./types";
import { ObjectsView, VIEW_OBJECTS } from "./views/objects";
import { ObjectPageView, VIEW_OBJECT_PAGE } from "./views/object-page";
import { TaskSuggest } from "./editor/task-suggest";
import { createTask, importCheckboxes, importAllCheckboxes, parseTaskInput, scanTaskAlerts, promoteScheduledTasks } from "./objects/task-create";
import { promptText } from "./modals/prompt";
import { VitrineSettingTab } from "./settings-tab";
import { loadCache } from "./sync/achievements";
import type { AchievementCache } from "./sync/achievements";
import { syncAll } from "./sync/run";

export default class VitrinePlugin extends Plugin {
  settings: VitrineSettings = DEFAULT_SETTINGS;
  achievements: AchievementCache = {};
  steamKey = "";
  steamId = "";
  openHistory: string[] = [];
  private events = new Events();
  private notified = new Set<string>();

  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_OBJECTS, (leaf) => new ObjectsView(leaf, this));
    this.registerView(VIEW_OBJECT_PAGE, (leaf) => new ObjectPageView(leaf, this));

    this.addSettingTab(new VitrineSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(async () => {
      this.achievements = await loadCache(this);
      this.events.trigger("index-changed");
    });

    this.app.workspace.onLayoutReady(() => {
      this.app.workspace.detachLeavesOfType("vitrine-item");
      const hubs = this.app.workspace.getLeavesOfType(VIEW_OBJECTS);
      for (let i = 1; i < hubs.length; i++) hubs[i].detach();
    });

    this.addRibbonIcon("box", "Open Vitrine objects", () => void this.openObjects());

    this.addCommand({
      id: "open-objects",
      name: "Open Vitrine objects",
      callback: () => void this.openObjects(),
    });

    this.addCommand({
      id: "new-note",
      name: "New note",
      callback: () => void this.newNote(),
    });

    this.addCommand({
      id: "sync-achievements",
      name: "Sync achievements (all games)",
      callback: () => void syncAll(this),
    });

    this.registerEditorSuggest(new TaskSuggest(this));

    this.addCommand({
      id: "new-task",
      name: "New task",
      callback: async () => {
        const text = await promptText(this.app, "New task", "Prepare report !! tomorrow 2pm");
        if (!text) return;
        const task = await createTask(this, parseTaskInput(text));
        await this.openObject(task.path);
      },
    });

    this.addCommand({
      id: "import-checkboxes",
      name: "Import checkboxes as tasks",
      editorCallback: async (_editor, view) => {
        const file = view.file;
        if (!file) return;
        const n = await importCheckboxes(this, file);
        if (n) new Notice(`Imported ${n} task${n === 1 ? "" : "s"}.`);
      },
    });

    this.addCommand({
      id: "import-all-checkboxes",
      name: "Import all checkboxes in vault",
      callback: async () => {
        const n = await importAllCheckboxes(this);
        if (n) new Notice(`Imported ${n} task${n === 1 ? "" : "s"}.`);
      },
    });

    this.addCommand({
      id: "open-settings",
      name: "Open Vitrine settings",
      hotkeys: [{ modifiers: ["Mod", "Alt"], key: "," }],
      callback: () => this.openSettings(),
    });

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.syncTabBar()),
    );
    this.app.workspace.onLayoutReady(() => this.syncTabBar());

    const notify = debounce(() => this.events.trigger("index-changed"), 400, true);
    this.registerEvent(this.app.metadataCache.on("changed", notify));
    this.registerEvent(this.app.vault.on("rename", notify));
    this.registerEvent(this.app.vault.on("delete", notify));

    this.app.workspace.onLayoutReady(() => {
      const n = this.settings.taskNotify;
      if (n.enabled && n.system && "Notification" in window && Notification.permission === "default") {
        void Notification.requestPermission();
      }
      void promoteScheduledTasks(this);
      this.checkTaskAlerts();
      this.registerInterval(window.setInterval(() => {
        void promoteScheduledTasks(this);
        this.checkTaskAlerts();
      }, 60000));
    });
  }

  onunload() {
    document.body.removeClass("vtr-hide-tabs");
    document.body.removeClass("vtr-objects-active");
  }

  syncTabBar() {
    const view = this.app.workspace.getActiveViewOfType(ObjectsView)
      ?? this.app.workspace.getActiveViewOfType(ObjectPageView);
    applyTabBar(this.settings, Boolean(view));
    document.body.toggleClass(
      "vtr-objects-active",
      Boolean(
        this.app.workspace.getActiveViewOfType(ObjectsView) ||
        this.app.workspace.getActiveViewOfType(ObjectPageView),
      ),
    );
  }

  private checkTaskAlerts() {
    const n = this.settings.taskNotify;
    if (!n.enabled || (!n.inApp && !n.system)) return;
    const now = Date.now();
    for (const it of scanTaskAlerts(this)) {
      const due = it.when.getTime();
      const fireAt = due - n.lead * 60000;
      if (now < fireAt || now > due + 60000) continue;
      if (this.notified.has(it.key)) continue;
      this.notified.add(it.key);
      this.notifyTask(it.title, it.when);
    }
  }

  private notifyTask(title: string, date: Date) {
    const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(date);
    const n = this.settings.taskNotify;
    if (n.inApp) new Notice(`🔔 ${title} · ${time}`);
    if (n.system && "Notification" in window && Notification.permission === "granted") {
      new Notification("Vitrine", { body: `${title} · ${time}` });
    }
  }

  openSettings() {
    const setting = (this.app as unknown as {
      setting: { open(): void; openTabById(id: string): void };
    }).setting;
    setting.open();
    setting.openTabById(this.manifest.id);
  }

  onIndexChanged(callback: () => void) {
    return this.events.on("index-changed", callback);
  }

  refreshViews() {
    this.events.trigger("index-changed");
  }

  async loadSettings() {
    this.settings = migrateSettings(await this.loadData());
  }

  async saveSettings() {
    await this.saveQuiet();
    this.syncTabBar();
    this.events.trigger("index-changed");
  }

  async saveQuiet() {
    for (const t of this.settings.objectTypes ?? []) t.collections?.sort((a, b) => a.name.localeCompare(b.name));
    await this.saveData(this.settings);
  }

  private async openVitrine(type: string, state?: Record<string, unknown>) {
    const recent = this.app.workspace.getMostRecentLeaf();
    const recentType = (recent?.view as { getViewType?: () => string } | undefined)?.getViewType?.();
    const leaf =
      this.app.workspace.getLeavesOfType(type)[0] ??
      (recent && recentType?.startsWith("vitrine-") ? recent : null) ??
      this.app.workspace.getLeavesOfType("empty")[0] ??
      this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type, active: true, state });
    this.app.workspace.revealLeaf(leaf);
    this.syncTabBar();
    return leaf;
  }

  async openObjects(typeId?: string) {
    await this.openVitrine(VIEW_OBJECTS, typeId ? { screen: "collection", typeId } : undefined);
  }

  async openQuery(id: string) {
    const q = (this.settings.queries ?? []).find((x) => x.id === id);
    if (!q) return;
    const typeId = q.typeIds[0] ?? objectTypes(this)[0]?.id;
    if (!typeId) return;
    await this.openVitrine(VIEW_OBJECTS, { screen: "collection", typeId, collTab: `q:${id}` });
  }

  noteOpened(path: string) {
    this.openHistory = [path, ...this.openHistory.filter((p) => p !== path)].slice(0, 30);
  }

  async openObject(notePath: string, subpath?: string) {
    this.noteOpened(notePath);
    const existing = this.app.workspace.getLeavesOfType(VIEW_OBJECTS)[0];
    if (existing && existing.view instanceof ObjectsView) {
      existing.view.openTab(notePath, subpath);
      this.app.workspace.revealLeaf(existing);
      return;
    }
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({ type: VIEW_OBJECTS, active: true, state: { screen: "object", objPath: notePath, objSubpath: subpath, tabs: [notePath] } });
    this.app.workspace.revealLeaf(leaf);
    this.syncTabBar();
  }

  openFile(f: TFile, subpath?: string) {
    return openFile(this, f, subpath);
  }

  newNote() {
    return newNote(this);
  }
}
