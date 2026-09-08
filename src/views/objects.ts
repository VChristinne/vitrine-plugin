import { ItemView, Menu, Notice, ViewStateResult, WorkspaceLeaf, TFile, moment, setIcon, getAllTags } from "obsidian";
import { mountView, objectSurface } from "../render/theme";
import { renderCalendar } from "../objects/calendar";
import type { CalView } from "../objects/calendar";
import { NewObjectModal } from "../modals/new-object";
import { adopt, candidates, matches, release, renameCheck, type AdoptBy } from "../objects/adopt";
import { WeblinkModal } from "../modals/weblink";
import { promptText } from "../modals/prompt";
import { ensureFolder, freePath, safeName } from "../paths";
import { setCollection } from "../model/frontmatter";
import { PaletteModal } from "../modals/palette";
import { ShareCardModal } from "../modals/share-card";
import { IconPickerModal } from "../modals/icon-picker";
import { evalQuery, filterValues, queriesFor, scopeTo, sortValue, QUERY_OPS, type QuerySpec, type QueryOp } from "../objects/query";
import { renderTaskRow } from "../objects/task-row";
import { createTask, parseTaskInput, importAllCheckboxes, STATUS_ORDER, PRIORITY_ORDER } from "../objects/task-create";
import type { RecurRule } from "../objects/task-recur";
import {
  objectTypes,
  objectsOfType,
  typeOf,
  resolveLink,
  title,
  renameObject,
  notePropDefs,
  effectiveProps,
  scopeProps,
  scopeFiles,
  derivedValue,
  previewText,
  typeConfigs,
  templateNotes,
  templatePaths,
  templatesForType,
  collectionOf,
  collectionsOf,
  declaredType,
  pluralName,
  inCollection,
  hueFor,
  TYPE_HUES,
  PROP_KINDS,
  cleanValue,
  type ObjectType,
  type PropDef,
} from "../objects/model";
import type { ObjectTypeConfig, ObjectPropKind, ObjectCollection } from "../types";
import type VitrinePlugin from "../main";
import { renderObjectPage } from "./object-page";

export const VIEW_OBJECTS = "vitrine-objects";

const CARD_BUILTINS: { key: string; label: string; icon: string }[] = [
  { key: "__preview", label: "Content preview", icon: "align-left" },
  { key: "__collections", label: "Collections", icon: "folder" },
  { key: "__tags", label: "Tags", icon: "tag" },
  { key: "__cover", label: "Cover image", icon: "image" },
  { key: "__updated", label: "Last updated", icon: "clock" },
  { key: "__created", label: "Created at", icon: "calendar" },
];

const LINK_VIEWS: ["link" | "inline" | "small" | "wide" | "embed", string, string][] = [
  ["link", "Link block", "link"],
  ["inline", "Inline", "text"],
  ["small", "Small card", "credit-card"],
  ["wide", "Wide card", "id-card"],
  ["embed", "Embed", "layout"],
];

type Screen = "collection" | "object" | "calendar" | "structure" | "type" | "collection-edit" | "query";

export interface ObjectsState extends Record<string, unknown> {
  screen: Screen;
  typeId: string;
  objPath: string;
  tabs: string[];
  collView: "cards" | "list";
  collTab: string;
  collectionId: string;
  navOpen: string[];
  editCollId: string;
  filtering: boolean;
  filter: string;
  sortField: string;
  sortDir: "asc" | "desc";
  groupBy: string;
  hideDetails: boolean;
  previewPath: string;
  calDate: string;
  calView: CalView;
  calMini: boolean;
  sideCollapsed: boolean;
}

export class ObjectsView extends ItemView {
  private state: ObjectsState = {
    screen: "collection",
    typeId: "",
    objPath: "",
    tabs: [],
    collView: "cards",
    collTab: "all",
    collectionId: "",
    navOpen: [],
    editCollId: "",
    filtering: false,
    filter: "",
    sortField: "title",
    sortDir: "asc",
    groupBy: "",
    hideDetails: false,
    previewPath: "",
    calDate: "",
    calView: "day",
    calMini: true,
    sideCollapsed: false,
  };

  private typeTab: Record<string, string> = {};
  private adoptBy: AdoptBy = "folder";
  private adoptValue = "";
  private adoptSkip = new Set<string>();
  private lastAdopt: { paths: string[]; type: string } | null = null;
  private pendingQueryFilter = false;
  private pendingSubpath: string | undefined;
  private pendingQuickAddFocus = false;

  constructor(leaf: WorkspaceLeaf, private plugin: VitrinePlugin) {
    super(leaf);
  }

  getViewType() {
    return VIEW_OBJECTS;
  }
  getDisplayText() {
    return "Objects";
  }
  getIcon() {
    return "box";
  }

  async setState(state: ObjectsState, result: ViewStateResult) {
    if (state?.screen) this.state = { ...this.state, ...state, calView: "day" };
    this.render();
    return super.setState(state, result);
  }
  getState() {
    return this.state;
  }

  async onOpen() {
    this.registerEvent(this.plugin.onIndexChanged(() => this.render()));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.render()));
    this.registerEvent(this.app.workspace.on("css-change", () => this.render()));
    this.render();
  }

  private types(): ObjectType[] {
    return objectTypes(this.plugin);
  }

  private lastSig = "";

  private picking: Set<string> | null = null;
  private shown: string[] = [];

  render() {
    const prevScroll = this.contentEl.querySelector<HTMLElement>(".vtr-objects-main")?.scrollTop ?? 0;
    const sig = `${this.state.screen}|${this.state.typeId}|${this.state.collTab}|${this.state.collectionId}`;

    const root = mountView(this, this.plugin.settings);
    const types = this.types();
    if (!this.state.typeId && types.length) this.state.typeId = types[0].id;

    let previewFile: TFile | null = null;
    if (this.state.previewPath) {
      const f = this.app.vault.getAbstractFileByPath(this.state.previewPath);
      if (f instanceof TFile) previewFile = f;
      else this.state.previewPath = "";
    }
    const previewActive = previewFile !== null;

    const shell = root.createDiv({ cls: `vtr-objects${previewActive ? " has-preview" : ""}${this.state.sideCollapsed ? " is-sidecollapsed" : ""}` });
    const surface = objectSurface(this.plugin.settings);
    shell.dataset.vtrSurface = surface;
    if (surface !== "obsidian") shell.dataset.vtrNeu = "1";
    this.renderTopBar(shell, types);
    const body = shell.createDiv({ cls: "vtr-objects-body" });
    this.renderSidebar(body, types);
    const main = body.createDiv({ cls: "vtr-objects-main" });
    if (this.picking) this.renderPickBar(main);

    if (!types.length) {
      this.empty(main, "box", "No object types", "Create a template note (with status: template) and Vitrine turns it into an object type.");
      return;
    }
    if (this.state.screen === "structure") this.renderStructure(main);
    else if (this.state.screen === "type") this.renderTypeEditor(main);
    else if (this.state.screen === "collection-edit") this.renderCollectionEditor(main);
    else if (this.state.screen === "object") this.renderObjectColumn(main);
    else if (this.state.screen === "calendar") this.renderCalendarScreen(main);
    else this.renderCollection(main, types);

    if (sig === this.lastSig) main.scrollTop = prevScroll;
    this.lastSig = sig;

    if (previewFile) {
      const panel = body.createDiv({ cls: "vtr-objects-preview" });
      renderObjectPage(panel, {
        app: this.app,
        plugin: this.plugin,
        component: this,
        file: previewFile,
        rerender: () => this.render(),
        compact: true,
        onOpenTab: () => { const p = this.state.previewPath; this.go({ previewPath: "" }); this.openTab(p); },
        onClose: () => this.go({ previewPath: "" }),
      });
    }
  }

  private renderCalendarScreen(main: HTMLElement) {
    renderCalendar(main, {
      plugin: this.plugin,
      date: this.state.calDate || moment().format("YYYY-MM-DD"),
      view: this.state.calView,
      mini: this.state.calMini,
      setState: (patch) =>
        this.go({
          ...(patch.date !== undefined ? { calDate: patch.date } : {}),
          ...(patch.view !== undefined ? { calView: patch.view } : {}),
          ...(patch.mini !== undefined ? { calMini: patch.mini } : {}),
        }),
      open: (path) => this.openTab(path),
      create: (typeId, date) => void this.createDated(typeId, date),
    });
  }

  private async createDated(typeId: string, date: string) {
    const type = this.types().find((t) => t.id === typeId);
    if (!type) return;
    const yaml = (v: string) => (/^[\w .\-/]+$/.test(v) ? v : JSON.stringify(v));
    const safe = `${type.name} ${date}`.replace(/[\\/:*?"<>|]/g, "-").trim();
    let name = safe;
    for (let i = 2; this.app.vault.getAbstractFileByPath(`${name}.md`); i++) name = `${safe} ${i}`;
    const file = await this.app.vault.create(`${name}.md`, ["---", `type: ${yaml(type.name)}`, `date: ${date}`, "---", ""].join("\n"));
    this.openTab(file.path);
  }

  private renderObjectColumn(main: HTMLElement) {
    const f = this.app.vault.getAbstractFileByPath(this.state.objPath);
    if (!(f instanceof TFile)) {
      this.go({ screen: "collection" });
      return;
    }
    const subpath = this.pendingSubpath ?? (this.state.objSubpath as string | undefined);
    this.pendingSubpath = undefined;
    this.state.objSubpath = undefined;
    renderObjectPage(main, {
      app: this.app,
      plugin: this.plugin,
      component: this,
      file: f,
      subpath,
      rerender: () => this.render(),
      onBack: () => this.go({ screen: "collection" }),
      onPin: () => this.go({ screen: "collection", previewPath: f.path }),
      onOpenTab: () => this.openTab(f.path),
      openInTab: (p, bg) => this.openTab(p, undefined, bg),
    });
  }

  private renderTopBar(shell: HTMLElement, types: ObjectType[]) {
    const bar = shell.createDiv({ cls: "vtr-objects-topbar" });
    const cmd = (id: string) => (this.app as unknown as { commands: { executeCommandById(id: string): void } }).commands.executeCommandById(id);
    const iconBtn = (parent: HTMLElement, icon: string, label: string, fn: (e: MouseEvent) => void) => {
      const b = parent.createDiv({ cls: "vtr-objects-topbtn" });
      setIcon(b, icon);
      b.setAttr("aria-label", label);
      b.onclick = fn;
      return b;
    };

    const left = bar.createDiv({ cls: "vtr-objects-topleft" });
    const uni = left.createDiv({ cls: "vtr-objects-universe" });
    setIcon(uni.createSpan({ cls: "vtr-objects-universe-i" }), "box");
    uni.createSpan({ cls: "vtr-objects-universe-n", text: this.app.vault.getName() });
    setIcon(uni.createSpan({ cls: "vtr-objects-universe-c" }), "chevrons-up-down");
    uni.setAttr("aria-label", "Switch vault");
    uni.onclick = () => cmd("app:open-vault");
    iconBtn(left, "panel-left", "Toggle sidebar", () => this.go({ sideCollapsed: !this.state.sideCollapsed }));

    const line = bar.createDiv({ cls: "vtr-objects-topmain" });
    const nav = line.createDiv({ cls: "vtr-objects-topnav" });
    iconBtn(nav, "chevron-left", "Back", () => this.histGo(-1));
    iconBtn(nav, "chevron-right", "Forward", () => this.histGo(1));

    if (this.state.tabs.length) {
      const strip = line.createDiv({ cls: "vtr-objects-tabs" });
      for (const p of this.state.tabs) {
        const file = this.app.vault.getAbstractFileByPath(p);
        if (!(file instanceof TFile)) continue;
        const t = typeOf(this.plugin, file, types);
        const tab = strip.createDiv({ cls: "vtr-objects-tab is-strip" });
        tab.toggleClass("is-active", this.state.screen === "object" && this.state.objPath === p);
        const lead = tab.createSpan({ cls: "vtr-objects-tab-lead" });
        const ic = lead.createSpan({ cls: `vtr-objects-ico is-small${t ? "" : " is-plain"}` });
        if (t) ic.style.setProperty("--hue", t.hue);
        setIcon(ic, t?.icon ?? "file-text");
        const x = lead.createSpan({ cls: "vtr-objects-tab-x", attr: { "aria-label": "Close tab" } });
        setIcon(x, "x");
        x.onclick = (e) => { e.stopPropagation(); this.closeTab(p); };
        tab.createSpan({ cls: "vtr-objects-tab-t", text: title(this.app, file) });
        tab.onclick = () => this.go({ screen: "object", objPath: p });
      }
    }

    const crumbs = line.createDiv({ cls: "vtr-objects-tcrumbs" });
    iconBtn(crumbs, "plus", "Search & create", () => this.openPalette());

    const right = line.createDiv({ cls: "vtr-objects-topright" });
    iconBtn(right, "panel-right", "Toggle right panel", () => cmd("app:toggle-right-sidebar"));
  }

  private renderSidebar(shell: HTMLElement, types: ObjectType[]) {
    const side = shell.createDiv({ cls: "vtr-objects-side" });

    const newRow = side.createDiv({ cls: "vtr-objects-navtop" });
    setIcon(newRow.createSpan(), "plus");
    newRow.createSpan({ text: "New" });
    newRow.onclick = (e) => this.newMenu(e, types);

    const searchRow = side.createDiv({ cls: "vtr-objects-navtop" });
    setIcon(searchRow.createSpan(), "search");
    searchRow.createSpan({ text: "Search" });
    searchRow.onclick = () => this.go({ screen: "collection", collTab: "all", filtering: true });

    const calRow = side.createDiv({ cls: `vtr-objects-navtop${this.state.screen === "calendar" ? " is-on" : ""}` });
    setIcon(calRow.createSpan(), "calendar");
    calRow.createSpan({ text: "Calendar" });
    calRow.onclick = () => this.go({ screen: "calendar", calView: "day" });

    side.createDiv({ cls: "vtr-objects-sec", text: "Object types" });
    for (const t of types) this.navRow(side, t);

    const foot = side.createDiv({ cls: "vtr-objects-foot" });
    const st = foot.createDiv({ cls: `vtr-objects-nav is-icononly${this.state.screen === "structure" || this.state.screen === "type" ? " is-on" : ""}` });
    setIcon(st.createSpan({ cls: "vtr-objects-ico is-plain" }), "settings-2");
    st.setAttr("aria-label", "Structure");
    st.onclick = () => this.go({ screen: "structure" });
  }

  private navRow(side: HTMLElement, t: ObjectType) {
    const cfg = typeConfigs(this.plugin).find((c) => c.id === t.id);
    const colls = collectionsOf(cfg);
    const here = this.state.screen === "collection" && this.state.typeId === t.id;
    const open = colls.length > 0 && this.state.navOpen.includes(t.id);
    const row = side.createDiv({ cls: `vtr-objects-nav${here && !this.state.collectionId ? " is-on" : ""}` });
    const car = row.createSpan({ cls: `vtr-objects-navcar${open ? " is-open" : ""}` });
    if (colls.length) {
      setIcon(car, "chevron-right");
      car.setAttr("aria-label", open ? "Collapse collections" : "Expand collections");
      car.onclick = (e) => {
        e.stopPropagation();
        const navOpen = open ? this.state.navOpen.filter((id) => id !== t.id) : [...this.state.navOpen, t.id];
        this.go({ navOpen });
      };
    }
    const chip = row.createSpan({ cls: "vtr-objects-ico" });
    chip.style.setProperty("--hue", t.hue);
    setIcon(chip, t.icon);
    row.createSpan({ cls: "vtr-objects-nav-t", text: pluralName(t) });
    row.createSpan({ cls: "vtr-objects-nav-c", text: String(objectsOfType(this.plugin, t).length) });
    if (t.id === "__task") {
      const add = row.createSpan({ cls: "vtr-objects-nav-add", attr: { "aria-label": "New task" } });
      setIcon(add, "plus");
      add.onclick = async (e) => {
        e.stopPropagation();
        const text = await promptText(this.app, "New task", "Prepare report !! tomorrow 2pm");
        if (text) { await createTask(this.plugin, parseTaskInput(text)); this.render(); }
      };
    }
    row.onclick = () =>
      this.go({
        screen: "collection",
        typeId: t.id,
        collTab: "overview",
        collectionId: "",
        navOpen: colls.length ? [...new Set([...this.state.navOpen, t.id])] : this.state.navOpen,
      });

    if (!open || !cfg) return;
    const objects = objectsOfType(this.plugin, t);
    for (const c of colls) {
      const sub = side.createDiv({ cls: `vtr-objects-nav is-sub${here && this.state.collectionId === c.id ? " is-on" : ""}` });
      setIcon(sub.createSpan({ cls: "vtr-objects-navf" }), "folder");
      sub.createSpan({ cls: "vtr-objects-nav-t", text: c.name });
      sub.createSpan({ cls: "vtr-objects-nav-c", text: String(objects.filter((f) => inCollection(this.app, c, f)).length) });
      sub.onclick = () => this.go({ screen: "collection", typeId: t.id, collectionId: c.id, collTab: "all" });
      sub.oncontextmenu = (e) => this.collectionMenu(e, cfg, c.id);
    }
  }

  private newMenu(e: MouseEvent, types: ObjectType[]) {
    const menu = new Menu();
    for (const t of types) menu.addItem((i) => i.setTitle(`New ${t.name}`).setIcon(t.icon).onClick(() => this.openNew(t)));
    menu.showAtMouseEvent(e);
  }

  private openPalette() {
    new PaletteModal(this.plugin, {
      open: (path) => this.openTab(path),
      openCalendar: () => this.go({ screen: "calendar", calView: "day" }),
      create: (t) => this.openNew(t),
    }).open();
  }

  private renderQueryResults(main: HTMLElement, spec: QuerySpec, type: ObjectType, matched?: TFile[]) {
    const files = matched ?? evalQuery(this.plugin, spec);
    if (!files.length) { this.empty(main, spec.icon || "filter", "No matches", "Nothing matches this query yet."); return; }
    if (spec.groupBy) {
      const saved = this.state.groupBy;
      this.state.groupBy = spec.groupBy;
      const groups = new Map<string, TFile[]>();
      for (const f of files) {
        const k = this.groupKey(f);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(f);
      }
      this.state.groupBy = saved;
      for (const [k, fs] of groups) this.renderObjects(this.sectionHead(main, k, fs.length).body, fs, type);
    } else {
      this.renderObjects(main, files, type);
    }
  }

  private rerenderQuery(main: HTMLElement, spec: QuerySpec, type: ObjectType, count: HTMLElement) {
    const box = main.querySelector<HTMLElement>(".vtr-objects-qresults");
    if (!box) return;
    const files = evalQuery(this.plugin, spec);
    box.empty();
    this.renderQueryResults(box, spec, type, files);
    count.setText(`# ${files.length}`);
  }

  private queriesForType(type: ObjectType, coll?: ObjectCollection): QuerySpec[] {
    return queriesFor(this.plugin.settings.queries ?? [], type.id, coll?.name);
  }

  private async newQueryForType(type: ObjectType, coll?: ObjectCollection) {
    const spec: QuerySpec = { id: `q-${Date.now()}`, name: "New query", icon: "filter", typeIds: [type.id], filters: [], collection: coll?.name };
    this.plugin.settings.queries = [...(this.plugin.settings.queries ?? []), spec];
    await this.plugin.saveSettings();
    this.pendingQueryFilter = true;
    this.go({ collTab: `q:${spec.id}` });
  }
  private queryTabMenu(e: MouseEvent, spec: QuerySpec) {
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("Rename").setIcon("pencil").onClick(() => {
      promptText(this.app, "Query name", spec.name).then((name) => {
        if (name == null) return;
        spec.name = name.trim() || "Query";
        void this.saveSpec();
      });
    }));
    menu.addItem((i) => i.setTitle("Icon").setIcon("shapes").onClick(() =>
      new IconPickerModal(this.app, (n) => { spec.icon = n; void this.saveSpec(); }).open()));
    menu.addItem((i) => i.setTitle("Delete query").setIcon("trash-2").onClick(() => void this.deleteQuery(spec.id)));
    menu.showAtMouseEvent(e);
  }
  private saveSpec() { void this.plugin.saveSettings(); this.render(); }
  private reorderQuery(dragId: string, targetId: string) {
    const arr = this.plugin.settings.queries ?? [];
    const from = arr.findIndex((q) => q.id === dragId);
    const to = arr.findIndex((q) => q.id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    arr.splice(to, 0, arr.splice(from, 1)[0]);
    this.saveSpec();
  }
  private async deleteQuery(id: string) {
    this.plugin.settings.queries = (this.plugin.settings.queries ?? []).filter((q) => q.id !== id);
    await this.plugin.saveSettings();
    this.go({ collTab: "all" });
  }

  private enumFor(type: ObjectType, key: string): readonly string[] | undefined {
    if (type.id !== "__task") return undefined;
    if (key === "status") return STATUS_ORDER;
    if (key === "priority") return PRIORITY_ORDER;
    if (key === "__recurring") return ["yes", "no"];
    return undefined;
  }

  private propValues(type: ObjectType, key: string, coll?: string): string[] {
    const seen = new Set<string>();
    const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
    if (key === "__tags") {
      for (const f of scopeFiles(this.plugin, type, coll)) {
        for (const tag of getAllTags(this.app.metadataCache.getFileCache(f) ?? {}) ?? []) seen.add(tag);
      }
      return [...seen].sort(byName);
    }
    if (key.startsWith("__")) return [];
    const kind = scopeProps(this.plugin, type, coll).find((p) => p.key === key)?.kind;
    if (!kind || kind === "number" || kind === "date" || kind === "check" || kind === "formula") return [];
    for (const f of scopeFiles(this.plugin, type, coll)) {
      const v = this.app.metadataCache.getFileCache(f)?.frontmatter?.[key];
      for (const x of Array.isArray(v) ? v : [v]) {
        if (x == null || x === "" || typeof x === "object") continue;
        seen.add(cleanValue(x));
        if (seen.size > 60) return [];
      }
    }
    return [...seen].sort(byName);
  }

  private queryFilterPop(anchor: HTMLElement, spec: QuerySpec, type: ObjectType, live: () => void, collName?: string) {
    const commit = () => { void this.plugin.saveQuiet(); live(); };
    this.popover(anchor, (panel) => {
      panel.addClass("vtr-query-pop");
      const draw = () => {
        panel.empty();

        const colls = collectionsOf(typeConfigs(this.plugin).find((c) => c.id === type.id)).map((c) => c.name);
        if (colls.length) {
          panel.createDiv({ cls: "vtr-objects-pop-h", text: "Scope" });
          const collRow = panel.createDiv({ cls: "vtr-query-pop-list" }).createDiv({ cls: "vtr-query-pop-row" });
          this.queryPill(collRow, spec.collection || "Any collection", [["", "Any collection"], ...colls.map((c) => [c, c] as [string, string])],
            (v) => { spec.collection = v || undefined; commit(); draw(); },
            new Set(spec.collection ? [spec.collection] : []));
        }

        panel.createDiv({ cls: "vtr-objects-pop-h", text: "Filters" });
        const scope = spec.collection ?? collName;
        const fields = this.filterFields(type, scope);
        const list = panel.createDiv({ cls: "vtr-query-pop-list" });
        for (const flt of spec.filters) {
          const row = list.createDiv({ cls: "vtr-query-pop-row" });
          const fieldLabel = fields.find((f) => f.key === flt.key)?.label ?? flt.key;
          this.queryPill(row, fieldLabel, fields.map((f) => [f.key, f.label]), (v) => {
            flt.key = v;
            const en = this.enumFor(type, v);
            flt.op = en ? "is" : "contains";
            flt.value = en ? en[0] : "";
            commit(); draw();
          });
          this.queryPill(row, QUERY_OPS.find((o) => o.op === flt.op)?.label ?? flt.op, QUERY_OPS.map((o) => [o.op, o.label]), (v) => {
            flt.op = v as QueryOp; commit(); draw();
          });
          if (flt.op !== "empty" && flt.op !== "notempty") {
            const cmp = flt.op === "gt" || flt.op === "lt";
            const opts = cmp ? [] : this.enumFor(type, flt.key) ?? this.propValues(type, flt.key, scope);
            const sel = filterValues(flt);
            if (opts.length) {
              this.queryPill(row, sel.join(", ") || "value", opts.map((v) => [v, v]), (v) => {
                flt.value = (sel.includes(v) ? sel.filter((x) => x !== v) : [...sel, v]).join("\n");
                commit(); draw();
              }, new Set(sel)).addClass("is-val");
            } else {
              const val = row.createEl("input", { cls: "vtr-query-pop-val", type: "text", attr: { placeholder: "value" } });
              val.value = flt.value ?? "";
              val.oninput = () => { flt.value = val.value; commit(); };
            }
          }
          const del = row.createSpan({ cls: "vtr-query-pop-del", attr: { "aria-label": "Remove filter" } });
          setIcon(del, "x");
          del.onclick = () => { spec.filters = spec.filters.filter((f) => f !== flt); commit(); draw(); };
        }
        const add = panel.createDiv({ cls: "vtr-query-pop-add" });
        setIcon(add.createSpan(), "plus");
        add.createSpan({ text: "Add filter" });
        add.onclick = () => {
          const first = fields[0]?.key ?? "__tags";
          const en = this.enumFor(type, first);
          spec.filters.push({ key: first, op: en ? "is" : "contains", value: en ? en[0] : "" });
          commit(); draw();
        };

        const lim = panel.createDiv({ cls: "vtr-query-pop-limit" });
        lim.createSpan({ text: "Limit" });
        const li = lim.createEl("input", { cls: "vtr-query-pop-val", type: "number", attr: { min: "1", placeholder: "all" } });
        li.value = spec.limit ? String(spec.limit) : "";
        li.oninput = () => { spec.limit = Number(li.value) > 0 ? Number(li.value) : undefined; commit(); };
      };
      draw();
    });
  }

  private queryPill(parent: HTMLElement, label: string, opts: [string, string][], onPick: (v: string) => void, checked?: Set<string>) {
    const p = parent.createSpan({ cls: "vtr-query-pill" });
    p.createSpan({ text: label });
    setIcon(p.createSpan({ cls: "vtr-query-pill-c" }), "chevron-down");
    p.onclick = (e) => {
      const menu = new Menu();
      for (const [v, l] of opts) menu.addItem((i) => {
        i.setTitle(l).onClick(() => onPick(v));
        if (checked) i.setChecked(checked.has(v));
      });
      menu.showAtMouseEvent(e);
    };
    return p;
  }

  private querySortPop(anchor: HTMLElement, spec: QuerySpec, type: ObjectType, live: () => void, collName?: string) {
    const commit = () => { void this.plugin.saveQuiet(); live(); };
    this.popover(anchor, (panel) => {
      panel.addClass("vtr-query-pop");
      const draw = () => {
        panel.empty();
        panel.createDiv({ cls: "vtr-objects-pop-h", text: "Sort by" });
        const rules = spec.sort ?? [];
        const fields = this.fieldList(type, spec.collection ?? collName);
        const list = panel.createDiv({ cls: "vtr-query-pop-list" });
        rules.forEach((r, i) => {
          const row = list.createDiv({ cls: "vtr-query-pop-row" });
          row.createSpan({ cls: "vtr-query-pop-n", text: `${i + 1}.` });
          this.queryPill(row, fields.find((f) => f.key === r.field)?.label ?? r.field, fields.map((f) => [f.key, f.label]),
            (v) => { r.field = v; commit(); draw(); });
          this.queryPill(row, r.dir === "asc" ? "Ascending" : "Descending", [["asc", "Ascending"], ["desc", "Descending"]],
            (v) => { r.dir = v as "asc" | "desc"; commit(); draw(); }).addClass("is-val");
          const del = row.createSpan({ cls: "vtr-query-pop-del", attr: { "aria-label": "Remove sort" } });
          setIcon(del, "x");
          del.onclick = () => {
            const left = rules.filter((_, j) => j !== i);
            spec.sort = left.length ? left : undefined;
            commit(); draw();
          };
        });
        const add = panel.createDiv({ cls: "vtr-query-pop-add" });
        setIcon(add.createSpan(), "plus");
        add.createSpan({ text: "Add sort" });
        add.onclick = () => {
          const used = new Set(rules.map((r) => r.field));
          const next = fields.find((f) => !used.has(f.key)) ?? fields[0];
          if (!next) return;
          spec.sort = [...rules, { field: next.key, dir: "asc" }];
          commit(); draw();
        };
      };
      draw();
    });
  }

  private queryGroupMenu(e: MouseEvent, spec: QuerySpec, type: ObjectType, collName?: string) {
    const menu = new Menu();
    const opt = (key: string, label: string, icon: string) =>
      menu.addItem((i) => i.setTitle(label).setIcon(icon).setChecked((spec.groupBy ?? "") === key).onClick(() => { spec.groupBy = key || undefined; this.saveSpec(); }));
    opt("", "None", "x");
    opt("folder", "Folder", "folder");
    opt("__tags", "Tags", "tag");
    opt("__collections", "Collections", "folder-open");
    for (const p of scopeProps(this.plugin, type, spec.collection ?? collName)) opt(p.key, p.key, "hash");
    menu.showAtMouseEvent(e);
  }

  private renderQuickAdd(main: HTMLElement) {
    const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    let overrideRecur: RecurRule | undefined;
    const wrap = main.createDiv({ cls: "vtr-objects-quickadd" });
    const row = wrap.createDiv({ cls: "vtr-objects-qa-row" });
    setIcon(row.createSpan({ cls: "vtr-objects-qa-i" }), "plus");
    const inp = row.createEl("input", { type: "text", attr: { placeholder: "Add a task…  e.g. Prepare report !! tomorrow 2pm due friday · weekly mon" } });
    const repeat = row.createSpan({ cls: "vtr-objects-qa-btn", attr: { "aria-label": "Repeat" } });
    setIcon(repeat.createSpan(), "repeat");
    repeat.createSpan({ text: "Repeat" });
    const preview = wrap.createDiv({ cls: "vtr-objects-qa-preview" });

    const describe = (r: RecurRule) => {
      let s = r.every > 1 ? `Every ${r.every} ${r.unit}s` : ({ day: "Daily", week: "Weekly", month: "Monthly", year: "Yearly" } as Record<string, string>)[r.unit];
      if (r.weekdays?.length) s += " · " + r.weekdays.map((d) => WD[d]).join(",");
      return s;
    };
    const chip = (icon: string, text: string, cls = "") => {
      const c = preview.createSpan({ cls: `vtr-objects-qa-chip ${cls}` });
      setIcon(c.createSpan({ cls: "vtr-objects-qa-chip-i" }), icon);
      c.createSpan({ text });
    };
    const refresh = () => {
      preview.empty();
      const raw = inp.value.trim();
      repeat.toggleClass("is-on", !!overrideRecur);
      if (!raw && !overrideRecur) { preview.hide(); return; }
      preview.show();
      const p = parseTaskInput(raw);
      const recur = overrideRecur ?? p.recur;
      if (raw && p.title) chip("chevron-right", p.title, "is-title");
      if (p.priority) chip("flag-triangle-right", p.priority, `is-pri is-${p.priority.toLowerCase()}`);
      if (p.schedule) chip("calendar", moment(String(p.schedule).slice(0, 10)).format("MMM D"), "is-sched");
      if (p.deadline) chip("flag", moment(String(p.deadline).slice(0, 10)).format("MMM D"), "is-deadline");
      if (recur) chip("repeat", describe(recur), "is-recur");
    };
    inp.oninput = refresh;
    repeat.onclick = (e) => {
      const menu = new Menu();
      const set = (r?: RecurRule) => { overrideRecur = r; refresh(); };
      const preset = (label: string, r: RecurRule) => menu.addItem((i) => i.setTitle(label).onClick(() => set(r)));
      preset("Daily", { mode: "schedule", every: 1, unit: "day" });
      preset("Weekly", { mode: "schedule", every: 1, unit: "week" });
      preset(`Weekly on ${WD[moment().day()]}`, { mode: "schedule", every: 1, unit: "week", weekdays: [moment().day()] });
      preset("Monthly", { mode: "schedule", every: 1, unit: "month" });
      preset("Yearly", { mode: "schedule", every: 1, unit: "year" });
      if (overrideRecur) { menu.addSeparator(); menu.addItem((i) => i.setTitle("Clear repeat").setIcon("x").onClick(() => set(undefined))); }
      menu.showAtMouseEvent(e);
    };
    const submit = () => {
      const raw = inp.value.trim();
      if (!raw) return;
      const p = parseTaskInput(raw);
      void createTask(this.plugin, { ...p, recur: overrideRecur ?? p.recur }).then(() => { inp.value = ""; overrideRecur = undefined; this.pendingQuickAddFocus = true; this.render(); });
    };
    inp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } };
    refresh();
    if (this.pendingQuickAddFocus) { this.pendingQuickAddFocus = false; inp.focus(); }
  }

  private renderCollection(main: HTMLElement, types: ObjectType[]) {
    const type = types.find((t) => t.id === this.state.typeId) ?? types[0];
    const objects = objectsOfType(this.plugin, type);
    const cfg = typeConfigs(this.plugin).find((c) => c.id === type.id);
    const coll = this.state.collectionId ? collectionsOf(cfg).find((c) => c.id === this.state.collectionId) : undefined;
    if (this.state.collectionId && !coll) { this.go({ collectionId: "" }); return; }
    if (coll && this.state.collTab === "overview") this.state.collTab = "all";
    const objs = coll ? objects.filter((f) => inCollection(this.app, coll, f)) : objects;
    const activeQuery = this.state.collTab.startsWith("q:")
      ? this.queriesForType(type, coll).find((q) => `q:${q.id}` === this.state.collTab)
      : undefined;

    const head = main.createDiv({ cls: "vtr-objects-chead" });
    const big = head.createSpan({ cls: "vtr-objects-ico is-big" });
    big.style.setProperty("--hue", type.hue);
    setIcon(big, coll ? "folder" : type.icon);
    head.createEl("h1", { text: coll ? coll.name : pluralName(type) });
    head.createDiv({ cls: "vtr-objects-grow" });

    const ctrls = head.createDiv({ cls: "vtr-objects-headctrls" });
    const iconBtn = (icon: string, on: boolean, label: string, onClick: (e: MouseEvent) => void) => {
      const b = ctrls.createSpan({ cls: `vtr-objects-tool${on ? " is-on" : ""}` });
      setIcon(b, icon);
      b.setAttr("aria-label", label);
      b.onclick = onClick;
    };
    iconBtn("search", this.state.filtering, "Search", () => this.go({ collTab: "all", filtering: true }));
    iconBtn(this.state.hideDetails ? "sliders-horizontal" : "chevron-up", this.state.hideDetails, this.state.hideDetails ? "Show controls" : "Hide controls", () =>
      this.go({ hideDetails: !this.state.hideDetails }),
    );
    iconBtn("more-horizontal", false, "More", (e) => this.moreMenu(e, type, coll));

    const nb = ctrls.createDiv({ cls: "vtr-objects-newbtn" });
    const nbMain = nb.createDiv({ cls: "vtr-objects-newbtn-main" });
    setIcon(nbMain.createSpan(), "plus");
    nbMain.createSpan({ text: "New" });
    nbMain.onclick = () => this.openNew(type);
    const nbCaret = nb.createDiv({ cls: "vtr-objects-newbtn-caret" });
    setIcon(nbCaret, "chevron-down");
    nbCaret.onclick = (e) => this.newTypeMenu(e, type);

    const bar = main.createDiv({ cls: "vtr-objects-viewbar" });
    const tabs = bar.createDiv({ cls: "vtr-objects-tabs" });
    const fixed = coll ? ([["all", "All", "list"]] as const) : ([["overview", "Overview", "layout-grid"], ["all", "All", "list"]] as const);
    for (const [id, label, icon] of fixed) {
      const t = tabs.createSpan({ cls: `vtr-objects-tab${this.state.collTab === id ? " is-on" : ""}` });
      setIcon(t.createSpan({ cls: "vtr-objects-tab-i" }), icon);
      t.createSpan({ text: label });
      t.onclick = () => this.go({ collTab: id });
    }
    let ruled = false;
    for (const q of this.queriesForType(type, coll)) {
      if (q.collection && !ruled) { tabs.createSpan({ cls: "vtr-objects-tabrule" }); ruled = true; }
      const t = tabs.createSpan({ cls: `vtr-objects-tab${q.collection ? " is-scoped" : ""}${this.state.collTab === `q:${q.id}` ? " is-on" : ""}` });
      const ic = t.createSpan({ cls: "vtr-objects-tab-i" });
      ic.style.setProperty("--hue", type.hue);
      setIcon(ic, q.icon || "filter");
      t.createSpan({ text: q.name });
      t.onclick = () => this.go({ collTab: `q:${q.id}` });
      t.oncontextmenu = (e) => { e.preventDefault(); this.queryTabMenu(e, q); };
      t.setAttr("draggable", "true");
      t.ondragstart = (e) => { e.dataTransfer?.setData("text/plain", q.id); t.addClass("is-dragging"); };
      t.ondragend = () => t.removeClass("is-dragging");
      t.ondragover = (e) => { e.preventDefault(); t.addClass("is-dragover"); };
      t.ondragleave = () => t.removeClass("is-dragover");
      t.ondrop = (e) => {
        e.preventDefault(); t.removeClass("is-dragover");
        const id = e.dataTransfer?.getData("text/plain");
        if (id && id !== q.id) this.reorderQuery(id, q.id);
      };
    }
    const addq = tabs.createSpan({ cls: "vtr-objects-tab is-addtab", attr: { "aria-label": coll ? `New query in ${coll.name}` : "New query" } });
    setIcon(addq.createSpan({ cls: "vtr-objects-tab-i" }), "plus");
    addq.onclick = () => this.newQueryForType(type, coll);
    bar.createDiv({ cls: "vtr-objects-grow" });
    if (!this.state.hideDetails) {
      const tools = bar.createDiv({ cls: "vtr-objects-tools" });
      const tool = (icon: string, on: boolean, label: string, onClick: (e: MouseEvent) => void) => {
        const b = tools.createSpan({ cls: `vtr-objects-tool${on ? " is-on" : ""}` });
        setIcon(b, icon);
        b.setAttr("aria-label", label);
        b.onclick = onClick;
        return b;
      };
      const count = tools.createSpan({ cls: "vtr-objects-count" });
      if (activeQuery) {
        const live = () => this.rerenderQuery(main, scopeTo(activeQuery, coll?.name), type, count);
        count.setText(`# ${evalQuery(this.plugin, scopeTo(activeQuery, coll?.name)).length}`);
        const filterBtn = tools.createSpan({ cls: `vtr-objects-tool${activeQuery.filters.length ? " is-on" : ""}`, attr: { "aria-label": "Filter" } });
        setIcon(filterBtn, "list-filter");
        filterBtn.onclick = () => this.queryFilterPop(filterBtn, activeQuery, type, live, coll?.name);
        const sortBtn = tool("arrow-up-down", !!activeQuery.sort?.length, "Sort", () => {});
        sortBtn.onclick = () => this.querySortPop(sortBtn, activeQuery, type, live, coll?.name);
        tool("rows-3", !!activeQuery.groupBy, "Group by", (e) => this.queryGroupMenu(e, activeQuery, type, coll?.name));
        tool("layout-grid", false, "Layout", (e) => this.layoutMenu(e));
        if (this.pendingQueryFilter) { this.pendingQueryFilter = false; setTimeout(() => filterBtn.click(), 0); }
      } else {
        count.setText(`# ${objs.length}`);
        tool("list-filter", this.state.filtering, "Filter", () => this.go({ filtering: !this.state.filtering, filter: "" }));
        tool("arrow-up-down", this.state.sortField !== "title" || this.state.sortDir !== "asc", "Sort", (e) => this.sortMenu(e, type, coll?.name));
        tool("rows-3", !!this.state.groupBy, "Group by", (e) => this.groupMenu(e, type, coll?.name));
        tool("layout-grid", false, "Layout", (e) => this.layoutMenu(e));
      }
    }

    if (this.state.collTab === "overview") {
      if (type.id === "__task") this.renderQuickAdd(main);
      if (objects.length) {
        const rank = new Map(this.plugin.openHistory.map((p, i) => [p, i]));
        const recent = [...objects]
          .sort((a, b) => (rank.get(a.path) ?? Infinity) - (rank.get(b.path) ?? Infinity) || b.stat.mtime - a.stat.mtime)
          .slice(0, 5);
        this.renderObjects(this.sectionHead(main, "Recently opened").body, recent, type);
      }
      this.renderCollectionsSection(main, cfg, objects, type);
      return;
    }

    if (this.state.collTab.startsWith("q:")) {
      if (activeQuery) { this.renderQueryResults(main.createDiv({ cls: "vtr-objects-qresults" }), scopeTo(activeQuery, coll?.name), type); return; }
      this.go({ collTab: "all" });
      return;
    }

    if (!objs.length) {
      if (coll) this.empty(main, "folder", `Nothing in ${coll.name} yet`, `Use New ${type.name} to add one — it joins this collection.`);
      else this.renderTypeEmpty(main, type);
      return;
    }

    if (this.state.filtering) {
      const fw = main.createDiv({ cls: "vtr-objects-filter" });
      const fi = fw.createEl("input", { type: "text", placeholder: "Filter by title…" });
      fi.value = this.state.filter;
      fi.oninput = () => {
        this.state.filter = fi.value;
        const q = fi.value.trim().toLowerCase();
        main.querySelectorAll<HTMLElement>("[data-title]").forEach((el) => {
          el.style.display = !q || (el.dataset.title ?? "").includes(q) ? "" : "none";
        });
      };
      setTimeout(() => fi.focus(), 0);
    }
    const g = this.state.groupBy;
    const sorted = g
      ? this.sortFiles(objs).sort((a, b) => {
          const va = sortValue(this.plugin, a, g);
          const vb = sortValue(this.plugin, b, g);
          return va < vb ? -1 : va > vb ? 1 : 0;
        })
      : this.sortFiles(objs);
    if (this.state.groupBy) {
      const groups = new Map<string, TFile[]>();
      for (const f of sorted) {
        const k = this.groupKey(f);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(f);
      }
      for (const [k, fs] of groups) this.renderObjects(this.sectionHead(main, k, fs.length).body, fs, type);
    } else {
      this.renderObjects(main, sorted, type);
    }
  }

  private async fillPreview(el: HTMLElement, f: TFile, fm: Record<string, unknown>) {
    const raw = await this.app.vault.cachedRead(f);
    const out = previewText(raw) || String(fm.description ?? fm.excerpt ?? "").trim();
    if (el.isConnected && out) el.setText(out);
    else if (el.isConnected) el.remove();
  }

  private fieldList(type: ObjectType, coll?: string): { key: string; label: string; icon: string }[] {
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    const PROP_ICON: Record<string, string> = { date: "calendar", link: "link", number: "hash", text: "type", formula: "sigma" };
    return [
      ...scopeProps(this.plugin, type, coll).map((p) => ({ key: p.key, label: cap(p.key), icon: PROP_ICON[p.kind] ?? "hash" })),
      { key: "title", label: "Title", icon: "type" },
      { key: "__tags", label: "Tags", icon: "tag" },
      { key: "__created", label: "Created at", icon: "calendar" },
      { key: "__updated", label: "Last updated", icon: "clock" },
    ];
  }

  private filterFields(type: ObjectType, coll?: string): { key: string; label: string; icon: string }[] {
    const base = this.fieldList(type, coll).filter((f) => !f.key.startsWith("__") && f.key !== "title");
    if (type.id === "__task") base.push({ key: "__recurring", label: "Recurring", icon: "repeat" });
    else base.push({ key: "__tags", label: "Tags", icon: "tag" });
    return base;
  }

  private sortFiles(files: TFile[]): TFile[] {
    const { sortField, sortDir } = this.state;
    return [...files].sort((a, b) => {
      const va = sortValue(this.plugin, a, sortField);
      const vb = sortValue(this.plugin, b, sortField);
      const c = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDir === "desc" ? -c : c;
    });
  }

  private groupKey(f: TFile): string {
    const g = this.state.groupBy;
    if (g === "folder") return f.parent && f.parent.path !== "/" ? f.parent.path : "(root)";
    if (g === "__tags") {
      const tags = (getAllTags(this.app.metadataCache.getFileCache(f) ?? {}) ?? []).map((x) => x.replace(/^#/, ""));
      return tags.length ? tags.join(", ") : "(no tags)";
    }
    if (g === "__collections") {
      const cfg = typeConfigs(this.plugin).find((c) => c.id === this.state.typeId);
      const names = collectionsOf(cfg).filter((c) => inCollection(this.app, c, f)).map((c) => c.name);
      return names.length ? names.join(", ") : "(none)";
    }
    if (g === "__created") return moment(f.stat.ctime).format("MMMM YYYY");
    if (g === "__updated") return moment(f.stat.mtime).format("MMMM YYYY");
    const v = this.app.metadataCache.getFileCache(f)?.frontmatter?.[g];
    return cleanValue(Array.isArray(v) ? v[0] : v) || "(none)";
  }

  private sortMenu(e: MouseEvent, type: ObjectType, collName?: string) {
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("Ascending").setIcon("arrow-up").setChecked(this.state.sortDir === "asc").onClick(() => this.go({ sortDir: "asc" })));
    menu.addItem((i) => i.setTitle("Descending").setIcon("arrow-down").setChecked(this.state.sortDir === "desc").onClick(() => this.go({ sortDir: "desc" })));
    menu.addSeparator();
    for (const p of this.fieldList(type, collName)) {
      menu.addItem((i) => i.setTitle(p.label).setIcon(p.icon).setChecked(this.state.sortField === p.key).onClick(() => this.go({ sortField: p.key })));
    }
    menu.showAtMouseEvent(e);
  }

  private groupMenu(e: MouseEvent, type: ObjectType, collName?: string) {
    const menu = new Menu();
    const opt = (key: string, label: string, icon: string) =>
      menu.addItem((i) => i.setTitle(label).setIcon(icon).setChecked(this.state.groupBy === key).onClick(() => this.go({ groupBy: key })));
    opt("", "None", "x");
    opt("folder", "Folder", "folder");
    opt("__tags", "Tags", "tag");
    opt("__collections", "Collections", "folder-open");
    opt("__created", "Created at", "calendar");
    opt("__updated", "Last updated", "clock");
    for (const p of scopeProps(this.plugin, type, collName)) opt(p.key, p.key, "hash");
    menu.showAtMouseEvent(e);
  }

  private popover(anchor: HTMLElement, build: (panel: HTMLElement) => void) {
    const root = (anchor.closest(".vtr-objects") as HTMLElement) ?? document.body;
    const rect = anchor.getBoundingClientRect();
    const panel = root.createDiv({ cls: "vtr-objects-pop" });
    panel.style.top = `${rect.bottom + 6}px`;
    const close = () => { panel.remove(); document.removeEventListener("mousedown", onDoc, true); };
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (panel.contains(t) || anchor.contains(t)) return;
      if (t.closest?.(".menu")) return;
      close();
    };
    build(panel);
    const w = panel.offsetWidth;
    const left = rect.left + w > window.innerWidth - 8 ? Math.max(8, rect.right - w) : rect.left;
    panel.style.left = `${left}px`;
    setTimeout(() => document.addEventListener("mousedown", onDoc, true), 0);
  }

  private cardViewPopover(anchor: HTMLElement, c: ObjectTypeConfig) {
    this.popover(anchor, (panel) => {
      const type = objectTypes(this.plugin).find((t) => t.id === c.id);
      const all = [
        ...CARD_BUILTINS,
        ...(type ? scopeProps(this.plugin, type) : c.props).map((p) => ({ key: p.key, label: p.key, icon: "hash" })),
      ];
      const render = () => {
        panel.empty();
        const group = (heading: string, items: typeof all) => {
          if (!items.length) return;
          panel.createDiv({ cls: "vtr-objects-pop-h", text: heading });
          for (const p of items) {
            const on = (c.cardProps ?? []).includes(p.key);
            const row = panel.createDiv({ cls: `vtr-objects-pop-row${on ? " is-on" : ""}` });
            setIcon(row.createSpan({ cls: "vtr-objects-pop-i" }), p.icon);
            row.createSpan({ cls: "vtr-objects-pop-t", text: p.label });
            if (on) setIcon(row.createSpan({ cls: "vtr-objects-pop-check" }), "check");
            row.onclick = () => {
              c.cardProps = c.cardProps ?? [];
              if (on) c.cardProps = c.cardProps.filter((k) => k !== p.key);
              else c.cardProps.push(p.key);
              void this.plugin.saveSettings();
              render();
            };
          }
        };
        group("Selected properties", all.filter((p) => (c.cardProps ?? []).includes(p.key)));
        group("Add properties", all.filter((p) => !(c.cardProps ?? []).includes(p.key)));
      };
      render();
    });
  }

  private layoutMenu(e: MouseEvent) {
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("Cards").setIcon("layout-grid").setChecked(this.state.collView === "cards").onClick(() => this.go({ collView: "cards" })));
    menu.addItem((i) => i.setTitle("List").setIcon("list").setChecked(this.state.collView === "list").onClick(() => this.go({ collView: "list" })));
    menu.showAtMouseEvent(e);
  }

  private sectionHead(main: HTMLElement, title: string, count?: number): { head: HTMLElement; body: HTMLElement } {
    const head = main.createDiv({ cls: "vtr-objects-sech" });
    const hit = head.createDiv({ cls: "vtr-objects-sech-hit" });
    setIcon(hit.createSpan({ cls: "vtr-objects-sech-chev" }), "chevron-down");
    hit.createSpan({ text: title });
    if (count !== undefined) hit.createSpan({ cls: "vtr-objects-sech-c", text: String(count) });
    const body = main.createDiv({ cls: "vtr-objects-sech-body" });
    hit.onclick = () => head.classList.toggle("is-collapsed");
    return { head, body };
  }

  private renderCollectionsSection(main: HTMLElement, cfg: ObjectTypeConfig | undefined, objects: TFile[], type: ObjectType) {
    if (!cfg) return;
    const colls = collectionsOf(cfg);

    const { head, body } = this.sectionHead(main, "Collections");
    const add = head.createSpan({ cls: "vtr-objects-addtpl vtr-objects-sech-add" });
    setIcon(add.createSpan(), "plus");
    add.createSpan({ text: "Collection" });
    add.onclick = () => void this.createCollection(cfg);

    if (!colls.length) {
      body.createDiv({ cls: "vtr-objects-note", text: "No collections yet." });
      return;
    }
    const grid = body.createDiv({ cls: "vtr-objects-collgrid" });
    for (const c of colls) {
      const count = objects.filter((f) => inCollection(this.app, c, f)).length;
      const card = grid.createDiv({ cls: "vtr-objects-collcard" });
      const t = card.createDiv({ cls: "vtr-objects-collcard-t" });
      setIcon(t.createSpan(), "folder");
      t.createSpan({ text: c.name });
      card.createDiv({ cls: "vtr-objects-collcard-c", text: `${count} ${count === 1 ? "entry" : "entries"}` });
      card.onclick = () => this.go({ collTab: "all", collectionId: c.id });
      card.oncontextmenu = (e) => this.collectionMenu(e, cfg, c.id);
    }

    const loose = objects.filter((f) => !colls.some((c) => inCollection(this.app, c, f)));
    if (loose.length) this.renderObjects(this.sectionHead(body, "Not in any collection", loose.length).body, loose, type);
  }

  private collectionMenu(e: MouseEvent, cfg: ObjectTypeConfig, id: string) {
    e.preventDefault();
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("Edit properties & template").setIcon("settings-2").onClick(() => this.go({ screen: "collection-edit", editCollId: id })));
    menu.addItem((i) => i.setTitle("Rename").setIcon("pencil").onClick(() => void this.renameCollection(cfg, id)));
    menu.addItem((i) => i.setTitle("Delete").setIcon("trash-2").onClick(() => this.deleteCollection(cfg, id)));
    menu.showAtMouseEvent(e);
  }

  private async createCollection(cfg: ObjectTypeConfig, add?: TFile) {
    const name = (await promptText(this.app, "New collection"))?.trim();
    if (!name) return;
    cfg.collections = cfg.collections ?? [];
    cfg.collections.push({ id: `col-${Date.now()}`, name, members: add ? [add.path] : [] });
    await this.plugin.saveSettings();
    new Notice(`Collection '${name}' created.`);
    this.render();
  }

  private async renameCollection(cfg: ObjectTypeConfig, id: string) {
    const c = (cfg.collections ?? []).find((x) => x.id === id);
    if (!c) return;
    const name = (await promptText(this.app, "Rename collection", c.name))?.trim();
    if (!name) return;
    await this.renameCollectionTo(cfg, c, name);
  }

  private async renameCollectionTo(cfg: ObjectTypeConfig, coll: ObjectCollection, newName: string) {
    const old = coll.name;
    if (!newName || newName === old) return;
    const type = this.types().find((t) => t.id === cfg.id);
    const lc = old.toLowerCase();
    for (const f of type ? objectsOfType(this.plugin, type) : []) {
      const cv = this.app.metadataCache.getFileCache(f)?.frontmatter?.collection;
      if (cv == null || cv === "") continue;
      if (!(Array.isArray(cv) ? cv : [cv]).some((v) => String(v).trim().toLowerCase() === lc)) continue;
      await this.app.fileManager.processFrontMatter(f, (fm) => {
        const cur: unknown[] = Array.isArray(fm.collection) ? fm.collection : [fm.collection];
        const next = cur.map((v) => (String(v).trim().toLowerCase() === lc ? newName : v));
        fm.collection = next.length === 1 ? next[0] : next;
      });
    }
    coll.name = newName;
    this.saveTypes();
  }

  private deleteCollection(cfg: ObjectTypeConfig, id: string) {
    cfg.collections = (cfg.collections ?? []).filter((c) => c.id !== id);
    this.saveTypes();
  }

  private addToCollection(cfg: ObjectTypeConfig, id: string, f: TFile) {
    const c = (cfg.collections ?? []).find((x) => x.id === id);
    if (!c) return;
    void setCollection(this.app, f, c.name, true).then(() => { new Notice(`Added to '${c.name}'.`); this.render(); });
  }

  private removeFromCollection(cfg: ObjectTypeConfig, id: string, f: TFile) {
    const c = (cfg.collections ?? []).find((x) => x.id === id);
    if (!c) return;
    void setCollection(this.app, f, c.name, false).then(() => { new Notice(`Removed from '${c.name}'.`); this.render(); });
  }

  private renderTypeEmpty(main: HTMLElement, type: ObjectType) {
    const box = main.createDiv({ cls: "vtr-objects-emptystate is-type" });
    setIcon(box.createDiv({ cls: "vtr-objects-empty-icon" }), type.icon);
    box.createDiv({ cls: "vtr-objects-empty-title", text: `No ${pluralName(type).toLowerCase()} yet` });
    box.createDiv({ text: `A note becomes a ${type.name} when it carries this line, and Vitrine writes it for you.` });
    box.createDiv({ cls: "vtr-objects-adopt-rule", text: `object: ${type.name.toLowerCase()}` });

    const paths = box.createDiv({ cls: "vtr-objects-adopt-paths" });

    const bring = paths.createDiv({ cls: "vtr-objects-adopt-card" });
    bring.createDiv({ cls: "vtr-objects-adopt-h", text: "Bring notes you already have" });
    bring.createDiv({ cls: "vtr-objects-note", text: "Add the line to notes in a folder, under a tag, or carrying a property." });
    this.renderAdopt(bring, type);

    const make = paths.createDiv({ cls: "vtr-objects-adopt-card" });
    make.createDiv({ cls: "vtr-objects-adopt-h", text: "Write the first one" });
    make.createDiv({ cls: "vtr-objects-note", text: `Start an empty ${type.name}, or one from a template.` });
    const btn = make.createEl("button", { cls: "vtr-objects-pickbar-b mod-cta", text: `New ${type.name}` });
    btn.onclick = () => new NewObjectModal(this.plugin, type, undefined).open();
  }

  private renderAdopt(parent: HTMLElement, type: ObjectType) {
    const box = parent.createDiv({ cls: "vtr-objects-adopt" });
    const row = box.createDiv({ cls: "vtr-objects-adopt-row" });
    const seg = row.createDiv({ cls: "vtr-objects-segbtn" });
    const BY = [["in folder", "folder"], ["with tag", "tag"], ["with property", "prop"]] as const;
    for (const [label, by] of BY) {
      const span = seg.createSpan({ cls: this.adoptBy === by ? "is-on" : "", text: label });
      span.onclick = () => {
        this.adoptBy = by;
        this.adoptValue = "";
        this.adoptSkip.clear();
        this.render();
      };
    }

    const HOLDER = { folder: "Choose a folder…", tag: "Choose a tag…", prop: "Choose a property…" };
    const pick = row.createDiv({ cls: "vtr-objects-select" });
    pick.createSpan({ text: this.adoptValue || HOLDER[this.adoptBy] });
    setIcon(pick.createSpan({ cls: "vtr-objects-select-caret" }), "chevron-down");
    pick.onclick = (e) => {
      const menu = new Menu();
      const list = candidates(this.app, this.adoptBy, (f) => !!declaredType(this.app, f)).slice(0, 30);
      if (!list.length) menu.addItem((i) => i.setTitle("Nothing left to choose from").setDisabled(true));
      for (const c of list) {
        menu.addItem((i) =>
          i.setTitle(`${c.value}  ·  ${c.count}`).onClick(() => {
            this.adoptValue = c.value;
            this.adoptSkip.clear();
            this.render();
          }),
        );
      }
      menu.showAtMouseEvent(e);
    };
    if (!this.adoptValue) return;

    const found = matches(this.app, this.adoptBy, this.adoptValue, (f) => declaredType(this.app, f));
    const free = found.filter((m) => !m.taken);
    const taken = found.length - free.length;
    row.createSpan({
      cls: "vtr-objects-adopt-n",
      text: `${free.length} match${free.length === 1 ? "" : "es"}${taken ? ` · ${taken} already typed, skipped` : ""}`,
    });

    const list = box.createDiv({ cls: "vtr-objects-adopt-list" });
    for (const m of free.slice(0, 8)) {
      const li = list.createDiv();
      const cb = li.createEl("input", { type: "checkbox" });
      cb.checked = !this.adoptSkip.has(m.file.path);
      cb.onchange = () => {
        if (cb.checked) this.adoptSkip.delete(m.file.path);
        else this.adoptSkip.add(m.file.path);
        this.render();
      };
      li.createSpan({ text: title(this.app, m.file) || m.file.basename });
      li.createSpan({ cls: "vtr-objects-adopt-p", text: m.file.parent?.path ?? "" });
    }
    if (free.length > 8) {
      list.createDiv({ cls: "vtr-objects-note", text: `…and ${free.length - 8} more, all included.` });
    }

    const chosen = free.filter((m) => !this.adoptSkip.has(m.file.path)).map((m) => m.file);
    const foot = box.createDiv({ cls: "vtr-objects-adopt-row" });
    const go = foot.createEl("button", { cls: "vtr-objects-pickbar-b mod-cta" });
    go.setText(`Add ${chosen.length} note${chosen.length === 1 ? "" : "s"}`);
    go.disabled = !chosen.length;
    go.onclick = () => void this.runAdopt(type, chosen);
    const cancel = foot.createEl("button", { cls: "vtr-objects-pickbar-b", text: "Cancel" });
    cancel.onclick = () => {
      this.adoptValue = "";
      this.adoptSkip.clear();
      this.render();
    };
  }

  private async runAdopt(type: ObjectType, files: TFile[]) {
    const paths = files.map((f) => f.path);
    await adopt(this.app, files, type.name.toLowerCase());
    this.lastAdopt = { paths, type: type.name };
    this.adoptValue = "";
    this.adoptSkip.clear();
    const frag = document.createDocumentFragment();
    frag.appendText(`${paths.length} note${paths.length === 1 ? "" : "s"} added to ${type.name}. `);
    const undo = frag.createEl("a", { text: "Undo" });
    undo.onclick = () => void this.undoAdopt();
    new Notice(frag, 12000);
    this.plugin.refreshViews();
  }

  private async undoAdopt() {
    const last = this.lastAdopt;
    if (!last) return;
    this.lastAdopt = null;
    await release(this.app, last.paths);
    new Notice(`${last.paths.length} note${last.paths.length === 1 ? "" : "s"} removed from ${last.type}.`);
    this.plugin.refreshViews();
  }

  private renderObjects(main: HTMLElement, files: TFile[], type: ObjectType) {
    const q = this.state.filtering ? this.state.filter.trim().toLowerCase() : "";
    this.shown = files.map((f) => f.path);
    if (type.id === "__task") {
      const body = main.createDiv({ cls: "vtr-task" }).createDiv({ cls: "vtr-task-secbody" });
      for (const f of files) {
        const holder = createDiv();
        renderTaskRow(this.plugin, holder, f, (file) => this.openTab(file.path), () => this.render());
        const row = holder.firstElementChild as HTMLElement | null;
        if (row) body.appendChild(this.objEl(row, f, q));
      }
      return;
    }
    if (this.state.collView === "cards") {
      const grid = main.createDiv({ cls: "vtr-objects-cards" });
      for (const f of files) grid.appendChild(this.objEl(this.card(f, type), f, q));
    } else {
      const list = main.createDiv({ cls: "vtr-objects-list" });
      for (const f of files) list.appendChild(this.objEl(this.listRow(f, type), f, q));
    }
  }

  private objEl(el: HTMLElement, f: TFile, q: string): HTMLElement {
    const t = title(this.app, f).toLowerCase();
    el.dataset.title = t;
    if (q && !t.includes(q)) el.style.display = "none";
    el.oncontextmenu = (e) => this.cardMenu(e, f);
    if (this.picking) {
      const picked = this.picking;
      el.toggleClass("is-picked", picked.has(f.path));
      el.onclick = () => {
        if (picked.has(f.path)) picked.delete(f.path);
        else picked.add(f.path);
        this.render();
      };
    }
    return el;
  }

  startPicking(seed: string[] = []) {
    this.picking = new Set(seed);
    this.render();
  }

  private renderPickBar(main: HTMLElement) {
    const picked = this.picking;
    if (!picked) return;
    const bar = main.createDiv({ cls: "vtr-objects-pickbar" });
    bar.createSpan({ cls: "vtr-objects-pickbar-c", text: String(picked.size) });
    bar.createSpan({ cls: "vtr-objects-pickbar-h", text: picked.size ? "picked for the share card" : "click the cards you want to share" });
    const stop = () => { this.picking = null; this.render(); };
    const share = bar.createEl("button", { cls: "vtr-objects-pickbar-b mod-cta", text: "Share" });
    share.disabled = !picked.size;
    share.onclick = () => {
      const order = this.shown;
      const files = [...picked]
        .sort((a, b) => (order.indexOf(a) + 1 || Infinity) - (order.indexOf(b) + 1 || Infinity))
        .map((p) => this.app.vault.getAbstractFileByPath(p))
        .filter((f): f is TFile => f instanceof TFile);
      stop();
      if (files.length) this.openShare(files);
    };
    bar.createEl("button", { cls: "vtr-objects-pickbar-b", text: "Cancel" }).onclick = stop;
  }

  private openShare(files: TFile[]) {
    const type = this.types().find((t) => t.id === this.state.typeId);
    const query = this.state.collTab.startsWith("q:")
      ? (this.plugin.settings.queries ?? []).find((q) => `q:${q.id}` === this.state.collTab)
      : undefined;
    const sort = query?.sort?.[0];
    new ShareCardModal(this.plugin, files, {
      pickMore: () => this.startPicking(files.map((f) => f.path)),
      heading: [type?.name, query?.name].filter(Boolean).join(" · "),
      ranked: !!sort,
      sortedBy: sort ? `${sort.field} ${sort.dir === "desc" ? "↓" : "↑"}` : undefined,
    }).open();
  }

  private cardMenu(e: MouseEvent, f: TFile) {
    e.preventDefault();
    const fmt = this.app.metadataCache.getFileCache(f)?.frontmatter;
    const cur = String(fmt?.object ?? fmt?.type ?? "").toLowerCase();
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("Set type").setDisabled(true));
    for (const t of this.types().filter((t) => t.id !== "__pages")) {
      menu.addItem((i) =>
        i.setTitle(t.name).setIcon(t.icon).setChecked(cur === t.id.toLowerCase() || cur === t.name.toLowerCase()).onClick(() => void this.setNoteType(f, t.id)),
      );
    }
    if (cur) menu.addItem((i) => i.setTitle("Clear type").setIcon("x").onClick(() => void this.setNoteType(f, null)));
    const cfg = typeConfigs(this.plugin).find((c) => c.id === this.state.typeId);
    if (cfg) {
      menu.addSeparator();
      for (const c of collectionsOf(cfg)) {
        const inColl = inCollection(this.app, c, f);
        menu.addItem((i) =>
          i.setTitle(inColl ? `Remove from '${c.name}'` : `Add to '${c.name}'`)
            .setIcon(inColl ? "folder-minus" : "folder")
            .onClick(() => (inColl ? this.removeFromCollection(cfg, c.id, f) : this.addToCollection(cfg, c.id, f))),
        );
      }
      menu.addItem((i) => i.setTitle("New collection…").setIcon("folder-plus").onClick(() => void this.createCollection(cfg, f)));
    }
    menu.addSeparator();
    menu.addItem((i) => i.setTitle("Share card").setIcon("image-down").onClick(() => this.openShare([f])));
    menu.addItem((i) => i.setTitle("Share several…").setIcon("layers").onClick(() => this.startPicking([f.path])));
    menu.addSeparator();
    menu.addItem((i) =>
      i.setTitle("Rename").setIcon("pencil").onClick(async () => {
        const name = await promptText(this.app, "Rename", "", title(this.app, f));
        if (name && await renameObject(this.app, f, name)) this.render();
      }),
    );
    menu.addItem((i) =>
      i.setTitle("Remove note").setIcon("trash-2").onClick(async () => {
        if (!confirm(`Move "${title(this.app, f)}" to trash?`)) return;
        await this.app.fileManager.trashFile(f);
        this.render();
      }),
    );
    menu.showAtMouseEvent(e);
  }

  private defsFor(type: ObjectType, f: TFile): PropDef[] {
    const props = effectiveProps(this.plugin, type, f);
    return props.length ? props : notePropDefs(this.plugin, f);
  }

  private card(f: TFile, type: ObjectType): HTMLElement {
    const fm = this.app.metadataCache.getFileCache(f)?.frontmatter ?? {};
    if (type.id === "__weblink") return this.weblinkCard(f, fm, type);
    if (type.id === "__task") return this.taskCard(f, fm);

    const card = createDiv({ cls: "vtr-objects-card" });
    const keys = type.cardProps.length
      ? type.cardProps
      : this.defsFor(type, f).slice(0, 3).map((p) => p.key);

    if (keys.includes("__cover")) {
      const cover = this.coverImage(fm, fm.url ?? fm.source);
      if (cover) {
        const im = card.createEl("img", { cls: "vtr-objects-wl-img" });
        im.src = cover;
        im.onerror = () => im.remove();
      }
    }
    const t = card.createDiv({ cls: "vtr-objects-card-t" });
    t.createSpan({ text: title(this.app, f) });
    const rows = card.createDiv({ cls: "vtr-objects-card-r" });
    const date = (ms: number) => moment(ms).format("D MMM YYYY");
    for (const key of keys) {
      if (key === "__cover") continue;
      if (key === "__preview") {
        void this.fillPreview(rows.createDiv({ cls: "vtr-objects-card-prev" }), f, fm);
      } else if (key === "__tags") {
        const cache = this.app.metadataCache.getFileCache(f);
        const tags = (getAllTags(cache ?? {}) ?? []).map((x) => x.replace(/^#/, ""));
        if (tags.length) {
          const box = rows.createDiv({ cls: "vtr-objects-wl-tags" });
          for (const tag of tags) box.createSpan({ cls: "vtr-objects-wl-tag", text: tag });
        }
      } else if (key === "__collections") {
        const cfg = typeConfigs(this.plugin).find((c) => c.id === type.id);
        const names = collectionsOf(cfg).filter((c) => inCollection(this.app, c, f)).map((c) => c.name);
        if (names.length) { rows.createSpan({ cls: "vtr-objects-card-k", text: names.length === 1 ? "Collection" : "Collections" }); rows.createSpan({ cls: "vtr-objects-card-v", text: names.join(", ") }); }
      } else if (key === "__updated") {
        rows.createSpan({ cls: "vtr-objects-card-k", text: "Updated" }); rows.createSpan({ cls: "vtr-objects-card-v", text: date(f.stat.mtime) });
      } else if (key === "__created") {
        rows.createSpan({ cls: "vtr-objects-card-k", text: "Created" }); rows.createSpan({ cls: "vtr-objects-card-v", text: date(f.stat.ctime) });
      } else {
        rows.createSpan({ cls: "vtr-objects-card-k", text: key });
        rows.createSpan({ cls: "vtr-objects-card-v", text: this.short(this.value(f, fm, key), f) });
      }
    }
    card.onclick = (e) => this.openTab(f.path, undefined, e.metaKey || e.ctrlKey);
    return card;
  }

  private weblinkCard(f: TFile, fm: Record<string, unknown>, type: ObjectType): HTMLElement {
    const card = createDiv({ cls: "vtr-objects-card vtr-objects-wl" });
    const pill = card.createDiv({ cls: "vtr-objects-typechip" });
    pill.style.setProperty("--hue", type.hue);
    setIcon(pill.createSpan(), type.icon);
    pill.createSpan({ text: type.name });
    const cover = this.coverImage(fm, fm.url ?? fm.source);
    if (cover) {
      const im = card.createEl("img", { cls: "vtr-objects-wl-img" });
      im.src = cover;
      im.onerror = () => im.remove();
    }
    const b = card.createDiv({ cls: "vtr-objects-wl-b" });
    b.createDiv({ cls: "vtr-objects-wl-t", text: title(this.app, f) });
    const link = fm.url ?? fm.source;
    if (link) {
      const host = this.host(String(link));
      const u = b.createDiv({ cls: "vtr-objects-wl-u" });
      const fav = u.createEl("img", { cls: "vtr-objects-wl-fav" });
      fav.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`;
      fav.onerror = () => fav.remove();
      u.createSpan({ text: host });
    }
    const cache = this.app.metadataCache.getFileCache(f);
    const tags = cache ? getAllTags(cache) ?? [] : [];
    if (tags.length) {
      const chips = b.createDiv({ cls: "vtr-objects-wl-tags" });
      for (const t of tags.slice(0, 4)) chips.createSpan({ cls: "vtr-objects-wl-tag", text: t.replace(/^#/, "").split("/").pop() ?? t });
    }
    card.onclick = (e) => this.openTab(f.path, undefined, e.metaKey || e.ctrlKey);
    return card;
  }

  private host(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  }

  private youtubeId(url: string): string {
    return url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/)?.[1] ?? "";
  }

  private coverImage(fm: Record<string, unknown>, link: unknown): string {
    for (const k of ["image", "cover", "thumbnail", "banner", "og:image"]) {
      const v = fm[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    const yt = this.youtubeId(String(link ?? ""));
    return yt ? `https://img.youtube.com/vi/${yt}/hqdefault.jpg` : "";
  }

  private newTypeMenu(e: MouseEvent, type: ObjectType) {
    const cfg = typeConfigs(this.plugin).find((c) => c.id === type.id);
    const colls = collectionsOf(cfg);
    const files = templatesForType(this.plugin, type);
    const menu = new Menu();
    menu.addItem((i) => i.setTitle(`New ${type.name}`).setIcon("plus").onClick(() => new NewObjectModal(this.plugin, type, null).open()));
    if (colls.length) {
      menu.addSeparator();
      for (const coll of colls) {
        menu.addItem((i) => i.setTitle(`New in ${coll.name}`).setIcon("folder").onClick(() => new NewObjectModal(this.plugin, type, undefined, coll).open()));
      }
    }
    menu.addSeparator();
    for (const file of files) {
      const coll = collectionOf(this.plugin, type, file) ?? undefined;
      menu.addItem((i) => i.setTitle(`New '${file.basename}'`).setIcon("copy").onClick(() => new NewObjectModal(this.plugin, type, file, coll).open()));
    }
    if (cfg) {
      menu.addItem((i) =>
        i.setTitle("New template\u2026").setIcon("file-plus").onClick(() =>
          void this.createTemplate((path) => {
            cfg.templates = [...templatePaths(cfg), path];
            cfg.templatePath = undefined;
            this.saveTypes();
          }),
        ),
      );
    }
    menu.showAtMouseEvent(e);
  }

  private moreMenu(e: MouseEvent, type: ObjectType, coll?: ObjectCollection) {
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("New query").setIcon("filter").onClick(() => this.newQueryForType(type, coll)));
    if (coll)
      menu.addItem((i) => i.setTitle(`Edit ${coll.name}`).setIcon("folder-cog").onClick(() => this.go({ screen: "collection-edit", editCollId: coll.id })));
    if (type.id === "__task")
      menu.addItem((i) => i.setTitle("Import all checkboxes in vault…").setIcon("check-square").onClick(() => void importAllCheckboxes(this.plugin)));
    menu.addItem((i) => i.setTitle("Edit type").setIcon("settings-2").onClick(() => this.go({ screen: "type", typeId: type.id })));
    menu.showAtMouseEvent(e);
  }

  private taskCard(f: TFile, fm: Record<string, unknown>): HTMLElement {
    const card = createDiv({ cls: "vtr-objects-card vtr-objects-task" });
    const head = card.createDiv({ cls: "vtr-objects-task-h" });
    const box = head.createEl("input", { type: "checkbox" });
    box.checked = fm.done === true;
    box.onclick = (e) => {
      e.stopPropagation();
      void this.toggleDone(f, box.checked);
    };
    const tt = head.createSpan({ cls: "vtr-objects-task-t", text: title(this.app, f) });
    if (fm.done === true) tt.addClass("is-done");
    const meta: string[] = [];
    if (fm.priority) meta.push(String(fm.priority));
    if (fm.deadline) meta.push(`due ${String(fm.deadline)}`);
    if (meta.length) card.createDiv({ cls: "vtr-objects-task-m", text: meta.join(" · ") });
    card.onclick = (e) => this.openTab(f.path, undefined, e.metaKey || e.ctrlKey);
    return card;
  }

  private async toggleDone(f: TFile, done: boolean) {
    await this.app.fileManager.processFrontMatter(f, (fm) => {
      fm.done = done;
    });
    this.render();
  }

  private openNew(type: ObjectType) {
    if (type.id === "__weblink") { new WeblinkModal(this.plugin, type).open(); return; }
    const cfg = typeConfigs(this.plugin).find((c) => c.id === type.id);
    const coll = this.state.collectionId ? collectionsOf(cfg).find((c) => c.id === this.state.collectionId) : undefined;
    new NewObjectModal(this.plugin, type, undefined, coll).open();
  }

  private async setNoteType(f: TFile, id: string | null) {
    await this.app.fileManager.processFrontMatter(f, (fm) => {
      delete fm.type;
      if (id) fm.object = id;
      else delete fm.object;
    });
    this.render();
  }

  private listRow(f: TFile, type: ObjectType): HTMLElement {
    const fm = this.app.metadataCache.getFileCache(f)?.frontmatter ?? {};
    const row = createDiv({ cls: "vtr-objects-lrow" });
    row.createSpan({ cls: "vtr-objects-lt", text: title(this.app, f) });
    const second = this.defsFor(type, f).find((p) => p.kind === "link" || p.kind === "text");
    row.createSpan({ cls: "vtr-objects-lm", text: second ? `${second.key}: ${this.short(this.value(f, fm, second.key), f)}` : "" });
    row.createSpan({ cls: "vtr-objects-ls", text: fm.status ? String(fm.status) : "" });
    row.onclick = (e) => this.openTab(f.path, undefined, e.metaKey || e.ctrlKey);
    return row;
  }

  private renderStructure(main: HTMLElement) {
    const configs = typeConfigs(this.plugin);
    const head = main.createDiv({ cls: "vtr-objects-chead" });
    setIcon(head.createSpan({ cls: "vtr-objects-ico is-big is-plain" }), "settings-2");
    head.createEl("h1", { text: "Object types" });
    main.createDiv({
      cls: "vtr-objects-note",
      text: "Customise your object types: icon, colour, properties and templates. Types are seeded from your vault templates; create new ones as you need them.",
    });

    const card = (c: ObjectTypeConfig, grid: HTMLElement) => {
      const el = grid.createDiv({ cls: "vtr-objects-tcard" });
      const ico = el.createSpan({ cls: "vtr-objects-ico is-big" });
      ico.style.setProperty("--hue", c.color);
      setIcon(ico, c.icon);
      el.createDiv({ cls: "vtr-objects-tcard-n", text: c.name });
      el.onclick = () => this.go({ screen: "type", typeId: c.id });
    };

    main.createDiv({ cls: "vtr-objects-sub", text: "Custom object types" });
    const custom = main.createDiv({ cls: "vtr-objects-sgrid" });
    for (const c of configs.filter((c) => !c.builtin)) card(c, custom);
    const create = custom.createDiv({ cls: "vtr-objects-tcard is-create" });
    setIcon(create.createDiv(), "plus");
    create.createDiv({ text: "Create" });
    create.onclick = () => this.createType();

    main.createDiv({ cls: "vtr-objects-sub", text: "Basic object types" });
    const basic = main.createDiv({ cls: "vtr-objects-sgrid" });
    for (const c of configs.filter((c) => c.builtin)) card(c, basic);
  }

  private createType() {
    const configs = typeConfigs(this.plugin);
    const id = `type-${Date.now()}`;
    configs.push({ id, name: "New type", tag: "", icon: "box", color: hueFor(id), props: [] });
    void this.plugin.saveSettings();
    this.go({ screen: "type", typeId: id });
  }

  private async renameType(c: ObjectTypeConfig, next: string) {
    const others = typeConfigs(this.plugin).filter((t) => t !== c).map((t) => t.name);
    const kind = renameCheck(others, c.name, next);
    if (kind === "noop") return;
    if (kind === "clash") {
      new Notice(`Another type is already called ${next.trim()}.`);
      this.render();
      return;
    }
    const from = c.name.toLowerCase();
    const files = kind === "rewrite"
      ? this.app.vault.getMarkdownFiles().filter((f) => declaredType(this.app, f) === from)
      : [];
    c.name = next.trim();
    await this.plugin.saveSettings();
    if (files.length) {
      await adopt(this.app, files, c.name.toLowerCase());
      new Notice(`${files.length} note${files.length === 1 ? "" : "s"} now say object: ${c.name.toLowerCase()}.`);
    }
    this.render();
  }

  private deleteType(c: ObjectTypeConfig) {
    const configs = typeConfigs(this.plugin);
    const i = configs.indexOf(c);
    if (i >= 0) configs.splice(i, 1);
    void this.plugin.saveSettings();
    this.go({ screen: "structure" });
  }

  private saveTypes() {
    void this.plugin.saveSettings();
    this.render();
  }

  private renderTypeEditor(main: HTMLElement) {
    const c = typeConfigs(this.plugin).find((x) => x.id === this.state.typeId);
    if (!c) {
      this.empty(main, "box", "Type not found", "This object type no longer exists.");
      return;
    }

    const head = main.createDiv({ cls: "vtr-objects-thead" });
    const crumb = head.createDiv({ cls: "vtr-objects-crumbs" });
    const back = crumb.createSpan({ cls: "vtr-objects-crumb", text: "Object types" });
    back.onclick = () => this.go({ screen: "structure" });
    crumb.createSpan({ cls: "vtr-objects-sep", text: "/" });
    const pill = crumb.createSpan({ cls: "vtr-objects-typepill" });
    pill.style.setProperty("--hue", c.color);
    setIcon(pill.createSpan(), c.icon);
    pill.createSpan({ text: c.name });

    if (c.id !== "__pages") {
      const more = head.createDiv({ cls: "vtr-objects-select-btn" });
      setIcon(more, "more-horizontal");
      more.setAttr("aria-label", "More");
      more.onclick = (e) => {
        const menu = new Menu();
        menu.addItem((i) =>
          i
            .setTitle("Delete object type")
            .setIcon("trash-2")
            .setWarning(true)
            .onClick(() => this.deleteType(c)),
        );
        menu.showAtMouseEvent(e);
      };
    }

    const fields = main.createDiv({ cls: "vtr-objects-fields" });
    const field = (label: string, grow = false) => {
      const wrap = fields.createDiv({ cls: `vtr-objects-field${grow ? " is-grow" : ""}` });
      wrap.createDiv({ cls: "vtr-objects-flabel", text: label });
      return wrap;
    };
    const textInput = (wrap: HTMLElement, value: string, placeholder: string, commit: (v: string) => void) => {
      const input = wrap.createEl("input", { cls: "vtr-objects-finput", type: "text" });
      input.value = value;
      input.placeholder = placeholder;
      input.onblur = () => commit(input.value.trim());
    };

    {
      const iconRow = field("Icon").createDiv({ cls: "vtr-objects-iconrow is-pick" });
      const preview = iconRow.createSpan({ cls: "vtr-objects-ico" });
      preview.style.setProperty("--hue", c.color);
      setIcon(preview, c.icon);
      iconRow.createSpan({ cls: "vtr-objects-iconpick-t", text: "Choose icon" });
      iconRow.onclick = () =>
        new IconPickerModal(this.app, (name) => {
          c.icon = name;
          preview.empty();
          setIcon(preview, name);
          void this.saveTypes();
        }).open();
    }
    textInput(field("Name", true), c.name, "Name", (v) => void this.renameType(c, v));
    textInput(field("Plural of name", true), c.namePlural ?? "", "Plural", (v) => ((c.namePlural = v || undefined), this.saveTypes()));

    const row2 = main.createDiv({ cls: "vtr-objects-fields" });
    const colWrap = row2.createDiv({ cls: "vtr-objects-field" });
    colWrap.createDiv({ cls: "vtr-objects-flabel", text: "Colour" });
    const sw = colWrap.createDiv({ cls: "vtr-objects-swatches" });
    for (const hue of TYPE_HUES) {
      const s = sw.createDiv({ cls: `vtr-objects-swatch${hue === c.color ? " is-on" : ""}` });
      s.style.background = hue;
      s.onclick = () => ((c.color = hue), this.saveTypes());
    }
    {
      const descWrap = row2.createDiv({ cls: "vtr-objects-field is-grow" });
      descWrap.createDiv({ cls: "vtr-objects-flabel", text: "Description" });
      textInput(descWrap, c.description ?? "", "Your description for this object type", (v) => ((c.description = v || undefined), this.saveTypes()));
    }

    const TABS = ["Properties", "Templates", "Adopt", "Appearance", "Calendar", "New notes"];
    const counts: Record<string, number> = { Properties: c.props.length, Templates: templatePaths(c).length };
    const active = TABS.includes(this.typeTab[c.id]) ? this.typeTab[c.id] : TABS[0];
    const bar = main.createDiv({ cls: "vtr-objects-tabbar" });
    for (const name of TABS) {
      const tab = bar.createSpan({ cls: active === name ? "is-on" : "" });
      tab.createSpan({ text: name });
      if (counts[name]) tab.createEl("i", { cls: "vtr-objects-tabn", text: String(counts[name]) });
      tab.onclick = () => {
        this.typeTab[c.id] = name;
        this.render();
      };
    }
    const body = main.createDiv({ cls: "vtr-objects-tabbody" });

    const seg = <T>(parent: HTMLElement, label: string, options: readonly (readonly [string, T])[], value: T, onPick: (v: T) => void) => {
      const wrap = parent.createDiv({ cls: "vtr-objects-segrow" });
      wrap.createDiv({ cls: "vtr-objects-flabel", text: label });
      const segbar = wrap.createDiv({ cls: "vtr-objects-segbtn" });
      for (const [text, v] of options) {
        const span = segbar.createSpan({ cls: value === v ? "is-on" : "", text });
        span.onclick = () => onPick(v);
      }
    };

    if (active === "Properties") {
      if ((c.collections ?? []).some((col) => col.props?.length)) {
        body.createDiv({ cls: "vtr-objects-note", text: "Base properties. Collections with their own schema override these." });
      }
      this.renderPropList(body, c.props, (key) => (c.dropped = [...new Set([...(c.dropped ?? []), key])]));
    }

    if (active === "Adopt") {
      const type = objectTypes(this.plugin).find((t) => t.id === c.id);
      body.createDiv({ cls: "vtr-objects-note", text: `Add notes you already have to this type. Vitrine writes object: ${c.name.toLowerCase()} into each one and changes nothing else.` });
      if (type) this.renderAdopt(body, type);
    }

    if (active === "Templates") {
      body.createDiv({ cls: "vtr-objects-note", text: "A template prefills this type's properties and content when you create a new object." });
      this.renderTemplateList(body, templatePaths(c), (p) => { c.templates = p; c.templatePath = undefined; });
    }

    if (active === "Appearance") {
      body.createDiv({ cls: "vtr-objects-flabel", text: "Page layout" });
      body.createDiv({ cls: "vtr-objects-note", text: "How an object of this type opens." });
      const pick = body.createDiv({ cls: "vtr-objects-layoutpick" });
      const LAYOUTS = [
        ["page", "Standard", "page"],
        ["indexcard", "Index card", "indexcard"],
        ["profile", "Profile", "profile"],
        ["encyclopedia", "Encyclopedia", "encyclopedia"],
      ] as const;
      const current = c.layout ?? "page";
      for (const [id, label, thumb] of LAYOUTS) {
        const opt = pick.createDiv({ cls: `vtr-objects-layoutopt${current === id ? " is-on" : ""}` });
        opt.createDiv({ cls: `vtr-objects-layoutthumb is-${thumb}` });
        opt.createSpan({ text: label });
        opt.onclick = () => ((c.layout = id), this.saveTypes());
      }
      seg(body, "Wide layout", [["Use normal", false], ["Use wide", true]] as const, c.wide ?? false, (v) => ((c.wide = v), this.saveTypes()));
      seg(body, "Cover image mode", [["Small", "small"], ["Wide", "wide"]] as const, c.coverMode ?? "small", (v) => ((c.coverMode = v), this.saveTypes()));
      seg(body, "Cover image display", [["Full", "full"], ["Crop", "crop"]] as const, c.cover ?? "crop", (v) => ((c.cover = v), this.saveTypes()));

      body.createDiv({ cls: "vtr-objects-sub", text: "Card and linking" });
      body.createDiv({ cls: "vtr-objects-flabel", text: "Customise card view" });
      body.createDiv({ cls: "vtr-objects-note", text: "Set which properties should be shown on the small card view." });
      const editBtn = body.createDiv({ cls: "vtr-objects-select" });
      setIcon(editBtn.createSpan(), "pencil");
      editBtn.createSpan({ text: "Edit" });
      setIcon(editBtn.createSpan({ cls: "vtr-objects-select-caret" }), "chevron-down");
      editBtn.onclick = () => this.cardViewPopover(editBtn, c);

      body.createDiv({ cls: "vtr-objects-flabel", text: "Default link view" });
      body.createDiv({ cls: "vtr-objects-note", text: "Set a default view to be used when linking or creating an object as a block somewhere in your content." });
      const lvRow = body.createDiv({ cls: "vtr-objects-linkviewrow" });
      const cur = LINK_VIEWS.find((v) => v[0] === (c.linkView ?? "link")) ?? LINK_VIEWS[0];
      const sel = lvRow.createDiv({ cls: "vtr-objects-select" });
      setIcon(sel.createSpan(), cur[2]);
      sel.createSpan({ text: cur[1] });
      setIcon(sel.createSpan({ cls: "vtr-objects-select-caret" }), "chevron-down");
      sel.onclick = (e) => {
        const menu = new Menu();
        for (const [val, label, icon] of LINK_VIEWS) {
          menu.addItem((i) => i.setTitle(label).setIcon(icon).setChecked((c.linkView ?? "link") === val).onClick(() => { c.linkView = val; this.saveTypes(); }));
        }
        menu.showAtMouseEvent(e);
      };
      const reset = lvRow.createDiv({ cls: "vtr-objects-select-btn" });
      reset.setText("Reset");
      reset.onclick = () => { c.linkView = "link"; this.saveTypes(); };
    }

    if (active === "Calendar") {
      seg(body, "Create object from calendar", [["Show", "show"], ["Hide", "hide"]] as const, c.calCreate ?? "hide", (v) => ((c.calCreate = v), this.saveTypes()));
      body.createDiv({ cls: "vtr-objects-note", text: "Show a per-day button in the calendar to create an object of this type." });
      seg(body, "Objects in calendar", [["Show", false], ["Hide", true]] as const, c.calHidden ?? false, (v) => ((c.calHidden = v), this.saveTypes()));
      body.createDiv({ cls: "vtr-objects-note", text: "Hide this type's objects from the calendar." });
    }

    if (active === "New notes") {
      body.createDiv({ cls: "vtr-objects-note", text: "Folder where a new object of this type is created. Empty means the vault root (or the template's folder)." });
      const nf = body.createDiv({ cls: "vtr-objects-fields" }).createDiv({ cls: "vtr-objects-field is-grow" });
      nf.createDiv({ cls: "vtr-objects-flabel", text: "Folder" });
      const nfi = nf.createEl("input", { cls: "vtr-objects-finput", type: "text", attr: { placeholder: "e.g. Clippings" } });
      nfi.value = c.newNoteFolder ?? "";
      nfi.onblur = () => ((c.newNoteFolder = nfi.value.trim() || undefined), this.saveTypes());
    }
  }

  private renderCollectionEditor(main: HTMLElement) {
    const cfg = typeConfigs(this.plugin).find((x) => x.id === this.state.typeId);
    const coll = (cfg?.collections ?? []).find((x) => x.id === this.state.editCollId);
    if (!cfg || !coll) {
      this.empty(main, "box", "Collection not found", "This collection no longer exists.");
      return;
    }
    const crumb = main.createDiv({ cls: "vtr-objects-crumbs" });
    const back = crumb.createSpan({ cls: "vtr-objects-crumb", text: cfg.name });
    back.onclick = () => this.go({ screen: "collection", typeId: cfg.id, collectionId: coll.id, collTab: "all" });
    crumb.createSpan({ cls: "vtr-objects-sep", text: "/" });
    const pill = crumb.createSpan({ cls: "vtr-objects-typepill" });
    pill.style.setProperty("--hue", cfg.color);
    setIcon(pill.createSpan(), "folder");
    pill.createSpan({ text: coll.name });

    const wrap = main.createDiv({ cls: "vtr-objects-fields" }).createDiv({ cls: "vtr-objects-field is-grow" });
    wrap.createDiv({ cls: "vtr-objects-flabel", text: "Name" });
    const input = wrap.createEl("input", { cls: "vtr-objects-finput", type: "text" });
    input.value = coll.name;
    input.onblur = () => void this.renameCollectionTo(cfg, coll, input.value.trim());

    main.createDiv({ cls: "vtr-objects-sub", text: "Properties" });
    main.createDiv({ cls: "vtr-objects-note", text: `Schema for objects in '${coll.name}'. Leave empty to inherit ${cfg.name}'s properties.` });
    this.renderPropList(main, (coll.props ??= []));

    main.createDiv({ cls: "vtr-objects-sub", text: "Templates" });
    main.createDiv({ cls: "vtr-objects-note", text: `Template copied when you create a new object in '${coll.name}'.` });
    this.renderTemplateList(main, coll.templates ?? [], (p) => { coll.templates = p.length ? p : undefined; });
  }

  private async createTemplate(onAdd: (path: string) => void) {
    const name = await promptText(this.app, "New template");
    if (!name) return;
    const home = templateNotes(this.app)[0]?.parent?.path;
    const folder = home && home !== "/" ? home : "Templates";
    await ensureFolder(this.app, folder);
    const path = await freePath(this.app, folder, safeName(name), "md");
    const file = await this.app.vault.create(path, "---\nstatus: template\n---\n\n");
    onAdd(file.path);
    await this.plugin.openFile(file);
  }

  private templateMenu(e: MouseEvent, current: string[], onAdd: (path: string) => void) {
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("New template…").setIcon("file-plus").onClick(() => void this.createTemplate(onAdd)));
    menu.addSeparator();
    const available = templateNotes(this.app).filter((f) => !current.includes(f.path));
    if (!available.length) menu.addItem((i) => i.setTitle("No templates left (notes with status: template)").setDisabled(true));
    for (const f of available)
      menu.addItem((i) => i.setTitle(f.basename).setIcon("file-text").onClick(() => onAdd(f.path)));
    menu.showAtMouseEvent(e);
  }

  private renderPropList(main: HTMLElement, props: PropDef[], onDrop?: (key: string) => void) {
    const list = main.createDiv({ cls: "vtr-objects-eprops" });
    props.forEach((p, idx) => {
      const row = list.createDiv({ cls: "vtr-objects-ep" });
      setIcon(row.createSpan({ cls: "vtr-objects-ep-ico" }), this.kindIcon(p.kind));
      const key = row.createEl("input", { cls: "vtr-objects-epkey", type: "text" });
      key.value = p.key;
      key.onblur = () => ((p.key = key.value.trim() || p.key), this.saveTypes());
      const kind = row.createEl("select", { cls: "vtr-objects-epkind" });
      for (const k of PROP_KINDS) { const opt = kind.createEl("option", { text: k, value: k }); if (k === p.kind) opt.selected = true; }
      const opts = row.createEl("input", { cls: "vtr-objects-epopts", type: "text", attr: { placeholder: "Options, comma-separated" } });
      opts.value = (p.options ?? []).join(", ");
      opts.style.display = p.kind === "select" ? "" : "none";
      opts.onblur = () => ((p.options = opts.value.split(",").map((s) => s.trim()).filter(Boolean)), this.saveTypes());
      const expr = row.createEl("input", { cls: "vtr-objects-epopts", type: "text", attr: { placeholder: "Expression, e.g. sell / time" } });
      expr.value = p.expr ?? "";
      expr.style.display = p.kind === "formula" ? "" : "none";
      expr.onblur = () => ((p.expr = expr.value.trim() || undefined), this.saveTypes());
      kind.onchange = () => {
        p.kind = kind.value as ObjectPropKind;
        opts.style.display = p.kind === "select" ? "" : "none";
        expr.style.display = p.kind === "formula" ? "" : "none";
        this.saveTypes();
      };
      const del = row.createSpan({ cls: "vtr-objects-epdel" });
      setIcon(del, "trash-2");
      del.onclick = () => (props.splice(idx, 1), onDrop?.(p.key), this.saveTypes());
    });
    const add = main.createDiv({ cls: "vtr-objects-addprop" });
    setIcon(add.createSpan(), "plus");
    add.createSpan({ text: "Add property" });
    add.onclick = () => (props.push({ key: "New property", kind: "text" }), this.saveTypes());
  }

  private renderTemplateList(main: HTMLElement, paths: string[], set: (p: string[]) => void) {
    const tpls = main.createDiv({ cls: "vtr-objects-tpls" });
    for (const path of paths) {
      const file = this.app.vault.getAbstractFileByPath(path);
      const tpl = tpls.createDiv({ cls: "vtr-objects-tpl" });
      setIcon(tpl.createSpan(), "file-text");
      tpl.createSpan({ text: file instanceof TFile ? file.basename : path });
      if (file instanceof TFile) tpl.onclick = () => void this.plugin.openFile(file);
      const x = tpl.createSpan({ cls: "vtr-objects-tpl-x", text: "×" });
      x.onclick = (e) => { e.stopPropagation(); set(paths.filter((p) => p !== path)); this.saveTypes(); };
    }
    const addTpl = main.createDiv({ cls: "vtr-objects-addtpl" });
    setIcon(addTpl.createSpan(), "plus");
    addTpl.createSpan({ text: "Add template" });
    addTpl.onclick = (e) => this.templateMenu(e, paths, (p) => (set([...paths, p]), this.saveTypes()));
  }

  private kindIcon(kind: PropDef["kind"]): string {
    const map: Record<string, string> = {
      text: "type",
      number: "hash",
      date: "calendar",
      check: "check-square",
      link: "link",
      links: "link",
      list: "list",
      select: "list-checks",
      formula: "sigma",
    };
    return map[kind] ?? "type";
  }

  private value(f: TFile, fm: Record<string, unknown>, key: string): unknown {
    return fm[key] === undefined ? derivedValue(this.plugin, f, key) ?? undefined : fm[key];
  }

  private short(value: unknown, from: TFile): string {
    if (value === undefined || value === "" || value === null) return "—";
    if (Array.isArray(value)) return value.map((v) => this.short(v, from)).join(", ");
    const target = resolveLink(this.app, value, from.path);
    if (target) return title(this.app, target);
    return String(value);
  }

  private history: ObjectsState[] = [];
  private histIndex = -1;

  private navKey(s: ObjectsState): string {
    return `${s.screen}|${s.typeId}|${s.objPath}|${s.collectionId}`;
  }

  private go(patch: Partial<ObjectsState>) {
    if (patch.screen === "object" && patch.objPath) this.plugin.noteOpened(patch.objPath);
    const prev = this.state;
    this.state = { ...this.state, ...patch };
    if (this.navKey(this.state) !== this.navKey(prev)) {
      if (!this.history.length) { this.history.push({ ...prev }); this.histIndex = 0; }
      this.history = this.history.slice(0, this.histIndex + 1);
      this.history.push({ ...this.state });
      this.histIndex = this.history.length - 1;
    }
    this.render();
  }

  private histGo(delta: number) {
    const i = this.histIndex + delta;
    if (i < 0 || i >= this.history.length) return;
    this.histIndex = i;
    this.state = { ...this.history[i] };
    this.render();
  }

  openTab(path: string, subpath?: string, background = false) {
    if (!this.state.tabs.includes(path)) this.state.tabs = [...this.state.tabs, path];
    if (background) { this.render(); return; }
    this.pendingSubpath = subpath;
    this.go({ screen: "object", objPath: path });
  }

  private closeTab(path: string) {
    const tabs = this.state.tabs.filter((p) => p !== path);
    this.state.tabs = tabs;
    if (this.state.objPath === path) {
      if (tabs.length) this.go({ screen: "object", objPath: tabs[tabs.length - 1] });
      else this.go({ screen: "collection", objPath: "" });
    } else {
      this.render();
    }
  }

  private empty(parent: HTMLElement, icon: string, title: string, body: string) {
    const box = parent.createDiv({ cls: "vtr-objects-emptystate" });
    setIcon(box.createDiv({ cls: "vtr-objects-empty-icon" }), icon);
    box.createDiv({ cls: "vtr-objects-empty-title", text: title });
    box.createDiv({ text: body });
  }
}
