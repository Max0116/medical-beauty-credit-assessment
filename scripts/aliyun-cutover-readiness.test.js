import { describe, expect, it, vi } from 'vitest';
import {
  buildCutoverReportFilesFromEnv,
  evaluateAliyunCutoverReadiness,
  renderAliyunCutoverReadinessMarkdown,
  runAliyunCutoverReadiness
} from './aliyun-cutover-readiness.mjs';

const goGate = { ok: true, decision: 'go', blockers: [], warnings: [] };
const resourceDualWrite = {
  ok: false,
  decision: 'manual_review',
  mode: 'dual_write',
  blockers: [],
  warnings: ['dual_write 是灰度阶段；切 aliyun 前必须完成 API flow smoke、历史记录、附件签名链接和人工核验闭环验收。']
};
const health = { ok: true, ready: true, mode: 'dual_write', status: 200 };
const apiFlow = {
  record: { id: 'api-flow-001' },
  history: { includesSavedRecord: true },
  verification: { logCount: 1 },
  attachment: null
};

describe('Aliyun cutover readiness', () => {
  it('summarizes a dual_write cutover as manual review when attachment smoke is still missing', () => {
    const report = evaluateAliyunCutoverReadiness({
      phase: 'dual_write',
      reports: {
        inventoryGate: goGate,
        nginxGate: goGate,
        envGate: goGate,
        resourceReadiness: resourceDualWrite,
        health,
        apiFlow
      }
    });

    expect(report.decision).toBe('manual_review');
    expect(report.blockers).toEqual([]);
    expect(report.warnings.join('\n')).toContain('API flow smoke did not upload an attachment');
    expect(report.components.map((item) => item.id)).toEqual([
      'inventoryGate',
      'nginxGate',
      'envGate',
      'resourceReadiness',
      'health',
      'apiFlow'
    ]);
  });

  it('blocks when a required report is missing or a gate is blocked', () => {
    const report = evaluateAliyunCutoverReadiness({
      phase: 'preflight',
      reports: {
        inventoryGate: goGate,
        nginxGate: { ok: false, decision: 'blocked', blockers: ['duplicate server_name'] },
        envGate: goGate
      }
    });

    expect(report.decision).toBe('blocked');
    expect(report.blockers).toContain('Nginx 入口归属闸门 is blocked.');
    expect(report.blockers).toContain('Nginx 入口归属闸门: duplicate server_name');
    expect(report.blockers).toContain('Missing required report: 阿里云资源就绪检查');
  });

  it('requires migration verification and attachment evidence for aliyun cutover', () => {
    const report = evaluateAliyunCutoverReadiness({
      phase: 'aliyun',
      reports: {
        inventoryGate: goGate,
        nginxGate: goGate,
        envGate: goGate,
        resourceReadiness: { ok: true, decision: 'go', mode: 'aliyun' },
        health: { ok: true, ready: true, mode: 'aliyun', status: 200 },
        apiFlow: {
          ...apiFlow,
          attachment: { id: 'attachment-1', hasSignedUrl: true, signedUrlReachable: true }
        },
        migrationVerify: {
          ok: true,
          checkOss: true,
          tables: [{ table: 'assessment_records', ok: true }],
          evidenceAttachments: { missing: 0 }
        }
      },
      requireSignedUrlReachable: true
    });

    expect(report.decision).toBe('go');
    expect(report.ok).toBe(true);
  });

  it('blocks aliyun cutover when OSS migration verification is missing evidence', () => {
    const report = evaluateAliyunCutoverReadiness({
      phase: 'aliyun',
      reports: {
        inventoryGate: goGate,
        nginxGate: goGate,
        envGate: goGate,
        resourceReadiness: { ok: true, decision: 'go', mode: 'aliyun' },
        health: { ok: true, ready: true, mode: 'aliyun', status: 200 },
        apiFlow: {
          ...apiFlow,
          attachment: { id: 'attachment-1', hasSignedUrl: true }
        },
        migrationVerify: {
          ok: false,
          checkOss: true,
          tables: [],
          evidenceAttachments: { missing: 2 }
        }
      }
    });

    expect(report.decision).toBe('blocked');
    expect(report.blockers).toContain('Migration verification did not pass.');
    expect(report.blockers).toContain('Migration verification has missing OSS attachments: 2');
  });

  it('writes JSON and Markdown reports from report files', async () => {
    const files = new Map([
      ['/tmp/inventory.json', JSON.stringify(goGate)],
      ['/tmp/nginx.json', JSON.stringify(goGate)],
      ['/tmp/env.json', JSON.stringify(goGate)],
      ['/tmp/resources.json', JSON.stringify({ ok: true, decision: 'go', mode: 'aliyun' })]
    ]);
    const writes = new Map();
    const writeFileImpl = vi.fn(async (filePath, content) => {
      writes.set(filePath, content);
    });

    const report = await runAliyunCutoverReadiness({
      phase: 'preflight',
      reportFiles: {
        inventoryGate: '/tmp/inventory.json',
        nginxGate: '/tmp/nginx.json',
        envGate: '/tmp/env.json',
        resourceReadiness: '/tmp/resources.json'
      },
      outputFile: '/tmp/cutover.json',
      markdownOutputFile: '/tmp/cutover.md',
      readFileImpl: async (filePath) => files.get(filePath),
      writeFileImpl
    });

    expect(report.decision).toBe('go');
    expect(writes.get('/tmp/cutover.json')).toContain('"type": "aliyun_cutover_readiness"');
    expect(writes.get('/tmp/cutover.md')).toContain('PR23 阿里云切换总闸门');
  });

  it('maps environment variables to report files', () => {
    expect(buildCutoverReportFilesFromEnv({
      ALIYUN_CUTOVER_HEALTH_FILE: '/tmp/health.json',
      ALIYUN_CUTOVER_API_FLOW_FILE: '/tmp/api-flow.json'
    })).toMatchObject({
      health: '/tmp/health.json',
      apiFlow: '/tmp/api-flow.json'
    });
  });

  it('renders a compact Markdown handoff', () => {
    const markdown = renderAliyunCutoverReadinessMarkdown(evaluateAliyunCutoverReadiness({
      phase: 'preflight',
      reports: {
        inventoryGate: goGate,
        nginxGate: goGate,
        envGate: goGate,
        resourceReadiness: { ok: true, decision: 'go', mode: 'aliyun' }
      },
      generatedAt: '2026-05-30T00:00:00.000Z'
    }));

    expect(markdown).toContain('阶段：preflight');
    expect(markdown).toContain('| 服务器只读盘点闸门 | go |');
  });
});
