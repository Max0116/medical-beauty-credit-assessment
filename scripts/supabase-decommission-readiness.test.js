import { describe, expect, it, vi } from 'vitest';
import {
  evaluateSupabaseDecommissionReadiness,
  renderSupabaseDecommissionMarkdown,
  runSupabaseDecommissionReadiness
} from './supabase-decommission-readiness.mjs';

const cleanDist = {
  ok: true,
  checkedFiles: 2,
  findings: [],
  missingRequired: []
};

describe('evaluateSupabaseDecommissionReadiness', () => {
  it('blocks frontend Supabase references during preflight', () => {
    const report = evaluateSupabaseDecommissionReadiness({
      phase: 'preflight',
      dist: cleanDist,
      audit: {
        checkedFiles: 3,
        totalFindings: 1,
        findings: [{
          file: 'src/assessmentRepository.js',
          line: 1,
          category: 'production_path',
          label: 'Vite Supabase browser key env'
        }]
      }
    });

    expect(report.decision).toBe('blocked');
    expect(report.blockers.join('\n')).toContain('Frontend Supabase references remain');
  });

  it('allows PR23 rollback dependencies in preflight as manual review', () => {
    const report = evaluateSupabaseDecommissionReadiness({
      phase: 'preflight',
      dist: cleanDist,
      audit: {
        checkedFiles: 3,
        totalFindings: 1,
        findings: [{
          file: 'aliyun-api/upstreamRepository.js',
          line: 1,
          category: 'production_path',
          label: 'Supabase upstream URL env'
        }]
      }
    });

    expect(report.decision).toBe('manual_review');
    expect(report.blockers).toEqual([]);
    expect(report.warnings.join('\n')).toContain('PR23 rollback/dual_write');
  });

  it('blocks final decommission when production dependencies or upstream env remain', () => {
    const report = evaluateSupabaseDecommissionReadiness({
      phase: 'final',
      dist: cleanDist,
      envContent: [
        'MEDICAL_CREDIT_BACKEND_MODE=dual_write',
        'ASSESSMENT_UPSTREAM_URL=https://demo.supabase.co/functions/v1/assessments'
      ].join('\n'),
      audit: {
        checkedFiles: 3,
        totalFindings: 1,
        findings: [{
          file: 'aliyun-api/upstreamRepository.js',
          line: 1,
          category: 'production_path',
          label: 'Supabase upstream URL env'
        }]
      }
    });

    expect(report.decision).toBe('blocked');
    expect(report.blockers.join('\n')).toContain('MEDICAL_CREDIT_BACKEND_MODE=aliyun');
    expect(report.blockers.join('\n')).toContain('ASSESSMENT_UPSTREAM_URL');
    expect(report.blockers.join('\n')).toContain('Production-path Supabase dependencies remain');
  });

  it('passes final decommission when only archive references remain', () => {
    const report = evaluateSupabaseDecommissionReadiness({
      phase: 'final',
      dist: cleanDist,
      envContent: 'MEDICAL_CREDIT_BACKEND_MODE=aliyun\n',
      audit: {
        checkedFiles: 3,
        totalFindings: 1,
        findings: [{
          file: 'docs/pr23.md',
          line: 1,
          category: 'documentation',
          label: 'Supabase URL'
        }]
      }
    });

    expect(report.decision).toBe('manual_review');
    expect(report.blockers).toEqual([]);
    expect(report.warnings.join('\n')).toContain('Historical / migration');
  });

  it('allows placeholder or commented Supabase env values during final decommission', () => {
    const report = evaluateSupabaseDecommissionReadiness({
      phase: 'final',
      dist: cleanDist,
      envContent: [
        'MEDICAL_CREDIT_BACKEND_MODE=aliyun',
        'ASSESSMENT_UPSTREAM_URL=<removed-after-pr24>',
        'ASSESSMENT_UPSTREAM_API_KEY=',
        '# SUPABASE_URL=https://archived.supabase.co',
        '# SUPABASE_SERVICE_ROLE_KEY=service_role_archived'
      ].join('\n'),
      audit: {
        checkedFiles: 3,
        totalFindings: 0,
        findings: []
      }
    });

    expect(report.decision).toBe('go');
    expect(report.blockers).toEqual([]);
  });

  it('renders a compact markdown report', () => {
    const markdown = renderSupabaseDecommissionMarkdown({
      phase: 'final',
      decision: 'blocked',
      generatedAt: '2026-05-30T04:20:00.000Z',
      envFile: '/www/wwwroot/medical-credit-api/.env',
      distCheckedFiles: 2,
      auditCheckedFiles: 5,
      totalFindings: 1,
      productionFindings: 1,
      frontendFindings: 0,
      legacyFindings: 0,
      blockers: ['Production-path Supabase dependencies remain: 1'],
      warnings: [],
      recommendations: ['Do not disable Supabase.']
    });

    expect(markdown).toContain('阶段：final');
    expect(markdown).toContain('判断：blocked');
    expect(markdown).toContain('Production-path Supabase dependencies remain');
  });
});

describe('runSupabaseDecommissionReadiness', () => {
  it('writes json and markdown reports from injected scanners', async () => {
    const writes = new Map();
    const writeFileImpl = vi.fn(async (filePath, content) => {
      writes.set(filePath, content);
    });
    const report = await runSupabaseDecommissionReadiness({
      phase: 'final',
      envFile: '/tmp/api.env',
      outputFile: '/tmp/report.json',
      markdownOutputFile: '/tmp/report.md',
      readFileImpl: vi.fn(async () => 'MEDICAL_CREDIT_BACKEND_MODE=aliyun\n'),
      writeFileImpl,
      auditImpl: vi.fn(async () => ({
        checkedFiles: 1,
        totalFindings: 0,
        findings: []
      })),
      distImpl: vi.fn(async () => cleanDist)
    });

    expect(report.decision).toBe('go');
    expect(writeFileImpl).toHaveBeenCalledTimes(2);
    expect(writes.get('/tmp/report.json')).toContain('"decision": "go"');
    expect(writes.get('/tmp/report.md')).toContain('PR24 Supabase Decommission Readiness');
  });
});
