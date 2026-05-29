import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = process.cwd();
const releaseRoot = join(root, 'release');
const shortSha = git('rev-parse', '--short=12', 'HEAD');
const branch = git('branch', '--show-current') || 'unknown';
const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const releaseName = `medical-credit-assessment-aliyun-${shortSha}-${timestamp}`;
const packageDir = join(releaseRoot, releaseName);
const archivePath = join(releaseRoot, `${releaseName}.tar.gz`);
const rootPackage = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

await mkdir(releaseRoot, { recursive: true });
await mkdir(packageDir, { recursive: true });
await mkdir(join(packageDir, 'h5'), { recursive: true });
await mkdir(join(packageDir, 'api', 'aliyun-api'), { recursive: true });
await mkdir(join(packageDir, 'api', 'scripts'), { recursive: true });
await mkdir(join(packageDir, 'docs'), { recursive: true });

await cp(join(root, 'dist', 'index.html'), join(packageDir, 'h5', 'index.html'));
await cp(join(root, 'dist', 'assets'), join(packageDir, 'h5', 'assets'), { recursive: true });
await copyDirectoryFiltered(join(root, 'aliyun-api'), join(packageDir, 'api', 'aliyun-api'), {
  excludeFile: (filePath) => filePath.endsWith('.test.js')
});
await cp(join(root, 'scripts', 'aliyun-health.mjs'), join(packageDir, 'api', 'scripts', 'aliyun-health.mjs'));
await cp(join(root, 'scripts', 'check-aliyun-health.mjs'), join(packageDir, 'api', 'scripts', 'check-aliyun-health.mjs'));
await cp(join(root, 'scripts', 'format-aliyun-inventory-report.mjs'), join(packageDir, 'api', 'scripts', 'format-aliyun-inventory-report.mjs'));
await cp(join(root, 'scripts', 'apply-aliyun-postgres-migration.mjs'), join(packageDir, 'api', 'scripts', 'apply-aliyun-postgres-migration.mjs'));
await cp(join(root, 'scripts', 'supabase-backup.mjs'), join(packageDir, 'api', 'scripts', 'supabase-backup.mjs'));
await cp(join(root, 'scripts', 'backup-supabase.mjs'), join(packageDir, 'api', 'scripts', 'backup-supabase.mjs'));
await cp(join(root, 'scripts', 'aliyun-migration-verifier.mjs'), join(packageDir, 'api', 'scripts', 'aliyun-migration-verifier.mjs'));
await cp(join(root, 'scripts', 'verify-aliyun-migration.mjs'), join(packageDir, 'api', 'scripts', 'verify-aliyun-migration.mjs'));
await cp(join(root, 'scripts', 'supabase-rds-migration.mjs'), join(packageDir, 'api', 'scripts', 'supabase-rds-migration.mjs'));
await cp(join(root, 'scripts', 'migrate-supabase-to-aliyun-rds.mjs'), join(packageDir, 'api', 'scripts', 'migrate-supabase-to-aliyun-rds.mjs'));
await cp(join(root, 'scripts', 'supabase-oss-migration.mjs'), join(packageDir, 'api', 'scripts', 'supabase-oss-migration.mjs'));
await cp(join(root, 'scripts', 'migrate-supabase-evidence-to-aliyun-oss.mjs'), join(packageDir, 'api', 'scripts', 'migrate-supabase-evidence-to-aliyun-oss.mjs'));
await cp(join(root, 'ops', 'aliyun'), join(packageDir, 'ops', 'aliyun'), { recursive: true });
await cp(join(root, 'docs', 'aliyun-pr22-api-proxy.md'), join(packageDir, 'docs', 'aliyun-pr22-api-proxy.md'));
await cp(join(root, 'docs', 'aliyun-pr22-it-handoff.md'), join(packageDir, 'docs', 'aliyun-pr22-it-handoff.md'));
await cp(join(root, 'docs', 'pr22-deployment-acceptance.md'), join(packageDir, 'docs', 'pr22-deployment-acceptance.md'));
await cp(join(root, 'docs', 'pr23-aliyun-rds-oss-migration-plan.md'), join(packageDir, 'docs', 'pr23-aliyun-rds-oss-migration-plan.md'));
await cp(join(root, 'docs', 'aliyun-pr23-it-handoff.md'), join(packageDir, 'docs', 'aliyun-pr23-it-handoff.md'));
await cp(join(root, 'docs', 'aliyun-pr23-server-inventory-checklist.md'), join(packageDir, 'docs', 'aliyun-pr23-server-inventory-checklist.md'));
await cp(join(root, 'docs', 'pr23-deployment-acceptance.md'), join(packageDir, 'docs', 'pr23-deployment-acceptance.md'));
await writeFile(join(packageDir, 'api', 'package.json'), `${JSON.stringify({
  name: 'medical-credit-assessment-api',
  version: '0.1.0',
  private: true,
  type: 'module',
  scripts: {
    start: 'node aliyun-api/server.js',
    'health:aliyun': 'node scripts/check-aliyun-health.mjs',
    'inventory:aliyun:format': 'node scripts/format-aliyun-inventory-report.mjs',
    'backup:supabase': 'node scripts/backup-supabase.mjs',
    'db:migrate:aliyun': 'node scripts/apply-aliyun-postgres-migration.mjs',
    'db:migrate:supabase-to-aliyun': 'node scripts/migrate-supabase-to-aliyun-rds.mjs',
    'storage:migrate:supabase-to-oss': 'node scripts/migrate-supabase-evidence-to-aliyun-oss.mjs',
    'migration:verify:aliyun': 'node scripts/verify-aliyun-migration.mjs'
  },
  dependencies: pickDependencies(rootPackage.dependencies, ['ali-oss', 'busboy', 'pg']),
  engines: {
    node: '>=20'
  }
}, null, 2)}\n`);

const manifest = {
  name: releaseName,
  project: 'medical-credit-assessment',
  stage: 'PR23 Aliyun RDS OSS backend',
  createdAt: new Date().toISOString(),
  branch,
  commit: git('rev-parse', 'HEAD'),
  h5Target: '/var/www/medical-credit',
  apiTarget: '/var/www/medical-credit-api',
  apiHealthPath: '/api/health',
  frontendApiBase: '/api',
  includes: [
    'h5/',
    'api/aliyun-api/',
    'api/aliyun-api/migrations/',
    'api/scripts/aliyun-health.mjs',
    'api/scripts/check-aliyun-health.mjs',
    'api/scripts/format-aliyun-inventory-report.mjs',
    'api/scripts/apply-aliyun-postgres-migration.mjs',
    'api/scripts/supabase-backup.mjs',
    'api/scripts/backup-supabase.mjs',
    'api/scripts/aliyun-migration-verifier.mjs',
    'api/scripts/verify-aliyun-migration.mjs',
    'api/scripts/supabase-rds-migration.mjs',
    'api/scripts/migrate-supabase-to-aliyun-rds.mjs',
    'api/scripts/supabase-oss-migration.mjs',
    'api/scripts/migrate-supabase-evidence-to-aliyun-oss.mjs',
    'api/package.json',
    'ops/aliyun/',
    'ops/aliyun/deploy-release.sh.example',
    'ops/aliyun/server-inventory-readonly.sh.example',
    'ops/aliyun/preflight-release.sh.example',
    'ops/aliyun/rollback-release.sh.example',
    'ops/aliyun/nginx-medical-credit-https.conf.example',
    'docs/aliyun-pr22-api-proxy.md',
    'docs/aliyun-pr22-it-handoff.md',
    'docs/pr22-deployment-acceptance.md',
    'docs/pr23-aliyun-rds-oss-migration-plan.md',
    'docs/aliyun-pr23-it-handoff.md',
    'docs/aliyun-pr23-server-inventory-checklist.md',
    'docs/pr23-deployment-acceptance.md'
  ],
  deploymentNotes: [
    'Copy h5/* into the independent static root, for example /var/www/medical-credit.',
    'Copy api/* into the independent Node API root, for example /var/www/medical-credit-api.',
    'Run npm install --omit=dev --package-lock=false in the API current directory after switching releases.',
    'Create /var/www/medical-credit-api/.env from ops/aliyun/medical-credit-api.env.example on the server.',
    'Do not place ASSESSMENT_UPSTREAM_API_KEY in the H5 directory or browser-visible files.',
    'Before touching an existing server, run bash ops/aliyun/server-inventory-readonly.sh.example to capture a read-only inventory of paths, Nginx, ports, and service layout.',
    'Format the inventory log with INVENTORY_INPUT_FILE=/tmp/medical-credit-inventory.txt npm run inventory:aliyun:format before filling the PR23 acceptance checklist.',
    'Configure Nginx /api/ to proxy to http://127.0.0.1:8787/api/.',
    'Run npm run db:migrate:aliyun in the API current directory after IT provides the RDS credentials.',
    'Run npm run backup:supabase before any one-off Supabase backfill; keep the generated backup directory outside the browser-visible H5 root.',
    'Optionally run npm run storage:migrate:supabase-to-oss and npm run db:migrate:supabase-to-aliyun for one-off Supabase backfills with SUPABASE_SERVICE_ROLE_KEY set only in the shell session.',
    'Run BACKUP_DIR=/path/to/backup VERIFY_OSS=true npm run migration:verify:aliyun after backfill to compare backup counts and OSS objects.'
  ]
};

await writeFile(join(packageDir, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const tar = spawnSync('tar', ['-czf', archivePath, '-C', releaseRoot, releaseName], {
  cwd: root,
  encoding: 'utf8'
});
if (tar.status !== 0) {
  throw new Error(`tar failed: ${tar.stderr || tar.stdout}`);
}

const archive = await readFile(archivePath);
const sha256 = createHash('sha256').update(archive).digest('hex');
await writeFile(`${archivePath}.sha256`, `${sha256}  ${releaseName}.tar.gz\n`);

console.log(JSON.stringify({
  releaseName,
  packageDir,
  archivePath,
  sha256Path: `${archivePath}.sha256`,
  sha256
}, null, 2));

function git(...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) return '';
  return result.stdout.trim();
}

async function copyDirectoryFiltered(sourceDir, targetDir, { excludeFile } = {}) {
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryFiltered(sourcePath, targetPath, { excludeFile });
    } else if (entry.isFile() && !excludeFile?.(sourcePath)) {
      await cp(sourcePath, targetPath);
    }
  }
}

function pickDependencies(source = {}, names = []) {
  return Object.fromEntries(names.map((name) => [name, source[name]]).filter(([, version]) => Boolean(version)));
}
