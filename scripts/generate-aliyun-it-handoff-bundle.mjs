import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderEnvTemplate } from './aliyun-env-guard.mjs';
import { renderMysqlBootstrapSql } from './generate-aliyun-mysql-bootstrap.mjs';
import { buildOssRamPolicy, renderOssSetupMarkdown } from './generate-aliyun-oss-policy.mjs';
import { renderNginxVhost, validateVhostOptions } from './generate-aliyun-nginx-vhost.mjs';

const DEFAULT_OUTPUT_ROOT = 'release/handoff';
const DEFAULT_DOMAIN = 'credit.example.com';
const DEFAULT_DRIVER = 'mysql';
const DEFAULT_H5_ROOT = '/www/wwwroot/medical-credit-assessment/current';
const DEFAULT_API_ROOT = '/www/wwwroot/medical-credit-api/current';
const DEFAULT_API_UPSTREAM = 'http://127.0.0.1:8787/api/';
const DEFAULT_BUCKET = 'medical-credit-verification-evidence';
const DEFAULT_REGION = 'oss-cn-shanghai';
const DEFAULT_PREFIX = 'verification-evidence/';

export function buildAliyunItHandoffOptions(env = process.env, {
  now = new Date()
} = {}) {
  const timestamp = formatTimestamp(now);
  const outputRoot = env.ALIYUN_HANDOFF_OUTPUT_ROOT || DEFAULT_OUTPUT_ROOT;
  const name = env.ALIYUN_HANDOFF_NAME || `medical-credit-aliyun-handoff-${timestamp}`;
  return {
    outputDir: env.ALIYUN_HANDOFF_OUTPUT_DIR || join(outputRoot, name),
    name,
    generatedAt: now.toISOString(),
    domain: env.ALIYUN_HANDOFF_DOMAIN || DEFAULT_DOMAIN,
    driver: normalizeDriver(env.ALIYUN_HANDOFF_DRIVER || env.ALIYUN_DB_DRIVER || DEFAULT_DRIVER),
    allowedOrigin: env.ALIYUN_HANDOFF_ALLOWED_ORIGIN || `https://${env.ALIYUN_HANDOFF_DOMAIN || DEFAULT_DOMAIN}`,
    h5Root: env.ALIYUN_HANDOFF_H5_ROOT || DEFAULT_H5_ROOT,
    apiRoot: env.ALIYUN_HANDOFF_API_ROOT || DEFAULT_API_ROOT,
    apiUpstream: env.ALIYUN_HANDOFF_API_UPSTREAM || DEFAULT_API_UPSTREAM,
    sslCertificate: env.ALIYUN_HANDOFF_SSL_CERTIFICATE || `/www/server/panel/vhost/cert/${env.ALIYUN_HANDOFF_DOMAIN || DEFAULT_DOMAIN}/fullchain.pem`,
    sslCertificateKey: env.ALIYUN_HANDOFF_SSL_CERTIFICATE_KEY || `/www/server/panel/vhost/cert/${env.ALIYUN_HANDOFF_DOMAIN || DEFAULT_DOMAIN}/privkey.pem`,
    mysqlDatabase: env.ALIYUN_HANDOFF_MYSQL_DATABASE || env.ALIYUN_MYSQL_DATABASE || 'medical_credit_assessment',
    mysqlUser: env.ALIYUN_HANDOFF_MYSQL_USER || env.ALIYUN_MYSQL_USER || 'medical_credit_app',
    mysqlUserHost: env.ALIYUN_HANDOFF_MYSQL_USER_HOST || '<reviewed-mysql-user-host>',
    bucket: env.ALIYUN_HANDOFF_OSS_BUCKET || env.ALIYUN_OSS_BUCKET || DEFAULT_BUCKET,
    region: env.ALIYUN_HANDOFF_OSS_REGION || env.ALIYUN_OSS_REGION || DEFAULT_REGION,
    prefix: env.ALIYUN_HANDOFF_OSS_PREFIX || DEFAULT_PREFIX
  };
}

export function buildAliyunItHandoffFiles(options = {}) {
  const opts = {
    outputDir: '',
    name: 'medical-credit-aliyun-handoff',
    generatedAt: new Date().toISOString(),
    domain: DEFAULT_DOMAIN,
    driver: DEFAULT_DRIVER,
    allowedOrigin: `https://${DEFAULT_DOMAIN}`,
    h5Root: DEFAULT_H5_ROOT,
    apiRoot: DEFAULT_API_ROOT,
    apiUpstream: DEFAULT_API_UPSTREAM,
    sslCertificate: `/www/server/panel/vhost/cert/${DEFAULT_DOMAIN}/fullchain.pem`,
    sslCertificateKey: `/www/server/panel/vhost/cert/${DEFAULT_DOMAIN}/privkey.pem`,
    mysqlDatabase: 'medical_credit_assessment',
    mysqlUser: 'medical_credit_app',
    mysqlUserHost: '<reviewed-mysql-user-host>',
    bucket: DEFAULT_BUCKET,
    region: DEFAULT_REGION,
    prefix: DEFAULT_PREFIX,
    ...options
  };

  const blockers = [];
  const warnings = [];
  if (opts.domain === DEFAULT_DOMAIN) {
    warnings.push('Domain is still the placeholder credit.example.com; replace it with a备案 HTTPS domain before deployment.');
  }
  if (isBareIp(opts.domain)) {
    blockers.push('Bare IP handoff domain is not allowed. Ask IT for an independent备案子域名, for example credit.xxx.com.');
  }
  if (!['mysql', 'postgres'].includes(opts.driver)) {
    blockers.push(`Unsupported handoff database driver: ${opts.driver}. Use mysql or postgres.`);
  }

  const nginxValidation = validateVhostOptions({
    serverName: opts.domain,
    h5Root: opts.h5Root,
    apiUpstream: opts.apiUpstream,
    mode: 'https',
    sslCertificate: opts.sslCertificate,
    sslCertificateKey: opts.sslCertificateKey
  });
  if (!nginxValidation.ok) blockers.push(...nginxValidation.errors);

  const envTemplate = renderEnvTemplate({
    mode: 'dual_write',
    driver: opts.driver,
    allowedOrigin: opts.allowedOrigin,
    runtime: 'docker'
  });
  const mysqlSql = renderMysqlBootstrapSql({
    database: opts.mysqlDatabase,
    user: opts.mysqlUser,
    userHost: opts.mysqlUserHost,
    password: '<strong-password-from-it>',
    generatedAt: opts.generatedAt
  });
  const ossPolicy = buildOssRamPolicy({
    bucket: opts.bucket,
    prefix: opts.prefix
  });
  const ossMarkdown = renderOssSetupMarkdown({
    bucket: opts.bucket,
    region: opts.region,
    prefix: opts.prefix,
    generatedAt: opts.generatedAt
  });
  const nginxVhost = blockers.length
    ? ''
    : renderNginxVhost({
      serverName: opts.domain,
      h5Root: opts.h5Root,
      apiUpstream: opts.apiUpstream,
      mode: 'https',
      sslCertificate: opts.sslCertificate,
      sslCertificateKey: opts.sslCertificateKey
    });
  const commands = renderCommandsMarkdown(opts);
  const readme = renderReadmeMarkdown(opts, { blockers, warnings });
  const manifest = {
    type: 'aliyun_it_handoff_bundle',
    name: opts.name,
    generatedAt: opts.generatedAt,
    decision: blockers.length ? 'blocked' : warnings.length ? 'manual_review' : 'go',
    blockers,
    warnings,
    files: [
      'README.md',
      'api.env.template',
      'mysql-bootstrap.template.sql',
      'oss-ram-policy.json',
      'oss-setup.md',
      'nginx-medical-credit.conf',
      'commands.md',
      'manifest.json'
    ],
    domain: opts.domain,
    driver: opts.driver,
    h5Root: opts.h5Root,
    apiRoot: opts.apiRoot,
    apiUpstream: opts.apiUpstream,
    mysqlDatabase: opts.mysqlDatabase,
    mysqlUser: opts.mysqlUser,
    ossBucket: opts.bucket,
    ossRegion: opts.region,
    ossPrefix: opts.prefix
  };

  return {
    manifest,
    files: {
      'README.md': readme,
      'api.env.template': envTemplate,
      'mysql-bootstrap.template.sql': mysqlSql,
      'oss-ram-policy.json': `${JSON.stringify(ossPolicy, null, 2)}\n`,
      'oss-setup.md': ossMarkdown,
      'nginx-medical-credit.conf': nginxVhost,
      'commands.md': commands,
      'manifest.json': `${JSON.stringify(manifest, null, 2)}\n`
    }
  };
}

export async function runAliyunItHandoffBundleGenerator({
  options = buildAliyunItHandoffOptions(),
  writeFileImpl = writeFile,
  mkdirImpl = mkdir
} = {}) {
  const bundle = buildAliyunItHandoffFiles(options);
  await mkdirImpl(options.outputDir, { recursive: true });
  for (const [fileName, content] of Object.entries(bundle.files)) {
    await writeFileImpl(join(options.outputDir, fileName), content, { mode: fileName.endsWith('.template') || fileName.endsWith('.sql') ? 0o600 : 0o644 });
  }
  return {
    outputDir: options.outputDir,
    manifest: bundle.manifest
  };
}

function renderReadmeMarkdown(opts, { blockers = [], warnings = [] } = {}) {
  return [
    '# medical-credit-assessment 阿里云 IT 交接包',
    '',
    `生成时间：${opts.generatedAt}`,
    `建议域名：${opts.domain}`,
    `数据库路线：${opts.driver}`,
    `H5 根目录：${opts.h5Root}`,
    `API 根目录：${opts.apiRoot}`,
    `API upstream：${opts.apiUpstream}`,
    '',
    '## 使用边界',
    '',
    '- 本目录只包含模板和待复核配置，不包含真实密钥。',
    '- 不要把 `api.env.template` 放入 H5 静态目录。',
    '- 不要复用 `gohomesh`、`mediverseai`、`maxfuture` 等既有业务库。',
    '- Nginx 配置必须由 IT 复核后再放入独立 vhost 文件。',
    '- 所有真实密钥只允许写入服务器 API `.env`。',
    '',
    '## 文件说明',
    '',
    '- `api.env.template`：API 服务端 `.env` 模板。',
    '- `mysql-bootstrap.template.sql`：独立 MySQL 库和账号创建 SQL 模板。',
    '- `oss-ram-policy.json`：OSS 最小权限 RAM Policy。',
    '- `oss-setup.md`：OSS 控制台操作说明。',
    '- `nginx-medical-credit.conf`：独立 HTTPS vhost 草案。',
    '- `commands.md`：上线前命令顺序。',
    '- `manifest.json`：本交接包元数据。',
    '',
    '## 阻断项',
    '',
    ...formatList(blockers, '无。'),
    '',
    '## 人工复核项',
    '',
    ...formatList(warnings, '无。'),
    ''
  ].join('\n');
}

function renderCommandsMarkdown(opts) {
  return [
    '# PR23 阿里云执行命令顺序',
    '',
    '以下命令需要在服务器的独立 API release/current 目录中执行。不要在已有业务项目目录中执行。',
    '',
    '## 1. 创建 API `.env`',
    '',
    '```bash',
    `install -m 600 api.env.template ${opts.apiRoot.replace(/\/current$/, '')}/.env`,
    'vi /www/wwwroot/medical-credit-api/.env',
    '```',
    '',
    '## 2. 运行环境闸门',
    '',
    '```bash',
    `ALIYUN_ENV_FILE=${opts.apiRoot.replace(/\/current$/, '')}/.env \\`,
    'ALIYUN_ENV_EXPECT_MODE=dual_write \\',
    'npm run env:aliyun:guard',
    '',
    `ALIYUN_RESOURCE_ENV_FILE=${opts.apiRoot.replace(/\/current$/, '')}/.env \\`,
    'ALIYUN_RESOURCE_EXPECT_MODE=dual_write \\',
    'npm run resources:aliyun:check',
    '```',
    '',
    '## 3. 创建独立 MySQL 库或接入 RDS',
    '',
    '```bash',
    '# 由 IT 复核 mysql-bootstrap.template.sql 后执行。',
    '# 禁止复用 gohomesh / mediverseai / maxfuture。',
    '```',
    '',
    '## 4. 创建 OSS bucket 和 RAM Policy',
    '',
    '```bash',
    '# 在阿里云控制台创建私有 bucket，并绑定 oss-ram-policy.json。',
    '# AccessKey 只写入 API .env。',
    '```',
    '',
    '## 5. 独立 API 容器',
    '',
    '```bash',
    `API_ROOT=${opts.apiRoot.replace(/\/current$/, '')} bash ops/aliyun/docker-run-medical-credit-api.sh.example`,
    '```',
    '',
    '## 6. 独立 Nginx vhost',
    '',
    '```bash',
    '# IT 复核 nginx-medical-credit.conf 后，放入独立 vhost 文件。',
    'nginx -t',
    '# 只有 nginx -t 通过且未影响现有站点时，才 reload。',
    '```',
    '',
    '## 7. 总闸门',
    '',
    '```bash',
    'ALIYUN_CUTOVER_PHASE=dual_write \\',
    'ALIYUN_CUTOVER_INVENTORY_GATE_FILE=/tmp/medical-credit-inventory-gate.json \\',
    'ALIYUN_CUTOVER_NGINX_GATE_FILE=/tmp/medical-credit-nginx-gate.json \\',
    'ALIYUN_CUTOVER_ENV_GATE_FILE=/tmp/medical-credit-env-gate.json \\',
    'ALIYUN_CUTOVER_RESOURCE_FILE=/tmp/medical-credit-resource-readiness.json \\',
    'ALIYUN_CUTOVER_HEALTH_FILE=/tmp/medical-credit-health.json \\',
    'ALIYUN_CUTOVER_API_FLOW_FILE=/tmp/medical-credit-api-flow.json \\',
    'npm run cutover:aliyun:gate',
    '```',
    ''
  ].join('\n');
}

function normalizeDriver(value) {
  const driver = String(value || '').trim().toLowerCase();
  return driver === 'postgresql' ? 'postgres' : driver || DEFAULT_DRIVER;
}

function formatTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function formatList(items = [], fallback = '无。') {
  return items.length ? items.map((item) => `- ${item}`) : [`- ${fallback}`];
}

function isBareIp(value = '') {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(String(value).trim());
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const options = buildAliyunItHandoffOptions(process.env);
  const result = await runAliyunItHandoffBundleGenerator({ options });
  console.log(JSON.stringify({
    outputDir: result.outputDir,
    decision: result.manifest.decision,
    blockers: result.manifest.blockers,
    warnings: result.manifest.warnings,
    secretPrinted: false
  }, null, 2));
  if (result.manifest.decision === 'blocked') process.exit(1);
}
