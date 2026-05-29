export const SUPABASE_RDS_TABLES = [
  {
    name: 'assessment_records',
    conflictColumns: ['id'],
    jsonColumns: ['redline_reasons', 'cap_reasons', 'approval_reasons', 'form_snapshot', 'result_snapshot'],
    columns: [
      'id',
      'client_instance_id',
      'institution_name',
      'final_grade',
      'final_decision',
      'total_score',
      'max_term_days',
      'suggested_limit',
      'stable_monthly_average',
      'needs_approval',
      'redline_reasons',
      'cap_reasons',
      'approval_reasons',
      'form_snapshot',
      'result_snapshot',
      'created_at',
      'updated_at'
    ]
  },
  {
    name: 'assessment_drafts',
    conflictColumns: ['client_instance_id'],
    jsonColumns: ['form_snapshot'],
    columns: [
      'client_instance_id',
      'form_snapshot',
      'created_at',
      'updated_at'
    ]
  },
  {
    name: 'verification_logs',
    conflictColumns: ['id'],
    jsonColumns: ['query_keywords', 'raw_results', 'extracted_flags', 'risk_tags'],
    columns: [
      'id',
      'assessment_record_id',
      'client_instance_id',
      'provider',
      'status',
      'query_keywords',
      'raw_results',
      'extracted_flags',
      'risk_tags',
      'error_message',
      'started_at',
      'finished_at',
      'created_at',
      'updated_at'
    ]
  },
  {
    name: 'verification_reviews',
    conflictColumns: ['id'],
    jsonColumns: ['verification_snapshot', 'applied_fields', 'evidence_attachments'],
    defaults: {
      evidence_attachments: []
    },
    columns: [
      'id',
      'assessment_record_id',
      'verification_log_id',
      'client_instance_id',
      'action',
      'reviewer_name',
      'reviewer_decision',
      'previous_public_credit_status',
      'suggested_public_credit_status',
      'evidence_url',
      'evidence_note',
      'verification_snapshot',
      'applied_fields',
      'evidence_attachments',
      'created_at'
    ]
  }
];

export async function migrateSupabaseToRds({
  pool,
  supabaseUrl,
  serviceRoleKey,
  fetchImpl = globalThis.fetch,
  batchSize = 500,
  tableNames = SUPABASE_RDS_TABLES.map((table) => table.name),
  targetEvidenceBucket = '',
  dryRun = false,
  logger = console
} = {}) {
  if (!pool?.query && !dryRun) throw new Error('RDS migration requires a pg-compatible pool.');
  if (!fetchImpl) throw new Error('Fetch API is not available in this Node.js runtime.');
  const tableConfigs = resolveTableConfigs(tableNames);
  const summary = {
    ok: true,
    dryRun,
    source: 'supabase_rest',
    target: dryRun ? 'dry_run' : 'aliyun_rds',
    tables: []
  };

  for (const table of tableConfigs) {
    const tableSummary = {
      table: table.name,
      fetched: 0,
      upserted: 0,
      batches: 0
    };
    logger.info?.(`migrating table ${table.name}`);

    for await (const rows of fetchSupabaseTableBatches({
      supabaseUrl,
      serviceRoleKey,
      tableName: table.name,
      batchSize,
      fetchImpl
    })) {
      tableSummary.batches += 1;
      tableSummary.fetched += rows.length;

      if (!dryRun) {
        for (const row of rows) {
          await upsertSupabaseRow(pool, table, normalizeMigratedRow(table, row, { targetEvidenceBucket }));
        }
      }
      tableSummary.upserted += dryRun ? 0 : rows.length;
    }

    summary.tables.push(tableSummary);
  }

  return summary;
}

export async function* fetchSupabaseTableBatches({
  supabaseUrl,
  serviceRoleKey,
  tableName,
  batchSize = 500,
  fetchImpl = globalThis.fetch
} = {}) {
  const baseUrl = normalizeSupabaseUrl(supabaseUrl);
  if (!baseUrl) throw new Error('SUPABASE_URL is required.');
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required.');
  if (!/^[a-z_]+$/.test(tableName)) throw new Error(`Unexpected table name: ${tableName}`);

  let offset = 0;
  const pageSize = Math.max(1, Math.min(Number(batchSize) || 500, 1000));

  while (true) {
    const response = await fetchImpl(`${baseUrl}/rest/v1/${tableName}?select=*`, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Range: `${offset}-${offset + pageSize - 1}`,
        'Range-Unit': 'items'
      }
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Supabase ${tableName} export failed with status ${response.status}: ${text.slice(0, 240)}`);
    }

    const rows = text ? JSON.parse(text) : [];
    if (!Array.isArray(rows)) throw new Error(`Supabase ${tableName} response is not an array.`);
    if (!rows.length) break;
    yield rows;

    if (rows.length < pageSize) break;
    offset += rows.length;
  }
}

export async function upsertSupabaseRow(pool, table, row = {}) {
  const { sql, values } = buildUpsertQuery(table, row);
  await pool.query(sql, values);
}

export function buildUpsertQuery(table, row = {}) {
  const jsonColumns = new Set(table.jsonColumns || []);
  const defaults = table.defaults || {};
  const values = table.columns.map((column) => normalizeColumnValue(row[column] ?? defaults[column], jsonColumns.has(column)));
  const placeholders = table.columns.map((column, index) => `$${index + 1}${jsonColumns.has(column) ? '::jsonb' : ''}`);
  const updateColumns = table.columns.filter((column) => !table.conflictColumns.includes(column));
  const assignments = updateColumns.map((column) => `${column} = excluded.${column}`);

  return {
    sql: [
      `insert into ${table.name} (${table.columns.join(', ')})`,
      `values (${placeholders.join(', ')})`,
      `on conflict (${table.conflictColumns.join(', ')}) do update set`,
      assignments.join(', ')
    ].join(' '),
    values
  };
}

export function normalizeMigratedRow(table, row = {}, { targetEvidenceBucket = '' } = {}) {
  if (table.name !== 'verification_reviews' || !targetEvidenceBucket) return row;
  const evidenceAttachments = normalizeMigratedEvidenceAttachments(row.evidence_attachments, targetEvidenceBucket);
  const verificationSnapshot = row.verification_snapshot && typeof row.verification_snapshot === 'object' && !Array.isArray(row.verification_snapshot)
    ? {
      ...row.verification_snapshot,
      evidenceAttachments: normalizeMigratedEvidenceAttachments(row.verification_snapshot.evidenceAttachments, targetEvidenceBucket)
    }
    : row.verification_snapshot;

  return {
    ...row,
    evidence_attachments: evidenceAttachments,
    verification_snapshot: verificationSnapshot
  };
}

export function normalizeMigratedEvidenceAttachments(value, targetEvidenceBucket) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      ...item,
      bucket: targetEvidenceBucket || item.bucket
    }));
}

export function resolveTableConfigs(tableNames = []) {
  const requested = new Set(tableNames.map((name) => String(name || '').trim()).filter(Boolean));
  const configs = SUPABASE_RDS_TABLES.filter((table) => requested.has(table.name));
  if (configs.length !== requested.size) {
    const known = new Set(SUPABASE_RDS_TABLES.map((table) => table.name));
    const unknown = [...requested].filter((name) => !known.has(name));
    throw new Error(`Unknown migration table(s): ${unknown.join(', ')}`);
  }
  return configs;
}

export function parseTableNames(value = '') {
  const names = String(value || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  return names.length ? names : SUPABASE_RDS_TABLES.map((table) => table.name);
}

export function normalizeSupabaseUrl(value = '') {
  return String(value || '').trim().replace(/\/+$/, '');
}

function normalizeColumnValue(value, isJsonColumn) {
  if (isJsonColumn) return JSON.stringify(value ?? null);
  return value === undefined ? null : value;
}
