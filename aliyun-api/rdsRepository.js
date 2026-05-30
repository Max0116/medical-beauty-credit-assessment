import { Pool } from 'pg';
import {
  mapRecordRow,
  mapVerificationLogRow,
  mapVerificationReviewRow,
  normalizeIncomingRecord,
  normalizeIncomingVerificationReview,
  toRecordRow,
  toVerificationLogRow,
  toVerificationReviewRow
} from './assessmentContract.js';

export function createPostgresPoolFromEnv(env = process.env) {
  if (!env.ALIYUN_RDS_HOST) return null;
  return new Pool({
    host: env.ALIYUN_RDS_HOST,
    port: Number(env.ALIYUN_RDS_PORT || 5432),
    database: env.ALIYUN_RDS_DATABASE,
    user: env.ALIYUN_RDS_USER,
    password: env.ALIYUN_RDS_PASSWORD,
    ssl: parseBoolean(env.ALIYUN_RDS_SSL) ? { rejectUnauthorized: false } : undefined,
    max: Number(env.ALIYUN_RDS_POOL_MAX || 8),
    idleTimeoutMillis: Number(env.ALIYUN_RDS_IDLE_TIMEOUT_MS || 30000),
    connectionTimeoutMillis: Number(env.ALIYUN_RDS_CONNECT_TIMEOUT_MS || 5000)
  });
}

export function createRdsAssessmentRepository({
  pool,
  now = () => new Date(),
  id = createId,
  signEvidenceAttachments
} = {}) {
  if (!pool?.query) {
    throw new Error('RDS repository requires a pg-compatible pool.');
  }

  const query = (text, values = []) => pool.query(text, values);

  const health = async () => {
    await query('select 1 as ok');
    return { ok: true, database: 'postgres' };
  };

  const loadDraft = async (clientInstanceId) => {
    const { rows } = await query(
      'select form_snapshot from assessment_drafts where client_instance_id = $1',
      [clientInstanceId]
    );
    return rows[0] ? { form: rows[0].form_snapshot } : null;
  };

  const saveDraft = async (clientInstanceId, form) => {
    await query(
      [
        'insert into assessment_drafts (client_instance_id, form_snapshot, updated_at)',
        'values ($1, $2::jsonb, now())',
        'on conflict (client_instance_id) do update set',
        'form_snapshot = excluded.form_snapshot,',
        'updated_at = now()'
      ].join(' '),
      [clientInstanceId, json(form)]
    );
    return { form };
  };

  const deleteDraft = async (clientInstanceId) => {
    await query('delete from assessment_drafts where client_instance_id = $1', [clientInstanceId]);
    return null;
  };

  const listRecords = async (clientInstanceId, { limit = 12 } = {}) => {
    const { rows } = await query(
      [
        'select * from assessment_records',
        'where client_instance_id = $1',
        'order by created_at desc',
        'limit $2'
      ].join(' '),
      [clientInstanceId, limit]
    );
    return { records: rows.map(mapRecordRow) };
  };

  const loadRecord = async (clientInstanceId, recordId) => {
    const { rows } = await query(
      'select * from assessment_records where client_instance_id = $1 and id = $2',
      [clientInstanceId, recordId]
    );
    return rows[0] ? { record: mapRecordRow(rows[0]) } : { record: null };
  };

  const saveRecord = async (clientInstanceId, { form, result, record }) => {
    const normalized = normalizeIncomingRecord(record, form, result, now, id);
    const row = toRecordRow(normalized, clientInstanceId);
    const { rows } = await query(
      [
        'insert into assessment_records (',
        'id, client_instance_id, institution_name, final_grade, final_decision, total_score,',
        'max_term_days, suggested_limit, stable_monthly_average, needs_approval,',
        'redline_reasons, cap_reasons, approval_reasons, form_snapshot, result_snapshot, created_at, updated_at',
        ') values (',
        '$1, $2, $3, $4, $5, $6,',
        '$7, $8, $9, $10,',
        '$11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16, $17',
        ') returning *'
      ].join(' '),
      [
        row.id,
        row.client_instance_id,
        row.institution_name,
        row.final_grade,
        row.final_decision,
        row.total_score,
        row.max_term_days,
        row.suggested_limit,
        row.stable_monthly_average,
        row.needs_approval,
        json(row.redline_reasons),
        json(row.cap_reasons),
        json(row.approval_reasons),
        json(row.form_snapshot),
        json(row.result_snapshot),
        row.created_at,
        row.updated_at
      ]
    );
    return { record: mapRecordRow(rows[0]) };
  };

  const updateRecord = async (clientInstanceId, recordId, { form, result, record }) => {
    const normalized = normalizeIncomingRecord({ ...record, id: recordId }, form, result, now, id);
    const row = toRecordRow(normalized, clientInstanceId);
    const { rows } = await query(
      [
        'update assessment_records set',
        'institution_name = $3, final_grade = $4, final_decision = $5, total_score = $6,',
        'max_term_days = $7, suggested_limit = $8, stable_monthly_average = $9, needs_approval = $10,',
        'redline_reasons = $11::jsonb, cap_reasons = $12::jsonb, approval_reasons = $13::jsonb,',
        'form_snapshot = $14::jsonb, result_snapshot = $15::jsonb, updated_at = $16',
        'where client_instance_id = $1 and id = $2',
        'returning *'
      ].join(' '),
      [
        clientInstanceId,
        recordId,
        row.institution_name,
        row.final_grade,
        row.final_decision,
        row.total_score,
        row.max_term_days,
        row.suggested_limit,
        row.stable_monthly_average,
        row.needs_approval,
        json(row.redline_reasons),
        json(row.cap_reasons),
        json(row.approval_reasons),
        json(row.form_snapshot),
        json(row.result_snapshot),
        row.updated_at
      ]
    );
    return rows[0] ? { record: mapRecordRow(rows[0]) } : { record: null };
  };

  const listVerificationLogs = async (clientInstanceId, recordId, { limit = 6 } = {}) => {
    const { rows } = await query(
      [
        'select * from verification_logs',
        'where client_instance_id = $1 and assessment_record_id = $2',
        'order by created_at desc',
        'limit $3'
      ].join(' '),
      [clientInstanceId, recordId, limit]
    );
    return { verificationLogs: rows.map(mapVerificationLogRow) };
  };

  const saveVerificationLog = async (clientInstanceId, payload, { logId } = {}) => {
    const row = toVerificationLogRow({ ...payload, clientInstanceId, now });
    const values = [
      row.assessment_record_id,
      row.client_instance_id,
      row.provider,
      row.status,
      json(row.query_keywords),
      json(row.raw_results),
      json(row.extracted_flags),
      json(row.risk_tags),
      row.error_message,
      row.started_at,
      row.finished_at,
      row.updated_at
    ];
    const sql = logId
      ? [
        'update verification_logs set',
        'provider = $3, status = $4, query_keywords = $5::jsonb, raw_results = $6::jsonb,',
        'extracted_flags = $7::jsonb, risk_tags = $8::jsonb, error_message = $9,',
        'started_at = $10, finished_at = $11, updated_at = $12',
        'where assessment_record_id = $1 and client_instance_id = $2 and id = $13',
        'returning *'
      ].join(' ')
      : [
        'insert into verification_logs (',
        'assessment_record_id, client_instance_id, provider, status, query_keywords, raw_results,',
        'extracted_flags, risk_tags, error_message, started_at, finished_at, updated_at',
        ') values (',
        '$1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11, $12',
        ') returning *'
      ].join(' ');
    const { rows } = await query(sql, logId ? [...values, logId] : values);
    return { verificationLog: rows[0] ? mapVerificationLogRow(rows[0]) : null };
  };

  const listVerificationReviews = async (clientInstanceId, recordId, { limit = 20 } = {}) => {
    const { rows } = await query(
      [
        'select * from verification_reviews',
        'where client_instance_id = $1 and assessment_record_id = $2',
        'order by created_at desc',
        'limit $3'
      ].join(' '),
      [clientInstanceId, recordId, limit]
    );
    return {
      verificationReviews: await Promise.all(rows.map((row) => mapVerificationReviewRow(row, { signEvidenceAttachments })))
    };
  };

  const saveVerificationReview = async (clientInstanceId, recordId, body) => {
    const review = normalizeIncomingVerificationReview(body, recordId, clientInstanceId);
    const row = toVerificationReviewRow(review, clientInstanceId);
    const { rows } = await query(
      [
        'insert into verification_reviews (',
        'assessment_record_id, verification_log_id, client_instance_id, action, reviewer_name, reviewer_decision,',
        'previous_public_credit_status, suggested_public_credit_status, evidence_url, evidence_note,',
        'verification_snapshot, applied_fields, evidence_attachments',
        ') values (',
        '$1, $2, $3, $4, $5, $6,',
        '$7, $8, $9, $10,',
        '$11::jsonb, $12::jsonb, $13::jsonb',
        ') returning *'
      ].join(' '),
      [
        row.assessment_record_id,
        row.verification_log_id,
        row.client_instance_id,
        row.action,
        row.reviewer_name,
        row.reviewer_decision,
        row.previous_public_credit_status,
        row.suggested_public_credit_status,
        row.evidence_url,
        row.evidence_note,
        json(row.verification_snapshot),
        json(row.applied_fields),
        json(row.evidence_attachments)
      ]
    );
    return {
      verificationReview: rows[0]
        ? await mapVerificationReviewRow(rows[0], { signEvidenceAttachments })
        : null
    };
  };

  return {
    health,
    loadDraft,
    saveDraft,
    deleteDraft,
    listRecords,
    loadRecord,
    saveRecord,
    updateRecord,
    listVerificationLogs,
    saveVerificationLog,
    listVerificationReviews,
    saveVerificationReview
  };
}

function parseBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
