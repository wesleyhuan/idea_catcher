export type CompleteRequest = {
  model: string;
  system: string;
  prompt: string;
  maxTokens: number;
  timeoutMs: number;
  tag: string; // shows up in logs, e.g. "process:<id>"
};

export type CompleteFn = (req: CompleteRequest) => Promise<string>;
