import { createOssClientFromEnv } from '../aliyun-api/ossStorage.js';
import { createPostgresPoolFromEnv } from '../aliyun-api/rdsRepository.js';
import {
  parseVerifierBoolean,
  verifyAliyunMigration
} from './aliyun-migration-verifier.mjs';

const pool = createPostgresPoolFromEnv(process.env);
if (!pool) throw new Error('ALIYUN_RDS_HOST is required.');

try {
  const checkOss = parseVerifierBoolean(process.env.VERIFY_OSS, false);
  const result = await verifyAliyunMigration({
    pool,
    ossClient: checkOss ? createOssClientFromEnv(process.env) : null,
    backupDir: process.env.BACKUP_DIR,
    exactCounts: parseVerifierBoolean(process.env.VERIFY_EXACT_COUNTS, false),
    checkOss
  });

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
} finally {
  await pool.end();
}
