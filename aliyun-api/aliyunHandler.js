import Busboy from 'busboy';
import { createServer as createHttpServer } from 'node:http';
import {
  buildVerificationKeywords,
  parseApiRoute,
  validateClientInstanceId
} from './assessmentContract.js';

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

export function createAliyunApiServer(options = {}) {
  return createHttpServer(createAliyunApiHandler(options));
}

export function createAliyunApiHandler({
  repository,
  evidenceStorage,
  allowedOrigins = [],
  verificationService,
  now = () => new Date()
} = {}) {
  if (!repository) throw new Error('Aliyun API handler requires a repository.');
  const origins = normalizeAllowedOrigins(allowedOrigins);

  return async (request, response) => {
    const origin = request.headers.origin || '';
    const corsHeaders = getCorsHeaders(origin, origins);

    if (request.method === 'OPTIONS') {
      writeEmpty(response, 204, corsHeaders);
      return;
    }
    if (!isOriginAllowed(origin, origins)) {
      writeJson(response, 403, { error: 'Origin is not allowed.' }, corsHeaders);
      return;
    }

    try {
      const requestUrl = new URL(request.url || '/', 'http://medical-credit.local');
      if (requestUrl.pathname === '/api/health') {
        const backend = repository.health ? await repository.health() : { ok: true };
        writeJson(response, 200, {
          ok: true,
          service: 'medical-credit-assessment-api',
          mode: 'aliyun',
          backend
        }, corsHeaders);
        return;
      }

      const clientInstanceId = validateClientInstanceId(request.headers['x-client-instance-id']);
      const { resource, id, action } = parseApiRoute(requestUrl.pathname);

      if (resource === 'draft') {
        await handleDraft({ request, response, repository, clientInstanceId, corsHeaders });
        return;
      }

      if (resource === 'records') {
        await handleRecords({
          request,
          response,
          repository,
          evidenceStorage,
          verificationService,
          clientInstanceId,
          recordId: id,
          action,
          corsHeaders,
          now
        });
        return;
      }

      writeJson(response, 404, { error: 'Not found.' }, corsHeaders);
    } catch (error) {
      writeJson(response, 400, { error: formatErrorMessage(error) }, corsHeaders);
    }
  };
}

async function handleDraft({ request, response, repository, clientInstanceId, corsHeaders }) {
  if (request.method === 'GET') {
    const draft = await repository.loadDraft(clientInstanceId);
    if (!draft) {
      writeEmpty(response, 204, corsHeaders);
      return;
    }
    writeJson(response, 200, draft, corsHeaders);
    return;
  }

  if (request.method === 'PUT') {
    const body = await readJson(request);
    requireObject(body.form, 'form');
    writeJson(response, 200, await repository.saveDraft(clientInstanceId, body.form), corsHeaders);
    return;
  }

  if (request.method === 'DELETE') {
    await repository.deleteDraft(clientInstanceId);
    writeEmpty(response, 204, corsHeaders);
    return;
  }

  writeJson(response, 405, { error: 'Method not allowed.' }, corsHeaders);
}

async function handleRecords({
  request,
  response,
  repository,
  evidenceStorage,
  verificationService,
  clientInstanceId,
  recordId,
  action,
  corsHeaders,
  now
}) {
  if (recordId && action === 'verification') {
    await handleVerification({ request, response, repository, verificationService, clientInstanceId, recordId, corsHeaders, now });
    return;
  }

  if (recordId && action === 'verification-reviews') {
    await handleVerificationReviews({ request, response, repository, clientInstanceId, recordId, corsHeaders });
    return;
  }

  if (recordId && action === 'verification-attachments') {
    await handleAttachmentUpload({ request, response, repository, evidenceStorage, clientInstanceId, recordId, corsHeaders });
    return;
  }

  if (request.method === 'GET' && recordId) {
    const payload = await repository.loadRecord(clientInstanceId, recordId);
    writeJson(response, payload.record ? 200 : 404, payload, corsHeaders);
    return;
  }

  if (request.method === 'PUT' && recordId) {
    const body = await readJson(request);
    requireObject(body.form, 'form');
    requireObject(body.result, 'result');
    requireObject(body.record, 'record');
    const payload = await repository.updateRecord(clientInstanceId, recordId, body);
    writeJson(response, payload.record ? 200 : 404, payload, corsHeaders);
    return;
  }

  if (request.method === 'GET') {
    writeJson(response, 200, await repository.listRecords(clientInstanceId), corsHeaders);
    return;
  }

  if (request.method === 'POST' && !recordId) {
    const body = await readJson(request);
    requireObject(body.form, 'form');
    requireObject(body.result, 'result');
    requireObject(body.record, 'record');
    const payload = await repository.saveRecord(clientInstanceId, body);
    scheduleVerification({ repository, verificationService, clientInstanceId, record: payload.record, form: body.form, result: body.result, now });
    writeJson(response, 201, payload, corsHeaders);
    return;
  }

  writeJson(response, 405, { error: 'Method not allowed.' }, corsHeaders);
}

async function handleVerification({ request, response, repository, verificationService, clientInstanceId, recordId, corsHeaders, now }) {
  if (request.method === 'GET') {
    writeJson(response, 200, await repository.listVerificationLogs(clientInstanceId, recordId), corsHeaders);
    return;
  }

  if (request.method === 'POST') {
    const { record } = await repository.loadRecord(clientInstanceId, recordId);
    if (!record) {
      writeJson(response, 404, { error: 'Assessment record not found.' }, corsHeaders);
      return;
    }
    const pending = await createPendingVerificationLog({ repository, clientInstanceId, record, form: record.form, result: record.result, now, reason: '手动重新发起联网核验' });
    scheduleVerification({ repository, verificationService, clientInstanceId, record, form: record.form, result: record.result, existingLogId: pending.verificationLog?.id, now });
    writeJson(response, 202, pending, corsHeaders);
    return;
  }

  writeJson(response, 405, { error: 'Method not allowed.' }, corsHeaders);
}

async function handleVerificationReviews({ request, response, repository, clientInstanceId, recordId, corsHeaders }) {
  if (request.method === 'GET') {
    writeJson(response, 200, await repository.listVerificationReviews(clientInstanceId, recordId), corsHeaders);
    return;
  }

  if (request.method === 'POST') {
    const payload = await repository.saveVerificationReview(clientInstanceId, recordId, await readJson(request));
    writeJson(response, 201, payload, corsHeaders);
    return;
  }

  writeJson(response, 405, { error: 'Method not allowed.' }, corsHeaders);
}

async function handleAttachmentUpload({ request, response, repository, evidenceStorage, clientInstanceId, recordId, corsHeaders }) {
  if (request.method !== 'POST') {
    writeJson(response, 405, { error: 'Method not allowed.' }, corsHeaders);
    return;
  }
  if (!evidenceStorage?.uploadEvidenceAttachment) {
    writeJson(response, 501, { error: 'Evidence attachment storage is not configured.' }, corsHeaders);
    return;
  }

  const { record } = await repository.loadRecord(clientInstanceId, recordId);
  if (!record) {
    writeJson(response, 404, { error: 'Assessment record not found.' }, corsHeaders);
    return;
  }

  const file = await readMultipartFile(request);
  const attachment = await evidenceStorage.uploadEvidenceAttachment({ clientInstanceId, recordId, file });
  writeJson(response, 201, { attachment }, corsHeaders);
}

function scheduleVerification({ repository, verificationService, clientInstanceId, record, form, result, existingLogId, now }) {
  const task = verificationService?.run
    ? verificationService.run({ repository, clientInstanceId, record, form, result, existingLogId })
    : createPendingVerificationLog({ repository, clientInstanceId, record, form, result, existingLogId, now, reason: '阿里云核验服务待配置' });

  Promise.resolve(task).catch((error) => {
    console.error('verification task failed', error);
  });
}

async function createPendingVerificationLog({ repository, clientInstanceId, record, form, result, existingLogId, now, reason }) {
  const institutionName = String(form?.institutionName || record?.institutionName || '').trim();
  const queryKeywords = Array.isArray(result?.queryKeywords)
    ? result.queryKeywords
    : buildVerificationKeywords(institutionName);

  return repository.saveVerificationLog(clientInstanceId, {
    recordId: record.id,
    status: institutionName ? 'pending' : 'skipped',
    queryKeywords,
    rawResults: [],
    extractedFlags: {
      verificationSummary: {
        status: institutionName ? 'pending' : 'skipped',
        institutionName,
        conclusion: institutionName ? reason : '机构名称为空，跳过后台核验',
        riskTags: [],
        evidenceSummaries: []
      }
    },
    riskTags: [],
    startedAt: now().toISOString(),
    errorMessage: institutionName ? reason : ''
  }, { logId: existingLogId });
}

function readJson(request) {
  return readRequestBody(request).then((buffer) => {
    try {
      return JSON.parse(buffer.toString('utf8') || '{}');
    } catch {
      throw new Error('Request body must be valid JSON.');
    }
  });
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('error', reject);
    request.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function readMultipartFile(request) {
  return new Promise((resolve, reject) => {
    const contentType = request.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      reject(new Error('Request must be multipart/form-data.'));
      return;
    }

    const busboy = Busboy({ headers: request.headers });
    let settled = false;
    busboy.on('file', (fieldName, file, info) => {
      if (fieldName !== 'file' || settled) {
        file.resume();
        return;
      }
      const chunks = [];
      file.on('data', (chunk) => chunks.push(chunk));
      file.on('limit', () => reject(new Error('file is too large.')));
      file.on('end', () => {
        settled = true;
        const buffer = Buffer.concat(chunks);
        resolve({
          fileName: info.filename || 'evidence',
          mimeType: info.mimeType || '',
          size: buffer.length,
          buffer
        });
      });
    });
    busboy.on('error', reject);
    busboy.on('finish', () => {
      if (!settled) reject(new Error('file is required.'));
    });
    request.pipe(busboy);
  });
}

function requireObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
}

function normalizeAllowedOrigins(value = []) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function isOriginAllowed(origin, allowedOrigins) {
  if (!origin) return true;
  if (!allowedOrigins.length) return false;
  return allowedOrigins.includes('*') || allowedOrigins.includes(origin);
}

function getCorsHeaders(origin, allowedOrigins) {
  const allowOrigin = allowedOrigins.includes('*')
    ? '*'
    : allowedOrigins.includes(origin)
      ? origin
      : allowedOrigins[0] || '*';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-client-instance-id',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '600'
  };
}

function writeJson(response, status, body, headers = {}) {
  response.writeHead(status, { ...headers, 'Content-Type': JSON_CONTENT_TYPE });
  response.end(JSON.stringify(body));
}

function writeEmpty(response, status, headers = {}) {
  response.writeHead(status, headers);
  response.end();
}

function formatErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error || 'Unknown error');
}
