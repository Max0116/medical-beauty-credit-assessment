export const EVIDENCE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const EVIDENCE_ATTACHMENT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf'
]);

export function validateClientInstanceId(value) {
  const id = String(value || '').trim();
  if (!/^[a-zA-Z0-9._:-]{6,128}$/.test(id)) {
    throw new Error('Invalid x-client-instance-id header.');
  }
  return id;
}

export function parseApiRoute(pathname = '/') {
  const segments = String(pathname).split('/').filter(Boolean);
  const route = segments[0] === 'api' ? segments.slice(1) : segments;
  return {
    resource: route[0] || '',
    id: route[1] || null,
    action: route[2] || null
  };
}

export function normalizeIncomingRecord(record = {}, form = {}, result = {}, now = () => new Date(), id = createId) {
  const timestamp = now().toISOString();
  return {
    id: String(record.id || id()),
    institutionName: String(record.institutionName || form?.institutionName || '未命名机构'),
    finalGrade: String(record.finalGrade || result?.finalGrade || ''),
    finalDecision: String(record.finalDecision || result?.finalDecision || ''),
    totalScore: Number(record.totalScore ?? result?.totalScore ?? 0),
    maxTermDays: Number(record.maxTermDays ?? result?.maxTermDays ?? 0),
    suggestedLimit: Number(record.suggestedLimit ?? result?.suggestedLimit ?? 0),
    stableMonthlyAverage: Number(record.stableMonthlyAverage ?? result?.stableMonthlyAverage ?? 0),
    needsApproval: Boolean(record.needsApproval ?? result?.needsApproval),
    redlineReasons: asStringArray(record.redlineReasons ?? result?.redlineReasons),
    capReasons: asStringArray(record.capReasons ?? result?.capReasons),
    approvalReasons: asStringArray(record.approvalReasons ?? result?.approvalReasons),
    createdAt: String(record.createdAt || timestamp),
    updatedAt: timestamp,
    form: asObject(form),
    result: asObject(result)
  };
}

export function toRecordRow(record, clientInstanceId) {
  return {
    id: record.id,
    client_instance_id: clientInstanceId,
    institution_name: record.institutionName,
    final_grade: record.finalGrade,
    final_decision: record.finalDecision,
    total_score: record.totalScore,
    max_term_days: record.maxTermDays,
    suggested_limit: record.suggestedLimit,
    stable_monthly_average: record.stableMonthlyAverage,
    needs_approval: record.needsApproval,
    redline_reasons: record.redlineReasons,
    cap_reasons: record.capReasons,
    approval_reasons: record.approvalReasons,
    form_snapshot: record.form,
    result_snapshot: record.result,
    created_at: record.createdAt,
    updated_at: record.updatedAt
  };
}

export function mapRecordRow(row = {}) {
  return {
    id: String(row.id),
    institutionName: String(row.institution_name || ''),
    finalGrade: String(row.final_grade || ''),
    finalDecision: String(row.final_decision || ''),
    totalScore: Number(row.total_score || 0),
    maxTermDays: Number(row.max_term_days || 0),
    suggestedLimit: Number(row.suggested_limit || 0),
    stableMonthlyAverage: Number(row.stable_monthly_average || 0),
    needsApproval: Boolean(row.needs_approval),
    redlineReasons: asStringArray(row.redline_reasons),
    capReasons: asStringArray(row.cap_reasons),
    approvalReasons: asStringArray(row.approval_reasons),
    createdAt: toIsoLikeString(row.created_at),
    updatedAt: toIsoLikeString(row.updated_at),
    form: asObject(row.form_snapshot),
    result: asObject(row.result_snapshot)
  };
}

export function mapVerificationLogRow(row = {}) {
  const extractedFlags = asObject(row.extracted_flags);
  const rawResults = Array.isArray(row.raw_results) ? row.raw_results : [];
  return {
    id: String(row.id),
    recordId: String(row.assessment_record_id || ''),
    provider: String(row.provider || ''),
    status: String(row.status || ''),
    queryKeywords: asStringArray(row.query_keywords),
    riskTags: asStringArray(row.risk_tags),
    extractedFlags,
    verificationSummary: extractedFlags.verificationSummary || null,
    rawResults,
    rawResultCount: rawResults.length,
    errorMessage: row.error_message ? String(row.error_message) : '',
    startedAt: row.started_at ? toIsoLikeString(row.started_at) : '',
    finishedAt: row.finished_at ? toIsoLikeString(row.finished_at) : '',
    createdAt: toIsoLikeString(row.created_at),
    updatedAt: toIsoLikeString(row.updated_at)
  };
}

export function toVerificationLogRow({
  recordId,
  clientInstanceId,
  provider = 'zhipu_web_search',
  status = 'pending',
  queryKeywords = [],
  rawResults = [],
  extractedFlags = {},
  riskTags = [],
  errorMessage = '',
  startedAt = null,
  finishedAt = null,
  now = () => new Date()
}) {
  const timestamp = now().toISOString();
  return {
    assessment_record_id: recordId,
    client_instance_id: clientInstanceId,
    provider,
    status,
    query_keywords: queryKeywords,
    raw_results: rawResults,
    extracted_flags: extractedFlags,
    risk_tags: riskTags,
    error_message: errorMessage || null,
    started_at: startedAt || null,
    finished_at: finishedAt || (['completed', 'failed', 'skipped'].includes(status) ? timestamp : null),
    updated_at: timestamp
  };
}

export function normalizeIncomingVerificationReview(body = {}, recordId, clientInstanceId) {
  const action = String(body.action || '').trim();
  const reviewerName = String(body.reviewerName || '').trim();
  const reviewerDecision = String(body.reviewerDecision || '').trim();
  const verificationLogId = String(body.verificationLogId || '').trim();

  if (!['accept_suggestion', 'manual_override', 'mark_reviewed'].includes(action)) {
    throw new Error('Invalid verification review action.');
  }
  if (!reviewerName) {
    throw new Error('reviewerName is required.');
  }
  if (!['normal', 'unknown', 'medium', 'serious'].includes(reviewerDecision)) {
    throw new Error('Invalid reviewerDecision.');
  }
  if (verificationLogId && !isUuid(verificationLogId)) {
    throw new Error('Invalid verificationLogId.');
  }

  return {
    recordId,
    verificationLogId: verificationLogId || null,
    action,
    reviewerName,
    reviewerDecision,
    previousPublicCreditStatus: String(body.previousPublicCreditStatus || '').trim(),
    suggestedPublicCreditStatus: String(body.suggestedPublicCreditStatus || '').trim(),
    evidenceUrl: String(body.evidenceUrl || '').trim(),
    evidenceNote: String(body.evidenceNote || '').trim(),
    evidenceAttachments: normalizeEvidenceAttachments(body.evidenceAttachments, clientInstanceId, recordId),
    verificationSnapshot: asObject(body.verificationSnapshot),
    appliedFields: asObject(body.appliedFields)
  };
}

export function toVerificationReviewRow(review, clientInstanceId) {
  return {
    assessment_record_id: review.recordId,
    verification_log_id: review.verificationLogId,
    client_instance_id: clientInstanceId,
    action: review.action,
    reviewer_name: review.reviewerName,
    reviewer_decision: review.reviewerDecision,
    previous_public_credit_status: review.previousPublicCreditStatus || null,
    suggested_public_credit_status: review.suggestedPublicCreditStatus || null,
    evidence_url: review.evidenceUrl || null,
    evidence_note: review.evidenceNote || null,
    verification_snapshot: {
      ...review.verificationSnapshot,
      evidenceAttachments: review.evidenceAttachments
    },
    applied_fields: review.appliedFields,
    evidence_attachments: review.evidenceAttachments
  };
}

export async function mapVerificationReviewRow(row = {}, { signEvidenceAttachments = async (attachments) => attachments } = {}) {
  const verificationSnapshot = asObject(row.verification_snapshot);
  const evidenceAttachments = row.evidence_attachments ?? verificationSnapshot.evidenceAttachments;
  return {
    id: String(row.id),
    recordId: String(row.assessment_record_id || ''),
    verificationLogId: row.verification_log_id ? String(row.verification_log_id) : '',
    action: String(row.action || ''),
    reviewerName: String(row.reviewer_name || ''),
    reviewerDecision: String(row.reviewer_decision || ''),
    previousPublicCreditStatus: String(row.previous_public_credit_status || ''),
    suggestedPublicCreditStatus: String(row.suggested_public_credit_status || ''),
    evidenceUrl: String(row.evidence_url || ''),
    evidenceNote: String(row.evidence_note || ''),
    evidenceAttachments: await signEvidenceAttachments(Array.isArray(evidenceAttachments) ? evidenceAttachments : []),
    verificationSnapshot,
    appliedFields: asObject(row.applied_fields),
    createdAt: toIsoLikeString(row.created_at)
  };
}

export function buildVerificationKeywords(institutionName = '') {
  const name = String(institutionName || '').trim() || '机构名称';
  return [
    `${name} 行政处罚`,
    `${name} 被执行人`,
    `${name} 失信被执行人`,
    `${name} 医疗美容处罚`,
    `${name} 非法行医`,
    `${name} 经营异常`,
    `${name} 严重违法失信`
  ];
}

export function sanitizeFileName(value = '') {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}_.-]+/gu, '_')
    .replace(/^_+|_+$/g, '');
  return normalized.slice(0, 120) || 'evidence';
}

export function sanitizeStorageSegment(value = '') {
  return String(value || '').replace(/[^a-zA-Z0-9._:-]+/g, '_').slice(0, 128) || 'unknown';
}

export function normalizeEvidenceAttachments(value, clientInstanceId, recordId, { bucket = '' } = {}) {
  if (!Array.isArray(value)) return [];
  const prefix = `${sanitizeStorageSegment(clientInstanceId)}/${sanitizeStorageSegment(recordId)}/`;

  return value
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      id: String(item.id || '').trim(),
      bucket: String(item.bucket || '').trim(),
      path: String(item.path || '').trim(),
      fileName: String(item.fileName || '').trim(),
      mimeType: String(item.mimeType || '').trim(),
      size: Number(item.size || 0),
      uploadedAt: String(item.uploadedAt || '').trim()
    }))
    .filter((item) => (!bucket || item.bucket === bucket) && item.path.startsWith(prefix) && item.fileName)
    .slice(0, 6);
}

export function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function asStringArray(value) {
  return Array.isArray(value) ? value.map(String) : [];
}

function toIsoLikeString(value) {
  if (value instanceof Date) return value.toISOString();
  return String(value || '');
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
