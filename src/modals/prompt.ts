import { App, Modal, Setting, SuggestModal } from "obsidian";

export function promptText(app: App, title: string, placeholder = "", initial = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const modal = new Modal(app);
    modal.titleEl.setText(title);
    let value = initial;
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      resolve(v);
      modal.close();
    };
    new Setting(modal.contentEl).addText((t) => {
      t.setPlaceholder(placeholder).setValue(initial).onChange((v) => (value = v));
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") finish(value.trim() || null);
      });
      t.inputEl.focus();
    });
    new Setting(modal.contentEl).addButton((b) =>
      b.setButtonText(initial ? "Save" : "Create").setCta().onClick(() => finish(value.trim() || null)),
    );
    modal.onClose = () => finish(null);
    modal.open();
  });
}

export function promptKey(app: App, options: string[], placeholder = "Property name"): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const modal = new (class extends SuggestModal<string> {
      getSuggestions(query: string): string[] {
        const q = query.trim();
        const hits = options.filter((o) => o.toLowerCase().includes(q.toLowerCase()));
        return q && !options.includes(q) ? [q, ...hits] : hits;
      }
      renderSuggestion(key: string, el: HTMLElement) {
        el.setText(options.includes(key) ? key : `Create "${key}"`);
      }
      onChooseSuggestion(key: string) {
        finish(key);
      }
      onClose() {
        super.onClose();
        finish(null);
      }
    })(app);
    modal.setPlaceholder(placeholder);
    modal.open();
  });
}
