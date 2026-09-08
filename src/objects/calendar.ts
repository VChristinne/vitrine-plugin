import { App, TFile, moment, setIcon } from "obsidian";
import { allObjects, coverImage, objectDate, objectTypes, typeOf, typeOrPage, title, type ObjectType } from "../objects/model";
import type VitrinePlugin from "../main";

export type CalView = "month" | "week" | "threedays" | "day";

export interface CalNav {
  plugin: VitrinePlugin;
  date: string;
  view: CalView;
  mini: boolean;
  setState: (patch: { date?: string; view?: CalView; mini?: boolean }) => void;
  open: (path: string) => void;
  create: (typeId: string, date: string) => void;
}

const STEP: Record<CalView, { unit: "month" | "week" | "day"; amount: number }> = {
  month: { unit: "month", amount: 1 },
  week: { unit: "week", amount: 1 },
  threedays: { unit: "day", amount: 3 },
  day: { unit: "day", amount: 1 },
};

const MINI_DOW = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const WEEKDAY_HUE = ["", "#d99a2b", "#d95a99", "#37a06a", "#d97a2b", "#3a72d9", "#8a55d9", "#d9503a"];

interface CalIndex {
  placed: Map<string, TFile[]>;
  dated: Map<string, TFile[]>;
  created: Map<string, TFile[]>;
}

const push = (m: Map<string, TFile[]>, d: string, f: TFile) => (m.get(d) ?? m.set(d, []).get(d)!).push(f);

export function byDate(plugin: VitrinePlugin, types: ObjectType[]): CalIndex {
  const { app } = plugin;
  const idx: CalIndex = { placed: new Map(), dated: new Map(), created: new Map() };
  for (const f of allObjects(plugin)) {
    const t = typeOf(plugin, f, types);
    if (t?.calHidden) continue;
    const d = objectDate(app.metadataCache.getFileCache(f)?.frontmatter ?? {});
    const born = moment(f.stat.ctime).format("YYYY-MM-DD");
    if (d) push(idx.dated, d, f);
    push(idx.created, born, f);
    push(idx.placed, d || born, f);
  }
  return idx;
}

function sechToggle(parent: HTMLElement, title: string, count?: number, collapsed = false): HTMLElement {
  const head = parent.createDiv("vtr-objects-sech");
  if (collapsed) head.addClass("is-collapsed");
  const hit = head.createDiv("vtr-objects-sech-hit");
  setIcon(hit.createSpan("vtr-objects-sech-chev"), "chevron-down");
  hit.createSpan({ text: title });
  if (count !== undefined) hit.createSpan({ cls: "vtr-objects-sech-c", text: String(count) });
  const body = parent.createDiv("vtr-objects-sech-body");
  hit.onclick = () => head.classList.toggle("is-collapsed");
  return body;
}

function typeIcon(parent: HTMLElement, type: ObjectType | null): void {
  const ico = parent.createSpan({ cls: `vtr-objects-ico${type ? "" : " is-plain"}` });
  if (type) ico.style.setProperty("--hue", type.hue);
  setIcon(ico, type ? type.icon : "file-text");
}

function typeRow(parent: HTMLElement, type: ObjectType | null): HTMLElement {
  const row = parent.createDiv("vtr-cal-card-type");
  typeIcon(row, type);
  row.createSpan({ text: type ? type.name : "Note" });
  return row;
}

export function renderCalendar(container: HTMLElement, nav: CalNav): void {
  const { plugin } = nav;
  const { app } = plugin;
  const today = moment().format("YYYY-MM-DD");
  const focus = moment(nav.date || today, "YYYY-MM-DD");
  const focusKey = focus.format("YYYY-MM-DD");
  const types = objectTypes(plugin);
  const typeFor = (f: TFile) => typeOrPage(plugin, f, types);
  const events = byDate(plugin, types);
  const placed = (d: string) => events.placed.get(d) ?? [];

  container.empty();

  const chip = (parent: HTMLElement, f: TFile) => {
    const ev = parent.createDiv("vtr-cal-ev");
    typeIcon(ev, typeFor(f));
    ev.createSpan({ text: title(app, f) });
    ev.onclick = () => nav.open(f.path);
  };

  const dayHead = (parent: HTMLElement, day: moment.Moment) => {
    const h = parent.createDiv("vtr-cal-dhead");
    if (day.format("YYYY-MM-DD") === today) h.addClass("is-today");
    h.createDiv({ cls: "vtr-cal-dhead-dow", text: day.format("dddd") }).style.color = WEEKDAY_HUE[day.isoWeekday()];
    const line = h.createDiv("vtr-cal-dhead-line");
    line.createSpan({ cls: "vtr-cal-dhead-date", text: day.format("D MMM YYYY") });
    line.createSpan({ cls: "vtr-cal-dhead-wk", text: `Week ${day.isoWeek()}` });
  };

  const createBar = (parent: HTMLElement, d: string) => {
    const shown = types.filter((t) => t.calCreate === "show");
    if (!shown.length) return;
    const bar = parent.createDiv("vtr-cal-create");
    for (const t of shown) {
      const b = bar.createEl("button", { cls: "vtr-cal-createbtn" });
      setIcon(b.createSpan(), "plus");
      const tag = b.createSpan("vtr-cal-createbtn-t");
      typeIcon(tag, t);
      tag.createSpan({ text: t.name });
      b.onclick = () => nav.create(t.id, d);
    }
  };

  const createdCard = (parent: HTMLElement, f: TFile) => {
    const fm = app.metadataCache.getFileCache(f)?.frontmatter ?? {};
    const type = typeFor(f);
    const card = parent.createDiv("vtr-cal-card");
    typeRow(card, type);
    const cover = coverImage(fm, fm.url ?? fm.source);
    if (cover) {
      const im = card.createEl("img", { cls: "vtr-cal-card-img" });
      im.src = cover;
      im.onerror = () => im.remove();
    }
    card.createDiv({ cls: "vtr-cal-card-t", text: title(app, f) });
    card.onclick = () => nav.open(f.path);
  };

  const cardSection = (parent: HTMLElement, label: string, objs: TFile[], collapsed = false) => {
    const body = sechToggle(parent, label, objs.length, collapsed);
    if (!objs.length) body.createDiv({ cls: "vtr-objects-sech-empty", text: "There's nothing here (yet)." });
    else {
      const grid = body.createDiv("vtr-cal-cards");
      for (const f of objs) createdCard(grid, f);
    }
  };

  const objectsFor = (parent: HTMLElement, d: string) => {
    cardSection(parent, "Dated This Day", events.dated.get(d) ?? [], true);
    cardSection(parent, "Created on This Day", events.created.get(d) ?? []);
  };

  const head = container.createDiv("vtr-cal-head");
  head.createDiv("vtr-cal-head-spacer");
  const seg = head.createDiv("vtr-cal-seg");
  const labels: Record<CalView, string> = { month: "Month", week: "Week", threedays: "Three days", day: "Day" };
  for (const v of ["month", "week", "threedays", "day"] as const) {
    const b = seg.createEl("button", { cls: "vtr-cal-segbtn", text: labels[v] });
    if (nav.view === v) b.addClass("is-on");
    b.onclick = () => nav.setState({ view: v });
  }

  const { unit, amount } = STEP[nav.view];
  const navGrp = head.createDiv("vtr-cal-nav");
  const arrow = (icon: string, sign: number) => {
    const b = navGrp.createEl("button", { cls: "vtr-cal-navbtn" });
    setIcon(b, icon);
    b.onclick = () => nav.setState({ date: focus.clone().add(sign * amount, unit).format("YYYY-MM-DD") });
  };
  arrow("chevron-left", -1);
  navGrp.createEl("button", { cls: "vtr-cal-navbtn", text: "Today" }).onclick = () => nav.setState({ date: today });
  arrow("chevron-right", 1);
  const miniToggle = navGrp.createEl("button", { cls: `vtr-cal-navbtn vtr-cal-mtoggle${nav.mini ? " is-on" : ""}` });
  setIcon(miniToggle, "calendar");
  miniToggle.onclick = () => nav.setState({ mini: !nav.mini });

  const miniCal = (parent: HTMLElement) => {
    const mini = parent.createDiv("vtr-cal-mini");
    const mh = mini.createDiv("vtr-cal-mini-h");
    const mprev = mh.createEl("button", { cls: "vtr-cal-mini-nav" });
    setIcon(mprev, "chevron-left");
    mprev.onclick = () => nav.setState({ date: focus.clone().subtract(1, "month").format("YYYY-MM-DD") });
    mh.createSpan({ cls: "vtr-cal-mini-t", text: focus.format("MMMM YYYY") });
    const mnext = mh.createEl("button", { cls: "vtr-cal-mini-nav" });
    setIcon(mnext, "chevron-right");
    mnext.onclick = () => nav.setState({ date: focus.clone().add(1, "month").format("YYYY-MM-DD") });
    const grid = mini.createDiv("vtr-cal-mini-grid");
    for (const d of MINI_DOW) grid.createSpan({ cls: "vtr-cal-mini-dow", text: d });
    const start = focus.clone().startOf("month").startOf("isoWeek");
    for (let i = 0; i < 42; i++) {
      const d = start.clone().add(i, "day");
      const key = d.format("YYYY-MM-DD");
      const cell = grid.createSpan({ cls: "vtr-cal-mini-d", text: String(d.date()) });
      if (d.month() !== focus.month()) cell.addClass("is-out");
      if (key === today) cell.addClass("is-today");
      if (key === focusKey) cell.addClass("is-sel");
      cell.onclick = () => nav.setState({ date: key, view: "day" });
    }
  };

  if (nav.view === "day") {
    const wrap = container.createDiv("vtr-cal-daywrap");
    const main = wrap.createDiv("vtr-cal-daymain");
    dayHead(main, focus);
    createBar(main, focusKey);
    main.createEl("hr", { cls: "vtr-cal-sep" });

    const dateForms = [
      focus.format("YYYY-MM-DD"),
      focus.format("YYYY/MM/DD"),
      focus.format("D MMM YYYY"),
      focus.format("MMM D, YYYY"),
      focus.format("D MMMM YYYY"),
      focus.format("MMMM D, YYYY"),
      focus.format("DD/MM/YYYY"),
      focus.format("MM/DD/YYYY"),
    ];
    void fillDateRefs(app, main.createDiv("vtr-cal-refsbox"), dateForms, () => nav.setState({ date: focusKey, view: "day" }), typeFor);

    objectsFor(main, focusKey);

    if (nav.mini) miniCal(wrap.createDiv("vtr-cal-aside"));
    return;
  }

  if (nav.view === "threedays") {
    const cols = container.createDiv("vtr-cal-cols");
    cols.style.gridTemplateColumns = "repeat(3, 1fr)";
    for (let i = 0; i < 3; i++) {
      const day = focus.clone().add(i, "day");
      const key = day.format("YYYY-MM-DD");
      const col = cols.createDiv("vtr-cal-col");
      dayHead(col, day);
      const body = col.createDiv("vtr-cal-col-b");
      for (const f of placed(key)) chip(body, f);
    }
    return;
  }

  if (nav.view === "month") {
    const strip = container.createDiv("vtr-cal-months");
    for (let i = 0; i < 12; i++) {
      const m = strip.createSpan({ cls: "vtr-cal-month", text: moment().month(i).format("MMM") });
      if (i === focus.month()) m.addClass("is-on");
      m.onclick = () => nav.setState({ date: focus.clone().month(i).date(1).format("YYYY-MM-DD") });
    }
    const monthStart = focus.clone().startOf("month");
    const days: moment.Moment[] = [];
    for (let i = 0, n = focus.daysInMonth(); i < n; i++) {
      const day = monthStart.clone().add(i, "day");
      const key = day.format("YYYY-MM-DD");
      if (placed(key).length > 0) days.push(day);
    }
    if (!days.length) {
      const empty = container.createDiv("vtr-cal-empty");
      empty.createDiv({ cls: "vtr-cal-empty-title", text: "Nothing on the calendar this month." });
      empty.createDiv({ cls: "vtr-cal-empty-sub", text: "You can change this by creating a new object." });
      return;
    }
    const list = container.createDiv("vtr-cal-list");
    for (const day of days) {
      const sec = list.createDiv("vtr-cal-lday");
      dayHead(sec, day);
      const body = sec.createDiv("vtr-cal-lday-b");
      for (const f of placed(day.format("YYYY-MM-DD"))) chip(body, f);
    }
    return;
  }

  const start = focus.clone().startOf("isoWeek");
  const list = container.createDiv("vtr-cal-list");
  for (let i = 0; i < 7; i++) {
    const day = start.clone().add(i, "day");
    const key = day.format("YYYY-MM-DD");
    const sec = list.createDiv("vtr-cal-lday");
    dayHead(sec, day);
    const body = sec.createDiv("vtr-cal-lday-b");
    for (const f of placed(key)) chip(body, f);
  }
}

const RECUR = /\b(daily|bi-?weekly|weekly|monthly|quarterly|yearly|annually|every\s+\w+)\b/i;
const REF_TIME = /\b(\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)\b/i;

function parseRef(text: string, forms: string[]): { title: string; time: string; recur: string } {
  const recur = text.match(RECUR)?.[0] ?? "";
  const timeM = text.match(REF_TIME);
  const time = timeM ? moment(timeM[1].replace(/[\s.]/g, ""), ["h:mma", "ha", "hmma"]).format("h:mm A") : "";
  let title = text.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2");
  for (const f of forms) title = title.split(f).join("");
  if (timeM) title = title.split(timeM[0]).join("");
  title = title
    .replace(RECUR, "")
    .replace(/\(\s*@?[\s,]*\)/g, "")
    .replace(/@/g, "")
    .replace(/\s*\(\s*\)\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return { title: title || text, time, recur };
}

export function hasTaskItems(cache: { listItems?: { task?: string }[] } | null): boolean {
  return !!cache?.listItems?.some((li) => li.task !== undefined);
}

async function fillDateRefs(
  app: App,
  box: HTMLElement,
  forms: string[],
  goDay: () => void,
  getType: (f: TFile) => ObjectType | null,
) {
  const hits: { file: TFile; text: string; done: boolean }[] = [];
  for (const f of app.vault.getMarkdownFiles()) {
    if (!box.isConnected) return;
    if (!hasTaskItems(app.metadataCache.getFileCache(f))) continue;
    const raw = await app.vault.cachedRead(f);
    if (!forms.some((v) => raw.includes(v))) continue;
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
      if (m && forms.some((v) => line.includes(v))) hits.push({ file: f, done: m[1] !== " ", text: m[2].trim() });
    }
  }
  if (!box.isConnected || !hits.length) return;
  const list = sechToggle(box, "Date references", hits.length);
  list.addClass("vtr-cal-refs");
  for (const hit of hits) {
    const { title, time, recur } = parseRef(hit.text, forms);
    const row = list.createDiv("vtr-cal-ref");
    const check = row.createEl("input", { type: "checkbox" });
    check.checked = hit.done;
    check.disabled = true;
    const t = row.createSpan({ cls: "vtr-cal-ref-t", text: title });
    if (hit.done) t.addClass("is-done");
    if (time) row.createSpan({ cls: "vtr-cal-ref-time", text: time });
    if (recur) {
      const r = row.createSpan({ cls: "vtr-cal-ref-recur", attr: { "aria-label": recur, title: recur } });
      setIcon(r, "repeat");
    }
    typeRow(row, getType(hit.file));
    row.onclick = () => goDay();
  }
  box.createEl("hr", { cls: "vtr-cal-sep" });
}
