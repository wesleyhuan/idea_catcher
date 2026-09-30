// Best-effort, per server instance. Move to a shared store before opening to other users.
const hits = new Map<string, number[]>();

export function checkRateLimit(key: string, limit: number, windowMs = 60_000, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  const allowed = recent.length < limit;
  if (allowed) recent.push(now);
  hits.set(key, recent);
  return allowed;
}
