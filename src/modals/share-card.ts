import { Modal, Notice, TFile, setIcon } from "obsidian";
import { applyModalTheme } from "../render/theme";
import { resolveCover } from "../model/index-builder";
import {
  coverImage,
  effectiveProps,
  evalFormula,
  notePropDefs,
  objectTypes,
  resolveLink,
  title,
  typeOf,
  type PropDef,
} from "../objects/model";
import type VitrinePlugin from "../main";

type Electron = { remote?: { getCurrentWebContents?: () => any }; clipboard?: any; nativeImage?: any };
const req = (m: string): any => {
  try {
    return (window as unknown as { require?: (m: string) => any }).require?.(m);
  } catch {
    return undefined;
  }
};
const electron = (): Electron | undefined => req("electron");
const webContents = (): any => electron()?.remote?.getCurrentWebContents?.() ?? req("@electron/remote")?.getCurrentWebContents?.();

export interface ShareContext {
  pickMore?: () => void;
  heading?: string;
  ranked?: boolean;
  sortedBy?: string;
}

export class ShareCardModal extends Modal {
  private files: TFile[];
  private stack!: HTMLElement;
  private chips!: HTMLElement;
  private picked: string[] = [];
  private defs: PropDef[] = [];

  constructor(private plugin: VitrinePlugin, files: TFile[], private ctx: ShareContext = {}) {
    super(plugin.app);
    this.files = files.filter((f, i) => files.findIndex((x) => x.path === f.path) === i);
    this.readSchema();
  }

  private readSchema() {
    const { plugin } = this;
    const f = this.files[0];
    if (!f) return;
    const type = typeOf(plugin, f, objectTypes(plugin));
    const own = new Set(["description", plugin.settings.coverProperty]);
    const schema = type ? effectiveProps(plugin, type, f) : [];
    const extra = notePropDefs(plugin, f).filter((p) => !schema.some((x) => x.key === p.key));
    this.defs = [...schema, ...extra].filter((p) => !own.has(p.key));
    const saved = type ? plugin.settings.shareProps?.[type.id] : undefined;
    const fallback = (type?.cardProps ?? []).filter((k) => this.defs.some((d) => d.key === k));
    const keys = saved ?? (fallback.length ? fallback : this.defs.slice(0, 3).map((p) => p.key));
    this.picked = keys.filter((k) => this.defs.some((d) => d.key === k));
  }

  onOpen() {
    applyModalTheme(this.modalEl, this.plugin.settings);
    this.modalEl.addClass("vtr-share");
    this.titleEl.setText(this.files.length > 1 ? `Share ${this.files.length} cards` : "Share card");

    this.stack = this.contentEl.createDiv({ cls: "vtr-share-stack" });

    const pick = this.contentEl.createDiv({ cls: "vtr-share-pick" });
    pick.createDiv({ cls: "vtr-share-sub", text: "Properties" });
    this.chips = pick.createDiv({ cls: "vtr-share-chips" });

    if (this.ctx.pickMore) {
      const add = pick.createDiv({ cls: "vtr-share-add" });
      setIcon(add.createSpan(), "layers");
      add.createSpan({ text: "Pick more from the grid" });
      add.onclick = () => {
        this.close();
        this.ctx.pickMore?.();
      };
    }

    const bar = this.contentEl.createDiv({ cls: "vtr-share-bar" });
    const btn = (label: string, icon: string, cta: boolean, run: () => void) => {
      const b = bar.createEl("button", { cls: `vtr-share-btn${cta ? " mod-cta" : ""}` });
      setIcon(b.createSpan(), icon);
      b.createSpan({ text: label });
      b.onclick = run;
    };
    btn("Copy image", "copy", true, () => void this.copy());
    btn("Save PNG", "download", false, () => void this.save());

    this.draw();
  }

  private draw() {
    this.stack.empty();
    if (this.files.length === 1) this.drawCard(this.files[0]);
    else if (this.files.length) this.drawSheet();
    this.chips.empty();
    for (const d of this.defs) {
      const chip = this.chips.createSpan({ cls: "vtr-share-chip", text: d.key });
      chip.toggleClass("is-on", this.picked.includes(d.key));
      chip.onclick = () => {
        this.picked = this.picked.includes(d.key) ? this.picked.filter((k) => k !== d.key) : [...this.picked, d.key];
        this.draw();
        void this.remember();
      };
    }
  }

  private drawSheet() {
    const { app } = this.plugin;
    const sheet = this.stack.createDiv({ cls: "vtr-share-card vtr-share-sheet" });
    const head = sheet.createDiv({ cls: "vtr-share-shead" });
    head.createSpan({ cls: "vtr-share-sh-t", text: this.ctx.heading || "Vitrine" });
    head.createSpan({ cls: "vtr-share-sh-c", text: `${this.files.length} items` });

    const cols = this.picked.map((k) => this.defs.find((d) => d.key === k)).filter((d): d is PropDef => !!d);
    const sub = cols.find((d) => d.kind !== "number" && d.kind !== "formula") ?? null;
    const rest = cols.filter((d) => d !== sub);
    const rank = !!this.ctx.ranked;
    const grid = `${rank ? "24px " : ""}40px 1fr repeat(${rest.length}, minmax(54px, auto))`;

    const hr = sheet.createDiv({ cls: "vtr-share-srow is-head" });
    hr.style.gridTemplateColumns = grid;
    if (rank) hr.createSpan();
    hr.createSpan();
    hr.createSpan({ text: "Item" });
    for (const d of rest) hr.createSpan({ cls: "vtr-share-num", text: d.key });

    this.files.forEach((f, i) => {
      const fm = app.metadataCache.getFileCache(f)?.frontmatter ?? {};
      const row = sheet.createDiv({ cls: "vtr-share-srow" });
      row.style.gridTemplateColumns = grid;
      if (rank) row.createSpan({ cls: "vtr-share-rank", text: String(i + 1) });
      const art = row.createSpan({ cls: "vtr-share-art" });
      const cover = coverImage(fm, fm.url ?? fm.source) || resolveCover(app, fm[this.plugin.settings.coverProperty], f.path) || "";
      if (cover) {
        const im = art.createEl("img");
        im.src = cover;
        im.onerror = () => im.remove();
      }
      const name = row.createSpan({ cls: "vtr-share-name" });
      name.createSpan({ cls: "vtr-share-n", text: title(app, f) });
      if (sub) name.createSpan({ cls: "vtr-share-s", text: this.text(sub, fm) });
      for (const d of rest) row.createSpan({ cls: "vtr-share-num is-v", text: this.text(d, fm) });
      const x = row.createSpan({ cls: "vtr-share-rx", text: "×", attr: { "aria-label": "Remove from card" } });
      x.onclick = () => {
        this.files = this.files.filter((o) => o.path !== f.path);
        this.draw();
      };
    });

    const foot = sheet.createDiv({ cls: "vtr-share-sfoot" });
    foot.createSpan({ text: "Vitrine" });
    foot.createSpan({ text: this.ctx.ranked ? `by ${this.ctx.sortedBy ?? "rank"}` : "" });
  }

  private drawCard(f: TFile) {
    const { app } = this.plugin;
    const fm = app.metadataCache.getFileCache(f)?.frontmatter ?? {};
    const wrap = this.stack.createDiv({ cls: "vtr-share-slot" });
    const card = wrap.createDiv({ cls: "vtr-share-card" });

    const cover = coverImage(fm, fm.url ?? fm.source) || resolveCover(app, fm[this.plugin.settings.coverProperty], f.path) || "";
    if (cover) {
      const box = card.createDiv({ cls: "vtr-share-thumb" });
      const im = box.createEl("img");
      im.src = cover;
      im.onerror = () => box.remove();
    }
    const body = card.createDiv({ cls: "vtr-share-body" });
    body.createDiv({ cls: "vtr-share-title", text: title(app, f) });
    const props = body.createDiv({ cls: "vtr-share-props" });
    for (const key of this.picked) {
      const def = this.defs.find((d) => d.key === key);
      if (!def) continue;
      const cell = props.createDiv();
      cell.createSpan({ cls: "vtr-share-k", text: key });
      cell.createSpan({ cls: "vtr-share-v", text: this.text(def, fm) });
    }
    if (this.files.length > 1) {
      const x = wrap.createSpan({ cls: "vtr-share-x", text: "×", attr: { "aria-label": "Remove from card" } });
      x.onclick = () => {
        this.files = this.files.filter((o) => o.path !== f.path);
        this.draw();
      };
    }
  }

  private text(def: PropDef, fm: Record<string, unknown>): string {
    const v = def.kind === "formula" ? evalFormula(def.expr ?? "", fm) : fm[def.key];
    if (v === undefined || v === null || v === "") return "—";
    const one = (x: unknown) => {
      const target = resolveLink(this.plugin.app, x, this.files[0]?.path ?? "");
      return target ? title(this.plugin.app, target) : String(x);
    };
    return Array.isArray(v) ? v.map(one).join(", ") : one(v);
  }

  private async remember() {
    const f = this.files[0];
    const type = f ? typeOf(this.plugin, f, objectTypes(this.plugin)) : null;
    if (!type) return;
    this.plugin.settings.shareProps = { ...(this.plugin.settings.shareProps ?? {}), [type.id]: this.picked };
    await this.plugin.saveSettings();
  }

  private async shot(): Promise<any | null> {
    const wc = webContents();
    if (!wc?.capturePage) {
      new Notice("This Obsidian build can't capture the card.");
      return null;
    }
    const el = this.stack.querySelector<HTMLElement>(".vtr-share-card");
    if (!el) return null;

    const bands: HTMLImageElement[] = [];
    const view = () => this.stack.getBoundingClientRect();
    const step = Math.max(80, Math.floor(view().height));
    for (let off = 0; off < el.offsetHeight; off += step) {
      this.stack.scrollTop = off;
      await afterPaint();
      const r = el.getBoundingClientRect();
      const box = view();
      const top = Math.max(box.top, r.top);
      const height = Math.round(Math.min(box.bottom, r.bottom) - top);
      if (height <= 0) break;
      const img = await wc.capturePage({
        x: Math.round(r.left),
        y: Math.round(top),
        width: Math.round(r.width),
        height,
      });
      bands.push(await loadImage(img.toDataURL()));
    }
    this.stack.scrollTop = 0;
    if (!bands.length) return null;

    const width = Math.max(...bands.map((b) => b.width));
    const height = bands.reduce((sum, b) => sum + b.height, 0);
    const canvas = createEl("canvas");
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext("2d");
    if (!g) return null;
    g.fillStyle = "#24283b";
    g.fillRect(0, 0, width, height);
    let y = 0;
    for (const b of bands) {
      g.drawImage(b, 0, y);
      y += b.height;
    }
    return electron()?.nativeImage?.createFromDataURL(canvas.toDataURL("image/png"));
  }

  private async copy() {
    const image = await this.shot();
    if (!image) return;
    electron()?.clipboard?.write({ image });
    new Notice(this.files.length > 1 ? `${this.files.length} cards copied — paste them in the chat.` : "Card copied — paste it in the chat.");
    this.close();
  }

  private async save() {
    const image = await this.shot();
    if (!image) return;
    const first = this.files[0];
    const name = this.files.length > 1 ? `${first.basename} +${this.files.length - 1} card.png` : `${first.basename} card.png`;
    const path = await this.app.fileManager.getAvailablePathForAttachment(name);
    await this.app.vault.createBinary(path, new Uint8Array(image.toPNG()).buffer as ArrayBuffer);
    new Notice(`Saved to ${path}`);
    this.close();
  }
}

function afterPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
