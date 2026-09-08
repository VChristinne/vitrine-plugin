import type { ItemView } from "obsidian";
import type { VitrineSettings } from "../types";

export function applyTheme(root: HTMLElement, s: VitrineSettings) {
  root.dataset.palette = s.palette;
  root.style.setProperty("--vtr-fs", String((s.fontScale || 1) * 1.06));
  root.dataset.glow = s.reduceGlow ? "off" : "on";
}

export function viewRoot(view: ItemView): HTMLElement {
  return view.containerEl.children[1] as HTMLElement;
}

export function mountView(view: ItemView, s: VitrineSettings): HTMLElement {
  const root = viewRoot(view);
  root.empty();
  root.addClass("vtr");
  applyTheme(root, s);
  return root;
}

export function objectSurface(s: VitrineSettings): string {
  const dark = document.body.classList.contains("theme-dark");
  const raw = ((dark ? s.objectsSurfaceDark : undefined) ?? s.objectsSurface ?? "obsidian") as string;
  return raw === "neu-light" || raw === "neu-dark" ? "neu" : raw;
}

export function applyModalTheme(modalEl: HTMLElement, s: VitrineSettings) {
  modalEl.addClass("vtr-modal");
  modalEl.dataset.vtrSurface = objectSurface(s);
}
