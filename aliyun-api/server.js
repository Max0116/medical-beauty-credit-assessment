import { pathToFileURL } from 'node:url';
import { createProxyServer, parseAllowedOrigins } from './proxyServer.js';

const port = Number(process.env.PORT || process.env.MEDICAL_CREDIT_PROXY_PORT || 8787);
const host = process.env.MEDICAL_CREDIT_PROXY_HOST || '127.0.0.1';

export function startServer() {
  const server = createProxyServer({
    upstreamUrl: process.env.ASSESSMENT_UPSTREAM_URL || '',
    upstreamApiKey: process.env.ASSESSMENT_UPSTREAM_API_KEY || '',
    allowedOrigins: parseAllowedOrigins(process.env.MEDICAL_CREDIT_ALLOWED_ORIGINS || ''),
    timeoutMs: Number(process.env.MEDICAL_CREDIT_PROXY_TIMEOUT_MS || 15000)
  });

  server.listen(port, host, () => {
    console.log(`medical-credit-assessment API proxy listening on http://${host}:${port}`);
  });

  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
