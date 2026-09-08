export function cleanValue(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map((x) => cleanValue(x)).filter(Boolean).join(", ");
  let s = String(v).trim();
  const m = s.match(/^\[\[([^\]]+)\]\]$/);
  if (m) s = m[1];
  const bar = s.indexOf("|");
  if (bar >= 0) s = s.slice(bar + 1);
  const hash = s.indexOf("#");
  if (hash >= 0) s = s.slice(hash + 1);
  return s.trim();
}
