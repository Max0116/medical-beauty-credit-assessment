import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = process.cwd();
const releaseRoot = join(root, 'release');
const shortSha = git('rev-parse', '--short=12', 'HEAD');
const branch = git('branch', '--show-current') || 'unknown';
const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const releaseName = `medical-credit-assessment-pr22-${shortSha}-${timestamp}`;
const packageDir = join(releaseRoot, releaseName);
const archivePath = join(releaseRoot, `${releaseName}.tar.gz`);

await mkdir(releaseRoot, { recursive: true });
await mkdir(packageDir, { recursive: true });
await mkdir(join(packageDir, 'h5'), { recursive: true });
await mkdir(join(packageDir, 'api', 'aliyun-api'), { recursive: true });
await mkdir(join(packageDir, 'docs'), { recursive: true });

await cp(join(root, 'dist', 'index.html'), join(packageDir, 'h5', 'index.html'));
await cp(join(root, 'dist', 'assets'), join(packageDir, 'h5', 'assets'), { recursive: true });
await cp(join(root, 'aliyun-api', 'server.js'), join(packageDir, 'api', 'aliyun-api', 'server.js'));
await cp(join(root, 'aliyun-api', 'proxyServer.js'), join(packageDir, 'api', 'aliyun-api', 'proxyServer.js'));
await cp(join(root, 'ops', 'aliyun'), join(packageDir, 'ops', 'aliyun'), { recursive: true });
await cp(join(root, 'docs', 'aliyun-pr22-api-proxy.md'), join(packageDir, 'docs', 'aliyun-pr22-api-proxy.md'));
await cp(join(root, 'docs', 'aliyun-pr22-it-handoff.md'), join(packageDir, 'docs', 'aliyun-pr22-it-handoff.md'));
await cp(join(root, 'docs', 'pr22-deployment-acceptance.md'), join(packageDir, 'docs', 'pr22-deployment-acceptance.md'));
await cp(join(root, 'docs', 'pr23-aliyun-rds-oss-migration-plan.md'), join(packageDir, 'docs', 'pr23-aliyun-rds-oss-migration-plan.md'));
await writeFile(join(packageDir, 'api', 'package.json'), `${JSON.stringify({
  name: 'medical-credit-assessment-api-proxy',
  version: '0.1.0',
  private: true,
  type: 'module',
  scripts: {
    start: 'node aliyun-api/server.js'
  },
  engines: {
    node: '>=20'
  }
}, null, 2)}\n`);

const manifest = {
  name: releaseName,
  project: 'medical-credit-assessment',
  stage: 'PR22 Aliyun API proxy',
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
    'api/package.json',
    'ops/aliyun/',
    'ops/aliyun/deploy-release.sh.example',
    'ops/aliyun/preflight-release.sh.example',
    'ops/aliyun/rollback-release.sh.example',
    'ops/aliyun/nginx-medical-credit-https.conf.example',
    'docs/aliyun-pr22-api-proxy.md',
    'docs/aliyun-pr22-it-handoff.md',
    'docs/pr22-deployment-acceptance.md',
    'docs/pr23-aliyun-rds-oss-migration-plan.md'
  ],
  deploymentNotes: [
    'Copy h5/* into the independent static root, for example /var/www/medical-credit.',
    'Copy api/* into the independent Node API root, for example /var/www/medical-credit-api.',
    'Create /var/www/medical-credit-api/.env from ops/aliyun/medical-credit-api.env.example on the server.',
    'Do not place ASSESSMENT_UPSTREAM_API_KEY in the H5 directory or browser-visible files.',
    'Configure Nginx /api/ to proxy to http://127.0.0.1:8787/api/.'
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
