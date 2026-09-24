export const CAPTURE_TYPES = ['idea', 'todo', 'reminder', 'reference', 'question'] as const;
export const CONTEXTS = ['laptop', 'phone', 'anywhere'] as const;
export const EFFORTS = ['quick', 'medium', 'long'] as const;
export const STATUSES = ['inbox', 'done', 'archived'] as const;
export const PERIODS = ['day', 'week'] as const;

export type CaptureType = (typeof CAPTURE_TYPES)[number];
export type CaptureContext = (typeof CONTEXTS)[number];
export type CaptureEffort = (typeof EFFORTS)[number];
export type CaptureStatus = (typeof STATUSES)[number];
export type Period = (typeof PERIODS)[number];
export type ProcessingState = 'pending' | 'done' | 'failed';

export type Capture = {
  id: string;
  user_id: string;
  client_id: string;
  raw_text: string;
  captured_at: string;
  status: CaptureStatus;
  processing: ProcessingState;
  processing_error: string | null;
  processing_attempts: number;
  type: CaptureType | null;
  title: string | null;
  summary: string | null;
  next_steps: string[];
  context: CaptureContext | null;
  effort: CaptureEffort | null;
  user_edited: boolean;
  spec_md: string | null;
};
