import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collectSupabaseEvidenceAttachments } from './supabase-oss-migration.mjs';
import {
  fetchSupabaseTableBatches,
  parseTableNames,
  resolveTableConfigs
} from './supabase-rds-migration.mjs';

export async function backupSupabaseForAliyunMigration({
  supabaseUrl,
  serviceRoleKey,
  outputDir,
  tableNames = parseTableNames(''),
  batchSize = 500,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  mkdirImpl = mkdir,
  writeFileImpl = writeFile,
  logger = console
} = {}) {
  if (!outputDir) throw new Error('BACKUP_OUTPUT_DIR is required.');
  const tables = resolveTableConfigs(tableNames);
  const startedAt = now().toISOString();
  const summary = {
    ok: true,
    type: 'supabase_pre_migration_backup',
    createdAt: startedAt,
    outputDir,
    tables: [],
    evidenceAttachments: {
      file: 'evidence-attachments.json',
      count: 0
    }
  };

  await mkdirImpl(outputDir, { recursive: true });

  for (const table of tables) {
    const rows = [];
    let batches = 0;
    logger.info?.(`backing up Supabase table ${table.name}`);
    for await (const batch of fetchSupabaseTableBatches({
      supabaseUrl,
      serviceRoleKey,
      tableName: table.name,
      batchSize,
      fetchImpl
    })) {
      batches += 1;
      rows.push(...batch);
    }

    const fileName = `${table.name}.json`;
    await writeJson(writeFileImpl, join(outputDir, fileName), rows);
    summary.tables.push({
      table: table.name,
      file: fileName,
      rows: rows.length,
      batches
    });
  }

  const evidenceAttachments = await collectSupabaseEvidenceAttachments({
    supabaseUrl,
    serviceRoleKey,
    fetchImpl,
    batchSize
  });
  await writeJson(writeFileImpl, join(outputDir, summary.evidenceAttachments.file), evidenceAttachments);
  summary.evidenceAttachments.count = evidenceAttachments.length;

  await writeJson(writeFileImpl, join(outputDir, 'manifest.json'), {
    ...summary,
    completedAt: now().toISOString()
  });

  return summary;
}

export function createDefaultBackupDir(now = () => new Date()) {
  const timestamp = now().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return join(process.cwd(), 'backups', `supabase-pre-aliyun-${timestamp}`);
}

async function writeJson(writeFileImpl, filePath, value) {
  await writeFileImpl(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
