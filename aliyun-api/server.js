import { pathToFileURL } from 'node:url';
import { createAssessmentApiServer } from './apiServer.js';

const port = Number(process.env.PORT || process.env.MEDICAL_CREDIT_PROXY_PORT || 8787);
const host = process.env.MEDICAL_CREDIT_PROXY_HOST || '127.0.0.1';

export function startServer() {
  const server = createAssessmentApiServer({ env: process.env });

  server.listen(port, host, () => {
    console.log(`medical-credit-assessment API listening on http://${host}:${port}`);
  });

  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
