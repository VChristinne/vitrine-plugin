import { SuggestModal, setIcon, TFile } from "obsidian";
import { objectTypes, allObjects, typeOf, title, type ObjectType } from "../objects/model";
import type VitrinePlugin from "../main";

type PItem =
  | { kind: "action"; icon: string; hue?: string; label: string; run: () => void }
  | { kind: "object"; file: TFile; type: ObjectType | null };

export interface PaletteActions {
  open: (path: string) => void;
  openCalendar: () => void;
  create: (type: ObjectType) => void;
}

export class PaletteModal extends SuggestModal<PItem> {
  private types = objectTypes(this.plugin);
  private objs = allObjects(this.plugin);

  constructor(private plugin: VitrinePlugin, private actions: PaletteActions) {
    super(plugin.app);
    this.setPlaceholder("Search for content and actions…");
    this.modalEl.addClass("vtr-palette");
  }

  private actionItems(): PItem[] {
    const items: PItem[] = [
      { kind: "action", icon: "calendar", label: "Open calendar", run: () => this.actions.openCalendar() },
    ];
    for (const t of this.types) {
      items.push({ kind: "action", icon: t.icon, hue: t.hue, label: `Create ${t.name}`, run: () => this.actions.create(t) });
    }
    return items;
  }

  getSuggestions(query: string): PItem[] {
    const q = query.trim().toLowerCase();
    const objItems: PItem[] = this.objs.map((f) => ({ kind: "object", file: f, type: typeOf(this.plugin, f, this.types) }));
    if (!q) {
      const rank = new Map(this.plugin.openHistory.map((p, i) => [p, i]));
      const recent = objItems
        .filter((o) => o.kind === "object" && rank.has(o.file.path))
        .sort((a, b) => (rank.get((a as { file: TFile }).file.path) ?? 0) - (rank.get((b as { file: TFile }).file.path) ?? 0));
      return [...recent, ...this.actionItems()];
    }
    const objMatch = objItems.filter((o) => o.kind === "object" && title(this.app, o.file).toLowerCase().includes(q));
    const actMatch = this.actionItems().filter((a) => a.kind === "action" && a.label.toLowerCase().includes(q));
    return [...objMatch, ...actMatch];
  }

  renderSuggestion(item: PItem, el: HTMLElement) {
    el.addClass("vtr-palette-row");
    const ico = el.createSpan({ cls: "vtr-palette-ico" });
    if (item.kind === "object") {
      const t = item.type;
      if (t) ico.style.setProperty("--hue", t.hue);
      setIcon(ico, t ? t.icon : "file-text");
      el.createSpan({ cls: "vtr-palette-name", text: title(this.app, item.file) });
      if (t) {
        const pill = el.createDiv({ cls: "vtr-palette-pill" });
        pill.style.setProperty("--hue", t.hue);
        setIcon(pill.createSpan(), t.icon);
        pill.createSpan({ text: t.name });
      }
    } else {
      if (item.hue) ico.style.setProperty("--hue", item.hue);
      setIcon(ico, item.icon);
      el.createSpan({ cls: "vtr-palette-name", text: item.label });
    }
  }

  onChooseSuggestion(item: PItem) {
    if (item.kind === "object") this.actions.open(item.file.path);
    else item.run();
  }
}
