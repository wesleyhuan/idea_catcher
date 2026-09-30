import { z } from 'zod';
import { CAPTURE_TYPES, CONTEXTS, EFFORTS } from '@/lib/types';
import type { CompleteFn } from '@/lib/ai/types';
import { MODELS, TIMEOUTS } from '@/lib/ai/models';
import { extractJson } from '@/lib/ai/json';
import { claudeComplete } from '@/lib/claude';
import { logger } from '@/lib/logger';

const log = logger('ai/process');

export const MAX_PROMPT_CHARS = 8000;

export const ProcessResultSchema = z.object({
  type: z.enum(CAPTURE_TYPES),
  title: z.string().min(1).max(120),
  summary: z.string().max(1000),
  next_steps: z.array(z.string().min(1).max(300)).max(5),
  context: z.enum(CONTEXTS),
  effort: z.enum(EFFORTS),
});
export type ProcessResult = z.infer<typeof ProcessResultSchema>;

export const LANGUAGE_RULE =
  "Write in the note's dominant language. If it is Chinese, use Traditional Chinese (繁體中文), never Simplified. Keep technical terms in English.";

const SYSTEM = `You organize quick personal captures (ideas, chores) that were typed or dictated on a phone, often in mixed Chinese and English.
Reply with ONLY a JSON object, no prose, with exactly these keys:
- "type": one of "idea", "todo", "reminder", "reference", "question"
- "title": a short clean title, at most 60 characters
- "summary": 1-2 sentences
- "next_steps": 1-3 concrete actions (array of strings)
- "context": where the next step is best done: "laptop", "phone" or "anywhere"
- "effort": "quick" (under 15 min), "medium" (under 1 hour) or "long"
${LANGUAGE_RULE} Fix obvious dictation mistakes.`;

export function buildProcessPrompt(rawText: string): string {
  const text = rawText.length > MAX_PROMPT_CHARS
    ? `${rawText.slice(0, MAX_PROMPT_CHARS)}\n[truncated]`
    : rawText;
  return `<capture>\n${text}\n</capture>`;
}

export function parseProcessResult(text: string): ProcessResult {
  const result = ProcessResultSchema.safeParse(extractJson(text));
  if (!result.success) {
    log.error('model output failed validation', { text, issues: result.error.issues });
    throw new Error(`Invalid AI result: ${result.error.message}`);
  }
  return result.data;
}

export async function processText(rawText: string, complete: CompleteFn = claudeComplete): Promise<ProcessResult> {
  const text = await complete({
    model: MODELS.process,
    system: SYSTEM,
    prompt: buildProcessPrompt(rawText),
    maxTokens: 800,
    timeoutMs: TIMEOUTS.haiku,
    tag: 'process',
  });
  return parseProcessResult(text);
}
