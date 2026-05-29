import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createProxyServer, normalizeProxyPath } from './proxyServer.js';

const openServers = [];

const listen = (server) => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    openServers.push(server);
    const { port } = server.address();
    resolve(`http://127.0.0.1:${port}`);
  });
});

const closeServer = (server) => new Promise((resolve, reject) => {
  server.close((error) => (error ? reject(error) : resolve()));
});

const createUpstream = async () => {
  const requests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body
      });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, path: request.url }));
    });
  });
  const url = await listen(server);
  return { url, requests };
};

afterEach(async () => {
  while (openServers.length) {
    await closeServer(openServers.pop());
  }
});

describe('Aliyun API proxy', () => {
  it('normalizes both /api and /api/assessments routes to the upstream assessments contract', () => {
    expect(normalizeProxyPath('/api/draft')).toBe('/draft');
    expect(normalizeProxyPath('/api/records/abc/verification')).toBe('/records/abc/verification');
    expect(normalizeProxyPath('/api/assessments/records?limit=12')).toBe('/records?limit=12');
    expect(normalizeProxyPath('/api/assessments')).toBe('/');
  });

  it('proxies frontend requests without exposing the upstream API key to the browser', async () => {
    const upstream = await createUpstream();
    const proxy = createProxyServer({
      upstreamUrl: upstream.url,
      upstreamApiKey: 'server-side-publishable-key',
      allowedOrigins: ['http://credit.example.com']
    });
    const proxyUrl = await listen(proxy);

    const response = await fetch(`${proxyUrl}/api/draft`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://credit.example.com',
        'x-client-instance-id': 'client-123456'
      },
      body: JSON.stringify({ form: { institutionName: '杭州星澜医疗美容诊所' } })
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://credit.example.com');
    expect(await response.json()).toEqual({ ok: true, path: '/draft' });
    expect(upstream.requests).toHaveLength(1);
    expect(upstream.requests[0]).toMatchObject({
      method: 'PUT',
      url: '/draft',
      body: JSON.stringify({ form: { institutionName: '杭州星澜医疗美容诊所' } })
    });
    expect(upstream.requests[0].headers.apikey).toBe('server-side-publishable-key');
    expect(upstream.requests[0].headers['x-client-instance-id']).toBe('client-123456');
  });

  it('rejects unexpected browser origins before proxying', async () => {
    const upstream = await createUpstream();
    const proxy = createProxyServer({
      upstreamUrl: upstream.url,
      upstreamApiKey: 'server-side-publishable-key',
      allowedOrigins: ['http://credit.example.com']
    });
    const proxyUrl = await listen(proxy);

    const response = await fetch(`${proxyUrl}/api/records`, {
      headers: { Origin: 'http://evil.example.com' }
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Origin is not allowed.' });
    expect(upstream.requests).toHaveLength(0);
  });

  it('does not become an open browser proxy when allowed origins are not configured', async () => {
    const upstream = await createUpstream();
    const proxy = createProxyServer({
      upstreamUrl: upstream.url,
      upstreamApiKey: 'server-side-publishable-key',
      allowedOrigins: []
    });
    const proxyUrl = await listen(proxy);

    const response = await fetch(`${proxyUrl}/api/records`, {
      headers: { Origin: 'http://unknown.example.com' }
    });

    expect(response.status).toBe(403);
    expect(upstream.requests).toHaveLength(0);
  });

  it('allows server-side health checks without an Origin header', async () => {
    const upstream = await createUpstream();
    const proxy = createProxyServer({
      upstreamUrl: upstream.url,
      upstreamApiKey: 'server-side-publishable-key',
      allowedOrigins: []
    });
    const proxyUrl = await listen(proxy);

    const response = await fetch(`${proxyUrl}/api/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      mode: 'aliyun-proxy'
    });
  });

  it('handles CORS preflight locally', async () => {
    const upstream = await createUpstream();
    const proxy = createProxyServer({
      upstreamUrl: upstream.url,
      upstreamApiKey: 'server-side-publishable-key',
      allowedOrigins: ['http://credit.example.com']
    });
    const proxyUrl = await listen(proxy);

    const response = await fetch(`${proxyUrl}/api/records`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://credit.example.com',
        'Access-Control-Request-Method': 'POST'
      }
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://credit.example.com');
    expect(upstream.requests).toHaveLength(0);
  });
});
