import { createOssClientFromEnv } from '../aliyun-api/ossStorage.js';
import { migrateSupabaseEvidenceToOss } from './supabase-oss-migration.mjs';

const dryRun = parseBoolean(process.env.MIGRATE_DRY_RUN || process.env.SUPABASE_TO_OSS_DRY_RUN);
const ossClient = dryRun ? null : createOssClientFromEnv(process.env);
const summary = await migrateSupabaseEvidenceToOss({
  ossClient,
  supabaseUrl: process.env.SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  sourceBucket: process.env.SUPABASE_EVIDENCE_BUCKET || 'verification-evidence',
  targetBucket: process.env.ALIYUN_OSS_BUCKET || '',
  batchSize: Number(process.env.MIGRATE_BATCH_SIZE || 500),
  dryRun
});

console.log(JSON.stringify(summary, null, 2));

function parseBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}
