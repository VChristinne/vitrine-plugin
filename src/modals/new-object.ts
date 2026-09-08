import { Modal, Notice, TFile, moment } from "obsidian";
import { ensureFolder, freePath, join, nameFitsFile, safeName } from "../paths";
import { splitFrontmatter, templateFields } from "../model/fields";
import type { ObjectType, PropDef } from "../objects/model";
import type { ObjectCollection } from "../types";
import { applyModalTheme } from "../render/theme";
import type VitrinePlugin from "../main";

export class NewObjectModal extends Modal {
  private values = new Map<string, string>();

  constructor(
    private plugin: VitrinePlugin,
    private type: ObjectType,
    private template?: TFile | null,
    private collection?: ObjectCollection,
  ) {
    super(plugin.app);
  }

  private schema(): PropDef[] {
    return this.collection?.props?.length ? this.collection.props : this.type.props;
  }

  private templateFile(): TFile | null {
    if (this.template !== undefined) return this.template;
    const collPath = this.collection?.templates?.[0];
    const f = collPath ? this.app.vault.getAbstractFileByPath(collPath) : null;
    return f instanceof TFile ? f : null;
  }

  private auto(key: string): string {
    const k = key.toLowerCase();
    if (k === "status") return "draft";
    if (k.includes("date") || k.includes("updated") || k === "when") return moment().format("YYYY-MM-DD");
    return "";
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    applyModalTheme(modalEl, this.plugin.settings);
    contentEl.createDiv({ cls: "vtr-modal-head" }).createDiv({
      cls: "vtr-modal-head-title",
      text: this.collection ? `New in ${this.collection.name}` : `New ${this.type.name}`,
    });

    const grid = contentEl.createDiv({ cls: "vtr-modal-fields" });
    const field = (key: string, label: string, value: string, wide = false) => {
      const wrap = grid.createDiv({ cls: `vtr-modal-field${wide ? " is-wide" : ""}` });
      const lab = wrap.createEl("label", { cls: "vtr-modal-label" });
      lab.setText(label);
      if (value) lab.createSpan({ cls: "vtr-modal-auto", text: "auto" });
      const box = wrap.createDiv({ cls: "vtr-modal-input" });
      const input = box.createEl("input", { cls: "vtr-modal-input-el", type: "text" });
      input.value = value;
      this.values.set(key, value);
      input.addEventListener("input", () => this.values.set(key, input.value));
      return input;
    };

    const titleInput = field("__title", "Title", "", true);
    for (const p of this.schema()) field(p.key, p.key, this.auto(p.key), p.kind === "links" || p.kind === "list");

    const foot = contentEl.createDiv({ cls: "vtr-modal-foot" });
    const btn = (label: string, cls: string, onClick: () => void) => {
      const b = foot.createDiv({ cls: `vtr-modal-btn ${cls}` });
      b.createSpan({ text: label });
      b.addEventListener("click", onClick);
    };
    btn("Cancel", "", () => this.close());
    btn("Create", "is-primary", () => void this.create());
    setTimeout(() => titleInput.focus(), 0);
  }

  private async create() {
    const title = (this.values.get("__title") ?? "").trim();
    if (!title) {
      new Notice("A title is required.");
      return;
    }
    const tmpl = this.templateFile();
    const raw = tmpl instanceof TFile ? await this.app.vault.cachedRead(tmpl) : "";
    const tpl = splitFrontmatter(raw);

    const yaml = (raw: string) => (/^[\w .\-/]+$/.test(raw) ? raw : JSON.stringify(raw));
    const lines = ["---"];
    lines.push(`object: ${yaml(this.type.id)}`);
    if (this.collection) lines.push(`collection: ${yaml(this.collection.name)}`);
    if (!nameFitsFile(title)) lines.push(`title: ${yaml(title)}`);
    for (const p of this.schema()) {
      const v = (this.values.get(p.key) ?? "").trim();
      if (v) lines.push(`${p.key}: ${yaml(v)}`);
    }
    if (!this.schema().some((p) => p.key.toLowerCase() === "status")) {
      const ts = tpl.fm.match(/^status:\s*(.*)$/m)?.[1].trim();
      if (ts) lines.push(`status: ${yaml(ts === "template" ? this.auto("status") : ts)}`);
    }
    const written = new Set(["object", "collection", "title", "status", ...this.schema().map((p) => p.key.toLowerCase())]);
    lines.push(...templateFields(tpl.fm, written), "---", "");

    try {
      const stripped = tpl.body.replace(/^\n+/, "");
      const body = stripped ? "\n" + stripped : "";
      const home = (t: TFile | null | undefined) => {
        const st = t ? this.app.metadataCache.getFileCache(t)?.frontmatter?.status : undefined;
        return t && String(st ?? "").toLowerCase() !== "template" ? t.parent?.path : undefined;
      };
      const base = this.type.newNoteFolder ?? home(tmpl instanceof TFile ? tmpl : null) ?? home(this.type.template) ?? "";
      const parent = this.collection ? join(base === "/" ? "" : base, safeName(this.collection.name)) : base;
      const folder = parent && parent !== "/" ? parent : "";
      if (folder) await ensureFolder(this.app, folder);
      const path = await freePath(this.app, folder, safeName(title), "md");
      const file = await this.app.vault.create(path, lines.join("\n") + body);
      this.close();
      this.plugin.refreshViews();
      if (file instanceof TFile) await this.plugin.openObject(file.path);
    } catch (error) {
      new Notice(`Could not create the note: ${String(error)}`);
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
