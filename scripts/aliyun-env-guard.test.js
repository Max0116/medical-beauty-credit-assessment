import { describe, expect, it, vi } from 'vitest';
import {
  evaluateAliyunEnv,
  parseEnvContent,
  renderEnvTemplate,
  runAliyunEnvGuard
} from './aliyun-env-guard.mjs';

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

describe('Aliyun env guard', () => {
  it('parses dotenv-style values without exposing secrets', () => {
    const env = parseEnvContent("export A='one two'\nB=plain\n# comment");

    expect(env).toEqual({ A: 'one two', B: 'plain' });
  });

  it('allows a complete dual_write Postgres server env in the approved API root', () => {
    const gate = evaluateAliyunEnv(validDualWritePostgres, {
      envFile: '/www/wwwroot/medical-credit-api/.env',
      expectedMode: 'dual_write'
    });

    expect(gate).toMatchObject({
      ok: true,
      decision: 'go',
      blockers: [],
      warnings: []
    });
    expect(JSON.stringify(gate)).not.toContain('secret-rds-password');
  });

  it('blocks missing required keys and placeholder values', () => {
    const gate = evaluateAliyunEnv(`
NODE_ENV=production
MEDICAL_CREDIT_RUNTIME=docker
MEDICAL_CREDIT_PROXY_HOST=127.0.0.1
MEDICAL_CREDIT_PROXY_PORT=8787
MEDICAL_CREDIT_ALLOWED_ORIGINS=https://credit.example.com
MEDICAL_CREDIT_BACKEND_MODE=aliyun
ALIYUN_DB_DRIVER=postgres
ALIYUN_RDS_HOST=<rds-host>
`, {
      envFile: '/www/wwwroot/medical-credit-api/.env',
      expectedMode: 'aliyun'
    });

    expect(gate.ok).toBe(false);
    expect(gate.decision).toBe('blocked');
    expect(gate.blockers.join('\n')).toContain('Missing required env keys');
    expect(gate.blockers.join('\n')).toContain('Placeholder or empty env values: ALIYUN_RDS_HOST');
  });

  it('blocks env files inside the H5 root and browser-facing VITE secrets', () => {
    const gate = evaluateAliyunEnv(`${validDualWritePostgres}\nVITE_ASSESSMENT_API_KEY=leak`, {
      envFile: '/www/wwwroot/medical-credit-assessment/.env',
      h5EnvFileExists: true
    });

    expect(gate.decision).toBe('blocked');
    expect(gate.blockers).toContain('Env file must be exactly /www/wwwroot/medical-credit-api/.env, got /www/wwwroot/medical-credit-assessment/.env');
    expect(gate.blockers).toContain('Env file is inside the browser-visible H5 root.');
    expect(gate.blockers).toContain('A .env file appears to exist in the H5 root; secrets must only live in the API directory.');
    expect(gate.blockers).toContain('Browser-facing VITE secret keys must not be in server .env: VITE_ASSESSMENT_API_KEY');
  });

  it('renders a mode-specific template without real secrets', () => {
    const template = renderEnvTemplate({
      mode: 'aliyun',
      driver: 'mysql',
      allowedOrigin: 'https://credit.example.com'
    });

    expect(template).toContain('MEDICAL_CREDIT_BACKEND_MODE=aliyun');
    expect(template).toContain('ALIYUN_DB_DRIVER=mysql');
    expect(template).toContain('ALIYUN_MYSQL_HOST=<rds-mysql-host>');
    expect(template).toContain('ZHIPUAI_API_KEY=<zhipu-api-key>');
    expect(template).not.toContain('secret-rds-password');
  });

  it('writes optional template and guard outputs', async () => {
    const writes = new Map();
    const writeFileImpl = vi.fn(async (filePath, content) => {
      writes.set(filePath, content);
    });

    const gate = await runAliyunEnvGuard({
      envFile: '/www/wwwroot/medical-credit-api/.env',
      outputFile: '/tmp/env-gate.json',
      markdownOutputFile: '/tmp/env-gate.md',
      templateOutputFile: '/tmp/env.template',
      readFileImpl: async () => validDualWritePostgres,
      writeFileImpl,
      options: { expectedMode: 'dual_write' }
    });

    expect(gate.decision).toBe('go');
    expect(writes.get('/tmp/env.template')).toContain('Generated server-side .env template');
    expect(writes.get('/tmp/env-gate.json')).toContain('"decision": "go"');
    expect(writes.get('/tmp/env-gate.md')).toContain('PR23 服务端环境变量闸门');
  });
});
