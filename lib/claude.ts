import Anthropic from '@anthropic-ai/sdk';
import type { CompleteFn } from '@/lib/ai/types';
import { logger } from '@/lib/logger';

const log = logger('claude');
let client: Anthropic | null = null;

export const claudeComplete: CompleteFn = async ({ model, system, prompt, maxTokens, timeoutMs, tag }) => {
  client ??= new Anthropic(); // reads ANTHROPIC_API_KEY
  const started = Date.now();
  try {
    const msg = await client.messages.create(
      { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] },
      { timeout: timeoutMs, maxRetries: 1 },
    );
    log.info('ok', { tag, model, ms: Date.now() - started, usage: msg.usage, stop: msg.stop_reason });
    if (msg.stop_reason === 'max_tokens') log.warn('output truncated', { tag, maxTokens });
    return msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  } catch (err) {
    log.error('request failed', { tag, model, ms: Date.now() - started, err });
    throw err;
  }
};
