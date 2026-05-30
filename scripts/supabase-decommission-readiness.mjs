import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { auditSupabaseDependencies } from './audit-supabase-dependencies.mjs';
import { parseEnvContent } from './aliyun-env-guard.mjs';
import { buildRequiredApiBasePatterns, verifyDistNoSecrets } from './verify-dist-no-secrets.mjs';

const VALID_PHASES = new Set(['preflight', 'final']);
const SERVER_SUPABASE_KEYS = [
  'ASSESSMENT_UPSTREAM_URL',
  'ASSESSMENT_UPSTREAM_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY'
];
const FRONTEND_PATH_PREFIXES = ['src/', '.github/'];
const FRONTEND_EXACT_PATHS = ['.env.example'];
const FRONTEND_LABEL_PATTERNS = [
  /Supabase URL/i,
  /publishable/i,
  /Vite Supabase/i,
  /source import/i
];

export function evaluateSupabaseDecommissionReadiness({
  phase = 'preflight',
  audit,
  dist,
  envContent = '',
  envFile = '',
  generatedAt = new Date().toISOString()
} = {}) {
  const normalizedPhase = normalizePhase(phase);
  const blockers = [];
  const warnings = [];
  const env = envContent ? parseEnvContent(envContent) : {};
  const frontendFindings = getFrontendSupabaseFindings(audit?.findings || []);
  const productionFindings = (audit?.findings || []).filter((finding) => finding.category === 'production_path');

  if (!audit) {
    blockers.push('Supabase dependency audit result is required.');
  }

  if (!dist) {
    blockers.push('Frontend dist scan result is required. Run npm run build:aliyun before PR24 decommission.');
  } else {
    if (!dist.ok) {
      for (const finding of dist.findings || []) blockers.push(`Frontend dist contains forbidden marker: ${finding}`);
      for (const missing of dist.missingRequired || []) blockers.push(`Frontend dist missing required marker: ${missing}`);
    }
  }

  if (frontendFindings.length > 0) {
    blockers.push(`Frontend Supabase references remain: ${frontendFindings.length}`);
  }

  if (normalizedPhase === 'final') {
    if (!envContent) {
      blockers.push('Final decommission requires the production API .env content or SUPABASE_DECOMMISSION_ENV_FILE.');
    } else {
      if (env.MEDICAL_CREDIT_BACKEND_MODE !== 'aliyun') {
        blockers.push(`Final decommission requires MEDICAL_CREDIT_BACKEND_MODE=aliyun, got ${env.MEDICAL_CREDIT_BACKEND_MODE || '<missing>'}.`);
      }
      const configuredServerSupabaseKeys = SERVER_SUPABASE_KEYS.filter((key) => hasRealValue(env[key]));
      if (configuredServerSupabaseKeys.length > 0) {
        blockers.push(`Server .env still contains Supabase/upstream keys: ${configuredServerSupabaseKeys.join(', ')}`);
      }
    }

    if (productionFindings.length > 0) {
      blockers.push(`Production-path Supabase dependencies remain: ${productionFindings.length}`);
    }
  } else {
    if (productionFindings.length > frontendFindings.length) {
      warnings.push(`Production-path Supabase dependencies still exist for PR23 rollback/dual_write: ${productionFindings.length}. They must be removed before final PR24.`);
    }
    if (!envContent) {
      warnings.push('No production API .env provided; final PR24 will require MEDICAL_CREDIT_BACKEND_MODE=aliyun and no Supabase upstream keys.');
    }
  }

  const legacyFindings = (audit?.findings || []).filter((finding) => (
    finding.category === 'legacy_supabase_source'
    || finding.category === 'migration_tooling'
    || finding.category === 'documentation'
  ));
  if (legacyFindings.length > 0) {
    warnings.push(`Historical / migration Supabase references remain: ${legacyFindings.length}. Keep only as archive after final decommission.`);
  }

  const decision = blockers.length ? 'blocked' : warnings.length ? 'manual_review' : 'go';
  return {
    type: 'supabase_decommission_readiness',
    generatedAt,
    phase: normalizedPhase,
    ok: decision === 'go',
    decision,
    envFile,
    distCheckedFiles: dist?.checkedFiles || 0,
    auditCheckedFiles: audit?.checkedFiles || 0,
    totalFindings: audit?.totalFindings || 0,
    productionFindings: productionFindings.length,
    frontendFindings: frontendFindings.length,
    legacyFindings: legacyFindings.length,
    blockers,
    warnings,
    recommendations: buildRecommendations(decision, normalizedPhase)
  };
}

export function renderSupabaseDecommissionMarkdown(report) {
  return [
    '# PR24 Supabase Decommission Readiness',
    '',
    `阶段：${report.phase}`,
    `判断：${report.decision}`,
    `生成时间：${report.generatedAt}`,
    `环境文件：${report.envFile || '未提供'}`,
    '',
    '## 统计',
    '',
    `- 构建产物扫描文件数：${report.distCheckedFiles}`,
    `- Supabase 审计文件数：${report.auditCheckedFiles}`,
    `- Supabase 总发现数：${report.totalFindings}`,
    `- 生产路径发现数：${report.productionFindings}`,
    `- 前端发现数：${report.frontendFindings}`,
    `- 历史 / 迁移 / 文档发现数：${report.legacyFindings}`,
    '',
    '## 阻断项',
    '',
    ...formatList(report.blockers, '无。'),
    '',
    '## 人工复核项',
    '',
    ...formatList(report.warnings, '无。'),
    '',
    '## 下一步',
    '',
    ...formatList(report.recommendations, '无。'),
    ''
  ].join('\n');
}

export async function runSupabaseDecommissionReadiness({
  root,
  phase = process.env.SUPABASE_DECOMMISSION_PHASE || 'preflight',
  envFile = process.env.SUPABASE_DECOMMISSION_ENV_FILE || '',
  distDir = process.env.SUPABASE_DECOMMISSION_DIST_DIR || undefined,
  outputFile = process.env.SUPABASE_DECOMMISSION_OUTPUT_FILE || '',
  markdownOutputFile = process.env.SUPABASE_DECOMMISSION_MARKDOWN_FILE || '',
  readFileImpl = readFile,
  writeFileImpl = writeFile,
  auditImpl = auditSupabaseDependencies,
  distImpl = verifyDistNoSecrets
} = {}) {
  const [audit, dist, envContent] = await Promise.all([
    auditImpl({ root }),
    distImpl({
      directory: distDir,
      requiredPatterns: buildRequiredApiBasePatterns('/api')
    }).catch((error) => ({
      ok: false,
      checkedFiles: 0,
      findings: [`dist scan failed: ${error.message}`],
      missingRequired: []
    })),
    envFile ? readFileImpl(envFile, 'utf8') : ''
  ]);
  const report = evaluateSupabaseDecommissionReadiness({
    phase,
    audit,
    dist,
    envContent,
    envFile
  });

  if (outputFile) {
    await writeFileImpl(outputFile, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (markdownOutputFile) {
    await writeFileImpl(markdownOutputFile, renderSupabaseDecommissionMarkdown(report));
  }
  return report;
}

function normalizePhase(value) {
  const phase = String(value || 'preflight').trim().toLowerCase();
  if (!VALID_PHASES.has(phase)) {
    throw new Error(`Unsupported SUPABASE_DECOMMISSION_PHASE: ${phase}. Use preflight or final.`);
  }
  return phase;
}

function getFrontendSupabaseFindings(findings = []) {
  return findings.filter((finding) => {
    const file = String(finding.file || '');
    const inFrontendPath = FRONTEND_EXACT_PATHS.includes(file)
      || FRONTEND_PATH_PREFIXES.some((prefix) => file.startsWith(prefix));
    const frontendLabel = FRONTEND_LABEL_PATTERNS.some((pattern) => pattern.test(finding.label || ''));
    return inFrontendPath && frontendLabel;
  });
}

function hasRealValue(value) {
  const text = String(value || '').trim();
  return Boolean(text) && !/^<.*>$/.test(text);
}

function buildRecommendations(decision, phase) {
  if (decision === 'go') {
    return phase === 'final'
      ? ['Supabase production dependencies are clear; keep final backups and proceed with controlled decommission.']
      : ['Frontend/preflight Supabase checks are clear; continue PR23 aliyun smoke and prepare final PR24 evidence.'];
  }
  if (decision === 'manual_review') {
    return [
      'Confirm remaining Supabase references are historical migration/archive material only.',
      'Keep PR23 rollback available until final phase returns go or the reviewer explicitly accepts the archive-only references.',
      'Run the final phase with the production API .env and H5 dist path before disabling Supabase.'
    ];
  }
  return [
    'Do not disable Supabase until all blockers are resolved.',
    'Keep PR23 rollback available until final phase returns go.',
    'Run npm run build:aliyun before this gate so browser-visible dist is scanned.'
  ];
}

function formatList(items = [], fallback = '无。') {
  return items.length ? items.map((item) => `- ${item}`) : [`- ${fallback}`];
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const report = await runSupabaseDecommissionReadiness();
  const output = process.env.SUPABASE_DECOMMISSION_FORMAT === 'json'
    ? `${JSON.stringify(report, null, 2)}\n`
    : renderSupabaseDecommissionMarkdown(report);
  process.stdout.write(output);
  if (report.decision === 'blocked') process.exit(1);
}
