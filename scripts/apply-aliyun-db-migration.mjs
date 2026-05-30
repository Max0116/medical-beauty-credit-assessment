import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createAssessmentDatabaseFromEnv, resolveDatabaseDriver } from '../aliyun-api/databaseFactory.js';

const driver = resolveDatabaseDriver(process.env.ALIYUN_DB_DRIVER || process.env.ALIYUN_RDS_DRIVER);
const required = driver === 'mysql'
  ? [
    process.env.ALIYUN_MYSQL_HOST ? 'ALIYUN_MYSQL_HOST' : 'ALIYUN_RDS_HOST',
    process.env.ALIYUN_MYSQL_DATABASE ? 'ALIYUN_MYSQL_DATABASE' : 'ALIYUN_RDS_DATABASE',
    process.env.ALIYUN_MYSQL_USER ? 'ALIYUN_MYSQL_USER' : 'ALIYUN_RDS_USER',
    process.env.ALIYUN_MYSQL_PASSWORD ? 'ALIYUN_MYSQL_PASSWORD' : 'ALIYUN_RDS_PASSWORD'
  ]
  : [
    'ALIYUN_RDS_HOST',
    'ALIYUN_RDS_DATABASE',
    'ALIYUN_RDS_USER',
    'ALIYUN_RDS_PASSWORD'
  ];

const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  throw new Error(`Missing required ${driver} env vars: ${missing.join(', ')}`);
}

const migrationFile = driver === 'mysql' ? '001_init_mysql.sql' : '001_init_postgres.sql';
const migrationPath = resolve(process.cwd(), `aliyun-api/migrations/${migrationFile}`);
const sql = await readFile(migrationPath, 'utf8');
const { pool } = createAssessmentDatabaseFromEnv({ env: process.env });

try {
  if (driver === 'mysql') {
    for (const statement of splitSqlStatements(sql)) {
      await pool.query(statement);
    }
  } else {
    await pool.query(sql);
  }

  console.log(JSON.stringify({
    ok: true,
    driver,
    migration: migrationFile,
    database: process.env.ALIYUN_MYSQL_DATABASE || process.env.ALIYUN_RDS_DATABASE,
    host: process.env.ALIYUN_MYSQL_HOST || process.env.ALIYUN_RDS_HOST
  }, null, 2));
} finally {
  await pool.end();
}

export function splitSqlStatements(sql) {
  return String(sql || '')
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}
