import { DEFAULT_FORM } from './riskEngine';

export const STORAGE_KEYS = {
  draft: 'medicalBeautyCreditAssessment:lastDraft',
  history: 'medicalBeautyCreditAssessment:history',
  clientInstanceId: 'medicalBeautyCreditAssessment:clientInstanceId'
};

const DEFAULT_MAX_RECORDS = 12;
const DEFAULT_REMOTE_TIMEOUT_MS = 8000;

export const REPOSITORY_MODES = {
  local: 'local',
  remote: 'remote'
};

const getDefaultStorage = () => {
  if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
    return globalThis.localStorage;
  }
  return null;
};

const safeReadJson = (storage, key, fallback) => {
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const safeWriteJson = (storage, key, value) => {
  if (!storage) return value;
  storage.setItem(key, JSON.stringify(value));
  return value;
};

const safeRemove = (storage, key) => {
  if (storage) storage.removeItem(key);
};

const createId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const getDefaultClientInstanceId = (storage = getDefaultStorage()) => {
  const existingId = storage?.getItem(STORAGE_KEYS.clientInstanceId);
  if (existingId) return existingId;

  const nextId = createId();
  storage?.setItem(STORAGE_KEYS.clientInstanceId, nextId);
  return nextId;
};

const getDefaultFetch = () => {
  if (typeof globalThis !== 'undefined' && globalThis.fetch) {
    return globalThis.fetch.bind(globalThis);
  }
  return null;
};

const getViteEnv = () => import.meta.env || {};

const normalizeBaseUrl = (baseUrl = '') => String(baseUrl).trim().replace(/\/+$/, '');

const normalizeRemoteList = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.records)) return payload.records;
  return [];
};

const unwrapRecord = (payload) => payload?.record || payload || null;

const parsePositiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const requestJson = async ({
  baseUrl,
  publishableKey = '',
  clientInstanceId = '',
  fetchImpl = getDefaultFetch(),
  timeoutMs = DEFAULT_REMOTE_TIMEOUT_MS,
  path,
  method = 'GET',
  body
}) => {
  if (!baseUrl) throw new Error('Remote assessment repository requires a base URL.');
  if (!fetchImpl) throw new Error('Remote assessment repository requires fetch support.');

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = controller
    ? globalThis.setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (publishableKey) headers.apikey = publishableKey;
    if (clientInstanceId) headers['x-client-instance-id'] = clientInstanceId;

    const response = await fetchImpl(`${normalizeBaseUrl(baseUrl)}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller?.signal
    });

    if (!response.ok) {
      throw new Error(`Remote assessment repository request failed with status ${response.status}.`);
    }

    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } finally {
    if (timeout) globalThis.clearTimeout(timeout);
  }
};

export function createAssessmentRecord({ form, result, now = () => new Date(), id = createId }) {
  const createdAt = now().toISOString();
  const institutionName = form.institutionName?.trim() || '未命名机构';

  return {
    id: id(),
    institutionName,
    finalGrade: result.finalGrade,
    finalDecision: result.finalDecision,
    totalScore: result.totalScore,
    maxTermDays: result.maxTermDays,
    suggestedLimit: result.suggestedLimit,
    stableMonthlyAverage: result.stableMonthlyAverage,
    needsApproval: result.needsApproval,
    redlineReasons: result.redlineReasons,
    capReasons: result.capReasons,
    approvalReasons: result.approvalReasons,
    createdAt,
    updatedAt: createdAt,
    form,
    result
  };
}

export function getAssessmentRepositoryRuntimeConfig(env = getViteEnv()) {
  const remoteBaseUrl = normalizeBaseUrl(env.VITE_ASSESSMENT_API_URL || '');
  const remotePublishableKey = String(env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();
  const remoteTimeoutMs = parsePositiveNumber(env.VITE_ASSESSMENT_API_TIMEOUT_MS, DEFAULT_REMOTE_TIMEOUT_MS);

  return {
    mode: remoteBaseUrl ? REPOSITORY_MODES.remote : REPOSITORY_MODES.local,
    remoteBaseUrl,
    remotePublishableKey,
    remoteTimeoutMs
  };
}

export function createLocalAssessmentRepository({
  storage = getDefaultStorage(),
  maxRecords = DEFAULT_MAX_RECORDS,
  now,
  id
} = {}) {
  const loadDraft = () => safeReadJson(storage, STORAGE_KEYS.draft, DEFAULT_FORM);

  const saveDraft = (form) => safeWriteJson(storage, STORAGE_KEYS.draft, form);

  const resetDraft = () => {
    safeRemove(storage, STORAGE_KEYS.draft);
    return DEFAULT_FORM;
  };

  const listRecords = () => {
    const records = safeReadJson(storage, STORAGE_KEYS.history, []);
    return Array.isArray(records) ? records : [];
  };

  const saveRecord = ({ form, result }) => {
    const record = createAssessmentRecord({ form, result, now, id });
    const nextRecords = [record, ...listRecords()].slice(0, maxRecords);
    safeWriteJson(storage, STORAGE_KEYS.history, nextRecords);
    return record;
  };

  const loadRecord = (recordId) => {
    return listRecords().find((record) => record.id === recordId) || null;
  };

  return {
    mode: REPOSITORY_MODES.local,
    loadDraft,
    saveDraft,
    resetDraft,
    listRecords,
    saveRecord,
    loadRecord
  };
}

export function createRemoteAssessmentRepository({
  baseUrl,
  publishableKey = '',
  clientInstanceId = getDefaultClientInstanceId(),
  fetchImpl,
  timeoutMs = DEFAULT_REMOTE_TIMEOUT_MS,
  now,
  id
} = {}) {
  const request = (path, options = {}) => requestJson({
    baseUrl,
    publishableKey,
    clientInstanceId,
    fetchImpl,
    timeoutMs,
    path,
    ...options
  });

  const loadDraft = async () => {
    const payload = await request('/draft');
    return payload?.form || payload || DEFAULT_FORM;
  };

  const saveDraft = async (form) => {
    const payload = await request('/draft', {
      method: 'PUT',
      body: { form }
    });
    return payload?.form || form;
  };

  const resetDraft = async () => {
    await request('/draft', { method: 'DELETE' });
    return DEFAULT_FORM;
  };

  const listRecords = async () => normalizeRemoteList(await request('/records'));

  const saveRecord = async ({ form, result }) => {
    const record = createAssessmentRecord({ form, result, now, id });
    const payload = await request('/records', {
      method: 'POST',
      body: { form, result, record, clientInstanceId }
    });
    return unwrapRecord(payload) || record;
  };

  const loadRecord = async (recordId) => {
    const payload = await request(`/records/${encodeURIComponent(recordId)}`);
    return unwrapRecord(payload);
  };

  return {
    mode: REPOSITORY_MODES.remote,
    loadDraft,
    saveDraft,
    resetDraft,
    listRecords,
    saveRecord,
    loadRecord
  };
}

export function createConfiguredAssessmentRepository({
  env,
  storage,
  fetchImpl,
  maxRecords,
  now,
  id
} = {}) {
  const config = getAssessmentRepositoryRuntimeConfig(env);
  if (config.mode === REPOSITORY_MODES.remote) {
    return createRemoteAssessmentRepository({
      baseUrl: config.remoteBaseUrl,
      publishableKey: config.remotePublishableKey,
      clientInstanceId: getDefaultClientInstanceId(storage),
      timeoutMs: config.remoteTimeoutMs,
      fetchImpl,
      now,
      id
    });
  }

  return createLocalAssessmentRepository({ storage, maxRecords, now, id });
}
