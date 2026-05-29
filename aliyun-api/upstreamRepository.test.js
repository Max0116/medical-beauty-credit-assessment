import { describe, expect, it, vi } from 'vitest';
import {
  createDualWriteAssessmentRepository,
  createUpstreamAssessmentRepository
} from './upstreamRepository.js';

describe('upstream Supabase repository', () => {
  it('writes records to the upstream function with server-side auth headers', async () => {
    const calls = [];
    const repository = createUpstreamAssessmentRepository({
      upstreamUrl: 'https://project.supabase.co/functions/v1/assessments',
      upstreamApiKey: 'server-side-key',
      fetchImpl: async (url, options = {}) => {
        calls.push({ url, options });
        return createJsonResponse({ record: { id: 'record-1' } }, 201);
      }
    });

    await repository.saveRecord('client-1', {
      form: { institutionName: '上海清澜' },
      result: { finalGrade: 'A' },
      record: { id: 'record-1' }
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://project.supabase.co/functions/v1/assessments/records');
    expect(calls[0].options.headers).toMatchObject({
      apikey: 'server-side-key',
      Authorization: 'Bearer server-side-key',
      'x-client-instance-id': 'client-1',
      'Content-Type': 'application/json'
    });
    expect(JSON.parse(calls[0].options.body)).toMatchObject({
      clientInstanceId: 'client-1',
      record: { id: 'record-1' }
    });
  });

  it('parses upstream errors into useful messages', async () => {
    const repository = createUpstreamAssessmentRepository({
      upstreamUrl: 'https://project.supabase.co/functions/v1/assessments',
      upstreamApiKey: 'server-side-key',
      fetchImpl: async () => createJsonResponse({ error: 'Invalid apikey header.' }, 400)
    });

    await expect(repository.saveDraft('client-1', {})).rejects.toThrow('Invalid apikey header.');
  });
});

describe('dual_write repository', () => {
  it('returns primary RDS results while best-effort writing to Supabase', async () => {
    const primary = {
      saveRecord: vi.fn(async () => ({ record: { id: 'record-1', finalGrade: 'A' } })),
      loadRecord: vi.fn(async () => ({ record: { id: 'record-1' } })),
      health: vi.fn(async () => ({ ok: true, database: 'postgres' }))
    };
    const secondary = {
      saveRecord: vi.fn(async () => ({ record: { id: 'record-1' } }))
    };
    const repository = createDualWriteAssessmentRepository({ primary, secondary });

    expect(await repository.health()).toMatchObject({
      ok: true,
      database: 'postgres',
      dualWrite: true,
      secondary: 'supabase_proxy'
    });
    const result = await repository.saveRecord('client-1', { record: { id: 'record-1' } });
    expect(result).toEqual({ record: { id: 'record-1', finalGrade: 'A' } });
    expect(primary.saveRecord).toHaveBeenCalledWith('client-1', { record: { id: 'record-1' } });
    expect(secondary.saveRecord).toHaveBeenCalledWith('client-1', { record: { id: 'record-1' } });
    expect(await repository.loadRecord('client-1', 'record-1')).toEqual({ record: { id: 'record-1' } });
    expect(primary.loadRecord).toHaveBeenCalledWith('client-1', 'record-1');
  });

  it('does not fail primary writes when secondary Supabase write fails', async () => {
    const logger = { warn: vi.fn() };
    const primary = {
      saveDraft: vi.fn(async () => ({ form: { institutionName: '上海清澜' } }))
    };
    const secondary = {
      saveDraft: vi.fn(async () => {
        throw new Error('Supabase unavailable');
      })
    };
    const repository = createDualWriteAssessmentRepository({ primary, secondary, logger });

    await expect(repository.saveDraft('client-1', { institutionName: '上海清澜' })).resolves.toEqual({
      form: { institutionName: '上海清澜' }
    });
    expect(logger.warn).toHaveBeenCalled();
  });
});

function createJsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === null ? '' : JSON.stringify(body))
  };
}
