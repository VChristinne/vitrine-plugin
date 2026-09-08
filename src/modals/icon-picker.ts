import { App, FuzzyMatch, FuzzySuggestModal, getIconIds, setIcon } from "obsidian";

export class IconPickerModal extends FuzzySuggestModal<string> {
  constructor(app: App, private onPick: (icon: string) => void) {
    super(app);
    this.setPlaceholder("Search Lucide icons");
  }

  getItems(): string[] {
    return getIconIds();
  }

  getItemText(id: string): string {
    return id;
  }

  renderSuggestion(match: FuzzyMatch<string>, el: HTMLElement) {
    el.addClass("vtr-icon-option");
    setIcon(el.createSpan({ cls: "vtr-icon-option-mark" }), match.item);
    el.createSpan({ text: match.item.replace(/^lucide-/, "") });
  }

  onChooseItem(id: string) {
    this.onPick(id.replace(/^lucide-/, ""));
  }
}
