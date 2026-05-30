import { describe, expect, it, vi } from 'vitest';
import {
  backupSupabaseForAliyunMigration,
  createDefaultBackupDir
} from './supabase-backup.mjs';

describe('Supabase pre-migration backup', () => {
  it('writes table snapshots, evidence manifest, and backup manifest', async () => {
    const writes = new Map();
    const mkdirImpl = vi.fn(async () => {});
    const writeFileImpl = vi.fn(async (filePath, content) => {
      writes.set(filePath, JSON.parse(content));
    });
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('/rest/v1/assessment_records')) {
        return createTextResponse([
          {
            id: 'record-1',
            institution_name: '上海星澜医疗美容诊所'
          }
        ]);
      }
      if (url.includes('/rest/v1/verification_reviews')) {
        return createTextResponse([
          {
            id: 'review-1',
            evidence_attachments: [
              {
                id: 'attachment-1',
                bucket: 'verification-evidence',
                path: 'client-1/record-1/evidence.png',
                fileName: 'evidence.png',
                mimeType: 'image/png'
              }
            ]
          }
        ]);
      }
      return createTextResponse([]);
    });

    const summary = await backupSupabaseForAliyunMigration({
      supabaseUrl: 'https://demo.supabase.co',
      serviceRoleKey: 'service-role-secret',
      outputDir: '/tmp/medical-credit-backup',
      tableNames: ['assessment_records', 'verification_reviews'],
      fetchImpl,
      mkdirImpl,
      writeFileImpl,
      now: () => new Date('2026-05-30T00:00:00.000Z'),
      logger: { info: vi.fn() }
    });

    expect(summary).toMatchObject({
      ok: true,
      outputDir: '/tmp/medical-credit-backup',
      tables: [
        { table: 'assessment_records', rows: 1, batches: 1 },
        { table: 'verification_reviews', rows: 1, batches: 1 }
      ],
      evidenceAttachments: {
        file: 'evidence-attachments.json',
        count: 1
      }
    });
    expect(mkdirImpl).toHaveBeenCalledWith('/tmp/medical-credit-backup', { recursive: true });
    expect(writes.get('/tmp/medical-credit-backup/assessment_records.json')).toEqual([
      {
        id: 'record-1',
        institution_name: '上海星澜医疗美容诊所'
      }
    ]);
    expect(writes.get('/tmp/medical-credit-backup/evidence-attachments.json')).toEqual([
      expect.objectContaining({
        id: 'attachment-1',
        path: 'client-1/record-1/evidence.png'
      })
    ]);
    expect(writes.get('/tmp/medical-credit-backup/manifest.json')).toMatchObject({
      type: 'supabase_pre_migration_backup',
      completedAt: '2026-05-30T00:00:00.000Z'
    });
  });

  it('creates deterministic default backup directories', () => {
    const dir = createDefaultBackupDir(() => new Date('2026-05-30T08:09:10.000Z'));
    expect(dir).toContain('backups/supabase-pre-aliyun-20260530T080910Z');
  });
});

function createTextResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  };
}
