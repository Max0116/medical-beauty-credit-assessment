import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const PHASES = new Set(['preflight', 'dual_write', 'aliyun']);
const REPORT_SPECS = {
  inventoryGate: { label: '服务器只读盘点闸门', env: 'ALIYUN_CUTOVER_INVENTORY_GATE_FILE' },
  nginxGate: { label: 'Nginx 入口归属闸门', env: 'ALIYUN_CUTOVER_NGINX_GATE_FILE' },
  envGate: { label: '服务端 .env 闸门', env: 'ALIYUN_CUTOVER_ENV_GATE_FILE' },
  resourceReadiness: { label: '阿里云资源就绪检查', env: 'ALIYUN_CUTOVER_RESOURCE_FILE' },
  health: { label: 'API health', env: 'ALIYUN_CUTOVER_HEALTH_FILE' },
  apiFlow: { label: 'API flow smoke', env: 'ALIYUN_CUTOVER_API_FLOW_FILE' },
  migrationVerify: { label: 'RDS / OSS 迁移校验', env: 'ALIYUN_CUTOVER_MIGRATION_VERIFY_FILE' }
};

export function evaluateAliyunCutoverReadiness({
  phase = 'dual_write',
  reports = {},
  generatedAt = new Date().toISOString(),
  requireAttachment = phase === 'aliyun',
  requireSignedUrlReachable = false,
  requireMigrationVerify = phase === 'aliyun'
} = {}) {
  const normalizedPhase = normalizePhase(phase);
  const blockers = [];
  const warnings = [];
  const components = [];
  const requiredReports = buildRequiredReports({
    phase: normalizedPhase,
    requireMigrationVerify
  });

  for (const key of requiredReports) {
    const report = reports[key];
    if (!report) {
      blockers.push(`Missing required report: ${REPORT_SPECS[key].label}`);
      components.push(component(key, 'missing', REPORT_SPECS[key].label, '缺失'));
      continue;
    }
    const result = evaluateReport(key, report, {
      phase: normalizedPhase,
      requireAttachment,
      requireSignedUrlReachable
    });
    components.push(result.component);
    blockers.push(...result.blockers);
    warnings.push(...result.warnings);
  }

  for (const key of Object.keys(reports)) {
    if (requiredReports.includes(key)) continue;
    const result = evaluateReport(key, reports[key], {
      phase: normalizedPhase,
      requireAttachment: false,
      requireSignedUrlReachable: false,
      optional: true
    });
    components.push(result.component);
    warnings.push(...result.warnings.map((item) => `Optional ${REPORT_SPECS[key]?.label || key}: ${item}`));
  }

  const decision = blockers.length ? 'blocked' : warnings.length ? 'manual_review' : 'go';
  return {
    type: 'aliyun_cutover_readiness',
    generatedAt,
    phase: normalizedPhase,
    ok: decision === 'go',
    decision,
    requiredReports,
    components,
    blockers: unique(blockers),
    warnings: unique(warnings),
    nextActions: buildNextActions(decision, normalizedPhase)
  };
}

export async function runAliyunCutoverReadiness({
  phase = 'dual_write',
  reportFiles = {},
  outputFile,
  markdownOutputFile,
  readFileImpl = readFile,
  writeFileImpl = writeFile,
  options = {}
} = {}) {
  const reports = {};
  const loadedFiles = {};
  for (const [key, filePath] of Object.entries(reportFiles)) {
    if (!filePath) continue;
    reports[key] = JSON.parse(await readFileImpl(filePath, 'utf8'));
    loadedFiles[key] = filePath;
  }

  const report = evaluateAliyunCutoverReadiness({
    phase,
    reports,
    ...options
  });
  report.loadedFiles = loadedFiles;

  if (outputFile) {
    await writeFileImpl(outputFile, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (markdownOutputFile) {
    await writeFileImpl(markdownOutputFile, renderAliyunCutoverReadinessMarkdown(report));
  }
  return report;
}

export function renderAliyunCutoverReadinessMarkdown(report) {
  const labels = {
    go: '可以继续',
    manual_review: '需要人工复核',
    blocked: '暂停切换'
  };
  return [
    '# PR23 阿里云切换总闸门',
    '',
    `阶段：${report.phase}`,
    `判断：${labels[report.decision] || report.decision}`,
    `生成时间：${report.generatedAt}`,
    '',
    '## 组件状态',
    '',
    '| 组件 | 状态 | 摘要 |',
    '| --- | --- | --- |',
    ...report.components.map((item) => `| ${item.label} | ${item.status} | ${item.summary || '-'} |`),
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
    ...formatList(report.nextActions, '继续按 PR23 runbook 执行。'),
    ''
  ].join('\n');
}

export function buildCutoverReportFilesFromEnv(env = process.env) {
  return Object.fromEntries(
    Object.entries(REPORT_SPECS).map(([key, spec]) => [key, env[spec.env] || ''])
  );
}

function evaluateReport(key, report, options) {
  if (key === 'health') return evaluateHealthReport(report);
  if (key === 'apiFlow') return evaluateApiFlowReport(report, options);
  if (key === 'migrationVerify') return evaluateMigrationReport(report);
  return evaluateGateReport(key, report, options);
}

function evaluateGateReport(key, report, { optional = false } = {}) {
  const label = REPORT_SPECS[key]?.label || key;
  const blockers = [];
  const warnings = [];
  const decision = report?.decision || (report?.ok === true ? 'go' : 'blocked');

  if (decision === 'blocked' || (!report?.decision && report?.ok === false)) {
    blockers.push(`${label} is blocked.`);
    for (const item of report?.blockers || []) blockers.push(`${label}: ${item}`);
  } else if (decision === 'manual_review') {
    for (const item of report?.warnings || []) warnings.push(`${label}: ${item}`);
    if (!report?.warnings?.length && !optional) warnings.push(`${label} requires manual review.`);
  }

  return {
    component: component(key, decision, label, summarizeGenericReport(report)),
    blockers,
    warnings
  };
}

function evaluateHealthReport(report) {
  const blockers = [];
  const warnings = [];
  if (report?.ok !== true) blockers.push('API health payload ok is not true.');
  if (report?.ready !== true) blockers.push('API health ready is not true.');
  if (!['dual_write', 'aliyun'].includes(report?.mode)) {
    warnings.push(`API health mode is ${report?.mode || 'empty'}; confirm it matches the current cutover phase.`);
  }
  const status = blockers.length ? 'blocked' : warnings.length ? 'manual_review' : 'go';
  return {
    component: component('health', status, REPORT_SPECS.health.label, `mode=${report?.mode || '-'}, ready=${String(report?.ready)}`),
    blockers,
    warnings
  };
}

function evaluateApiFlowReport(report, {
  requireAttachment = false,
  requireSignedUrlReachable = false
} = {}) {
  const blockers = [];
  const warnings = [];
  if (!report?.record?.id) blockers.push('API flow smoke did not return record.id.');
  if (report?.history?.includesSavedRecord !== true) blockers.push('API flow smoke history did not include the saved record.');
  if (Number(report?.verification?.logCount || 0) <= 0) blockers.push('API flow smoke did not observe verification logs.');
  if (requireAttachment) {
    if (!report?.attachment?.id) blockers.push('API flow smoke attachment upload is required but missing.');
    if (report?.attachment && report.attachment.hasSignedUrl !== true) blockers.push('API flow smoke attachment signed URL is missing.');
  } else if (!report?.attachment?.id) {
    warnings.push('API flow smoke did not upload an attachment; run with API_FLOW_UPLOAD_ATTACHMENT=true before final aliyun cutover.');
  }
  if (requireSignedUrlReachable && report?.attachment?.signedUrlReachable !== true) {
    blockers.push('API flow smoke signed URL reachability was required but not confirmed.');
  }
  const status = blockers.length ? 'blocked' : warnings.length ? 'manual_review' : 'go';
  return {
    component: component('apiFlow', status, REPORT_SPECS.apiFlow.label, `record=${report?.record?.id || '-'}, logs=${Number(report?.verification?.logCount || 0)}`),
    blockers,
    warnings
  };
}

function evaluateMigrationReport(report) {
  const blockers = [];
  const warnings = [];
  if (report?.ok !== true) blockers.push('Migration verification did not pass.');
  if (report?.checkOss !== true) warnings.push('Migration verification did not check OSS attachments.');
  if (report?.evidenceAttachments?.missing > 0) blockers.push(`Migration verification has missing OSS attachments: ${report.evidenceAttachments.missing}`);
  const status = blockers.length ? 'blocked' : warnings.length ? 'manual_review' : 'go';
  return {
    component: component('migrationVerify', status, REPORT_SPECS.migrationVerify.label, `tables=${report?.tables?.length || 0}, checkOss=${String(report?.checkOss)}`),
    blockers,
    warnings
  };
}

function buildRequiredReports({ phase, requireMigrationVerify }) {
  const base = ['inventoryGate', 'nginxGate', 'envGate', 'resourceReadiness'];
  if (phase === 'preflight') return base;
  const dualWrite = [...base, 'health', 'apiFlow'];
  if (phase === 'dual_write') return dualWrite;
  return requireMigrationVerify ? [...dualWrite, 'migrationVerify'] : dualWrite;
}

function normalizePhase(value) {
  const phase = String(value || 'dual_write').trim();
  if (!PHASES.has(phase)) throw new Error(`Unsupported cutover phase: ${value}`);
  return phase;
}

function component(id, status, label, summary) {
  return {
    id,
    label,
    status,
    summary
  };
}

function summarizeGenericReport(report) {
  if (!report) return 'missing';
  const bits = [];
  if (report.decision) bits.push(`decision=${report.decision}`);
  if (report.mode) bits.push(`mode=${report.mode}`);
  if (typeof report.ok === 'boolean') bits.push(`ok=${report.ok}`);
  return bits.join(', ') || 'present';
}

function buildNextActions(decision, phase) {
  if (decision === 'blocked') {
    return [
      '暂停 PR23 切换。',
      '先补齐缺失报告或处理阻断项。',
      '不要 reload Nginx、启动新 API 容器或切换 backend mode。'
    ];
  }
  if (decision === 'manual_review') {
    return [
      '由 IT/负责人复核 warning。',
      phase === 'dual_write'
        ? '补跑附件上传 smoke 后再进入 aliyun 最终切换。'
        : '确认所有 warning 有书面豁免或已处理后再继续。',
      '继续保留 proxy 回滚链路。'
    ];
  }
  if (phase === 'preflight') {
    return [
      '可以启动独立 API 并进入 dual_write smoke。',
      '启动后立即执行 health 和 api-flow smoke。'
    ];
  }
  if (phase === 'dual_write') {
    return [
      '可以继续执行数据 / 附件回填与迁移校验。',
      '迁移校验通过后再评估切换 aliyun 模式。'
    ];
  }
  return [
    '可以按 runbook 进入 aliyun 模式切换窗口。',
    '切换后立即执行 health、api-flow、附件签名链接和微信端 smoke。',
    '保留 proxy 回滚链路直到 PR24 验收。'
  ];
}

function unique(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function formatList(items = [], emptyText) {
  if (!items.length) return [`- ${emptyText}`];
  return items.map((item) => `- ${item}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const report = await runAliyunCutoverReadiness({
    phase: process.env.ALIYUN_CUTOVER_PHASE || 'dual_write',
    reportFiles: buildCutoverReportFilesFromEnv(process.env),
    outputFile: process.env.ALIYUN_CUTOVER_OUTPUT_FILE,
    markdownOutputFile: process.env.ALIYUN_CUTOVER_MARKDOWN_FILE,
    options: {
      requireAttachment: process.env.ALIYUN_CUTOVER_REQUIRE_ATTACHMENT === 'yes' || undefined,
      requireSignedUrlReachable: process.env.ALIYUN_CUTOVER_REQUIRE_SIGNED_URL === 'yes',
      requireMigrationVerify: process.env.ALIYUN_CUTOVER_REQUIRE_MIGRATION !== 'no'
    }
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.decision === 'blocked') process.exit(1);
}
