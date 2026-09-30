import type { Capture } from '@/lib/types';
import type { CompleteFn } from '@/lib/ai/types';
import { MODELS, TIMEOUTS } from '@/lib/ai/models';
import { LANGUAGE_RULE, MAX_PROMPT_CHARS } from '@/lib/ai/process';
import { claudeComplete } from '@/lib/claude';

const SYSTEM = `You turn a captured idea or task into a concise, practical spec the user can act on at their laptop.
Reply in Markdown with exactly these sections:
## Goal
## Context
## Requirements
## Open questions
## Suggested first steps
## Claude Code prompt
The last section is one fenced code block containing a ready-to-paste prompt that asks Claude Code to start building or doing this.
Be concrete and brief; do not invent requirements the note does not imply — list them as open questions instead.
${LANGUAGE_RULE}`;

export function buildSpecPrompt(c: Capture): string {
  return [
    `<capture>\n${c.raw_text.slice(0, MAX_PROMPT_CHARS)}\n</capture>`,
    `Title: ${c.title ?? ''}`,
    `Summary: ${c.summary ?? ''}`,
    `Type: ${c.type ?? 'unknown'}`,
    `Next steps:\n${c.next_steps.map((s) => `- ${s}`).join('\n')}`,
  ].join('\n\n');
}

export async function generateSpec(c: Capture, complete: CompleteFn = claudeComplete): Promise<string> {
  const text = await complete({
    model: MODELS.spec,
    system: SYSTEM,
    prompt: buildSpecPrompt(c),
    maxTokens: 3000,
    timeoutMs: TIMEOUTS.sonnet,
    tag: `spec:${c.id}`,
  });
  const markdown = text.trim();
  if (!markdown) throw new Error('Empty spec from model');
  return markdown;
}
