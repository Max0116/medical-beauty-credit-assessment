import { describe, expect, it } from 'vitest';
import { DEFAULT_FORM, evaluateCredit } from './riskEngine';
import {
  createAssessmentRecord,
  createLocalAssessmentRepository
} from './assessmentRepository';

const createMemoryStorage = (initial = {}) => {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    snapshot: () => Object.fromEntries(store.entries())
  };
};

describe('createLocalAssessmentRepository', () => {
  it('loads the default draft when storage is empty or malformed', () => {
    const emptyRepository = createLocalAssessmentRepository({ storage: createMemoryStorage() });
    const malformedRepository = createLocalAssessmentRepository({
      storage: createMemoryStorage({
        'medicalBeautyCreditAssessment:lastDraft': '{bad-json'
      })
    });

    expect(emptyRepository.loadDraft()).toEqual(DEFAULT_FORM);
    expect(malformedRepository.loadDraft()).toEqual(DEFAULT_FORM);
  });

  it('saves, loads, and resets a draft through the repository boundary', () => {
    const repository = createLocalAssessmentRepository({ storage: createMemoryStorage() });
    const draft = {
      ...DEFAULT_FORM,
      institutionName: '上海云镜医疗美容门诊部',
      requestedTerm: 30
    };

    repository.saveDraft(draft);

    expect(repository.loadDraft()).toEqual(draft);
    expect(repository.resetDraft()).toEqual(DEFAULT_FORM);
    expect(repository.loadDraft()).toEqual(DEFAULT_FORM);
  });

  it('creates a normalized assessment record from form and result snapshots', () => {
    const form = {
      ...DEFAULT_FORM,
      institutionName: '北京澄光医疗美容诊所',
      requestedLimit: 88000
    };
    const result = evaluateCredit(form);

    const record = createAssessmentRecord({ form, result, now: () => new Date('2026-05-19T08:00:00.000Z'), id: () => 'record-1' });

    expect(record).toMatchObject({
      id: 'record-1',
      institutionName: '北京澄光医疗美容诊所',
      finalGrade: result.finalGrade,
      finalDecision: result.finalDecision,
      totalScore: result.totalScore,
      maxTermDays: result.maxTermDays,
      suggestedLimit: result.suggestedLimit,
      stableMonthlyAverage: result.stableMonthlyAverage,
      needsApproval: result.needsApproval,
      createdAt: '2026-05-19T08:00:00.000Z',
      updatedAt: '2026-05-19T08:00:00.000Z',
      form,
      result
    });
  });

  it('saves records newest-first, caps history length, and loads by id', () => {
    let sequence = 0;
    const repository = createLocalAssessmentRepository({
      storage: createMemoryStorage(),
      maxRecords: 2,
      id: () => `record-${++sequence}`,
      now: () => new Date(`2026-05-19T08:00:0${sequence}.000Z`)
    });

    const first = repository.saveRecord({ form: { ...DEFAULT_FORM, institutionName: '机构 A' }, result: evaluateCredit(DEFAULT_FORM) });
    const second = repository.saveRecord({ form: { ...DEFAULT_FORM, institutionName: '机构 B' }, result: evaluateCredit(DEFAULT_FORM) });
    const third = repository.saveRecord({ form: { ...DEFAULT_FORM, institutionName: '机构 C' }, result: evaluateCredit(DEFAULT_FORM) });

    expect(repository.listRecords().map((record) => record.id)).toEqual([third.id, second.id]);
    expect(repository.loadRecord(third.id)).toEqual(third);
    expect(repository.loadRecord(first.id)).toBeNull();
  });

  it('falls back to an empty history when stored records are malformed', () => {
    const repository = createLocalAssessmentRepository({
      storage: createMemoryStorage({
        'medicalBeautyCreditAssessment:history': 'not-json'
      })
    });

    expect(repository.listRecords()).toEqual([]);
  });
});
