import { describe, expect, it, vi } from 'vitest';
import {
  parseVerifierBoolean,
  verifyAliyunMigration,
  verifyOssAttachments
} from './aliyun-migration-verifier.mjs';

describe('Aliyun migration verifier', () => {
  it('verifies RDS row counts against a Supabase backup manifest', async () => {
    const pool = createFakePool({
      assessment_records: 3,
      assessment_drafts: 1
    });
    const result = await verifyAliyunMigration({
      pool,
      backupDir: '/tmp/backup',
      readFileImpl: createBackupReader({
        manifest: {
          type: 'supabase_pre_migration_backup',
          tables: [
            { table: 'assessment_records', rows: 2 },
            { table: 'assessment_drafts', rows: 1 }
          ],
          evidenceAttachments: { file: 'evidence-attachments.json', count: 1 }
        },
        evidenceAttachments: [
          { path: 'client-1/record-1/evidence.png' }
        ]
      }),
      logger: { warn: vi.fn() }
    });

    expect(result).toMatchObject({
      ok: true,
      dialect: 'postgres',
      exactCounts: false,
      checkOss: false,
      tables: [
        { table: 'assessment_records', expectedRows: 2, targetRows: 3, ok: true },
        { table: 'assessment_drafts', expectedRows: 1, targetRows: 1, ok: true }
      ],
      evidenceAttachments: {
        checked: false,
        expected: 1
      }
    });
  });

  it('uses MySQL count syntax when verifying a MySQL-compatible RDS target', async () => {
    const pool = createFakePool({ assessment_records: 1 });
    const result = await verifyAliyunMigration({
      pool,
      dialect: 'mysql',
      backupDir: '/tmp/backup',
      readFileImpl: createBackupReader({
        manifest: {
          type: 'supabase_pre_migration_backup',
          tables: [{ table: 'assessment_records', rows: 1 }],
          evidenceAttachments: { file: 'evidence-attachments.json', count: 0 }
        },
        evidenceAttachments: []
      }),
      logger: { warn: vi.fn() }
    });

    expect(result).toMatchObject({ ok: true, dialect: 'mysql' });
    expect(pool.queries[0]).toBe('select count(*) as count from assessment_records');
  });

  it('fails when exact counts do not match', async () => {
    const pool = createFakePool({ assessment_records: 3 });
    const result = await verifyAliyunMigration({
      pool,
      backupDir: '/tmp/backup',
      exactCounts: true,
      readFileImpl: createBackupReader({
        manifest: {
          type: 'supabase_pre_migration_backup',
          tables: [{ table: 'assessment_records', rows: 2 }],
          evidenceAttachments: { file: 'evidence-attachments.json', count: 0 }
        },
        evidenceAttachments: []
      }),
      logger: { warn: vi.fn() }
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        type: 'table_count_mismatch',
        table: 'assessment_records',
        expectedRows: 2,
        targetRows: 3,
        exactCounts: true
      }
    ]);
  });

  it('checks OSS attachments when requested', async () => {
    const ossClient = {
      head: vi.fn(async (path) => {
        if (path.includes('missing')) throw new Error('not found');
        return { status: 200 };
      })
    };

    const result = await verifyOssAttachments({
      ossClient,
      attachments: [
        { path: 'client-1/record-1/ok.png' },
        { path: 'client-1/record-1/missing.png' }
      ],
      logger: { warn: vi.fn() }
    });

    expect(result).toMatchObject({
      checked: true,
      expected: 2,
      found: 1,
      missing: 1,
      failures: [
        {
          path: 'client-1/record-1/missing.png',
          errorMessage: 'not found'
        }
      ]
    });
  });

  it('parses verifier booleans', () => {
    expect(parseVerifierBoolean(undefined)).toBe(false);
    expect(parseVerifierBoolean(undefined, true)).toBe(true);
    expect(parseVerifierBoolean('true')).toBe(true);
    expect(parseVerifierBoolean('off')).toBe(false);
    expect(() => parseVerifierBoolean('sometimes')).toThrow('Invalid boolean value');
  });
});

function createFakePool(counts = {}) {
  return {
    queries: [],
    async query(sql) {
      this.queries.push(sql);
      const table = String(sql).match(/from\s+([a-z_]+)/i)?.[1];
      return { rows: [{ count: counts[table] ?? 0 }] };
    }
  };
}

function createBackupReader({ manifest, evidenceAttachments }) {
  return async (filePath) => {
    if (String(filePath).endsWith('/manifest.json')) return JSON.stringify(manifest);
    if (String(filePath).endsWith('/evidence-attachments.json')) return JSON.stringify(evidenceAttachments);
    throw new Error(`unexpected read ${filePath}`);
  };
}
