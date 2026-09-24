import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';

afterEach(() => vi.restoreAllMocks());

describe('logger', () => {
  it('prefixes the module and passes context', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    logger('sync').info('hello', { n: 1 });
    expect(spy).toHaveBeenCalledWith('[sync] hello', { n: 1 });
  });

  it('omits context when not given', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger('api/process').error('boom');
    expect(spy).toHaveBeenCalledWith('[api/process] boom');
  });
});
