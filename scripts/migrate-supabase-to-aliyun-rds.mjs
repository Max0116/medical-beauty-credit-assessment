import { createAssessmentDatabaseFromEnv, resolveDatabaseDriver } from '../aliyun-api/databaseFactory.js';
import {
  migrateSupabaseToRds,
  parseTableNames
} from './supabase-rds-migration.mjs';

const dryRun = parseBoolean(process.env.MIGRATE_DRY_RUN || process.env.SUPABASE_TO_RDS_DRY_RUN);
const driver = resolveDatabaseDriver(process.env.ALIYUN_DB_DRIVER || process.env.ALIYUN_RDS_DRIVER);
const database = dryRun ? null : createAssessmentDatabaseFromEnv({ env: process.env });
const summary = await migrateSupabaseToRds({
  pool: database?.pool || null,
  supabaseUrl: process.env.SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  batchSize: Number(process.env.MIGRATE_BATCH_SIZE || 500),
  tableNames: parseTableNames(process.env.MIGRATE_TABLES),
  targetEvidenceBucket: process.env.MIGRATE_EVIDENCE_TARGET_BUCKET || process.env.ALIYUN_OSS_BUCKET || '',
  dialect: driver,
  dryRun
});

if (database?.pool?.end) await database.pool.end();

console.log(JSON.stringify(summary, null, 2));

function parseBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}
