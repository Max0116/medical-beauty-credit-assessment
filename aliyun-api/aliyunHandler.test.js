import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createAliyunApiHandler } from './aliyunHandler.js';

const openServers = [];

const listen = (handler) => new Promise((resolve) => {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1', () => {
    openServers.push(server);
    resolve(`http://127.0.0.1:${server.address().port}`);
  });
});

const closeServer = (server) => new Promise((resolve, reject) => {
  server.close((error) => (error ? reject(error) : resolve()));
});

afterEach(async () => {
  while (openServers.length) {
    await closeServer(openServers.pop());
  }
});

describe('Aliyun RDS/OSS API handler', () => {
  it('serves health and draft routes through the repository', async () => {
    const repository = createMemoryRepository();
    const baseUrl = await listen(createAliyunApiHandler({
      repository,
      evidenceStorage: {
        health: async () => ({
          ok: true,
          configured: true,
          provider: 'aliyun-oss',
          bucket: 'medical-credit-verification-evidence'
        })
      },
      verificationService: {
        health: async () => ({
          ok: true,
          configured: true,
          provider: 'zhipu_web_search',
          searchEngine: 'search_std'
        })
      },
      mode: 'dual_write',
      allowedOrigins: ['http://credit.example.com']
    }));

    const health = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'http://credit.example.com' }
    });
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({
      ok: true,
      ready: true,
      mode: 'dual_write',
      backend: { ok: true, database: 'fake' },
      storage: {
        ok: true,
        configured: true,
        provider: 'aliyun-oss'
      },
      verification: {
        ok: true,
        configured: true,
        provider: 'zhipu_web_search'
      }
    });

    const putDraft = await fetch(`${baseUrl}/api/draft`, {
      method: 'PUT',
      headers: {
        Origin: 'http://credit.example.com',
        'Content-Type': 'application/json',
        'x-client-instance-id': 'client-1'
      },
      body: JSON.stringify({ form: { institutionName: '上海清澜' } })
    });
    expect(putDraft.status).toBe(200);
    expect(await putDraft.json()).toEqual({ form: { institutionName: '上海清澜' } });

    const getDraft = await fetch(`${baseUrl}/api/draft`, {
      headers: {
        Origin: 'http://credit.example.com',
        'x-client-instance-id': 'client-1'
      }
    });
    expect(getDraft.status).toBe(200);
    expect(await getDraft.json()).toEqual({ form: { institutionName: '上海清澜' } });
  });

  it('saves records and creates a pending verification log without changing the submitted result', async () => {
    const repository = createMemoryRepository();
    const baseUrl = await listen(createAliyunApiHandler({
      repository,
      allowedOrigins: ['http://credit.example.com'],
      now: () => new Date('2026-05-30T00:00:00.000Z')
    }));
    const result = {
      finalGrade: 'E',
      finalDecision: '不建议授信',
      totalScore: 0,
      maxTermDays: 0,
      suggestedLimit: 0,
      stableMonthlyAverage: 0,
      needsApproval: false,
      redlineReasons: ['命中严重违法失信'],
      capReasons: [],
      approvalReasons: [],
      queryKeywords: ['上海风险机构 行政处罚']
    };

    const response = await fetch(`${baseUrl}/api/records`, {
      method: 'POST',
      headers: {
        Origin: 'http://credit.example.com',
        'Content-Type': 'application/json',
        'x-client-instance-id': 'client-1'
      },
      body: JSON.stringify({
        form: { institutionName: '上海风险机构' },
        result,
        record: { id: 'record-1', institutionName: '上海风险机构', ...result }
      })
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      record: {
        id: 'record-1',
        finalGrade: 'E',
        finalDecision: '不建议授信'
      }
    });
    expect(repository.verificationLogs).toHaveLength(1);
    expect(repository.verificationLogs[0]).toMatchObject({
      recordId: 'record-1',
      status: 'pending',
      queryKeywords: ['上海风险机构 行政处罚']
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(repository.verificationLogs).toHaveLength(1);
    expect(repository.verificationLogs[0]).toMatchObject({
      id: 'log-1',
      errorMessage: '阿里云核验服务待配置'
    });
  });

  it('uploads evidence attachments through configured OSS storage', async () => {
    const repository = createMemoryRepository();
    repository.records.set('record-1', { id: 'record-1', form: {}, result: {} });
    const storage = {
      uploadEvidenceAttachment: async ({ clientInstanceId, recordId, file }) => ({
        id: 'attachment-1',
        bucket: 'medical-credit-verification-evidence',
        path: `${clientInstanceId}/${recordId}/${file.fileName}`,
        fileName: file.fileName,
        mimeType: file.mimeType,
        size: file.size,
        signedUrl: 'https://oss.example.com/signed'
      })
    };
    const baseUrl = await listen(createAliyunApiHandler({
      repository,
      evidenceStorage: storage,
      allowedOrigins: ['http://credit.example.com']
    }));
    const formData = new FormData();
    formData.append('file', new File(['demo'], 'evidence.png', { type: 'image/png' }));

    const response = await fetch(`${baseUrl}/api/records/record-1/verification-attachments`, {
      method: 'POST',
      headers: {
        Origin: 'http://credit.example.com',
        'x-client-instance-id': 'client-1'
      },
      body: formData
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      attachment: {
        id: 'attachment-1',
        fileName: 'evidence.png',
        signedUrl: 'https://oss.example.com/signed'
      }
    });
  });
});

function createMemoryRepository() {
  const drafts = new Map();
  const records = new Map();
  const verificationLogs = [];
  return {
    drafts,
    records,
    verificationLogs,
    health: async () => ({ ok: true, database: 'fake' }),
    loadDraft: async (clientInstanceId) => drafts.has(clientInstanceId) ? { form: drafts.get(clientInstanceId) } : null,
    saveDraft: async (clientInstanceId, form) => {
      drafts.set(clientInstanceId, form);
      return { form };
    },
    deleteDraft: async (clientInstanceId) => {
      drafts.delete(clientInstanceId);
      return null;
    },
    listRecords: async () => ({ records: [...records.values()] }),
    loadRecord: async (_clientInstanceId, recordId) => ({ record: records.get(recordId) || null }),
    saveRecord: async (_clientInstanceId, { form, result, record }) => {
      const saved = { ...record, form, result };
      records.set(saved.id, saved);
      return { record: saved };
    },
    updateRecord: async (_clientInstanceId, recordId, { form, result, record }) => {
      const saved = { ...record, id: recordId, form, result };
      records.set(recordId, saved);
      return { record: saved };
    },
    listVerificationLogs: async () => ({ verificationLogs }),
    saveVerificationLog: async (_clientInstanceId, payload, { logId } = {}) => {
      const existingIndex = logId
        ? verificationLogs.findIndex((item) => item.id === logId)
        : -1;
      const log = { id: logId || `log-${verificationLogs.length + 1}`, ...payload };
      if (existingIndex >= 0) {
        verificationLogs[existingIndex] = { ...verificationLogs[existingIndex], ...log };
        return { verificationLog: verificationLogs[existingIndex] };
      }
      verificationLogs.unshift(log);
      return { verificationLog: log };
    },
    listVerificationReviews: async () => ({ verificationReviews: [] }),
    saveVerificationReview: async (_clientInstanceId, recordId, body) => ({
      verificationReview: { id: 'review-1', recordId, ...body }
    })
  };
}
