export const MODELS = {
  process: 'claude-haiku-4-5-20251001',
  spec: 'claude-sonnet-5',
  digest: 'claude-sonnet-5',
} as const;

export const TIMEOUTS = { haiku: 30_000, sonnet: 90_000 } as const;
