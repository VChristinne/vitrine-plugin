import { App, Modal, Setting } from "obsidian";

export interface SteamCreds {
  key: string;
  steamId: string;
}

class SteamCredsModal extends Modal {
  private creds: SteamCreds;
  private settled = false;

  constructor(app: App, current: SteamCreds, private resolve: (c: SteamCreds | null) => void) {
    super(app);
    this.creds = { ...current };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { cls: "vtr-modal-title", text: "Steam sync" });
    contentEl.createEl("p", {
      cls: "vtr-modal-note",
      text: "Session only, not saved. Key: steamcommunity.com/dev/apikey",
    });

    new Setting(contentEl).setName("Web API key").addText((t) => {
      t.setValue(this.creds.key).onChange((v) => (this.creds.key = v.trim()));
      t.inputEl.type = "password";
      window.setTimeout(() => t.inputEl.focus(), 0);
      t.inputEl.addEventListener("keydown", (e) => e.key === "Enter" && this.submit());
    });

    new Setting(contentEl)
      .setName("SteamID64")
      .setDesc("Optional. Your unlocked progress from a public profile. Empty = list only.")
      .addText((t) => {
        t.setValue(this.creds.steamId).onChange((v) => (this.creds.steamId = v.trim()));
        t.inputEl.addEventListener("keydown", (e) => e.key === "Enter" && this.submit());
      });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Sync").setCta().onClick(() => this.submit()));
  }

  private submit() {
    if (!this.creds.key) return;
    this.settled = true;
    this.resolve(this.creds);
    this.close();
  }

  onClose() {
    this.contentEl.empty();
    if (!this.settled) this.resolve(null);
  }
}

export function askSteamCreds(app: App, current: SteamCreds): Promise<SteamCreds | null> {
  return new Promise((resolve) => new SteamCredsModal(app, current, resolve).open());
}
