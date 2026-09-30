import type { Period } from '@/lib/types';

const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Local-time range of the day or Monday-based week containing `now`. */
export function periodRange(period: Period, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(end.getDate() + (period === 'week' ? 7 : 1));
  return { period, period_start: localDate(start), from: start.toISOString(), to: end.toISOString() };
}
