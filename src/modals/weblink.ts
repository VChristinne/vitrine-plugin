import { Modal, Notice, TFile, requestUrl } from "obsidian";
import { ensureFolder, freePath, nameFitsFile, safeName } from "../paths";
import type { ObjectType } from "../objects/model";
import { applyModalTheme } from "../render/theme";
import type VitrinePlugin from "../main";

interface Meta {
  title: string;
  description: string;
  site: string;
  image: string;
}

export function trimSite(title: string, site: string): string {
  const m = title.match(/^(.+?)\s+[-|–—·:]\s+([^-|–—·:]+)$/);
  if (!m) return title.trim();
  const names = [site, site.replace(/^www\./, "").split(".")[0]].map((n) => n.trim().toLowerCase()).filter(Boolean);
  return names.includes(m[2].trim().toLowerCase()) ? m[1].trim() : title.trim();
}

export class WeblinkModal extends Modal {
  constructor(
    private plugin: VitrinePlugin,
    private type: ObjectType,
  ) {
    super(plugin.app);
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    applyModalTheme(modalEl, this.plugin.settings);
    modalEl.addClass("vtr-wl-modal");
    contentEl.createDiv({ cls: "vtr-modal-head" }).createDiv({ cls: "vtr-modal-head-title", text: "Add Weblink" });

    const box = contentEl.createDiv({ cls: "vtr-modal-input vtr-wl-input" });
    const input = box.createEl("input", { cls: "vtr-modal-input-el", type: "text" });
    input.placeholder = "Paste URL";
    const status = contentEl.createDiv({ cls: "vtr-wl-status" });

    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const url = input.value.trim();
      if (/^https?:\/\//i.test(url)) void this.save(url, status, input);
      else status.setText("Enter a full http(s) URL.");
    });
    setTimeout(() => input.focus(), 0);
  }

  private async save(url: string, status: HTMLElement, input: HTMLInputElement) {
    input.disabled = true;
    status.setText("Fetching…");
    const meta = await this.fetchMeta(url);
    const yaml = (v: string) => (/^[\w .\-/]+$/.test(v) ? v : JSON.stringify(v));
    const folder = this.type.newNoteFolder ?? "";
    const title = trimSite(meta.title, meta.site) || url;
    const lines = ["---", `type: ${yaml(this.type.name)}`, `url: ${yaml(url)}`];
    if (!nameFitsFile(title)) lines.push(`title: ${yaml(title)}`);
    for (const key of ["site", "description", "image"] as const) {
      const v = meta[key];
      if (v && !this.type.dropped.includes(key)) lines.push(`${key}: ${yaml(v)}`);
    }
    lines.push("---", "");

    try {
      if (folder) await ensureFolder(this.app, folder);
      const path = await freePath(this.app, folder, safeName(title), "md");
      const file = await this.app.vault.create(path, lines.join("\n"));
      this.close();
      this.plugin.refreshViews();
      if (file instanceof TFile) await this.plugin.openObject(file.path);
    } catch (error) {
      new Notice(`Could not create the note: ${String(error)}`);
      input.disabled = false;
      status.setText("");
    }
  }

  private async fetchMeta(url: string): Promise<Meta> {
    try {
      const res = await requestUrl({ url, throw: false });
      const html = res.text ?? "";
      const meta = (prop: string) => {
        const re = new RegExp(
          `<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']` +
            `|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`,
          "i",
        );
        const m = html.match(re);
        return (m?.[1] ?? m?.[2] ?? "").trim();
      };
      const decode = (s: string) =>
        s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");
      const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? "";
      let image = meta("og:image");
      if (image.startsWith("/")) {
        try {
          image = new URL(image, new URL(url).origin).href;
        } catch {
          image = "";
        }
      }
      let host = url;
      try {
        host = new URL(url).hostname;
      } catch {
      }
      return {
        title: decode(meta("og:title") || titleTag),
        description: decode(meta("og:description") || meta("description")),
        site: decode(meta("og:site_name") || host),
        image,
      };
    } catch {
      return { title: "", description: "", site: "", image: "" };
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
