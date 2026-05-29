export async function fetchAliyunHealth({
  baseUrl,
  timeoutMs = 30000,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!fetchImpl) throw new Error('Fetch API is not available in this Node.js runtime.');
  const response = await fetchWithTimeout(fetchImpl, `${normalizeBaseUrl(baseUrl)}/api/health`, { timeoutMs });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  return {
    status: response.status,
    ok: response.ok,
    payload,
    rawText: text
  };
}

export function validateAliyunHealth(payload, {
  expectReady = false,
  expectedMode = '',
  expectedBackendDatabase = '',
  expectStorageConfigured,
  expectVerificationConfigured
} = {}) {
  const errors = [];
  const objectPayload = payload && typeof payload === 'object' ? payload : {};

  if (objectPayload.ok !== true) {
    errors.push('/api/health payload.ok is not true.');
  }

  const expectedModes = splitExpectedValues(expectedMode);
  if (expectedModes.length && !expectedModes.includes(objectPayload.mode)) {
    errors.push(`Expected mode ${expectedModes.join(' or ')}, got ${objectPayload.mode || 'empty'}.`);
  }

  if (expectReady && objectPayload.ready !== true) {
    errors.push(`Expected ready=true, got ${String(objectPayload.ready)}.`);
  }

  if (expectedBackendDatabase && objectPayload.backend?.database !== expectedBackendDatabase) {
    errors.push(`Expected backend.database=${expectedBackendDatabase}, got ${objectPayload.backend?.database || 'empty'}.`);
  }

  if (typeof expectStorageConfigured === 'boolean' && Boolean(objectPayload.storage?.configured) !== expectStorageConfigured) {
    errors.push(`Expected storage.configured=${expectStorageConfigured}, got ${String(objectPayload.storage?.configured)}.`);
  }

  if (typeof expectVerificationConfigured === 'boolean' && Boolean(objectPayload.verification?.configured) !== expectVerificationConfigured) {
    errors.push(`Expected verification.configured=${expectVerificationConfigured}, got ${String(objectPayload.verification?.configured)}.`);
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: summarizeHealthPayload(objectPayload)
  };
}

export function buildHealthExpectationsFromEnv(env = process.env, prefix = 'HEALTH') {
  return {
    expectReady: parseOptionalBoolean(env[`${prefix}_EXPECT_READY`] ?? env[`${prefix}_EXPECT_API_READY`]) === true,
    expectedMode: env[`${prefix}_EXPECT_BACKEND_MODE`] || env[`${prefix}_EXPECT_MODE`] || '',
    expectedBackendDatabase: env[`${prefix}_EXPECT_BACKEND_DATABASE`] || '',
    expectStorageConfigured: parseOptionalBoolean(env[`${prefix}_EXPECT_STORAGE_CONFIGURED`]),
    expectVerificationConfigured: parseOptionalBoolean(env[`${prefix}_EXPECT_VERIFICATION_CONFIGURED`])
  };
}

export function parseOptionalBoolean(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

export function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

export function formatHealthDiagnostics(validation, payload) {
  return JSON.stringify({
    errors: validation.errors,
    summary: validation.summary,
    payload
  }, null, 2);
}

function summarizeHealthPayload(payload = {}) {
  return {
    ok: payload.ok,
    ready: payload.ready,
    mode: payload.mode,
    backend: summarizeComponent(payload.backend),
    storage: summarizeComponent(payload.storage),
    verification: summarizeComponent(payload.verification)
  };
}

function summarizeComponent(component = {}) {
  if (!component || typeof component !== 'object') return component;
  return {
    ok: component.ok,
    configured: component.configured,
    provider: component.provider,
    database: component.database,
    bucket: component.bucket,
    reason: component.reason,
    errorMessage: component.errorMessage
  };
}

function splitExpectedValues(value = '') {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function fetchWithTimeout(fetchImpl, url, { timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
