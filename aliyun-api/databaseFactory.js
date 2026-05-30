import { createMysqlAssessmentRepository, createMysqlPoolFromEnv } from './mysqlRepository.js';
import { createPostgresPoolFromEnv, createRdsAssessmentRepository } from './rdsRepository.js';

export const DATABASE_DRIVERS = {
  postgres: 'postgres',
  mysql: 'mysql'
};

export function resolveDatabaseDriver(value = '') {
  const driver = String(value || '').trim().toLowerCase();
  if (['mysql', 'mariadb'].includes(driver)) return DATABASE_DRIVERS.mysql;
  return DATABASE_DRIVERS.postgres;
}

export function createAssessmentDatabaseFromEnv({
  env = process.env,
  signEvidenceAttachments
} = {}) {
  const driver = resolveDatabaseDriver(env.ALIYUN_DB_DRIVER || env.ALIYUN_RDS_DRIVER);

  if (driver === DATABASE_DRIVERS.mysql) {
    const pool = createMysqlPoolFromEnv(env);
    if (!pool) {
      throw new Error('ALIYUN_MYSQL_HOST or ALIYUN_RDS_HOST is required when ALIYUN_DB_DRIVER=mysql.');
    }
    return {
      driver,
      pool,
      repository: createMysqlAssessmentRepository({ pool, signEvidenceAttachments })
    };
  }

  const pool = createPostgresPoolFromEnv(env);
  if (!pool) {
    throw new Error('ALIYUN_RDS_HOST is required when ALIYUN_DB_DRIVER=postgres.');
  }
  return {
    driver,
    pool,
    repository: createRdsAssessmentRepository({ pool, signEvidenceAttachments })
  };
}
