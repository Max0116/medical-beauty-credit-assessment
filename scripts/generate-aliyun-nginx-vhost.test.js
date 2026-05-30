import { describe, expect, it, vi } from 'vitest';
import {
  renderNginxVhost,
  validateVhostOptions,
  writeGeneratedNginxVhost
} from './generate-aliyun-nginx-vhost.mjs';

describe('Aliyun Nginx vhost generator', () => {
  it('renders an isolated HTTP vhost for an approved medical-credit domain', () => {
    const config = renderNginxVhost({
      serverName: 'credit.example.com'
    });

    expect(config).toContain('server_name credit.example.com;');
    expect(config).toContain('root /www/wwwroot/medical-credit-assessment/current;');
    expect(config).toContain('proxy_pass http://127.0.0.1:8787/api/;');
    expect(config).toContain('try_files $uri $uri/ /index.html;');
  });

  it('renders HTTPS redirect and SSL server when certificate paths are provided', () => {
    const config = renderNginxVhost({
      serverName: 'credit.example.com',
      mode: 'https',
      sslCertificate: '/www/server/panel/vhost/cert/credit.example.com/fullchain.pem',
      sslCertificateKey: '/www/server/panel/vhost/cert/credit.example.com/privkey.pem'
    });

    expect(config).toContain('return 301 https://$host$request_uri;');
    expect(config).toContain('listen 443 ssl http2;');
    expect(config).toContain('ssl_certificate /www/server/panel/vhost/cert/credit.example.com/fullchain.pem;');
    expect(config).toContain('ssl_certificate_key /www/server/panel/vhost/cert/credit.example.com/privkey.pem;');
  });

  it('refuses bare IP server names by default', () => {
    const validation = validateVhostOptions({
      serverName: '101.132.137.25'
    });

    expect(validation.ok).toBe(false);
    expect(validation.errors).toContain('Bare IP server_name is not allowed; ask IT for an independent备案子域名 such as credit.xxx.com.');
  });

  it('refuses non-local upstreams and non-approved roots', () => {
    const validation = validateVhostOptions({
      serverName: 'credit.example.com',
      h5Root: '/www/wwwroot/hear-us',
      apiUpstream: 'https://example.supabase.co/functions/v1/assessments/'
    });

    expect(validation.ok).toBe(false);
    expect(validation.errors).toContain('H5 root is not approved: /www/wwwroot/hear-us');
    expect(validation.errors).toContain('API upstream must be a local medical-credit API endpoint like http://127.0.0.1:8787/api/.');
  });

  it('writes generated config to an optional output file', async () => {
    const writeFileImpl = vi.fn(async () => undefined);
    const result = await writeGeneratedNginxVhost({
      outputFile: '/tmp/credit.example.com.conf',
      options: { serverName: 'credit.example.com' },
      writeFileImpl
    });

    expect(result.outputFile).toBe('/tmp/credit.example.com.conf');
    expect(writeFileImpl).toHaveBeenCalledWith('/tmp/credit.example.com.conf', expect.stringContaining('server_name credit.example.com;'));
  });
});
