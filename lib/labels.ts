import type { CaptureContext, CaptureEffort, CaptureType } from '@/lib/types';

export const TYPE_ICONS: Record<CaptureType, string> = {
  idea: '💡', todo: '✅', reminder: '⏰', reference: '📎', question: '❓',
};
export const CONTEXT_LABELS: Record<CaptureContext, string> = {
  laptop: '💻 Laptop', phone: '📱 Phone', anywhere: '🌐 Anywhere',
};
export const EFFORT_LABELS: Record<CaptureEffort, string> = {
  quick: '< 15m', medium: '< 1h', long: '1h+',
};

export function timeAgo(iso: string, now = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
