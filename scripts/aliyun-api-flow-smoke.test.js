import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  API_FLOW_SMOKE_MARKER,
  buildSmokePdfBytes,
  buildSmokeRecordPayload,
  normalizeSmokeRunId,
  parseApiFlowBoolean,
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
      smoke: {
        marker: API_FLOW_SMOKE_MARKER,
        runId: '20260530000000',
        recordId: 'api-flow-20260530000000',
        searchHints: {
          remarksContains: API_FLOW_SMOKE_MARKER,
          attachmentFilePrefix: 'pr23-api-flow-smoke-20260530000000'
        }
      },
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
      },
      attachment: null
    });
  });

  it('optionally uploads an evidence attachment and checks the signed URL', async () => {
    const state = { records: [], verificationLogs: [], attachments: [] };
    const baseUrl = await listen(createSmokeApiHandler(state));

    const result = await runAliyunApiFlowSmoke({
      baseUrl,
      clientInstanceId: 'client-flow-attachment',
      uploadAttachment: true,
      verifySignedUrl: true,
      now: () => new Date('2026-05-30T00:00:00.000Z')
    });

    expect(state.attachments).toHaveLength(1);
    expect(state.attachments[0]).toMatchObject({
      recordId: 'api-flow-20260530000000',
      contentType: expect.stringContaining('multipart/form-data'),
      fileName: 'pr23-api-flow-smoke-20260530000000.pdf'
    });
    expect(result.attachment).toMatchObject({
      id: 'attachment-1',
      bucket: 'medical-credit-verification-evidence',
      path: 'verification-evidence/client-flow-attachment/api-flow-20260530000000/20260530/attachment-1-pr23-api-flow-smoke-20260530000000.pdf',
      fileName: 'pr23-api-flow-smoke-20260530000000.pdf',
      mimeType: 'application/pdf',
      hasSignedUrl: true,
      signedUrlReachable: true
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
        publicCreditStatus: 'unknown',
        remarks: `${API_FLOW_SMOKE_MARKER} | runId=20260530000000 | PR23 阿里云 API 链路 smoke 自动生成`
      },
      result: {
        finalGrade: 'C',
        finalDecision: '谨慎短账期',
        capReasons: ['公共信用未查询 / 无法确认，最高 C']
      },
      record: {
        id: 'api-flow-20260530000000',
        finalGrade: 'C'
      },
      smoke: {
        marker: API_FLOW_SMOKE_MARKER,
        runId: '20260530000000',
        recordId: 'api-flow-20260530000000',
        institutionName: 'PR23阿里云链路验收机构20260530000000'
      }
    });
  });

  it('accepts a custom smoke run id for RDS and OSS traceability', () => {
    const payload = buildSmokeRecordPayload({
      smokeRunId: ' manual run / 01 ',
      now: () => new Date('2026-05-30T00:00:00.000Z')
    });

    expect(payload).toMatchObject({
      form: {
        institutionName: 'PR23阿里云链路验收机构manual-run-01',
        remarks: `${API_FLOW_SMOKE_MARKER} | runId=manual-run-01 | PR23 阿里云 API 链路 smoke 自动生成`
      },
      record: {
        id: 'api-flow-manual-run-01'
      },
      smoke: {
        marker: API_FLOW_SMOKE_MARKER,
        runId: 'manual-run-01',
        recordId: 'api-flow-manual-run-01',
        searchHints: {
          attachmentFilePrefix: 'pr23-api-flow-smoke-manual-run-01'
        }
      }
    });
  });

  it('builds a tiny PDF and parses optional booleans', () => {
    expect(new TextDecoder().decode(buildSmokePdfBytes())).toContain('%PDF-1.4');
    expect(normalizeSmokeRunId(' alpha / beta ', 'fallback')).toBe('alpha-beta');
    expect(normalizeSmokeRunId('', 'fallback value')).toBe('fallback-value');
    expect(parseApiFlowBoolean(undefined)).toBe(false);
    expect(parseApiFlowBoolean('', true)).toBe(true);
    expect(parseApiFlowBoolean('yes')).toBe(true);
    expect(parseApiFlowBoolean('off', true)).toBe(false);
    expect(() => parseApiFlowBoolean('later')).toThrow('Invalid API flow boolean value');
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

    const attachmentMatch = url.pathname.match(/^\/api\/records\/([^/]+)\/verification-attachments$/);
    if (request.method === 'POST' && attachmentMatch) {
      const recordId = decodeURIComponent(attachmentMatch[1]);
      const body = await readBuffer(request);
      const contentType = request.headers['content-type'] || '';
      const fileName = extractMultipartFileName(body) || 'attachment.pdf';
      state.attachments.push({ recordId, contentType, fileName, size: body.length });
      writeJson(response, 201, {
        attachment: {
          id: 'attachment-1',
          bucket: 'medical-credit-verification-evidence',
          path: `verification-evidence/${request.headers['x-client-instance-id']}/${recordId}/20260530/attachment-1-${fileName}`,
          fileName,
          mimeType: 'application/pdf',
          size: body.length,
          signedUrl: `http://${request.headers.host}/signed/evidence.pdf`
        }
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/signed/evidence.pdf') {
      response.writeHead(200, { 'Content-Type': 'application/pdf' });
      response.end(Buffer.from(buildSmokePdfBytes()));
      return;
    }

    writeJson(response, 404, { error: 'Not found.' });
  };
}

function readJson(request) {
  return readBuffer(request).then((buffer) => JSON.parse(buffer.toString('utf8') || '{}'));
}

function extractMultipartFileName(buffer) {
  const match = buffer.toString('utf8').match(/filename="([^"]+)"/);
  return match?.[1] || '';
}

function readBuffer(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('error', reject);
    request.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function writeJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}
