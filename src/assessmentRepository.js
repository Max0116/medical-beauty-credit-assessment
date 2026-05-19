import { DEFAULT_FORM } from './riskEngine';

export const STORAGE_KEYS = {
  draft: 'medicalBeautyCreditAssessment:lastDraft',
  history: 'medicalBeautyCreditAssessment:history'
};

const DEFAULT_MAX_RECORDS = 12;

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
    loadDraft,
    saveDraft,
    resetDraft,
    listRecords,
    saveRecord,
    loadRecord
  };
}
