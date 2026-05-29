import { describe, expect, it } from 'vitest';
import {
  buildHealthExpectationsFromEnv,
  parseOptionalBoolean,
  validateAliyunHealth
} from './aliyun-health.mjs';

describe('Aliyun health validation', () => {
  it('accepts PR23 ready aliyun mode with configured storage and verification', () => {
    const validation = validateAliyunHealth({
      ok: true,
      ready: true,
      mode: 'aliyun',
      backend: { ok: true, database: 'postgres' },
      storage: { ok: true, configured: true, provider: 'aliyun-oss' },
      verification: { ok: true, configured: true, provider: 'zhipu_web_search' }
    }, {
      expectReady: true,
      expectedMode: 'aliyun,dual_write',
      expectedBackendDatabase: 'postgres',
      expectStorageConfigured: true,
      expectVerificationConfigured: true
    });

    expect(validation).toMatchObject({
      ok: true,
      errors: []
    });
  });

  it('reports component-level readiness mismatches', () => {
    const validation = validateAliyunHealth({
      ok: true,
      ready: false,
      mode: 'proxy',
      backend: { ok: true },
      storage: { configured: false },
      verification: { configured: false }
    }, {
      expectReady: true,
      expectedMode: 'aliyun',
      expectedBackendDatabase: 'postgres',
      expectStorageConfigured: true,
      expectVerificationConfigured: true
    });

    expect(validation.ok).toBe(false);
    expect(validation.errors).toEqual([
      'Expected mode aliyun, got proxy.',
      'Expected ready=true, got false.',
      'Expected backend.database=postgres, got empty.',
      'Expected storage.configured=true, got false.',
      'Expected verification.configured=true, got false.'
    ]);
  });

  it('parses optional boolean smoke expectations', () => {
    expect(parseOptionalBoolean(undefined)).toBeUndefined();
    expect(parseOptionalBoolean('true')).toBe(true);
    expect(parseOptionalBoolean('0')).toBe(false);
    expect(() => parseOptionalBoolean('maybe')).toThrow('Invalid boolean value');

    expect(buildHealthExpectationsFromEnv({
      SMOKE_EXPECT_API_READY: 'true',
      SMOKE_EXPECT_BACKEND_MODE: 'dual_write',
      SMOKE_EXPECT_STORAGE_CONFIGURED: 'false'
    }, 'SMOKE')).toMatchObject({
      expectReady: true,
      expectedMode: 'dual_write',
      expectStorageConfigured: false
    });
  });
});
