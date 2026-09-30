import type { Capture, Period } from '@/lib/types';
import type { CompleteFn } from '@/lib/ai/types';
import { MODELS, TIMEOUTS } from '@/lib/ai/models';
import { claudeComplete } from '@/lib/claude';

export type DigestCapture = Pick<Capture, 'type' | 'title' | 'summary' | 'context' | 'status' | 'captured_at'>;

// The language rule is adapted from LANGUAGE_RULE (per-note) because a digest spans many notes.
const SYSTEM = `You write a short digest of a person's captured ideas and tasks so they can plan a laptop work session.
Reply in Markdown with exactly these sections:
## Overview (2-3 sentences)
## Highlights (grouped by type; one bullet per notable item)
## Suggested priorities (at most 5; favor status "inbox" and context "laptop")
Be brief. Use the dominant language of the captures. If it is Chinese, use Traditional Chinese (繁體中文), never Simplified. Keep technical terms in English.`;

export async function generateDigest(
  captures: DigestCapture[],
  period: Period,
  complete: CompleteFn = claudeComplete,
): Promise<string> {
  const label = period === 'day' ? 'today' : 'this week';
  const text = await complete({
    model: MODELS.digest,
    system: SYSTEM,
    prompt: `Captures from ${label}, one JSON object per line:\n${captures.map((c) => JSON.stringify(c)).join('\n')}`,
    maxTokens: 2000,
    timeoutMs: TIMEOUTS.sonnet,
    tag: `digest:${period}`,
  });
  const markdown = text.trim();
  if (!markdown) throw new Error('Empty digest from model');
  return markdown;
}
