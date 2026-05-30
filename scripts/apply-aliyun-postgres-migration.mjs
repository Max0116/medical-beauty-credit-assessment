import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const required = [
  'ALIYUN_RDS_HOST',
  'ALIYUN_RDS_DATABASE',
  'ALIYUN_RDS_USER',
  'ALIYUN_RDS_PASSWORD'
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  throw new Error(`Missing required RDS env vars: ${missing.join(', ')}`);
}

const migrationPath = resolve(process.cwd(), 'aliyun-api/migrations/001_init_postgres.sql');
const sql = await readFile(migrationPath, 'utf8');
const pool = new pg.Pool({
  host: process.env.ALIYUN_RDS_HOST,
  port: Number(process.env.ALIYUN_RDS_PORT || 5432),
  database: process.env.ALIYUN_RDS_DATABASE,
  user: process.env.ALIYUN_RDS_USER,
  password: process.env.ALIYUN_RDS_PASSWORD,
  ssl: parseBoolean(process.env.ALIYUN_RDS_SSL) ? { rejectUnauthorized: false } : undefined,
  max: 1
});

try {
  await pool.query(sql);
  console.log(JSON.stringify({
    ok: true,
    migration: '001_init_postgres.sql',
    database: process.env.ALIYUN_RDS_DATABASE,
    host: process.env.ALIYUN_RDS_HOST
  }, null, 2));
} finally {
  await pool.end();
}

function parseBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}
