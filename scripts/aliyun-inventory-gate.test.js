import { describe, expect, it, vi } from 'vitest';
import {
  evaluateInventoryGate,
  readAndEvaluateInventoryGate,
  renderInventoryGateMarkdown
} from './aliyun-inventory-gate.mjs';

const baseReport = {
  generatedAt: '2026-05-29T18:40:00.000Z',
  sourceFile: '/tmp/inventory.log',
  counts: { ok: 10, warn: 0, fail: 0 },
  signals: {
    nginxTest: 'passed',
    targetPort: 'free',
    domesticOutbound: 'ok',
    zhipuOutbound: 'ok',
    medicalCreditService: 'not_registered',
    pm2: 'missing'
  },
  recommendations: ['未发现明显阻断项；继续创建 `.env` 并执行 PR23 preflight。']
};

describe('Aliyun inventory deployment gate', () => {
  it('allows continuing when the read-only inventory has no blockers', () => {
    const gate = evaluateInventoryGate(baseReport);

    expect(gate).toMatchObject({
      ok: true,
      decision: 'go',
      blockers: [],
      warnings: []
    });
  });

  it('blocks deployment for dangerous server states', () => {
    const gate = evaluateInventoryGate({
      ...baseReport,
      counts: { ok: 4, warn: 1, fail: 1 },
      signals: {
        ...baseReport.signals,
        nginxTest: 'failed',
        targetPort: 'occupied',
        domesticOutbound: 'warning'
      }
    });

    expect(gate.ok).toBe(false);
    expect(gate.decision).toBe('blocked');
    expect(gate.blockers).toEqual([
      '只读盘点存在 FAIL 项，必须先排查。',
      '现有 Nginx 配置检查失败，不能继续部署。',
      '默认 API 端口 8787 已被占用，需要先确定替代端口。',
      '国内 HTTPS 出网异常，可能影响部署依赖安装和健康检查。'
    ]);
  });

  it('requires manual review for uncertain but not immediately blocking states', () => {
    const gate = evaluateInventoryGate({
      ...baseReport,
      signals: {
        ...baseReport.signals,
        nginxTest: 'unknown',
        zhipuOutbound: 'warning',
        medicalCreditService: 'exists'
      }
    });

    expect(gate.ok).toBe(false);
    expect(gate.decision).toBe('manual_review');
    expect(gate.warnings).toEqual([
      '未确认 Nginx 配置检查结果，需要 IT 确认。',
      '智谱 API 出网异常，联网核验可能失败。',
      '服务器上已存在 medical-credit-api.service，需确认是否为本项目历史服务，避免覆盖未知服务。'
    ]);
  });

  it('renders markdown and writes optional gate outputs', async () => {
    const writes = new Map();
    const writeFileImpl = vi.fn(async (filePath, content) => {
      writes.set(filePath, content);
    });

    const gate = await readAndEvaluateInventoryGate({
      inputFile: '/tmp/report.json',
      outputFile: '/tmp/gate.json',
      markdownOutputFile: '/tmp/gate.md',
      readFileImpl: async () => JSON.stringify(baseReport),
      writeFileImpl
    });
    const markdown = renderInventoryGateMarkdown(gate);

    expect(gate.decision).toBe('go');
    expect(writes.get('/tmp/gate.json')).toContain('"decision": "go"');
    expect(writes.get('/tmp/gate.md')).toContain('PR23 阿里云部署闸门判断');
    expect(markdown).toContain('判断：可以进入下一步');
  });
});
