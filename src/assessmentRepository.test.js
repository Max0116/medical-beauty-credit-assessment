import { describe, expect, it } from 'vitest';
import { DEFAULT_FORM, evaluateCredit } from './riskEngine';
import {
  createConfiguredAssessmentRepository,
  createAssessmentRecord,
  createLocalAssessmentRepository,
  createRemoteAssessmentRepository,
  getAssessmentRepositoryRuntimeConfig
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

describe('remote assessment repository wiring', () => {
  it('keeps local mode when no remote endpoint is configured', () => {
    expect(getAssessmentRepositoryRuntimeConfig({})).toMatchObject({
      mode: 'local',
      remoteBaseUrl: ''
    });
  });

  it('selects remote mode from Vite environment config', () => {
    expect(getAssessmentRepositoryRuntimeConfig({
      VITE_ASSESSMENT_API_URL: ' https://credit-api.example.com ',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
      VITE_ASSESSMENT_API_TIMEOUT_MS: '12000'
    })).toEqual({
      mode: 'remote',
      remoteBaseUrl: 'https://credit-api.example.com',
      remotePublishableKey: 'sb_publishable_test',
      remoteTimeoutMs: 12000
    });
  });

  it('creates a local repository from config by default', () => {
    const repository = createConfiguredAssessmentRepository({
      env: {},
      storage: createMemoryStorage()
    });

    expect(repository.mode).toBe('local');
    expect(repository.loadDraft()).toEqual(DEFAULT_FORM);
  });

  it('calls the remote persistence contract with auth and normalized payloads', async () => {
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url, options });
      if (url.endsWith('/draft') && options.method === 'PUT') {
        return createJsonResponse({ form: JSON.parse(options.body).form });
      }
      if (url.endsWith('/records') && options.method === 'POST') {
        return createJsonResponse({ record: JSON.parse(options.body).record });
      }
      if (url.endsWith('/records') && !options.method) {
        return createJsonResponse({ records: [] });
      }
      if (url.endsWith('/records/remote-record-1/verification')) {
        if (options.method === 'POST') {
          return createJsonResponse({
            verificationLog: {
              id: 'verification-rerun-1',
              status: 'pending',
              riskTags: [],
              rawResultCount: 0
            }
          }, 202);
        }
        return createJsonResponse({
          verificationLogs: [
            {
              id: 'verification-1',
              status: 'completed',
              riskTags: ['行政处罚'],
              rawResultCount: 2
            }
          ]
        });
      }
      if (url.endsWith('/records/remote-record-1/verification-reviews') && options.method === 'POST') {
        return createJsonResponse({
          verificationReview: {
            id: 'review-1',
            ...JSON.parse(options.body)
          }
        }, 201);
      }
      if (url.endsWith('/records/remote-record-1/verification-reviews')) {
        return createJsonResponse({
          verificationReviews: [
            {
              id: 'review-1',
              action: 'accept_suggestion',
              reviewerName: '张三',
              reviewerDecision: 'normal'
            }
          ]
        });
      }
      if (url.endsWith('/records/remote-record-1/verification-attachments') && options.method === 'POST') {
        return createJsonResponse({
          attachment: {
            id: 'attachment-1',
            fileName: 'evidence.png',
            path: 'client-1/remote-record-1/attachment-1-evidence.png',
            signedUrl: 'https://storage.example.com/signed'
          }
        }, 201);
      }
      return createJsonResponse(null, 204);
    };
    const repository = createRemoteAssessmentRepository({
      baseUrl: 'https://credit-api.example.com/',
      publishableKey: 'sb_publishable_test',
      clientInstanceId: 'client-1',
      fetchImpl,
      now: () => new Date('2026-05-19T08:00:00.000Z'),
      id: () => 'remote-record-1'
    });
    const form = { ...DEFAULT_FORM, institutionName: '远端测试机构' };
    const result = evaluateCredit(form);

    await repository.saveDraft(form);
    const record = await repository.saveRecord({ form, result });
    const records = await repository.listRecords();
    const verificationLogs = await repository.listVerificationLogs(record.id);
    const rerunLog = await repository.rerunVerification(record.id);
    const savedReview = await repository.saveVerificationReview(record.id, {
      action: 'accept_suggestion',
      reviewerName: '张三',
      reviewerDecision: 'normal'
    });
    const verificationReviews = await repository.listVerificationReviews(record.id);
    const uploadedAttachment = await repository.uploadEvidenceAttachment(record.id, new File(['demo'], 'evidence.png', { type: 'image/png' }));

    expect(record).toMatchObject({
      id: 'remote-record-1',
      institutionName: '远端测试机构',
      form,
      result
    });
    expect(records).toEqual([]);
    expect(verificationLogs).toEqual([
      {
        id: 'verification-1',
        status: 'completed',
        riskTags: ['行政处罚'],
        rawResultCount: 2
      }
    ]);
    expect(rerunLog).toMatchObject({
      id: 'verification-rerun-1',
      status: 'pending'
    });
    expect(savedReview).toMatchObject({
      id: 'review-1',
      action: 'accept_suggestion',
      reviewerName: '张三',
      reviewerDecision: 'normal'
    });
    expect(verificationReviews).toEqual([
      {
        id: 'review-1',
        action: 'accept_suggestion',
        reviewerName: '张三',
        reviewerDecision: 'normal'
      }
    ]);
    expect(uploadedAttachment).toMatchObject({
      id: 'attachment-1',
      fileName: 'evidence.png',
      signedUrl: 'https://storage.example.com/signed'
    });
    expect(calls.map((call) => call.url)).toEqual([
      'https://credit-api.example.com/draft',
      'https://credit-api.example.com/records',
      'https://credit-api.example.com/records',
      'https://credit-api.example.com/records/remote-record-1/verification',
      'https://credit-api.example.com/records/remote-record-1/verification',
      'https://credit-api.example.com/records/remote-record-1/verification-reviews',
      'https://credit-api.example.com/records/remote-record-1/verification-reviews',
      'https://credit-api.example.com/records/remote-record-1/verification-attachments'
    ]);
    expect(calls.every((call) => call.options.headers.apikey === 'sb_publishable_test')).toBe(true);
    expect(calls.every((call) => call.options.headers['x-client-instance-id'] === 'client-1')).toBe(true);
    expect(calls.every((call) => !call.options.headers.Authorization)).toBe(true);
    expect(calls.at(-1).options.headers['Content-Type']).toBeUndefined();
    expect(calls.at(-1).options.body).toBeInstanceOf(FormData);
  });
});

const createJsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (body === null ? '' : JSON.stringify(body))
});
