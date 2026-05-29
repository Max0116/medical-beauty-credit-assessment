import { createPostgresPoolFromEnv } from '../aliyun-api/rdsRepository.js';
import {
  migrateSupabaseToRds,
  parseTableNames
} from './supabase-rds-migration.mjs';

const dryRun = parseBoolean(process.env.MIGRATE_DRY_RUN || process.env.SUPABASE_TO_RDS_DRY_RUN);
const pool = dryRun ? null : createPostgresPoolFromEnv(process.env);
const summary = await migrateSupabaseToRds({
  pool,
  supabaseUrl: process.env.SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  batchSize: Number(process.env.MIGRATE_BATCH_SIZE || 500),
  tableNames: parseTableNames(process.env.MIGRATE_TABLES),
  targetEvidenceBucket: process.env.MIGRATE_EVIDENCE_TARGET_BUCKET || process.env.ALIYUN_OSS_BUCKET || '',
  dryRun
});

if (pool?.end) await pool.end();

console.log(JSON.stringify(summary, null, 2));

function parseBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}
