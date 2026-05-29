import { describe, expect, it, vi } from 'vitest';
import {
  buildUpsertQuery,
  fetchSupabaseTableBatches,
  migrateSupabaseToRds,
  normalizeMigratedRow,
  parseTableNames,
  resolveTableConfigs,
  SUPABASE_RDS_TABLES
} from './supabase-rds-migration.mjs';

describe('Supabase to Aliyun RDS migration helpers', () => {
  it('fetches Supabase rows in ranged batches without logging secrets', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, options) => {
      calls.push({ url, headers: options.headers });
      const range = options.headers.Range;
      if (range === '0-1') return createJsonResponse([{ id: 'record-1' }, { id: 'record-2' }]);
      if (range === '2-3') return createJsonResponse([{ id: 'record-3' }]);
      return createJsonResponse([]);
    });

    const batches = [];
    for await (const rows of fetchSupabaseTableBatches({
      supabaseUrl: 'https://demo.supabase.co/',
      serviceRoleKey: 'service-role-secret',
      tableName: 'assessment_records',
      batchSize: 2,
      fetchImpl
    })) {
      batches.push(rows);
    }

    expect(batches).toEqual([
      [{ id: 'record-1' }, { id: 'record-2' }],
      [{ id: 'record-3' }]
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(calls[0]).toMatchObject({
      url: 'https://demo.supabase.co/rest/v1/assessment_records?select=*',
      headers: {
        apikey: 'service-role-secret',
        Authorization: 'Bearer service-role-secret',
        Range: '0-1',
        'Range-Unit': 'items'
      }
    });
  });

  it('builds parameterized upsert SQL and serializes jsonb columns', () => {
    const table = SUPABASE_RDS_TABLES.find((item) => item.name === 'verification_reviews');
    const query = buildUpsertQuery(table, {
      id: 'review-1',
      assessment_record_id: 'record-1',
      verification_log_id: null,
      client_instance_id: 'client-1',
      action: 'accept_suggestion',
      reviewer_name: '复核人',
      reviewer_decision: 'serious',
      verification_snapshot: { judgmentLabel: '疑似红线' },
      applied_fields: { publicCreditStatus: 'serious' },
      created_at: '2026-05-30T00:00:00.000Z'
    });

    expect(query.sql).toContain('insert into verification_reviews');
    expect(query.sql).toContain('on conflict (id) do update set');
    expect(query.sql).toContain('$12::jsonb');
    expect(query.sql).toContain('$13::jsonb');
    expect(query.sql).toContain('$14::jsonb');
    expect(query.values[11]).toBe(JSON.stringify({ judgmentLabel: '疑似红线' }));
    expect(query.values[12]).toBe(JSON.stringify({ publicCreditStatus: 'serious' }));
    expect(query.values[13]).toBe(JSON.stringify([]));
  });

  it('migrates requested tables into RDS with dry-run support', async () => {
    const pool = {
      calls: [],
      query: vi.fn(async (sql, values) => {
        pool.calls.push({ sql, values });
        return { rows: [], rowCount: 1 };
      })
    };
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('/assessment_drafts')) {
        return createJsonResponse([
          {
            client_instance_id: 'client-1',
            form_snapshot: { institutionName: '上海星澜' },
            created_at: '2026-05-30T00:00:00.000Z',
            updated_at: '2026-05-30T00:00:00.000Z'
          }
        ]);
      }
      return createJsonResponse([]);
    });

    const summary = await migrateSupabaseToRds({
      pool,
      supabaseUrl: 'https://demo.supabase.co',
      serviceRoleKey: 'service-role-secret',
      tableNames: ['assessment_drafts'],
      fetchImpl,
      logger: { info: vi.fn() }
    });

    expect(summary).toMatchObject({
      ok: true,
      dryRun: false,
      tables: [
        {
          table: 'assessment_drafts',
          fetched: 1,
          upserted: 1,
          batches: 1
        }
      ]
    });
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.calls[0].sql).toContain('on conflict (client_instance_id) do update set');

    const dryRunSummary = await migrateSupabaseToRds({
      pool,
      supabaseUrl: 'https://demo.supabase.co',
      serviceRoleKey: 'service-role-secret',
      tableNames: ['assessment_drafts'],
      fetchImpl,
      dryRun: true,
      logger: { info: vi.fn() }
    });
    expect(dryRunSummary.tables[0]).toMatchObject({ fetched: 1, upserted: 0 });
  });

  it('parses explicit table lists and rejects unknown tables', () => {
    expect(parseTableNames('assessment_records, verification_logs')).toEqual(['assessment_records', 'verification_logs']);
    expect(parseTableNames('')).toEqual(SUPABASE_RDS_TABLES.map((table) => table.name));

    expect(resolveTableConfigs(['assessment_records']).map((table) => table.name)).toEqual(['assessment_records']);
    expect(() => resolveTableConfigs(['unknown_table'])).toThrow('Unknown migration table(s): unknown_table');
  });

  it('can rewrite migrated review attachment buckets for Aliyun OSS', () => {
    const table = SUPABASE_RDS_TABLES.find((item) => item.name === 'verification_reviews');
    const row = normalizeMigratedRow(table, {
      id: 'review-1',
      evidence_attachments: [
        {
          id: 'attachment-1',
          bucket: 'verification-evidence',
          path: 'client-1/record-1/file.png'
        }
      ],
      verification_snapshot: {
        evidenceAttachments: [
          {
            id: 'attachment-1',
            bucket: 'verification-evidence',
            path: 'client-1/record-1/file.png'
          }
        ]
      }
    }, {
      targetEvidenceBucket: 'medical-credit-verification-evidence'
    });

    expect(row.evidence_attachments[0].bucket).toBe('medical-credit-verification-evidence');
    expect(row.verification_snapshot.evidenceAttachments[0].bucket).toBe('medical-credit-verification-evidence');
  });
});

function createJsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  };
}
