import { createServer as createHttpServer } from 'node:http';

const DEFAULT_TIMEOUT_MS = 15000;
const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

export function parseAllowedOrigins(value = '') {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeProxyPath(path = '/') {
  const rawPath = String(path || '/');
  if (rawPath === '/api' || rawPath === '/api/') return '/';
  if (rawPath.startsWith('/api/assessments/')) return rawPath.slice('/api/assessments'.length);
  if (rawPath === '/api/assessments') return '/';
  if (rawPath.startsWith('/api/')) return rawPath.slice('/api'.length);
  return rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
}

export function createProxyServer(options = {}) {
  return createHttpServer(createProxyHandler(options));
}

export function createProxyHandler({
  upstreamUrl = process.env.ASSESSMENT_UPSTREAM_URL || '',
  upstreamApiKey = process.env.ASSESSMENT_UPSTREAM_API_KEY || '',
  allowedOrigins = parseAllowedOrigins(process.env.MEDICAL_CREDIT_ALLOWED_ORIGINS || ''),
  timeoutMs = Number(process.env.MEDICAL_CREDIT_PROXY_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
  fetchImpl = globalThis.fetch
} = {}) {
  const normalizedAllowedOrigins = parseAllowedOrigins(allowedOrigins);

  return async (request, response) => {
    const origin = request.headers.origin || '';
    const corsHeaders = getCorsHeaders(origin, normalizedAllowedOrigins);

    if (request.method === 'OPTIONS') {
      writeEmpty(response, 204, corsHeaders);
      return;
    }

    if (!isOriginAllowed(origin, normalizedAllowedOrigins)) {
      writeJson(response, 403, { error: 'Origin is not allowed.' }, corsHeaders);
      return;
    }

    try {
      const requestUrl = new URL(request.url || '/', 'http://medical-credit.local');
      if (requestUrl.pathname === '/api/health') {
        writeJson(response, 200, {
          ok: true,
          service: 'medical-credit-assessment-api',
          mode: 'aliyun-proxy',
          upstreamConfigured: Boolean(upstreamUrl),
          timestamp: new Date().toISOString()
        }, corsHeaders);
        return;
      }

      if (!requestUrl.pathname.startsWith('/api')) {
        writeJson(response, 404, { error: 'Not found.' }, corsHeaders);
        return;
      }

      if (!upstreamUrl) {
        writeJson(response, 500, { error: 'ASSESSMENT_UPSTREAM_URL is not configured.' }, corsHeaders);
        return;
      }
      if (!upstreamApiKey) {
        writeJson(response, 500, { error: 'ASSESSMENT_UPSTREAM_API_KEY is not configured.' }, corsHeaders);
        return;
      }
      if (!fetchImpl) {
        writeJson(response, 500, { error: 'Fetch API is not available in this Node.js runtime.' }, corsHeaders);
        return;
      }

      const upstreamResponse = await proxyToUpstream({
        request,
        upstreamUrl,
        upstreamApiKey,
        timeoutMs,
        fetchImpl
      });
      await writeUpstreamResponse(response, upstreamResponse, corsHeaders);
    } catch (error) {
      writeJson(response, 502, { error: formatErrorMessage(error) }, corsHeaders);
    }
  };
}

async function proxyToUpstream({ request, upstreamUrl, upstreamApiKey, timeoutMs, fetchImpl }) {
  const proxyPath = normalizeProxyPath(request.url || '/');
  const targetUrl = `${normalizeBaseUrl(upstreamUrl)}${proxyPath}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS);

  try {
    const headers = buildUpstreamHeaders(request.headers, upstreamApiKey);
    const body = ['GET', 'HEAD'].includes(request.method || 'GET')
      ? undefined
      : await readRequestBody(request);

    return await fetchImpl(targetUrl, {
      method: request.method,
      headers,
      body,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function buildUpstreamHeaders(requestHeaders, upstreamApiKey) {
  const headers = {
    apikey: upstreamApiKey,
    'x-client-instance-id': requestHeaders['x-client-instance-id'] || ''
  };

  if (requestHeaders['content-type']) {
    headers['content-type'] = requestHeaders['content-type'];
  }
  if (requestHeaders.authorization) {
    headers.authorization = requestHeaders.authorization;
  }
  return headers;
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('error', reject);
    request.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

async function writeUpstreamResponse(response, upstreamResponse, corsHeaders) {
  const body = Buffer.from(await upstreamResponse.arrayBuffer());
  const headers = {
    ...corsHeaders,
    'Content-Type': upstreamResponse.headers.get('content-type') || JSON_CONTENT_TYPE
  };
  response.writeHead(upstreamResponse.status, headers);
  response.end(body);
}

function isOriginAllowed(origin, allowedOrigins) {
  if (!origin) return true;
  if (!allowedOrigins.length) return false;
  return allowedOrigins.includes('*') || allowedOrigins.includes(origin);
}

function getCorsHeaders(origin, allowedOrigins) {
  const allowOrigin = allowedOrigins.includes('*')
    ? '*'
    : allowedOrigins.includes(origin)
      ? origin
      : allowedOrigins[0] || '*';

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-client-instance-id',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '600'
  };
}

function writeJson(response, status, body, headers = {}) {
  response.writeHead(status, { ...headers, 'Content-Type': JSON_CONTENT_TYPE });
  response.end(JSON.stringify(body));
}

function writeEmpty(response, status, headers = {}) {
  response.writeHead(status, headers);
  response.end();
}

function normalizeBaseUrl(value = '') {
  return String(value).trim().replace(/\/+$/, '');
}

function formatErrorMessage(error) {
  if (error?.name === 'AbortError') return 'Upstream assessment API timed out.';
  if (error instanceof Error) return error.message;
  return String(error || 'Upstream assessment API failed.');
}
