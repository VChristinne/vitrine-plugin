import { App, Modal, Setting } from "obsidian";

class DateModal extends Modal {
  private value: string;
  private settled = false;

  constructor(
    app: App,
    current: number | undefined,
    private resolve: (ms: number | null) => void,
  ) {
    super(app);
    this.value = new Date(current ?? Date.now()).toISOString().slice(0, 10);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { cls: "vtr-modal-title", text: "Unlock date" });

    const input = contentEl.createEl("input", { type: "date", cls: "vtr-date-input" });
    input.value = this.value;
    input.onchange = () => (this.value = input.value);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.submit();
    });
    window.setTimeout(() => input.focus(), 0);

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Set").setCta().onClick(() => this.submit()));
  }

  private submit() {
    if (!this.value) return;
    this.settled = true;
    this.resolve(new Date(`${this.value}T00:00:00`).getTime());
    this.close();
  }

  onClose() {
    this.contentEl.empty();
    if (!this.settled) this.resolve(null);
  }
}

export function askDate(app: App, current: number | undefined): Promise<number | null> {
  return new Promise((resolve) => new DateModal(app, current, resolve).open());
}
