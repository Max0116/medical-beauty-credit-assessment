import {
  buildHealthExpectationsFromEnv,
  fetchAliyunHealth,
  formatHealthDiagnostics,
  normalizeBaseUrl,
  validateAliyunHealth
} from './aliyun-health.mjs';

const baseUrl = normalizeBaseUrl(process.env.HEALTH_BASE_URL || process.env.SMOKE_BASE_URL || 'http://101.132.137.25');
const timeoutMs = Number(process.env.HEALTH_TIMEOUT_MS || process.env.SMOKE_TIMEOUT_MS || 30000);
const health = await fetchAliyunHealth({ baseUrl, timeoutMs });

if (!health.ok) {
  throw new Error(`/api/health returned ${health.status}: ${String(health.rawText || '').slice(0, 240)}`);
}

const validation = validateAliyunHealth(health.payload, buildHealthExpectationsFromEnv(process.env, 'HEALTH'));
if (!validation.ok) {
  console.error(formatHealthDiagnostics(validation, health.payload));
  process.exit(1);
}

console.log(JSON.stringify({
  baseUrl,
  status: health.status,
  ...validation.summary
}, null, 2));
