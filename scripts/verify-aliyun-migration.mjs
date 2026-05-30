import { createOssClientFromEnv } from '../aliyun-api/ossStorage.js';
import { createAssessmentDatabaseFromEnv, resolveDatabaseDriver } from '../aliyun-api/databaseFactory.js';
import {
  parseVerifierBoolean,
  verifyAliyunMigration
} from './aliyun-migration-verifier.mjs';

const driver = resolveDatabaseDriver(process.env.ALIYUN_DB_DRIVER || process.env.ALIYUN_RDS_DRIVER);
const database = createAssessmentDatabaseFromEnv({ env: process.env });

try {
  const checkOss = parseVerifierBoolean(process.env.VERIFY_OSS, false);
  const result = await verifyAliyunMigration({
    pool: database.pool,
    dialect: driver,
    ossClient: checkOss ? createOssClientFromEnv(process.env) : null,
    backupDir: process.env.BACKUP_DIR,
    exactCounts: parseVerifierBoolean(process.env.VERIFY_EXACT_COUNTS, false),
    checkOss
  });

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
} finally {
  await database.pool.end();
}
