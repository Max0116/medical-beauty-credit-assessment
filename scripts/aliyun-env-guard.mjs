import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const APPROVED_API_ROOTS = new Set(['/www/wwwroot/medical-credit-api', '/var/www/medical-credit-api']);
const APPROVED_H5_ROOTS = new Set(['/www/wwwroot/medical-credit-assessment', '/var/www/medical-credit']);
const COMMON_REQUIRED = [
  'NODE_ENV',
  'MEDICAL_CREDIT_RUNTIME',
  'MEDICAL_CREDIT_PROXY_HOST',
  'MEDICAL_CREDIT_PROXY_PORT',
  'MEDICAL_CREDIT_ALLOWED_ORIGINS',
  'MEDICAL_CREDIT_BACKEND_MODE'
];
const UPSTREAM_REQUIRED = ['ASSESSMENT_UPSTREAM_URL', 'ASSESSMENT_UPSTREAM_API_KEY'];
const OSS_REQUIRED = ['ALIYUN_OSS_REGION', 'ALIYUN_OSS_BUCKET', 'ALIYUN_OSS_ACCESS_KEY_ID', 'ALIYUN_OSS_ACCESS_KEY_SECRET'];
const VERIFICATION_REQUIRED = ['ZHIPUAI_API_KEY'];
const POSTGRES_REQUIRED = ['ALIYUN_RDS_HOST', 'ALIYUN_RDS_PORT', 'ALIYUN_RDS_DATABASE', 'ALIYUN_RDS_USER', 'ALIYUN_RDS_PASSWORD'];
const MYSQL_REQUIRED = ['ALIYUN_MYSQL_HOST', 'ALIYUN_MYSQL_PORT', 'ALIYUN_MYSQL_DATABASE', 'ALIYUN_MYSQL_USER', 'ALIYUN_MYSQL_PASSWORD'];
const FRONTEND_SECRET_PATTERNS = [/^VITE_.*(?:KEY|SECRET|TOKEN|PASSWORD)/i, /^VITE_(?:SUPABASE|ALIYUN|ZHIPU|ASSESSMENT_API_KEY)/i];

export function parseEnvContent(content = '') {
  const entries = {};
  for (const rawLine of String(content).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const normalized = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const index = normalized.indexOf('=');
    if (index <= 0) continue;
    const key = normalized.slice(0, index).trim();
    const value = stripQuotes(normalized.slice(index + 1).trim());
    entries[key] = value;
  }
  return entries;
}

export function evaluateAliyunEnv(content = '', {
  envFile = '',
  apiRoot = '/www/wwwroot/medical-credit-api',
  h5Root = '/www/wwwroot/medical-credit-assessment',
  expectedMode = '',
  expectedDriver = '',
  h5EnvFileExists = false,
  generatedAt = new Date().toISOString()
} = {}) {
  const env = parseEnvContent(content);
  const blockers = [];
  const warnings = [];
  const normalizedApiRoot = trimTrailingSlash(apiRoot);
  const normalizedH5Root = trimTrailingSlash(h5Root);
  const normalizedEnvFile = envFile ? trimTrailingSlash(envFile) : '';

  if (!APPROVED_API_ROOTS.has(normalizedApiRoot)) {
    blockers.push(`API_ROOT is not an approved medical-credit API directory: ${normalizedApiRoot}`);
  }
  if (!APPROVED_H5_ROOTS.has(normalizedH5Root)) {
    blockers.push(`H5_ROOT is not an approved medical-credit H5 directory: ${normalizedH5Root}`);
  }
  if (normalizedEnvFile) {
    if (normalizedEnvFile !== `${normalizedApiRoot}/.env`) {
      blockers.push(`Env file must be exactly ${normalizedApiRoot}/.env, got ${normalizedEnvFile}`);
    }
    if (normalizedEnvFile.startsWith(`${normalizedH5Root}/`)) {
      blockers.push('Env file is inside the browser-visible H5 root.');
    }
  } else {
    warnings.push('Env file path was not provided; use ALIYUN_ENV_FILE=/www/wwwroot/medical-credit-api/.env.');
  }
  if (h5EnvFileExists) {
    blockers.push('A .env file appears to exist in the H5 root; secrets must only live in the API directory.');
  }

  const mode = env.MEDICAL_CREDIT_BACKEND_MODE || 'proxy';
  const driver = env.ALIYUN_DB_DRIVER || 'postgres';
  if (expectedMode && mode !== expectedMode) {
    blockers.push(`Expected MEDICAL_CREDIT_BACKEND_MODE=${expectedMode}, got ${mode}`);
  }
  if (expectedDriver && driver !== expectedDriver) {
    blockers.push(`Expected ALIYUN_DB_DRIVER=${expectedDriver}, got ${driver}`);
  }
  if (!['proxy', 'dual_write', 'aliyun'].includes(mode)) {
    blockers.push(`Unsupported MEDICAL_CREDIT_BACKEND_MODE: ${mode}`);
  }
  if (!['postgres', 'postgresql', 'mysql', 'mariadb'].includes(driver)) {
    blockers.push(`Unsupported ALIYUN_DB_DRIVER: ${driver}`);
  }
  if (!['node', 'docker'].includes(env.MEDICAL_CREDIT_RUNTIME || '')) {
    blockers.push('MEDICAL_CREDIT_RUNTIME must be node or docker.');
  }

  const required = buildRequiredKeys({ mode, driver });
  const missing = [];
  const placeholders = [];
  for (const key of required) {
    const value = env[key];
    if (value === undefined) missing.push(key);
    else if (isPlaceholderValue(value)) placeholders.push(key);
  }
  if (missing.length) blockers.push(`Missing required env keys: ${missing.join(', ')}`);
  if (placeholders.length) blockers.push(`Placeholder or empty env values: ${placeholders.join(', ')}`);

  const frontendSecretKeys = Object.keys(env).filter((key) => FRONTEND_SECRET_PATTERNS.some((pattern) => pattern.test(key)));
  if (frontendSecretKeys.length) {
    blockers.push(`Browser-facing VITE secret keys must not be in server .env: ${frontendSecretKeys.join(', ')}`);
  }

  const origins = String(env.MEDICAL_CREDIT_ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (mode !== 'proxy' && !origins.some((origin) => /^https:\/\/[^/]+/i.test(origin))) {
    warnings.push('No HTTPS production origin found in MEDICAL_CREDIT_ALLOWED_ORIGINS.');
  }
  if (origins.some((origin) => /^http:\/\/\d{1,3}(?:\.\d{1,3}){3}/.test(origin))) {
    warnings.push('Bare IP HTTP origin is present; keep it temporary and prefer a备案 HTTPS domain.');
  }

  const decision = blockers.length ? 'blocked' : warnings.length ? 'manual_review' : 'go';
  return {
    type: 'aliyun_env_guard',
    generatedAt,
    ok: decision === 'go',
    decision,
    envFile: normalizedEnvFile,
    apiRoot: normalizedApiRoot,
    h5Root: normalizedH5Root,
    mode,
    driver,
    requiredKeys: required,
    configuredKeys: required.filter((key) => env[key] !== undefined && !isPlaceholderValue(env[key])),
    missingKeys: missing,
    placeholderKeys: placeholders,
    blockers,
    warnings,
    recommendations: buildRecommendations(decision)
  };
}

export function renderEnvTemplate({
  mode = 'dual_write',
  driver = 'postgres',
  allowedOrigin = 'https://credit.xxx.com',
  runtime = 'docker'
} = {}) {
  const normalizedMode = String(mode || 'dual_write');
  const normalizedDriver = String(driver || 'postgres');
  const rows = [
    ['NODE_ENV', 'production'],
    ['MEDICAL_CREDIT_RUNTIME', runtime],
    ['MEDICAL_CREDIT_PROXY_HOST', '127.0.0.1'],
    ['MEDICAL_CREDIT_PROXY_PORT', '8787'],
    ['MEDICAL_CREDIT_PROXY_TIMEOUT_MS', '15000'],
    ['MEDICAL_CREDIT_ALLOWED_ORIGINS', allowedOrigin],
    ['MEDICAL_CREDIT_BACKEND_MODE', normalizedMode],
    ['ASSESSMENT_UPSTREAM_URL', 'https://<project-ref>.supabase.co/functions/v1/assessments'],
    ['ASSESSMENT_UPSTREAM_API_KEY', '<server-side-upstream-key>'],
    ['ALIYUN_DB_DRIVER', normalizedDriver],
    ['ALIYUN_RDS_HOST', normalizedDriver === 'postgres' ? '<rds-postgres-host>' : ''],
    ['ALIYUN_RDS_PORT', normalizedDriver === 'postgres' ? '5432' : ''],
    ['ALIYUN_RDS_DATABASE', normalizedDriver === 'postgres' ? 'medical_credit' : ''],
    ['ALIYUN_RDS_USER', normalizedDriver === 'postgres' ? 'medical_credit_app' : ''],
    ['ALIYUN_RDS_PASSWORD', normalizedDriver === 'postgres' ? '<rds-password>' : ''],
    ['ALIYUN_RDS_SSL', 'true'],
    ['ALIYUN_MYSQL_HOST', normalizedDriver === 'mysql' ? '<rds-mysql-host>' : ''],
    ['ALIYUN_MYSQL_PORT', normalizedDriver === 'mysql' ? '3306' : ''],
    ['ALIYUN_MYSQL_DATABASE', normalizedDriver === 'mysql' ? 'medical_credit_assessment' : ''],
    ['ALIYUN_MYSQL_USER', normalizedDriver === 'mysql' ? 'medical_credit_app' : ''],
    ['ALIYUN_MYSQL_PASSWORD', normalizedDriver === 'mysql' ? '<mysql-password>' : ''],
    ['ALIYUN_MYSQL_SSL', 'false'],
    ['ALIYUN_OSS_REGION', 'oss-cn-shanghai'],
    ['ALIYUN_OSS_BUCKET', 'medical-credit-verification-evidence'],
    ['ALIYUN_OSS_ACCESS_KEY_ID', '<ram-access-key-id>'],
    ['ALIYUN_OSS_ACCESS_KEY_SECRET', '<ram-access-key-secret>'],
    ['ALIYUN_OSS_SIGNED_URL_TTL_SECONDS', '1800'],
    ['ZHIPUAI_API_KEY', '<zhipu-api-key>']
  ];

  return [
    '# Generated server-side .env template for medical-credit API.',
    '# Save as /www/wwwroot/medical-credit-api/.env or /var/www/medical-credit-api/.env.',
    '# Never copy this file into the H5/static root.',
    ...rows.map(([key, value]) => `${key}=${value}`)
  ].join('\n') + '\n';
}

export function renderAliyunEnvGuardMarkdown(gate) {
  const labels = {
    go: '可以继续',
    manual_review: '需要人工复核',
    blocked: '暂停部署'
  };
  return [
    '# PR23 服务端环境变量闸门',
    '',
    `判断：${labels[gate.decision] || gate.decision}`,
    `生成时间：${gate.generatedAt}`,
    `环境文件：${gate.envFile || '未提供'}`,
    `API 目录：${gate.apiRoot}`,
    `H5 目录：${gate.h5Root}`,
    `运行模式：${gate.mode}`,
    `数据库驱动：${gate.driver}`,
    '',
    '## 阻断项',
    '',
    ...formatList(gate.blockers, '无阻断项。'),
    '',
    '## 需复核项',
    '',
    ...formatList(gate.warnings, '无需要人工复核项。'),
    '',
    '## 必填项状态',
    '',
    `- 已配置：${gate.configuredKeys.length}`,
    `- 缺失：${gate.missingKeys.length ? gate.missingKeys.join(', ') : '无'}`,
    `- 占位/空值：${gate.placeholderKeys.length ? gate.placeholderKeys.join(', ') : '无'}`,
    '',
    '## 下一步',
    '',
    ...formatList(gate.recommendations, '继续执行 preflight。'),
    ''
  ].filter((line) => line !== '').join('\n');
}

export async function runAliyunEnvGuard({
  envFile,
  outputFile,
  markdownOutputFile,
  templateOutputFile,
  templateOnly = false,
  readFileImpl = readFile,
  writeFileImpl = writeFile,
  options = {}
} = {}) {
  if (templateOnly || templateOutputFile) {
    const template = renderEnvTemplate(options);
    if (templateOutputFile) {
      await writeFileImpl(templateOutputFile, template);
    }
    if (templateOnly && !envFile) {
      return { template, outputFile: templateOutputFile || '' };
    }
  }

  if (!envFile) {
    throw new Error('ALIYUN_ENV_FILE is required unless ALIYUN_ENV_TEMPLATE_ONLY=yes.');
  }

  const content = await readFileImpl(envFile, 'utf8');
  const gate = evaluateAliyunEnv(content, {
    ...options,
    envFile
  });

  if (outputFile) {
    await writeFileImpl(outputFile, `${JSON.stringify(gate, null, 2)}\n`);
  }
  if (markdownOutputFile) {
    await writeFileImpl(markdownOutputFile, renderAliyunEnvGuardMarkdown(gate));
  }
  return gate;
}

function buildRequiredKeys({ mode, driver }) {
  const keys = [...COMMON_REQUIRED];
  if (mode === 'proxy' || mode === 'dual_write') keys.push(...UPSTREAM_REQUIRED);
  if (mode === 'dual_write' || mode === 'aliyun') {
    keys.push(...OSS_REQUIRED, ...VERIFICATION_REQUIRED);
    if (driver === 'mysql' || driver === 'mariadb') keys.push(...MYSQL_REQUIRED);
    else keys.push(...POSTGRES_REQUIRED);
  }
  return [...new Set(keys)];
}

function buildRecommendations(decision) {
  if (decision === 'blocked') {
    return [
      '暂停启动或重启 medical-credit API。',
      '补齐缺失配置，并确认 `.env` 只位于 API 根目录。',
      '重新执行 env guard 和 preflight。'
    ];
  }
  if (decision === 'manual_review') {
    return [
      '请 IT/负责人确认复核项。',
      '确认后继续执行 `bash ops/aliyun/preflight-release.sh.example`。',
      '首次灰度仍建议使用 `MEDICAL_CREDIT_BACKEND_MODE=dual_write`。'
    ];
  }
  return [
    '可以继续执行 preflight。',
    '不要把 `.env` 复制进 H5/static 目录。',
    '启动 API 后继续执行 health 与 api-flow smoke。'
  ];
}

function isPlaceholderValue(value) {
  const text = String(value ?? '').trim();
  return !text || /<[^>]+>/.test(text) || /xxx/i.test(text) || ['***', 'changeme', 'replace-me'].includes(text);
}

function stripQuotes(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function formatList(items = [], emptyText) {
  if (!items.length) return [`- ${emptyText}`];
  return items.map((item) => `- ${item}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const templateOnly = process.env.ALIYUN_ENV_TEMPLATE_ONLY === 'yes';
  const gate = await runAliyunEnvGuard({
    envFile: process.env.ALIYUN_ENV_FILE || process.argv[2],
    outputFile: process.env.ALIYUN_ENV_OUTPUT_FILE,
    markdownOutputFile: process.env.ALIYUN_ENV_MARKDOWN_FILE,
    templateOutputFile: process.env.ALIYUN_ENV_TEMPLATE_OUTPUT_FILE,
    templateOnly,
    options: {
      apiRoot: process.env.API_ROOT,
      h5Root: process.env.H5_ROOT,
      expectedMode: process.env.ALIYUN_ENV_EXPECT_MODE,
      expectedDriver: process.env.ALIYUN_ENV_EXPECT_DRIVER,
      h5EnvFileExists: process.env.ALIYUN_ENV_H5_ENV_EXISTS === 'yes',
      mode: process.env.ALIYUN_ENV_TEMPLATE_MODE,
      driver: process.env.ALIYUN_ENV_TEMPLATE_DRIVER,
      allowedOrigin: process.env.ALIYUN_ENV_TEMPLATE_ALLOWED_ORIGIN,
      runtime: process.env.ALIYUN_ENV_TEMPLATE_RUNTIME
    }
  });
  if ('template' in gate && !process.env.ALIYUN_ENV_TEMPLATE_OUTPUT_FILE) {
    process.stdout.write(gate.template);
  } else {
    console.log(JSON.stringify(gate, null, 2));
  }
  if (gate.decision === 'blocked') process.exit(1);
}
