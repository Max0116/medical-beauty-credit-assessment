import { describe, expect, it } from 'vitest';
import { BACKEND_MODES, resolveBackendMode } from './apiServer.js';

describe('assessment API server mode resolution', () => {
  it('defaults to the PR22 proxy mode for rollback safety', () => {
    expect(resolveBackendMode('')).toBe(BACKEND_MODES.proxy);
    expect(resolveBackendMode('unexpected')).toBe(BACKEND_MODES.proxy);
  });

  it('accepts aliyun and dual_write rollout modes explicitly', () => {
    expect(resolveBackendMode('aliyun')).toBe(BACKEND_MODES.aliyun);
    expect(resolveBackendMode('dual_write')).toBe(BACKEND_MODES.dualWrite);
  });
});
