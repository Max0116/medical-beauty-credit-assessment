import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const DEFAULT_H5_ROOT = '/www/wwwroot/medical-credit-assessment/current';
const DEFAULT_API_UPSTREAM = 'http://127.0.0.1:8787/api/';
const APPROVED_H5_ROOTS = new Set([
  '/www/wwwroot/medical-credit-assessment/current',
  '/var/www/medical-credit/current'
]);

export function validateVhostOptions(options = {}) {
  const normalized = normalizeVhostOptions(options);
  const errors = [];

  if (!normalized.serverName) {
    errors.push('NGINX_SERVER_NAME is required.');
  } else {
    if (normalized.serverName === '_' || normalized.serverName.includes('*')) {
      errors.push('Wildcard or catch-all server_name is not allowed for medical-credit.');
    }
    if (isIpAddress(normalized.serverName) && !normalized.allowIpServerName) {
      errors.push('Bare IP server_name is not allowed; ask IT for an independent备案子域名 such as credit.xxx.com.');
    }
    if (!/^[a-z0-9.-]+$/i.test(normalized.serverName)) {
      errors.push('server_name must contain only letters, numbers, dots, and hyphens.');
    }
  }

  if (!APPROVED_H5_ROOTS.has(normalized.h5Root)) {
    errors.push(`H5 root is not approved: ${normalized.h5Root}`);
  }

  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}\/api\/$/i.test(normalized.apiUpstream)) {
    errors.push('API upstream must be a local medical-credit API endpoint like http://127.0.0.1:8787/api/.');
  }

  if (!['http', 'https'].includes(normalized.mode)) {
    errors.push('NGINX_MODE must be http or https.');
  }

  if (normalized.mode === 'https') {
    if (!normalized.sslCertificate) errors.push('NGINX_SSL_CERTIFICATE is required for https mode.');
    if (!normalized.sslCertificateKey) errors.push('NGINX_SSL_CERTIFICATE_KEY is required for https mode.');
  }

  return {
    ok: errors.length === 0,
    errors,
    options: normalized
  };
}

export function renderNginxVhost(options = {}) {
  const validation = validateVhostOptions(options);
  if (!validation.ok) {
    throw new Error(validation.errors.join('\n'));
  }

  const opts = validation.options;
  if (opts.mode === 'https') {
    return [
      renderHttpRedirectServer(opts),
      '',
      renderHttpsServer(opts),
      ''
    ].join('\n');
  }

  return `${renderHttpServer(opts)}\n`;
}

export async function writeGeneratedNginxVhost({
  options,
  outputFile,
  writeFileImpl = writeFile
} = {}) {
  const content = renderNginxVhost(options);
  if (outputFile) {
    await writeFileImpl(outputFile, content);
  }
  return {
    outputFile: outputFile || '',
    content
  };
}

function renderHttpServer(opts) {
  return [
    'server {',
    '  listen 80;',
    `  server_name ${opts.serverName};`,
    '',
    ...indentServerBody(renderSharedServerBody(opts)),
    '}'
  ].join('\n');
}

function renderHttpRedirectServer(opts) {
  return [
    'server {',
    '  listen 80;',
    `  server_name ${opts.serverName};`,
    '',
    '  return 301 https://$host$request_uri;',
    '}'
  ].join('\n');
}

function renderHttpsServer(opts) {
  return [
    'server {',
    '  listen 443 ssl http2;',
    `  server_name ${opts.serverName};`,
    '',
    `  ssl_certificate ${opts.sslCertificate};`,
    `  ssl_certificate_key ${opts.sslCertificateKey};`,
    '  ssl_session_timeout 10m;',
    '  ssl_protocols TLSv1.2 TLSv1.3;',
    '  ssl_ciphers HIGH:!aNULL:!MD5;',
    '',
    ...indentServerBody(renderSharedServerBody(opts)),
    '}'
  ].join('\n');
}

function renderSharedServerBody(opts) {
  return [
    `root ${opts.h5Root};`,
    'index index.html;',
    '',
    'client_max_body_size 12m;',
    '',
    'location = /api/health {',
    `  proxy_pass ${opts.apiUpstream.replace(/\/api\/$/, '/api/health')};`,
    '  proxy_http_version 1.1;',
    '  proxy_set_header Host $host;',
    '  proxy_set_header X-Real-IP $remote_addr;',
    '  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
    '  proxy_set_header X-Forwarded-Proto $scheme;',
    '}',
    '',
    'location /api/ {',
    `  proxy_pass ${opts.apiUpstream};`,
    '  proxy_http_version 1.1;',
    '  proxy_set_header Host $host;',
    '  proxy_set_header X-Real-IP $remote_addr;',
    '  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
    '  proxy_set_header X-Forwarded-Proto $scheme;',
    '  proxy_connect_timeout 10s;',
    '  proxy_send_timeout 60s;',
    '  proxy_read_timeout 60s;',
    '}',
    '',
    'location / {',
    '  try_files $uri $uri/ /index.html;',
    '}'
  ];
}

function normalizeVhostOptions(options = {}) {
  return {
    serverName: String(options.serverName || '').trim().toLowerCase(),
    h5Root: String(options.h5Root || DEFAULT_H5_ROOT).trim().replace(/\/$/, ''),
    apiUpstream: ensureTrailingSlash(String(options.apiUpstream || DEFAULT_API_UPSTREAM).trim()),
    mode: String(options.mode || 'http').trim().toLowerCase(),
    sslCertificate: String(options.sslCertificate || '').trim(),
    sslCertificateKey: String(options.sslCertificateKey || '').trim(),
    allowIpServerName: options.allowIpServerName === true || options.allowIpServerName === 'yes'
  };
}

function indentServerBody(lines = []) {
  return lines.map((line) => (line ? `  ${line}` : ''));
}

function ensureTrailingSlash(value) {
  return value.endsWith('/') ? value : `${value}/`;
}

function isIpAddress(value) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const options = {
    serverName: process.env.NGINX_SERVER_NAME || process.argv[2],
    h5Root: process.env.NGINX_H5_ROOT,
    apiUpstream: process.env.NGINX_API_UPSTREAM,
    mode: process.env.NGINX_MODE,
    sslCertificate: process.env.NGINX_SSL_CERTIFICATE,
    sslCertificateKey: process.env.NGINX_SSL_CERTIFICATE_KEY,
    allowIpServerName: process.env.NGINX_ALLOW_IP_SERVER_NAME
  };
  const outputFile = process.env.NGINX_OUTPUT_FILE;
  const result = await writeGeneratedNginxVhost({ options, outputFile });
  if (outputFile) {
    console.log(JSON.stringify({ outputFile }, null, 2));
  } else {
    process.stdout.write(result.content);
  }
}
