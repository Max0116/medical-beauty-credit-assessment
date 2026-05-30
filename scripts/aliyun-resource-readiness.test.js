import { describe, expect, it, vi } from 'vitest';
import {
  evaluateAliyunResourceReadiness,
  renderAliyunResourceReadinessMarkdown,
  runAliyunResourceReadiness
} from './aliyun-resource-readiness.mjs';

const validDualWritePostgres = `
NODE_ENV=production
MEDICAL_CREDIT_RUNTIME=docker
MEDICAL_CREDIT_PROXY_HOST=127.0.0.1
MEDICAL_CREDIT_PROXY_PORT=8787
MEDICAL_CREDIT_ALLOWED_ORIGINS=https://credit.example.com
MEDICAL_CREDIT_BACKEND_MODE=dual_write
ASSESSMENT_UPSTREAM_URL=https://example.supabase.co/functions/v1/assessments
ASSESSMENT_UPSTREAM_API_KEY=server-side-key
ALIYUN_DB_DRIVER=postgres
ALIYUN_RDS_HOST=rm-example.pg.rds.aliyuncs.com
ALIYUN_RDS_PORT=5432
ALIYUN_RDS_DATABASE=medical_credit
ALIYUN_RDS_USER=medical_credit_app
ALIYUN_RDS_PASSWORD=secret-rds-password
ALIYUN_OSS_REGION=oss-cn-shanghai
ALIYUN_OSS_BUCKET=medical-credit-verification-evidence
ALIYUN_OSS_ACCESS_KEY_ID=ak-id
ALIYUN_OSS_ACCESS_KEY_SECRET=ak-secret
ZHIPUAI_API_KEY=zhipu-secret
`;

const validAliyunMysql = `
NODE_ENV=production
MEDICAL_CREDIT_RUNTIME=docker
MEDICAL_CREDIT_PROXY_HOST=127.0.0.1
MEDICAL_CREDIT_PROXY_PORT=8787
MEDICAL_CREDIT_ALLOWED_ORIGINS=https://credit.example.com
MEDICAL_CREDIT_BACKEND_MODE=aliyun
ALIYUN_DB_DRIVER=mysql
ALIYUN_MYSQL_HOST=rm-example.mysql.rds.aliyuncs.com
ALIYUN_MYSQL_PORT=3306
ALIYUN_MYSQL_DATABASE=medical_credit_assessment
ALIYUN_MYSQL_USER=medical_credit_app
ALIYUN_MYSQL_PASSWORD=mysql-secret
ALIYUN_OSS_REGION=oss-cn-shanghai
ALIYUN_OSS_BUCKET=medical-credit-verification-evidence
ALIYUN_OSS_ACCESS_KEY_ID=ak-id
ALIYUN_OSS_ACCESS_KEY_SECRET=ak-secret
ZHIPUAI_API_KEY=zhipu-secret
`;

describe('Aliyun resource readiness', () => {
  it('reports complete dual_write Postgres resources without printing secrets', () => {
    const report = evaluateAliyunResourceReadiness(validDualWritePostgres, {
      envFile: '/www/wwwroot/medical-credit-api/.env',
      expectedMode: 'dual_write'
    });

    expect(report.decision).toBe('manual_review');
    expect(report.components.database.ok).toBe(true);
    expect(report.components.storage.ok).toBe(true);
    expect(report.components.verification.ok).toBe(true);
    expect(report.components.upstreamFallback.ok).toBe(true);
    expect(JSON.stringify(report)).not.toContain('secret-rds-password');
    expect(JSON.stringify(report)).not.toContain('zhipu-secret');
    expect(JSON.stringify(report)).not.toContain('server-side-key');
  });

  it('allows complete aliyun MySQL resources as the target domestic data mode', () => {
    const report = evaluateAliyunResourceReadiness(validAliyunMysql, {
      envFile: '/www/wwwroot/medical-credit-api/.env',
      expectedMode: 'aliyun',
      expectedDriver: 'mysql'
    });

    expect(report).toMatchObject({
      ok: true,
      decision: 'go',
      mode: 'aliyun',
      driver: 'mysql'
    });
    expect(report.components.database.provider).toBe('aliyun-mysql');
    expect(report.components.upstreamFallback.required).toBe(false);
  });

  it('blocks missing OSS and Zhipu resources before cutover', () => {
    const report = evaluateAliyunResourceReadiness(`
NODE_ENV=production
MEDICAL_CREDIT_RUNTIME=docker
MEDICAL_CREDIT_PROXY_HOST=127.0.0.1
MEDICAL_CREDIT_PROXY_PORT=8787
MEDICAL_CREDIT_ALLOWED_ORIGINS=https://credit.example.com
MEDICAL_CREDIT_BACKEND_MODE=aliyun
ALIYUN_DB_DRIVER=mysql
ALIYUN_MYSQL_HOST=rm-example.mysql.rds.aliyuncs.com
ALIYUN_MYSQL_PORT=3306
ALIYUN_MYSQL_DATABASE=medical_credit_assessment
ALIYUN_MYSQL_USER=medical_credit_app
ALIYUN_MYSQL_PASSWORD=mysql-secret
`, {
      envFile: '/www/wwwroot/medical-credit-api/.env',
      expectedMode: 'aliyun'
    });

    expect(report.decision).toBe('blocked');
    expect(report.blockers.join('\n')).toContain('ALIYUN_OSS_REGION');
    expect(report.blockers.join('\n')).toContain('ZHIPUAI_API_KEY');
  });

  it('blocks accidentally reusing existing business databases', () => {
    const report = evaluateAliyunResourceReadiness(validAliyunMysql.replace(
      'ALIYUN_MYSQL_DATABASE=medical_credit_assessment',
      'ALIYUN_MYSQL_DATABASE=mediverseai'
    ), {
      envFile: '/www/wwwroot/medical-credit-api/.env',
      expectedMode: 'aliyun'
    });

    expect(report.decision).toBe('blocked');
    expect(report.blockers).toContain('Database must be a dedicated medical-credit database, not existing business database: mediverseai');
  });

  it('keeps proxy mode as manual review because it does not prove RDS or OSS readiness', () => {
    const report = evaluateAliyunResourceReadiness(`
NODE_ENV=production
MEDICAL_CREDIT_RUNTIME=docker
MEDICAL_CREDIT_PROXY_HOST=127.0.0.1
MEDICAL_CREDIT_PROXY_PORT=8787
MEDICAL_CREDIT_ALLOWED_ORIGINS=https://credit.example.com
MEDICAL_CREDIT_BACKEND_MODE=proxy
ASSESSMENT_UPSTREAM_URL=https://example.supabase.co/functions/v1/assessments
ASSESSMENT_UPSTREAM_API_KEY=server-side-key
`, {
      envFile: '/www/wwwroot/medical-credit-api/.env'
    });

    expect(report.decision).toBe('manual_review');
    expect(report.components.database.required).toBe(false);
    expect(report.components.storage.required).toBe(false);
    expect(report.warnings.join('\n')).toContain('不能证明 RDS / OSS 国内数据闭环已就绪');
  });

  it('applies injected live-check failures without exposing credentials', () => {
    const report = evaluateAliyunResourceReadiness(validAliyunMysql, {
      envFile: '/www/wwwroot/medical-credit-api/.env',
      expectedMode: 'aliyun',
      liveResults: {
        storage: {
          ok: false,
          provider: 'aliyun-oss',
          errorMessage: 'AccessDenied'
        }
      }
    });

    expect(report.decision).toBe('blocked');
    expect(report.components.storage.live).toMatchObject({ ok: false, errorMessage: 'AccessDenied' });
    expect(JSON.stringify(report)).not.toContain('mysql-secret');
  });

  it('writes JSON and Markdown reports', async () => {
    const writes = new Map();
    const writeFileImpl = vi.fn(async (filePath, content) => {
      writes.set(filePath, content);
    });

    const report = await runAliyunResourceReadiness({
      envFile: '/www/wwwroot/medical-credit-api/.env',
      outputFile: '/tmp/resources.json',
      markdownOutputFile: '/tmp/resources.md',
      readFileImpl: async () => validAliyunMysql,
      writeFileImpl,
      options: { expectedMode: 'aliyun', expectedDriver: 'mysql' }
    });

    expect(report.decision).toBe('go');
    expect(writes.get('/tmp/resources.json')).toContain('"type": "aliyun_resource_readiness"');
    expect(writes.get('/tmp/resources.md')).toContain('PR23 阿里云资源就绪检查');
    expect(writes.get('/tmp/resources.md')).not.toContain('mysql-secret');
  });

  it('renders readable Markdown for manual handoff', () => {
    const report = evaluateAliyunResourceReadiness(validDualWritePostgres, {
      envFile: '/www/wwwroot/medical-credit-api/.env'
    });
    const markdown = renderAliyunResourceReadinessMarkdown(report);

    expect(markdown).toContain('| 阿里云 RDS / MySQL 数据库 | 通过 | aliyun-postgres |');
    expect(markdown).toContain('需要人工复核');
  });
});
