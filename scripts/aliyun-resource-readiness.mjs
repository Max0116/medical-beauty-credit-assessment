import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  evaluateAliyunEnv,
  parseEnvContent
} from './aliyun-env-guard.mjs';

const POSTGRES_KEYS = ['ALIYUN_RDS_HOST', 'ALIYUN_RDS_PORT', 'ALIYUN_RDS_DATABASE', 'ALIYUN_RDS_USER', 'ALIYUN_RDS_PASSWORD'];
const MYSQL_KEYS = ['ALIYUN_MYSQL_HOST', 'ALIYUN_MYSQL_PORT', 'ALIYUN_MYSQL_DATABASE', 'ALIYUN_MYSQL_USER', 'ALIYUN_MYSQL_PASSWORD'];
const OSS_KEYS = ['ALIYUN_OSS_REGION', 'ALIYUN_OSS_BUCKET', 'ALIYUN_OSS_ACCESS_KEY_ID', 'ALIYUN_OSS_ACCESS_KEY_SECRET'];
const ZHIPU_KEYS = ['ZHIPUAI_API_KEY'];
const UPSTREAM_KEYS = ['ASSESSMENT_UPSTREAM_URL', 'ASSESSMENT_UPSTREAM_API_KEY'];
const MODES = new Set(['proxy', 'dual_write', 'aliyun']);
const NON_SECRET_LABELS = new Set([
  'MEDICAL_CREDIT_BACKEND_MODE',
  'MEDICAL_CREDIT_RUNTIME',
  'ALIYUN_DB_DRIVER',
  'ALIYUN_RDS_DATABASE',
  'ALIYUN_MYSQL_DATABASE',
  'ALIYUN_OSS_REGION',
  'ALIYUN_OSS_BUCKET'
]);

export function evaluateAliyunResourceReadiness(content = '', {
  envFile = '',
  apiRoot = '/www/wwwroot/medical-credit-api',
  h5Root = '/www/wwwroot/medical-credit-assessment',
  expectedMode = '',
  expectedDriver = '',
  h5EnvFileExists = false,
  generatedAt = new Date().toISOString(),
  liveResults = {}
} = {}) {
  const env = parseEnvContent(content);
  const envGate = evaluateAliyunEnv(content, {
    envFile,
    apiRoot,
    h5Root,
    expectedMode,
    expectedDriver,
    h5EnvFileExists,
    generatedAt
  });
  const mode = envGate.mode;
  const driver = normalizeDriver(envGate.driver);
  const blockers = [...envGate.blockers];
  const warnings = [...envGate.warnings];
  const components = {
    env: summarizeEnvGate(envGate),
    database: buildDatabaseComponent(env, { mode, driver }),
    storage: buildKeyedComponent(env, {
      id: 'storage',
      label: '阿里云 OSS 附件存储',
      provider: 'aliyun-oss',
      required: mode === 'dual_write' || mode === 'aliyun',
      requiredKeys: OSS_KEYS,
      safeFields: {
        region: env.ALIYUN_OSS_REGION || '',
        bucket: env.ALIYUN_OSS_BUCKET || ''
      },
      skippedReason: 'proxy 模式仍通过 Supabase 上游处理附件，OSS 只作为 PR23 切换资源。'
    }),
    verification: buildKeyedComponent(env, {
      id: 'verification',
      label: '智谱联网核验',
      provider: 'zhipu-web-search',
      required: mode === 'dual_write' || mode === 'aliyun',
      requiredKeys: ZHIPU_KEYS,
      skippedReason: 'proxy 模式仍通过 Supabase 上游触发核验，本地 API 暂不直接调用智谱。'
    }),
    upstreamFallback: buildKeyedComponent(env, {
      id: 'upstreamFallback',
      label: 'Supabase 回滚上游',
      provider: 'supabase-edge-function',
      required: mode === 'proxy' || mode === 'dual_write',
      requiredKeys: UPSTREAM_KEYS,
      skippedReason: 'aliyun 模式不再依赖 Supabase 上游；回滚前请确认旧链路仍可临时恢复。'
    })
  };

  for (const component of Object.values(components)) {
    for (const blocker of component.blockers || []) blockers.push(blocker);
    for (const warning of component.warnings || []) warnings.push(warning);
  }

  if (mode === 'proxy') {
    warnings.push('当前仍是 proxy 模式，只能证明 Supabase 回滚链路可用，不能证明 RDS / OSS 国内数据闭环已就绪。');
  }
  if (mode === 'dual_write') {
    warnings.push('dual_write 是灰度阶段；切 aliyun 前必须完成 API flow smoke、历史记录、附件签名链接和人工核验闭环验收。');
  }
  if (!MODES.has(mode)) {
    blockers.push(`Unsupported backend mode: ${mode}`);
  }

  applyLiveResults(components, liveResults, { blockers, warnings });

  const decision = blockers.length ? 'blocked' : warnings.length ? 'manual_review' : 'go';
  return {
    type: 'aliyun_resource_readiness',
    generatedAt,
    ok: decision === 'go',
    decision,
    mode,
    driver,
    envFile: envGate.envFile,
    apiRoot: envGate.apiRoot,
    h5Root: envGate.h5Root,
    components,
    blockers: unique(blockers),
    warnings: unique(warnings),
    nextActions: buildResourceNextActions(decision, mode),
    redaction: {
      secretsPrinted: false,
      note: 'This report only lists key names and non-secret resource labels; passwords, AccessKeys and API keys are never echoed.'
    }
  };
}

export async function runAliyunResourceReadiness({
  envFile,
  outputFile,
  markdownOutputFile,
  live = false,
  readFileImpl = readFile,
  writeFileImpl = writeFile,
  liveCheckers = {},
  options = {}
} = {}) {
  if (!envFile) throw new Error('ALIYUN_RESOURCE_ENV_FILE or ALIYUN_ENV_FILE is required.');
  const content = await readFileImpl(envFile, 'utf8');
  const env = parseEnvContent(content);
  const liveResults = live ? await runLiveChecks(env, liveCheckers) : {};
  const report = evaluateAliyunResourceReadiness(content, {
    ...options,
    envFile,
    liveResults
  });

  if (outputFile) {
    await writeFileImpl(outputFile, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (markdownOutputFile) {
    await writeFileImpl(markdownOutputFile, renderAliyunResourceReadinessMarkdown(report));
  }
  return report;
}

export function renderAliyunResourceReadinessMarkdown(report) {
  const decisionLabel = {
    go: '可以进入下一步',
    manual_review: '需要人工复核',
    blocked: '暂停切换'
  }[report.decision] || report.decision;
  const rows = Object.values(report.components).map((component) => {
    const status = component.ok ? '通过' : component.required === false ? '跳过' : '未通过';
    return `| ${component.label} | ${status} | ${component.provider || '-'} | ${component.summary || '-'} |`;
  });

  return [
    '# PR23 阿里云资源就绪检查',
    '',
    `判断：${decisionLabel}`,
    `生成时间：${report.generatedAt}`,
    `运行模式：${report.mode}`,
    `数据库驱动：${report.driver}`,
    `环境文件：${report.envFile || '未提供'}`,
    '',
    '| 资源 | 状态 | 提供方 | 摘要 |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    '## 阻断项',
    '',
    ...formatList(report.blockers, '无阻断项。'),
    '',
    '## 需复核项',
    '',
    ...formatList(report.warnings, '无需要人工复核项。'),
    '',
    '## 下一步',
    '',
    ...formatList(report.nextActions, '继续执行 health 与 smoke。'),
    '',
    '## 脱敏说明',
    '',
    `- ${report.redaction.note}`,
    ''
  ].join('\n');
}

async function runLiveChecks(env, liveCheckers) {
  const results = {};
  for (const key of ['database', 'storage', 'verification', 'upstreamFallback']) {
    if (typeof liveCheckers[key] !== 'function') continue;
    try {
      results[key] = await liveCheckers[key](env);
    } catch (error) {
      results[key] = {
        ok: false,
        errorMessage: error?.message || String(error)
      };
    }
  }
  return results;
}

function summarizeEnvGate(envGate) {
  return {
    id: 'env',
    label: '服务端环境变量',
    provider: 'server-env',
    required: true,
    ok: envGate.decision !== 'blocked',
    configured: envGate.configuredKeys.length,
    missing: envGate.missingKeys,
    placeholders: envGate.placeholderKeys,
    blockers: [],
    warnings: [],
    summary: `${envGate.configuredKeys.length}/${envGate.requiredKeys.length} required keys configured`
  };
}

function buildDatabaseComponent(env, { mode, driver }) {
  if (mode === 'proxy') {
    return skippedComponent({
      id: 'database',
      label: '阿里云 RDS / MySQL 数据库',
      provider: 'aliyun-rds',
      summary: 'proxy 模式跳过本地数据库写入',
      reason: 'proxy 模式仍通过 Supabase 上游保存数据，数据库只作为 PR23 切换资源。'
    });
  }
  const requiredKeys = driver === 'mysql' || driver === 'mariadb' ? MYSQL_KEYS : POSTGRES_KEYS;
  const databaseName = driver === 'mysql' || driver === 'mariadb'
    ? env.ALIYUN_MYSQL_DATABASE
    : env.ALIYUN_RDS_DATABASE;
  const component = buildKeyedComponent(env, {
    id: 'database',
    label: '阿里云 RDS / MySQL 数据库',
    provider: driver === 'mysql' || driver === 'mariadb' ? 'aliyun-mysql' : 'aliyun-postgres',
    required: true,
    requiredKeys,
    safeFields: {
      driver,
      database: databaseName || ''
    }
  });
  if (['gohomesh', 'mediverseai', 'maxfuture'].includes(String(databaseName || '').trim())) {
    component.ok = false;
    component.blockers.push(`Database must be a dedicated medical-credit database, not existing business database: ${databaseName}`);
    component.summary = '独立数据库未通过';
  }
  return component;
}

function buildKeyedComponent(env, {
  id,
  label,
  provider,
  required,
  requiredKeys,
  safeFields = {},
  skippedReason = ''
}) {
  if (!required) {
    return skippedComponent({
      id,
      label,
      provider,
      summary: '当前模式不要求',
      reason: skippedReason
    });
  }
  const missing = requiredKeys.filter((key) => env[key] === undefined);
  const placeholders = requiredKeys.filter((key) => env[key] !== undefined && isPlaceholderValue(env[key]));
  const blockers = [];
  if (missing.length) blockers.push(`${label} missing required keys: ${missing.join(', ')}`);
  if (placeholders.length) blockers.push(`${label} has placeholder or empty values: ${placeholders.join(', ')}`);
  const configuredKeys = requiredKeys.filter((key) => env[key] !== undefined && !isPlaceholderValue(env[key]));
  return {
    id,
    label,
    provider,
    required: true,
    ok: blockers.length === 0,
    configuredKeys,
    missingKeys: missing,
    placeholderKeys: placeholders,
    safeFields: filterSafeFields(safeFields),
    blockers,
    warnings: [],
    summary: blockers.length === 0 ? `${configuredKeys.length}/${requiredKeys.length} required keys configured` : '配置不完整'
  };
}

function skippedComponent({ id, label, provider, summary, reason }) {
  return {
    id,
    label,
    provider,
    required: false,
    ok: true,
    configuredKeys: [],
    missingKeys: [],
    placeholderKeys: [],
    safeFields: {},
    blockers: [],
    warnings: [],
    skippedReason: reason || '',
    summary
  };
}

function applyLiveResults(components, liveResults, { blockers, warnings }) {
  for (const [key, live] of Object.entries(liveResults || {})) {
    if (!components[key] || !live) continue;
    components[key].live = summarizeLiveResult(live);
    if (live.ok === false) {
      components[key].ok = false;
      blockers.push(`${components[key].label} live check failed: ${live.errorMessage || live.reason || 'unknown error'}`);
    } else if (live.ok === true) {
      components[key].summary = `${components[key].summary}; live check passed`;
    } else {
      warnings.push(`${components[key].label} live check returned an indeterminate result.`);
    }
  }
}

function summarizeLiveResult(live) {
  return {
    ok: Boolean(live.ok),
    provider: live.provider,
    status: live.status,
    reason: live.reason,
    errorMessage: live.errorMessage
  };
}

function buildResourceNextActions(decision, mode) {
  if (decision === 'blocked') {
    return [
      '暂停切换或重启 API，先补齐阻断项。',
      '确认数据库使用独立 medical-credit 库，OSS 使用私有 bucket，密钥只放 API `.env`。',
      '重新执行 `npm run env:aliyun:guard` 和 `npm run resources:aliyun:check`。'
    ];
  }
  if (decision === 'manual_review') {
    const actions = [
      '由 IT/负责人复核 warning，确认不会影响现有业务项目。',
      '启动或重启本项目独立 API 后执行 `npm run health:aliyun`。',
      '继续执行 `npm run smoke:aliyun:api-flow` 验证保存、核验日志、历史记录和附件链路。'
    ];
    if (mode === 'dual_write') {
      actions.push('dual_write 验收通过后再计划切换 `MEDICAL_CREDIT_BACKEND_MODE=aliyun`。');
    }
    return actions;
  }
  return [
    '可以继续执行 preflight、health 和 api-flow smoke。',
    '完成 RDS / OSS 迁移与附件签名链接验证后，再切换到 aliyun 模式。',
    '保留 proxy 回滚链路直到 PR24 去 Supabase 验收完成。'
  ];
}

function filterSafeFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([key, value]) => NON_SECRET_LABELS.has(key) || value)
      .map(([key, value]) => [key, value ? String(value) : ''])
  );
}

function normalizeDriver(driver = '') {
  const normalized = String(driver || 'postgres').trim().toLowerCase();
  return normalized === 'postgresql' ? 'postgres' : normalized;
}

function isPlaceholderValue(value) {
  const text = String(value ?? '').trim();
  return !text || /<[^>]+>/.test(text) || /xxx/i.test(text) || ['***', 'changeme', 'replace-me'].includes(text);
}

function unique(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function formatList(items = [], emptyText) {
  if (!items.length) return [`- ${emptyText}`];
  return items.map((item) => `- ${item}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const report = await runAliyunResourceReadiness({
    envFile: process.env.ALIYUN_RESOURCE_ENV_FILE || process.env.ALIYUN_ENV_FILE || process.argv[2],
    outputFile: process.env.ALIYUN_RESOURCE_OUTPUT_FILE,
    markdownOutputFile: process.env.ALIYUN_RESOURCE_MARKDOWN_FILE,
    live: process.env.ALIYUN_RESOURCE_CHECK_LIVE === 'yes',
    options: {
      apiRoot: process.env.API_ROOT,
      h5Root: process.env.H5_ROOT,
      expectedMode: process.env.ALIYUN_RESOURCE_EXPECT_MODE || process.env.ALIYUN_ENV_EXPECT_MODE,
      expectedDriver: process.env.ALIYUN_RESOURCE_EXPECT_DRIVER || process.env.ALIYUN_ENV_EXPECT_DRIVER,
      h5EnvFileExists: process.env.ALIYUN_ENV_H5_ENV_EXISTS === 'yes'
    }
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.decision === 'blocked') process.exit(1);
}
