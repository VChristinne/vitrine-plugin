import { Component, ItemView, MarkdownRenderer, TFile, ViewStateResult, WorkspaceLeaf, debounce } from "obsidian";
import type VitrinePlugin from "../main";

export interface NoteViewState extends Record<string, unknown> {
  libraryId: string;
  notePath: string;
  subpath?: string;
}

export abstract class NoteView extends ItemView {
  protected state: NoteViewState = { libraryId: "", notePath: "" };
  protected noteText = "";
  protected loaded = false;
  protected dirty = false;
  protected disposed = false;

  private previewEl: HTMLElement | null = null;
  private previewSeq = 0;
  private previewComp: Component | null = null;

  protected queueSave = debounce(() => void this.saveNote(), 500);

  constructor(leaf: WorkspaceLeaf, protected plugin: VitrinePlugin) {
    super(leaf);
  }

  abstract render(): void;
  protected onReload(): void {}
  protected onNavigate(): void {}
  protected onDispose(): void {}

  getState() {
    return this.state;
  }

  async setState(state: NoteViewState, result: ViewStateResult) {
    if (state?.notePath && state.notePath !== this.state.notePath) {
      void this.saveNote();
      this.state = state;
      this.loaded = false;
      this.dirty = false;
      this.onNavigate();
      void this.reload();
    } else if (state && state.libraryId !== this.state.libraryId) {
      this.state = state;
      this.render();
    }
    return super.setState(state, result);
  }

  async onOpen() {
    this.trackRename();
    void this.reload();
  }

  protected trackRename() {
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile && oldPath === this.state.notePath) {
          this.state.notePath = file.path;
          (this.leaf as { updateHeader?: () => void }).updateHeader?.();
          this.render();
        }
      }),
    );
  }

  async onClose() {
    void this.saveNote();
    this.disposed = true;
    this.destroyPreview();
    this.onDispose();
  }

  protected note(): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(this.state.notePath);
    return file instanceof TFile ? file : null;
  }

  protected async reload() {
    if (this.dirty) {
      this.render();
      return;
    }
    const note = this.note();
    this.noteText = note ? await this.app.vault.read(note) : "";
    this.loaded = Boolean(note);
    if (this.disposed) return;
    this.onReload();
    this.render();
  }

  protected markEdited(text: string) {
    this.noteText = text;
    this.dirty = true;
    this.queueSave();
  }

  protected async saveNote() {
    if (!this.loaded || !this.dirty) return;
    const note = this.note();
    if (note) await this.app.vault.modify(note, this.noteText);
  }

  protected mountPreview(el: HTMLElement) {
    this.previewEl = el;
  }

  protected async renderPreview(md: string, after?: (el: HTMLElement) => void) {
    const el = this.previewEl;
    if (!el) return;
    const seq = ++this.previewSeq;
    const comp = new Component();
    comp.load();
    const tmp = createDiv();
    await MarkdownRenderer.render(this.app, md, tmp, this.state.notePath, comp);
    if (seq !== this.previewSeq || this.previewEl !== el) {
      comp.unload();
      return;
    }
    this.previewComp?.unload();
    this.previewComp = comp;
    el.empty();
    el.append(...Array.from(tmp.childNodes));
    after?.(el);
  }

  protected destroyPreview() {
    this.previewSeq++;
    this.previewComp?.unload();
    this.previewComp = null;
    this.previewEl = null;
  }
}
