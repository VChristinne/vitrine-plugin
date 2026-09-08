import { App, Notice, PluginSettingTab, Setting, debounce, moment } from "obsidian";
import type { ObjectsSurface, VitrineSettings } from "./types";
import type VitrinePlugin from "./main";

function filePath(f: File): string | undefined {
  const legacy = (f as File & { path?: string }).path;
  if (legacy) return legacy;
  try {
    const wu = (require("electron") as { webUtils?: { getPathForFile(file: File): string } }).webUtils;
    return wu?.getPathForFile(f) || undefined;
  } catch {
    return undefined;
  }
}

export class VitrineSettingTab extends PluginSettingTab {
  private activeTab = "Appearance";
  private subTab = "";

  constructor(app: App, private plugin: VitrinePlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("vtr-settings");

    const cats: Array<{ id: string; render: (el: HTMLElement) => void }> = [
      { id: "Appearance", render: (el) => this.renderAppearanceSection(el) },
      { id: "Notifications", render: (el) => this.renderNotificationsSection(el) },
    ];
    if (!cats.some((c) => c.id === this.activeTab)) this.activeTab = cats[0].id;

    const bar = containerEl.createDiv({ cls: "vtr-settings-tabs" });
    const content = containerEl.createDiv({ cls: "vtr-settings-content" });

    for (const cat of cats) {
      const btn = bar.createEl("button", { cls: "vtr-settings-tab", text: cat.id });
      if (cat.id === this.activeTab) btn.addClass("is-active");
      btn.onclick = () => {
        this.activeTab = cat.id;
        this.display();
      };
    }

    cats.find((c) => c.id === this.activeTab)!.render(content);
    this.applySubNav(content);
  }

  private applySubNav(content: HTMLElement) {
    const kids = Array.from(content.children) as HTMLElement[];
    const groups: Array<{ name: string; els: HTMLElement[] }> = [];
    for (const el of kids) {
      if (el.hasClass("setting-item-heading")) {
        groups.push({ name: el.querySelector<HTMLElement>(".setting-item-name")?.textContent?.trim() ?? "", els: [el] });
      } else if (groups.length) {
        groups[groups.length - 1].els.push(el);
      }
    }
    for (const g of groups.filter((g) => g.els.length <= 1)) g.els.forEach((el) => el.remove());
    const real = groups.filter((g) => g.els.length > 1);
    if (real.length < 2) return;
    if (!real.some((g) => g.name === this.subTab)) this.subTab = real[0].name;

    for (const g of real) {
      const heading = g.els[0];
      const ctrl = heading.querySelector<HTMLElement>(".setting-item-control");
      if (ctrl?.childElementCount) {
        heading.querySelector(".setting-item-info")?.remove();
        heading.addClass("vtr-heading-bare");
      } else {
        heading.remove();
        g.els.shift();
      }
    }

    const nav = content.createDiv({ cls: "vtr-settings-subtabs" });
    content.prepend(nav);
    for (const g of real) {
      const active = g.name === this.subTab;
      const btn = nav.createEl("button", { cls: `vtr-settings-subtab${active ? " is-active" : ""}`, text: g.name });
      btn.onclick = () => {
        this.subTab = g.name;
        this.display();
      };
      for (const el of g.els) el.toggle(active);
    }
  }

  private renderNotificationsSection(containerEl: HTMLElement) {
    const n = this.plugin.settings.taskNotify;

    new Setting(containerEl)
      .setName("Task notifications")
      .setDesc("Alerts tasks whose schedule or deadline has a time, as they approach. All-day tasks aren't notified.")
      .setHeading();

    new Setting(containerEl)
      .setName("Enable")
      .addToggle((t) =>
        t.setValue(n.enabled).onChange(async (v) => {
          n.enabled = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("In-app notice")
      .setDesc("Show an Obsidian notice.")
      .addToggle((t) =>
        t.setValue(n.inApp).onChange(async (v) => {
          n.inApp = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("System notification")
      .setDesc("Show a desktop notification (asks permission once).")
      .addToggle((t) =>
        t.setValue(n.system).onChange(async (v) => {
          n.system = v;
          if (v && "Notification" in window && Notification.permission === "default") {
            await Notification.requestPermission();
          }
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Lead time")
      .setDesc("Minutes before the due time to alert (0 = at the time).")
      .addSlider((s) =>
        s.setLimits(0, 60, 5).setValue(n.lead).setDynamicTooltip().onChange(async (v) => {
          n.lead = v;
          await this.plugin.saveSettings();
        }),
      );
  }

  private renderAppearanceSection(containerEl: HTMLElement) {
    const s = this.plugin.settings;
    new Setting(containerEl).setName("Theme").setHeading();

    new Setting(containerEl)
      .setName("Palette")
      .setDesc("Slate on dark themes, light on light themes.")
      .addDropdown((d) =>
        d
          .addOptions({ theme: "Follow the theme", slate: "Always slate", light: "Always light" })
          .setValue(s.palette)
          .onChange(async (v) => {
            s.palette = v as "theme" | "slate" | "light";
            await this.plugin.saveSettings();
          }),
      );

    const surfaces = { obsidian: "Obsidian", neu: "Neumorphism", tokyo: "Tokyo Night", latte: "Catppuccin Latte" };
    const surfaceRow = (name: string, desc: string, key: "objectsSurface" | "objectsSurfaceDark") =>
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addDropdown((d) =>
          d
            .addOptions(surfaces)
            .setValue(s[key] ?? s.objectsSurface ?? "obsidian")
            .onChange(async (v) => {
              s[key] = v as ObjectsSurface;
              await this.plugin.saveSettings();
            }),
        );
    surfaceRow("Surface (light)", "How the Objects hub is painted while Obsidian is in light mode.", "objectsSurface");
    surfaceRow("Surface (dark)", "How the Objects hub is painted while Obsidian is in dark mode.", "objectsSurfaceDark");

    new Setting(containerEl)
      .setName("Reduce glow")
      .setDesc("Accessibility — turns off the accent bloom. The HUD and shapes stay.")
      .addToggle((t) =>
        t.setValue(s.reduceGlow).onChange(async (v) => {
          s.reduceGlow = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName("Typography").setHeading();

    new Setting(containerEl)
      .setName("Text size")
      .setDesc("Scale every text size across Vitrine (layout spacing stays the same).")
      .addDropdown((d) =>
        d
          .addOptions({ "0.9": "90%", "1": "100% (default)", "1.1": "110%", "1.25": "125%", "1.5": "150%" })
          .setValue(String(s.fontScale))
          .onChange(async (v) => {
            s.fontScale = Number(v) || 1;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName("Interface").setHeading();

    new Setting(containerEl)
      .setName("Tab bar")
      .setDesc("How Obsidian's tab bar looks while a Vitrine view is in front.")
      .addDropdown((d) =>
        d
          .addOptions({
            native: "Native (Obsidian)",
            hidden: "Hidden",
            chamfer: "Chamfered tabs",
            underline: "Underline",
            bracket: "Corner brackets",
            rail: "Segmented rail",
            notch: "Notched tabs",
            tick: "Accent tick",
          })
          .setValue(s.tabStyle)
          .onChange(async (v) => {
            s.tabStyle = v as VitrineSettings["tabStyle"];
            await this.plugin.saveSettings();
            this.plugin.syncTabBar();
          }),
      );

    new Setting(containerEl)
      .setName("Tab layout")
      .setDesc("Tabs against the edge, or floating as a centred group that grows outward (Safari compact).")
      .addDropdown((d) =>
        d
          .addOptions({ start: "Edge", center: "Centered (floating)" })
          .setValue(s.tabLayout)
          .onChange(async (v) => {
            s.tabLayout = v as VitrineSettings["tabLayout"];
            await this.plugin.saveSettings();
            this.plugin.syncTabBar();
          }),
      );

    new Setting(containerEl)
      .setName("Tick side")
      .setDesc("For the Accent tick tab style: which border the tick sits on (right avoids the close button).")
      .addDropdown((d) =>
        d
          .addOptions({ left: "Left", right: "Right" })
          .setValue(s.tabTickSide)
          .onChange(async (v) => {
            s.tabTickSide = v as VitrineSettings["tabTickSide"];
            await this.plugin.saveSettings();
            this.plugin.syncTabBar();
          }),
      );

    new Setting(containerEl)
      .setName("Collapse the sidebar")
      .setDesc("Keeps the hub sidebar collapsed to icons — persists across reloads.")
      .addToggle((t) =>
        t.setValue(s.sidebarCollapsed).onChange(async (v) => {
          s.sidebarCollapsed = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Editor mode")
      .setDesc("Which mode a note opens in by default (Source, Read or Split).")
      .addDropdown((d) =>
        d
          .addOptions({ source: "Source", read: "Read", split: "Split" })
          .setValue(s.editorMode)
          .onChange(async (v) => {
            s.editorMode = v as "source" | "read" | "split";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Heading rail")
      .setDesc("Show a tick rail of the note's headings in the preview (hover the right edge to reveal, click to jump).")
      .addToggle((t) =>
        t.setValue(s.editorOutline).onChange(async (v) => {
          s.editorOutline = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Fold empty properties")
      .setDesc("Properties with no value collapse into a \"N hidden\" row on the object page — click it to reveal them.")
      .addToggle((t) =>
        t.setValue(s.hideEmptyProps).onChange(async (v) => {
          s.hideEmptyProps = v;
          await this.plugin.saveSettings();
        }),
      );
  }
}
