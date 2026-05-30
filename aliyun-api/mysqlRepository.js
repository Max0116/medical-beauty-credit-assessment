import mysql from 'mysql2/promise';
import {
  asObject,
  mapRecordRow,
  mapVerificationLogRow,
  mapVerificationReviewRow,
  normalizeIncomingRecord,
  normalizeIncomingVerificationReview,
  toRecordRow,
  toVerificationLogRow,
  toVerificationReviewRow
} from './assessmentContract.js';

export function createMysqlPoolFromEnv(env = process.env) {
  const host = env.ALIYUN_MYSQL_HOST || env.ALIYUN_RDS_HOST;
  if (!host) return null;

  const pool = mysql.createPool({
    host,
    port: Number(env.ALIYUN_MYSQL_PORT || env.ALIYUN_RDS_PORT || 3306),
    database: env.ALIYUN_MYSQL_DATABASE || env.ALIYUN_RDS_DATABASE,
    user: env.ALIYUN_MYSQL_USER || env.ALIYUN_RDS_USER,
    password: env.ALIYUN_MYSQL_PASSWORD || env.ALIYUN_RDS_PASSWORD,
    waitForConnections: true,
    connectionLimit: Number(env.ALIYUN_MYSQL_POOL_MAX || env.ALIYUN_RDS_POOL_MAX || 8),
    connectTimeout: Number(env.ALIYUN_MYSQL_CONNECT_TIMEOUT_MS || env.ALIYUN_RDS_CONNECT_TIMEOUT_MS || 5000),
    ssl: parseBoolean(env.ALIYUN_MYSQL_SSL || env.ALIYUN_RDS_SSL) ? {} : undefined
  });

  return {
    query: async (sql, values = []) => {
      const [rows] = await pool.execute(sql, values);
      return { rows: Array.isArray(rows) ? rows : [], rowCount: Array.isArray(rows) ? rows.length : 0 };
    },
    end: () => pool.end()
  };
}

export function createMysqlAssessmentRepository({
  pool,
  now = () => new Date(),
  id = createId,
  signEvidenceAttachments
} = {}) {
  if (!pool?.query) {
    throw new Error('MySQL repository requires a mysql-compatible pool.');
  }

  const query = (text, values = []) => pool.query(text, values);

  const health = async () => {
    await query('select 1 as ok');
    return { ok: true, database: 'mysql' };
  };

  const loadDraft = async (clientInstanceId) => {
    const { rows } = await query(
      'select form_snapshot from assessment_drafts where client_instance_id = ?',
      [clientInstanceId]
    );
    return rows[0] ? { form: asObject(rows[0].form_snapshot) } : null;
  };

  const saveDraft = async (clientInstanceId, form) => {
    await query(
      [
        'insert into assessment_drafts (client_instance_id, form_snapshot, updated_at)',
        'values (?, ?, current_timestamp(3))',
        'on duplicate key update',
        'form_snapshot = values(form_snapshot),',
        'updated_at = current_timestamp(3)'
      ].join(' '),
      [clientInstanceId, json(form)]
    );
    return { form };
  };

  const deleteDraft = async (clientInstanceId) => {
    await query('delete from assessment_drafts where client_instance_id = ?', [clientInstanceId]);
    return null;
  };

  const listRecords = async (clientInstanceId, { limit = 12 } = {}) => {
    const { rows } = await query(
      [
        'select * from assessment_records',
        'where client_instance_id = ?',
        'order by created_at desc',
        'limit ?'
      ].join(' '),
      [clientInstanceId, Number(limit) || 12]
    );
    return { records: rows.map(mapRecordRow) };
  };

  const loadRecord = async (clientInstanceId, recordId) => {
    const { rows } = await query(
      'select * from assessment_records where client_instance_id = ? and id = ?',
      [clientInstanceId, recordId]
    );
    return rows[0] ? { record: mapRecordRow(rows[0]) } : { record: null };
  };

  const saveRecord = async (clientInstanceId, { form, result, record }) => {
    const normalized = normalizeIncomingRecord(record, form, result, now, id);
    const row = toRecordRow(normalized, clientInstanceId);
    await query(
      [
        'insert into assessment_records (',
        'id, client_instance_id, institution_name, final_grade, final_decision, total_score,',
        'max_term_days, suggested_limit, stable_monthly_average, needs_approval,',
        'redline_reasons, cap_reasons, approval_reasons, form_snapshot, result_snapshot, created_at, updated_at',
        ') values (',
        '?, ?, ?, ?, ?, ?,',
        '?, ?, ?, ?,',
        '?, ?, ?, ?, ?, ?, ?',
        ') on duplicate key update',
        'institution_name = values(institution_name),',
        'final_grade = values(final_grade),',
        'final_decision = values(final_decision),',
        'total_score = values(total_score),',
        'max_term_days = values(max_term_days),',
        'suggested_limit = values(suggested_limit),',
        'stable_monthly_average = values(stable_monthly_average),',
        'needs_approval = values(needs_approval),',
        'redline_reasons = values(redline_reasons),',
        'cap_reasons = values(cap_reasons),',
        'approval_reasons = values(approval_reasons),',
        'form_snapshot = values(form_snapshot),',
        'result_snapshot = values(result_snapshot),',
        'updated_at = values(updated_at)'
      ].join(' '),
      recordValues(row)
    );
    return loadRecord(clientInstanceId, row.id);
  };

  const updateRecord = async (clientInstanceId, recordId, { form, result, record }) => {
    const normalized = normalizeIncomingRecord({ ...record, id: recordId }, form, result, now, id);
    const row = toRecordRow(normalized, clientInstanceId);
    await query(
      [
        'update assessment_records set',
        'institution_name = ?, final_grade = ?, final_decision = ?, total_score = ?,',
        'max_term_days = ?, suggested_limit = ?, stable_monthly_average = ?, needs_approval = ?,',
        'redline_reasons = ?, cap_reasons = ?, approval_reasons = ?,',
        'form_snapshot = ?, result_snapshot = ?, updated_at = ?',
        'where client_instance_id = ? and id = ?'
      ].join(' '),
      [
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
        row.updated_at,
        clientInstanceId,
        recordId
      ]
    );
    return loadRecord(clientInstanceId, recordId);
  };

  const listVerificationLogs = async (clientInstanceId, recordId, { limit = 6 } = {}) => {
    const { rows } = await query(
      [
        'select * from verification_logs',
        'where client_instance_id = ? and assessment_record_id = ?',
        'order by created_at desc',
        'limit ?'
      ].join(' '),
      [clientInstanceId, recordId, Number(limit) || 6]
    );
    return { verificationLogs: rows.map(mapVerificationLogRow) };
  };

  const loadVerificationLog = async (clientInstanceId, recordId, logId) => {
    const { rows } = await query(
      'select * from verification_logs where client_instance_id = ? and assessment_record_id = ? and id = ?',
      [clientInstanceId, recordId, logId]
    );
    return rows[0] ? mapVerificationLogRow(rows[0]) : null;
  };

  const saveVerificationLog = async (clientInstanceId, payload, { logId } = {}) => {
    const row = toVerificationLogRow({ ...payload, clientInstanceId, now });
    const nextLogId = logId || id();
    if (logId) {
      await query(
        [
          'update verification_logs set',
          'provider = ?, status = ?, query_keywords = ?, raw_results = ?,',
          'extracted_flags = ?, risk_tags = ?, error_message = ?,',
          'started_at = ?, finished_at = ?, updated_at = ?',
          'where assessment_record_id = ? and client_instance_id = ? and id = ?'
        ].join(' '),
        [
          row.provider,
          row.status,
          json(row.query_keywords),
          json(row.raw_results),
          json(row.extracted_flags),
          json(row.risk_tags),
          row.error_message,
          row.started_at,
          row.finished_at,
          row.updated_at,
          row.assessment_record_id,
          row.client_instance_id,
          nextLogId
        ]
      );
    } else {
      await query(
        [
          'insert into verification_logs (',
          'id, assessment_record_id, client_instance_id, provider, status, query_keywords, raw_results,',
          'extracted_flags, risk_tags, error_message, started_at, finished_at, updated_at',
          ') values (',
          '?, ?, ?, ?, ?, ?, ?,',
          '?, ?, ?, ?, ?, ?',
          ')'
        ].join(' '),
        [
          nextLogId,
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
        ]
      );
    }

    return {
      verificationLog: await loadVerificationLog(clientInstanceId, row.assessment_record_id, nextLogId)
    };
  };

  const listVerificationReviews = async (clientInstanceId, recordId, { limit = 20 } = {}) => {
    const { rows } = await query(
      [
        'select * from verification_reviews',
        'where client_instance_id = ? and assessment_record_id = ?',
        'order by created_at desc',
        'limit ?'
      ].join(' '),
      [clientInstanceId, recordId, Number(limit) || 20]
    );
    return {
      verificationReviews: await Promise.all(rows.map((row) => mapVerificationReviewRow(row, { signEvidenceAttachments })))
    };
  };

  const loadVerificationReview = async (reviewId) => {
    const { rows } = await query('select * from verification_reviews where id = ?', [reviewId]);
    return rows[0] ? mapVerificationReviewRow(rows[0], { signEvidenceAttachments }) : null;
  };

  const saveVerificationReview = async (clientInstanceId, recordId, body) => {
    const review = normalizeIncomingVerificationReview(body, recordId, clientInstanceId);
    const row = toVerificationReviewRow(review, clientInstanceId);
    const reviewId = id();
    await query(
      [
        'insert into verification_reviews (',
        'id, assessment_record_id, verification_log_id, client_instance_id, action, reviewer_name, reviewer_decision,',
        'previous_public_credit_status, suggested_public_credit_status, evidence_url, evidence_note,',
        'verification_snapshot, applied_fields, evidence_attachments',
        ') values (',
        '?, ?, ?, ?, ?, ?, ?,',
        '?, ?, ?, ?,',
        '?, ?, ?',
        ')'
      ].join(' '),
      [
        reviewId,
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
    return { verificationReview: await loadVerificationReview(reviewId) };
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

function recordValues(row) {
  return [
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
  ];
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
