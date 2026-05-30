import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  ALIYUN_RELEASE_DOC_FILES,
  buildAliyunReleaseDocIncludes
} from './aliyun-release-manifest.mjs';

describe('Aliyun release manifest helpers', () => {
  it('keeps PR23 handoff and readiness documents in the release package', () => {
    expect(ALIYUN_RELEASE_DOC_FILES).toEqual(expect.arrayContaining([
      'aliyun-pr23-it-handoff.md',
      'pr23-pr24-handoff-index.md',
      'aliyun-pr23-access-unlock-request.md',
      'pr23-aliyun-cutover-runbook.md',
      'pr23-aliyun-node-runtime-options.md',
      'pr23-readiness-audit.md',
      'pr23-deployment-acceptance.md',
      'pr24-supabase-decommission-audit.md',
      'pr24-aliyun-production-ops-runbook.md'
    ]));
    expect(new Set(ALIYUN_RELEASE_DOC_FILES).size).toBe(ALIYUN_RELEASE_DOC_FILES.length);
  });

  it('maps release document names to MANIFEST include paths', () => {
    expect(buildAliyunReleaseDocIncludes()).toEqual(expect.arrayContaining([
      'docs/aliyun-pr23-access-unlock-request.md',
      'docs/pr23-pr24-handoff-index.md',
      'docs/pr23-aliyun-cutover-runbook.md',
      'docs/pr23-aliyun-node-runtime-options.md',
      'docs/pr23-readiness-audit.md',
      'docs/pr24-supabase-decommission-audit.md',
      'docs/pr24-aliyun-production-ops-runbook.md'
    ]));
  });

  it('keeps BT entry lookup helper documented in the release manifest source', async () => {
    const releaseScript = await readFile(new URL('./build-aliyun-release.mjs', import.meta.url), 'utf8');
    expect(releaseScript).toContain('ops/aliyun/bt-entry-readonly.sh.example');
    expect(releaseScript).toContain('ops/aliyun/stage-release.sh.example');
    expect(releaseScript).toContain('ops/aliyun/Dockerfile.medical-credit-api');
    expect(releaseScript).toContain('ops/aliyun/docker-compose.medical-credit-api.yml.example');
    expect(releaseScript).toContain('ops/aliyun/docker-run-medical-credit-api.sh.example');
    expect(releaseScript).toContain('without switching traffic or reloading services');
  });

  it('keeps PR24 Supabase audit runnable from the release API package', async () => {
    const releaseScript = await readFile(new URL('./build-aliyun-release.mjs', import.meta.url), 'utf8');
    expect(releaseScript).toContain("audit:supabase");
    expect(releaseScript).toContain('api/scripts/audit-supabase-dependencies.mjs');
  });

  it('keeps generic Postgres/MySQL RDS migration support in the release package', async () => {
    const releaseScript = await readFile(new URL('./build-aliyun-release.mjs', import.meta.url), 'utf8');
    expect(releaseScript).toContain('api/scripts/apply-aliyun-db-migration.mjs');
    expect(releaseScript).toContain("'db:migrate:aliyun': 'node scripts/apply-aliyun-db-migration.mjs'");
    expect(releaseScript).toContain("'mysql2'");
  });
});
