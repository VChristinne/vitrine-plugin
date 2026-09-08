import { Menu, TFile, moment, setIcon } from "obsidian";
import { renameObject, resolveLinks, title } from "./model";
import { STATUS_ORDER, PRIORITY_ORDER, statusOf, priorityOf } from "./task-create";
import { isRecurring, completeOccurrence, skipOccurrence, excuseOccurrence } from "./task-recur";
import { promptText } from "../modals/prompt";
import type VitrinePlugin from "../main";

const STATUS_ICON: Record<string, string> = {
  "Not started": "circle",
  "Next up": "circle-dot",
  "In progress": "loader",
  Done: "check-circle-2",
};

const slug = (s: string) => s.toLowerCase().replace(/\s+/g, "-");

const fmtDate = (v: unknown) => {
  const s = String(v).trim();
  const time = /T(\d{2}:\d{2})/.exec(s)?.[1];
  const day = moment(s.slice(0, 10)).format("MMM D");
  return time ? `${day}, ${time}` : day;
};

export function renderTaskRow(
  plugin: VitrinePlugin,
  host: HTMLElement,
  file: TFile,
  open: (f: TFile) => void,
  onChange: () => void,
  page?: TFile,
): void {
  const { app } = plugin;
  const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
  const status = statusOf(fm);
  const priority = priorityOf(fm);
  const done = status === "Done";
  const recurring = isRecurring(fm);
  const today = moment().format("YYYY-MM-DD");

  const write = (key: string, value: unknown) =>
    app.fileManager.processFrontMatter(file, (f) => { f[key] = value; }).then(onChange);

  const pick = (e: MouseEvent, options: readonly string[], current: string, apply: (v: string) => void) => {
    e.stopPropagation();
    const menu = new Menu();
    for (const o of options) menu.addItem((i) => i.setTitle(o).setChecked(o === current).onClick(() => apply(o)));
    menu.showAtMouseEvent(e);
  };

  const row = host.createDiv({ cls: "vtr-task-row" });
  if (page) row.addClass("is-compact");

  const box = row.createEl("input", { type: "checkbox", cls: "vtr-task-check" });
  box.checked = done;
  box.addEventListener("change", () => {
    if (recurring && box.checked) void completeOccurrence(app, file).then(onChange);
    else void write("status", box.checked ? "Done" : "Not started");
  });

  const tt = row.createSpan({ cls: "vtr-task-t" });
  tt.createSpan({ cls: "vtr-task-tt", text: title(app, file) });
  if (done) tt.addClass("is-done");
  tt.addEventListener("click", () => open(file));

  if (recurring) setIcon(tt.createSpan({ cls: "vtr-task-recur", attr: { "aria-label": "Recurring" } }), "repeat");

  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("Rename").setIcon("pencil").onClick(async () => {
      const name = await promptText(app, "Rename task", "", title(app, file));
      if (name && await renameObject(app, file, name)) onChange();
    }));
    if (recurring) {
      menu.addItem((i) => i.setTitle("Skip").setIcon("skip-forward").onClick(() => void skipOccurrence(app, file).then(onChange)));
      menu.addItem((i) => i.setTitle("Excuse").setIcon("shield").onClick(() => void excuseOccurrence(app, file).then(onChange)));
    }
    menu.showAtMouseEvent(e);
  });

  const chip = (host: HTMLElement, cls: string, icon: string, text: string) => {
    const c = host.createSpan({ cls: `vtr-task-chip ${cls}` });
    setIcon(c.createSpan({ cls: "vtr-task-chip-i" }), icon);
    c.createSpan({ text });
    return c;
  };

  const tail = page ? row.createSpan({ cls: "vtr-task-tail" }) : row;

  const control = (kind: string, value: string, icon: string, options: readonly string[], key: string) => {
    const el = tail.createSpan({
      cls: `${page ? "vtr-task-ico" : "vtr-task-pill"} is-${kind} is-${slug(value)}`,
      attr: { "aria-label": value },
    });
    setIcon(page ? el : el.createSpan({ cls: "vtr-task-pill-i" }), icon);
    if (!page) el.createSpan({ text: value });
    el.addEventListener("click", (e) => pick(e, options, value, (v) => void write(key, v)));
  };
  control("status", status, STATUS_ICON[status] ?? "circle", STATUS_ORDER, "status");
  control("pri", priority, "flag-triangle-right", PRIORITY_ORDER, "priority");

  const overdue = (v: unknown) => !done && String(v).slice(0, 10) < today;

  if (page) {
    if (fm.schedule || fm.deadline) {
      const when = tail.createSpan({ cls: "vtr-task-when" });
      if (fm.schedule) when.createSpan({ cls: "is-sched", text: fmtDate(fm.schedule), attr: { "aria-label": "Schedule" } });
      if (fm.schedule && fm.deadline) when.createSpan({ cls: "vtr-task-arw", text: "→" });
      if (fm.deadline) {
        const d = when.createSpan({ cls: "is-due", text: fmtDate(fm.deadline), attr: { "aria-label": "Deadline" } });
        if (overdue(fm.deadline)) d.addClass("is-overdue");
      }
    }
  } else {
    const sched = row.createSpan({ cls: "vtr-task-cell" });
    if (fm.schedule) chip(sched, "is-schedule", "calendar", fmtDate(fm.schedule));

    const dead = row.createSpan({ cls: "vtr-task-cell" });
    if (fm.deadline) {
      const c = chip(dead, "is-deadline", "flag", fmtDate(fm.deadline));
      if (overdue(fm.deadline)) c.addClass("is-overdue");
    }
  }

  const ctxCell = page ? tail : row.createSpan({ cls: "vtr-task-cell" });
  const [first, ...rest] = resolveLinks(app, fm.context, file.path).filter((c) => c.path !== page?.path);
  if (first) {
    const c = chip(ctxCell, "is-context", "link", title(app, first));
    c.addEventListener("click", (e) => { e.stopPropagation(); open(first); });
  }
  if (rest.length) {
    const more = ctxCell.createSpan({ cls: "vtr-task-chip is-context is-more", text: `+${rest.length}` });
    more.addEventListener("click", (e) => {
      e.stopPropagation();
      const menu = new Menu();
      for (const ctx of rest) menu.addItem((i) => i.setTitle(title(app, ctx)).setIcon("link").onClick(() => open(ctx)));
      menu.showAtMouseEvent(e);
    });
  }
}
