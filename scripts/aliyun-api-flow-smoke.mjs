import {
  buildHealthExpectationsFromEnv,
  fetchAliyunHealth,
  formatHealthDiagnostics,
  normalizeBaseUrl,
  validateAliyunHealth
} from './aliyun-health.mjs';

const DEFAULT_TIMEOUT_MS = 30000;
export const API_FLOW_SMOKE_MARKER = 'PR23_API_FLOW_SMOKE';

export async function runAliyunApiFlowSmoke({
  baseUrl = process.env.API_FLOW_BASE_URL || process.env.SMOKE_BASE_URL || 'http://101.132.137.25',
  timeoutMs = Number(process.env.API_FLOW_TIMEOUT_MS || process.env.SMOKE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
  clientInstanceId = process.env.API_FLOW_CLIENT_INSTANCE_ID || `api-flow-${Date.now()}`,
  smokeRunId = process.env.API_FLOW_RUN_ID || '',
  publishableKey = process.env.API_FLOW_API_KEY || process.env.SMOKE_API_KEY || '',
  uploadAttachment = parseApiFlowBoolean(process.env.API_FLOW_UPLOAD_ATTACHMENT, false),
  verifySignedUrl = parseApiFlowBoolean(process.env.API_FLOW_VERIFY_SIGNED_URL, false),
  fetchImpl = globalThis.fetch,
  healthExpectations = buildHealthExpectationsFromEnv(process.env, 'API_FLOW'),
  now = () => new Date()
} = {}) {
  if (!fetchImpl) throw new Error('Fetch API is not available in this Node.js runtime.');
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const health = await fetchAliyunHealth({ baseUrl: normalizedBaseUrl, timeoutMs, fetchImpl });
  if (!health.ok) {
    throw new Error(`/api/health returned ${health.status}: ${String(health.rawText || '').slice(0, 240)}`);
  }

  const validation = validateAliyunHealth(health.payload, healthExpectations);
  if (!validation.ok) {
    throw new Error(`/api/health readiness mismatch: ${formatHealthDiagnostics(validation, health.payload)}`);
  }

  const payload = buildSmokeRecordPayload({ now, smokeRunId });
  const savedRecordPayload = await requestJson({
    baseUrl: normalizedBaseUrl,
    path: '/api/records',
    method: 'POST',
    body: payload,
    clientInstanceId,
    publishableKey,
    timeoutMs,
    fetchImpl
  });
  const record = savedRecordPayload?.record;
  if (!record?.id) throw new Error('POST /api/records did not return record.id.');

  const verificationPayload = await requestJson({
    baseUrl: normalizedBaseUrl,
    path: `/api/records/${encodeURIComponent(record.id)}/verification`,
    clientInstanceId,
    publishableKey,
    timeoutMs,
    fetchImpl
  });
  const verificationLogs = Array.isArray(verificationPayload?.verificationLogs)
    ? verificationPayload.verificationLogs
    : [];
  if (!verificationLogs.length) {
    throw new Error('GET verification logs returned no logs after saving a record.');
  }

  const listPayload = await requestJson({
    baseUrl: normalizedBaseUrl,
    path: '/api/records',
    clientInstanceId,
    publishableKey,
    timeoutMs,
    fetchImpl
  });
  const records = Array.isArray(listPayload?.records) ? listPayload.records : [];
  if (!records.some((item) => item.id === record.id)) {
    throw new Error('Saved record was not returned by GET /api/records.');
  }

  const attachment = uploadAttachment
    ? await uploadSmokeAttachment({
      baseUrl: normalizedBaseUrl,
      recordId: record.id,
      smokeRunId: payload.smoke.runId,
      clientInstanceId,
      publishableKey,
      timeoutMs,
      fetchImpl,
      verifySignedUrl
    })
    : null;

  return {
    baseUrl: normalizedBaseUrl,
    clientInstanceId,
    smoke: payload.smoke,
    health: validation.summary,
    record: {
      id: record.id,
      institutionName: record.institutionName,
      finalGrade: record.finalGrade,
      finalDecision: record.finalDecision
    },
    verification: {
      logCount: verificationLogs.length,
      firstStatus: verificationLogs[0]?.status || '',
      firstRiskTags: verificationLogs[0]?.riskTags || [],
      firstRawResultCount: verificationLogs[0]?.rawResultCount ?? 0
    },
    history: {
      recordCount: records.length,
      includesSavedRecord: true
    },
    attachment
  };
}

export function buildSmokeRecordPayload({ now = () => new Date(), smokeRunId = '' } = {}) {
  const timestamp = now().toISOString();
  const compactTimestamp = timestamp.replace(/[-:.TZ]/g, '').slice(0, 14);
  const runId = normalizeSmokeRunId(smokeRunId, compactTimestamp);
  const recordId = `api-flow-${runId}`;
  const institutionName = `PR23阿里云链路验收机构${runId}`;
  const form = {
    institutionName,
    unifiedSocialCreditCode: '91310000PR23TESTX1',
    businessStage: 'cooperation_over_6_months',
    hasPaidOrders: true,
    paidOrderCount: 8,
    requestedTermDays: 21,
    requestedLimit: 30000,
    qualificationStatus: 'complete',
    publicCreditStatus: 'unknown',
    majorMedicalPenalty: false,
    dishonestyHit: false,
    seriousIllegalHit: false,
    outOfScopeOperation: false,
    purchaseAmounts: [30000, 28000, 32000, 31000, 29000, 30000],
    maxPurchaseGapDays: 30,
    hasAbnormalLargeOrder: false,
    hasCurrentOverdue: false,
    currentOverdueAmount: 0,
    overdueCountLast6Months: 0,
    maxOverdueDays: 0,
    historicalOverdue: 'none',
    hasReconciliationDispute: false,
    remarks: `${API_FLOW_SMOKE_MARKER} | runId=${runId} | PR23 阿里云 API 链路 smoke 自动生成`
  };
  const result = {
    finalGrade: 'C',
    finalDecision: '谨慎短账期',
    totalScore: 68,
    maxTermDays: 15,
    suggestedLimit: 24000,
    stableMonthlyAverage: 30000,
    needsApproval: true,
    redlineReasons: [],
    capReasons: ['公共信用未查询 / 无法确认，最高 C'],
    approvalReasons: ['公共信用未查询或无法确认'],
    queryKeywords: [
      `${institutionName} 行政处罚`,
      `${institutionName} 被执行人`,
      `${institutionName} 失信被执行人`,
      `${institutionName} 非法行医`
    ]
  };
  return {
    form,
    result,
    record: {
      id: recordId,
      institutionName,
      finalGrade: result.finalGrade,
      finalDecision: result.finalDecision,
      totalScore: result.totalScore,
      maxTermDays: result.maxTermDays,
      suggestedLimit: result.suggestedLimit,
      stableMonthlyAverage: result.stableMonthlyAverage,
      needsApproval: result.needsApproval,
      redlineReasons: result.redlineReasons,
      capReasons: result.capReasons,
      approvalReasons: result.approvalReasons,
      createdAt: timestamp,
      updatedAt: timestamp
    },
    smoke: {
      marker: API_FLOW_SMOKE_MARKER,
      runId,
      recordId,
      institutionName,
      searchHints: {
        institutionPrefix: 'PR23阿里云链路验收机构',
        recordIdPrefix: 'api-flow-',
        remarksContains: API_FLOW_SMOKE_MARKER,
        attachmentFilePrefix: `pr23-api-flow-smoke-${runId}`
      }
    }
  };
}

async function requestJson({
  baseUrl,
  path,
  method = 'GET',
  body,
  clientInstanceId,
  publishableKey,
  timeoutMs,
  fetchImpl
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {
      'Content-Type': 'application/json',
      'x-client-instance-id': clientInstanceId
    };
    if (publishableKey) headers.apikey = publishableKey;

    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${method} ${path} returned ${response.status}: ${text.slice(0, 240)}`);
    }
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timeout);
  }
}

async function uploadSmokeAttachment({
  baseUrl,
  recordId,
  smokeRunId,
  clientInstanceId,
  publishableKey,
  timeoutMs,
  fetchImpl,
  verifySignedUrl
}) {
  const safeRunId = normalizeSmokeRunId(smokeRunId, 'manual');
  const fileName = `pr23-api-flow-smoke-${safeRunId}.pdf`;
  const formData = new FormData();
  formData.append(
    'file',
    new Blob([buildSmokePdfBytes()], { type: 'application/pdf' }),
    fileName
  );

  const attachmentPayload = await requestMultipart({
    baseUrl,
    path: `/api/records/${encodeURIComponent(recordId)}/verification-attachments`,
    formData,
    clientInstanceId,
    publishableKey,
    timeoutMs,
    fetchImpl
  });
  const attachment = attachmentPayload?.attachment || attachmentPayload;
  if (!attachment?.id) throw new Error('Attachment upload did not return attachment.id.');
  if (!attachment?.path) throw new Error('Attachment upload did not return attachment.path.');
  if (!attachment?.signedUrl) throw new Error('Attachment upload did not return attachment.signedUrl.');

  let signedUrlReachable = false;
  if (verifySignedUrl) {
    const response = await fetchWithTimeout(fetchImpl, attachment.signedUrl, { timeoutMs });
    if (!response.ok) {
      throw new Error(`Attachment signed URL returned ${response.status}.`);
    }
    signedUrlReachable = true;
    await response.arrayBuffer().catch(() => null);
  }

  return {
    id: attachment.id,
    bucket: attachment.bucket || '',
    path: attachment.path,
    fileName: attachment.fileName || '',
    mimeType: attachment.mimeType || '',
    size: Number(attachment.size || 0),
    hasSignedUrl: Boolean(attachment.signedUrl),
    signedUrlReachable
  };
}

export function normalizeSmokeRunId(value, fallback = 'manual') {
  const normalizedFallback = String(fallback || 'manual')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'manual';
  const normalized = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return normalized || normalizedFallback;
}

async function requestMultipart({
  baseUrl,
  path,
  formData,
  clientInstanceId,
  publishableKey,
  timeoutMs,
  fetchImpl
}) {
  const headers = {
    'x-client-instance-id': clientInstanceId
  };
  if (publishableKey) headers.apikey = publishableKey;

  const response = await fetchWithTimeout(fetchImpl, `${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: formData
  }, { timeoutMs });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`POST ${path} returned ${response.status}: ${text.slice(0, 240)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function fetchWithTimeout(fetchImpl, url, init = {}, { timeoutMs } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function buildSmokePdfBytes() {
  return new TextEncoder().encode([
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 120 80] >> endobj',
    'trailer << /Root 1 0 R >>',
    '%%EOF'
  ].join('\n'));
}

export function parseApiFlowBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`Invalid API flow boolean value: ${value}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runAliyunApiFlowSmoke();
  console.log(JSON.stringify(result, null, 2));
}
