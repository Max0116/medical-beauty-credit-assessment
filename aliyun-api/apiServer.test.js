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

  it('can bootstrap aliyun mode against an explicit MySQL-compatible RDS target', () => {
    const server = createAssessmentApiServer({
      env: {
        MEDICAL_CREDIT_BACKEND_MODE: 'aliyun',
        ALIYUN_DB_DRIVER: 'mysql',
        ALIYUN_MYSQL_HOST: '127.0.0.1',
        ALIYUN_MYSQL_DATABASE: 'medical_credit_assessment',
        ALIYUN_MYSQL_USER: 'medical_credit_app',
        ALIYUN_MYSQL_PASSWORD: 'secret'
      }
    });
    expect(server).toBeTruthy();
    server.close();
  });
});
