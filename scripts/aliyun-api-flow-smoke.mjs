import {
  buildHealthExpectationsFromEnv,
  fetchAliyunHealth,
  formatHealthDiagnostics,
  normalizeBaseUrl,
  validateAliyunHealth
} from './aliyun-health.mjs';

const DEFAULT_TIMEOUT_MS = 30000;

export async function runAliyunApiFlowSmoke({
  baseUrl = process.env.API_FLOW_BASE_URL || process.env.SMOKE_BASE_URL || 'http://101.132.137.25',
  timeoutMs = Number(process.env.API_FLOW_TIMEOUT_MS || process.env.SMOKE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
  clientInstanceId = process.env.API_FLOW_CLIENT_INSTANCE_ID || `api-flow-${Date.now()}`,
  publishableKey = process.env.API_FLOW_API_KEY || process.env.SMOKE_API_KEY || '',
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

  const payload = buildSmokeRecordPayload({ now });
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

  return {
    baseUrl: normalizedBaseUrl,
    clientInstanceId,
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
    }
  };
}

export function buildSmokeRecordPayload({ now = () => new Date() } = {}) {
  const timestamp = now().toISOString();
  const compactTimestamp = timestamp.replace(/[-:.TZ]/g, '').slice(0, 14);
  const institutionName = `PR23阿里云链路验收机构${compactTimestamp}`;
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
    remarks: 'PR23 阿里云 API 链路 smoke 自动生成'
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
      id: `api-flow-${compactTimestamp}`,
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runAliyunApiFlowSmoke();
  console.log(JSON.stringify(result, null, 2));
}
