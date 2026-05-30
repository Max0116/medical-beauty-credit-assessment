import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  auditSupabaseDependencies,
  classifySupabaseDependency,
  formatSupabaseAuditMarkdown
} from './audit-supabase-dependencies.mjs';

describe('auditSupabaseDependencies', () => {
  it('classifies production Supabase references separately from docs and migration tools', async () => {
    const root = await createAuditFixture({
      'src/assessmentRepository.js': 'const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;',
      'scripts/backup-supabase.mjs': 'const url = process.env.SUPABASE_URL;',
      'docs/pr24.md': 'Old rollback used https://demo.supabase.co/functions/v1/assessments',
      'release/ignored.js': 'const key = "VITE_SUPABASE_PUBLISHABLE_KEY";'
    });

    const result = await auditSupabaseDependencies({ root });

    expect(result.ok).toBe(false);
    expect(result.productionFindings).toBe(1);
    expect(result.categories).toMatchObject({
      production_path: 1,
      migration_tooling: 1,
      documentation: 1
    });
    expect(result.findings.map((finding) => finding.file)).not.toContain('release/ignored.js');
  });

  it('returns ok when Supabase references are only historical docs or migration scripts', async () => {
    const root = await createAuditFixture({
      'scripts/migrate-supabase-to-aliyun-rds.mjs': 'const key = process.env.SUPABASE_SERVICE_ROLE_KEY;',
      'docs/archive.md': 'Supabase was the previous backend.'
    });

    await expect(auditSupabaseDependencies({ root })).resolves.toMatchObject({
      ok: true,
      productionFindings: 0,
      totalFindings: 1
    });
  });

  it('formats a compact markdown report for PR24 review', async () => {
    const markdown = formatSupabaseAuditMarkdown({
      checkedFiles: 2,
      totalFindings: 1,
      productionFindings: 1,
      ok: false,
      categories: { production_path: 1 },
      findings: [{
        category: 'production_path',
        file: 'src/assessmentRepository.js',
        line: 10,
        label: 'Vite Supabase browser key env'
      }]
    });

    expect(markdown).toContain('PR24 production-ready: no');
    expect(markdown).toContain('| production_path | src/assessmentRepository.js | 10 | Vite Supabase browser key env |');
  });
});

describe('classifySupabaseDependency', () => {
  it('classifies known dependency locations', () => {
    expect(classifySupabaseDependency('src/assessmentRepository.js')).toBe('production_path');
    expect(classifySupabaseDependency('src/assessmentRepository.test.js')).toBe('test_fixture');
    expect(classifySupabaseDependency('aliyun-api/upstreamRepository.js')).toBe('production_path');
    expect(classifySupabaseDependency('aliyun-api/upstreamRepository.test.js')).toBe('test_fixture');
    expect(classifySupabaseDependency('scripts/backup-supabase.mjs')).toBe('migration_tooling');
    expect(classifySupabaseDependency('scripts/audit-supabase-dependencies.mjs')).toBe('audit_tooling');
    expect(classifySupabaseDependency('supabase/functions/assessments/index.ts')).toBe('legacy_supabase_source');
    expect(classifySupabaseDependency('docs/pr23.md')).toBe('documentation');
  });
});

async function createAuditFixture(files) {
  const dir = join(tmpdir(), `medical-credit-supabase-audit-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  for (const [path, content] of Object.entries(files)) {
    const filePath = join(dir, path);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }
  return dir;
}
