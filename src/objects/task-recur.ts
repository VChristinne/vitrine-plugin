import { App, TFile, moment } from "obsidian";

export type RecurUnit = "day" | "week" | "month" | "year";
export type OccState = "completed" | "skipped" | "excused";

export interface RecurRule {
  mode: "schedule" | "completion";
  every: number;
  unit: RecurUnit;
  weekdays?: number[];
  until?: string;
  count?: number;
}

export interface Occurrence {
  date: string;
  status: OccState;
  at?: string;
}

const ISO = "YYYY-MM-DD";
const today = () => moment().format(ISO);
const dateOnly = (v: unknown) => String(v ?? "").slice(0, 10);

export function isRecurring(fm: Record<string, unknown>): boolean {
  const r = fm.recur as RecurRule | undefined;
  return !!r && typeof r === "object" && Number(r.every) > 0 && !!r.unit;
}

function nextWeekly(fromISO: string, weekdays: number[], every: number): string {
  const from = moment(fromISO, ISO);
  const sorted = [...weekdays].sort((a, b) => a - b);
  for (const wd of sorted) if (wd > from.day()) return from.clone().day(wd).format(ISO);
  return from.clone().add(Math.max(1, every), "week").day(sorted[0]).format(ISO);
}

export function nextDate(rule: RecurRule, fromISO: string, completedISO?: string): string {
  const anchor = rule.mode === "completion" ? completedISO ?? today() : fromISO;
  if (rule.unit === "week" && rule.weekdays?.length) return nextWeekly(anchor, rule.weekdays, rule.every);
  return moment(anchor, ISO).add(rule.every, rule.unit).format(ISO);
}

const withDate = (orig: unknown, date: string) => date + String(orig ?? "").slice(10);

async function act(app: App, file: TFile, status: OccState): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm) => {
    if (!isRecurring(fm)) return;
    const rule = fm.recur as RecurRule;
    const hasSched = !!dateOnly(fm.schedule);
    const anchor = hasSched ? dateOnly(fm.schedule) : (dateOnly(fm.deadline) || today());
    const now = today();
    const log = ((fm.occurrences as Occurrence[]) ??= []);
    log.push({ date: anchor, status, at: now });

    const next = nextDate(rule, anchor, now);
    if (rule.until && next > rule.until) { fm.status = "Done"; return; }
    if (rule.count && log.length >= rule.count) { fm.status = "Done"; return; }
    const delta = moment(next, ISO).diff(moment(anchor, ISO), "days");
    if (hasSched) {
      fm.schedule = withDate(fm.schedule, next);
      if (fm.deadline) fm.deadline = withDate(fm.deadline, moment(dateOnly(fm.deadline), ISO).add(delta, "day").format(ISO));
    } else if (fm.deadline) {
      fm.deadline = withDate(fm.deadline, next);
    } else {
      fm.schedule = next;
    }
    fm.status = "Not started";
  });
}

export const completeOccurrence = (app: App, file: TFile) => act(app, file, "completed");
export const skipOccurrence = (app: App, file: TFile) => act(app, file, "skipped");
export const excuseOccurrence = (app: App, file: TFile) => act(app, file, "excused");

export function demoRecur(): void {
  const day: RecurRule = { mode: "schedule", every: 3, unit: "day" };
  console.assert(nextDate(day, "2026-08-20") === "2026-08-23", nextDate(day, "2026-08-20"));
  const month: RecurRule = { mode: "schedule", every: 1, unit: "month" };
  console.assert(nextDate(month, "2026-01-31") === "2026-02-28", nextDate(month, "2026-01-31"));
  const comp: RecurRule = { mode: "completion", every: 2, unit: "week" };
  console.assert(nextDate(comp, "2026-08-20", "2026-09-01") === "2026-09-15", nextDate(comp, "2026-08-20", "2026-09-01"));
  const wd: RecurRule = { mode: "schedule", every: 1, unit: "week", weekdays: [1, 3] };
  console.assert(nextDate(wd, "2026-08-20") === "2026-08-24", nextDate(wd, "2026-08-20"));
}
