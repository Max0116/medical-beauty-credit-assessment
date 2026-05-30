import { describe, expect, it, vi } from 'vitest';
import {
  buildOssPolicyOptionsFromEnv,
  buildOssRamPolicy,
  evaluateOssPolicyConfig,
  renderOssSetupMarkdown,
  runOssPolicyGenerator
} from './generate-aliyun-oss-policy.mjs';

describe('Aliyun OSS policy generator', () => {
  it('builds a least-privilege RAM policy scoped to the evidence prefix', () => {
    const policy = buildOssRamPolicy({
      bucket: 'medical-credit-verification-evidence',
      prefix: 'verification-evidence/'
    });

    expect(policy).toEqual({
      Version: '1',
      Statement: [
        {
          Effect: 'Allow',
          Action: ['oss:PutObject', 'oss:GetObject', 'oss:GetObjectMeta', 'oss:HeadObject'],
          Resource: ['acs:oss:*:*:medical-credit-verification-evidence/verification-evidence/*']
        },
        {
          Effect: 'Allow',
          Action: ['oss:GetBucketInfo'],
          Resource: ['acs:oss:*:*:medical-credit-verification-evidence']
        }
      ]
    });
    expect(JSON.stringify(policy)).not.toContain('DeleteObject');
    expect(JSON.stringify(policy)).not.toContain('ListBuckets');
  });

  it('blocks invalid bucket and prefix values', () => {
    const report = evaluateOssPolicyConfig({
      bucket: 'Medical_Credit',
      region: 'cn-shanghai',
      prefix: '../secret'
    });

    expect(report.decision).toBe('blocked');
    expect(report.blockers.join('\n')).toContain('OSS bucket name is invalid');
    expect(report.blockers.join('\n')).toContain('OSS region is invalid');
    expect(report.blockers.join('\n')).toContain('OSS object prefix must contain only');
  });

  it('warns when the bucket or prefix differs from application defaults', () => {
    const report = evaluateOssPolicyConfig({
      bucket: 'other-medical-credit-bucket',
      region: 'oss-cn-shanghai',
      prefix: 'custom-prefix/'
    });

    expect(report.decision).toBe('manual_review');
    expect(report.warnings.join('\n')).toContain('Bucket name differs');
    expect(report.warnings.join('\n')).toContain('Object prefix differs');
  });

  it('renders Markdown handoff without secrets or broad permissions', () => {
    const markdown = renderOssSetupMarkdown({
      bucket: 'medical-credit-verification-evidence',
      region: 'oss-cn-shanghai',
      prefix: 'verification-evidence/',
      generatedAt: '2026-05-30T00:00:00.000Z'
    });

    expect(markdown).toContain('PR23 阿里云 OSS / RAM 最小权限配置');
    expect(markdown).toContain('medical-credit-verification-evidence/verification-evidence/*');
    expect(markdown).not.toContain('ACCESS_KEY_SECRET');
    const policyJson = markdown.match(/```json\n([\s\S]+?)\n```/)?.[1] || '';
    expect(policyJson).not.toContain('oss:DeleteObject');
  });

  it('writes JSON and Markdown outputs with restricted file mode', async () => {
    const writeFileImpl = vi.fn();
    const result = await runOssPolicyGenerator({
      policyOutputFile: '/tmp/oss-policy.json',
      markdownOutputFile: '/tmp/oss-policy.md',
      writeFileImpl,
      options: {
        bucket: 'medical-credit-verification-evidence',
        region: 'oss-cn-shanghai',
        prefix: 'verification-evidence/'
      }
    });

    expect(result.report.decision).toBe('go');
    expect(result.policy).toBeNull();
    expect(result.markdown).toBe('');
    expect(writeFileImpl).toHaveBeenCalledWith(
      '/tmp/oss-policy.json',
      expect.stringContaining('oss:PutObject'),
      { mode: 0o600 }
    );
    expect(writeFileImpl).toHaveBeenCalledWith(
      '/tmp/oss-policy.md',
      expect.stringContaining('控制台操作清单'),
      { mode: 0o600 }
    );
  });

  it('maps environment variables into generator options', () => {
    const options = buildOssPolicyOptionsFromEnv({
      ALIYUN_OSS_BUCKET: 'medical-credit-verification-evidence',
      ALIYUN_OSS_REGION: 'oss-cn-shanghai',
      ALIYUN_OSS_POLICY_PREFIX: 'verification-evidence',
      ALIYUN_OSS_POLICY_NAME: 'custom-policy'
    });

    expect(options).toEqual({
      bucket: 'medical-credit-verification-evidence',
      region: 'oss-cn-shanghai',
      prefix: 'verification-evidence',
      policyName: 'custom-policy'
    });
  });
});
