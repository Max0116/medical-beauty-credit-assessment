import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeRdsDialect, resolveTableConfigs } from './supabase-rds-migration.mjs';

export async function verifyAliyunMigration({
  pool,
  dialect = 'postgres',
  ossClient,
  backupDir,
  exactCounts = false,
  checkOss = false,
  readFileImpl = readFile,
  logger = console
} = {}) {
  const normalizedDialect = normalizeRdsDialect(dialect);
  if (!pool?.query) throw new Error('Aliyun migration verification requires a database pool with query().');
  if (!backupDir) throw new Error('BACKUP_DIR is required.');
  if (checkOss && !ossClient?.head) throw new Error('VERIFY_OSS=true requires an ali-oss client with head().');

  const backup = await loadBackupSnapshot({ backupDir, readFileImpl });
  const tableResults = [];
  const failures = [];

  for (const table of backup.manifest.tables) {
    resolveTableConfigs([table.table]);
    const targetRows = await countTableRows(pool, table.table, { dialect: normalizedDialect });
    const ok = exactCounts ? targetRows === table.rows : targetRows >= table.rows;
    if (!ok) {
      failures.push({
        type: 'table_count_mismatch',
        table: table.table,
        expectedRows: table.rows,
        targetRows,
        exactCounts
      });
    }
    tableResults.push({
      table: table.table,
      expectedRows: table.rows,
      targetRows,
      ok
    });
  }

  const evidenceResult = checkOss
    ? await verifyOssAttachments({
      ossClient,
      attachments: backup.evidenceAttachments,
      logger
    })
    : {
      checked: false,
      expected: backup.evidenceAttachments.length,
      found: 0,
      missing: 0,
      failures: []
    };

  failures.push(...evidenceResult.failures.map((failure) => ({
    type: 'oss_attachment_missing',
    ...failure
  })));

  return {
    ok: failures.length === 0,
    backupDir,
    dialect: normalizedDialect,
    exactCounts,
    checkOss,
    tables: tableResults,
    evidenceAttachments: evidenceResult,
    failures
  };
}

export async function loadBackupSnapshot({ backupDir, readFileImpl = readFile } = {}) {
  if (!backupDir) throw new Error('BACKUP_DIR is required.');
  const manifest = await readJson(readFileImpl, join(backupDir, 'manifest.json'));
  if (manifest?.type !== 'supabase_pre_migration_backup') {
    throw new Error('Backup manifest type must be supabase_pre_migration_backup.');
  }
  const evidenceFile = manifest.evidenceAttachments?.file || 'evidence-attachments.json';
  const evidenceAttachments = await readJson(readFileImpl, join(backupDir, evidenceFile));
  if (!Array.isArray(evidenceAttachments)) {
    throw new Error('Backup evidence attachment file must contain an array.');
  }

  return {
    manifest,
    evidenceAttachments
  };
}

export async function countTableRows(pool, tableName, { dialect = 'postgres' } = {}) {
  resolveTableConfigs([tableName]);
  const normalizedDialect = normalizeRdsDialect(dialect);
  const sql = normalizedDialect === 'mysql'
    ? `select count(*) as count from ${tableName}`
    : `select count(*)::integer as count from ${tableName}`;
  const { rows } = await pool.query(sql);
  return Number(rows?.[0]?.count || 0);
}

export async function verifyOssAttachments({
  ossClient,
  attachments = [],
  logger = console
} = {}) {
  const failures = [];
  let found = 0;

  for (const attachment of attachments) {
    const path = String(attachment.path || '').trim();
    if (!path) continue;
    try {
      await ossClient.head(path);
      found += 1;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error || 'OSS head failed');
      logger.warn?.(`OSS attachment missing: ${path}`, errorMessage);
      failures.push({ path, errorMessage });
    }
  }

  return {
    checked: true,
    expected: attachments.length,
    found,
    missing: failures.length,
    failures
  };
}

export function parseVerifierBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

async function readJson(readFileImpl, filePath) {
  return JSON.parse(await readFileImpl(filePath, 'utf8'));
}
