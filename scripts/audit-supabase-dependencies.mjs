import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const defaultRoot = new URL('..', import.meta.url).pathname;

export const SUPABASE_AUDIT_PATTERNS = [
  { label: 'Supabase URL', pattern: /supabase\.co/i },
  { label: 'Supabase publishable key marker', pattern: /sb_publishable_[a-z0-9_]+/i },
  { label: 'Vite Supabase browser key env', pattern: /VITE_SUPABASE_PUBLISHABLE_KEY/i },
  { label: 'Supabase service role env', pattern: /SUPABASE_SERVICE_ROLE_KEY/i },
  { label: 'Supabase REST env', pattern: /SUPABASE_URL/i },
  { label: 'Supabase upstream URL env', pattern: /ASSESSMENT_UPSTREAM_URL/i },
  { label: 'Supabase upstream key env', pattern: /ASSESSMENT_UPSTREAM_API_KEY/i },
  { label: 'Supabase source import or path', pattern: /(@supabase\/|supabase\/functions|supabase\/migrations)/i }
];

const DEFAULT_SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'release',
  'backups',
  'coverage'
]);

const TEXT_FILE_EXTENSIONS = new Set([
  '',
  '.cjs',
  '.css',
  '.env',
  '.example',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.sql',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml'
]);

export async function auditSupabaseDependencies({
  root = defaultRoot,
  patterns = SUPABASE_AUDIT_PATTERNS,
  skipDirs = DEFAULT_SKIP_DIRS
} = {}) {
  const files = await listTextFiles(root, { skipDirs });
  const findings = [];

  for (const file of files) {
    const content = await readFile(file, 'utf8');
    const relPath = normalizePath(relative(root, file));
    const lines = content.split(/\r?\n/);

    lines.forEach((line, index) => {
      for (const { label, pattern } of patterns) {
        if (pattern.test(line)) {
          findings.push({
            file: relPath,
            line: index + 1,
            label,
            category: classifySupabaseDependency(relPath),
            preview: line.trim().slice(0, 180)
          });
        }
      }
    });
  }

  const categories = summarizeBy(findings, 'category');
  const labels = summarizeBy(findings, 'label');
  const productionFindings = findings.filter((finding) => finding.category === 'production_path');

  return {
    ok: productionFindings.length === 0,
    checkedFiles: files.length,
    totalFindings: findings.length,
    productionFindings: productionFindings.length,
    categories,
    labels,
    findings
  };
}

export function classifySupabaseDependency(relPath) {
  const path = normalizePath(relPath);

  if (path.endsWith('.test.js') || path.endsWith('.test.ts')) return 'test_fixture';
  if (path === 'scripts/audit-supabase-dependencies.mjs') return 'audit_tooling';

  if (
    path === 'package.json'
    || path === '.env.example'
    || path.startsWith('.github/')
    || path.startsWith('src/')
    || path === 'ops/aliyun/medical-credit-api.env.example'
    || path === 'ops/aliyun/preflight-release.sh.example'
    || path === 'scripts/build-aliyun-release.mjs'
    || path.startsWith('aliyun-api/')
  ) {
    return 'production_path';
  }

  if (
    path.startsWith('scripts/backup-supabase')
    || path.startsWith('scripts/supabase-')
    || path.startsWith('scripts/migrate-supabase')
    || path.startsWith('scripts/verify-aliyun-migration')
    || path.startsWith('scripts/aliyun-migration-verifier')
  ) {
    return 'migration_tooling';
  }

  if (path.startsWith('supabase/')) return 'legacy_supabase_source';
  if (path.startsWith('docs/') || path === 'README.md') return 'documentation';

  return 'other';
}

export function formatSupabaseAuditMarkdown(result) {
  const lines = [
    '# Supabase Dependency Audit',
    '',
    `- Checked files: ${result.checkedFiles}`,
    `- Total findings: ${result.totalFindings}`,
    `- Production-path findings: ${result.productionFindings}`,
    `- PR24 production-ready: ${result.ok ? 'yes' : 'no'}`,
    '',
    '## Categories',
    '',
    '| Category | Count |',
    '| --- | --- |',
    ...Object.entries(result.categories).map(([category, count]) => `| ${category} | ${count} |`),
    '',
    '## Findings',
    '',
    '| Category | File | Line | Marker |',
    '| --- | --- | --- | --- |',
    ...result.findings.map((finding) => (
      `| ${finding.category} | ${finding.file} | ${finding.line} | ${finding.label} |`
    ))
  ];

  return `${lines.join('\n')}\n`;
}

async function listTextFiles(dir, { skipDirs }) {
  const dirStat = await stat(dir).catch(() => null);
  if (!dirStat?.isDirectory()) return [];

  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      files.push(...await listTextFiles(join(dir, entry.name), { skipDirs }));
      continue;
    }

    if (!entry.isFile()) continue;
    const path = join(dir, entry.name);
    if (isTextFile(path)) files.push(path);
  }

  return files;
}

function isTextFile(path) {
  const normalized = normalizePath(path);
  const lastSegment = normalized.split('/').at(-1) || '';
  const extension = lastSegment.includes('.') ? `.${lastSegment.split('.').at(-1)}` : '';

  if (TEXT_FILE_EXTENSIONS.has(extension)) return true;
  return lastSegment.includes('.env') || lastSegment.endsWith('.example');
}

function summarizeBy(items, key) {
  return items.reduce((acc, item) => {
    acc[item[key]] = (acc[item[key]] || 0) + 1;
    return acc;
  }, {});
}

function normalizePath(path) {
  return String(path || '').split(sep).join('/');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await auditSupabaseDependencies();
  const output = process.env.SUPABASE_AUDIT_FORMAT === 'json'
    ? `${JSON.stringify(result, null, 2)}\n`
    : formatSupabaseAuditMarkdown(result);

  process.stdout.write(output);

  if (process.env.SUPABASE_AUDIT_EXPECT === 'no-production' && !result.ok) {
    console.error(`Supabase production-path dependencies remain: ${result.productionFindings}`);
    process.exit(1);
  }
}
