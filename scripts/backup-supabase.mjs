import {
  backupSupabaseForAliyunMigration,
  createDefaultBackupDir
} from './supabase-backup.mjs';
import { parseTableNames } from './supabase-rds-migration.mjs';

const outputDir = process.env.BACKUP_OUTPUT_DIR || createDefaultBackupDir();
const summary = await backupSupabaseForAliyunMigration({
  supabaseUrl: process.env.SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  outputDir,
  tableNames: parseTableNames(process.env.BACKUP_TABLES || process.env.MIGRATE_TABLES || ''),
  batchSize: Number(process.env.BACKUP_BATCH_SIZE || process.env.MIGRATE_BATCH_SIZE || 500)
});

console.log(JSON.stringify(summary, null, 2));
