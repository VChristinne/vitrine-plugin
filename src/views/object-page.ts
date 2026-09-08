import { App, Component, ItemView, MarkdownRenderer, Menu, TFile, ViewStateResult, WorkspaceLeaf, getAllTags, moment, setIcon } from "obsidian";
import { mountView } from "../render/theme";
import { addTag, removeTag, setCollection, setField } from "../model/frontmatter";
import { asList, selectOptions, toggleSelect } from "../model/fields";
import { describeQuery, evalQuery, type QuerySpec } from "../objects/query";
import {
  objectTypes,
  objectsOfType,
  pluralName,
  typeConfigs,
  typeOf,
  typeOrPage,
  title,
  renameObject,
  notePropDefs,
  backlinksOf,
  resolveLink,
  resolveLinks,
  coverImage,
  coverKey,
  inCollection,
  effectiveProps,
  evalFormula,
  collectionOf,
  collectionsOf,
  previewText,
  type ObjectType,
  type PropDef,
} from "../objects/model";
import { resolveCover } from "../model/index-builder";
import { promptKey, promptText } from "../modals/prompt";
import { NotePickerModal } from "../modals/note-picker";
import { ShareCardModal } from "../modals/share-card";
import { linkedService } from "../sync/achievements";
import { renderAchievements } from "../render/achievements-panel";
import { renderTaskRow } from "../objects/task-row";
import { createTask, parseTaskInput } from "../objects/task-create";
import { renderTaskPanel, renderOccurrences } from "../objects/task-stats";
import type VitrinePlugin from "../main";

export const VIEW_OBJECT_PAGE = "vitrine-object-page";

export interface ObjPageCtx {
  app: App;
  plugin: VitrinePlugin;
  component: Component;
  file: TFile;
  subpath?: string;
  rerender: () => void;
  compact?: boolean;
  onBack?: () => void;
  onPin?: () => void;
  onOpenTab?: () => void;
  onClose?: () => void;
  openInTab?: (path: string, background?: boolean) => void;
}

export function renderObjectPage(container: HTMLElement, ctx: ObjPageCtx) {
  const { app, plugin, file: f, compact } = ctx;
  const types = objectTypes(plugin);
  const type = typeOrPage(plugin, f, types);

  const layout = compact ? "page" : type?.layout ?? "page";
  const page = container.createDiv({ cls: `vtr-objects-page is-${layout}${!compact && type?.wide ? " is-wide" : ""}` });

  if (!type) {
    const box = page.createDiv({ cls: "vtr-objects-emptystate" });
    setIcon(box.createDiv({ cls: "vtr-objects-empty-icon" }), "box");
    box.createDiv({ cls: "vtr-objects-empty-title", text: "Not an object" });
    box.createDiv({ text: "This note has no object type." });
    return;
  }
  const cache = app.metadataCache.getFileCache(f);
  const fm = cache?.frontmatter ?? {};

  const cover = coverImage(fm, fm.url ?? fm.source) || resolveCover(app, fm[plugin.settings.coverProperty], f.path) || "";
  if (cover && layout !== "profile" && layout !== "encyclopedia") {
    const cov = page.createDiv({ cls: `vtr-objects-pcover is-${type.coverMode}${type.cover === "full" ? " is-full" : ""}` });
    const im = cov.createEl("img");
    im.src = cover;
    im.onerror = () => cov.remove();
  }

  const head = page.createDiv({ cls: "vtr-objects-phead" });
  const hl = head.createDiv({ cls: "vtr-objects-phead-l" });
  if (ctx.onBack) {
    const back = hl.createDiv({ cls: "vtr-objects-pmore", attr: { "aria-label": "Back" } });
    setIcon(back, "arrow-left");
    back.onclick = () => ctx.onBack?.();
  }
  const pill = hl.createDiv({ cls: "vtr-objects-ptypepill" });
  pill.style.setProperty("--hue", type.hue);
  setIcon(pill.createSpan(), type.icon);
  pill.createSpan({ text: type.name });
  setIcon(pill.createSpan(), "chevron-down");
  pill.onclick = (e) => typeMenu(ctx, e);
  if (!compact) {
    const cur = collectionOf(plugin, type, f);
    const coll = hl.createDiv({ cls: cur ? "vtr-objects-ptypepill" : "vtr-objects-pcoll" });
    if (cur) coll.style.setProperty("--hue", type.hue);
    setIcon(coll.createSpan(), "folder");
    coll.createSpan({ text: cur ? cur.name : "Collections" });
    if (cur) setIcon(coll.createSpan(), "chevron-down");
    coll.onclick = (e) => collectionsMenu(ctx, e, type);
  }
  const hr = head.createDiv({ cls: "vtr-objects-phead-r" });
  const iconBtn = (icon: string, label: string, onClick: (e: MouseEvent) => void) => {
    const b = hr.createDiv({ cls: "vtr-objects-pmore", attr: { "aria-label": label } });
    setIcon(b, icon);
    b.onclick = onClick;
  };
  if (ctx.onPin) iconBtn("pin", "Pin to sidebar", () => ctx.onPin?.());
  iconBtn("more-horizontal", "More", (e) => void moreMenu(ctx, e, type, !!compact));

  const renderIdentity = (host: HTMLElement) => {
    const h1 = host.createEl("h1", { cls: "vtr-objects-ptitle", text: title(app, f), attr: { contenteditable: "true", spellcheck: "false" } });
    h1.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); h1.blur(); }
      if (e.key === "Escape") { h1.setText(title(app, f)); h1.blur(); }
    });
    h1.addEventListener("blur", () => void renameObject(app, f, h1.textContent ?? "").then((ok) => ok && ctx.rerender()));

    const chips = host.createDiv({ cls: "vtr-objects-pchips" });
    if (layout !== "encyclopedia" && layout !== "profile") {
      for (const p of defsFor(ctx, type)) {
        if (p.kind === "link" || p.kind === "links" || p.kind === "check") continue;
        const v = fm[p.key];
        if (Array.isArray(v) || v === undefined || v === null || v === "") continue;
        const chip = chips.createSpan({ cls: "vtr-objects-plabel" });
        chip.createSpan({ cls: "vtr-objects-plabel-k", text: p.key });
        chip.createSpan({ text: propLabel(app, v, f.path) });
        const x = chip.createSpan({ cls: "vtr-objects-ptag-x", text: "×", attr: { "aria-label": "Remove property" } });
        x.onclick = async (e) => {
          e.stopPropagation();
          if (await removeProp(ctx, type, p)) ctx.rerender();
        };
      }
    }
    for (const tag of (cache ? getAllTags(cache) ?? [] : [])) {
      const name = tag.replace(/^#/, "");
      const chip = chips.createSpan({ cls: "vtr-objects-ptag" });
      setIcon(chip.createSpan(), "hash");
      chip.createSpan({ text: name });
      const x = chip.createSpan({ cls: "vtr-objects-ptag-x", text: "×", attr: { "aria-label": "Remove tag" } });
      x.onclick = async (e) => { e.stopPropagation(); await removeTag(app, f, name); ctx.rerender(); };
    }
    const add = chips.createSpan({ cls: "vtr-objects-ptag is-add" });
    setIcon(add.createSpan(), "tag");
    add.createSpan({ text: "Tags" });
    add.onclick = (e) => tagsMenu(ctx, e, cache ? getAllTags(cache) ?? [] : []);

    const desc = host.createDiv({ cls: "vtr-objects-pdesc" });
    const renderDesc = () => {
      const d = String(fm.description ?? "").trim();
      desc.setText(d || "Add description…");
      desc.toggleClass("is-empty", !d);
    };
    desc.onclick = async () => {
      const v = await promptText(app, "Description", String(fm.description ?? ""));
      if (v === null) return;
      await setField(app, f, "description", v);
      fm.description = v;
      renderDesc();
    };
    renderDesc();
  };

  const knownProps = (): PropDef[] => {
    const m = new Map<string, PropDef>();
    for (const t of plugin.settings.objectTypes ?? [])
      for (const p of [...(t.props ?? []), ...(t.collections ?? []).flatMap((c) => c.props ?? [])]) m.set(p.key, p);
    for (const file of app.vault.getMarkdownFiles())
      for (const p of notePropDefs(plugin, file)) if (!m.has(p.key)) m.set(p.key, p);
    return [...m.values()].sort((a, b) => a.key.localeCompare(b.key));
  };

  const renderProps = (host: HTMLElement) => {
    const coll = collectionOf(plugin, type, f);
    const cfg = (plugin.settings.objectTypes ?? []).find((t) => t.id === type.id);
    const schema = coll?.props?.length ? coll : cfg;
    const props = host.createDiv({ cls: "vtr-objects-props" });
    const valueOf = (p: PropDef) => (p.kind === "formula" ? evalFormula(p.expr ?? "", fm) : fm[p.key]);
    const isBlank = (p: PropDef) => {
      const v = valueOf(p);
      return v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);
    };
    let showEmpty = false;

    const draw = () => {
      props.empty();
      const defs = defsFor(ctx, type);
      const hidden = plugin.settings.hideEmptyProps && !showEmpty ? defs.filter(isBlank) : [];
      for (const p of defs) {
        if (hidden.includes(p)) continue;
        const row = propRow(ctx, props, p, valueOf(p), types, type);
        if (!schema) continue;
        const rm = row.createSpan({ cls: "vtr-objects-prow-x", text: "×", attr: { "aria-label": "Remove property" } });
        rm.onclick = async (e) => {
          e.stopPropagation();
          if (await removeProp(ctx, type, p)) ctx.rerender();
        };
      }
      if (hidden.length || showEmpty) {
        const fold = props.createDiv({ cls: "vtr-objects-pfold" });
        setIcon(fold.createSpan(), showEmpty ? "chevron-up" : "chevron-down");
        fold.createSpan({ text: showEmpty ? "Hide empty" : `${hidden.length} hidden` });
        fold.onclick = () => ((showEmpty = !showEmpty), draw());
      }
      if (type.id === "__task") renderOccurrences(plugin, props, f);
      if (!schema) return;
      const add = props.createDiv({ cls: "vtr-objects-propadd" });
      setIcon(add.createSpan(), "plus");
      add.createSpan({ text: "Add property" });
      add.onclick = async () => {
        const taken = new Set(defs.map((p) => p.key));
        const known = knownProps().filter((p) => !taken.has(p.key));
        const key = (await promptKey(app, known.map((p) => p.key)))?.trim();
        if (!key) return;
        await app.fileManager.processFrontMatter(f, (m) => { if (m[key] === undefined) m[key] = ""; });
        const cached = app.metadataCache.getFileCache(f)?.frontmatter;
        if (cached) cached[key] = "";
        showEmpty = true;
        draw();
      };
    };
    draw();
  };

  const renderCover = (host: HTMLElement, cls: string) => {
    if (!cover) return;
    const box = host.createDiv({ cls });
    const im = box.createEl("img");
    im.src = cover;
    im.onerror = () => box.remove();
  };

  const renderToc = (host: HTMLElement) => {
    const toc = host.createDiv({ cls: "vtr-objects-ptoc" });
    for (const h of cache?.headings ?? []) {
      const row = toc.createDiv({ cls: "vtr-objects-ptoc-i", text: h.heading });
      row.style.paddingLeft = `${(h.level - 1) * 12}px`;
    }
  };

  const renderAch = (host: HTMLElement) => {
    if (!linkedService(app, f)) return;
    renderAchievements(plugin, host.createDiv({ cls: "vtr-objects-ach" }), f, ctx.rerender);
  };

  const renderRefs = (host: HTMLElement) => {
    const bl = backlinksOf(plugin, f);
    const refs = host.createDiv({ cls: "vtr-objects-refs" });
    const rh = refs.createDiv({ cls: "vtr-objects-refs-h" });
    rh.createSpan({ text: "Linked references" });
    rh.createSpan({ cls: "vtr-objects-refs-c", text: String(bl.length) });
    if (!bl.length) refs.createDiv({ cls: "vtr-objects-refs-empty", text: "No references yet." });
    for (const b of bl) {
      const bt = typeOf(plugin, b.file, types);
      const row = refs.createDiv({ cls: "vtr-objects-bl" });
      const bi = row.createSpan({ cls: "vtr-objects-ico is-small" });
      if (bt) bi.style.setProperty("--hue", bt.hue);
      setIcon(bi, bt?.icon ?? "file-text");
      const body = row.createDiv({ cls: "vtr-objects-bl-b" });
      body.createDiv({ cls: "vtr-objects-bl-t", text: title(app, b.file) });
      body.createDiv({ cls: "vtr-objects-bl-s", text: bt?.name ?? "Note" });
      row.onclick = () => openFileOrObject(ctx, b.file, types);
    }
  };

  const renderTasks = (host: HTMLElement) => {
    const taskType = types.find((t) => t.id === "__task");
    if (!taskType || type.id === "__task") return;
    const mine = objectsOfType(plugin, taskType).filter((tf) => {
      const cfm = app.metadataCache.getFileCache(tf)?.frontmatter;
      return resolveLinks(app, cfm?.context, tf.path).some((c) => c.path === f.path);
    });
    const box = host.createDiv({ cls: "vtr-objects-tasks" });
    const h = box.createDiv({ cls: "vtr-task-sech" });
    h.createSpan({ text: "Tasks" });
    h.createSpan({ cls: "vtr-task-secc", text: String(mine.length) });
    const body = box.createDiv({ cls: "vtr-task vtr-task-secbody" });
    for (const tf of mine) renderTaskRow(plugin, body, tf, (file) => openFileOrObject(ctx, file, types), ctx.rerender, f);
    const add = box.createDiv({ cls: "vtr-task-add" });
    setIcon(add.createSpan({ cls: "vtr-task-add-i" }), "plus");
    const input = add.createEl("input", { type: "text", attr: { placeholder: "Add a task…" } });
    input.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter" || !input.value.trim()) return;
      await createTask(plugin, { ...parseTaskInput(input.value.trim()), context: f });
      input.value = "";
      ctx.rerender();
    });
  };

  const renderRecur = (host: HTMLElement) => {
    if (type.id !== "__task") return;
    renderTaskPanel(plugin, host, f, ctx.rerender);
  };

  if (layout === "encyclopedia") {
    const cols = page.createDiv({ cls: "vtr-objects-pcols is-enc" });
    const nav = cols.createDiv({ cls: "vtr-objects-pcol-nav" });
    renderRefs(nav);
    renderToc(nav);
    const main = cols.createDiv({ cls: "vtr-objects-pcol-main" });
    renderIdentity(main);
    void fillContent(ctx, main.createDiv({ cls: "vtr-objects-pcontent" }));
    renderAch(main);
    renderTasks(main);
    renderRecur(main);
    const side = cols.createDiv({ cls: "vtr-objects-pcol-side" });
    renderCover(side, "vtr-objects-pcover-side");
    renderProps(side);
  } else if (layout === "profile") {
    const cols = page.createDiv({ cls: "vtr-objects-pcols" });
    const side = cols.createDiv({ cls: "vtr-objects-pcol-side" });
    renderCover(side, "vtr-objects-pavatar");
    renderProps(side);
    const main = cols.createDiv({ cls: "vtr-objects-pcol-main" });
    renderIdentity(main);
    void fillContent(ctx, main.createDiv({ cls: "vtr-objects-pcontent" }));
    renderAch(main);
    renderTasks(main);
    renderRecur(main);
    renderRefs(main);
  } else {
    renderIdentity(page);
    void fillContent(ctx, page.createDiv({ cls: "vtr-objects-pcontent" }));
    renderAch(page);
    renderTasks(page);
    renderRecur(page);
    renderRefs(page);
  }
}

async function removeProp(ctx: ObjPageCtx, type: ObjectType, p: PropDef): Promise<boolean> {
  const { app, plugin, file: f } = ctx;
  const coll = collectionOf(plugin, type, f);
  const cfg = (plugin.settings.objectTypes ?? []).find((t) => t.id === type.id);
  const schema = coll?.props?.length ? coll : cfg;
  const inSchema = (schema?.props ?? []).some((x) => x.key === p.key);
  const has = (o: TFile) => app.metadataCache.getFileCache(o)?.frontmatter?.[p.key] !== undefined;
  const files = inSchema ? objectsOfType(plugin, type).filter(has) : has(f) ? [f] : [];
  if (files.length > 1 && !confirm(`Remove "${p.key}" from ${files.length} ${pluralName(type).toLowerCase()}?`)) return false;
  if (inSchema && schema) {
    schema.props = (schema.props ?? []).filter((x) => x.key !== p.key);
    if (cfg) cfg.dropped = [...new Set([...(cfg.dropped ?? []), p.key])];
    await plugin.saveSettings();
  }
  for (const o of files) await setField(app, o, p.key, undefined);
  delete (app.metadataCache.getFileCache(f)?.frontmatter ?? {})[p.key];
  return true;
}

function defsFor(ctx: ObjPageCtx, type: ObjectType): PropDef[] {
  const fm = ctx.app.metadataCache.getFileCache(ctx.file)?.frontmatter ?? {};
  const own = new Set(["description", ctx.plugin.settings.coverProperty, coverKey(fm), ...type.dropped]);
  const props = effectiveProps(ctx.plugin, type, ctx.file);
  const extra = notePropDefs(ctx.plugin, ctx.file).filter((p) => !props.some((x) => x.key === p.key));
  return [...props, ...extra].filter((p) => !own.has(p.key));
}

let EditorCtor: any = null;
let editorResolved = false;
function resolveEditorCtor(app: any): any {
  if (editorResolved) return EditorCtor;
  editorResolved = true;
  try {
    const holder = createDiv();
    const widget = app.embedRegistry.embedByExtension.md({ app, containerEl: holder, state: {} }, null, "");
    widget.editable = true;
    widget.showEditor?.();
    const editMode = widget.editMode ?? widget.editMode?.();
    EditorCtor = editMode ? Object.getPrototypeOf(Object.getPrototypeOf(editMode)).constructor : null;
    widget.unload?.();
    holder.detach();
  } catch {
    EditorCtor = null;
  }
  return EditorCtor;
}

function mountEditor(
  app: any,
  container: HTMLElement,
  initial: string,
  onSave: (v: string) => void,
  onCancel: () => void,
) {
  const fallback = () => {
    const ta = container.createEl("textarea", { cls: "vtr-objects-pedit" });
    ta.value = initial;
    const grow = () => { ta.style.height = "auto"; ta.style.height = `${ta.scrollHeight}px`; };
    grow();
    ta.addEventListener("input", grow);
    ta.addEventListener("blur", () => onSave(ta.value));
    ta.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); onCancel(); } });
    ta.focus();
  };

  const Ctor = resolveEditorCtor(app);
  if (!Ctor) { fallback(); return; }
  try {
    let editor: any;
    let finished = false;
    const value = () => { try { return editor.editor?.getValue?.() ?? initial; } catch { return initial; } };
    const destroy = () => { try { editor?.unload?.(); editor?.destroy?.(); } catch { } };
    const onOutside = (ev: MouseEvent) => { if (!container.contains(ev.target as Node)) finish(true); };
    const finish = (save: boolean) => {
      if (finished) return;
      finished = true;
      document.removeEventListener("mousedown", onOutside, true);
      const v = value();
      destroy();
      save ? onSave(v) : onCancel();
    };
    editor = new Ctor(app, container, {
      app,
      onEnter: () => false,
      onEscape: () => finish(false),
      onSubmit: () => {},
      onBlur: () => finish(true),
      onChange: () => {},
      onPaste: () => {},
      getValue: () => value(),
      setValue: (v: string) => { try { editor.set?.(v); } catch { } },
    });
    editor.set?.(initial);
    editor.editorEl?.classList?.add?.("vtr-objects-liveedit");
    window.setTimeout(() => {
      document.addEventListener("mousedown", onOutside, true);
      try { editor.editor?.focus?.(); } catch { }
    }, 0);
  } catch {
    container.empty();
    fallback();
  }
}

async function fillContent(ctx: ObjPageCtx, el: HTMLElement) {
  const { app, file: f } = ctx;
  const raw = await app.vault.cachedRead(f);
  if (!el.isConnected) return;
  const fm = raw.match(/^---\n[\s\S]*?\n---\n*/)?.[0] ?? "";
  let body = raw.slice(fm.length);

  const types = objectTypes(ctx.plugin);
  let scrolled = false;
  const read = async () => {
    el.empty();
    el.removeClass("is-editing");
    await MarkdownRenderer.render(app, body || "*Empty note.*", el, f.path, ctx.component);
    transformObjectLinks(ctx, el, types);
    transformQueryRefs(ctx, el);
    if (ctx.subpath && !scrolled) {
      scrolled = true;
      const want = ctx.subpath.replace(/^[#^]+/, "").trim().toLowerCase();
      const h = Array.from(el.querySelectorAll("h1,h2,h3,h4,h5,h6")).find((e) => (e.textContent ?? "").trim().toLowerCase() === want);
      h?.scrollIntoView({ block: "start" });
    }
  };
  el.onclick = (e) => {
    if (el.hasClass("is-editing")) return;
    const a = (e.target as HTMLElement).closest("a");
    if (a) {
      if (a.classList.contains("internal-link")) {
        e.preventDefault();
        const href = a.getAttribute("data-href") ?? a.getAttribute("href") ?? "";
        const dest = app.metadataCache.getFirstLinkpathDest(href, f.path);
        if (dest) openFileOrObject(ctx, dest, types);
      }
      return;
    }
    el.empty();
    el.addClass("is-editing");
    const done = async (newBody?: string) => {
      if (newBody !== undefined && newBody !== body) { body = newBody; await app.vault.modify(f, fm + body); }
      await read();
    };
    mountEditor(app as any, el, body, (v) => void done(v), () => void done());
  };
  await read();
}

function transformObjectLinks(ctx: ObjPageCtx, el: HTMLElement, types: ObjectType[]) {
  el.querySelectorAll<HTMLElement>("a.internal-link").forEach((a) => {
    if (a.dataset.vtrDone) return;
    const href = a.getAttribute("data-href") ?? a.getAttribute("href") ?? "";
    const dest = ctx.app.metadataCache.getFirstLinkpathDest(href, ctx.file.path);
    if (!dest || dest.extension !== "md") return;
    const type = typeOf(ctx.plugin, dest, types);
    const p = a.parentElement;
    const isBlock = !!p && p.tagName === "P" && (p.textContent ?? "").trim() === (a.textContent ?? "").trim();
    if (isBlock) {
      p.replaceWith(renderLinkView(ctx, dest, type, type?.linkView ?? "link", types));
      return;
    }
    const ic = createSpan({ cls: "vtr-objects-inlink-i" });
    setIcon(ic, type?.icon ?? "file-text");
    a.prepend(ic);
    if (type) a.style.setProperty("--hue", type.hue);
    a.addClass("vtr-objects-inlink");
    a.dataset.vtrDone = "1";
  });
}

function transformQueryRefs(ctx: ObjPageCtx, el: HTMLElement) {
  const queries = ctx.plugin.settings.queries ?? [];
  el.querySelectorAll<HTMLElement>("code").forEach((c) => {
    if (c.closest("pre")) return;
    const name = (c.textContent ?? "").trim().match(/^query:\s*(.+)$/i)?.[1];
    if (!name) return;
    const q = queries.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    if (!q) return;
    const p = c.parentElement;
    const alone = !!p && p.tagName === "P" && (p.textContent ?? "").trim() === (c.textContent ?? "").trim();
    if (alone && p) p.replaceWith(queryCard(ctx, q));
    else c.replaceWith(queryChip(ctx, q));
  });
}

function queryHue(ctx: ObjPageCtx, q: QuerySpec): string | null {
  return objectTypes(ctx.plugin).find((t) => t.id === q.typeIds[0])?.hue ?? null;
}

function queryChip(ctx: ObjPageCtx, q: QuerySpec): HTMLElement {
  const chip = createSpan({ cls: "vtr-objects-inlink" });
  const hue = queryHue(ctx, q);
  if (hue) chip.style.setProperty("--hue", hue);
  setIcon(chip.createSpan({ cls: "vtr-objects-inlink-i" }), q.icon || "search");
  chip.createSpan({ text: q.name });
  chip.onclick = (e) => { e.stopPropagation(); void ctx.plugin.openQuery(q.id); };
  return chip;
}

function queryCard(ctx: ObjPageCtx, q: QuerySpec): HTMLElement {
  const types = objectTypes(ctx.plugin);
  const names = q.typeIds.map((id) => types.find((t) => t.id === id)?.name).filter((n): n is string => !!n);
  const card = createDiv({ cls: "vtr-objects-qcard" });
  const hue = queryHue(ctx, q);
  if (hue) card.style.setProperty("--hue", hue);
  setIcon(card.createSpan({ cls: "vtr-objects-qcard-i" }), q.icon || "search");
  const body = card.createDiv({ cls: "vtr-objects-qcard-b" });
  body.createDiv({ cls: "vtr-objects-qcard-n", text: q.name });
  body.createDiv({ cls: "vtr-objects-qcard-d", text: describeQuery(q, names) });
  card.createSpan({ cls: "vtr-objects-qcard-c", text: String(evalQuery(ctx.plugin, q).length) });
  card.onclick = (e) => { e.stopPropagation(); void ctx.plugin.openQuery(q.id); };
  return card;
}

function typeChip(parent: HTMLElement, type: ObjectType | null): void {
  if (!type) return;
  const pill = parent.createDiv({ cls: "vtr-objects-typechip" });
  pill.style.setProperty("--hue", type.hue);
  setIcon(pill.createSpan(), type.icon);
  pill.createSpan({ text: type.name });
}

function coverImg(parent: HTMLElement, cover: string): void {
  const im = parent.createEl("img", { cls: "vtr-objects-linkcard-img" });
  im.src = cover;
  im.onerror = () => im.remove();
}

function renderProp(ctx: ObjPageCtx, parent: HTMLElement, dest: TFile, type: ObjectType | null, key: string, table: boolean): void {
  const { app, plugin } = ctx;
  const fm = app.metadataCache.getFileCache(dest)?.frontmatter ?? {};
  const cache = app.metadataCache.getFileCache(dest);
  const def = type?.props.find((p) => p.key === key);

  const dateChip = (text: string) => { const c = createDiv({ cls: "vtr-objects-datechip" }); setIcon(c.createSpan(), "calendar"); c.createSpan({ text }); return c; };
  const bar = (value: number, max: number) => {
    const w = createDiv({ cls: "vtr-objects-pbar" });
    w.createDiv({ cls: "vtr-objects-pbar-t" }).createDiv({ cls: "vtr-objects-pbar-f" }).style.width = `${Math.max(0, Math.min(100, (value / max) * 100))}%`;
    w.createSpan({ cls: "vtr-objects-pbar-v", text: max === 5 ? value.toFixed(1) : String(value) });
    return w;
  };

  const node = ((): HTMLElement | null => {
    if (key === "__cover") return null;
    if (key === "__preview") {
      const el = createDiv({ cls: "vtr-objects-card-prev" });
      void app.vault.cachedRead(dest).then((raw) => {
        if (!el.isConnected) return;
        const t = previewText(raw);
        if (t) el.setText(t); else el.remove();
      });
      return el;
    }
    if (key === "__tags") {
      const tags = (getAllTags(cache ?? {}) ?? []).map((x) => x.replace(/^#/, ""));
      if (!tags.length) return null;
      const box = createDiv({ cls: "vtr-objects-wl-tags" });
      for (const t of tags) box.createSpan({ cls: "vtr-objects-wl-tag", text: t });
      return box;
    }
    if (key === "__collections") {
      const cfg = typeConfigs(plugin).find((c) => c.id === type?.id);
      const names = collectionsOf(cfg).filter((c) => inCollection(app, c, dest)).map((c) => c.name);
      if (!names.length) return null;
      const box = createDiv({ cls: "vtr-objects-wl-tags" });
      for (const n of names) box.createSpan({ cls: "vtr-objects-ptag", text: n });
      return box;
    }
    if (key === "__created") return dateChip(moment(dest.stat.ctime).format("D MMM YYYY"));
    if (key === "__updated") return dateChip(moment(dest.stat.mtime).format("D MMM YYYY"));
    const v = fm[key];
    if (v == null || v === "") return null;
    if (def?.kind === "date") return dateChip(String(v));
    if (def?.kind === "number") {
      const n = Number(v);
      if (!Number.isNaN(n) && /rating|stars|score/i.test(key)) return bar(n, 5);
      if (!Number.isNaN(n) && /progress|percent|complete/i.test(key)) return bar(n, 100);
      return createSpan({ cls: "vtr-objects-propv", text: String(v) });
    }
    if (def?.kind === "check") { const c = createSpan(); setIcon(c, v ? "check-square" : "square"); return c; }
    const target = resolveLink(app, v, dest.path);
    return createSpan({ cls: "vtr-objects-propv", text: target ? title(app, target) : String(Array.isArray(v) ? v.join(", ") : v) });
  })();
  if (!node) return;

  if (table) {
    const label = key === "__tags" ? "Tags" : key === "__collections" ? "Collections" : key === "__created" ? "Created" : key === "__updated" ? "Last updated" : key;
    const icon = key === "__tags" ? "tag" : key === "__collections" ? "folder" : key === "__created" ? "calendar" : key === "__updated" ? "clock" : def?.kind === "date" ? "calendar" : def?.kind === "number" ? "hash" : def?.kind === "check" ? "check-square" : def?.kind === "link" ? "link" : "align-left";
    const row = parent.createDiv({ cls: "vtr-objects-embrow" });
    const lab = row.createDiv({ cls: "vtr-objects-embrow-l" });
    setIcon(lab.createSpan(), icon);
    lab.createSpan({ text: label });
    row.createDiv({ cls: "vtr-objects-embrow-v" }).appendChild(node);
  } else {
    parent.appendChild(node);
  }
}

function cardKeys(type: ObjectType | null): string[] {
  return type?.cardProps.length ? type.cardProps : ["__preview", "__tags"];
}

function renderLinkView(ctx: ObjPageCtx, dest: TFile, type: ObjectType | null, view: string, types: ObjectType[]): HTMLElement {
  const { app } = ctx;
  const cover = coverImage(app.metadataCache.getFileCache(dest)?.frontmatter ?? {});
  const open = (e?: Event) => { e?.stopPropagation(); openFileOrObject(ctx, dest, types, e instanceof MouseEvent ? e : undefined); };

  if (view === "inline") {
    const wrap = createDiv();
    const link = wrap.createSpan({ cls: "vtr-objects-inlink" });
    if (type) link.style.setProperty("--hue", type.hue);
    setIcon(link.createSpan({ cls: "vtr-objects-inlink-i" }), type?.icon ?? "file-text");
    link.createSpan({ text: title(app, dest) });
    link.onclick = open;
    return wrap;
  }

  if (view === "small") {
    const card = createDiv({ cls: "vtr-objects-linkcard is-small" });
    card.createDiv({ cls: "vtr-objects-linkcard-title", text: title(app, dest) });
    if (cover) coverImg(card, cover);
    const b = card.createDiv({ cls: "vtr-objects-linkcard-b" });
    for (const key of cardKeys(type)) renderProp(ctx, b, dest, type, key, false);
    card.onclick = open;
    return card;
  }

  if (view === "wide") {
    const card = createDiv({ cls: "vtr-objects-linkcard is-wide" });
    const left = card.createDiv({ cls: "vtr-objects-linkcard-wl" });
    typeChip(left, type);
    left.createDiv({ cls: "vtr-objects-linkcard-title", text: title(app, dest) });
    const b = left.createDiv({ cls: "vtr-objects-linkcard-b" });
    for (const key of cardKeys(type).filter((k) => k !== "__cover" && k !== "__preview")) renderProp(ctx, b, dest, type, key, false);
    if (cover) coverImg(card.createDiv({ cls: "vtr-objects-linkcard-wr" }), cover);
    card.onclick = open;
    return card;
  }

  if (view === "embed") {
    const box = createDiv({ cls: "vtr-objects-linkembed" });
    const head = box.createDiv({ cls: "vtr-objects-linkembed-h" });
    const toggle = head.createSpan({ cls: "vtr-objects-emb-toggle" });
    setIcon(toggle, "chevron-down");
    toggle.onclick = (e) => { e.stopPropagation(); box.classList.toggle("is-collapsed"); };
    const ic = head.createSpan({ cls: "vtr-objects-ico is-small" });
    if (type) ic.style.setProperty("--hue", type.hue);
    setIcon(ic, type?.icon ?? "file-text");
    head.createSpan({ cls: "vtr-objects-linkblock-t", text: title(app, dest) });
    head.onclick = open;
    const bodyBox = box.createDiv({ cls: "vtr-objects-linkembed-b" });
    const tableKeys = [...(type?.props ?? []).map((p) => p.key), "__created", "__updated"];
    const table = bodyBox.createDiv({ cls: "vtr-objects-embtable" });
    for (const key of tableKeys) renderProp(ctx, table, dest, type, key, true);
    const content = bodyBox.createDiv({ cls: "vtr-objects-pcontent" });
    void app.vault.cachedRead(dest).then((raw) => {
      if (!content.isConnected) return;
      const b = raw.replace(/^---\n[\s\S]*?\n---\n*/, "");
      void MarkdownRenderer.render(app, b || "*Empty note.*", content, dest.path, ctx.component);
    });
    return box;
  }

  const row = createDiv({ cls: "vtr-objects-linkblock" });
  const ic = row.createSpan({ cls: "vtr-objects-linkblock-i" });
  if (type) ic.style.setProperty("--hue", type.hue);
  setIcon(ic, type?.icon ?? "file-text");
  row.createSpan({ cls: "vtr-objects-linkblock-t", text: title(app, dest) });
  const meta = row.createDiv({ cls: "vtr-objects-linkblock-meta" });
  for (const key of cardKeys(type).filter((k) => k !== "__cover" && k !== "__preview")) renderProp(ctx, meta, dest, type, key, false);
  const more = row.createSpan({ cls: "vtr-objects-linkblock-more", attr: { "aria-label": "More" } });
  setIcon(more, "more-horizontal");
  more.onclick = (e) => {
    e.stopPropagation();
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("Open in new tab").setIcon("external-link").onClick(() => ctx.openInTab ? ctx.openInTab(dest.path) : void ctx.plugin.openObject(dest.path)));
    menu.showAtMouseEvent(e);
  };
  row.onclick = open;
  return row;
}

function openFileOrObject(ctx: ObjPageCtx, f: TFile, _types: ObjectType[], e?: MouseEvent) {
  if (f.extension === "md") ctx.openInTab ? ctx.openInTab(f.path, !!e && (e.metaKey || e.ctrlKey)) : void ctx.plugin.openObject(f.path);
  else void ctx.plugin.openFile(f);
}

function distinctValues(ctx: ObjPageCtx, type: ObjectType | null, key: string): string[] {
  if (!type) return [];
  const seen = new Set<string>();
  for (const o of objectsOfType(ctx.plugin, type)) {
    const v = ctx.app.metadataCache.getFileCache(o)?.frontmatter?.[key];
    for (const item of Array.isArray(v) ? v : [v]) {
      if (item === undefined || item === "" || item === null) continue;
      seen.add(String(item));
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

function propLabel(app: App, value: unknown, from: string): string {
  const t = resolveLink(app, String(value), from);
  return t ? title(app, t) : String(value).replace(/\[\[|\]\]/g, "").replace(/^https?:\/\//i, "");
}

function propRow(ctx: ObjPageCtx, parent: HTMLElement, prop: PropDef, value: unknown, types: ObjectType[], type: ObjectType | null): HTMLElement {
  const { app, file: f } = ctx;
  const row = parent.createDiv({ cls: "vtr-objects-prow" });
  const keyEl = row.createSpan({ cls: "vtr-objects-pk" });
  keyEl.createSpan({ text: prop.key });
  const cell = row.createDiv({ cls: "vtr-objects-pv" });
  const isEmpty = value === undefined || value === "" || value === null;
  const save = (v: string | number | undefined) => void setField(app, f, prop.key, v).then(ctx.rerender);

  if (prop.kind === "link" || prop.kind === "links") {
    const multi = prop.kind === "links";
    const byName = (a: unknown, b: unknown) => String(a).localeCompare(String(b));
    const vals = (Array.isArray(value) ? [...value] : value !== undefined && value !== "" ? [value] : []).sort(byName);
    const writeLinks = (next: string[]) =>
      multi
        ? void app.fileManager.processFrontMatter(f, (fm) => {
            const sorted = [...next].sort(byName);
            if (sorted.length) fm[prop.key] = sorted; else delete fm[prop.key];
          }).then(ctx.rerender)
        : save(next[0]);
    const pick = (replacing?: unknown) =>
      new NotePickerModal(app, (t) => {
        const link = `[[${app.metadataCache.fileToLinktext(t, f.path)}]]`;
        writeLinks(replacing === undefined ? [...vals.map(String), link] : vals.map((v) => (v === replacing ? link : String(v))));
      }, `Pick a note for ${prop.key}`).open();

    const linkLabel = (v: unknown) => propLabel(app, v, f.path);
    const choose = (e: MouseEvent, replacing?: unknown) => {
      const menu = new Menu();
      const used = distinctValues(ctx, type, prop.key).filter((o) => !vals.some((v) => String(v) === o));
      for (const o of used)
        menu.addItem((i) =>
          i.setTitle(linkLabel(o)).onClick(() =>
            writeLinks(replacing === undefined ? [...vals.map(String), o] : vals.map((v) => (v === replacing ? o : String(v))))));
      if (used.length) menu.addSeparator();
      menu.addItem((i) => i.setTitle("Search…").setIcon("search").onClick(() => pick(replacing)));
      menu.showAtMouseEvent(e);
    };

    for (const v of vals) {
      const target = resolveLink(app, v, f.path);
      const chip = cell.createSpan({ cls: "vtr-objects-ref" });
      const linkType = target ? typeOrPage(ctx.plugin, target, types) : null;
      if (linkType) {
        chip.style.setProperty("--hue", linkType.hue);
        setIcon(chip.createSpan({ cls: "vtr-objects-ref-i" }), linkType.icon);
      } else chip.createSpan({ cls: "vtr-objects-ref-d" });
      chip.createSpan({ text: linkLabel(v) });
      const chipMenu = (e: MouseEvent) => {
        e.preventDefault();
        const menu = new Menu();
        if (target) menu.addItem((i) => i.setTitle("Open").setIcon("arrow-right").onClick(() => openFileOrObject(ctx, target, types)));
        menu.addItem((i) => i.setTitle("Change…").setIcon("search").onClick(() => choose(e, v)));
        if (multi) menu.addItem((i) => i.setTitle("Add another…").setIcon("plus").onClick(() => choose(e)));
        menu.addItem((i) => i.setTitle(multi ? "Remove" : "Clear").setIcon("x").onClick(() => writeLinks(vals.filter((x) => x !== v).map(String))));
        menu.showAtMouseEvent(e);
      };
      if (target) chip.onclick = (e) => openFileOrObject(ctx, target, types, e);
      else chip.onclick = chipMenu;
      chip.oncontextmenu = chipMenu;
    }
    if (vals.length > 1) {
      keyEl.createSpan({ cls: "vtr-objects-pk-c", text: String(vals.length) });
      setIcon(keyEl.createSpan({ cls: "vtr-objects-pk-chev" }), "chevron-down");
      keyEl.onclick = () => row.toggleClass("is-collapsed", !row.hasClass("is-collapsed"));
    }
    if (!vals.length) {
      const empty = cell.createSpan({ cls: "vtr-objects-ppill is-link is-empty" });
      setIcon(empty.createSpan({ cls: "vtr-objects-ppill-i" }), "link");
      empty.createSpan({ text: "Empty" });
      empty.onclick = (e) => choose(e);
    } else if (multi) {
      const add = cell.createSpan({ cls: "vtr-objects-ref is-add", attr: { "aria-label": `Add ${prop.key}` } });
      setIcon(add.createSpan({ cls: "vtr-objects-ref-i" }), "plus");
      add.onclick = (e) => choose(e);
    }
    return row;
  }
  if (prop.kind === "check") {
    const box = cell.createEl("input", { type: "checkbox" });
    box.checked = value === true;
    box.onchange = () => void app.fileManager.processFrontMatter(f, (fm) => { fm[prop.key] = box.checked; });
    return row;
  }
  if (prop.kind === "select" || prop.kind === "list") {
    const vals = asList(value);
    const opts =
      prop.kind === "list"
        ? [...new Set([...distinctValues(ctx, type, prop.key), ...vals])].sort((a, b) => a.localeCompare(b))
        : selectOptions(prop.options, value);
    const write = (next: string[]) =>
      void app.fileManager.processFrontMatter(f, (fm) => {
        if (next.length) fm[prop.key] = next; else delete fm[prop.key];
      }).then(ctx.rerender);
    const pick = (e: MouseEvent) => {
      const menu = new Menu();
      for (const o of opts)
        menu.addItem((i) =>
          i.setTitle(o).setChecked(vals.includes(o)).onClick(() => write(toggleSelect(opts, vals, o))));
      if (prop.kind === "list")
        menu.addItem((i) =>
          i.setTitle("New…").setIcon("plus").onClick(async () => {
            const v = await promptText(app, `New ${prop.key}`);
            if (v) write([...vals, v]);
          }));
      menu.showAtMouseEvent(e);
    };
    for (const v of vals) {
      const chip = cell.createSpan({ cls: "vtr-objects-ref" });
      chip.createSpan({ cls: "vtr-objects-ref-d" });
      chip.createSpan({ text: v });
      chip.onclick = pick;
    }
    const add = cell.createSpan({ cls: "vtr-objects-ref is-add", attr: { "aria-label": `Edit ${prop.key}` } });
    if (vals.length) setIcon(add.createSpan({ cls: "vtr-objects-ref-i" }), "plus");
    else add.createSpan({ text: "Empty" });
    add.onclick = pick;
    return row;
  }
  const pill = cell.createSpan({ cls: `vtr-objects-ppill is-${prop.kind}${isEmpty ? " is-empty" : ""}` });
  if (prop.kind === "date") setIcon(pill.createSpan({ cls: "vtr-objects-ppill-i" }), "calendar");
  const label = isEmpty ? "Empty" : prop.kind === "date" ? moment(String(value).slice(0, 10)).format("MMM D, YYYY") : propLabel(app, value, f.path);
  pill.createSpan({ text: label });
  const isUrl = typeof value === "string" && /^https?:\/\//i.test(value);
  const chev = prop.kind === "text" && !isUrl ? pill.createSpan({ cls: "vtr-objects-ppill-c" }) : null;
  if (chev) setIcon(chev, "chevron-down");
  if (prop.kind === "formula") return row;

  if (prop.kind === "date" || prop.kind === "number") {
    pill.onclick = () => {
      const inp = cell.createEl("input", { cls: "vtr-objects-input", type: prop.kind === "date" ? "date" : "number" });
      inp.value = isEmpty ? "" : String(value).slice(0, prop.kind === "date" ? 10 : undefined);
      pill.replaceWith(inp);
      inp.focus();
      (inp as unknown as { showPicker?: () => void }).showPicker?.();
      const timeSuffix = prop.kind === "date" && !isEmpty ? String(value).slice(10) : "";
      const commit = () => save(prop.kind === "number" ? (inp.value.trim() ? Number(inp.value) : undefined) : inp.value ? inp.value + timeSuffix : undefined);
      inp.onchange = commit;
      inp.onblur = commit;
      inp.onkeydown = (e) => { if (e.key === "Enter") inp.blur(); };
    };
    return row;
  }

  const editMenu = (e: MouseEvent) => {
    const menu = new Menu();
    const vals = distinctValues(ctx, type, prop.key);
    for (const v of vals) {
      menu.addItem((i) => i.setTitle(propLabel(app, v, f.path)).setChecked(!isEmpty && v === String(value)).onClick(() => save(v)));
    }
    if (vals.length) menu.addSeparator();
    if (!isEmpty) menu.addItem((i) => i.setTitle("Clear").setIcon("x").onClick(() => save(undefined)));
    menu.addItem((i) => i.setTitle("New value…").setIcon("plus").onClick(() =>
      void promptText(app, `${prop.key} value`, isEmpty ? "" : String(value)).then((v) => { if (v != null) save(v.trim() || undefined); })));
    menu.showAtMouseEvent(e);
  };
  const linked = prop.kind === "text" && !isEmpty ? resolveLink(app, value, f.path) : null;
  if (linked && chev) {
    pill.addClass("is-linked");
    pill.onclick = (e) => openFileOrObject(ctx, linked, types, e);
    chev.onclick = (e) => { e.stopPropagation(); editMenu(e); };
    pill.oncontextmenu = (e) => { e.preventDefault(); editMenu(e); };
  } else pill.onclick = editMenu;
  return row;
}

function typeMenu(ctx: ObjPageCtx, e: MouseEvent) {
  e.preventDefault();
  const { app, plugin, file: f } = ctx;
  const fmt = app.metadataCache.getFileCache(f)?.frontmatter;
  const cur = String(fmt?.object ?? fmt?.type ?? "").toLowerCase();
  const menu = new Menu();
  menu.addItem((i) => i.setTitle("Set type").setDisabled(true));
  for (const t of objectTypes(plugin).filter((t) => t.id !== "__pages")) {
    menu.addItem((i) =>
      i.setTitle(t.name).setIcon(t.icon)
        .setChecked(cur === t.id.toLowerCase() || cur === t.name.toLowerCase())
        .onClick(() => void setNoteType(ctx, t.id)),
    );
  }
  if (cur) menu.addItem((i) => i.setTitle("Clear type").setIcon("x").onClick(() => void setNoteType(ctx, null)));
  menu.showAtMouseEvent(e);
}

async function setNoteType(ctx: ObjPageCtx, id: string | null) {
  await ctx.app.fileManager.processFrontMatter(ctx.file, (fm) => {
    delete fm.type;
    if (id) fm.object = id;
    else delete fm.object;
  });
  ctx.rerender();
}

function collectionsMenu(ctx: ObjPageCtx, e: MouseEvent, type: ObjectType) {
  e.preventDefault();
  const { app, plugin, file: f } = ctx;
  const cfg = typeConfigs(plugin).find((c) => c.id === type.id);
  const menu = new Menu();
  if (!cfg) {
    menu.addItem((i) => i.setTitle("No collections").setDisabled(true));
    menu.showAtMouseEvent(e);
    return;
  }
  for (const col of collectionsOf(cfg)) {
    const inColl = inCollection(app, col, f);
    menu.addItem((i) =>
      i.setTitle(inColl ? `Remove from '${col.name}'` : `Add to '${col.name}'`)
        .setIcon(inColl ? "folder-minus" : "folder")
        .onClick(async () => {
          await setCollection(app, f, col.name, !inColl);
          ctx.rerender();
        }),
    );
  }
  menu.addItem((i) =>
    i.setTitle("New collection…").setIcon("folder-plus").onClick(async () => {
      const name = await promptText(app, "New collection");
      if (!name) return;
      (cfg.collections ??= []).push({ id: `col-${Date.now()}`, name, members: [f.path] });
      await plugin.saveSettings();
    }),
  );
  menu.showAtMouseEvent(e);
}

function tagsMenu(ctx: ObjPageCtx, e: MouseEvent, current: string[]) {
  e.preventDefault();
  const { app, file: f } = ctx;
  const write = async (name: string) => { await addTag(app, f, name); ctx.rerender(); };
  const has = new Set(current.map((t) => t.replace(/^#/, "").toLowerCase()));
  const counts: Record<string, number> = (app.metadataCache as { getTags?: () => Record<string, number> }).getTags?.() ?? {};
  const menu = new Menu();
  Object.entries(counts)
    .map(([t, n]) => [t.replace(/^#/, ""), n] as const)
    .filter(([t]) => !has.has(t.toLowerCase()) && !t.startsWith("gallery/"))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([t]) => menu.addItem((i) => i.setTitle(t).setIcon("hash").onClick(() => void write(t))));
  menu.addItem((i) =>
    i.setTitle("New tag…").setIcon("plus").onClick(async () => {
      const name = await promptText(app, "New tag");
      if (name) await write(name);
    }),
  );
  menu.showAtMouseEvent(e);
}

function customiseMenu(ctx: ObjPageCtx, e: MouseEvent, type: ObjectType) {
  e.preventDefault();
  const { app, plugin, file: f } = ctx;
  const write = async (key: string, value: unknown) => {
    await app.fileManager.processFrontMatter(f, (fm) => {
      fm[key] = value;
    });
    ctx.rerender();
  };
  const setWide = async (wide: boolean) => {
    const c = typeConfigs(plugin).find((c) => c.id === type.id);
    if (c) c.wide = wide;
    await plugin.saveSettings();
    ctx.rerender();
  };
  const menu = new Menu();
  menu.addItem((i) =>
    i.setTitle("Add Icon").setIcon("smile").onClick(async () => {
      const v = await promptText(app, "Icon or emoji");
      if (v) await write("icon", v);
    }),
  );
  menu.addItem((i) =>
    i.setTitle("Add Description").setIcon("text").onClick(async () => {
      const v = await promptText(app, "Description");
      if (v) await write("description", v);
    }),
  );
  menu.addItem((i) =>
    i.setTitle("Add Aliases").setIcon("at-sign").onClick(async () => {
      const v = await promptText(app, "Aliases (comma separated)");
      if (v) await write("aliases", v.split(",").map((s) => s.trim()).filter(Boolean));
    }),
  );
  menu.addItem((i) =>
    i.setTitle("Add Cover Image").setIcon("image").onClick(async () => {
      const v = await promptText(app, "Cover image URL");
      if (v) await write("cover", v);
    }),
  );
  menu.addSeparator();
  menu.addItem((i) => i.setTitle("Normal Layout").setChecked(!type.wide).onClick(() => void setWide(false)));
  menu.addItem((i) => i.setTitle("Wide Layout").setChecked(type.wide).onClick(() => void setWide(true)));
  menu.showAtMouseEvent(e);
}

async function moreMenu(ctx: ObjPageCtx, e: MouseEvent, type: ObjectType, compact: boolean) {
  e.preventDefault();
  const ax = e.clientX;
  const ay = e.clientY;
  const { app, plugin, file: f } = ctx;
  const raw = await app.vault.cachedRead(f);
  const body = raw.replace(/^---\n[\s\S]*?\n---\n*/, "");
  const stats: [string, string][] = [
    ["Words", ((body.match(/\S+/g) ?? []).length).toLocaleString()],
    ["Sentences", ((body.match(/[.!?]+(?:\s|$)/g) ?? []).length).toLocaleString()],
    ["Paragraphs", (body.split(/\n\s*\n/).filter((s) => s.trim()).length).toLocaleString()],
    ["Characters", (body.length).toLocaleString()],
  ];
  const menu = new Menu();
  if (!compact) {
    menu.addItem((i) => i.setTitle("Customise").setIcon("palette").onClick((ev) => customiseMenu(ctx, ev as MouseEvent, type)));
    menu.addItem((i) => i.setTitle("Edit collections").setIcon("folder").onClick((ev) => collectionsMenu(ctx, ev as MouseEvent, type)));
    menu.addSeparator();
  }
  menu.addItem((i) => i.setTitle("Change type").setIcon("shapes").onClick((ev) => typeMenu(ctx, ev as MouseEvent)));
  menu.addItem((i) =>
    i.setTitle("Object type settings").setIcon("settings").onClick(() => void plugin.openObjects(type.id)),
  );
  menu.addSeparator();
  menu.addItem((i) => i.setTitle("Share card").setIcon("image-down").onClick(() => new ShareCardModal(plugin, [f]).open()));
  menu.addSeparator();
  menu.addItem((i) => i.setTitle("Open in editor").setIcon("pencil").onClick(() => void plugin.openFile(f)));
  if (ctx.onOpenTab) menu.addItem((i) => i.setTitle("Open in new tab").setIcon("external-link").onClick(() => ctx.onOpenTab?.()));
  menu.addSeparator();
  menu.addItem((i) =>
    i.setTitle("Text Stats").setIcon("bar-chart-2").onClick(() => {
      const dates: [string, string][] = [
        ["Created At", moment(f.stat.ctime).format("D MMM YYYY, hh:mm A")],
        ["Last Updated", moment(f.stat.mtime).format("D MMM YYYY, hh:mm A")],
      ];
      textStatsCard(ax, ay, stats, dates);
    }),
  );
  menu.addSeparator();
  menu.addItem((i) =>
    i.setTitle("Duplicate").setIcon("copy").onClick(async () => {
      const copy = await app.vault.copy(f, f.path.replace(/\.md$/, " copy.md"));
      void plugin.openObject(copy.path);
    }),
  );
  menu.addSeparator();
  menu.addItem((i) =>
    i.setTitle("Remove note").setIcon("trash-2").onClick(async () => {
      if (!confirm(`Move "${title(app, f)}" to trash?`)) return;
      await app.fileManager.trashFile(f);
      ctx.onClose?.();
    }),
  );
  if (ctx.onClose) menu.addItem((i) => i.setTitle("Close").setIcon("x").onClick(() => ctx.onClose?.()));
  menu.showAtMouseEvent(e);
}

function textStatsCard(x: number, y: number, stats: [string, string][], dates: [string, string][]) {
  document.querySelectorAll(".vtr-objects-statcard").forEach((el) => el.remove());
  const card = document.body.createDiv({ cls: "vtr-objects-statcard" });
  const row = (label: string, value: string, muted: boolean) => {
    const r = card.createDiv({ cls: `vtr-objects-statrow${muted ? " is-muted" : ""}` });
    r.createSpan({ cls: "vtr-objects-statk", text: label });
    r.createSpan({ cls: "vtr-objects-statv", text: value });
  };
  for (const [k, v] of stats) row(k, v, false);
  card.createDiv({ cls: "vtr-objects-statsep" });
  for (const [k, v] of dates) row(k, v, true);
  card.style.top = `${Math.min(Math.max(12, y + 8), window.innerHeight - 220)}px`;
  card.style.right = `${Math.min(Math.max(12, window.innerWidth - x), window.innerWidth - 60)}px`;
  const close = (ev: MouseEvent) => {
    if (card.contains(ev.target as Node)) return;
    card.remove();
    document.removeEventListener("mousedown", close, true);
  };
  window.setTimeout(() => document.addEventListener("mousedown", close, true), 0);
}

export class ObjectPageView extends ItemView {
  private path = "";

  constructor(leaf: WorkspaceLeaf, private plugin: VitrinePlugin) {
    super(leaf);
  }

  getViewType() {
    return VIEW_OBJECT_PAGE;
  }
  getDisplayText() {
    const f = this.file();
    return f ? title(this.app, f) : "Object";
  }
  getIcon() {
    const f = this.file();
    const t = f ? typeOf(this.plugin, f, objectTypes(this.plugin)) : null;
    return t?.icon ?? "box";
  }

  async setState(state: { path?: string }, result: ViewStateResult) {
    if (state?.path) this.path = state.path;
    this.render();
    return super.setState(state, result);
  }
  getState() {
    return { path: this.path };
  }

  async onOpen() {
    this.registerEvent(this.plugin.onIndexChanged(() => this.render()));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.render()));
    this.render();
  }

  private file(): TFile | null {
    const f = this.app.vault.getAbstractFileByPath(this.path);
    return f instanceof TFile ? f : null;
  }

  private render() {
    const root = mountView(this, this.plugin.settings);
    const shell = root.createDiv({ cls: "vtr-objects vtr-objects-solo" });
    const f = this.file();
    if (!f) {
      const box = shell.createDiv({ cls: "vtr-objects-page" }).createDiv({ cls: "vtr-objects-emptystate" });
      setIcon(box.createDiv({ cls: "vtr-objects-empty-icon" }), "box");
      box.createDiv({ cls: "vtr-objects-empty-title", text: "Note not found" });
      return;
    }
    renderObjectPage(shell, {
      app: this.app,
      plugin: this.plugin,
      component: this,
      file: f,
      rerender: () => this.render(),
      onClose: () => this.leaf.detach(),
    });
  }

  async onClose() {
    this.contentEl.empty();
  }
}
