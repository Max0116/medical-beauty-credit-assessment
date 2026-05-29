import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildSmokeRecordPayload,
  runAliyunApiFlowSmoke
} from './aliyun-api-flow-smoke.mjs';

const openServers = [];

afterEach(async () => {
  while (openServers.length) {
    await new Promise((resolve, reject) => {
      openServers.pop().close((error) => (error ? reject(error) : resolve()));
    });
  }
});

describe('Aliyun API flow smoke', () => {
  it('verifies record save, immediate verification log, and history list', async () => {
    const state = { records: [], verificationLogs: [] };
    const baseUrl = await listen(createSmokeApiHandler(state));

    const result = await runAliyunApiFlowSmoke({
      baseUrl,
      clientInstanceId: 'client-flow-1',
      now: () => new Date('2026-05-30T00:00:00.000Z'),
      healthExpectations: {
        expectReady: true,
        expectedMode: 'aliyun',
        expectedBackendDatabase: 'postgres',
        expectStorageConfigured: true,
        expectVerificationConfigured: true
      }
    });

    expect(result).toMatchObject({
      baseUrl,
      clientInstanceId: 'client-flow-1',
      health: {
        ready: true,
        mode: 'aliyun',
        backend: { database: 'postgres' },
        storage: { configured: true },
        verification: { configured: true }
      },
      record: {
        id: 'api-flow-20260530000000',
        institutionName: 'PR23阿里云链路验收机构20260530000000',
        finalGrade: 'C'
      },
      verification: {
        logCount: 1,
        firstStatus: 'pending',
        firstRawResultCount: 0
      },
      history: {
        recordCount: 1,
        includesSavedRecord: true
      }
    });
  });

  it('fails when verification logs are not created after saving', async () => {
    const baseUrl = await listen(createSmokeApiHandler({ records: [], verificationLogs: [] }, { skipVerificationLog: true }));

    await expect(runAliyunApiFlowSmoke({
      baseUrl,
      clientInstanceId: 'client-flow-2',
      now: () => new Date('2026-05-30T00:00:00.000Z')
    })).rejects.toThrow('GET verification logs returned no logs after saving a record');
  });

  it('builds a stable smoke record payload without recalculating risk rules', () => {
    const payload = buildSmokeRecordPayload({
      now: () => new Date('2026-05-30T00:00:00.000Z')
    });

    expect(payload).toMatchObject({
      form: {
        institutionName: 'PR23阿里云链路验收机构20260530000000',
        publicCreditStatus: 'unknown'
      },
      result: {
        finalGrade: 'C',
        finalDecision: '谨慎短账期',
        capReasons: ['公共信用未查询 / 无法确认，最高 C']
      },
      record: {
        id: 'api-flow-20260530000000',
        finalGrade: 'C'
      }
    });
  });
});

function listen(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      openServers.push(server);
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

function createSmokeApiHandler(state, { skipVerificationLog = false } = {}) {
  return async (request, response) => {
    const url = new URL(request.url, 'http://medical-credit.local');
    if (request.method === 'GET' && url.pathname === '/api/health') {
      writeJson(response, 200, {
        ok: true,
        ready: true,
        mode: 'aliyun',
        backend: { ok: true, database: 'postgres' },
        storage: { ok: true, configured: true, provider: 'aliyun-oss' },
        verification: { ok: true, configured: true, provider: 'zhipu_web_search' }
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/records') {
      const body = await readJson(request);
      const record = {
        ...body.record,
        form: body.form,
        result: body.result
      };
      state.records.unshift(record);
      if (!skipVerificationLog) {
        state.verificationLogs.unshift({
          id: 'verification-log-1',
          recordId: record.id,
          provider: 'zhipu_web_search',
          status: 'pending',
          queryKeywords: body.result.queryKeywords,
          riskTags: [],
          rawResultCount: 0
        });
      }
      writeJson(response, 201, { record });
      return;
    }

    const verificationMatch = url.pathname.match(/^\/api\/records\/([^/]+)\/verification$/);
    if (request.method === 'GET' && verificationMatch) {
      const recordId = decodeURIComponent(verificationMatch[1]);
      writeJson(response, 200, {
        verificationLogs: state.verificationLogs.filter((item) => item.recordId === recordId)
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/records') {
      writeJson(response, 200, { records: state.records });
      return;
    }

    writeJson(response, 404, { error: 'Not found.' });
  };
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('error', reject);
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function writeJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}
