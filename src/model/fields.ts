export function asList(value: unknown): string[] {
  if (value == null) return [];
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .flatMap((v) => (typeof v === "string" ? v.split(",") : [v]))
    .map((v) => String(v).trim())
    .filter((v) => v.length > 0);
}

export function asText(value: unknown): string | undefined {
  if (Array.isArray(value)) return asList(value)[0];
  if (value == null) return undefined;
  const s = String(value).trim();
  return s.length ? s : undefined;
}

export function splitFrontmatter(md: string): { fm: string; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  return m ? { fm: m[1], body: md.slice(m[0].length) } : { fm: "", body: md };
}

export function asNumber(value: unknown): number | undefined {
  const text = asText(value);
  if (text === undefined) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

export function asYear(value: unknown): number | undefined {
  const text = asText(value);
  if (text === undefined) return undefined;
  const match = text.match(/\d{4}/);
  return match ? Number(match[0]) : undefined;
}

export function sameText(a: unknown, b: unknown): boolean {
  return String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
}

export function byOrder<T extends { order?: number; title: string }>(a: T, b: T): number {
  const oa = a.order ?? Infinity;
  const ob = b.order ?? Infinity;
  if (oa !== ob) return oa - ob;
  return a.title.localeCompare(b.title, undefined, { numeric: true });
}

export function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function selectOptions(options: string[] | undefined, value: unknown): string[] {
  const opts = options ?? [];
  return [...opts, ...asList(value).filter((v) => !opts.includes(v))];
}

export function toggleSelect(options: string[], values: string[], v: string): string[] {
  const next = values.includes(v) ? values.filter((x) => x !== v) : [...values, v];
  return options.filter((o) => next.includes(o));
}

export function formatRating(value: number | undefined): string {
  if (value === undefined) return "";
  return value.toFixed(1);
}

export function keepShape(existing: unknown, value: string | number | undefined): unknown {
  if (value === undefined || value === "") return undefined;
  return Array.isArray(existing) ? [value] : value;
}

export function templateFields(fm: string, skip: Set<string>): string[] {
  const out: string[] = [];
  let keep = false;
  for (const line of fm.split(/\r?\n/)) {
    const key = line.match(/^([^\s:#][^:]*):/)?.[1];
    if (key) keep = !skip.has(key.trim().toLowerCase());
    else if (!line.trim()) keep = false;
    if (keep) out.push(line);
  }
  return out;
}
