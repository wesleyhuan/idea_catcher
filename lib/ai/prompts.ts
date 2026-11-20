/** Shared by every prompt built from a capture's raw text. */

/** Longer dictation is cut here rather than rejected, to bound the prompt size. */
export const MAX_PROMPT_CHARS = 8000;

/** Output language for anything written about a single note. */
export const LANGUAGE_RULE =
  "Write in the note's dominant language. If it is Chinese, use Traditional Chinese (繁體中文), never Simplified. Keep technical terms in English.";
