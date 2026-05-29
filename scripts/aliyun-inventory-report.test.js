import { describe, expect, it, vi } from 'vitest';
import {
  parseInventoryOutput,
  redactSensitiveText,
  renderInventoryMarkdown,
  writeInventoryReport
} from './format-aliyun-inventory-report.mjs';

const sampleInventory = `
== Host ==
OK   hostname: aliyun-host

== Nginx ==
OK   nginx -t passed

== Candidate isolated target paths ==
OK   /var/www/medical-credit is not present yet
OK   /var/www/medical-credit-api is not present yet

== medical-credit target port ==
OK   127.0.0.1:8787 appears free according to lsof

== System services ==
OK   medical-credit-api.service is not registered yet

== PM2 ==
WARN pm2 missing or not in PATH

== Outbound network ==
OK   domestic HTTPS outbound works
OK   Zhipu endpoint appears reachable

== Environment file presence only ==
OK   /var/www/medical-credit-api/.env exists; contents intentionally not printed
  - ZHIPUAI_API_KEY=real-secret-value
`;

describe('Aliyun inventory report formatter', () => {
  it('redacts sensitive assignments before rendering reports', () => {
    const redacted = redactSensitiveText('ZHIPUAI_API_KEY=abc123\nurl=https://x.test?token=secret');

    expect(redacted).toContain('ZHIPUAI_API_KEY=<redacted>');
    expect(redacted).toContain('token=<redacted>');
    expect(redacted).not.toContain('abc123');
    expect(redacted).not.toContain('secret');
  });

  it('parses key server inventory signals', () => {
    const report = parseInventoryOutput(sampleInventory, {
      generatedAt: '2026-05-29T18:20:00.000Z',
      sourceFile: '/tmp/inventory.log'
    });

    expect(report.counts).toMatchObject({ ok: 9, warn: 1, fail: 0 });
    expect(report.signals).toMatchObject({
      nginxTest: 'passed',
      targetPort: 'free',
      domesticOutbound: 'ok',
      zhipuOutbound: 'ok',
      medicalCreditService: 'not_registered',
      pm2: 'missing'
    });
    expect(report.signals.candidatePaths).toContain('OK   /var/www/medical-credit is not present yet');
    expect(JSON.stringify(report)).not.toContain('real-secret-value');
  });

  it('renders a concise markdown report with recommendations', () => {
    const report = parseInventoryOutput(sampleInventory, {
      generatedAt: '2026-05-29T18:20:00.000Z',
      sourceFile: '/tmp/inventory.log'
    });
    const markdown = renderInventoryMarkdown(report);

    expect(markdown).toContain('# PR23 阿里云服务器只读盘点报告');
    expect(markdown).toContain('| API 目标端口 | 空闲 |');
    expect(markdown).toContain('未发现明显阻断项');
    expect(markdown).not.toContain('real-secret-value');
  });

  it('writes JSON and Markdown reports', async () => {
    const writes = new Map();
    const mkdirImpl = vi.fn(async () => undefined);
    const writeFileImpl = vi.fn(async (filePath, content) => {
      writes.set(filePath, content);
    });

    const result = await writeInventoryReport({
      inputFile: '/tmp/inventory.log',
      outputDir: '/tmp/out',
      reportBaseName: 'inventory-report',
      generatedAt: '2026-05-29T18:20:00.000Z',
      readFileImpl: async () => sampleInventory,
      writeFileImpl,
      mkdirImpl
    });

    expect(result.jsonPath).toBe('/tmp/out/inventory-report.json');
    expect(result.markdownPath).toBe('/tmp/out/inventory-report.md');
    expect(mkdirImpl).toHaveBeenCalledWith('/tmp/out', { recursive: true });
    expect(writes.get('/tmp/out/inventory-report.json')).toContain('"targetPort": "free"');
    expect(writes.get('/tmp/out/inventory-report.md')).toContain('PR23 阿里云服务器只读盘点报告');
  });
});
