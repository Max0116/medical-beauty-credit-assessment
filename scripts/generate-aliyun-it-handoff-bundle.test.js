import { describe, expect, it, vi } from 'vitest';
import {
  buildAliyunItHandoffFiles,
  buildAliyunItHandoffOptions,
  runAliyunItHandoffBundleGenerator
} from './generate-aliyun-it-handoff-bundle.mjs';

describe('Aliyun IT handoff bundle generator', () => {
  it('builds a reviewable handoff bundle without real secrets', () => {
    const bundle = buildAliyunItHandoffFiles({
      name: 'handoff-test',
      generatedAt: '2026-05-30T04:00:00.000Z',
      domain: 'credit.example.cn',
      driver: 'mysql',
      allowedOrigin: 'https://credit.example.cn',
      h5Root: '/www/wwwroot/medical-credit-assessment/current',
      apiRoot: '/www/wwwroot/medical-credit-api/current',
      apiUpstream: 'http://127.0.0.1:8787/api/',
      sslCertificate: '/www/server/panel/vhost/cert/credit.example.cn/fullchain.pem',
      sslCertificateKey: '/www/server/panel/vhost/cert/credit.example.cn/privkey.pem',
      mysqlDatabase: 'medical_credit_assessment',
      mysqlUser: 'medical_credit_app',
      mysqlUserHost: '<reviewed-mysql-user-host>',
      bucket: 'medical-credit-verification-evidence',
      region: 'oss-cn-shanghai',
      prefix: 'verification-evidence/'
    });

    expect(bundle.manifest.decision).toBe('go');
    expect(Object.keys(bundle.files)).toEqual(expect.arrayContaining([
      'README.md',
      'api.env.template',
      'mysql-bootstrap.template.sql',
      'oss-ram-policy.json',
      'oss-setup.md',
      'nginx-medical-credit.conf',
      'commands.md',
      'manifest.json'
    ]));
    expect(bundle.files['api.env.template']).toContain('MEDICAL_CREDIT_BACKEND_MODE=dual_write');
    expect(bundle.files['api.env.template']).toContain('ALIYUN_DB_DRIVER=mysql');
    expect(bundle.files['mysql-bootstrap.template.sql']).toContain('medical_credit_assessment');
    expect(bundle.files['mysql-bootstrap.template.sql']).not.toContain('gohomesh');
    expect(bundle.files['oss-ram-policy.json']).toContain('verification-evidence/*');
    expect(bundle.files['oss-ram-policy.json']).not.toContain('DeleteObject');
    expect(bundle.files['nginx-medical-credit.conf']).toContain('server_name credit.example.cn;');
    expect(bundle.files['README.md']).not.toContain('ZHIPUAI_API_KEY=');
  });

  it('blocks bare IP handoff domains before generating a vhost', () => {
    const bundle = buildAliyunItHandoffFiles({
      domain: '101.132.137.25',
      sslCertificate: '/www/server/panel/vhost/cert/101.132.137.25/fullchain.pem',
      sslCertificateKey: '/www/server/panel/vhost/cert/101.132.137.25/privkey.pem'
    });

    expect(bundle.manifest.decision).toBe('blocked');
    expect(bundle.manifest.blockers.join('\n')).toContain('Bare IP');
    expect(bundle.files['nginx-medical-credit.conf']).toBe('');
  });

  it('keeps placeholder domains as manual review instead of go', () => {
    const bundle = buildAliyunItHandoffFiles();

    expect(bundle.manifest.decision).toBe('manual_review');
    expect(bundle.manifest.warnings.join('\n')).toContain('credit.example.com');
  });

  it('blocks unsupported database drivers', () => {
    const bundle = buildAliyunItHandoffFiles({
      domain: 'credit.example.cn',
      driver: 'oracle',
      allowedOrigin: 'https://credit.example.cn',
      sslCertificate: '/www/server/panel/vhost/cert/credit.example.cn/fullchain.pem',
      sslCertificateKey: '/www/server/panel/vhost/cert/credit.example.cn/privkey.pem'
    });

    expect(bundle.manifest.decision).toBe('blocked');
    expect(bundle.manifest.blockers.join('\n')).toContain('Unsupported handoff database driver');
  });

  it('derives deterministic output options from env', () => {
    const options = buildAliyunItHandoffOptions({
      ALIYUN_HANDOFF_OUTPUT_ROOT: 'release/custom-handoff',
      ALIYUN_HANDOFF_DOMAIN: 'credit.company.cn',
      ALIYUN_DB_DRIVER: 'postgresql'
    }, {
      now: new Date('2026-05-30T04:05:06.000Z')
    });

    expect(options.outputDir).toBe('release/custom-handoff/medical-credit-aliyun-handoff-20260530T040506Z');
    expect(options.domain).toBe('credit.company.cn');
    expect(options.driver).toBe('postgres');
    expect(options.allowedOrigin).toBe('https://credit.company.cn');
  });

  it('writes all bundle files to the requested output directory', async () => {
    const writes = new Map();
    const mkdirImpl = vi.fn();
    const writeFileImpl = vi.fn(async (filePath, content) => {
      writes.set(filePath, content);
    });

    const result = await runAliyunItHandoffBundleGenerator({
      options: {
        ...buildAliyunItHandoffOptions({}, { now: new Date('2026-05-30T04:10:00.000Z') }),
        outputDir: '/tmp/handoff',
        domain: 'credit.example.cn',
        allowedOrigin: 'https://credit.example.cn',
        sslCertificate: '/www/server/panel/vhost/cert/credit.example.cn/fullchain.pem',
        sslCertificateKey: '/www/server/panel/vhost/cert/credit.example.cn/privkey.pem'
      },
      mkdirImpl,
      writeFileImpl
    });

    expect(result.outputDir).toBe('/tmp/handoff');
    expect(result.manifest.decision).toBe('go');
    expect(mkdirImpl).toHaveBeenCalledWith('/tmp/handoff', { recursive: true });
    expect([...writes.keys()]).toEqual(expect.arrayContaining([
      '/tmp/handoff/README.md',
      '/tmp/handoff/api.env.template',
      '/tmp/handoff/mysql-bootstrap.template.sql',
      '/tmp/handoff/manifest.json'
    ]));
  });
});
