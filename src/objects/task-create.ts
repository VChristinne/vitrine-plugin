import { TFile, moment } from "obsidian";
import { objectTypes, objectsOfType, title } from "./model";
import { ensureFolder, freePath, nameFitsFile, safeName } from "../paths";
import type { RecurRule, RecurUnit } from "./task-recur";
import type VitrinePlugin from "../main";

export const STATUS_ORDER = ["Not started", "Next up", "In progress", "Done"] as const;
export const PRIORITY_ORDER = ["High", "Medium", "Low", "None"] as const;
export const STATUS_BOARD_ORDER = ["In progress", "Next up", "Not started", "Done"] as const;

export function statusOf(fm: Record<string, unknown>): string {
  const raw = Array.isArray(fm.status) ? fm.status[0] : fm.status;
  const s = String(raw ?? "").trim().toLowerCase();
  const match = STATUS_ORDER.find((v) => v.toLowerCase() === s);
  if (match) return match;
  if (fm.done === true || s === "done") return "Done";
  if (s === "doing") return "In progress";
  return "Not started";
}

export function priorityOf(fm: Record<string, unknown>): string {
  const raw = Array.isArray(fm.priority) ? fm.priority[0] : fm.priority;
  const s = String(raw ?? "").trim().toLowerCase();
  return PRIORITY_ORDER.find((v) => v.toLowerCase() === s) ?? "None";
}

export interface ParsedTask {
  title: string;
  priority?: string;
  schedule?: string;
  deadline?: string;
  recur?: RecurRule;
}

const RECUR_UNIT: Record<string, RecurUnit> = {
  day: "day", days: "day", week: "week", weeks: "week",
  month: "month", months: "month", year: "year", years: "year",
};
const RECUR_WORD: Record<string, RecurUnit> = { daily: "day", weekly: "week", monthly: "month", yearly: "year", annually: "year" };

const WEEKDAYS: Record<string, number> = {
  domingo: 0, sunday: 0, sun: 0,
  segunda: 1, monday: 1, mon: 1,
  terca: 2, tuesday: 2, tue: 2,
  quarta: 3, wednesday: 3, wed: 3,
  quinta: 4, thursday: 4, thu: 4,
  sexta: 5, friday: 5, fri: 5,
  sabado: 6, saturday: 6, sat: 6,
};

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, janeiro: 0,
  feb: 1, february: 1, fev: 1, fevereiro: 1,
  mar: 2, march: 2, marco: 2, "março": 2,
  apr: 3, april: 3, abr: 3, abril: 3,
  may: 4, mai: 4, maio: 4,
  jun: 5, june: 5, junho: 5,
  jul: 6, july: 6, julho: 6,
  aug: 7, august: 7, ago: 7, agosto: 7,
  sep: 8, sept: 8, september: 8, set: 8, setembro: 8,
  oct: 9, october: 9, out: 9, outubro: 9,
  nov: 10, november: 10, novembro: 10,
  dec: 11, december: 11, dez: 11, dezembro: 11,
};
const MONTH_DAY = new RegExp(
  `\\s(?:(\\d{1,2})\\s+(${Object.keys(MONTHS).join("|")})|(${Object.keys(MONTHS).join("|")})\\s+(\\d{1,2}))(?:\\s+(\\d{4}))?(?=\\s)`,
  "i",
);

const norm = (w: string) => w.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => {
  const t = moment(`${y}-${pad(m)}-${pad(d)}`, "YYYY-MM-DD", true);
  return t.isValid() ? t.format("YYYY-MM-DD") : "";
};

function resolveDay(w: string): string {
  if (w === "today" || w === "hoje") return moment().format("YYYY-MM-DD");
  if (w === "tomorrow" || w === "amanha") return moment().add(1, "day").format("YYYY-MM-DD");
  const wd = WEEKDAYS[w];
  if (wd === undefined) return "";
  const target = moment().day(wd);
  if (target.isSameOrBefore(moment(), "day")) target.add(7, "days");
  return target.format("YYYY-MM-DD");
}

interface DateTime { date: string; time: string; rest: string }

function takeDateTime(s: string): DateTime {
  let time = "";
  const setTime = (h: number, m: number) => { if (h < 24 && m < 60) time = `T${pad(h)}:${pad(m)}`; };
  let mt: RegExpMatchArray | null;
  if ((mt = s.match(/\s(\d{1,2})(?::(\d{2}))?\s*([ap]m)(?=\s)/i))) {
    let h = Number(mt[1]) % 12;
    if (mt[3].toLowerCase() === "pm") h += 12;
    setTime(h, mt[2] ? Number(mt[2]) : 0);
    s = s.replace(mt[0], " ");
  } else if ((mt = s.match(/\s(\d{1,2})h(\d{2})?(?=\s)/i))) {
    setTime(Number(mt[1]), mt[2] ? Number(mt[2]) : 0);
    s = s.replace(mt[0], " ");
  } else if ((mt = s.match(/\s(\d{1,2}):(\d{2})(?=\s)/))) {
    setTime(Number(mt[1]), Number(mt[2]));
    s = s.replace(mt[0], " ");
  }

  let date = "";
  let md: RegExpMatchArray | null = null;
  const thisYear = moment().year();
  if ((md = s.match(/\s(\d{4})-(\d{1,2})-(\d{1,2})(?=\s)/))) {
    date = ymd(Number(md[1]), Number(md[2]), Number(md[3]));
  } else if ((md = s.match(/\s(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s)/))) {
    const y = md[3] ? (md[3].length === 2 ? 2000 + Number(md[3]) : Number(md[3])) : thisYear;
    date = ymd(y, Number(md[2]), Number(md[1]));
  } else if ((md = s.match(MONTH_DAY))) {
    date = ymd(md[5] ? Number(md[5]) : thisYear, MONTHS[norm(md[2] ?? md[3])] + 1, Number(md[1] ?? md[4]));
  }
  if (date && md) s = s.replace(md[0], " ");
  else for (const raw of s.trim().split(/\s+/)) {
    const d = resolveDay(norm(raw));
    if (d) { date = d; s = s.replace(` ${raw} `, "  "); break; }
  }
  return { date, time, rest: s };
}

const stamp = (d: DateTime) => (d.date || d.time ? (d.date || moment().format("YYYY-MM-DD")) + d.time : "");

export function parseTaskInput(text: string): ParsedTask {
  let s = ` ${text} `;
  const out: ParsedTask = { title: "" };

  const pri = s.match(/\s(!{1,3})(?=\s)/);
  if (pri) {
    out.priority = pri[1].length === 3 ? "High" : pri[1].length === 2 ? "Medium" : "Low";
    s = s.replace(pri[0], " ");
  }

  let rc: RegExpMatchArray | null;
  if ((rc = s.match(/\severy\s+(?:(\d+)\s+)?(days?|weeks?|months?|years?)(?=\s)/i))) {
    out.recur = { mode: "schedule", every: rc[1] ? Number(rc[1]) : 1, unit: RECUR_UNIT[rc[2].toLowerCase()] };
    s = s.replace(rc[0], " ");
  } else if ((rc = s.match(/\s(daily|weekly|monthly|yearly|annually)(?=(?:\s+(?:sun|sunday|domingo|mon|monday|segunda|tue|tuesday|terca|wed|wednesday|quarta|thu|thursday|quinta|fri|friday|sexta|sat|saturday|sabado))*\s*$)/i))) {
    out.recur = { mode: "schedule", every: 1, unit: RECUR_WORD[rc[1].toLowerCase()] };
    s = s.replace(rc[0], " ");
  }
  if (out.recur?.unit === "week") {
    const days: number[] = [];
    for (const raw of s.trim().split(/\s+/)) {
      const wd = WEEKDAYS[norm(raw)];
      if (wd !== undefined) { days.push(wd); s = s.replace(` ${raw} `, "  "); }
    }
    if (days.length) out.recur.weekdays = [...new Set(days)].sort((a, b) => a - b);
  }

  const due = s.match(/\s(due|by|deadline|prazo|ate|até)(?=\s)/i);
  const cut = due ? s.indexOf(due[0]) : -1;
  const before = takeDateTime(due ? `${s.slice(0, cut)} ` : s);
  const after = due ? takeDateTime(s.slice(cut + due[0].length)) : { date: "", time: "", rest: "" };

  if (!before.date && !after.date && out.recur?.weekdays?.length) {
    const t = moment().day(out.recur.weekdays[0]);
    if (t.isSameOrBefore(moment(), "day")) t.add(7, "days");
    before.date = t.format("YYYY-MM-DD");
  }

  const schedule = stamp(before);
  const deadline = stamp(after);
  if (deadline) {
    out.deadline = deadline;
    if (schedule) out.schedule = schedule;
  } else if (schedule) {
    if (due) out.deadline = schedule;
    else out.schedule = schedule;
  }

  out.title = `${before.rest} ${after.rest}`.replace(/\s+/g, " ").trim() || text.trim();
  return out;
}

const yaml = (v: string) => (/^[\w .\-/]+$/.test(v) ? v : JSON.stringify(v));

export interface TaskInput {
  title: string;
  priority?: string;
  schedule?: string;
  deadline?: string;
  context?: TFile;
  recur?: RecurRule;
}

export async function createTask(plugin: VitrinePlugin, input: TaskInput): Promise<TFile> {
  const { app } = plugin;
  const type = objectTypes(plugin).find((t) => t.id === "__task");
  const folder = type?.newNoteFolder || "Tasks";
  if (folder) await ensureFolder(app, folder);

  const lines = ["---", "object: __task", "status: Not started"];
  if (input.priority && input.priority !== "None") lines.push(`priority: ${input.priority}`);
  if (input.schedule) lines.push(`schedule: ${yaml(input.schedule)}`);
  if (input.deadline) lines.push(`deadline: ${yaml(input.deadline)}`);
  if (input.context) lines.push(`context: "[[${input.context.basename}]]"`);
  if (input.recur) {
    const r = input.recur;
    lines.push("recur:", `  mode: ${r.mode}`, `  every: ${r.every}`, `  unit: ${r.unit}`);
    if (r.weekdays?.length) { lines.push("  weekdays:"); for (const d of r.weekdays) lines.push(`    - ${d}`); }
    if (r.until) lines.push(`  until: "${r.until}"`);
    if (r.count) lines.push(`  count: ${r.count}`);
  }
  if (!nameFitsFile(input.title)) lines.push(`title: ${yaml(input.title)}`);
  lines.push("---", "");

  const path = await freePath(app, folder, safeName(input.title), "md");
  const file = await app.vault.create(path, lines.join("\n"));
  plugin.refreshViews();
  return file;
}

const CHECKBOX_RE = /^(\s*)- \[( |x|X)\] (.+)$/;

async function importFileCheckboxes(plugin: VitrinePlugin, file: TFile, lines: string[]): Promise<Set<number>> {
  const { app } = plugin;
  const matched = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(CHECKBOX_RE);
    if (!m) continue;
    const parsed = parseTaskInput(m[3].trim());
    const task = await createTask(plugin, { ...parsed, context: file });
    if (m[2].toLowerCase() === "x") await app.fileManager.processFrontMatter(task, (fm) => { fm.status = "Done"; });
    matched.add(i);
  }
  return matched;
}

export async function importCheckboxes(plugin: VitrinePlugin, file: TFile): Promise<number> {
  const { app } = plugin;
  const lines = (await app.vault.read(file)).split("\n");
  const hits = lines.filter((l) => CHECKBOX_RE.test(l)).length;
  if (!hits) return 0;
  if (!confirm(`Import ${hits} checkbox(es) from "${file.basename}" as tasks and remove the lines?`)) return 0;
  const matched = await importFileCheckboxes(plugin, file, lines);
  if (matched.size) await app.vault.modify(file, lines.filter((_, i) => !matched.has(i)).join("\n"));
  return matched.size;
}

export async function importAllCheckboxes(plugin: VitrinePlugin): Promise<number> {
  const { app } = plugin;
  const files = app.vault.getMarkdownFiles();
  const targets: Array<{ file: TFile; lines: string[]; hits: number }> = [];
  for (const file of files) {
    if (app.metadataCache.getFileCache(file)?.frontmatter?.object === "__task") continue;
    const lines = (await app.vault.read(file)).split("\n");
    const hits = lines.filter((l) => CHECKBOX_RE.test(l)).length;
    if (hits) targets.push({ file, lines, hits });
  }
  const total = targets.reduce((n, t) => n + t.hits, 0);
  if (!total) return 0;

  if (!confirm(`Import ${total} checkboxes from ${targets.length} notes as tasks and remove the lines?`)) return 0;

  let created = 0;
  for (const t of targets) {
    const matched = await importFileCheckboxes(plugin, t.file, t.lines);
    created += matched.size;
    if (matched.size) await app.vault.modify(t.file, t.lines.filter((_, i) => !matched.has(i)).join("\n"));
  }
  return created;
}

export interface TaskAlert {
  title: string;
  when: Date;
  key: string;
}

export async function promoteScheduledTasks(plugin: VitrinePlugin): Promise<void> {
  const type = objectTypes(plugin).find((t) => t.id === "__task");
  if (!type) return;
  const today = moment().format("YYYY-MM-DD");
  for (const f of objectsOfType(plugin, type)) {
    const fm = plugin.app.metadataCache.getFileCache(f)?.frontmatter ?? {};
    const s = statusOf(fm);
    if (s !== "Not started" && s !== "Next up") continue;
    if (String(fm.schedule ?? "").slice(0, 10) !== today) continue;
    await plugin.app.fileManager.processFrontMatter(f, (m) => { m.status = "In progress"; });
  }
}

export function scanTaskAlerts(plugin: VitrinePlugin): TaskAlert[] {
  const type = objectTypes(plugin).find((t) => t.id === "__task");
  if (!type) return [];
  const out: TaskAlert[] = [];
  for (const f of objectsOfType(plugin, type)) {
    const fm = plugin.app.metadataCache.getFileCache(f)?.frontmatter ?? {};
    if (statusOf(fm) === "Done") continue;
    for (const key of ["schedule", "deadline"] as const) {
      const s = String(fm[key] ?? "");
      if (!s.includes("T")) continue;
      const when = new Date(s);
      if (isNaN(when.getTime())) continue;
      out.push({ title: title(plugin.app, f) || f.basename, when, key: `${f.path}:${key}:${when.getTime()}` });
    }
  }
  return out;
}

export function demoParse(): void {
  const a = parseTaskInput("Prepare report !! tomorrow 2pm");
  console.assert(a.title === "Prepare report", a.title);
  console.assert(a.priority === "Medium", a.priority);
  console.assert(a.schedule === `${moment().add(1, "day").format("YYYY-MM-DD")}T14:00`, a.schedule);
  const b = parseTaskInput("Ship it by friday !!!");
  console.assert(b.title === "Ship it", b.title);
  console.assert(b.priority === "High" && !!b.deadline && !b.schedule, JSON.stringify(b));
  const c = parseTaskInput("just a plain task");
  console.assert(c.title === "just a plain task" && !c.priority && !c.schedule, JSON.stringify(c));
  const d = parseTaskInput("Standup weekly mon");
  console.assert(d.title === "Standup", d.title);
  console.assert(d.recur?.unit === "week" && d.recur.every === 1 && JSON.stringify(d.recur.weekdays) === "[1]", JSON.stringify(d.recur));
  const e = parseTaskInput("Backup every 2 weeks");
  console.assert(e.title === "Backup" && e.recur?.every === 2 && e.recur.unit === "week", JSON.stringify(e));
  const g = parseTaskInput("Read weekly newsletter");
  console.assert(!g.recur && g.title === "Read weekly newsletter", JSON.stringify(g));
}
