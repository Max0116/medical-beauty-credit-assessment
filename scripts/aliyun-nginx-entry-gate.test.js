import { describe, expect, it, vi } from 'vitest';
import {
  evaluateNginxEntryGate,
  parseNginxServerBlocks,
  readAndEvaluateNginxEntryGate,
  renderNginxEntryGateMarkdown
} from './aliyun-nginx-entry-gate.mjs';

const conflictingNginxDump = `
# configuration file /www/server/panel/vhost/nginx/hear-us.conf:
server {
    listen 80;
    server_name 101.132.137.25 _;
    access_log /www/wwwroot/hear-us/logs/access.log;
    location / {
        proxy_pass http://127.0.0.1:3010;
    }
}

# configuration file /www/server/panel/vhost/nginx/html_101.132.137.25.conf:
server {
    listen 80;
    server_name 101.132.137.25;
    root /www/wwwroot/medical-credit-assessment;
    location = /api/health {
        return 200 '{"ok":true,"service":"medical-credit-assessment"}';
    }
    location /api/ {
        proxy_pass https://example.supabase.co/functions/v1/assessments/;
    }
}
`;

const isolatedCreditDomainDump = `
# configuration file /www/server/panel/vhost/nginx/credit.example.com.conf:
server {
    listen 80;
    server_name credit.example.com;
    root /www/wwwroot/medical-credit-assessment/current;
    location /api/ {
        proxy_pass http://127.0.0.1:8787/api/;
    }
}
`;

describe('Aliyun Nginx entry gate', () => {
  it('parses server blocks from nginx -T output', () => {
    const blocks = parseNginxServerBlocks(conflictingNginxDump);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      file: '/www/server/panel/vhost/nginx/hear-us.conf',
      listen: ['80'],
      containsHearUs: true,
      containsMedicalCredit: false
    });
    expect(blocks[1]).toMatchObject({
      file: '/www/server/panel/vhost/nginx/html_101.132.137.25.conf',
      serverNames: ['101.132.137.25'],
      containsMedicalCredit: true
    });
  });

  it('blocks when the target IP is duplicated by hear-us and medical-credit', () => {
    const gate = evaluateNginxEntryGate(conflictingNginxDump, {
      targetServerNames: ['101.132.137.25'],
      generatedAt: '2026-05-30T01:36:50.000Z',
      sourceFile: '/tmp/nginx-T.txt'
    });

    expect(gate.decision).toBe('blocked');
    expect(gate.ok).toBe(false);
    expect(gate.summary.conflictCount).toBe(1);
    expect(gate.blockers).toEqual([
      '目标入口 101.132.137.25 存在重复 server_name 配置，切换前必须拆分独立域名或清理冲突。',
      '目标入口 101.132.137.25 当前命中了非 medical-credit 项目，禁止直接切换。',
      'medical-credit 相关 vhost 存在 server_name 冲突，Nginx 可能会忽略其中一个配置。'
    ]);
    expect(gate.conflicts[0].blocks.some((block) => block.containsHearUs)).toBe(true);
    expect(gate.conflicts[0].blocks.some((block) => block.containsMedicalCredit)).toBe(true);
  });

  it('allows an isolated credit domain that points only to medical-credit', () => {
    const gate = evaluateNginxEntryGate(isolatedCreditDomainDump, {
      targetServerNames: ['credit.example.com']
    });

    expect(gate).toMatchObject({
      ok: true,
      decision: 'go',
      blockers: [],
      warnings: []
    });
  });

  it('requires manual review when the requested domain is not configured yet', () => {
    const gate = evaluateNginxEntryGate(isolatedCreditDomainDump, {
      targetServerNames: ['credit.missing.example']
    });

    expect(gate.ok).toBe(false);
    expect(gate.decision).toBe('manual_review');
    expect(gate.warnings).toContain('目标入口 credit.missing.example 尚未出现在 Nginx server_name 中，需要 IT 创建独立 vhost。');
  });

  it('renders markdown and writes optional outputs', async () => {
    const writes = new Map();
    const writeFileImpl = vi.fn(async (filePath, content) => {
      writes.set(filePath, content);
    });

    const gate = await readAndEvaluateNginxEntryGate({
      inputFile: '/tmp/nginx-T.txt',
      targetServerNames: ['101.132.137.25'],
      outputFile: '/tmp/nginx-gate.json',
      markdownOutputFile: '/tmp/nginx-gate.md',
      readFileImpl: async () => conflictingNginxDump,
      writeFileImpl
    });
    const markdown = renderNginxEntryGateMarkdown(gate);

    expect(gate.decision).toBe('blocked');
    expect(writes.get('/tmp/nginx-gate.json')).toContain('"decision": "blocked"');
    expect(writes.get('/tmp/nginx-gate.md')).toContain('PR23 Nginx 入口归属闸门');
    expect(markdown).toContain('暂停切换');
  });
});
