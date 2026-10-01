import type { SupabaseClient } from '@supabase/supabase-js';
import type { Capture } from '@/lib/types';
import type { ProcessResult } from '@/lib/ai/process';

export type CaptureRepo = {
  get(id: string): Promise<Capture | null>;
  markAttempt(id: string, attempts: number): Promise<void>;
  /** Returns false when the user edited the capture meanwhile (nothing written). */
  saveResult(id: string, result: ProcessResult): Promise<boolean>;
  markFailed(id: string, message: string): Promise<void>;
  saveSpec(id: string, markdown: string): Promise<void>;
};

export function makeCaptureRepo(db: SupabaseClient): CaptureRepo {
  const captures = () => db.from('captures');
  const check = ({ error }: { error: unknown }) => {
    if (error) throw error;
  };

  return {
    async get(id) {
      const { data, error } = await captures().select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      return data as Capture | null;
    },
    async markAttempt(id, attempts) {
      check(await captures().update({ processing_attempts: attempts }).eq('id', id));
    },
    async saveResult(id, result) {
      const { data, error } = await captures()
        .update({ ...result, processing: 'done', processing_error: null })
        .eq('id', id)
        .eq('user_edited', false)
        .select('id');
      if (error) throw error;
      return data.length > 0;
    },
    async markFailed(id, message) {
      // A user edit made while the AI call was running already resolved the capture.
      check(await captures()
        .update({ processing: 'failed', processing_error: message })
        .eq('id', id)
        .eq('user_edited', false));
    },
    async saveSpec(id, markdown) {
      check(await captures().update({ spec_md: markdown }).eq('id', id));
    },
  };
}
