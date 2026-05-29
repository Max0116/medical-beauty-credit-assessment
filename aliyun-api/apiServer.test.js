import { describe, expect, it } from 'vitest';
import { BACKEND_MODES, createAssessmentApiServer, resolveBackendMode } from './apiServer.js';

describe('assessment API server mode resolution', () => {
  it('defaults to the PR22 proxy mode for rollback safety', () => {
    expect(resolveBackendMode('')).toBe(BACKEND_MODES.proxy);
    expect(resolveBackendMode('unexpected')).toBe(BACKEND_MODES.proxy);
  });

  it('accepts aliyun and dual_write rollout modes explicitly', () => {
    expect(resolveBackendMode('aliyun')).toBe(BACKEND_MODES.aliyun);
    expect(resolveBackendMode('dual_write')).toBe(BACKEND_MODES.dualWrite);
  });

  it('requires RDS configuration for aliyun and dual_write modes', () => {
    expect(() => createAssessmentApiServer({
      env: {
        MEDICAL_CREDIT_BACKEND_MODE: 'aliyun'
      }
    })).toThrow('ALIYUN_RDS_HOST is required');
    expect(() => createAssessmentApiServer({
      env: {
        MEDICAL_CREDIT_BACKEND_MODE: 'dual_write'
      }
    })).toThrow('ALIYUN_RDS_HOST is required');
  });
});
