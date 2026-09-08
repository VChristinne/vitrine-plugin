import { TFile, moment, setIcon } from "obsidian";
import { isRecurring, type Occurrence, type OccState, type RecurRule, type RecurUnit } from "./task-recur";
import type VitrinePlugin from "../main";

const UNITS: RecurUnit[] = ["day", "week", "month", "year"];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WD_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function renderTaskPanel(
  plugin: VitrinePlugin,
  host: HTMLElement,
  file: TFile,
  onChange: () => void,
): void {
  const { app } = plugin;
  const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
  const rule = isRecurring(fm) ? ({ ...(fm.recur as RecurRule) }) : null;

  const write = (next: RecurRule | null) =>
    app.fileManager.processFrontMatter(file, (f) => {
      if (next) f.recur = next; else delete f.recur;
    }).then(onChange);

  const box = host.createDiv({ cls: "vtr-recur" });
  const head = box.createDiv({ cls: "vtr-recur-head" });
  setIcon(head.createSpan({ cls: "vtr-recur-head-i" }), "repeat");
  head.createSpan({ text: "Recurrence" });

  if (!rule) {
    const btn = box.createDiv({ cls: "vtr-recur-enable" });
    setIcon(btn.createSpan(), "plus");
    btn.createSpan({ text: "Make recurring" });
    btn.onclick = () => void write({ mode: "schedule", every: 1, unit: "day" });
    return;
  }

  const update = (patch: Partial<RecurRule> | ((cur: RecurRule) => Partial<RecurRule>)) =>
    void app.fileManager.processFrontMatter(file, (f) => {
      const cur = (isRecurring(f) ? (f.recur as RecurRule) : rule) as RecurRule;
      const next = { ...cur, ...(typeof patch === "function" ? patch(cur) : patch) } as Record<string, unknown>;
      for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
      f.recur = next;
    }).then(onChange);

  const body = box.createDiv({ cls: "vtr-recur-body" });

  const modes = body.createDiv({ cls: "vtr-recur-modes" });
  const modeBtn = (mode: RecurRule["mode"], label: string) => {
    const b = modes.createSpan({ cls: "vtr-recur-mode", text: label });
    b.toggleClass("is-active", rule.mode === mode);
    b.onclick = () => update({ mode });
  };
  modeBtn("schedule", "On schedule");
  modeBtn("completion", "After completion");

  const row = body.createDiv({ cls: "vtr-recur-row" });
  row.createSpan({ cls: "vtr-recur-lbl", text: "Every" });
  const num = row.createEl("input", { cls: "vtr-recur-num", type: "number" });
  num.min = "1";
  num.value = String(rule.every);
  num.onchange = () => update({ every: Math.max(1, Number(num.value) || 1) });
  const unit = row.createEl("select", { cls: "vtr-recur-unit" });
  for (const u of UNITS) {
    const opt = unit.createEl("option", { text: rule.every > 1 ? `${u}s` : u });
    opt.value = u;
    if (u === rule.unit) opt.selected = true;
  }
  unit.onchange = () => update({ unit: unit.value as RecurUnit });

  if (rule.unit === "week") {
    const days = body.createDiv({ cls: "vtr-recur-days" });
    for (const d of WD_ORDER) {
      const chip = days.createSpan({ cls: "vtr-recur-day", text: WD[d] });
      chip.toggleClass("is-active", !!rule.weekdays?.includes(d));
      chip.onclick = () => update((cur) => {
        const set = new Set(cur.weekdays ?? []);
        set.has(d) ? set.delete(d) : set.add(d);
        return { weekdays: set.size ? [...set].sort((a, b) => a - b) : undefined };
      });
    }
  }

  const foot = body.createDiv({ cls: "vtr-recur-row" });
  foot.createSpan({ cls: "vtr-recur-lbl", text: "Until" });
  const until = foot.createEl("input", { cls: "vtr-recur-until", type: "date" });
  if (rule.until) until.value = rule.until;
  until.onchange = () => update({ until: until.value || undefined, count: undefined });
  foot.createSpan({ cls: "vtr-recur-lbl", text: "or" });
  const cnt = foot.createEl("input", { cls: "vtr-recur-num", type: "number", attr: { min: "1", placeholder: "×" } });
  if (rule.count) cnt.value = String(rule.count);
  cnt.onchange = () => update({ count: Number(cnt.value) > 0 ? Number(cnt.value) : undefined, until: undefined });
  foot.createSpan({ cls: "vtr-recur-lbl", text: "times" });
  const clear = foot.createSpan({ cls: "vtr-recur-clear", attr: { "aria-label": "Stop recurring" } });
  setIcon(clear, "x");
  clear.onclick = () => void write(null);
}

const OCC_ICON: Record<OccState, string> = {
  completed: "circle-check",
  skipped: "circle-slash",
  excused: "shield",
};

function periodLabel(unit: RecurUnit | undefined, date: string): string {
  const d = moment(date, "YYYY-MM-DD");
  if (unit === "week") return `week ${d.isoWeek()}`;
  if (unit === "month") return d.format("YYYY-MM");
  if (unit === "year") return d.format("YYYY");
  return "";
}

export function renderOccurrences(plugin: VitrinePlugin, host: HTMLElement, file: TFile): void {
  const fm = plugin.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
  const log = (fm.occurrences as Occurrence[] | undefined) ?? [];
  if (!log.length) return;
  const unit = (fm.recur as RecurRule | undefined)?.unit;
  const rows = [...log].sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const box = host.createDiv({ cls: "vtr-occ" });
  const head = box.createDiv({ cls: "vtr-occ-h" });
  head.createSpan({ cls: "vtr-occ-k", text: "Occurrences" });
  head.createSpan({ cls: "vtr-occ-c", text: String(rows.length) });
  const chev = head.createSpan({ cls: "vtr-occ-chev" });
  setIcon(chev, "chevron-down");

  const body = box.createDiv({ cls: "vtr-occ-b" });
  const render = (all: boolean) => {
    body.empty();
    for (const o of (all ? rows : rows.slice(0, 3))) {
      const r = body.createDiv({ cls: `vtr-occ-row is-${o.status}` });
      setIcon(r.createSpan({ cls: "vtr-occ-i" }), OCC_ICON[o.status] ?? "circle");
      r.createSpan({ text: moment(String(o.date), "YYYY-MM-DD").format("ddd, MMM D") });
      const period = periodLabel(unit, String(o.date));
      if (period) r.createSpan({ cls: "vtr-occ-p", text: period });
    }
    if (!all && rows.length > 3) {
      const more = body.createDiv({ cls: "vtr-occ-more", text: `+ ${rows.length - 3} earlier` });
      more.onclick = () => render(true);
    }
  };
  render(false);

  head.onclick = () => box.toggleClass("is-collapsed", !box.hasClass("is-collapsed"));
}
