import { App, FuzzySuggestModal, TFile } from "obsidian";

export class NotePickerModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private onPick: (file: TFile) => void, placeholder = "Search notes") {
    super(app);
    this.setPlaceholder(placeholder);
  }

  getItems(): TFile[] {
    return this.app.vault.getFiles();
  }

  getItemText(f: TFile): string {
    return f.path;
  }

  onChooseItem(f: TFile) {
    this.onPick(f);
  }
}
