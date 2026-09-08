import { App } from "obsidian";
import { asText } from "./fields";

export function resolveCover(app: App, name: unknown, contextPath: string): string | undefined {
  const raw = asText(name);
  if (!raw) return undefined;
  if (raw.startsWith("http")) return raw;
  const cleaned = raw.replace(/^!?\[\[|\]\]$/g, "").split("|")[0];
  const file =
    app.metadataCache.getFirstLinkpathDest(cleaned, contextPath) ??
    app.metadataCache.getFirstLinkpathDest(cleaned.split("/").pop() ?? cleaned, contextPath);
  return file ? app.vault.getResourcePath(file) : undefined;
}
